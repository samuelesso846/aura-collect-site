'use strict';
/* Export ZIP : pièces renommées, classées, plus un sommaire PDF horodaté. */
const path = require('path');
const archiver = require('archiver');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const store = require('./store');
const seal = require('./seal');

function lastName(client) {
  const parts = String(client).trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

function extension(piece) {
  const name = piece.filename || piece.stored || '';
  const ext = path.extname(name).toLowerCase();
  if (ext === '.jpeg') return '.jpg';
  if (['.jpg', '.png', '.webp', '.pdf'].includes(ext)) return ext;
  return '.pdf';
}

function exportName(dossier, piece) {
  return store.slug(lastName(dossier.client)) + '_' + store.slug(piece.label) + extension(piece);
}

function sanitize(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');
}

async function summaryPdf(dossier, tplName) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const M = 56;
  let y = height - M;

  const ink = rgb(0.04, 0.055, 0.1);
  const muted = rgb(0.36, 0.39, 0.47);
  const line = rgb(0.88, 0.9, 0.94);

  page.drawText('AURA COLLECT', { x: M, y, size: 9, font: bold, color: rgb(0.42, 0.29, 1) });
  y -= 30;
  page.drawText(sanitize('Dossier ' + dossier.client), { x: M, y, size: 22, font: bold, color: ink });
  y -= 22;
  page.drawText(sanitize(tplName + '  ·  ' + dossier.pieces.length + ' pièces  ·  ' +
    new Date(dossier.createdAt).toLocaleDateString('fr-FR')), { x: M, y, size: 10, font, color: muted });
  y -= 26;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: line });
  y -= 26;

  dossier.pieces.forEach((piece, i) => {
    const ok = ['ok', 'valide'].includes(piece.status);
    const review = piece.status === 'review';
    const label = sanitize(piece.label);
    page.drawText(String(i + 1).padStart(2, '0'), { x: M, y, size: 9, font, color: muted });
    page.drawText(label.slice(0, 74), { x: M + 24, y, size: 11, font: bold, color: ink });
    y -= 15;

    const detail = ok
      ? 'Validé' + (piece.dateDocument ? '  ·  daté du ' + piece.dateDocument : '') + '  ·  ' + exportName(dossier, piece)
      : review
        ? 'À vérifier par le cabinet'
        : piece.status === 'ko'
          ? 'Refusé — en attente d\'une nouvelle version'
          : 'Non déposé';
    page.drawText(sanitize(detail), { x: M + 24, y, size: 9, font, color: ok ? rgb(0.05, 0.55, 0.42) : muted });
    y -= 10;

    if (piece.status === 'ko' && piece.reason) {
      const words = sanitize(piece.reason).split(' ');
      let lineText = '';
      words.forEach((w) => {
        if ((lineText + ' ' + w).trim().length > 88) {
          page.drawText(lineText.trim(), { x: M + 24, y, size: 8, font, color: muted });
          y -= 10;
          lineText = w;
        } else {
          lineText += ' ' + w;
        }
      });
      if (lineText.trim()) {
        page.drawText(lineText.trim(), { x: M + 24, y, size: 8, font, color: muted });
        y -= 10;
      }
    }
    y -= 12;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: line });
    y -= 18;
  });

  const footer = sanitize('Généré le ' + new Date().toLocaleString('fr-FR') + ' — les pièces originales sont jointes à cette archive.');
  page.drawText(footer, { x: M, y: 46, size: 8, font, color: muted });

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function buildZip(res, dossier, tplName) {
  const folder = store.slug(lastName(dossier.client)) + '_' + store.slug(tplName) + '_' + new Date().getFullYear();
  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('warning', (err) => console.warn('[zip]', err.message));
  archive.on('error', (err) => {
    console.error('[zip]', err.message);
    try { res.destroy(err); } catch (_) {}
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${folder}.zip"`);
  archive.pipe(res);

  for (const piece of dossier.pieces) {
    /* seules les pièces validées entrent dans le dossier remis au cabinet */
    if (!piece.stored || !['ok', 'valide'].includes(piece.status)) continue;
    const file = await store.readFile(dossier.id, piece.key);
    if (file && file.content) {
      archive.append(file.content, { name: folder + '/' + exportName(dossier, piece) });
    }
  }

  const sommaire = await summaryPdf(dossier, tplName);
  archive.append(sommaire, { name: folder + '/sommaire.pdf' });

  if (dossier.sealHash && dossier.sealManifest) {
    const cert = await seal.certificatePdf(dossier.sealManifest, dossier.sealHash);
    archive.append(cert, { name: folder + '/certificat.pdf' });
    archive.append(JSON.stringify(dossier.sealManifest, null, 2), { name: folder + '/manifeste.json' });
  }

  const missing = dossier.pieces.filter((p) => !['ok', 'review', 'valide'].includes(p.status));
  const note = [
    'AURA COLLECT — dossier ' + dossier.client,
    'Modèle : ' + tplName,
    'Export : ' + new Date().toLocaleString('fr-FR'),
    '',
    missing.length
      ? 'Pièces non validées (absentes de cette archive) : ' + missing.map((p) => p.label).join(', ')
      : 'Toutes les pièces attendues sont présentes.'
  ].join('\n');
  archive.append(note, { name: folder + '/_lisez-moi.txt' });

  await archive.finalize();
}

module.exports = { buildZip, exportName };
