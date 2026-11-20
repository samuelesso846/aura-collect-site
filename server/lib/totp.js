'use strict';
/* Double authentification par code à 6 chiffres (TOTP, RFC 6238), compatible avec
   Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
   Aucune dépendance : tout repose sur le module crypto de Node.

   Le secret est chiffré au repos (AES-256-GCM) ; les codes de secours sont
   stockés sous forme d'empreintes. */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PAS = 30;      // secondes
const CHIFFRES = 6;
const FENETRE = 1;   // tolère ±1 pas (dérive d'horloge du téléphone)

function base32(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function deBase32(s) {
  let bits = '';
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function nouveauSecret() { return base32(crypto.randomBytes(20)); }

function code(secret, pas) {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const h = crypto.createHmac('sha1', deBase32(secret)).update(compteur).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** CHIFFRES).padStart(CHIFFRES, '0');
}

const pasDe = (t) => Math.floor(t / 1000 / PAS);

/* Retourne le pas validé (nombre) ou null. `dernierPas` interdit de rejouer un
   code déjà accepté. */
function verifier(secret, saisie, { maintenant = Date.now(), dernierPas = 0 } = {}) {
  const s = String(saisie || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(s)) return null;
  const centre = pasDe(maintenant);
  for (let d = -FENETRE; d <= FENETRE; d++) {
    const pas = centre + d;
    if (pas <= dernierPas) continue;
    const attendu = Buffer.from(code(secret, pas));
    if (crypto.timingSafeEqual(attendu, Buffer.from(s))) return pas;
  }
  return null;
}

function otpauth(secret, compte, emetteur = 'Aura Collect') {
  return 'otpauth://totp/' + encodeURIComponent(emetteur + ':' + compte) +
    '?secret=' + secret + '&issuer=' + encodeURIComponent(emetteur) + '&algorithm=SHA1&digits=6&period=30';
}

/* ---- chiffrement du secret au repos ---- */
function cle() {
  const base = process.env.TOTP_KEY || process.env.SESSION_SECRET;
  if (!base) throw new Error('TOTP_KEY ou SESSION_SECRET requis pour la double authentification');
  return crypto.createHash('sha256').update('aura-totp|' + base).digest();
}

function chiffrer(secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle(), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return 'v1.' + [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

function dechiffrer(stocke) {
  const [v, iv, tag, enc] = String(stocke || '').split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('secret illisible');
  const d = crypto.createDecipheriv('aes-256-gcm', cle(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

/* ---- codes de secours ---- */
const empreinte = (c) => crypto.createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

function codesDeSecours(n = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => {
    let s = '';
    for (const b of crypto.randomBytes(10)) s += alphabet[b % alphabet.length];
    return s.slice(0, 5) + '-' + s.slice(5);
  });
}

module.exports = { nouveauSecret, verifier, otpauth, chiffrer, dechiffrer, codesDeSecours, empreinte, code, pasDe, base32, deBase32 };
