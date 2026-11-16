'use strict';
/* Régulateur de débit : on attend la place plutôt que d'essuyer un 429, et au-delà
   de l'attente maximale la pièce est renvoyée au cabinet sans appeler le fournisseur. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, ai, calls = 0;

test.before(async () => {
  server = http.createServer((req, res) => {
    calls += 1;
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        usage: { total_tokens: 3000 },
        choices: [{ message: { content: JSON.stringify({ type_conforme: true, type_detecte: 'facture', lisible: true, extrait_lu: 'Total 100 F', date_document: null, date_valide: true, motif: 'ok', confiance: 0.9 }) } }]
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.GROQ_API_KEY = 'test';
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.GROQ_TPM = '4000';        // budget utile : 3 400 jetons
  process.env.GROQ_WINDOW_MS = '1200';  // fenêtre courte pour le test
  process.env.GROQ_MAX_WAIT_MS = '5000';
  ai = require('../server/lib/ai');
});
test.after(() => server.close());

const file = { buffer: Buffer.from('%PDF-1.4'), mimetype: 'text/plain', originalname: 'x.txt' };
const piece = { label: 'Facture', rule: 'lisible' };

// Un PDF texte évite tout traitement d'image : seul le régulateur est en jeu.
const { PDFDocument, StandardFonts } = require('pdf-lib');
async function pdf() {
  const d = await PDFDocument.create();
  const p = d.addPage([595, 842]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  p.drawText('Facture numero 42 - Societe Exemple - Total TTC 245 000 F CFA - Merci de votre confiance - Lome Togo', { x: 20, y: 800, size: 9, font: f });
  return { buffer: Buffer.from(await d.save()), mimetype: 'application/pdf', originalname: 'f.pdf' };
}

test('deuxième pièce rapprochée : retardée, jamais refusée par le fournisseur', async () => {
  calls = 0;
  const f = await pdf();
  const t0 = Date.now();
  const a = await ai.validate(f, piece, 'Dossier');
  const b = await ai.validate(f, piece, 'Dossier');
  assert.strictEqual(a.status, 'ok');
  assert.strictEqual(b.status, 'ok');
  assert.strictEqual(calls, 2);
  assert.ok(Date.now() - t0 >= 900, 'la seconde pièce doit attendre la fenêtre');
});

test('attente maximale dépassée : renvoyée au cabinet, sans appel', async () => {
  const f = await pdf();
  await ai.validate(f, piece, 'Dossier'); // remplit la fenêtre
  process.env.GROQ_WINDOW_MS = '20000';
  process.env.GROQ_MAX_WAIT_MS = '300';
  calls = 0;
  const r = await ai.validate(f, piece, 'Dossier');
  assert.strictEqual(r.status, 'review');
  assert.match(r.reason, /saturé/);
  assert.strictEqual(calls, 0);
});
