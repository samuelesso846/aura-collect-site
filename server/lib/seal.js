'use strict';
/* Scellement d'un dossier : manifeste canonique, empreinte SHA-256,
   certificat PDF. L'empreinte couvre les pièces et leurs octets. */
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const store = require('./store');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashManifest(manifest) {
  return sha256(canonical(manifest));
}

async function buildManifest(dossier, cabinet, sealedAt) {
  const pieces = [];
  for (const p of dossier.pieces) {
    let digest = null;
    let size = null;
    if (p.stored && ['ok', 'valide'].includes(p.status)) {
      const file = await store.readFile(dossier.id, p.key);
      if (file) {
        digest = sha256(file.content);
        size = Number(file.size || file.content.length);
      }
    }
    pieces.push({
      key: p.key,
      label: p.label,
      filename: p.filename || '',
      status: p.status,
      dateDocument: p.dateDocument || '',
      sha256: digest,
      size,
      decidedAt: p.at || ''
    });
  }

  return {
    version: 1,
    cabinet,
    dossier: {
      id: dossier.id,
      client: dossier.client,
      recipient: dossier.recipient || '',
      template: store.templateById(dossier.template).name,
      createdAt: dossier.createdAt
    },
    pieces,
    sealedAt: sealedAt || new Date().toISOString()
  };
}

function sanitize(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');
}

function wrap(text, font, size, maxWidth) {
  const words = sanitize(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function certificatePdf(manifest, hash) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const M = 52;
  let y = height - M;

  const ink = rgb(0.04, 0.055, 0.1);
  const muted = rgb(0.36, 0.39, 0.47);
  const line = rgb(0.86, 0.88, 0.92);
  const violet = rgb(0.42, 0.29, 1);

  page.drawText('AURA COLLECT', { x: M, y, size: 9, font: bold, color: violet });
  y -= 26;
  page.drawText('CERTIFICAT DE DOSSIER', { x: M, y, size: 10, font: bold, color: muted });
  y -= 34;
  page.drawText('Dossier constitué pour :', { x: M, y, size: 10, font, color: muted });
  y -= 24;
  const recipient = manifest.dossier.recipient || 'usage interne';
  wrap(recipient, bold, 20, width - 2 * M).forEach((l, i) => {
    page.drawText(l, { x: M, y: y - i * 24, size: 20, font: bold, color: ink });
  });
  y -= 24 * Math.max(1, wrap(recipient, bold, 20, width - 2 * M).length);

  y -= 22;
  page.drawText(sanitize('Client : ' + manifest.dossier.client), { x: M, y, size: 11, font, color: ink });
  y -= 16;
  page.drawText(sanitize('Cabinet : ' + manifest.cabinet), { x: M, y, size: 11, font, color: ink });
  y -= 16;
  page.drawText(sanitize('Modèle : ' + manifest.dossier.template + '   ·   Référence : ' + manifest.dossier.id), { x: M, y, size: 10, font, color: muted });
  y -= 16;
  page.drawText(sanitize('Scellé le : ' + new Date(manifest.sealedAt).toLocaleString('fr-FR')), { x: M, y, size: 10, font, color: muted });

  y -= 26;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: line });
  y -= 22;
  page.drawText('PIÈCES ET EMPREINTES', { x: M, y, size: 9, font: bold, color: muted });
  y -= 20;

  manifest.pieces.forEach((p, i) => {
    page.drawText(String(i + 1).padStart(2, '0'), { x: M, y, size: 9, font, color: muted });
    page.drawText(sanitize(p.label).slice(0, 52), { x: M + 22, y, size: 10, font: bold, color: ink });
    y -= 13;
    page.drawText(sanitize(p.filename || '—') + (p.dateDocument ? '  ·  daté du ' + p.dateDocument : ''), { x: M + 22, y, size: 8.5, font, color: muted });
    y -= 12;
    page.drawText('SHA-256', { x: M + 22, y, size: 7.5, font, color: muted });
    page.drawText((p.sha256 || '').slice(0, 64), { x: M + 62, y, size: 7.5, font: mono, color: ink });
    y -= 16;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: line });
    y -= 14;
  });

  if (y < 190) {
    y = 180;
  }

  y -= 4;
  page.drawText('EMPREINTE DU DOSSIER', { x: M, y, size: 9, font: bold, color: muted });
  y -= 16;
  const chunks = hash.match(/.{1,32}/g) || [hash];
  chunks.forEach((c) => {
    page.drawText(c, { x: M, y, size: 9, font: mono, color: ink });
    y -= 13;
  });

  y -= 8;
  const note = 'L\'empreinte SHA-256 est calculée sur le manifeste JSON joint à l\'archive (pièces, statuts, dates et octets des fichiers). ' +
    'Toute modification, même d\'un octet, invalide cette empreinte. Ce certificat est une preuve d\'intégrité horodatée ; ' +
    'il ne constitue pas une signature électronique qualifiée au sens du règlement eIDAS.';
  wrap(note, font, 7.5, width - 2 * M).forEach((l) => {
    page.drawText(l, { x: M, y, size: 7.5, font, color: muted });
    y -= 10;
  });

  page.drawText(sanitize("Vérification : /app, ouvrir le dossier, puis « Vérifier l'intégrité »"), { x: M, y: 46, size: 8, font, color: muted });

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

module.exports = { buildManifest, hashManifest, certificatePdf, canonical, sha256 };
