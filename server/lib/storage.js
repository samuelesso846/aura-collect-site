'use strict';
/* Stockage des pièces hors base de données (Supabase Storage).
   Le binaire ne doit pas vivre dans Postgres : l'offre gratuite plafonne la base
   à 500 Mo, alors que le stockage de fichiers monte à 1 Go, puis 100 Go en Pro.

   Tant que SUPABASE_URL et SUPABASE_SERVICE_KEY ne sont pas renseignées,
   `enabled()` renvoie false et l'application retombe sur le stockage en base. */

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'aura-files';

function enabled() {
  return Boolean(URL_BASE && KEY);
}

function authHeaders(extra) {
  return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, extra || {});
}

/* Crée le compartiment privé au premier usage. Idempotent. */
async function ensureBucket() {
  if (!enabled()) return false;
  const url = `${URL_BASE}/storage/v1/bucket/${encodeURIComponent(BUCKET)}`;
  const existing = await fetch(url, { headers: authHeaders() });
  if (existing.ok) return true;

  const created = await fetch(`${URL_BASE}/storage/v1/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 26214400 })
  });
  if (created.ok) return true;

  const detail = await created.text().catch(() => '');
  // 400 « already exists » : le compartiment est là, inutile d'échouer.
  if (created.status === 400 && /exist/i.test(detail)) return true;
  throw new Error(`Création du compartiment impossible (${created.status}) ${detail.slice(0, 200)}`);
}

async function put(objectPath, buffer, contentType) {
  const url = `${URL_BASE}/storage/v1/object/${encodeURIComponent(BUCKET)}/${objectPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' }),
    body: buffer
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Envoi du fichier impossible (${res.status}) ${detail.slice(0, 200)}`);
  }
  return objectPath;
}

async function get(objectPath) {
  const url = `${URL_BASE}/storage/v1/object/${encodeURIComponent(BUCKET)}/${objectPath}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Fichier introuvable dans le stockage (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function remove(objectPath) {
  const url = `${URL_BASE}/storage/v1/object/${encodeURIComponent(BUCKET)}`;
  await fetch(url, {
    method: 'DELETE',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [objectPath] })
  }).catch(() => {});
}

module.exports = { enabled, ensureBucket, put, get, remove, BUCKET };
