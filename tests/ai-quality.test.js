'use strict';
/* Contrôles faits par le serveur avant et après l'IA : photo trop sombre ou trop
   petite refusée sans appel au modèle ; « lisible » sans extrait recopié non validé. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createCanvas } = require('@napi-rs/canvas');

let server, ai, calls = 0, next;

test.before(async () => {
  server = http.createServer((req, res) => {
    calls += 1;
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) } }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.GROQ_API_KEY = 'test';
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  ai = require('../server/lib/ai');
});
test.after(() => server.close());

const GOOD = { type_conforme: true, type_detecte: 'facture', lisible: true, extrait_lu: 'Total TTC 245 000 F CFA', date_document: null, date_valide: true, motif: 'ok', confiance: 0.9 };
const piece = { label: "Factures d'achat", rule: 'toutes les pages' };

function jpeg(w, h, gray) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${gray},${gray},${gray})`; g.fillRect(0, 0, w, h);
  g.fillStyle = gray > 128 ? '#000' : '#fff'; g.font = `${Math.round(h / 20)}px sans-serif`;
  for (let i = 1; i < 15; i += 1) g.fillText('Facture ligne ' + i + ' 12 500 F CFA', 30, i * (h / 16));
  return c.toBuffer('image/jpeg', 85);
}
const run = (buffer) => ai.validate({ buffer, mimetype: 'image/jpeg', originalname: 'p.jpg' }, piece, 'Bilan annuel');

test('photo normale : transmise au modèle et acceptée', async () => {
  calls = 0; next = GOOD;
  const r = await run(jpeg(1200, 1600, 235));
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(calls, 1);
});

test('photo quasi noire : refusée sans appeler le modèle', async () => {
  calls = 0; next = GOOD;
  const r = await run(jpeg(1200, 1600, 12));
  assert.strictEqual(r.status, 'ko');
  assert.match(r.reason, /difficile à lire/);
  assert.match(r.reason, /trop sombre/);
  assert.strictEqual(calls, 0);
});

test('image minuscule : refusée sans appeler le modèle', async () => {
  calls = 0; next = GOOD;
  const r = await run(jpeg(320, 420, 235));
  assert.strictEqual(r.status, 'ko');
  assert.match(r.reason, /trop petite/);
  assert.strictEqual(calls, 0);
});

test('photo sombre mais lisible : toujours confiée au modèle', async () => {
  calls = 0; next = GOOD;
  const r = await run(jpeg(1200, 1600, 95));
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(calls, 1);
});

test('« lisible » sans extrait recopié : jamais validé, renvoyé au cabinet', async () => {
  next = { ...GOOD, extrait_lu: null };
  const r = await run(jpeg(1200, 1600, 235));
  assert.strictEqual(r.status, 'review');
  next = { ...GOOD, extrait_lu: '' };
  assert.strictEqual((await run(jpeg(1200, 1600, 235))).status, 'review');
});

test('mauvais type : le refus reste prioritaire sur l\'absence d\'extrait', async () => {
  next = { ...GOOD, type_conforme: false, extrait_lu: null, motif: 'Ce n\'est pas une facture.' };
  assert.strictEqual((await run(jpeg(1200, 1600, 235))).status, 'ko');
});
