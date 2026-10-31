'use strict';
/* Validation d'une pièce par modèle vision (Groq, API compatible OpenAI).
   Aucune acceptation silencieuse : en cas de doute ou de panne, le statut
   devient « review » et le cabinet tranche. */

const Groq = {
  baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  model: process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
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

const SYSTEM = `Tu es un contrôleur de conformité documentaire pour un cabinet français.
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
- Ne devine jamais une date : si elle n'est pas lisible, elle est null.`;

function userPrompt(piece, templateName) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `Date du jour : ${today}.`,
    `Dossier : « ${templateName} ».`,
    `Pièce attendue : « ${piece.label} ».`,
    `Règle de validité : ${piece.rule}.`,
    `Analyse le document ci-joint et renvoie le JSON.`
  ].join('\n');
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

async function callGroq(content) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(Groq.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + Groq.key,
        'Content-Type': 'application/json'
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

  if (!typeOk) {
    return {
      status: 'ko',
      reason: reason || "Ce document ne correspond pas à la pièce demandée. Merci d'envoyer le bon justificatif.",
      confidence: conf
    };
  }
  if (!lisible) {
    return {
      status: 'ko',
      reason: reason || 'Le document est difficile à lire. Reprenez la photo à la lumière du jour, feuille bien à plat.',
      confidence: conf
    };
  }
  if (!dateOk) {
    return {
      status: 'ko',
      reason: reason || (date ? `Ce document date du ${date} : il ne respecte pas la période demandée.` : 'La date du document est absente ou illisible.'),
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
      const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
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
      reason: "La vérification automatique a échoué (service indisponible). Le cabinet contrôle la pièce.",
      configured: true,
      error: err.status || 0
    };
  }
}

module.exports = { validate, status, configured };
