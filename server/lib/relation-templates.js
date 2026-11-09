'use strict';
/* Aura Relation — modèles de messages de fin de dossier.

   Règle : le texte est construit UNIQUEMENT à partir de données réelles du
   dossier (prénom, type, date de scellement, cabinet, personne connectée).
   Aucune donnée absente n'est inventée : si une valeur manque, la phrase qui
   la portait disparaît au lieu d'être remplie au hasard.

   Chaque famille porte aussi une « garde » : la phrase qu'il est interdit
   d'écrire, et que le professionnel doit pouvoir lire avant d'envoyer. */

const FAMILIES = {
  immobilier: {
    key: 'immobilier',
    label: 'Fin de dossier immobilier',
    garde: 'Ne promettez pas une décision : le dossier complet n’est pas une acceptation.',
    build(ctx) {
      const fin = ctx.conseiller
        ? `${ctx.conseiller} — ${ctx.cabinet}`
        : ctx.cabinet;
      return `Bonjour ${ctx.prenom},

Votre dossier « ${ctx.dossierType} » est complet : les pièces ont été vérifiées le ${ctx.date}.
Vous n'avez plus de document à transmettre pour le moment.

Nous revenons vers vous dès que la décision concernant votre dossier est disponible.

Merci pour votre confiance.
${fin}`;
    }
  },

  comptabilite: {
    key: 'comptabilite',
    label: 'Fin de traitement comptable',
    garde: 'Une échéance ne s’annonce que si elle est réelle et connue du cabinet.',
    build(ctx) {
      const fin = ctx.conseiller
        ? `${ctx.conseiller} — ${ctx.cabinet}`
        : ctx.cabinet;
      return `Bonjour ${ctx.prenom},

Vos pièces « ${ctx.dossierType} » ont été vérifiées le ${ctx.date} et votre dossier est complet pour cette étape.
Vous n'avez plus rien à transmettre pour le moment.

Merci pour votre réactivité.
${fin}`;
    }
  },

  financement: {
    key: 'financement',
    label: 'Suivi d’une demande de financement',
    garde: 'Ne jamais présenter la réception du dossier comme un accord de financement.',
    build(ctx) {
      const fin = ctx.conseiller
        ? `${ctx.conseiller} — ${ctx.cabinet}`
        : ctx.cabinet;
      return `Bonjour ${ctx.prenom},

Votre dossier « ${ctx.dossierType} » a bien été réceptionné et les pièces demandées ont été vérifiées le ${ctx.date}.

La suite : l'instruction de votre demande par nos services. Nous vous tiendrons informé(e) de son évolution.

Cette étape ne constitue pas encore une décision de financement.

Merci d'avoir choisi ${ctx.cabinet}.
${fin}`;
    }
  },

  generique: {
    key: 'generique',
    label: 'Fin de dossier',
    garde: 'Ne rien affirmer qui ne soit pas dans le dossier.',
    build(ctx) {
      const fin = ctx.conseiller
        ? `${ctx.conseiller} — ${ctx.cabinet}`
        : ctx.cabinet;
      return `Bonjour ${ctx.prenom},

Votre dossier « ${ctx.dossierType} » est complet : les pièces ont été vérifiées le ${ctx.date}.
Vous n'avez plus de document à transmettre pour le moment.

Merci pour votre confiance.
${fin}`;
    }
  }
};

/* Correspondance entre les modèles de dossier d'Aura Collect et les familles
   de message. Un modèle inconnu tombe sur « generique » : jamais d'erreur. */
const BY_TEMPLATE = {
  locataire: 'immobilier',
  bilan: 'comptabilite',
  tva: 'comptabilite',
  creation: 'comptabilite',
  credit: 'financement',
  kyc: 'financement',
  onboarding: 'generique',
  surmesure: 'generique'
};

function familyFor(templateId) {
  return FAMILIES[BY_TEMPLATE[templateId] || 'generique'];
}

function all() {
  return Object.keys(FAMILIES).map((k) => ({
    key: FAMILIES[k].key,
    label: FAMILIES[k].label,
    garde: FAMILIES[k].garde
  }));
}

module.exports = { FAMILIES, familyFor, all };
