'use strict';
/* Modèles de dossiers — réalité togolaise / OHADA.

   Une bibliothèque unique de pièces (LIB), puis des modèles qui y piochent.
   Une pièce = { label, rule, group }. Un modèle peut surcharger libellé ou règle
   pour sa propre situation, sans dupliquer la pièce.

   Les clés (`key`) sont stables : elles servent à retrouver le guide (guide.js).
   Ne jamais renommer une clé existante : des dossiers en cours la portent.

   Points à faire valider par un expert-comptable togolais avant de les promettre
   comme « exigence officielle » : voir documents/modeles-dossiers-sources.md.
   Les modèles proposent, le cabinet décide : tout se coche et se décoche. */

const G = {
  id: 'Identité',
  ent: 'Entreprise',
  fisc: 'Fiscalité',
  bank: 'Banque & mobile money',
  compta: 'Comptabilité',
  social: 'Social & paie',
  emploi: 'Emploi & revenus',
  logement: 'Logement',
  projet: 'Projet financé'
};

const LIB = {
  /* Identité */
  'piece-identite': { label: "Pièce d'identité", rule: 'en cours de validité', group: G.id },
  'piece-identite-associes': { label: "Pièce d'identité de chaque associé", rule: 'en cours de validité', group: G.id },
  'photo-recente': { label: "Photo d'identité récente", rule: 'moins de 6 mois', group: G.id },
  'acte-naissance': { label: 'Extrait d\'acte de naissance', rule: 'moins de 3 mois', group: G.id },
  'justif-domicile': { label: 'Justificatif de domicile', rule: 'moins de 3 mois, à votre nom', group: G.id },
  'casier-judiciaire': { label: 'Casier judiciaire', rule: 'moins de 3 mois', group: G.id },
  'non-condamnation': { label: 'Déclaration de non-condamnation', rule: 'signée', group: G.id },

  /* Entreprise */
  'cif': { label: "Carte d'identifiant fiscal (NIF)", rule: 'lisible, au nom de la structure', group: G.ent },
  'rccm': { label: 'Registre du commerce (RCCM)', rule: 'en cours de validité', group: G.ent },
  'carte-cfe': { label: 'Attestation ou carte du guichet unique (CFE)', rule: 'au nom de la structure', group: G.ent },
  'statuts': { label: 'Statuts signés', rule: 'toutes les pages', group: G.ent },
  'depot-capital': { label: 'Attestation de dépôt du capital', rule: 'originale', group: G.ent },
  'pv-nomination': { label: 'PV de nomination des dirigeants', rule: 'signé', group: G.ent },
  'beneficiaire-effectif': { label: 'Déclaration du bénéficiaire effectif', rule: 'signée', group: G.ent },
  'bail-commercial': { label: 'Bail ou titre d\'occupation du siège', rule: 'signé', group: G.ent },
  'plan-localisation': { label: 'Plan de localisation du siège', rule: 'lisible', group: G.ent },
  'procuration': { label: 'Mandat ou procuration au cabinet', rule: 'signé', group: G.ent },
  'cnss-employeur': { label: "Attestation d'immatriculation employeur (CNSS)", rule: 'en cours de validité', group: G.ent },

  /* Fiscalité */
  'declarations-fiscales': { label: 'Déclarations fiscales et accusés de dépôt', rule: 'exercice concerné', group: G.fisc },
  'declarations-tva': { label: 'Déclarations de TVA', rule: 'période concernée', group: G.fisc },
  'quittances-impots': { label: "Quittances de paiement des impôts", rule: 'période concernée', group: G.fisc },
  'retenues-source': { label: 'Justificatifs de retenues à la source', rule: 'période concernée', group: G.fisc },
  'avis-imposition': { label: "Avis d'imposition (si imposable)", rule: 'dernière année', group: G.fisc },
  'avis-tpu': { label: 'Dernier avis ou quittance de taxe professionnelle unique', rule: 'année en cours', group: G.fisc },

  /* Banque */
  'rib': { label: 'RIB / relevé d\'identité bancaire', rule: 'au nom du titulaire', group: G.bank },
  'releves-bancaires': { label: 'Relevés bancaires', rule: '3 derniers mois, toutes les pages', group: G.bank },
  'releves-mobile-money': { label: 'Relevés T-Money / Flooz', rule: '3 derniers mois', group: G.bank },
  'domiciliation-salaire': { label: 'Attestation de domiciliation de salaire', rule: 'moins de 3 mois', group: G.bank },

  /* Comptabilité */
  'factures-achat': { label: "Factures d'achat", rule: 'toutes les pages', group: G.compta },
  'factures-vente': { label: 'Factures de vente', rule: 'toutes les pages', group: G.compta },
  'liasse-fiscale': { label: 'États financiers N-1 (bilan, compte de résultat, notes)', rule: 'signés', group: G.compta },
  'bilans': { label: 'Derniers états financiers', rule: 'exercice N-1', group: G.compta },
  'inventaire-stock': { label: 'État des stocks à la clôture', rule: 'daté et signé', group: G.compta },
  'immobilisations': { label: 'Acquisitions et cessions de l\'exercice', rule: 'factures ou actes joints', group: G.compta },
  'contrats-emprunt': { label: "Contrats d'emprunt en cours", rule: "tableau d'amortissement joint", group: G.compta },
  'livre-recettes': { label: 'Cahier de recettes et de dépenses', rule: 'toutes les pages', group: G.compta },
  'justif-activite': { label: "Justificatif d'activité", rule: 'moins de 12 mois', group: G.compta },

  /* Social & paie */
  'charges-sociales': { label: 'Déclarations et quittances CNSS', rule: 'période concernée', group: G.social },
  'registre-personnel': { label: 'Registre du personnel', rule: 'à jour', group: G.social },
  'etats-variables': { label: 'Éléments variables du mois', rule: 'heures, absences, primes', group: G.social },
  'dpe': { label: "Déclaration préalable à l'embauche", rule: 'avant la prise de poste', group: G.social },
  'cnss-salarie': { label: 'Numéro ou carte CNSS du salarié', rule: 'lisible', group: G.social },
  'visite-medicale': { label: "Certificat de visite médicale d'embauche", rule: 'daté', group: G.social },
  'contrat': { label: 'Contrat de travail signé', rule: 'toutes les pages', group: G.social },
  'diplomes': { label: 'Diplômes et attestations', rule: 'toutes les pages', group: G.social },

  /* Emploi & revenus */
  'bulletins-salaire': { label: 'Bulletins de salaire', rule: '3 derniers mois', group: G.emploi },
  'contrat-travail': { label: 'Contrat de travail', rule: 'signé', group: G.emploi },
  'attestation-employeur': { label: "Attestation de l'employeur", rule: 'moins de 3 mois', group: G.emploi },
  'justif-revenus': { label: 'Justificatif de revenus', rule: 'moins de 3 mois', group: G.emploi },
  'credit-en-cours': { label: 'Tableau des crédits en cours', rule: 'moins de 3 mois', group: G.emploi },
  'garant-identite': { label: "Pièce d'identité du garant", rule: 'en cours de validité', group: G.emploi },
  'garant-revenus': { label: 'Revenus du garant', rule: 'moins de 3 mois', group: G.emploi },

  /* Logement */
  'quittance-loyer': { label: 'Dernière quittance de loyer', rule: 'moins de 3 mois', group: G.logement },

  /* Projet financé */
  'apport-personnel': { label: "Justificatif d'apport personnel", rule: 'moins de 3 mois', group: G.projet },
  'compromis-vente': { label: 'Promesse ou acte de vente', rule: 'signé', group: G.projet },
  'titre-foncier': { label: 'Titre foncier ou attestation de propriété', rule: 'lisible, complet', group: G.projet },
  'permis-construire': { label: 'Permis de construire', rule: 'si construction', group: G.projet },
  'devis-bien': { label: 'Devis ou facture proforma', rule: 'daté, signé du fournisseur', group: G.projet }
};

/* p('cle') ou p('cle', { label, rule }) : une pièce du catalogue d'un modèle. */
function p(key, over) {
  const base = LIB[key];
  if (!base) throw new Error('Pièce inconnue dans la bibliothèque : ' + key);
  return Object.assign({ key }, base, over || {});
}

const TEMPLATES = [
  {
    id: 'bilan', name: 'Clôture annuelle et états financiers', family: 'Expert-comptable',
    about: "Tout ce qu'il faut pour arrêter les comptes d'un exercice.",
    defaults: ['cif', 'releves-bancaires', 'factures-achat', 'factures-vente', 'liasse-fiscale', 'declarations-fiscales', 'charges-sociales'],
    catalog: [
      p('cif'), p('rccm'), p('piece-identite', { label: "Pièce d'identité du gérant" }),
      p('releves-bancaires', { label: 'Relevés bancaires de tous les comptes', rule: "12 mois de l'exercice" }),
      p('releves-mobile-money', { rule: "12 mois de l'exercice" }),
      p('factures-achat', { label: "Factures d'achat de l'exercice" }),
      p('factures-vente', { label: "Factures de vente de l'exercice" }),
      p('liasse-fiscale'), p('inventaire-stock'), p('immobilisations'), p('contrats-emprunt'),
      p('declarations-fiscales'), p('declarations-tva', { label: 'Déclarations de TVA', rule: "toutes celles de l'exercice" }),
      p('charges-sociales', { rule: "exercice concerné" }), p('registre-personnel')
    ]
  },
  {
    id: 'tva', name: 'TVA et déclarations périodiques', family: 'Expert-comptable',
    about: 'Les pièces du mois ou du trimestre pour établir les déclarations.',
    defaults: ['factures-vente', 'factures-achat', 'releves-bancaires', 'declarations-tva'],
    catalog: [
      p('factures-vente', { label: 'Factures de vente de la période' }),
      p('factures-achat', { label: "Factures d'achat de la période" }),
      p('releves-bancaires', { label: 'Relevés bancaires de la période', rule: 'toutes les pages' }),
      p('releves-mobile-money', { label: 'Relevés T-Money / Flooz de la période', rule: 'toutes les pages' }),
      p('declarations-tva', { label: 'Dernière déclaration de TVA et accusé de dépôt', rule: 'période précédente' }),
      p('retenues-source'), p('quittances-impots'), p('charges-sociales'), p('cif')
    ]
  },
  {
    id: 'regularite', name: 'Attestation fiscale (régularité, quitus)', family: 'Expert-comptable',
    about: "Dossier pour obtenir une attestation de l'administration fiscale (marchés, banque, appel d'offres).",
    defaults: ['cif', 'rccm', 'carte-cfe', 'declarations-fiscales', 'quittances-impots', 'procuration'],
    catalog: [
      p('cif'), p('rccm'), p('carte-cfe'), p('statuts'),
      p('piece-identite', { label: "Pièce d'identité du gérant" }),
      p('declarations-fiscales', { label: 'Déclarations fiscales des derniers exercices et accusés de dépôt', rule: 'toutes les périodes exigibles' }),
      p('quittances-impots', { label: 'Quittances de paiement des impôts', rule: 'à jour' }),
      p('liasse-fiscale'), p('cnss-employeur'), p('bail-commercial'), p('procuration')
    ]
  },
  {
    id: 'paie', name: 'Paie et déclarations CNSS', family: 'Expert-comptable',
    about: 'Le mois de paie : variables, déclarations sociales, dossier des salariés.',
    defaults: ['etats-variables', 'bulletins-salaire', 'charges-sociales', 'registre-personnel'],
    catalog: [
      p('etats-variables'),
      p('bulletins-salaire', { label: 'Bulletins de salaire du mois précédent', rule: 'tous les salariés' }),
      p('charges-sociales', { rule: 'dernier mois payé' }),
      p('cnss-employeur'), p('registre-personnel'),
      p('contrat', { label: 'Contrat de travail des nouveaux salariés' }),
      p('dpe'), p('cnss-salarie'), p('visite-medicale'),
      p('piece-identite', { label: "Pièce d'identité des nouveaux salariés" }),
      p('rib', { label: 'RIB ou numéro mobile money des salariés', rule: 'au nom du salarié' })
    ]
  },
  {
    id: 'creation', name: "Création d'entreprise", family: 'Expert-comptable',
    about: 'Formalités auprès du guichet unique : dirigeants, siège, capital.',
    defaults: ['piece-identite', 'justif-domicile', 'casier-judiciaire', 'statuts', 'depot-capital', 'bail-commercial', 'plan-localisation'],
    catalog: [
      p('piece-identite', { label: "Pièce d'identité du dirigeant" }),
      p('piece-identite-associes'), p('photo-recente'), p('acte-naissance'),
      p('justif-domicile', { label: 'Justificatif de domicile ou certificat de résidence' }),
      p('casier-judiciaire'), p('non-condamnation'),
      p('statuts'), p('depot-capital'), p('pv-nomination'), p('beneficiaire-effectif'),
      p('bail-commercial'), p('plan-localisation'), p('rib', { label: 'RIB professionnel', rule: 'au nom de la société' })
    ]
  },
  {
    id: 'tpu', name: 'Petite entreprise et formalisation', family: 'Expert-comptable',
    about: 'Commerçants et artisans : un dossier simple, sans comptabilité complexe.',
    defaults: ['piece-identite', 'cif', 'livre-recettes', 'releves-mobile-money', 'factures-achat'],
    catalog: [
      p('piece-identite'), p('cif'), p('carte-cfe'), p('avis-tpu'),
      p('livre-recettes'), p('releves-mobile-money'), p('releves-bancaires'),
      p('factures-achat'), p('factures-vente'), p('justif-activite')
    ]
  },
  {
    id: 'credit', name: 'Crédit immobilier ou personnel', family: 'Banque & courtage',
    about: 'Constitution du dossier de prêt : revenus, apport, bien financé.',
    defaults: ['piece-identite', 'justif-domicile', 'bulletins-salaire', 'attestation-employeur', 'domiciliation-salaire', 'releves-bancaires', 'compromis-vente', 'titre-foncier'],
    catalog: [
      p('piece-identite'), p('justif-domicile'), p('acte-naissance'),
      p('bulletins-salaire'), p('contrat-travail'), p('attestation-employeur'), p('domiciliation-salaire'),
      p('releves-bancaires', { rule: '6 derniers mois, toutes les pages' }),
      p('releves-mobile-money'), p('avis-imposition'), p('credit-en-cours'), p('apport-personnel'),
      p('compromis-vente'), p('titre-foncier'), p('permis-construire'), p('devis-bien'),
      p('garant-identite'), p('garant-revenus')
    ]
  },
  {
    id: 'locataire', name: 'Dossier locataire', family: 'Immobilier',
    about: 'Candidature à la location : identité, revenus, garant.',
    defaults: ['piece-identite', 'justif-domicile', 'bulletins-salaire', 'attestation-employeur'],
    catalog: [
      p('piece-identite'), p('photo-recente'),
      p('justif-domicile', { label: 'Justificatif de domicile actuel' }),
      p('bulletins-salaire'), p('contrat-travail'), p('attestation-employeur'),
      p('justif-revenus', { label: 'Justificatif de revenus (si activité indépendante)' }),
      p('releves-mobile-money'), p('releves-bancaires'),
      p('quittance-loyer', { label: 'Dernière quittance de loyer (logement actuel)' }),
      p('garant-identite'), p('garant-revenus')
    ]
  },
  {
    id: 'onboarding', name: 'Embauche d\'un salarié', family: 'RH & freelance',
    about: 'Dossier administratif à réunir à l\'arrivée d\'un salarié.',
    defaults: ['piece-identite', 'photo-recente', 'acte-naissance', 'contrat', 'cnss-salarie', 'visite-medicale', 'rib'],
    catalog: [
      p('piece-identite'), p('photo-recente'), p('acte-naissance'),
      p('justif-domicile', { label: 'Justificatif de domicile ou certificat de résidence' }),
      p('contrat'), p('diplomes'), p('casier-judiciaire'),
      p('cnss-salarie'), p('visite-medicale'), p('dpe'),
      p('rib', { label: 'RIB ou numéro mobile money', rule: 'au nom du salarié' })
    ]
  },
  {
    id: 'kyc', name: 'Ouverture de compte (particulier)', family: 'Microfinance & banque',
    about: 'Identification d\'un client avant ouverture de compte.',
    defaults: ['piece-identite', 'photo-recente', 'justif-domicile', 'justif-activite'],
    catalog: [
      p('piece-identite'), p('photo-recente'), p('justif-domicile'),
      p('justif-activite'), p('justif-revenus'), p('releves-mobile-money'),
      p('bulletins-salaire'), p('attestation-employeur'), p('cif', { label: 'NIF (si activité professionnelle)', rule: 'lisible' })
    ]
  },
  {
    id: 'kyc-entreprise', name: 'Ouverture de compte (entreprise)', family: 'Microfinance & banque',
    about: 'Identification d\'une société : existence légale, dirigeants, bénéficiaire effectif.',
    defaults: ['rccm', 'cif', 'statuts', 'piece-identite', 'pv-nomination', 'beneficiaire-effectif', 'bail-commercial'],
    catalog: [
      p('rccm'), p('cif'), p('carte-cfe'), p('statuts'),
      p('piece-identite', { label: "Pièce d'identité des dirigeants" }),
      p('piece-identite-associes'), p('pv-nomination'), p('beneficiaire-effectif'),
      p('bail-commercial'), p('justif-domicile', { label: 'Justificatif de domicile du dirigeant' }),
      p('bilans'), p('releves-bancaires', { label: 'Relevés bancaires des autres banques' })
    ]
  },
  {
    id: 'surmesure', name: 'Dossier sur-mesure', family: 'Personnalisé',
    about: 'Vous choisissez et nommez vous-même chaque pièce.',
    defaults: ['piece-1', 'piece-2', 'piece-3'],
    catalog: [
      { key: 'piece-1', label: 'Première pièce', rule: 'selon vos règles', group: 'Personnalisé' },
      { key: 'piece-2', label: 'Deuxième pièce', rule: 'selon vos règles', group: 'Personnalisé' },
      { key: 'piece-3', label: 'Troisième pièce', rule: 'selon vos règles', group: 'Personnalisé' }
    ]
  }
];

module.exports = { TEMPLATES, LIB, GROUPS: G };
