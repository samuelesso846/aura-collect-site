'use strict';
/* Client FedaPay — API v1.
   Contraintes vérifiées sur le compte (31/10/2026) :
   - devise unique : XOF (div = 1, donc le montant s'exprime directement en FCFA, sans ×100) ;
   - pas d'endpoint d'abonnement récurrent : le renouvellement est piloté par Aura Collect ;
   - signature webhook : en-tête `X-FEDAPAY-SIGNATURE` au format `t=<timestamp>,s=<hmac_sha256>`.
*/

const crypto = require('crypto');

const ENV = process.env.FEDAPAY_ENV || 'live';
const SECRET = process.env.FEDAPAY_SECRET_KEY || '';
const PUBLIC_KEY = process.env.FEDAPAY_PUBLIC_KEY || '';
const BASE = ENV === 'sandbox' ? 'https://sandbox-api.fedapay.com/v1' : 'https://api.fedapay.com/v1';
const TOLERANCE = 300; // secondes

function configured() {
  return Boolean(SECRET);
}

function publicKey() {
  return PUBLIC_KEY;
}

async function call(method, path, body) {
  if (!SECRET) throw new Error('FEDAPAY_SECRET_KEY absente.');
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + SECRET,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const detail = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(`FedaPay ${method} ${path} : ${detail}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function unwrap(data, key) {
  if (!data) return null;
  return data['v1/' + key] || data;
}

/* Ouvre une transaction de collecte et renvoie son identifiant + son lien de paiement. */
async function createCheckout({ amount, description, customer, callbackUrl, metadata }) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide.');
  const payload = {
    description: String(description).slice(0, 255),
    amount,
    currency: { iso: 'XOF' },
    callback_url: callbackUrl,
    customer
  };
  if (metadata) payload.custom_metadata = metadata;

  const tx = unwrap(await call('POST', '/transactions', payload), 'transaction');
  if (!tx || !tx.id) throw new Error('Réponse FedaPay inattendue : transaction sans identifiant.');
  const token = await call('POST', `/transactions/${tx.id}/token`);
  if (!token || !token.url) throw new Error('FedaPay n’a pas renvoyé de lien de paiement.');
  return { id: tx.id, reference: tx.reference, status: tx.status, url: token.url };
}

async function getTransaction(id) {
  return unwrap(await call('GET', `/transactions/${id}`), 'transaction');
}

/* Vérifie la signature d'un webhook sur le corps brut, avant tout parsing JSON. */
function verifySignature(rawBody, header, secret, toleranceSeconds) {
  if (!secret) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const head = Buffer.isBuffer(header) ? header.toString('utf8') : String(header || '');
  if (!head) return false;

  let timestamp = -1;
  const signatures = [];
  for (const part of head.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = parseInt(value, 10);
    if (key === 's') signatures.push(value);
  }
  if (timestamp === -1 || !signatures.length) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`, 'utf8').digest('hex');
  const found = signatures.some((sig) => {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!found) return false;

  const age = Math.floor(Date.now() / 1000) - timestamp;
  const tol = toleranceSeconds || TOLERANCE;
  return age <= tol;
}

module.exports = { configured, publicKey, createCheckout, getTransaction, verifySignature, ENV, BASE };
