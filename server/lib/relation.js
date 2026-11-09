'use strict';
/* Aura Relation — préparation du message de fin de dossier.

   Ce module ne décide rien à la place du professionnel : il assemble un texte
   à partir de faits vérifiables, et refuse de le faire si le dossier n'est pas
   scellé. Aucun envoi n'est déclenché ici. */

const T = require('./relation-templates');

const CHANNELS = ['whatsapp', 'sms', 'email'];
const STATUSES = ['prepare', 'ouvert', 'envoye'];

function prenomOf(dossier) {
  const raw = String((dossier && (dossier.clientName || dossier.client)) || '').trim();
  if (!raw) return '';
  const first = raw.split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function frDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* Un dossier ne peut produire un message de fin que s'il est scellé :
   avant, le « dossier complet » n'est pas encore une vérité. */
function available(dossier) {
  if (!dossier) return { ok: false, reason: 'Dossier introuvable.' };
  if (!dossier.sealHash) {
    return { ok: false, reason: 'Le dossier doit être scellé avant de préparer un message de fin.' };
  }
  if (!frDate(dossier.sealedAt)) {
    return { ok: false, reason: 'La date de scellement est absente : le message ne peut pas être daté.' };
  }
  return { ok: true };
}

function build({ dossier, templateName, cabinetName, actor }) {
  const check = available(dossier);
  if (!check.ok) return { ok: false, reason: check.reason };

  const family = T.familyFor(dossier.template);
  const prenom = prenomOf(dossier);

  /* Sans prénom connu, on n'écrit pas « Bonjour , » : on ouvre sans prénom. */
  const ctx = {
    prenom: prenom || '',
    dossierType: templateName || 'dossier',
    date: frDate(dossier.sealedAt),
    cabinet: cabinetName || 'votre cabinet',
    conseiller: (actor && (actor.name || actor.email)) || ''
  };

  let body = family.build(ctx);
  if (!ctx.prenom) body = body.replace(/^Bonjour\s*,/m, 'Bonjour,');

  return {
    ok: true,
    family: family.key,
    label: family.label,
    garde: family.garde,
    channel: dossier.email ? 'email' : 'whatsapp',
    clientEmail: dossier.email || '',
    body
  };
}

module.exports = { available, build, frDate, prenomOf, CHANNELS, STATUSES, allTemplates: T.all };
