'use strict';
/* Aura Collect — serveur de production (MVP mono-cabinet).
   Données : PostgreSQL Supabase (schéma aura). Fichiers : bytea, jamais publics. */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const store = require('./lib/store');
const ai = require('./lib/ai');
const mail = require('./lib/mail');
const archive = require('./lib/archive');
const seal = require('./lib/seal');
const fedapay = require('./lib/fedapay');
const plans = require('./lib/plans');
const billing = require('./lib/billing');
const storage = require('./lib/storage');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8788);
const CABINET = process.env.CABINET_NAME || 'Cabinet Lemaire & Associés';
const PASSWORD = process.env.CABINET_PASSWORD || 'aura-demo';
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const DEFAULT_BASE = `http://localhost:${PORT}`;
const MAX_MB = 15;

if (!process.env.CABINET_PASSWORD) console.warn('[aura] CABINET_PASSWORD absent : mot de passe de démonstration « aura-demo ».');
if (!process.env.SESSION_SECRET) console.warn('[aura] SESSION_SECRET absent : secret de développement utilisé.');
if (!process.env.DATABASE_URL) console.warn('[aura] DATABASE_URL absent : la base Supabase est requise.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ---------- webhook FedaPay ----------
   Monté avant express.json() : la signature porte sur le corps brut, un JSON déjà parsé ne
   permet plus de la vérifier. Réponse 2xx immédiate, traitement en arrière-plan. */
app.post('/api/billing/webhook', express.raw({ type: '*/*', limit: '256kb' }), (req, res) => {
  const secret = process.env.FEDAPAY_WEBHOOK_SECRET || '';
  if (!secret) {
    console.warn('[billing] FEDAPAY_WEBHOOK_SECRET absent : webhook refusé.');
    return res.status(503).json({ error: 'Webhook non configuré.' });
  }
  if (!fedapay.verifySignature(req.body, req.headers['x-fedapay-signature'], secret)) {
    console.warn('[billing] signature webhook invalide.');
    return res.status(400).json({ error: 'Signature invalide.' });
  }
  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
  } catch (_) {
    return res.status(400).json({ error: 'Charge utile invalide.' });
  }
  res.json({ received: true });

  const name = event.name || event.type || '';

  // FedaPay n'a pas toujours la même enveloppe selon la version de l'événement :
  // l'identifiant de transaction peut se trouver à plusieurs endroits.
  const candidates = [
    event.object && event.object.id,
    event.data && event.data.object && event.data.object.id,
    event.data && event.data.id,
    event.object_id,
    event.entity && event.entity.id,
    event.transaction && event.transaction.id
  ];
  const txId = candidates
    .map((v) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v)))
    .find((v) => v !== null && !Number.isNaN(v)) || null;

  if (!txId) {
    console.warn('[billing] webhook sans identifiant exploitable :', JSON.stringify(event).slice(0, 900));
  }

  setImmediate(async () => {
    try {
      if (!(await billing.recordEvent(name, txId, event))) return;
      if (name === 'transaction.approved') {
        const payment = await billing.approveOnce(txId, event);
        if (!payment) {
          console.warn('[billing] paiement inconnu ou déjà crédité :', txId);
          return;
        }
        const cabinet = await billing.grantPeriod(payment.cabinet_id, payment.months, payment.plan);
        console.log(`[billing] ${name} → cabinet ${cabinet.id} en ${payment.plan} jusqu’au ${cabinet.paid_until}`);
      } else if (name === 'transaction.declined' || name === 'transaction.canceled' || name === 'transaction.expired') {
        const status = name === 'transaction.declined' ? 'declined'
          : name === 'transaction.expired' ? 'expired' : 'canceled';
        const payment = await billing.expireIfPending(txId, status, event);
        console.log(`[billing] ${name} sur la transaction ${txId}${payment ? '' : ' (déjà traité, sans effet)'}`);
      } else if (name === 'transaction.refunded') {
        const payment = await billing.markPayment(txId, 'refunded', event);
        if (payment) {
          const cabinet = await billing.revokeAccess(payment.cabinet_id);
          console.log(`[billing] remboursement ${txId} → accès repris pour le cabinet ${cabinet.id}`);
        }
      }
    } catch (err) {
      console.error('[billing] traitement webhook :', err.message);
    }
  });
});

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

/* ---------- session ---------- */
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

/* Le cookie porte l'échéance ET l'identifiant du cabinet : c'est lui qui délimite
   ce que la session a le droit de voir. */
function issueSession(cabinetId, userId) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const payload = exp + ':' + cabinetId + ':' + (userId || '');
  return Buffer.from(payload).toString('base64url') + '.' + sign(payload);
}

function readSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)aura_session=([^;]+)/);
  if (!match) return null;
  const [encoded, sig] = decodeURIComponent(match[1]).split('.');
  if (!encoded || !sig) return null;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch (_) { return null; }
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [exp, cabinetId, userId] = payload.split(':');
  if (!cabinetId || Number(exp) <= Date.now()) return null;
  return { cabinetId, userId: userId || null };
}

function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });
  req.cabinetId = session.cabinetId;
  req.userId = session.userId || null;
  next();
}

/* ---------- mots de passe ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const calculated = crypto.scryptSync(password, parts[1], 64);
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== calculated.length) return false;
  return crypto.timingSafeEqual(expected, calculated);
}

/* ---------- jeton de réinitialisation ----------
   Signé, daté, et lié à l'empreinte du mot de passe courant : il cesse d'être
   valable dès que le mot de passe change, sans table ni nettoyage à prévoir. */
const RESET_TTL = 60 * 60 * 1000;

function resetSignature(email, expires, empreinte) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${email}|${expires}|${empreinte}`)
    .digest('base64url');
}

function issueResetToken(cabinet) {
  const expires = Date.now() + RESET_TTL;
  const empreinte = String(cabinet.password_hash || '').split('$').pop().slice(0, 16);
  const charge = Buffer.from(JSON.stringify({ e: cabinet.email, x: expires })).toString('base64url');
  return `${charge}.${resetSignature(cabinet.email, expires, empreinte)}`;
}

function readResetToken(token) {
  const [charge, signature] = String(token || '').split('.');
  if (!charge || !signature) return null;
  let contenu;
  try { contenu = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!contenu || !contenu.e || !contenu.x) return null;
  if (Date.now() > Number(contenu.x)) return null;
  return contenu;
}

function setSessionCookie(res, value) {
  res.setHeader('Set-Cookie',
    `aura_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}

/* ---------- limitation des tentatives de connexion ----------
   Seuls les échecs comptent : une connexion réussie remet le compteur à zéro.
   Deux verrous : un par couple adresse/email (5 échecs), un par adresse seule
   (30 échecs) pour arrêter quelqu'un qui essaie beaucoup d'emails différents. */
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX_PAIR = 5;
const LOGIN_MAX_IP = 30;
const loginHits = new Map();

function hitKey(kind, value) { return kind + '|' + value; }

function loginWait(kind, value) {
  const rec = loginHits.get(hitKey(kind, value));
  if (!rec) return 0;
  const now = Date.now();
  if (rec.until > now) return Math.ceil((rec.until - now) / 1000);
  if (now - rec.since > LOGIN_WINDOW) loginHits.delete(hitKey(kind, value));
  return 0;
}

function loginFail(kind, value, max) {
  const now = Date.now();
  const key = hitKey(kind, value);
  let rec = loginHits.get(key);
  if (!rec || now - rec.since > LOGIN_WINDOW) rec = { count: 0, since: now, until: 0 };
  rec.count += 1;
  if (rec.count >= max) rec.until = now + LOGIN_WINDOW;
  loginHits.set(key, rec);
  if (loginHits.size > 5000) {
    for (const [k, v] of loginHits) {
      if (v.until <= now && now - v.since > LOGIN_WINDOW) loginHits.delete(k);
    }
  }
}

function loginClear(kind, value) { loginHits.delete(hitKey(kind, value)); }

/* Limiteur des formulaires publics (inscription, contact, demande de mot de
   passe). Il partage le compteur du verrou de connexion mais avec son propre
   quota : une même adresse ne peut pas enchaîner les envois. Sans cette
   fonction, ces trois routes échouaient avant même d'écrire en base. */
const FORM_MAX_IP = 12;
const FORM_WINDOW = LOGIN_WINDOW;

function throttle(ip) {
  const value = String(ip || 'unknown');
  const rec = loginHits.get('form|' + value);
  const now = Date.now();
  if (rec) {
    if (rec.until > now) return false;
    if (now - rec.since > FORM_WINDOW) loginHits.delete('form|' + value);
  }
  loginFail('form', value, FORM_MAX_IP);
  return true;
}

function tooMany(res, seconds) {
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({
    error: 'Trop de tentatives. Réessayez dans ' + Math.ceil(seconds / 60) + ' minute' + (seconds > 60 ? 's' : '') + '.'
  });
}

/* ---------- vues ---------- */
function publicDossier(d) {
  return {
    client: d.client,
    email: d.email,
    template: store.templateById(d.template).name,
    createdAt: d.createdAt,
    progress: store.progressOf(d),
    pieces: d.pieces.map((p) => ({
      key: p.key,
      label: p.label,
      rule: p.rule,
      status: p.status,
      reason: p.reason || '',
      filename: p.filename || '',
      dateDocument: p.dateDocument || ''
    }))
  };
}

const LINK_DAYS = Number(process.env.LINK_TTL_DAYS || 30);

/* ---------- prévenir le cabinet ----------
   Sans cela, le cabinet doit ouvrir son espace pour savoir qu'une pièce est
   arrivée. Les dépôts d'un même dossier sont groupés sur trente minutes ; la
   fin du dossier, elle, part toujours immédiatement. */
const NOTICE_WINDOW_MIN = 30;

function etatLisible(piece) {
  if (piece.status === 'ok') return 'conforme';
  if (piece.status === 'refuse' || piece.status === 'rejete') return 'refusée par la vérification';
  return 'à vérifier par vous';
}

async function notifyCabinet(dossier, base) {
  try {
    if (!dossier || !dossier.cabinetId) return;
    const cabinet = await billing.findById(dossier.cabinetId);
    if (!cabinet || !cabinet.email) return;

    const bloquantes = dossier.pieces.filter((p) => !['ok', 'valide'].includes(p.status));
    const complet = bloquantes.length === 0;
    const prefixe = complet ? 'Dossier complet' : 'Nouvelle pièce';

    if (!complet && await store.recentNotice(dossier.id, prefixe, NOTICE_WINDOW_MIN)) return;

    const app = (base || process.env.PUBLIC_BASE_URL || DEFAULT_BASE).replace(/\/$/, '') + '/app';
    const derniere = dossier.pieces.filter((p) => p.filename).pop();

    const lignes = complet
      ? [
        'Bonjour,',
        '',
        'Le dossier de ' + dossier.client + ' est complet : toutes les pièces demandées sont arrivées.',
        'Vous pouvez le contrôler puis le sceller depuis votre espace :',
        '',
        app,
        '',
        'Le client n\'a plus rien à déposer : le lien se ferme dès que vous scellez.'
      ]
      : [
        'Bonjour,',
        '',
        (derniere ? 'Une pièce vient d\'arriver pour ' + dossier.client + ' : ' + derniere.label + '.'
          : 'Une pièce vient d\'arriver pour ' + dossier.client + '.'),
        'Verdict automatique : ' + (derniere ? etatLisible(derniere) : 'à vérifier par vous') + '.',
        '',
        'Il reste ' + bloquantes.length + ' pièce' + (bloquantes.length > 1 ? 's' : '') + ' à recevoir.',
        '',
        app
      ];

    await mail.send({
      to: cabinet.email,
      subject: (complet ? 'Dossier complet' : 'Nouvelle pièce') + ' — ' + dossier.client,
      text: lignes.join('\n'),
      dossierId: dossier.id
    });
  } catch (err) {
    /* Une alerte ratée ne doit jamais faire échouer un dépôt réussi. */
    console.error('[notify] cabinet non prévenu :', err.message);
  }
}

function linkExpired(dossier) {
  return Date.now() - new Date(dossier.createdAt).getTime() > LINK_DAYS * 864e5;
}

/* Nom du cabinet propriétaire d'une donnée. Depuis le passage au multi-cabinets,
   `CABINET` n'est plus qu'un repli historique : l'afficher tel quel faisait voir
   « Cabinet Lemaire & Associés » à n'importe quel nouveau cabinet, sur son
   tableau de bord comme sur la page de dépôt de ses clients. */
async function cabinetNameOf(cabinetId) {
  if (!cabinetId) return CABINET;
  try {
    const cabinet = await billing.findById(cabinetId);
    return (cabinet && cabinet.name) || CABINET;
  } catch (err) {
    return CABINET;
  }
}

/* Auteur d'un geste, pour le journal. Aujourd'hui un seul compte par cabinet ;
   dès que les utilisateurs multiples arrivent, c'est la personne connectée. */
async function actorOf(req) {
  if (req.actor) return req.actor;
  /* La personne connectée d'abord : c'est son nom qui doit apparaître au
     journal, pas celui du cabinet. Repli sur le cabinet pour les sessions
     ouvertes avant l'arrivée des comptes multiples. */
  if (req.userId) {
    try {
      const u = await store.getUser(req.userId, req.cabinetId);
      if (u) return { kind: 'cabinet', email: u.email, name: u.name || u.email };
    } catch (_) { /* on retombe sur le cabinet */ }
  }
  try {
    const cabinet = await billing.findById(req.cabinetId);
    return {
      kind: 'cabinet',
      email: (cabinet && cabinet.email) || null,
      name: (cabinet && cabinet.name) || null
    };
  } catch (_) {
    return { kind: 'cabinet', email: null, name: null };
  }
}

/* Écrit une ligne au journal sans jamais faire échouer le geste métier. */
async function trace(entry) {
  try { await store.addDecision(entry); } catch (err) {
    console.error('[journal] écriture impossible :', err.message);
  }
}

/* Les liens remis aux clients portent le domaine du cabinet s'il en a déclaré
   un : c'est ce qu'il a payé, et cela rassure son client. */
function baseFor(cabinet, req) {
  const d = cabinet && cabinet.domain;
  if (d) return 'https://' + d;
  return baseUrl(req);
}

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? proto + '://' + host : DEFAULT_BASE;
}

function cabinetDossier(d, base) {
  return {
    id: d.id,
    client: d.client,
    clientId: d.clientId || null,
    clientName: d.clientName || d.client,
    clientPhone: d.clientPhone || '',
    email: d.email,
    template: d.template,
    templateName: store.templateById(d.template).name,
    recipient: d.recipient || '',
    token: d.token,
    link: (base || DEFAULT_BASE) + '/p/' + d.token,
    createdAt: d.createdAt,
    lastActivity: d.lastActivity,
    status: store.statusOf(d),
    progress: store.progressOf(d),
    obstacles: d.pieces.filter((p) => !['ok', 'review', 'valide'].includes(p.status)).map((p) => ({
      key: p.key, label: p.label, status: p.status, reason: p.reason || ''
    })),
    sealed: d.sealHash ? { hash: d.sealHash, at: d.sealedAt } : null,
    pieces: d.pieces.map((p) => ({
      key: p.key,
      label: p.label,
      rule: p.rule,
      status: p.status,
      reason: p.reason || '',
      filename: p.filename || '',
      dateDocument: p.dateDocument || '',
      confidence: p.confidence,
      typeDetecte: p.typeDetecte || '',
      at: p.at || '',
      forcable: store.peutEtreForce(p),
      motifRejet: p.status === 'ko' ? store.motifDeRejet(p.reason) : ''
    }))
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (!ok) return cb(new Error('FORMAT'));
    cb(null, true);
  }
});

/* ---------- authentification ---------- */
app.post('/api/login', async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();

    const waitIp = loginWait('ip', ip);
    if (waitIp) return tooMany(res, waitIp);
    if (email) {
      const waitPair = loginWait('pair', ip + '|' + email);
      if (waitPair) return tooMany(res, waitPair);
    }

    const given = String((req.body && req.body.password) || '');
    if (!given) {
      loginFail('ip', ip, LOGIN_MAX_IP);
      return res.status(401).json({ error: 'Mot de passe requis.' });
    }

    let cabinet = null;
    let user = null;
    if (email) {
      // Un utilisateur d'abord : plusieurs personnes peuvent partager un cabinet.
      user = await store.findUserByEmail(email);
      if (user) cabinet = await billing.findById(user.cabinet_id);
      if (!user) cabinet = await billing.findByEmail(email);
      if (!cabinet) {
        loginFail('ip', ip, LOGIN_MAX_IP);
        loginFail('pair', ip + '|' + email, LOGIN_MAX_PAIR);
        // Même message que pour un mauvais mot de passe : on n'apprend pas
        // à un inconnu quelles adresses ont un compte chez nous.
        return res.status(401).json({ error: 'Identifiants incorrects.' });
      }
      // Invitation non encore acceptée : aucun mot de passe n'existe.
      if (user && !user.password_hash) {
        return res.status(401).json({ error: 'Invitation non activée : ouvrez le lien qui vous a été transmis pour choisir votre mot de passe.' });
      }
    } else {
      // Accès historique (avant les comptes) : un seul cabinet, mot de passe partagé.
      cabinet = await billing.ensureCabinet();
    }

    let ok = false;
    if (user && user.password_hash) {
      ok = verifyPassword(given, user.password_hash);
    } else if (cabinet.password_hash) {
      ok = verifyPassword(given, cabinet.password_hash);
    } else {
      const a = Buffer.from(given);
      const b = Buffer.from(PASSWORD);
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!ok) {
      loginFail('ip', ip, LOGIN_MAX_IP);
      if (email) loginFail('pair', ip + '|' + email, LOGIN_MAX_PAIR);
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    loginClear('ip', ip);
    if (email) loginClear('pair', ip + '|' + email);

    cabinet = await billing.startTrialIfMissing(cabinet);
    if (user) await store.touchUserLogin(user.id);
    setSessionCookie(res, issueSession(cabinet.id, user ? user.id : null));
    res.json({
      ok: true,
      cabinet: cabinet.name,
      user: user ? { name: user.name, email: user.email, role: user.role } : null,
      access: billing.accessOf(cabinet)
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'aura_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  let db = false;
  try { db = await store.healthy(); } catch (err) { console.error('[db] health:', err.message); }

  const session = readSession(req);
  let cabinet = null;
  let access = null;
  let user = null;
  if (session) {
    try {
      cabinet = await billing.findById(session.cabinetId);
      /* Une session déjà ouverte doit se réparer seule : sans cela, un cabinet
         sans échéance resterait bloqué sans jamais repasser par la connexion. */
      cabinet = await billing.startTrialIfMissing(cabinet);
      if (cabinet) access = billing.accessOf(cabinet);
      if (session.userId) user = await store.getUser(session.userId, session.cabinetId);
    } catch (err) { console.error('[me] cabinet:', err.message); }
  }

  res.json({
    authenticated: Boolean(session && cabinet),
    cabinet: cabinet ? cabinet.name : null,
    user: user ? { name: user.name, email: user.email, role: user.role, id: user.id } : null,
    access,
    ai: ai.status(),
    mail: mail.mode(),
    db: db ? 'supabase' : 'down'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    await store.healthy();
    res.json({ ok: true, db: 'supabase', ai: ai.configured() ? 'groq' : 'off' });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

/* ---------- clients ---------- */
app.get('/api/clients', requireAuth, async (req, res, next) => {
  try {
    res.json({ clients: await store.listClients(req.cabinetId) });
  } catch (err) { next(err); }
});

app.get('/api/clients/:id', requireAuth, async (req, res, next) => {
  try {
    const client = await store.getClient(req.params.id, req.cabinetId);
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });
    const all = await store.listDossiers(req.cabinetId);
    const base = baseUrl(req);
    res.json({
      client,
      dossiers: all.filter((d) => d.clientId === client.id).map((d) => cabinetDossier(d, base))
    });
  } catch (err) { next(err); }
});

/* Le cabinet peut refuser une pièce déjà reçue et en demander une autre :
   le client retrouve la pièce à redéposer sur son lien. */
app.post('/api/dossiers/:id/pieces/:key/reject', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    if (dossier.sealHash) return res.status(409).json({ error: 'Dossier scellé : plus modifiable.' });

    const piece = dossier.pieces.find((p) => p.key === req.params.key);
    if (!piece) return res.status(404).json({ error: 'Pièce introuvable.' });
    if (!['ok', 'review', 'valide'].includes(piece.status)) {
      return res.status(409).json({ error: 'Cette pièce est déjà en attente du client.' });
    }

    await store.updatePiece(dossier.id, piece.key, {
      status: 'ko',
      reason: 'Le cabinet demande une nouvelle version de cette pièce.'
    });
    const auteur = await actorOf(req);
    await trace({
      cabinetId: req.cabinetId, dossierId: dossier.id,
      pieceKey: piece.key, pieceLabel: piece.label,
      action: 'refus', status: 'ko',
      reason: 'Nouvelle version demandée au client (verdict précédent : ' + piece.status + ')',
      actorKind: auteur.kind, actorEmail: auteur.email, actorName: auteur.name
    });
    const fresh = await store.getDossier(dossier.id, req.cabinetId);
    res.json({ dossier: cabinetDossier(fresh, baseUrl(req)) });
  } catch (err) { next(err); }
});

/* Le cabinet confirme une pièce : c'est le seul geste qui vaut validation. */
app.post('/api/dossiers/:id/pieces/:key/confirm', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    if (dossier.sealHash) return res.status(409).json({ error: 'Dossier scellé : plus modifiable.' });

    const piece = dossier.pieces.find((p) => p.key === req.params.key);
    if (!piece) return res.status(404).json({ error: 'Pièce introuvable.' });

    const acceptable = ['ok', 'review', 'valide'].includes(piece.status);
    const forcable = store.peutEtreForce(piece);
    if (!acceptable && !forcable) {
      if (piece.status === 'ko') {
        return res.status(409).json({
          error: store.motifDeRejet(piece.reason) === 'lisible'
            ? 'Pièce illisible : elle doit être reprise par le client, personne ne peut la valider telle quelle.'
            : 'Pièce non conforme : elle doit être remplacée par le client.'
        });
      }
      return res.status(409).json({ error: 'Cette pièce n’est pas encore déposée.' });
    }

    const reason = forcable
      ? 'Validée par le cabinet malgré l’avis de l’IA. ' + piece.reason
      : 'Confirmée par le cabinet.';
    await store.updatePiece(dossier.id, piece.key, { status: 'valide', reason });
    const auteur = await actorOf(req);
    await trace({
      cabinetId: req.cabinetId, dossierId: dossier.id,
      pieceKey: piece.key, pieceLabel: piece.label,
      action: forcable ? 'forcage' : 'validation', status: 'valide', reason,
      actorKind: auteur.kind, actorEmail: auteur.email, actorName: auteur.name
    });
    const fresh = await store.getDossier(dossier.id, req.cabinetId);
    res.json({ dossier: cabinetDossier(fresh, baseUrl(req)) });
  } catch (err) { next(err); }
});

/* ---------- équipe : plusieurs personnes dans un même cabinet ----------
   L'invitation passe par un lien, pas par un email : c'est le canal choisi
   (WhatsApp) qui transporte le lien. Le lien expire en 7 jours. */
const INVITE_DAYS = 7;

async function estProprietaire(req) {
  if (!req.userId) return true;                      // compte historique = propriétaire
  const u = await store.getUser(req.userId, req.cabinetId);
  return Boolean(u && u.role === 'owner');
}

app.get('/api/team', requireAuth, async (req, res, next) => {
  try {
    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ error: 'Session invalide.' });
    const access = billing.accessOf(cabinet);
    const users = await store.listUsers(req.cabinetId);
    res.json({
      users,
      me: req.userId || null,
      owner: await estProprietaire(req),
      limits: { users: access.limits.users },
      plan: access.plan
    });
  } catch (err) { next(err); }
});

app.post('/api/team/invite', requireAuth, async (req, res, next) => {
  try {
    if (!(await estProprietaire(req))) {
      return res.status(403).json({ error: "Seul le propriétaire du cabinet peut inviter quelqu'un." });
    }
    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ error: 'Session invalide.' });
    const access = billing.accessOf(cabinet);

    const name = String((req.body && req.body.name) || '').trim();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    const dejaCabinet = await billing.findByEmail(email);
    const dejaUser = await store.findUserByEmail(email);
    if (dejaCabinet || dejaUser) {
      return res.status(409).json({ error: 'Cette adresse est déjà utilisée sur Aura Collect.' });
    }

    const max = Number(access.limits.users || 0);   // 0 = illimité
    if (max > 0) {
      const actuels = await store.countUsers(req.cabinetId);
      if (actuels >= max) {
        return res.status(402).json({
          error: `Votre offre ${access.plan} est limitée à ${max} utilisateur${max > 1 ? 's' : ''}. Passez à l’offre supérieure pour inviter davantage de monde.`,
          used: actuels, max
        });
      }
    }

    const token = store.token(24);
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
    const created = await store.inviteUser(req.cabinetId, {
      name, email, role: 'member', invitedBy: cabinet.email, token, expiresAt
    });

    const auteur = await actorOf(req);
    await trace({
      cabinetId: req.cabinetId, dossierId: '_cabinet', action: 'invitation',
      reason: 'Invitation envoyée à ' + email,
      actorKind: auteur.kind, actorEmail: auteur.email, actorName: auteur.name
    });

    res.status(201).json({
      user: created,
      inviteUrl: baseUrl(req) + '/invitation.html?t=' + token,
      expiresAt
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette adresse est déjà invitée.' });
    }
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Les comptes multiples ne sont pas encore activés sur cette base. La migration doit être passée une fois.' });
    }
    next(err);
  }
});

app.post('/api/team/:id/revoke', requireAuth, async (req, res, next) => {
  try {
    if (!(await estProprietaire(req))) {
      return res.status(403).json({ error: 'Seul le propriétaire peut retirer un accès.' });
    }
    const gone = await store.revokeUser(req.params.id, req.cabinetId);
    if (!gone) return res.status(404).json({ error: 'Utilisateur introuvable ou propriétaire.' });
    const auteur = await actorOf(req);
    await trace({
      cabinetId: req.cabinetId, dossierId: '_cabinet', action: 'revocation',
      reason: 'Accès retiré à un utilisateur',
      actorKind: auteur.kind, actorEmail: auteur.email, actorName: auteur.name
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------- domaine personnalisé (offre Cabinet) ---------- */
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

app.get('/api/domain', requireAuth, async (req, res, next) => {
  try {
    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ error: 'Session invalide.' });
    const access = billing.accessOf(cabinet);
    res.json({
      domain: cabinet.domain || null,
      plan: access.plan,
      allowed: access.plan === 'cabinet',
      target: (process.env.PUBLIC_BASE_URL || 'https://aura-collect.onrender.com').replace(/^https?:\/\//, '')
    });
  } catch (err) { next(err); }
});

app.post('/api/domain', requireAuth, async (req, res, next) => {
  try {
    if (!(await estProprietaire(req))) {
      return res.status(403).json({ error: 'Seul le propriétaire peut modifier le domaine.' });
    }
    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ error: 'Session invalide.' });
    const access = billing.accessOf(cabinet);
    if (access.plan !== 'cabinet') {
      return res.status(402).json({ error: 'Le domaine personnalisé est réservé à l’offre Cabinet.' });
    }

    let value = String((req.body && req.body.domain) || '').trim().toLowerCase();
    value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!value) {
      await store.setDomain(req.cabinetId, null);
      return res.json({ ok: true, domain: null });
    }
    if (value.includes('onrender.com') || !HOST_RE.test(value)) {
      return res.status(400).json({ error: 'Indiquez un nom de domaine valide, par exemple dossiers.moncabinet.com.' });
    }

    const dejaPris = await store.cabinetByDomain(value);
    if (dejaPris && dejaPris.id !== req.cabinetId) {
      return res.status(409).json({ error: 'Ce domaine est déjà utilisé par un autre cabinet.' });
    }

    const saved = await store.setDomain(req.cabinetId, value);
    if (saved === null) {
      return res.status(503).json({ error: 'La mise à jour du schéma n’est pas encore passée. Réessayez après la migration.' });
    }
    const auteur = await actorOf(req);
    await trace({
      cabinetId: req.cabinetId, dossierId: '_cabinet', action: 'domaine',
      reason: 'Domaine personnalisé réglé sur ' + value,
      actorKind: auteur.kind, actorEmail: auteur.email, actorName: auteur.name
    });
    res.json({ ok: true, domain: saved });
  } catch (err) { next(err); }
});

/* Ouverture d'une invitation : public, protégé par le jeton du lien. */
app.get('/api/invitation/:token', async (req, res, next) => {
  try {
    const u = await store.getUserByInvite(req.params.token);
    if (!u) return res.status(404).json({ error: 'Invitation inconnue ou déjà utilisée.' });
    if (u.invite_expires_at && new Date(u.invite_expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Cette invitation a expiré. Demandez-en une nouvelle.' });
    }
    const cabinet = await billing.findById(u.cabinet_id);
    res.json({ email: u.email, name: u.name, cabinet: cabinet ? cabinet.name : '' });
  } catch (err) { next(err); }
});

app.post('/api/invitation/:token', async (req, res, next) => {
  try {
    const u = await store.getUserByInvite(req.params.token);
    if (!u) return res.status(404).json({ error: 'Invitation inconnue ou déjà utilisée.' });
    if (u.invite_expires_at && new Date(u.invite_expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Cette invitation a expiré. Demandez-en une nouvelle.' });
    }
    const name = String((req.body && req.body.name) || '').trim();
    const password = String((req.body && req.body.password) || '');
    if (name.length < 2) return res.status(400).json({ error: 'Indiquez votre nom.' });
    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum.' });

    const active = await store.activateUser(u.id, { name, passwordHash: hashPassword(password) });
    if (!active) return res.status(410).json({ error: 'Invitation déjà utilisée.' });

    setSessionCookie(res, issueSession(active.cabinet_id, active.id));
    res.json({ ok: true, cabinetId: active.cabinet_id, redirect: '/app?bienvenue=1' });
  } catch (err) { next(err); }
});

/* ---------- facturation ---------- */
app.get('/api/billing/plans', (req, res) => {
  res.json({
    plans: plans.publicList(),
    currency: 'XOF',
    billing: {
      cycle: 'prepaid',
      renewal: 'manual',
      graceDays: billing.GRACE_DAYS,
      trialDays: billing.TRIAL_DAYS
    },
    payment: { provider: 'fedapay', mode: fedapay.ENV, configured: fedapay.configured() }
  });
});

/* Changement de mot de passe depuis l'espace cabinet. Le mot de passe actuel
   est exigé : une session laissée ouverte sur un poste partagé ne doit pas
   suffire à verrouiller le compte de son propriétaire. */
app.post('/api/password', requireAuth, async (req, res) => {
  try {
    const { current, next } = req.body || {};
    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ ok: false, error: 'Session expirée.' });

    if (!cabinet.password_hash || !verifyPassword(String(current || ''), cabinet.password_hash)) {
      return res.status(400).json({ ok: false, error: 'Le mot de passe actuel est incorrect.' });
    }
    if (String(next || '').length < 8) {
      return res.status(400).json({ ok: false, error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
    }

    await store.setPassword(cabinet.id, hashPassword(String(next)));
    return res.json({ ok: true });
  } catch (err) {
    console.error('[password] échec :', err.message);
    return res.status(500).json({ ok: false, error: 'Modification impossible pour le moment.' });
  }
});

/* Consommation du lien de réinitialisation. */
app.post('/api/password/reset', async (req, res) => {
  try {
    const { token, next } = req.body || {};
    const contenu = readResetToken(token);
    if (!contenu) {
      return res.status(400).json({ ok: false, error: 'Lien invalide ou expiré. Demandez-en un nouveau.' });
    }
    if (String(next || '').length < 8) {
      return res.status(400).json({ ok: false, error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
    }
    const cabinet = await billing.findByEmail(String(contenu.e || '').toLowerCase());
    if (!cabinet) {
      return res.status(400).json({ ok: false, error: 'Lien invalide ou expiré. Demandez-en un nouveau.' });
    }
    const empreinte = String(cabinet.password_hash || '').split('$').pop().slice(0, 16);
    const attendu = resetSignature(cabinet.email, Number(contenu.x), empreinte);
    const recu = String(token).split('.')[1] || '';
    const a = Buffer.from(attendu);
    const b = Buffer.from(recu);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ ok: false, error: 'Lien invalide ou expiré. Demandez-en un nouveau.' });
    }

    await store.setPassword(cabinet.id, hashPassword(String(next)));
    return res.json({ ok: true, redirect: '/app?login=1&mdp=change' });
  } catch (err) {
    console.error('[password] réinitialisation :', err.message);
    return res.status(500).json({ ok: false, error: 'Réinitialisation impossible pour le moment.' });
  }
});

/* Demande de réinitialisation, sans compte ni session. Enregistrée comme les
   demandes de contact : sans envoi d'email configuré, c'est la seule façon de
   ne pas perdre la demande. La réponse est toujours identique, pour ne pas
   révéler quelles adresses possèdent un compte. */
app.post('/api/password/reset-request', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 160);
  try {
    if (!throttle(req.ip || 'unknown')) {
      return res.status(429).json({ ok: false, error: 'Trop de demandes. Réessayez dans quelques minutes.' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Adresse email invalide.' });
    }
    await store.addLead({
      prenom: '', nom: '', email,
      structure: '', metier: '', volume: '',
      message: 'Demande de réinitialisation du mot de passe.',
      source: 'reset',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: req.ip || ''
    });

    /* Le lien n'est envoyé que si le compte existe. La réponse, elle, est
       toujours identique : elle ne doit pas révéler quelles adresses ont un
       compte. */
    const cabinet = await billing.findByEmail(email);
    if (cabinet) {
      const token = issueResetToken(cabinet);
      const lien = `${baseUrl(req)}/reset?token=${encodeURIComponent(token)}`;
      await mail.sendPasswordReset(cabinet, lien);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[password] demande de réinitialisation :', err.message);
    return res.status(500).json({ ok: false, error: 'Demande impossible pour le moment.' });
  }
});

/* ---------- console opérateur : transmettre un lien de réinitialisation ----------
   Tant que l'envoi d'email n'est pas configuré, un cabinet qui perd son mot de
   passe n'a aucun moyen de récupérer son accès. Cette route, réservée à
   l'opérateur et protégée par OPERATEUR_CLE, liste les demandes récentes et
   permet de régénérer un lien à transmettre soi-même par WhatsApp.
   Sans OPERATEUR_CLE définie, la route n'existe pas. */
function cleOperateurValide(cle) {
  const attendu = process.env.OPERATEUR_CLE || '';
  if (!attendu) return false;
  const a = Buffer.from(String(attendu), 'utf8');
  const b = Buffer.from(String(cle || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function lienDepuisCorps(corps) {
  const trouve = String(corps || '').match(/https?:\/\/[^\s]+\/reset\?token=[^\s]+/);
  return trouve ? trouve[0] : '';
}

/* L'expiration est portée par le jeton lui-même : on la relit au lieu de la
   déduire de la date d'envoi, pour ne jamais annoncer un lien encore valable. */
function expirationDuLien(lien) {
  if (!lien) return 0;
  const brut = String(lien).split('token=').pop();
  let charge = '';
  try { charge = decodeURIComponent(brut).split('.')[0]; } catch (_) { return 0; }
  try {
    const contenu = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    return Number(contenu.x) || 0;
  } catch (_) { return 0; }
}

app.post('/api/operateur/liens', async (req, res) => {
  if (!process.env.OPERATEUR_CLE) {
    return res.status(404).json({ ok: false, error: 'Indisponible.' });
  }
  if (!cleOperateurValide((req.body || {}).cle)) {
    return res.status(403).json({ ok: false, error: 'Clé incorrecte.' });
  }
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const sortie = { ok: true, demandes: [] };

    const lignes = await store.listOutbox(80);
    sortie.demandes = lignes
      .filter((l) => String(l.subject || '').indexOf('Réinitialisation') === 0)
      .map((l) => {
        const lien = lienDepuisCorps(l.body);
        const exp = expirationDuLien(lien);
        return {
          email: l.recipient,
          quand: l.created_at,
          lien,
          expire_le: exp ? new Date(exp).toISOString() : '',
          valide: exp > Date.now()
        };
      })
      .slice(0, 10);

    if (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ ok: false, error: 'Adresse email invalide.' });
      }
      const cabinet = await billing.findByEmail(email);
      if (!cabinet) {
        return res.status(404).json({ ok: false, error: 'Aucun compte avec cette adresse.' });
      }
      const token = issueResetToken(cabinet);
      sortie.nouveau = {
        email: cabinet.email,
        cabinet: cabinet.name || '',
        lien: baseUrl(req) + '/reset?token=' + encodeURIComponent(token),
        expire_le: new Date(Date.now() + RESET_TTL).toISOString()
      };
    }

    return res.json(sortie);
  } catch (err) {
    console.error('[operateur] liens :', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur côté serveur.' });
  }
});

/* Demande de contact publique.
   Auparavant, le formulaire ouvrait la messagerie du visiteur : sur mobile, où
   la plupart des prospects lisent, il n'y a souvent aucune application mail
   configurée. La demande disparaissait sans laisser de trace. Elle est
   désormais enregistrée en base, puis un email part si l'envoi est configuré. */
app.post('/api/contact', async (req, res) => {
  const b = req.body || {};
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  try {
    const ip = req.ip || 'unknown';
    if (!throttle(ip)) {
      return res.status(429).json({ ok: false, error: 'Trop de demandes envoyées. Réessayez dans quelques minutes.' });
    }

    const lead = {
      prenom: clean(b.prenom, 80),
      nom: clean(b.nom, 80),
      email: clean(b.email, 160).toLowerCase(),
      structure: clean(b.structure, 160),
      metier: clean(b.metier, 60),
      volume: clean(b.volume, 60),
      message: clean(b.message, 4000),
      source: 'contact',
      userAgent: clean(req.headers['user-agent'], 300),
      ip
    };

    if (!lead.prenom || !lead.nom) {
      return res.status(400).json({ ok: false, error: 'Indiquez votre prénom et votre nom.' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) {
      return res.status(400).json({ ok: false, error: 'Adresse email invalide.' });
    }

    /* Deux filets successifs : la table dédiée, puis le journal d'envoi qui
       existe déjà. Une demande ne doit jamais repartir sans trace, même si
       la migration `leads.sql` n'a pas encore été exécutée. */
    let saved = null;
    let filed = false;
    try {
      saved = await store.addLead(lead);
      filed = true;
    } catch (err) {
      console.error('[contact] table leads indisponible :', err.message);
    }

    const to = process.env.CONTACT_TO || 'samuelesso846@gmail.com';
    const lines = [
      'Nouvelle demande depuis le site Aura Collect.',
      '',
      'Nom : ' + lead.prenom + ' ' + lead.nom,
      'Email : ' + lead.email,
      'Structure : ' + (lead.structure || '—'),
      'Métier : ' + (lead.metier || '—'),
      'Dossiers par mois : ' + (lead.volume || '—'),
      '',
      'Pièces demandées aujourd’hui :',
      lead.message || '—',
      '',
      'Reçue le ' + new Date().toISOString() + (saved ? ' (id ' + saved.id + ')' : '')
    ];
    try {
      await mail.send({
        to,
        subject: 'Demande Aura Collect — ' + lead.prenom + ' ' + lead.nom +
                 (lead.structure ? ' (' + lead.structure + ')' : ''),
        text: lines.join('\n')
      });
      filed = true;
    } catch (err) {
      console.error('[contact] email non envoyé :', err.message);
    }

    if (!filed) {
      return res.status(500).json({
        ok: false,
        error: 'Enregistrement impossible pour le moment. Écrivez-nous directement à ' + to + '.'
      });
    }

    return res.json({ ok: true, id: saved ? saved.id : null });
  } catch (err) {
    console.error('[contact] enregistrement impossible :', err.message);
    return res.status(500).json({
      ok: false,
      error: 'Enregistrement impossible pour le moment. Écrivez-nous directement à samuelesso846@gmail.com.'
    });
  }
});

/* Création de compte public : le cabinet choisit son offre, paie, puis son espace s'ouvre.
   Aucun accès n'est accordé avant la confirmation du paiement par FedaPay. */
app.post('/api/signup', async (req, res, next) => {
  // Création d'un espace en essai : aucun paiement demandé, aucune carte.
  // Le cabinet travaille 7 jours, puis s'abonne depuis son espace s'il est convaincu.
  const isForm = Boolean(req.is('application/x-www-form-urlencoded'));
  const planWanted = String((req.body && req.body.plan) || 'starter').toLowerCase();
  const fail = (code, message, status) => {
    if (isForm) return res.redirect(303, `/commander.html?erreur=${code}&plan=${encodeURIComponent(planWanted)}`);
    return res.status(status || 400).json({ error: message });
  };

  try {
    const ip = req.ip || 'unknown';
    if (!throttle(ip)) return fail('trop', 'Trop de tentatives. Réessayez dans quelques minutes.', 429);

    const name = String(req.body.name || req.body.nom || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const planId = planWanted;

    if (name.length < 2) return fail('nom', 'Indiquez le nom de votre cabinet.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('email', 'Adresse email invalide.');
    if (password.length < 8) return fail('mdp', 'Mot de passe : 8 caractères minimum.');
    if (!plans.get(planId)) return fail('offre', 'Offre invalide.');

    if (await billing.findByEmail(email)) {
      return fail('existe', 'Un compte existe déjà avec cette adresse. Connectez-vous depuis l’espace cabinet.', 409);
    }

    const passwordHash = hashPassword(password);
    const cabinet = await billing.createAccount({
      name, email, plan: planId, passwordHash
    });

    /* Le cabinet naît avec son propriétaire : sans cette ligne, le premier
       compte n'apparaîtrait pas dans l'équipe et le journal n'aurait pas
       d'auteur. Un échec ici ne doit pas annuler l'inscription. */
    let owner = null;
    try {
      owner = await store.inviteUser(cabinet.id, {
        name, email, role: 'owner', invitedBy: null, token: null, expiresAt: null
      });
      if (owner) owner = await store.activateUser(owner.id, { name, passwordHash });
    } catch (err) {
      console.error('[signup] proprietaire:', err.message);
    }

    // Connecté immédiatement : on ne fait pas ressaisir ce qui vient d'être saisi.
    setSessionCookie(res, issueSession(cabinet.id, owner ? owner.id : null));

    if (isForm) return res.redirect(303, '/app?bienvenue=1');
    res.json({ ok: true, trialDays: billing.TRIAL_DAYS, redirect: '/app?bienvenue=1' });
  } catch (err) {
    console.error('[signup]', err.message);
    /* L'index unique `cabinets_email_unique` tranche en dernier ressort. Sans ce
       test, deux inscriptions simultanées avec la même adresse produiraient une
       « erreur technique » alors que la bonne réponse est « compte déjà créé ». */
    if (err.code === 'EMAIL_EXISTE' ||
        (err.code === '23505' && /email/i.test(String(err.constraint || '') + ' ' + String(err.detail || '')))) {
      return fail('existe', 'Un compte existe déjà avec cette adresse. Connectez-vous depuis l’espace cabinet.', 409);
    }
    if (isForm) return res.redirect(303, `/commander.html?erreur=technique&plan=${encodeURIComponent(planWanted)}`);
    next(err);
  }
});

app.get('/api/billing', requireAuth, async (req, res, next) => {
  try {
    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ error: 'Session invalide.' });
    res.json({
      cabinet: { id: cabinet.id, name: cabinet.name, email: cabinet.email },
      access: billing.accessOf(cabinet),
      payments: await billing.recentPayments(cabinet.id)
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/billing/checkout', requireAuth, async (req, res, next) => {
  try {
    if (!fedapay.configured()) return res.status(503).json({ error: 'Le paiement n’est pas encore configuré.' });

    const planId = String(req.body.plan || '').toLowerCase();
    const months = Number(req.body.months || 1);
    const amount = plans.amountFor(planId, months);
    if (!amount) return res.status(400).json({ error: 'Offre ou durée invalide.' });

    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ error: 'Session invalide.' });
    const email = cabinet.email || process.env.CABINET_EMAIL || '';
    if (!email) return res.status(400).json({ error: 'Renseignez l’email de facturation du cabinet avant de souscrire.' });

    const payment = await billing.createPayment({ cabinetId: cabinet.id, plan: planId, months, amount });
    const base = baseUrl(req);

    const checkout = await fedapay.createCheckout({
      amount,
      description: `Aura Collect — ${plans.get(planId).label}, ${months} mois`,
      customer: {
        email,
        firstname: (cabinet.name || 'Cabinet').slice(0, 40),
        lastname: 'Aura Collect'
      },
      callbackUrl: `${base}/api/billing/callback?p=${payment.id}`,
      metadata: { payment_id: payment.id, cabinet_id: cabinet.id, plan: planId, months }
    });

    await billing.attachCheckout(payment.id, checkout);
    res.json({ url: checkout.url, reference: checkout.reference, amount, currency: 'XOF', months, plan: planId });
  } catch (err) {
    next(err);
  }
});

/* Retour navigateur après paiement : ne fait jamais foi seul, mais rattrape un webhook manqué. */
app.get('/api/billing/callback', async (req, res) => {
  try {
    const transactionId = req.query.id || req.query.transaction_id;
    if (transactionId && fedapay.configured()) {
      const tx = await fedapay.getTransaction(transactionId);
      if (tx && tx.status === 'approved') {
        const payment = await billing.approveOnce(tx.id, tx);
        if (payment) {
          await billing.grantPeriod(payment.cabinet_id, payment.months, payment.plan);
          console.log(`[billing] accès prolongé via retour navigateur (transaction ${tx.id})`);
        }
      }
    }
  } catch (err) {
    console.error('[billing] retour paiement :', err.message);
  }
  res.redirect('/app?billing=retour');
});

/* ---------- dossiers (cabinet) ---------- */
app.get('/api/templates', requireAuth, (req, res) => {
  res.json({
    templates: store.TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      family: t.family,
      defaults: t.defaults,
      catalog: t.catalog,
      // compatibilite : "pieces" reste la selection par defaut
      pieces: t.catalog.filter((p) => t.defaults.indexOf(p.key) !== -1)
    }))
  });
});

app.get('/api/dossiers', requireAuth, async (req, res, next) => {
  try {
    const cabinet = await billing.findById(req.cabinetId);
    const base = baseFor(cabinet, req);
    const dossiers = (await store.listDossiers(req.cabinetId)).map((d) => cabinetDossier(d, base));
    res.json({ dossiers, cabinet: await cabinetNameOf(req.cabinetId) });
  } catch (err) { next(err); }
});

app.post('/api/dossiers', requireAuth, async (req, res, next) => {
  try {
    const { client, email, phone, template, recipient, clientId, pieces } = req.body || {};
    if (!clientId && (!client || String(client).trim().length < 2)) {
      return res.status(400).json({ error: 'Nom du client requis.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''))) return res.status(400).json({ error: 'Email invalide.' });
    if (!store.templateById(template)) return res.status(400).json({ error: 'Modèle inconnu.' });

    // Quota de l'offre : un cabinet ne peut pas dépasser ce qu'il paie.
    const cabinet = await billing.findById(req.cabinetId);
    if (!cabinet) return res.status(401).json({ error: 'Session invalide.' });
    const access = billing.accessOf(cabinet);
    if (access.state === 'suspended') {
      return res.status(402).json({ error: 'Abonnement inactif. Régularisez votre abonnement pour créer de nouveaux dossiers.', access });
    }
    const used = await store.countDossiers(req.cabinetId);
    if (used >= access.limits.dossiers) {
      return res.status(402).json({
        error: `Limite de ${access.limits.dossiers} dossiers atteinte pour l'offre ${access.plan}. Passez à une offre supérieure pour continuer.`,
        access, used
      });
    }

    // Le dossier est toujours rattaché à une fiche client : existante ou créée ici.
    let clientRow = clientId ? await store.getClient(clientId, req.cabinetId) : null;
    if (!clientRow) clientRow = await store.ensureClient(req.cabinetId, { name: client, email, phone });

    const dossier = store.createDossier({
      client: clientRow.name, email: clientRow.email || email, template, recipient,
      clientId: clientRow.id, pieces
    });
    dossier.cabinetId = req.cabinetId;
    await store.insertDossier(dossier);

    const auteur = await actorOf(req);
    await trace({
      cabinetId: req.cabinetId, dossierId: dossier.id, action: 'creation',
      reason: `${dossier.pieces.length} pièces demandées — modèle ${store.templateById(template).name}`,
      actorKind: auteur.kind, actorEmail: auteur.email, actorName: auteur.name
    });

    const base = baseFor(cabinet, req);
    const entry = await mail.sendMagicLink(dossier, base, cabinet.name);

    res.status(201).json({
      dossier: cabinetDossier(dossier, base),
      mail: { mode: entry.mode, status: entry.status }
    });
  } catch (err) { next(err); }
});

app.post('/api/dossiers/:id/remind', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    const missing = dossier.pieces.filter((p) => !['ok', 'review', 'valide'].includes(p.status)).length;
    if (!missing) return res.status(400).json({ error: 'Le dossier est déjà complet.' });
    const cabinet = await billing.findById(req.cabinetId);
    const entry = await mail.sendReminder(dossier, missing, baseUrl(req), cabinet ? cabinet.name : '');
    res.json({ ok: true, mail: { mode: entry.mode, status: entry.status }, missing });
  } catch (err) { next(err); }
});

/* Journal complet d'un dossier : lecture seule, jamais modifiable. */
app.get('/api/dossiers/:id/journal', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    const events = await store.listDecisions(dossier.id, req.cabinetId);
    res.json({ dossier: dossier.id, client: dossier.client, events });
  } catch (err) { next(err); }
});

app.get('/api/dossiers/:id/export', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    const decisions = await store.listDecisions(dossier.id, req.cabinetId);
    await archive.buildZip(res, dossier, store.templateById(dossier.template).name, decisions);
  } catch (err) { next(err); }
});

app.post('/api/dossiers/:id/seal', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    if (dossier.sealHash) return res.status(409).json({ error: 'Ce dossier est déjà scellé.' });

    const blocking = dossier.pieces.filter((p) => !['ok', 'valide'].includes(p.status));
    if (blocking.length) {
      return res.status(409).json({
        error: blocking.length + ' obstacle' + (blocking.length > 1 ? 's' : '') + ' empêche' + (blocking.length > 1 ? 'nt' : '') + ' le scellement.',
        obstacles: blocking.map((p) => ({ key: p.key, label: p.label, status: p.status, reason: p.reason || '' }))
      });
    }

    const manifest = await seal.buildManifest(dossier, await cabinetNameOf(dossier.cabinetId));
    const hash = seal.hashManifest(manifest);
    await store.sealDossier(dossier.id, hash, manifest.sealedAt, manifest);

    const auteur = await actorOf(req);
    await trace({
      cabinetId: req.cabinetId, dossierId: dossier.id,
      action: 'scellement', status: 'scelle',
      reason: 'Empreinte SHA-256 ' + hash.slice(0, 16) + '… sur ' + dossier.pieces.length + ' pièces',
      actorKind: auteur.kind, actorEmail: auteur.email, actorName: auteur.name
    });
    res.json({ hash, sealedAt: manifest.sealedAt });
  } catch (err) { next(err); }
});

app.get('/api/dossiers/:id/certificate', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier || !dossier.sealHash || !dossier.sealManifest) {
      return res.status(404).json({ error: 'Dossier non scellé.' });
    }
    const pdf = await seal.certificatePdf(dossier.sealManifest, dossier.sealHash);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificat_${store.slug(dossier.client)}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

app.get('/api/dossiers/:id/integrity', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier || !dossier.sealHash || !dossier.sealManifest) {
      return res.status(404).json({ error: 'Dossier non scellé.' });
    }
    /* Le nom du cabinet fait partie de l'empreinte : on recalcule avec celui qui
       a été scellé, et non avec le nom actuel. Sans cela, renommer un cabinet
       ferait apparaître une fausse altération sur tous ses dossiers scellés. */
    const sealedCabinet = dossier.sealManifest.cabinet || await cabinetNameOf(dossier.cabinetId);
    const manifest = await seal.buildManifest(dossier, sealedCabinet, dossier.sealManifest.sealedAt);
    const computed = seal.hashManifest(manifest);
    const ok = computed === dossier.sealHash;
    const changed = [];
    if (!ok) {
      manifest.pieces.forEach((p, i) => {
        const old = (dossier.sealManifest.pieces || [])[i] || {};
        if (p.sha256 !== old.sha256) changed.push(p.label);
      });
    }
    /* `manifestIntact` : le manifeste archivé, pris tel quel, redonne-t-il
       l'empreinte publiée ? C'est la vérification qu'un tiers peut refaire
       seul, sans nos fichiers. `ok` reste le contrôle fort (octets relus). */
    const manifestIntact = seal.hashManifest(dossier.sealManifest) === dossier.sealHash;
    res.json({ ok, manifestIntact, stored: dossier.sealHash, computed, sealedAt: dossier.sealedAt, changed });
  } catch (err) { next(err); }
});

app.get('/api/files/:id/:key', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id, req.cabinetId);
    if (!dossier) return res.status(404).end();
    const file = await store.readFile(req.params.id, req.params.key);
    if (!file) return res.status(404).end();
    res.setHeader('Content-Type', file.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name || 'piece')}"`);
    res.send(file.content);
  } catch (err) { next(err); }
});

/* ---------- portail client (public) ---------- */
app.get('/api/portal/:token', async (req, res, next) => {
  try {
    const dossier = await store.getByToken(req.params.token);
    if (!dossier) return res.status(404).json({ error: 'Lien invalide ou expiré.' });
    if (linkExpired(dossier)) {
      return res.status(410).json({ error: `Ce lien a expiré après ${LINK_DAYS} jours. Demandez-en un nouveau à votre cabinet.` });
    }
    res.json({ cabinet: await cabinetNameOf(dossier.cabinetId), dossier: publicDossier(dossier), ai: ai.configured() });
  } catch (err) { next(err); }
});

app.post('/api/portal/:token/pieces/:key', upload.single('file'), async (req, res, next) => {
  try {
    const dossier = await store.getByToken(req.params.token);
    if (!dossier) return res.status(404).json({ error: 'Lien invalide.' });
    if (linkExpired(dossier)) {
      return res.status(410).json({ error: `Ce lien a expiré après ${LINK_DAYS} jours. Demandez-en un nouveau à votre cabinet.` });
    }
    if (dossier.sealHash) {
      return res.status(409).json({ error: 'Ce dossier a été scellé : il n\'accepte plus de nouvelle pièce.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

    const piece = dossier.pieces.find((p) => p.key === req.params.key);
    if (!piece) return res.status(404).json({ error: 'Pièce inconnue.' });

    const ext = req.file.mimetype === 'application/pdf' ? '.pdf'
      : req.file.mimetype === 'image/png' ? '.png'
        : req.file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    const stored = store.token(16) + ext;

    await store.saveFile(dossier.id, piece.key, {
      name: req.file.originalname,
      mime: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer
    });

    // Une panne du modèle ne doit pas faire échouer le dépôt : la pièce est déjà
    // enregistrée, le cabinet la contrôlera lui-même.
    let verdict;
    try {
      verdict = await ai.validate(req.file, piece, store.templateById(dossier.template).name);
    } catch (err) {
      console.error('[ai] vérification impossible :', err.message);
      verdict = {
        status: 'review',
        reason: 'Vérification automatique indisponible : le cabinet contrôlera cette pièce manuellement.',
        provider: 'indisponible'
      };
    }

    await store.updatePiece(dossier.id, piece.key, {
      status: verdict.status,
      reason: verdict.reason || '',
      stored,
      filename: req.file.originalname,
      mime: req.file.mimetype,
      size: req.file.size,
      typeDetecte: verdict.typeDetecte || '',
      dateDocument: verdict.dateDocument || '',
      confidence: verdict.confidence,
      provider: verdict.provider || '',
      at: new Date().toISOString()
    });

    /* Deux traces distinctes : le dépôt (le client) et le verdict (la machine).
       C'est la distinction qui compte en cas de contrôle. */
    await trace({
      cabinetId: dossier.cabinetId, dossierId: dossier.id,
      pieceKey: piece.key, pieceLabel: piece.label,
      action: 'depot', status: 'depose',
      reason: 'Fichier « ' + req.file.originalname + ' » reçu (' + Math.round(req.file.size / 1024) + ' Ko)',
      actorKind: 'client', actorEmail: dossier.email
    });
    await trace({
      cabinetId: dossier.cabinetId, dossierId: dossier.id,
      pieceKey: piece.key, pieceLabel: piece.label,
      action: 'verdict_ia', status: verdict.status, reason: verdict.reason || '',
      actorKind: 'ia', provider: verdict.provider || '', confidence: verdict.confidence
    });

    const fresh = await store.getDossierById(dossier.id) || dossier;
    notifyCabinet(fresh, baseUrl(req));
    res.json({
      piece: { key: piece.key, status: verdict.status, reason: verdict.reason, dateDocument: verdict.dateDocument },
      dossier: publicDossier(fresh)
    });
  } catch (err) {
    if (err && err.message === 'FORMAT') {
      return res.status(415).json({ error: 'Format non accepté : JPEG, PNG, WEBP ou PDF.' });
    }
    next(err);
  }
});

/* ---------- pages ---------- */
app.get('/p/:token', (req, res) => res.sendFile(path.join(ROOT, 'p.html')));
/* « Se connecter » doit toujours montrer le formulaire, y compris lorsqu'une
   session est déjà ouverte — sinon on entre dans l'espace du compte précédent
   sans l'avoir demandé. La session est fermée ici, côté serveur, pour que le
   comportement ne dépende pas du script chargé ni d'un cache navigateur. */
app.get('/app', (req, res) => {
  if (req.query.login === '1') {
    res.clearCookie('aura_session', { path: '/', httpOnly: true, sameSite: 'lax' });
  }
  res.sendFile(path.join(ROOT, 'app.html'));
});

app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route inconnue.' });
  res.status(404).sendFile(path.join(ROOT, 'index.html'));
});

/* eslint-disable no-unused-vars */
app.use((err, req, res, next) => {
  console.error('[aura]', err && err.stack ? err.stack : err);
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Fichier trop volumineux (${MAX_MB} Mo maximum).` });
  }
  /* Le refus de format vient du filtre de multer, donc avant le gestionnaire de
     route : sans ce test, un .txt renvoyait « Erreur serveur » (500) au lieu
     d'expliquer ce qui est accepté. */
  if (err && err.message === 'FORMAT') {
    return res.status(415).json({ error: 'Format non accepté : JPEG, PNG, WEBP ou PDF.' });
  }
  res.status(500).json({ error: 'Erreur serveur.' });
});

app.listen(PORT, () => {
  console.log(`Aura Collect — http://localhost:${PORT}`);
  console.log(`  cabinet : ${CABINET}`);
  console.log(`  base    : ${process.env.DATABASE_URL ? 'Supabase Postgres' : 'NON CONFIGURÉE'}`);
  console.log(`  IA      : ${ai.configured() ? 'Groq / ' + ai.status().model : 'non configurée'}`);
  console.log(`  email   : ${mail.mode() === 'resend' ? 'Resend' : 'journal local (outbox)'}`);
  console.log(`  paiement: ${fedapay.configured() ? 'FedaPay ' + fedapay.ENV : 'non configuré'}`);

  if (storage.enabled()) {
    storage.ensureBucket()
      .then(() => console.log(`  stockage: Supabase Storage / ${storage.BUCKET}`))
      .catch((err) => console.warn('[aura] stockage indisponible, repli en base :', err.message));
  } else {
    console.log('  stockage: base de données (SUPABASE_URL non configurée)');
  }

  billing.ensureCabinet()
    .then((cabinet) => {
      const access = billing.accessOf(cabinet);
      console.log(`  cabinet : ${cabinet.name} — ${access.state} (${access.daysLeft} j)`);
    })
    .catch((err) => {
      console.warn('[aura] facturation indisponible — exécutez server/sql/setup.sql :', err.message);
    });
});
