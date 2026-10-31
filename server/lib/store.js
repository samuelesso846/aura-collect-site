'use strict';
/* Persistance JSON simple et atomique. Suffisant pour un cabinet,
   remplaçable par Postgres sans toucher aux routes. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const TEMPLATES = [
  {
    id: 'bilan', name: 'Bilan annuel', family: 'Expert-comptable',
    pieces: [
      { key: 'avis-imposition', label: "Avis d'imposition 2025", rule: 'émis il y a moins de 12 mois' },
      { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
      { key: 'releves-bancaires', label: '3 derniers relevés bancaires', rule: 'moins de 3 mois' },
      { key: 'justif-domicile', label: 'Justificatif de domicile', rule: 'moins de 3 mois' },
      { key: 'liasse-fiscale', label: 'Liasse fiscale N-1', rule: 'signée' }
    ]
  },
  {
    id: 'tva', name: 'Déclarations de TVA', family: 'Expert-comptable',
    pieces: [
      { key: 'declarations-tva', label: 'Déclarations de TVA 2025', rule: 'les 4 trimestres' },
      { key: 'releves-bancaires', label: 'Relevés bancaires professionnels', rule: 'moins de 3 mois' },
      { key: 'justif-activite', label: "Justificatif d'activité", rule: 'moins de 12 mois' },
      { key: 'piece-identite', label: "Pièce d'identité du gérant", rule: 'en cours de validité' }
    ]
  },
  {
    id: 'creation', name: 'Création de société', family: 'Expert-comptable',
    pieces: [
      { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
      { key: 'justif-domicile', label: 'Justificatif de domicile', rule: 'moins de 3 mois' },
      { key: 'depot-capital', label: 'Attestation de dépôt du capital', rule: 'originale' },
      { key: 'statuts', label: 'Statuts signés', rule: 'toutes les pages' },
      { key: 'rib', label: 'RIB professionnel', rule: 'au nom de la société' }
    ]
  },
  {
    id: 'credit', name: 'Crédit immobilier', family: 'Courtier',
    pieces: [
      { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
      { key: 'justif-domicile', label: 'Justificatif de domicile', rule: 'moins de 3 mois' },
      { key: 'bulletins-salaire', label: '3 derniers bulletins de salaire', rule: 'moins de 3 mois' },
      { key: 'avis-imposition', label: "2 derniers avis d'imposition", rule: 'N-1 et N-2' },
      { key: 'releves-bancaires', label: '3 derniers relevés bancaires', rule: 'toutes les pages' },
      { key: 'contrat-travail', label: 'Contrat de travail', rule: 'signé' }
    ]
  },
  {
    id: 'locataire', name: 'Dossier locataire', family: 'Immobilier',
    pieces: [
      { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
      { key: 'justif-domicile', label: 'Justificatif de domicile', rule: 'moins de 3 mois' },
      { key: 'bulletins-salaire', label: '3 derniers bulletins de salaire', rule: 'moins de 3 mois' },
      { key: 'contrat-travail', label: 'Contrat de travail', rule: 'signé' },
      { key: 'avis-imposition', label: "Avis d'imposition", rule: 'année N-1' }
    ]
  },
  {
    id: 'onboarding', name: 'Onboarding salarié', family: 'RH & freelance',
    pieces: [
      { key: 'piece-identite', label: "Pièce d'identité", rule: 'en cours de validité' },
      { key: 'rib', label: 'RIB', rule: 'au nom du salarié' },
      { key: 'carte-vitale', label: 'Carte vitale', rule: 'lisible' },
      { key: 'contrat', label: 'Contrat de travail signé', rule: 'toutes les pages' }
    ]
  },
  {
    id: 'surmesure', name: 'Dossier sur-mesure', family: 'Personnalisé',
    pieces: [
      { key: 'piece-1', label: 'Première pièce', rule: 'selon vos règles' },
      { key: 'piece-2', label: 'Deuxième pièce', rule: 'selon vos règles' },
      { key: 'piece-3', label: 'Troisième pièce', rule: 'selon vos règles' }
    ]
  }
];

function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function blankDb() {
  return { dossiers: [], outbox: [], createdAt: new Date().toISOString() };
}

function read() {
  ensureDirs();
  if (!fs.existsSync(DB_PATH)) return blankDb();
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!Array.isArray(parsed.dossiers)) return blankDb();
    if (!Array.isArray(parsed.outbox)) parsed.outbox = [];
    return parsed;
  } catch (err) {
    console.error('[store] base illisible, sauvegarde de côté :', err.message);
    try { fs.renameSync(DB_PATH, DB_PATH + '.corrupt-' + Date.now()); } catch (_) {}
    return blankDb();
  }
}

function write(db) {
  ensureDirs();
  const tmp = DB_PATH + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

/* file d'attente : une mutation à la fois, pas d'écriture concurrente */
let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(() => {
    const db = read();
    const result = fn(db);
    write(db);
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

function token(size = 20) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function slug(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function statusOf(dossier) {
  const ok = dossier.pieces.filter((p) => p.status === 'ok').length;
  if (ok === dossier.pieces.length) return 'complet';
  if (ok === 0 && dossier.pieces.every((p) => p.status === 'wait')) return 'attente';
  return 'incomplet';
}

function progressOf(dossier) {
  const ok = dossier.pieces.filter((p) => p.status === 'ok').length;
  return {
    ok,
    total: dossier.pieces.length,
    pct: Math.round((ok / dossier.pieces.length) * 100)
  };
}

function createDossier({ client, email, template }) {
  const tpl = templateById(template);
  const now = new Date().toISOString();
  return {
    id: 'd_' + token(8),
    token: token(22),
    client: String(client).trim(),
    email: String(email).trim(),
    template: tpl.id,
    createdAt: now,
    lastActivity: now,
    pieces: tpl.pieces.map((p) => ({
      key: p.key,
      label: p.label,
      rule: p.rule,
      status: 'wait',
      filename: '',
      stored: '',
      mime: '',
      size: 0,
      reason: '',
      typeDetecte: '',
      dateDocument: '',
      confidence: null,
      provider: '',
      at: ''
    }))
  };
}

module.exports = {
  DATA_DIR, UPLOAD_DIR, TEMPLATES, templateById,
  read, write, mutate,
  token, slug, statusOf, progressOf, createDossier
};
