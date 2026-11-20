'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.SESSION_SECRET = 'secret-de-test';
const t = require('../server/lib/totp');

test('TOTP : vecteurs officiels RFC 6238 (SHA-1, 6 chiffres)', () => {
  const secret = t.base32(Buffer.from('12345678901234567890'));
  // Valeurs de l'annexe B du RFC 6238 (8 chiffres) ramenées à 6 chiffres
  assert.strictEqual(t.code(secret, t.pasDe(59000)), '287082');
  assert.strictEqual(t.code(secret, t.pasDe(1111111109000)), '081804');
  assert.strictEqual(t.code(secret, t.pasDe(2000000000000)), '279037');
});

test('TOTP : accepte ±1 pas, refuse au-delà, refuse le rejeu', () => {
  const s = t.nouveauSecret();
  const maintenant = 1_800_000_000_000;
  const pas = t.pasDe(maintenant);
  const bon = t.code(s, pas);
  assert.strictEqual(t.verifier(s, bon, { maintenant }), pas);
  assert.strictEqual(t.verifier(s, t.code(s, pas - 1), { maintenant }), pas - 1);
  assert.strictEqual(t.verifier(s, t.code(s, pas + 2), { maintenant }), null);
  assert.strictEqual(t.verifier(s, bon, { maintenant, dernierPas: pas }), null, 'rejeu refusé');
  assert.strictEqual(t.verifier(s, '12345', { maintenant }), null);
  assert.strictEqual(t.verifier(s, 'abcdef', { maintenant }), null);
  assert.strictEqual(t.verifier(s, bon.slice(0, 3) + ' ' + bon.slice(3), { maintenant }), pas, 'espaces tolérés');
});

test('secret : chiffré au repos, illisible sans la clé, altération détectée', () => {
  const s = t.nouveauSecret();
  const c = t.chiffrer(s);
  assert.ok(!c.includes(s));
  assert.strictEqual(t.dechiffrer(c), s);
  const altere = c.slice(0, -2) + (c.endsWith('A') ? 'B' : 'A') + c.slice(-1);
  assert.throws(() => t.dechiffrer(altere));
  process.env.SESSION_SECRET = 'autre-secret';
  assert.throws(() => t.dechiffrer(c));
  process.env.SESSION_SECRET = 'secret-de-test';
});

test('codes de secours : 8 codes distincts, empreinte insensible à la casse et au tiret', () => {
  const codes = t.codesDeSecours();
  assert.strictEqual(new Set(codes).size, 8);
  assert.match(codes[0], /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.strictEqual(t.empreinte(codes[0]), t.empreinte(codes[0].toLowerCase().replace('-', ' ')));
});

test('otpauth : lisible par une application', () => {
  const u = t.otpauth('ABCDEFGH', 'moi@cabinet.test');
  assert.match(u, /^otpauth:\/\/totp\/Aura%20Collect%3Amoi%40cabinet\.test\?secret=ABCDEFGH&issuer=Aura%20Collect/);
});
