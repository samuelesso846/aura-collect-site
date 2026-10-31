'use strict';
/* Aura Collect — serveur de production (MVP mono-cabinet).
   Démarrage : node server/index.js   (voir .env.example) */
const path = require('path');
const fs = require('fs');
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
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MAX_MB = 15;

if (!process.env.CABINET_PASSWORD) {
  console.warn('[aura] CABINET_PASSWORD non défini : mot de passe de démonstration « aura-demo ».');
}
if (!process.env.SESSION_SECRET) {
  console.warn('[aura] SESSION_SECRET non défini : secret de développement utilisé.');
}

const app = express();
app.disable('x-powered-by');
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

/* ---------- limitation simple des tentatives de connexion ---------- */
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

/* ---------- vues publiques ---------- */
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

function cabinetDossier(d) {
  return {
    id: d.id,
    client: d.client,
    email: d.email,
    template: d.template,
    templateName: store.templateById(d.template).name,
    token: d.token,
    link: PUBLIC_BASE + '/p/' + d.token,
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

app.get('/api/me', (req, res) => {
  res.json({
    authenticated: readSession(req),
    cabinet: CABINET,
    ai: ai.status(),
    mail: mail.mode(),
    trial: !process.env.CABINET_PASSWORD
  });
});

app.get('/api/templates', requireAuth, (req, res) => {
  res.json({ templates: store.TEMPLATES });
});

/* ---------- dossiers (cabinet) ---------- */
app.get('/api/dossiers', requireAuth, (req, res) => {
  const db = store.read();
  const dossiers = db.dossiers
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(cabinetDossier);
  res.json({ dossiers, cabinet: CABINET });
});

app.post('/api/dossiers', requireAuth, async (req, res, next) => {
  try {
    const { client, email, template } = req.body || {};
    if (!client || String(client).trim().length < 2) return res.status(400).json({ error: 'Nom du client requis.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''))) return res.status(400).json({ error: 'Email invalide.' });
    if (!store.templateById(template)) return res.status(400).json({ error: 'Modèle inconnu.' });

    const dossier = store.createDossier({ client, email, template });
    await store.mutate((db) => { db.dossiers.unshift(dossier); });

    const entry = await mail.sendMagicLink(dossier);
    res.status(201).json({
      dossier: cabinetDossier(dossier),
      mail: { mode: entry.mode, status: entry.status }
    });
  } catch (err) { next(err); }
});

app.post('/api/dossiers/:id/remind', requireAuth, async (req, res, next) => {
  try {
    const db = store.read();
    const dossier = db.dossiers.find((d) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    const missing = dossier.pieces.filter((p) => p.status !== 'ok').length;
    if (!missing) return res.status(400).json({ error: 'Le dossier est déjà complet.' });
    const entry = await mail.sendReminder(dossier, missing);
    res.json({ ok: true, mail: { mode: entry.mode, status: entry.status }, missing });
  } catch (err) { next(err); }
});

app.get('/api/dossiers/:id/export', requireAuth, async (req, res, next) => {
  try {
    const db = store.read();
    const dossier = db.dossiers.find((d) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: 'Dossier introuvable.' });
    await archive.buildZip(res, dossier, store.templateById(dossier.template).name);
  } catch (err) { next(err); }
});

app.get('/api/files/:id/:key', requireAuth, (req, res) => {
  const db = store.read();
  const dossier = db.dossiers.find((d) => d.id === req.params.id);
  if (!dossier) return res.status(404).end();
  const piece = dossier.pieces.find((p) => p.key === req.params.key && p.stored);
  if (!piece) return res.status(404).end();
  const file = path.join(store.UPLOAD_DIR, dossier.id, piece.stored);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(piece.filename || 'piece')}"`);
  res.sendFile(file);
});

/* ---------- portail client (public) ---------- */
app.get('/api/portal/:token', (req, res) => {
  const db = store.read();
  const dossier = db.dossiers.find((d) => d.token === req.params.token);
  if (!dossier) return res.status(404).json({ error: 'Lien invalide ou expiré.' });
  res.json({ cabinet: CABINET, dossier: publicDossier(dossier), ai: ai.configured() });
});

app.post('/api/portal/:token/pieces/:key', upload.single('file'), async (req, res, next) => {
  try {
    const db = store.read();
    const dossier = db.dossiers.find((d) => d.token === req.params.token);
    if (!dossier) return res.status(404).json({ error: 'Lien invalide.' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

    const piece = dossier.pieces.find((p) => p.key === req.params.key);
    if (!piece) return res.status(404).json({ error: 'Pièce inconnue.' });

    const ext = req.file.mimetype === 'application/pdf' ? '.pdf'
      : req.file.mimetype === 'image/png' ? '.png'
        : req.file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    const stored = store.token(16) + ext;
    const dir = path.join(store.UPLOAD_DIR, dossier.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, stored), req.file.buffer);

    const verdict = await ai.validate(req.file, piece, store.templateById(dossier.template).name);

    await store.mutate((db2) => {
      const d = db2.dossiers.find((x) => x.id === dossier.id);
      const p = d.pieces.find((x) => x.key === piece.key);
      p.status = verdict.status;
      p.reason = verdict.reason || '';
      p.stored = stored;
      p.filename = req.file.originalname;
      p.mime = req.file.mimetype;
      p.size = req.file.size;
      p.typeDetecte = verdict.typeDetecte || '';
      p.dateDocument = verdict.dateDocument || '';
      p.confidence = verdict.confidence;
      p.provider = verdict.provider || '';
      p.at = new Date().toISOString();
      d.lastActivity = new Date().toISOString();
    });

    const fresh = store.read().dossiers.find((d) => d.id === dossier.id);
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

/* fichiers privés jamais servis en statique */
app.use(['/data', '/server', '/node_modules'], (req, res) => res.status(404).end());

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
  console.log(`  IA      : ${ai.configured() ? 'Groq / ' + ai.status().model : 'non configurée (statut « à vérifier »)'}`);
  console.log(`  email   : ${mail.mode() === 'resend' ? 'Resend' : 'journal local (outbox)'}`);
});
