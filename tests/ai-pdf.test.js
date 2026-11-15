'use strict';
/* Un PDF avec texte part comme texte ; un PDF scanné (sans texte) part comme image(s). */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');

const received = [];
let server;
let ai;

test.before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        type_conforme: true, type_detecte: 'relevé', lisible: true, date_document: null, date_valide: true, motif: 'ok', confiance: 0.9 }) } }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.GROQ_API_KEY = 'test';
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  ai = require('../server/lib/ai');
});
test.after(() => server.close());

async function textPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Releve de compte - Banque Exemple - Titulaire SARL Kodjo Services - Periode du 01/10/2026 au 31/10/2026 - Solde final 2 356 708 F CFA', { x: 30, y: 780, size: 9, font });
  return Buffer.from(await pdf.save());
}

async function scannedPdf(pages) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const c = createCanvas(600, 800);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#000'; g.font = '32px sans-serif'; g.fillText('RELEVE page ' + (i + 1), 40, 80);
    const img = await pdf.embedPng(c.toBuffer('image/png'));
    pdf.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await pdf.save());
}

const piece = { label: '3 derniers relevés bancaires', rule: 'moins de 3 mois' };
const kinds = (req) => req.messages[1].content.map((p) => p.type);

test('PDF avec texte : envoyé comme texte, sans image', async () => {
  received.length = 0;
  const r = await ai.validate({ buffer: await textPdf(), mimetype: 'application/pdf', originalname: 'a.pdf' }, piece, 'Bilan annuel');
  assert.strictEqual(r.status, 'ok');
  assert.ok(!kinds(received[0]).includes('image_url'));
});

test('PDF scanné : envoyé comme image, plus renvoyé d\'office au cabinet', async () => {
  received.length = 0;
  const r = await ai.validate({ buffer: await scannedPdf(1), mimetype: 'application/pdf', originalname: 'b.pdf' }, piece, 'Bilan annuel');
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(kinds(received[0]).filter((t) => t === 'image_url').length, 1);
  assert.match(received[0].messages[1].content[0].text, /PDF scanné de 1 page/);
});

test('PDF scanné de 5 pages : 3 pages envoyées, avec la consigne de ne pas refuser pour les autres', async () => {
  received.length = 0;
  await ai.validate({ buffer: await scannedPdf(5), mimetype: 'application/pdf', originalname: 'c.pdf' }, piece, 'Bilan annuel');
  assert.strictEqual(kinds(received[0]).filter((t) => t === 'image_url').length, 3);
  assert.match(received[0].messages[1].content[0].text, /ne refuse pas la pièce/);
});

test('PDF corrompu : renvoyé au cabinet, jamais accepté', async () => {
  received.length = 0;
  const r = await ai.validate({ buffer: Buffer.from('%PDF-1.4 pas un vrai pdf'), mimetype: 'application/pdf', originalname: 'd.pdf' }, piece, 'Bilan annuel');
  assert.strictEqual(r.status, 'review');
  assert.strictEqual(received.length, 0);
});
