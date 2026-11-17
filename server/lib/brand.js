'use strict';
/* Identité du cabinet sur la page de dépôt de ses clients : validation de ce que le
   cabinet saisit, recompression du logo, balises d'aperçu (WhatsApp).
   Tout ce qui vient du cabinet est traité comme une entrée non fiable : le texte est
   affiché en texte brut, la couleur vient d'une liste fermée, le logo est redessiné
   par le serveur (jamais renvoyé tel que reçu). */

const ACCENTS = {
  bleu:    { label: 'Bleu',    hex: '#1264A3', hex2: '#3A8FD6' },
  vert:    { label: 'Vert',    hex: '#087A4E', hex2: '#18A56E' },
  orange:  { label: 'Orange',  hex: '#B8530B', hex2: '#E0802E' },
  rouge:   { label: 'Rouge',   hex: '#B3253F', hex2: '#DB4A64' },
  violet:  { label: 'Violet',  hex: '#5B3FE0', hex2: '#8467FF' },
  ardoise: { label: 'Ardoise', hex: '#3D4A5C', hex2: '#66758C' }
};

const WELCOME_MAX = 500;
const LOGO_MAX_INPUT = 2 * 1024 * 1024;   // ce que l'on accepte de recevoir
const LOGO_MAX_OUTPUT = 150 * 1024;       // ce que l'on stocke
const LOGO_BOX = 360;                     // px, assez net pour un écran de téléphone
const LOGO_MIN = 64;

function accentOf(id) {
  return ACCENTS[id] ? { id, ...ACCENTS[id] } : { id: 'bleu', ...ACCENTS.bleu };
}

/* Texte d'accueil : texte brut, sauts de ligne conservés (deux de suite au plus). */
function cleanWelcome(input) {
  const s = String(input == null ? '' : input)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > WELCOME_MAX) {
    const e = new Error(`Le mot d'accueil est trop long (${s.length} caractères, ${WELCOME_MAX} au maximum).`);
    e.status = 400; throw e;
  }
  return s;
}

/* Téléphone : format international obligatoire, car le lien WhatsApp en dépend. */
function cleanPhone(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return '';
  const s = raw.replace(/[\s.\-()]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(s)) {
    const e = new Error('Indiquez le numéro au format international, par exemple +228 90 12 34 56.');
    e.status = 400; throw e;
  }
  return s;
}

function phoneDisplay(p) {
  const m = /^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(p || '');
  return m ? `+228 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : (p || '');
}

function sniffLogo(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') return 'image/png';
  return null;
}

/* Redessine le logo : taille bornée, métadonnées (EXIF, GPS) supprimées, format PNG ou
   JPEG uniquement. Un fichier qui n'est pas réellement une image échoue ici. */
async function processLogo(buffer) {
  const fail = (m) => { const e = new Error(m); e.status = 400; return e; };
  if (!buffer || !buffer.length) throw fail('Aucun fichier reçu.');
  if (buffer.length > LOGO_MAX_INPUT) throw fail('Image trop lourde (2 Mo maximum).');
  const mime = sniffLogo(buffer);
  if (!mime) throw fail('Le logo doit être une image PNG ou JPEG.');

  const sharp = require('sharp');
  let meta;
  try { meta = await sharp(buffer, { failOn: 'error', limitInputPixels: 40e6 }).metadata(); }
  catch (_) { throw fail('Cette image est illisible ou abîmée.'); }
  if ((meta.pages || 1) > 1) throw fail('Les images animées ne sont pas acceptées.');
  if (Math.min(meta.width || 0, meta.height || 0) < LOGO_MIN) {
    throw fail(`Image trop petite : au moins ${LOGO_MIN} pixels de côté.`);
  }

  const base = () => sharp(buffer, { failOn: 'error', limitInputPixels: 40e6 })
    .rotate()
    .resize({ width: LOGO_BOX, height: LOGO_BOX, fit: 'inside', withoutEnlargement: true });

  let out;
  let outMime = mime;
  try {
    if (mime === 'image/png') {
      out = await base().png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
      if (out.length > LOGO_MAX_OUTPUT) {
        // PNG trop lourd (dégradés, photo) : JPEG sur fond blanc.
        out = await base().flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
        outMime = 'image/jpeg';
      }
    } else {
      out = await base().jpeg({ quality: 85 }).toBuffer();
    }
    for (let q = 70; out.length > LOGO_MAX_OUTPUT && q >= 40; q -= 15) {
      out = await base().flatten({ background: '#ffffff' }).jpeg({ quality: q }).toBuffer();
      outMime = 'image/jpeg';
    }
  } catch (_) { throw fail('Cette image ne peut pas être traitée.'); }
  if (out.length > LOGO_MAX_OUTPUT) throw fail('Image trop complexe : choisissez un logo plus simple.');
  return { buffer: out, mime: outMime };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Balises lues par WhatsApp, Telegram, etc. quand le cabinet envoie le lien : ces
   robots n'exécutent pas de script, tout doit déjà être dans le HTML. Rien ici sur
   le client ni sur le dossier : seulement le nom du cabinet et son mot d'accueil. */
function previewTags({ name, welcome, imageUrl, accentHex }) {
  const title = `Vos documents à déposer — ${name}`;
  const firstLine = String(welcome || '').split('\n')[0].trim();
  const desc = firstLine
    ? (firstLine.length > 140 ? firstLine.slice(0, 137) + '…' : firstLine)
    : 'Déposez vos pièces en toute sécurité. Chaque document est vérifié à son arrivée.';
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="theme-color" content="${esc(accentHex)}">`
  ];
  if (imageUrl) {
    tags.push(`<meta property="og:image" content="${esc(imageUrl)}">`,
      `<meta name="twitter:card" content="summary">`);
  }
  return tags.join('\n');
}

module.exports = {
  ACCENTS, WELCOME_MAX, accentOf, cleanWelcome, cleanPhone, phoneDisplay,
  sniffLogo, processLogo, previewTags
};
