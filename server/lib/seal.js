'use strict';
/* Scellement d'un dossier : manifeste canonique, empreinte SHA-256,
   certificat PDF. L'empreinte couvre les pièces et leurs octets.

   Version 2 du manifeste (dossiers scellés à partir de cette version) : elle
   ajoute un instantané de l'historique des décisions et des contrôles
   automatiques à la date du scellement. Cet instantané est PRIS UNE FOIS, au
   scellement, puis relu tel quel dans le manifeste archivé : le journal continue
   de grandir après le scellement, il ne doit jamais faire apparaître une fausse
   altération. Les dossiers scellés en version 1 restent valides, sans changement. */
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

/* Les dates arrivent de Postgres sous forme d'objets Date. `canonical` ne sait
   pas les sérialiser : il les réduisait à « {} ». L'empreinte était donc calculée
   sur des dates vides, et le manifeste relu depuis la base (où les dates sont des
   chaînes ISO) ne redonnait jamais la même empreinte. On fixe la forme ici, une
   fois pour toutes : tout ce qui entre dans le manifeste est déjà une chaîne. */
function toIso(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/* ---------- instantané de l'historique et des contrôles (manifeste v2) ---------- */

/* Gestes qui racontent la vie d'un dossier. Les messages de relance, les rappels
   et autres traces d'usage n'entrent pas dans un certificat. */
const ACTIONS_RETENUES = new Set(['creation', 'depot', 'verdict_ia', 'validation', 'refus', 'forcage']);
const MAX_EVENEMENTS = 400;

const LIBELLES = {
  creation: 'Dossier créé',
  depot: 'Pièce déposée',
  verdict_ia: 'Vérification automatique',
  validation: 'Pièce validée par le cabinet',
  refus: 'Nouvelle version demandée',
  forcage: 'Validation forcée par le cabinet'
};
const ACTEURS = { ia: 'IA', client: 'Client', cabinet: 'Cabinet', systeme: 'Système' };

function acteurDe(r) {
  const base = ACTEURS[r.actor_kind] || String(r.actor_kind || 'Système');
  if (r.actor_kind === 'cabinet') {
    const qui = r.actor_name || r.actor_email;
    return qui ? base + ' - ' + qui : base;
  }
  return base;
}

/* `rows` : lignes de store.listDecisions. `alertes` : sortie de controles.controles.
   Fonction pure : tout ce qui sort est déjà sérialisable et stable. */
function snapshotAnnex(rows, alertes) {
  const retenus = (rows || [])
    .filter((r) => ACTIONS_RETENUES.has(r.action))
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime(), tb = new Date(b.created_at).getTime();
      return ta - tb || Number(a.id || 0) - Number(b.id || 0);
    });
  return {
    decisionsTotal: retenus.length,
    decisions: retenus.slice(0, MAX_EVENEMENTS).map((r) => {
      const c = (r.confidence === null || r.confidence === undefined) ? null : Number(r.confidence);
      return {
        at: toIso(r.created_at),
        action: r.action,
        piece: r.piece_label || '',
        acteur: acteurDe(r),
        motif: String(r.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        fournisseur: r.provider || '',
        confiance: (c === null || isNaN(c)) ? null : Math.round(c * 100) / 100
      };
    }),
    controles: (alertes || []).map((a) => ({
      niveau: a.niveau === 'alerte' ? 'alerte' : 'info',
      code: String(a.code || ''),
      message: String(a.message || '')
    }))
  };
}

/* Relit l'instantané d'un manifeste archivé (v2). Les manifestes v1 n'en ont pas. */
function annexOf(manifest) {
  if (!manifest || Number(manifest.version) < 2) return null;
  return {
    decisionsTotal: Number(manifest.decisionsTotal || 0),
    decisions: Array.isArray(manifest.decisions) ? manifest.decisions : [],
    controles: Array.isArray(manifest.controles) ? manifest.controles : []
  };
}

async function buildManifest(dossier, cabinet, sealedAt, annex) {
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
      decidedAt: toIso(p.at)
    });
  }

  const manifest = {
    version: annex ? 2 : 1,
    cabinet,
    dossier: {
      id: dossier.id,
      client: dossier.client,
      recipient: dossier.recipient || '',
      template: store.templateById(dossier.template).name,
      createdAt: toIso(dossier.createdAt)
    },
    pieces,
    sealedAt: toIso(sealedAt) || new Date().toISOString()
  };
  if (annex) {
    manifest.decisionsTotal = annex.decisionsTotal;
    manifest.decisions = annex.decisions;
    manifest.controles = annex.controles;
  }
  return manifest;
}

/* ---------- certificat PDF ---------- */

function sanitize(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E -ÿ]/g, '');
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

/* Date lisible et sans ambiguïté : toujours en UTC, construite à la main (le
   formatage régional insère des espaces insécables que la police du PDF ne sait
   pas dessiner). */
function quand(iso) {
  const s = toIso(iso);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) + ' ' + s.slice(11, 16) + ' UTC';
}

async function certificatePdf(manifest, hash) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const W = 595, H = 842, M = 52;
  const BAS = 74; // marge basse : réservée au pied de page

  const ink = rgb(0.04, 0.055, 0.1);
  const muted = rgb(0.36, 0.39, 0.47);
  const line = rgb(0.86, 0.88, 0.92);
  const violet = rgb(0.42, 0.29, 1);
  const ambre = rgb(0.6, 0.36, 0);

  let page = doc.addPage([W, H]);
  let y = H - M;

  /* Saute à une nouvelle page si `besoin` points ne tiennent plus. */
  const place = (besoin) => {
    if (y - besoin >= BAS) return;
    page = doc.addPage([W, H]);
    y = H - M;
    page.drawText(sanitize('AURA COLLECT  ·  Certificat de dossier  ·  ' + manifest.dossier.id), { x: M, y, size: 8, font: bold, color: muted });
    y -= 28;
  };
  const titre = (texte) => {
    place(40);
    page.drawText(sanitize(texte), { x: M, y, size: 9, font: bold, color: muted });
    y -= 18;
  };
  const paragraphe = (texte, size, couleur, f, x, largeur, interligne) => {
    for (const l of wrap(texte, f || font, size, largeur)) {
      place(interligne);
      page.drawText(l, { x, y, size, font: f || font, color: couleur });
      y -= interligne;
    }
  };

  /* --- en-tête --- */
  page.drawText('AURA COLLECT', { x: M, y, size: 9, font: bold, color: violet });
  y -= 26;
  page.drawText('CERTIFICAT DE DOSSIER', { x: M, y, size: 10, font: bold, color: muted });
  y -= 34;
  page.drawText('Dossier constitué pour :', { x: M, y, size: 10, font, color: muted });
  y -= 24;
  const recipient = manifest.dossier.recipient || 'usage interne';
  const lignesRecipient = wrap(recipient, bold, 20, W - 2 * M);
  lignesRecipient.forEach((l, i) => {
    page.drawText(l, { x: M, y: y - i * 24, size: 20, font: bold, color: ink });
  });
  y -= 24 * Math.max(1, lignesRecipient.length);

  y -= 22;
  page.drawText(sanitize('Client : ' + manifest.dossier.client), { x: M, y, size: 11, font, color: ink });
  y -= 16;
  page.drawText(sanitize('Cabinet : ' + manifest.cabinet), { x: M, y, size: 11, font, color: ink });
  y -= 16;
  page.drawText(sanitize('Modèle : ' + manifest.dossier.template + '   ·   Référence : ' + manifest.dossier.id), { x: M, y, size: 10, font, color: muted });
  y -= 16;
  page.drawText(sanitize('Scellé le : ' + quand(manifest.sealedAt)), { x: M, y, size: 10, font, color: muted });

  y -= 26;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });
  y -= 22;
  titre('PIÈCES ET EMPREINTES');

  /* --- pièces --- */
  manifest.pieces.forEach((p, i) => {
    place(58);
    page.drawText(String(i + 1).padStart(2, '0'), { x: M, y, size: 9, font, color: muted });
    page.drawText(sanitize(p.label).slice(0, 52), { x: M + 22, y, size: 10, font: bold, color: ink });
    y -= 13;
    page.drawText(sanitize((p.filename || '—') + (p.dateDocument ? '  ·  daté du ' + p.dateDocument : '')).slice(0, 96), { x: M + 22, y, size: 8.5, font, color: muted });
    y -= 12;
    page.drawText('SHA-256', { x: M + 22, y, size: 7.5, font, color: muted });
    page.drawText((p.sha256 || '').slice(0, 64), { x: M + 62, y, size: 7.5, font: mono, color: ink });
    y -= 16;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: line });
    y -= 14;
  });

  /* --- empreinte du dossier --- */
  y -= 4;
  place(72);
  titre('EMPREINTE DU DOSSIER');
  for (const c of (hash.match(/.{1,32}/g) || [hash])) {
    page.drawText(c, { x: M, y, size: 9, font: mono, color: ink });
    y -= 13;
  }

  y -= 8;
  const v2 = Number(manifest.version) >= 2;
  const note = 'L\'empreinte SHA-256 est calculée sur le manifeste JSON joint à l\'archive (pièces, statuts, dates et octets des fichiers' +
    (v2 ? ', historique des décisions et contrôles automatiques à la date du scellement' : '') + '). ' +
    'Toute modification, même d\'un octet, invalide cette empreinte. Ce certificat atteste l\'intégrité et la traçabilité du dossier à la date indiquée. ' +
    'Il ne constitue ni une signature électronique qualifiée, ni une attestation de conformité aux obligations réglementaires du cabinet ' +
    '(identification des clients, lutte contre le blanchiment, protection des données), qui restent de sa responsabilité.';
  paragraphe(note, 7.5, muted, font, M, W - 2 * M, 10);

  /* --- annexe A : historique des décisions --- */
  y -= 18;
  place(70);
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 1, color: line });
  y -= 10;
  titre('HISTORIQUE DES DÉCISIONS, JUSQU\'AU SCELLEMENT');

  if (!v2) {
    paragraphe('Historique non joint à ce certificat : le dossier a été scellé avant l\'ajout de cette section. Le journal des décisions du dossier reste disponible dans l\'archive.', 8.5, muted, font, M, W - 2 * M, 11);
  } else if (!(manifest.decisions || []).length) {
    paragraphe('Aucun événement enregistré avant le scellement.', 8.5, muted, font, M, W - 2 * M, 11);
  } else {
    const X = M + 106, LARG = W - M - X;
    for (const d of manifest.decisions) {
      let texte = d.motif || '';
      if (d.fournisseur) texte += (texte ? ' ' : '') + '(fournisseur : ' + d.fournisseur + ')';
      if (d.confiance !== null && d.confiance !== undefined) {
        texte += (texte ? ' ' : '') + '(confiance ' + Math.round(Number(d.confiance) * (Number(d.confiance) <= 1 ? 100 : 1)) + ' %)';
      }
      const lignes = wrap(texte, font, 8, LARG);
      place(26 + lignes.length * 10);
      page.drawText(sanitize(quand(d.at)), { x: M, y, size: 7.5, font: mono, color: muted });
      page.drawText(sanitize((LIBELLES[d.action] || d.action) + (d.piece ? ' · ' + d.piece : '')).slice(0, 72), { x: X, y, size: 9, font: bold, color: ink });
      y -= 11;
      page.drawText(sanitize(d.acteur || '').slice(0, 80), { x: X, y, size: 8, font, color: muted });
      y -= 10;
      for (const l of lignes) {
        page.drawText(l, { x: X, y, size: 8, font, color: muted });
        y -= 10;
      }
      y -= 5;
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.4, color: line });
      y -= 8;
    }
    const manque = Number(manifest.decisionsTotal || 0) - manifest.decisions.length;
    if (manque > 0) {
      paragraphe(manque + ' événement' + (manque > 1 ? 's' : '') + ' plus récent' + (manque > 1 ? 's' : '') + ' non reproduit' + (manque > 1 ? 's' : '') + ' ici : voir le journal des décisions de l\'archive.', 8, muted, font, M, W - 2 * M, 10);
    }
  }

  /* --- annexe B : contrôles automatiques --- */
  y -= 16;
  place(80);
  titre('CONTRÔLES AUTOMATIQUES À LA DATE DU SCELLEMENT');
  if (!v2) {
    paragraphe('Non joints à ce certificat (dossier scellé avant l\'ajout de cette section).', 8.5, muted, font, M, W - 2 * M, 11);
  } else {
    const controles = manifest.controles || [];
    if (!controles.length) {
      paragraphe('Aucune incohérence détectée par les contrôles automatiques (nom d\'une pièce à l\'autre, dates d\'expiration, fichier déposé deux fois).', 8.5, ink, font, M, W - 2 * M, 11);
    } else {
      for (const c of controles) {
        const alerte = c.niveau === 'alerte';
        const lignes = wrap(c.message, font, 8.5, W - 2 * M - 70);
        place(lignes.length * 11 + 8);
        page.drawText(alerte ? 'ALERTE' : 'INFO', { x: M, y, size: 8, font: bold, color: alerte ? ambre : muted });
        for (const l of lignes) {
          page.drawText(l, { x: M + 70, y, size: 8.5, font, color: ink });
          y -= 11;
        }
        y -= 6;
      }
    }
    y -= 4;
    paragraphe('Ces contrôles sont une aide à la lecture : ils peuvent se tromper et ne remplacent pas le jugement du cabinet. Une alerte signalée ici n\'a pas empêché le scellement : la décision de sceller appartient au cabinet.', 7.5, muted, font, M, W - 2 * M, 10);
  }

  /* --- pied de page, sur chaque page --- */
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(sanitize("Vérification : /app, ouvrir le dossier, puis « Vérifier l'intégrité »"), { x: M, y: 46, size: 8, font, color: muted });
    const num = 'Page ' + (i + 1) + ' / ' + pages.length;
    pg.drawText(num, { x: W - M - font.widthOfTextAtSize(num, 8), y: 46, size: 8, font, color: muted });
  });

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

module.exports = { buildManifest, hashManifest, certificatePdf, snapshotAnnex, annexOf, canonical, sha256 };
