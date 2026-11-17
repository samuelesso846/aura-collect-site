'use strict';
/* Identité du cabinet : ce que le cabinet saisit est traité comme une entrée non fiable. */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const crypto = require('crypto');
const brand = require('../server/lib/brand');

const png = (w, h, rgb = { r: 200, g: 30, b: 30 }) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { ...rgb, alpha: 1 } } }).png().toBuffer();

test('mot d\'accueil : texte brut, caractères de contrôle retirés, longueur bornée', () => {
  assert.strictEqual(brand.cleanWelcome('  Bonjour\r\n\r\n\r\n\r\nMerci\u0007  '), 'Bonjour\n\nMerci');
  assert.strictEqual(brand.cleanWelcome(null), '');
  // Le HTML n'est pas interprété ici : il reste du texte (l'affichage l'échappe).
  assert.strictEqual(brand.cleanWelcome('<b>x</b>'), '<b>x</b>');
  // Caractères d'inversion de sens de lecture (usurpation de texte) retirés.
  assert.strictEqual(brand.cleanWelcome('abc‮def'), 'abcdef');
  assert.strictEqual(brand.cleanWelcome('a'.repeat(500)).length, 500);
  assert.throws(() => brand.cleanWelcome('a'.repeat(501)), /trop long/);
});

test('téléphone : format international exigé, normalisé', () => {
  assert.strictEqual(brand.cleanPhone('+228 90 12 34 56'), '+22890123456');
  assert.strictEqual(brand.cleanPhone('+228-90.12.34.56'), '+22890123456');
  assert.strictEqual(brand.cleanPhone(''), '');
  for (const bad of ['90123456', '+228abc', '+1', '00228 90 12 34 56', '+228 90 12 34 56 78 90 12 34 56', 'javascript:alert(1)'])
    assert.throws(() => brand.cleanPhone(bad), /format international/, bad);
  assert.strictEqual(brand.phoneDisplay('+22890123456'), '+228 90 12 34 56');
  assert.strictEqual(brand.phoneDisplay('+33612345678'), '+33612345678');
});

test('couleur : liste fermée, repli sur le bleu', () => {
  assert.strictEqual(brand.accentOf('violet').hex, '#5B3FE0');
  assert.strictEqual(brand.accentOf('red;}body{display:none').id, 'bleu');
  assert.strictEqual(brand.accentOf(undefined).id, 'bleu');
  for (const a of Object.values(brand.ACCENTS)) assert.match(a.hex, /^#[0-9A-F]{6}$/);
});

test('logo : un PNG valide est redessiné à taille bornée', async () => {
  const out = await brand.processLogo(await png(2000, 1000));
  assert.strictEqual(out.mime, 'image/png');
  const m = await sharp(out.buffer).metadata();
  assert.ok(m.width <= 360 && m.height <= 360, `${m.width}x${m.height}`);
  assert.ok(out.buffer.length < 150 * 1024);
});

test('logo : un petit logo n\'est pas agrandi', async () => {
  const out = await brand.processLogo(await png(120, 80));
  const m = await sharp(out.buffer).metadata();
  assert.strictEqual(m.width, 120);
});

test('logo : les métadonnées (EXIF, position GPS) sont supprimées', async () => {
  const src = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#3366aa' } })
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'confidentiel-ne-pas-diffuser' } } }).toBuffer();
  assert.ok((await sharp(src).metadata()).exif, 'le fichier d\'origine porte bien un EXIF');
  const out = await brand.processLogo(src);
  assert.strictEqual(out.mime, 'image/jpeg');
  assert.strictEqual((await sharp(out.buffer).metadata()).exif, undefined);
  assert.ok(!out.buffer.includes(Buffer.from('confidentiel')));
});

test('logo : SVG, GIF, HTML, texte et fichier vide refusés', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><script>alert(1)</script></svg>');
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  for (const [nom, buf] of [['svg', svg], ['gif', gif], ['html', Buffer.from('<html><body>x</body></html>')],
    ['texte', Buffer.from('hello world, ceci n\'est pas une image')], ['vide', Buffer.alloc(0)]]) {
    await assert.rejects(() => brand.processLogo(buf), (e) => e.status === 400, nom);
  }
});

test('logo : fichier déguisé (en-tête PNG, contenu quelconque) refusé', async () => {
  const faux = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
  await assert.rejects(() => brand.processLogo(faux), /illisible|traité/);
});

test('logo : image tronquée, trop petite ou trop lourde refusées', async () => {
  const bon = await png(400, 400);
  await assert.rejects(() => brand.processLogo(bon.subarray(0, 60)), (e) => e.status === 400);
  const minuscule = await png(30, 30);
  await assert.rejects(() => brand.processLogo(minuscule), /trop petite/);
  await assert.rejects(() => brand.processLogo(Buffer.concat([bon, Buffer.alloc(2 * 1024 * 1024)])), /trop lourde/);
});

test('logo : une photo bruitée finit sous la limite, en JPEG si nécessaire', async () => {
  const raw = crypto.randomBytes(600 * 600 * 3);
  const noisy = await sharp(raw, { raw: { width: 600, height: 600, channels: 3 } }).png().toBuffer();
  const out = await brand.processLogo(noisy);
  assert.ok(out.buffer.length <= 150 * 1024, 'taille ' + out.buffer.length);
  assert.ok(['image/png', 'image/jpeg'].includes(out.mime));
});

test('aperçu WhatsApp : tout est échappé, rien sur le client', () => {
  const tags = brand.previewTags({
    name: 'Cabinet "Evil" <script>alert(1)</script>', welcome: '"><img src=x onerror=alert(1)>',
    accentHex: '#1264A3', imageUrl: 'https://x.test/a.png?v=1&b="2'
  });
  assert.ok(!/<script>|<img /.test(tags), tags);
  assert.ok(tags.includes('&lt;script&gt;'));
  assert.ok(tags.includes('og:image'));
  assert.ok(tags.includes('&amp;b=&quot;2'));
  const sans = brand.previewTags({ name: 'Cab', welcome: '', accentHex: '#1264A3', imageUrl: '' });
  assert.ok(!sans.includes('og:image'));
  assert.ok(sans.includes('Déposez vos pièces'));
  const long = brand.previewTags({ name: 'Cab', welcome: 'x'.repeat(400), accentHex: '#1264A3' });
  assert.ok(long.includes('…'));
});
