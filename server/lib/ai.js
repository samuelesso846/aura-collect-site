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
  "date_document": "AAAA-MM-JJ" | null,
  "date_valide": true|false,
  "motif": "une phrase claire, en français, destinée au client",
  "confiance": 0.0
}

Règles :
- type_conforme = false si le document n'est pas la pièce demandée (ex. une facture d'électricité à la place d'un avis d'imposition).
- lisible = false si le document est flou, coupé, trop sombre ou illisible.
- date_valide = false si la date du document ne respecte pas la règle de validité fournie. Si aucune date n'est visible, mets date_document à null et date_valide à false.
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

function userPrompt(piece, templateName) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `Date du jour : ${today}.`,
    `Dossier : « ${templateName} ».`,
    `Pièce attendue : « ${piece.label} ».`,
    `Règle de validité : ${piece.rule}.`
  ];
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

async function callGroq(content, attempt) {
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
        return callGroq(content, attempt + 1);
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

function toVerdict(json) {
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
  const dateOk = json.date_valide !== false;
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

async function readPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return (data.text || '').replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.error('[ai] extraction PDF impossible :', err.message);
    return '';
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
        return {
          ...base,
          status: 'review',
          reason: 'PDF scanné : la vérification visuelle automatique ne peut pas l’analyser. Le cabinet contrôle la pièce.',
          configured: true
        };
      }
      content = [
        { type: 'text', text: userPrompt(piece, templateName) },
        { type: 'text', text: 'Contenu extrait du PDF :\n' + text.slice(0, 9000) }
      ];
    } else {
      const light = await shrink(file.buffer);
      const dataUrl = `data:image/jpeg;base64,${light.toString('base64')}`;
      content = [
        { type: 'text', text: userPrompt(piece, templateName) },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    }

    const { text } = await callGroq(content);
    const json = parseJson(text);
    const verdict = toVerdict(json);

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

module.exports = { validate, status, configured };
