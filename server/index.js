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
app.use(express.json({ limit: '200kb' }));

/* ---------- session ---------- */
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function issueSession() {
  const exp = Date.now() + 12 * 3600 * 1000;
  const payload = String(exp);
  return payload + '.' + sign(payload);
}

function readSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)aura_session=([^;]+)/);
  if (!match) return false;
  const [payload, sig] = decodeURIComponent(match[1]).split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

function requireAuth(req, res, next) {
  if (!readSession(req)) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

function setSessionCookie(res, value) {
  res.setHeader('Set-Cookie',
    `aura_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}

/* ---------- limitation des tentatives ---------- */
const attempts = new Map();
function throttle(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, until: 0 };
  if (rec.until > now) return false;
  rec.count += 1;
  if (rec.count > 8) { rec.count = 0; rec.until = now + 5 * 60 * 1000; }
  attempts.set(ip, rec);
  return rec.until <= now;
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

function linkExpired(dossier) {
  return Date.now() - new Date(dossier.createdAt).getTime() > LINK_DAYS * 864e5;
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
    email: d.email,
    template: d.template,
    templateName: store.templateById(d.template).name,
    token: d.token,
    link: (base || DEFAULT_BASE) + '/p/' + d.token,
    createdAt: d.createdAt,
    lastActivity: d.lastActivity,
    status: store.statusOf(d),
    progress: store.progressOf(d),
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
      at: p.at || ''
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
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!throttle(ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });

  const given = String((req.body && req.body.password) || '');
  const a = Buffer.from(given);
  const b = Buffer.from(PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect.' });

  setSessionCookie(res, issueSession());
  res.json({ ok: true, cabinet: CABINET });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'aura_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  let db = false;
  try { db = await store.healthy(); } catch (err) { console.error('[db] health:', err.message); }
  res.json({
    authenticated: readSession(req),
    cabinet: CABINET,
    ai: ai.status(),
    mail: mail.mode(),
    db: db ? 'supabase' : 'down',
    trial: !process.env.CABINET_PASSWORD
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

/* ---------- dossiers (cabinet) ---------- */
app.get('/api/templates', requireAuth, (req, res) => {
  res.json({ templates: store.TEMPLATES });
});

app.get('/api/dossiers', requireAuth, async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const dossiers = (await store.listDossiers()).map((d) => cabinetDossier(d, base));
    res.json({ dossiers, cabinet: CABINET });
  } catch (err) { next(err); }
});

app.post('/api/dossiers', requireAuth, async (req, res, next) => {
  try {
    const { client, email, template } = req.body || {};
    if (!client || String(client).trim().length < 2) return res.status(400).json({ error: 'Nom du client requis.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''))) return res.status(400).json({ error: 'Email invalide.' });
    if (!store.templateById(template)) return res.status(400).json({ error: 'Modèle inconnu.' });

    const dossier = store.createDossier({ client, email, template });
    await store.insertDossier(dossier);
    const base = baseUrl(req);
    const entry = await mail.sendMagicLink(dossier, base);

    res.status(201).json({
      dossier: cabinetDossier(dossier, base),
      mail: { mode: entry.mode, status: entry.status }
    });
  } catch (err) { next(err); }
});

app.post('/api/dossiers/:id/remind', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    const missing = dossier.pieces.filter((p) => p.status !== 'ok').length;
    if (!missing) return res.status(400).json({ error: 'Le dossier est déjà complet.' });
    const entry = await mail.sendReminder(dossier, missing, baseUrl(req));
    res.json({ ok: true, mail: { mode: entry.mode, status: entry.status }, missing });
  } catch (err) { next(err); }
});

app.get('/api/dossiers/:id/export', requireAuth, async (req, res, next) => {
  try {
    const dossier = await store.getDossier(req.params.id);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    await archive.buildZip(res, dossier, store.templateById(dossier.template).name);
  } catch (err) { next(err); }
});

app.get('/api/files/:id/:key', requireAuth, async (req, res, next) => {
  try {
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
    res.json({ cabinet: CABINET, dossier: publicDossier(dossier), ai: ai.configured() });
  } catch (err) { next(err); }
});

app.post('/api/portal/:token/pieces/:key', upload.single('file'), async (req, res, next) => {
  try {
    const dossier = await store.getByToken(req.params.token);
    if (!dossier) return res.status(404).json({ error: 'Lien invalide.' });
    if (linkExpired(dossier)) {
      return res.status(410).json({ error: `Ce lien a expiré après ${LINK_DAYS} jours. Demandez-en un nouveau à votre cabinet.` });
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

    const verdict = await ai.validate(req.file, piece, store.templateById(dossier.template).name);

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

    const fresh = await store.getDossier(dossier.id);
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
app.get('/app', (req, res) => res.sendFile(path.join(ROOT, 'app.html')));

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
  res.status(500).json({ error: 'Erreur serveur.' });
});

app.listen(PORT, () => {
  console.log(`Aura Collect — http://localhost:${PORT}`);
  console.log(`  cabinet : ${CABINET}`);
  console.log(`  base    : ${process.env.DATABASE_URL ? 'Supabase Postgres' : 'NON CONFIGURÉE'}`);
  console.log(`  IA      : ${ai.configured() ? 'Groq / ' + ai.status().model : 'non configurée'}`);
  console.log(`  email   : ${mail.mode() === 'resend' ? 'Resend' : 'journal local (outbox)'}`);
});
