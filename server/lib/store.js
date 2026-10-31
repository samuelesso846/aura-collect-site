'use strict';
/* Accès aux données : PostgreSQL (Supabase), schéma `aura`.
   Les pièces vivent dans Supabase Storage (compartiment privé) ; la base ne garde
   que les métadonnées. Repli sur aura.files (bytea) si le stockage n'est pas configuré. */
const crypto = require('crypto');
const storage = require('./storage');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PG_NO_SSL === '1' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => console.error('[db] erreur de pool :', err.message));

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
  return { ok, total: dossier.pieces.length, pct: Math.round((ok / dossier.pieces.length) * 100) };
}

function createDossier({ client, email, template, recipient }) {
  const tpl = templateById(template);
  const now = new Date().toISOString();
  return {
    id: 'd_' + token(8),
    token: token(22),
    client: String(client).trim(),
    email: String(email).trim(),
    template: tpl.id,
    recipient: String(recipient || '').trim(),
    createdAt: now,
    lastActivity: now,
    pieces: tpl.pieces.map((p) => ({
      key: p.key, label: p.label, rule: p.rule,
      status: 'wait', filename: '', stored: '', mime: '', size: 0,
      reason: '', typeDetecte: '', dateDocument: '', confidence: null, provider: '', at: ''
    }))
  };
}

/* ---------- lecture ---------- */
function mapDossier(row, pieces) {
  return {
    id: row.id,
    token: row.token,
    client: row.client,
    email: row.email,
    template: row.template,
    recipient: row.recipient || '',
    sealHash: row.seal_hash || '',
    sealedAt: row.sealed_at || '',
    sealManifest: row.seal_manifest || null,
    createdAt: row.created_at,
    lastActivity: row.last_activity,
    pieces: pieces.map((p) => ({
      key: p.key,
      label: p.label,
      rule: p.rule,
      status: p.status,
      filename: p.filename || '',
      stored: p.stored || '',
      mime: p.mime || '',
      size: Number(p.size || 0),
      reason: p.reason || '',
      typeDetecte: p.type_detecte || '',
      dateDocument: p.date_document || '',
      confidence: p.confidence === null ? null : Number(p.confidence),
      provider: p.provider || '',
      at: p.at || ''
    }))
  };
}

async function listDossiers(cabinetId) {
  const { rows } = await pool.query(
    'select * from aura.dossiers where cabinet_id = $1 order by created_at desc',
    [cabinetId]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const pieces = await pool.query(
    'select * from aura.pieces where dossier_id = any($1::text[]) order by dossier_id, position',
    [ids]
  );
  const byDossier = new Map();
  pieces.rows.forEach((p) => {
    if (!byDossier.has(p.dossier_id)) byDossier.set(p.dossier_id, []);
    byDossier.get(p.dossier_id).push(p);
  });
  return rows.map((r) => mapDossier(r, byDossier.get(r.id) || []));
}

/* Consommation du mois glissant, base du contrôle de quota par offre. */
async function countDossiers(cabinetId, days = 30) {
  const { rows } = await pool.query(
    `select count(*)::int as n from aura.dossiers
      where cabinet_id = $1 and created_at > now() - ($2 || ' days')::interval`,
    [cabinetId, String(days)]
  );
  return rows[0].n;
}

async function getDossier(id, cabinetId) {
  const { rows } = await pool.query(
    'select * from aura.dossiers where id = $1 and cabinet_id = $2',
    [id, cabinetId]
  );
  if (!rows.length) return null;
  const pieces = await pool.query('select * from aura.pieces where dossier_id = $1 order by position', [id]);
  return mapDossier(rows[0], pieces.rows);
}

async function getByToken(tokenValue) {
  const { rows } = await pool.query('select * from aura.dossiers where token = $1', [tokenValue]);
  if (!rows.length) return null;
  const pieces = await pool.query('select * from aura.pieces where dossier_id = $1 order by position', [rows[0].id]);
  return mapDossier(rows[0], pieces.rows);
}

/* Lecture libre par identifiant : réservée aux flux déjà authentifiés par un secret
   (lien client à token). Ne jamais l'utiliser depuis une route d'espace cabinet. */
async function getDossierById(id) {
  const { rows } = await pool.query('select * from aura.dossiers where id = $1', [id]);
  if (!rows.length) return null;
  const pieces = await pool.query('select * from aura.pieces where dossier_id = $1 order by position', [id]);
  return mapDossier(rows[0], pieces.rows);
}

/* ---------- écriture ---------- */
async function insertDossier(d) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      'insert into aura.dossiers (id, token, client, email, template, recipient, cabinet_id) values ($1,$2,$3,$4,$5,$6,$7)',
      [d.id, d.token, d.client, d.email, d.template, d.recipient || '', d.cabinetId]
    );
    for (let i = 0; i < d.pieces.length; i++) {
      const p = d.pieces[i];
      await client.query(
        'insert into aura.pieces (dossier_id, key, label, rule, position) values ($1,$2,$3,$4,$5)',
        [d.id, p.key, p.label, p.rule, i]
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
  return d;
}

const PIECE_FIELDS = {
  status: 'status', filename: 'filename', stored: 'stored', mime: 'mime', size: 'size',
  reason: 'reason', typeDetecte: 'type_detecte', dateDocument: 'date_document',
  confidence: 'confidence', provider: 'provider', at: 'at'
};

async function updatePiece(dossierId, pieceKey, fields) {
  const sets = [];
  const values = [];
  let i = 1;
  Object.keys(fields).forEach((k) => {
    if (!PIECE_FIELDS[k]) return;
    sets.push(`${PIECE_FIELDS[k]} = $${i++}`);
    values.push(fields[k]);
  });
  if (!sets.length) return;
  values.push(dossierId, pieceKey);
  await pool.query(
    `update aura.pieces set ${sets.join(', ')} where dossier_id = $${i++} and key = $${i}`,
    values
  );
  await touch(dossierId);
}

async function touch(dossierId) {
  await pool.query('update aura.dossiers set last_activity = now() where id = $1', [dossierId]);
}

function extOf(mime) {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

async function saveFile(dossierId, pieceKey, file) {
  let content = file.buffer;
  let storageKey = null;

  if (storage.enabled()) {
    storageKey = `dossiers/${dossierId}/${pieceKey}${extOf(file.mime)}`;
    await storage.put(storageKey, file.buffer, file.mime);
    content = null; // le binaire ne touche plus la base
  }

  try {
    await pool.query(
      `insert into aura.files (dossier_id, piece_key, name, mime, size, content, storage_key)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (dossier_id, piece_key) do update
         set name = excluded.name, mime = excluded.mime, size = excluded.size,
             content = excluded.content, storage_key = excluded.storage_key`,
      [dossierId, pieceKey, file.name, file.mime, file.size, content, storageKey]
    );
  } catch (err) {
    // 42703 = colonne absente : le schéma n'a pas encore la section stockage.
    if (err.code !== '42703') throw err;
    await pool.query(
      `insert into aura.files (dossier_id, piece_key, name, mime, size, content)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (dossier_id, piece_key) do update
         set name = excluded.name, mime = excluded.mime, size = excluded.size, content = excluded.content`,
      [dossierId, pieceKey, file.name, file.mime, file.size, file.buffer]
    );
  }
}

async function readFile(dossierId, pieceKey) {
  let rows;
  try {
    ({ rows } = await pool.query(
      'select name, mime, size, content, storage_key from aura.files where dossier_id = $1 and piece_key = $2',
      [dossierId, pieceKey]
    ));
  } catch (err) {
    if (err.code !== '42703') throw err;
    ({ rows } = await pool.query(
      'select name, mime, size, content from aura.files where dossier_id = $1 and piece_key = $2',
      [dossierId, pieceKey]
    ));
  }
  const row = rows[0];
  if (!row) return null;
  if (row.storage_key) {
    const buffer = await storage.get(row.storage_key);
    return { name: row.name, mime: row.mime, size: row.size, content: buffer, storageKey: row.storage_key };
  }
  return row;
}

async function sealDossier(id, hash, sealedAt, manifest) {
  await pool.query(
    'update aura.dossiers set seal_hash = $2, sealed_at = $3, seal_manifest = $4, last_activity = now() where id = $1',
    [id, hash, sealedAt, manifest]
  );
}

async function addOutbox(entry) {
  await pool.query(
    `insert into aura.outbox (id, dossier_id, recipient, subject, body, mode, status, provider_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entry.id, entry.dossierId || null, entry.to, entry.subject, entry.text, entry.mode, entry.status, entry.providerId || '']
  );
}

async function listOutbox(limit = 50) {
  const { rows } = await pool.query('select * from aura.outbox order by created_at desc limit $1', [limit]);
  return rows;
}

async function healthy() {
  const { rows } = await pool.query('select 1 as ok');
  return rows[0].ok === 1;
}

module.exports = {
  pool, TEMPLATES, templateById,
  token, slug, statusOf, progressOf, createDossier,
  listDossiers, countDossiers, getDossier, getDossierById, getByToken, insertDossier,
  updatePiece, touch, saveFile, readFile, addOutbox, listOutbox, healthy, sealDossier
};
