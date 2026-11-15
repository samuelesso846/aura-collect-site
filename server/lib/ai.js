'use strict';
/* Validation d'une pièce par modèle vision (Groq, API compatible OpenAI).
   Aucune acceptation silencieuse : en cas de doute ou de panne, le statut
   devient « review » et le cabinet tranche. */

const Groq = {
  baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
  key: process.env.GROQ_API_KEY || ''
};

function configured() {
  return Boolean(Groq.key);
}

function status() {
  return {
    provider: configured() ? 'groq' : 'none',
    model: configured() ? Groq.model : '',
    ready: configured()
  };
}

const SYSTEM = `Tu es un contrôleur de conformité documentaire pour un cabinet ou une agence.
On te confie une pièce justificative à vérifier. Tu dois répondre UNIQUEMENT par un objet JSON valide, sans texte autour.

Schéma exact :
{
  "type_conforme": true|false,
  "type_detecte": "nature du document en quelques mots",
  "lisible": true|false,
  "extrait_lu": "passage recopié mot pour mot sur le document" | null,
  "date_document": "AAAA-MM-JJ" | null,
  "date_valide": true|false,
  "motif": "une phrase claire, en français, destinée au client",
  "confiance": 0.0
}

Règles :
- type_conforme = false si le document n'est pas la pièce demandée (ex. une facture d'électricité à la place d'un avis d'imposition).
- lisible = false si le document est flou, coupé, trop sombre ou illisible.
- extrait_lu : recopie mot pour mot un passage précis du document (un montant, un numéro, un nom). Ne l'invente jamais : si le texte est trop flou, trop petit ou trop sombre pour être lu avec certitude, mets null et lisible = false.
- Si la règle exige une signature ou un cachet (« signé », « signée », « signature », « cachet »), cherche-le explicitement sur le document. S'il est absent, type_conforme = false et le motif dit « signature manquante ». Ne suppose jamais qu'une signature existe.
- Si la règle précise le titulaire (« au nom de la société », « à votre nom », « au nom du gérant »), lis le nom du titulaire sur le document. Un nom de personne seul (M., Mme, prénom et nom) n'est pas une société : si la règle demande une société, type_conforme = false et le motif l'explique.
- date_valide ne sert que si la règle de validité porte sur une période (par exemple « moins de 3 mois », « exercice concerné », « en cours de validité »). Dans ce cas, date_valide = false si la date ne respecte pas la règle ; si aucune date n'est visible, mets date_document à null et date_valide à false. Si la règle ne porte pas sur une date (par exemple « toutes les pages », « signé », « lisible »), mets date_valide à true et ne refuse jamais la pièce pour une date absente.
- motif : explique au client ce qu'il doit faire, en une phrase, sans jargon. Si tout est bon, dis simplement que le document est accepté.
- confiance : entre 0 et 1, ta certitude globale.
- Une pièce générique ("Première pièce", "Deuxième pièce", règle « selon vos règles ») n'impose aucune nature : type_conforme vaut true dès que l'image contient un document, et l'absence de date ne rend pas la pièce invalide.
- Ne devine jamais une date : si elle n'est pas lisible, elle est null.`;

/* Un modèle « sur-mesure » ne dit pas quelle pièce est attendue : ses libellés
   sont « Première pièce », « Deuxième pièce ». Sans cette distinction, le
   contrôleur refusait tout document en répondant qu'il n'était pas une
   « Deuxième pièce ». On ne juge alors que la lisibilité. */
const GENERIC_LABEL = /^(premi[èe]re|deuxi[èe]me|troisi[èe]me|quatri[èe]me|cinqui[èe]me|sixi[èe]me|septi[èe]me|huiti[èe]me|neuvi[èe]me|dixi[èe]me)\s+pi[èe]ce\b/i;
const GENERIC_RULE = /selon vos r[èe]gles/i;

function isGenericPiece(piece) {
  const label = String((piece && piece.label) || '').trim();
  const rule = String((piece && piece.rule) || '');
  return GENERIC_LABEL.test(label) || GENERIC_RULE.test(rule);
}

/* Toutes les règles d'un modèle n'imposent pas une date. « toutes les pages »,
   « signé », « lisible », « au nom de la société » ne disent rien du temps : une
   facture d'achat ou un bail signé sans date lisible reste une pièce valable.
   Seules les règles qui expriment une période (« moins de 3 mois », « exercice
   concerné », « les 4 trimestres », « N-1 », « en cours de validité ») autorisent
   un refus pour date absente ou hors période. Sans cette distinction, chaque
   reçu manuscrit ou attestation non datée était refusé à tort. */
const REGLE_DATEE = /moins de|derniers?\b|derni[èe]res?\b|exercice|trimestre|ann[ée]e|n-\d|validit[ée]|p[ée]riode|r[ée]cent|\d+\s*mois|20\d\d/i;

function exigeDate(rule) {
  return REGLE_DATEE.test(String(rule || ''));
}

function userPrompt(piece, templateName) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `Date du jour : ${today}.`,
    `Dossier : « ${templateName} ».`,
    `Pièce attendue : « ${piece.label} ».`,
    `Règle de validité : ${piece.rule}.`
  ];
  if (exigeDate(piece.rule)) {
    lines.push("Cette règle porte sur une période : tu dois vérifier la date du document. " +
      "Si la date n'est pas lisible, mets date_document à null et date_valide à false.");
  } else {
    lines.push("Cette règle ne porte pas sur une date : n'utilise pas l'absence de date comme motif de refus. " +
      "Mets date_valide à true même si aucune date n'est visible, et laisse date_document à null dans ce cas.");
  }
  if (isGenericPiece(piece)) {
    lines.push("Cette pièce n'impose aucune nature précise : n'évalue pas la conformité du type. " +
      "Mets type_conforme à true dès que l'image montre un document, même si sa nature ne peut pas être déterminée. " +
      "Ne pénalise pas l'absence de date.");
  }
  lines.push('Analyse le document ci-joint et renvoie le JSON.');
  return lines.join('\n');
}

function parseJson(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

const breaker = require('./observe').breaker(4, 60000);

/* Disjoncteur : si le fournisseur échoue 4 fois de suite, on ne le sollicite plus pendant
   une minute ; la pièce passe aussitôt en « à contrôler » par le cabinet. */
async function callGroq(content, attempt) {
  if (!attempt && !breaker.allow()) {
    const e = new Error('Service IA momentanément suspendu (échecs répétés)');
    e.status = 503; throw e;
  }
  try {
    const r = await callGroqOnce(content, attempt);
    breaker.ok();
    return r;
  } catch (e) {
    breaker.fail();
    throw e;
  }
}

async function callGroqOnce(content, attempt) {
  attempt = attempt || 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(Groq.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + Groq.key,
        'Content-Type': 'application/json',
        'User-Agent': 'AuraCollect/1.0'
      },
      body: JSON.stringify({
        model: Groq.model,
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content }
        ]
      }),
      signal: controller.signal
    });

    const body = await res.text();
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        const header = res.headers.get('retry-after');
        const hinted = /try again in ([0-9.]+)\s*s/i.exec(body);
        const delay = header ? Number(header) * 1000
          : hinted ? Math.min(25000, Number(hinted[1]) * 1000 + 600)
            : 3000;
        console.warn('[ai] ' + res.status + ' — nouvelle tentative dans ' + Math.round(delay / 1000) + ' s');
        clearTimeout(timer);
        await wait(delay);
        return callGroqOnce(content, attempt + 1);
      }
      const err = new Error('Groq ' + res.status + ' : ' + body.slice(0, 300));
      err.status = res.status;
      throw err;
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch (_) { throw new Error('Réponse Groq illisible'); }
    const text = parsed?.choices?.[0]?.message?.content || '';
    return { text, raw: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function toVerdict(json, piece) {
  if (!json || typeof json !== 'object') {
    return {
      status: 'review',
      reason: "La vérification automatique n'a pas pu conclure. Le cabinet contrôle la pièce.",
      confidence: null
    };
  }

  const conf = typeof json.confiance === 'number' ? json.confiance : null;
  const reason = typeof json.motif === 'string' ? json.motif.trim() : '';
  const typeOk = json.type_conforme === true;
  const lisible = json.lisible === true;
  /* Le refus pour date n'est appliqué que si la règle de la pièce porte vraiment
     sur une période : sinon une facture ou un bail sans date lisible serait
     rejeté alors que le cabinet ne l'a jamais demandé. */
  const dateRequise = exigeDate(piece && piece.rule);
  const dateOk = !dateRequise || json.date_valide !== false;
  const date = typeof json.date_document === 'string' ? json.date_document : '';

  /* La phrase canonique reste en tête : c'est elle qui permet de savoir, plus
     tard, si le cabinet peut passer outre le verdict (cf. peutEtreForce). */
  const joindre = (canonique) => (reason && reason !== canonique ? canonique + ' ' + reason : canonique);

  if (!typeOk) {
    return {
      status: 'ko',
      reason: joindre("Ce document ne correspond pas à la pièce demandée. Merci d'envoyer le bon justificatif."),
      confidence: conf
    };
  }
  if (!lisible) {
    return {
      status: 'ko',
      reason: joindre('Le document est difficile à lire. Reprenez la photo à la lumière du jour, feuille bien à plat.'),
      confidence: conf
    };
  }
  /* Preuve de lecture : un modèle qui affirme « lisible » sans pouvoir recopier un
     seul passage n'a probablement rien lu. On ne valide pas : le cabinet tranche. */
  const extrait = typeof json.extrait_lu === 'string' ? json.extrait_lu.trim() : '';
  if (extrait.length < 3) {
    return {
      status: 'review',
      reason: "Le texte du document n'a pas pu être lu avec certitude. Le cabinet contrôle la pièce.",
      confidence: conf
    };
  }
  if (!dateOk) {
    return {
      status: 'ko',
      reason: joindre(date
        ? `Ce document date du ${date} : il ne respecte pas la période demandée.`
        : 'La date du document est absente ou illisible.'),
      confidence: conf
    };
  }
  if (conf !== null && conf < 0.55) {
    return {
      status: 'review',
      reason: reason || 'Vérification automatique incertaine : le cabinet contrôle la pièce.',
      confidence: conf
    };
  }
  return {
    status: 'ok',
    reason: reason || 'Document conforme.',
    confidence: conf
  };
}

/* Contrôle objectif avant l'IA : une photo quasi noire ou minuscule ne se lit pas,
   quoi qu'en dise le modèle. Seuils volontairement prudents : on ne refuse que
   l'évidence. Luminosité moyenne sur 255 ; taille en pixels du petit côté. */
const TROP_SOMBRE = 45;
const TROP_PETIT = 500;

async function imageQuality(buffer) {
  try {
    const sharp = require('sharp');
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    const stats = await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: 400, height: 400, fit: 'inside' }).greyscale().stats();
    const small = Math.min(meta.width || 0, meta.height || 0);
    return { mean: stats.channels[0].mean, small, tooDark: stats.channels[0].mean < TROP_SOMBRE, tooSmall: small > 0 && small < TROP_PETIT };
  } catch (_) {
    return null; // on ne bloque jamais sur une mesure impossible
  }
}

async function shrink(buffer) {
  try {
    const sharp = require('sharp');
    // failOn 'none' : une photo de téléphone avec des métadonnées douteuses
    // doit être traitée, pas rejetée. Les fichiers réellement illisibles
    // échoueront plus loin et la pièce passera en contrôle manuel.
    return await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (err) {
    console.warn('[ai] redimensionnement impossible :', err.message);
    return buffer;
  }
}

/* Deux lecteurs, dans cet ordre : pdf-parse est rapide mais échoue sur les PDF
   récents (« bad XRef entry »), que pdfjs avale sans broncher. Sans ce repli,
   toute une famille de PDF basculait en contrôle manuel alors que le texte
   était parfaitement lisible. */
async function readPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const texte = (data.text || '').replace(/\s+/g, ' ').trim();
    if (texte.length >= 60) return texte;
  } catch (err) {
    console.warn('[ai] pdf-parse a échoué, repli sur pdfjs :', err.message);
  }

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false
    }).promise;
    let texte = '';
    const pages = Math.min(doc.numPages, 12);
    for (let i = 1; i <= pages; i += 1) {
      const page = await doc.getPage(i);
      const contenu = await page.getTextContent();
      texte += contenu.items.map((item) => item.str).join(' ') + '\n';
    }
    return texte.replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.error('[ai] extraction PDF impossible :', err.message);
    return '';
  }
}

const SCAN_MAX_PAGES = 3;

/* PDF sans texte (scan ou photo enregistrée en PDF) : on dessine les premières pages
   en images pour que le modèle les lise comme une photo. Renvoie { pages, total } ou
   null si le rendu est impossible (le cabinet contrôle alors la pièce). */
async function renderPdfPages(buffer) {
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false
    }).promise;
    const total = doc.numPages;
    const pages = [];
    for (let i = 1; i <= Math.min(total, SCAN_MAX_PAGES); i += 1) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport: vp }).promise;
      pages.push(await shrink(canvas.toBuffer('image/jpeg', 80)));
    }
    return pages.length ? { pages, total } : null;
  } catch (err) {
    console.error('[ai] rendu du PDF scanné impossible :', err.message);
    return null;
  }
}

/**
 * @param {{buffer:Buffer, mimetype:string, originalname:string}} file
 * @param {{label:string, rule:string}} piece
 * @param {string} templateName
 */
async function validate(file, piece, templateName) {
  const base = {
    provider: configured() ? Groq.model : 'none',
    typeDetecte: '',
    dateDocument: '',
    confidence: null
  };

  if (!configured()) {
    return {
      ...base,
      status: 'review',
      reason: "Vérification automatique non configurée : le cabinet contrôle la pièce.",
      configured: false
    };
  }

  const isPdf = file.mimetype === 'application/pdf';
  const isImage = /^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype);

  if (!isPdf && !isImage) {
    return {
      ...base,
      status: 'review',
      reason: 'Format non pris en charge par la vérification automatique (JPEG, PNG, WEBP ou PDF attendu).',
      configured: true
    };
  }

  let content;
  try {
    if (isPdf) {
      const text = await readPdfText(file.buffer);
      if (text.length < 60) {
        const scan = await renderPdfPages(file.buffer);
        if (!scan) {
          return {
            ...base,
            status: 'review',
            reason: 'PDF scanné illisible par la vérification automatique. Le cabinet contrôle la pièce.',
            configured: true
          };
        }
        let note = `Le document est un PDF scanné de ${scan.total} page(s) ; les images ci-jointes en sont les pages.`;
        if (scan.total > scan.pages.length) {
          note += ` Seules les ${scan.pages.length} premières pages sont fournies : ne refuse pas la pièce parce que les suivantes manquent.`;
        }
        content = [
          { type: 'text', text: userPrompt(piece, templateName) + '\n' + note },
          ...scan.pages.map((p) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + p.toString('base64') } }))
        ];
      } else {
        content = [
          { type: 'text', text: userPrompt(piece, templateName) },
          { type: 'text', text: 'Contenu extrait du PDF :\n' + text.slice(0, 9000) }
        ];
      }
    } else {
      const q = await imageQuality(file.buffer);
      if (q && (q.tooDark || q.tooSmall)) {
        return {
          ...base,
          status: 'ko',
          reason: 'Le document est difficile à lire. Reprenez la photo à la lumière du jour, feuille bien à plat.' +
            (q.tooDark ? ' La photo est trop sombre.' : " L'image est trop petite : envoyez la photo d'origine, sans la réduire."),
          configured: true,
          confidence: 1
        };
      }
      const light = await shrink(file.buffer);
      const dataUrl = `data:image/jpeg;base64,${light.toString('base64')}`;
      content = [
        { type: 'text', text: userPrompt(piece, templateName) },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    }

    const { text } = await callGroq(content);
    const json = parseJson(text);
    const verdict = toVerdict(json, piece);

    return {
      ...base,
      ...verdict,
      typeDetecte: json && typeof json.type_detecte === 'string' ? json.type_detecte : '',
      dateDocument: json && typeof json.date_document === 'string' ? json.date_document : '',
      configured: true
    };
  } catch (err) {
    console.error('[ai] échec de la vérification :', err.message);
    return {
      ...base,
      status: 'review',
      reason: err.status === 429
        ? 'Le service de vérification est momentanément saturé. Le cabinet contrôle la pièce.'
        : 'La vérification automatique a échoué. Le cabinet contrôle la pièce.',
      configured: true,
      error: err.status || 0
    };
  }
}

module.exports = { validate, status, configured, renderPdfPages };
