'use strict';
/* Guide des pièces — le contenu affiché au client sur le lien de dépôt.
   RÈGLE ABSOLUE : ce texte est ÉCRIT, jamais généré à la volée par le modèle.
   Une indication fausse sur une démarche officielle fait perdre une journée à
   quelqu'un : c'est pire que pas d'indication du tout. Chaque entrée doit
   pouvoir être assumée par un humain devant un guichet.

   Champs :
     quoi       ce que c'est, en langage simple
     ou         où l'obtenir (type de lieu, pas de tarif inventé)
     accepte    ce qui passe
     refuse     ce qui fait renvoyer — c'est le cœur de valeur
     photo      comment le prendre / le scanner
     substituts ce qui est accepté si le client ne l'a pas
*/

const BY_KEY = {
  'avis-imposition': {
    quoi: "Le document que le service des impôts vous remet après votre déclaration : il indique vos revenus de l'année et l'impôt calculé.",
    ou: "Au centre des impôts dont vous dépendez (celui de votre commune ou de votre quartier).",
    accepte: [
      "La page où apparaissent vos nom, prénom, adresse et revenus",
      "Toutes les pages, si le document en comporte plusieurs",
      "Une copie, à condition qu'elle soit nette et complète"
    ],
    refuse: [
      "Le récépissé de dépôt de déclaration — ce n'est pas l'avis",
      "La première page seule, quand les revenus figurent en page 2",
      "L'avis d'une autre personne (conjoint, parent, associé)"
    ],
    photo: "À plat, les 4 coins visibles, sans reflet ni ombre.",
    substituts: [
      "Si vous n'êtes pas imposable : demandez au centre des impôts une attestation de non-imposition"
    ]
  },

  'piece-identite': {
    quoi: "Votre document officiel avec votre photo : carte nationale d'identité, passeport ou carte de séjour.",
    ou: "Vous l'avez déjà. S'il est perdu ou expiré, la démarche se fait à la mairie ou au commissariat.",
    accepte: [
      "Recto ET verso sur la même photo, ou deux photos séparées",
      "Le document en cours de validité",
      "Une photo nette où l'on lit le numéro et la date d'expiration"
    ],
    refuse: [
      "Le recto seul",
      "Un document expiré",
      "Une capture d'écran",
      "Une photo prise de loin, où le texte est illisible"
    ],
    photo: "Posez la carte à plat sur une table, cadrez les 4 bords, évitez le flash direct.",
    substituts: [
      "Passeport en cours de validité",
      "Carte de séjour ou titre équivalent",
      "Récépissé de renouvellement — à faire confirmer par votre cabinet"
    ]
  },

  'justif-domicile': {
    quoi: "Un papier récent qui prouve où vous habitez, et qui est à votre nom.",
    ou: "Une facture d'électricité (CEET) ou d'eau (TdE), ou d'internet ; un certificat de résidence délivré par la mairie ou la chefferie ; une quittance de loyer ; une attestation de votre propriétaire.",
    accepte: [
      "Moins de 3 mois",
      "À votre nom",
      "Avec l'adresse complète visible"
    ],
    refuse: [
      "Une facture de plus de 3 mois",
      "Une facture au nom d'un tiers, sans attestation",
      "Une enveloppe, un SMS de rappel ou un reçu de paiement"
    ],
    photo: "La page où figurent votre nom et l'adresse, les 4 coins visibles.",
    substituts: [
      "Attestation d'hébergement signée par la personne qui vous loge, avec sa pièce d'identité et un justificatif à son nom",
      "Une quittance de loyer récente"
    ]
  },

  'releves-bancaires': {
    quoi: "Les relevés que votre banque vous envoie chaque mois : on y voit ce qui entre et ce qui sort du compte.",
    ou: "Dans votre application bancaire (téléchargement en PDF) ou au guichet de votre agence.",
    accepte: [
      "Chaque relevé en entier, toutes les pages",
      "Les mois consécutifs demandés",
      "Le PDF de la banque, ou une impression nette"
    ],
    refuse: [
      "Seulement les dernières opérations",
      "Un relevé d'un autre compte que celui demandé",
      "Des pages manquantes"
    ],
    photo: "Scannez de préférence. Sinon, page par page, à plat, sans pli.",
    substituts: []
  },

  'liasse-fiscale': {
    quoi: "Le dossier comptable complet de l'année : bilan, compte de résultat et annexes.",
    ou: "Votre expert-comptable la produit.",
    accepte: [
      "Toutes les pages, y compris les annexes",
      "Signée par le gérant",
      "L'exercice demandé"
    ],
    refuse: [
      "Le bilan seul, sans les annexes",
      "Un exercice différent de celui demandé",
      "Un document non signé"
    ],
    photo: "Scannez plutôt que photographier : c'est un document de plusieurs pages.",
    substituts: []
  },

  'factures-achat': {
    quoi: "Toutes les factures de vos achats sur la période demandée.",
    ou: "Chez vous, chez votre comptable, ou dans votre logiciel de facturation.",
    accepte: [
      "Toutes les factures de la période",
      "Lisible : fournisseur, date, montant",
      "Un PDF regroupé si vous en avez un"
    ],
    refuse: [
      "Seulement « les plus importantes » — c'est la période entière qui est demandée",
      "Des tickets illisibles",
      "Une période incomplète"
    ],
    photo: "Regroupez en un seul PDF si possible ; sinon une photo nette par facture.",
    substituts: []
  },

  'factures-vente': {
    quoi: "Toutes les factures que vous avez émises à vos clients sur la période demandée.",
    ou: "Dans votre logiciel de facturation, votre carnet à souches, ou chez votre comptable.",
    accepte: [
      "Toutes les factures de la période",
      "Lisible : client, date, montant",
      "Un PDF regroupé si vous en avez un"
    ],
    refuse: [
      "Un export partiel",
      "Des factures sans numéro ni date",
      "Une période incomplète"
    ],
    photo: "Regroupez en un seul PDF si possible.",
    substituts: []
  },

  'charges-sociales': {
    quoi: "Les justificatifs des cotisations sociales versées (caisse de sécurité sociale, caisse de retraite).",
    ou: "Vos quittances ou attestations de la caisse, ou votre service de paie.",
    accepte: [
      "La période concernée",
      "Avec le montant et la date de paiement",
      "Toutes les pages du bordereau"
    ],
    refuse: [
      "Un bordereau d'un autre exercice",
      "Un document dont le montant est illisible"
    ],
    photo: "À plat, sans pli.",
    substituts: []
  },

  'contrats-emprunt': {
    quoi: "Les contrats des emprunts que votre entreprise rembourse encore.",
    ou: "Votre banque ou l'établissement prêteur.",
    accepte: [
      "Le contrat signé",
      "Le tableau d'amortissement joint",
      "Uniquement les emprunts encore en cours"
    ],
    refuse: [
      "Un contrat sans tableau d'amortissement",
      "Un emprunt déjà soldé"
    ],
    photo: "Toutes les pages, dans l'ordre.",
    substituts: []
  },

  'declarations-tva': {
    quoi: "Vos déclarations de TVA déposées sur la période demandée.",
    ou: "Votre espace fiscal en ligne, ou le service des impôts.",
    accepte: [
      "Toutes les périodes demandées",
      "Avec l'accusé de dépôt si vous l'avez",
      "Toutes les pages"
    ],
    refuse: [
      "Une partie seulement des périodes",
      "Des brouillons non déposés"
    ],
    photo: "Une déclaration par page.",
    substituts: []
  },

  'justif-activite': {
    quoi: "Un document qui prouve que vous exercez réellement votre activité.",
    ou: "Registre du commerce, patente, autorisation d'exercer, ou attestation d'activité.",
    accepte: [
      "En cours de validité",
      "À votre nom ou au nom de la structure",
      "Lisible et complet"
    ],
    refuse: [
      "Un document expiré",
      "Un document au nom d'une autre personne"
    ],
    photo: "À plat, les 4 coins visibles.",
    substituts: [
      "Une attestation d'activité signée par votre employeur, votre association ou votre client principal"
    ]
  },

  'depot-capital': {
    quoi: "Le papier de la banque qui prouve que le capital de la société a bien été versé.",
    ou: "La banque où le capital a été déposé.",
    accepte: [
      "L'original, ou une copie certifiée",
      "Au nom de la société en formation",
      "Avec le montant et la date"
    ],
    refuse: [
      "Un simple reçu de versement qui ne mentionne pas le capital",
      "Un document au nom personnel sans lien avec la société"
    ],
    photo: "L'original à plat, tampon et signature visibles.",
    substituts: []
  },

  'statuts': {
    quoi: "Le document qui fixe les règles de la société : associés, capital, objet, dirigeants.",
    ou: "Rédigés par vous, votre avocat, votre notaire ou votre expert-comptable.",
    accepte: [
      "Toutes les pages",
      "Signées par les associés",
      "La version définitive, pas le projet"
    ],
    refuse: [
      "Les pages de signature manquantes",
      "Un projet non signé"
    ],
    photo: "Scannez : plusieurs pages, souvent avec des annexes.",
    substituts: []
  },

  'rib': {
    quoi: "Le papier de votre banque qui donne votre numéro de compte (IBAN).",
    ou: "Votre banque, ou l'application bancaire (téléchargement du RIB).",
    accepte: [
      "Au nom du titulaire attendu",
      "Avec l'IBAN complet et lisible",
      "Un document émis par la banque"
    ],
    refuse: [
      "Un RIB au nom d'un tiers",
      "Un numéro recopié à la main",
      "Une capture partielle où l'IBAN est coupé"
    ],
    photo: "Cadrez jusqu'au bas de la page : l'IBAN est souvent en bas.",
    substituts: []
  },

  'piece-identite-associes': {
    quoi: "La pièce d'identité de chacun des associés de la société.",
    ou: "Chaque associé fournit la sienne.",
    accepte: [
      "Une pièce par associé",
      "Recto et verso",
      "En cours de validité"
    ],
    refuse: [
      "Les pièces de seulement certains associés",
      "Une pièce expirée"
    ],
    photo: "Une photo par associé, en indiquant son nom dans le message à votre cabinet.",
    substituts: []
  },

  'casier-judiciaire': {
    quoi: "Le document officiel qui indique si vous avez des condamnations. Le bulletin n°3 est celui que l'on demande habituellement.",
    ou: "Le tribunal ou le service compétent de votre lieu de naissance ou de résidence.",
    accepte: [
      "Moins de 3 mois",
      "L'original",
      "À votre nom exact, tel qu'il figure sur votre pièce d'identité"
    ],
    refuse: [
      "Un document de plus de 3 mois",
      "Une photocopie floue",
      "Le casier d'un autre membre de la famille"
    ],
    photo: "L'original à plat, les 4 coins visibles, tampon lisible.",
    substituts: []
  },

  'plan-localisation': {
    quoi: "Un plan ou une description qui permet de trouver le siège de l'entreprise.",
    ou: "Vous le dessinez, ou vous l'imprimez depuis une application de cartes.",
    accepte: [
      "Lisible",
      "Avec l'adresse écrite et un point de repère",
      "Signé si votre interlocuteur le demande"
    ],
    refuse: [
      "Une capture d'écran illisible",
      "Un plan sans adresse écrite"
    ],
    photo: "Cadrez l'ensemble du plan et l'adresse dans la même image.",
    substituts: []
  },

  'bail-commercial': {
    quoi: "Le contrat de location du local où l'entreprise a son siège.",
    ou: "Le propriétaire du local.",
    accepte: [
      "Signé par les deux parties",
      "Toutes les pages",
      "Toujours en cours de validité"
    ],
    refuse: [
      "Un bail expiré",
      "Un document non signé",
      "Une autorisation d'occupation verbale mise par écrit sans signature"
    ],
    photo: "Toutes les pages, y compris celle des signatures.",
    substituts: []
  },

  'bulletins-salaire': {
    quoi: "Les fiches de paie que votre employeur vous remet chaque mois.",
    ou: "Votre employeur, ou votre service du personnel.",
    accepte: [
      "Les mois consécutifs demandés",
      "Avec votre nom, la période et le net à payer",
      "Toutes les pages"
    ],
    refuse: [
      "Des bulletins non consécutifs",
      "Le bulletin d'une autre personne",
      "Un bulletin sans montant lisible"
    ],
    photo: "Un bulletin par page, à plat.",
    substituts: []
  },

  'contrat-travail': {
    quoi: "Le contrat signé entre vous et votre employeur.",
    ou: "Votre employeur, ou votre service du personnel.",
    accepte: [
      "Signé par les deux parties",
      "Toutes les pages, y compris les annexes",
      "La version en vigueur"
    ],
    refuse: [
      "Un contrat non signé",
      "Une promesse d'embauche à la place du contrat"
    ],
    photo: "Toutes les pages, notamment celle des signatures.",
    substituts: [
      "À défaut, une attestation de l'employeur qui précise le poste, le type de contrat et l'ancienneté"
    ]
  },

  'contrat': {
    quoi: "Le contrat de travail signé entre le salarié et l'employeur.",
    ou: "Votre service du personnel.",
    accepte: [
      "Signé par les deux parties",
      "Toutes les pages, y compris les annexes",
      "La version définitive"
    ],
    refuse: [
      "Un contrat non signé",
      "Un modèle vierge"
    ],
    photo: "Toutes les pages, dans l'ordre.",
    substituts: []
  },

  'apport-personnel': {
    quoi: "La preuve que vous disposez de la somme que vous apportez dans l'opération.",
    ou: "Vos relevés d'épargne, une attestation bancaire, ou un acte de vente si l'apport vient d'un bien.",
    accepte: [
      "Moins de 3 mois",
      "Au nom de l'emprunteur",
      "Avec le montant visible"
    ],
    refuse: [
      "Une déclaration sur l'honneur sans justificatif",
      "Un document au nom d'un tiers sans lien de parenté justifié"
    ],
    photo: "La page où figure le solde, en entier.",
    substituts: []
  },

  'credit-en-cours': {
    quoi: "La liste des crédits que vous remboursez déjà, avec les montants restants.",
    ou: "Vos relevés bancaires, ou une attestation de chaque établissement prêteur.",
    accepte: [
      "Tous les crédits en cours",
      "Avec la mensualité et le capital restant",
      "Moins de 3 mois"
    ],
    refuse: [
      "Oublier un crédit — cela ressortira sur les relevés",
      "Une liste manuscrite sans justificatif"
    ],
    photo: "Une attestation par crédit, ou la page du relevé qui montre le prélèvement.",
    substituts: []
  },

  'compromis-vente': {
    quoi: "Le document signé qui constate l'accord d'achat du bien.",
    ou: "L'agence immobilière ou le notaire.",
    accepte: [
      "Signé par l'acheteur et le vendeur",
      "Toutes les pages",
      "Avec le prix et l'adresse du bien"
    ],
    refuse: [
      "Un projet non signé",
      "Une simple annonce ou un message d'accord"
    ],
    photo: "Toutes les pages, signature comprise.",
    substituts: []
  },

  'garant-identite': {
    quoi: "La pièce d'identité de la personne qui se porte garant pour vous.",
    ou: "Le garant lui-même.",
    accepte: [
      "Recto et verso",
      "En cours de validité",
      "Au nom du garant déclaré dans le dossier"
    ],
    refuse: [
      "Une pièce expirée",
      "La pièce d'une autre personne que le garant déclaré"
    ],
    photo: "Les deux faces, à plat.",
    substituts: []
  },

  'garant-revenus': {
    quoi: "La preuve des revenus du garant.",
    ou: "Le garant : ses bulletins de salaire, son avis d'imposition ou ses relevés d'activité.",
    accepte: [
      "Moins de 3 mois",
      "Au nom du garant",
      "Avec le montant visible"
    ],
    refuse: [
      "Des documents au nom du demandeur au lieu du garant",
      "Des documents trop anciens"
    ],
    photo: "Un document par page.",
    substituts: []
  },

  'attestation-employeur': {
    quoi: "Un papier de votre employeur qui confirme votre poste, votre type de contrat et votre salaire.",
    ou: "Votre service du personnel.",
    accepte: [
      "Moins de 3 mois",
      "Avec cachet et signature de l'employeur",
      "Avec le salaire indiqué"
    ],
    refuse: [
      "Une attestation sans cachet ni signature",
      "Un document de plus de 3 mois",
      "Une lettre non signée"
    ],
    photo: "Cadrez jusqu'au cachet et à la signature.",
    substituts: []
  },

  'quittance-loyer': {
    quoi: "Le reçu que votre bailleur vous remet chaque mois pour le loyer payé.",
    ou: "Votre bailleur ou votre agence.",
    accepte: [
      "La dernière quittance",
      "Moins de 3 mois",
      "Avec le nom du bailleur et le montant"
    ],
    refuse: [
      "Un SMS ou un message de confirmation",
      "Une quittance de plus de 3 mois"
    ],
    photo: "À plat, signature du bailleur visible.",
    substituts: [
      "Une attestation du bailleur confirmant le paiement du loyer"
    ]
  },

  'photo-recente': {
    quoi: "Une photo d'identité récente, fond clair, tête nue.",
    ou: "Un photographe, ou une cabine.",
    accepte: [
      "Moins de 6 mois",
      "Fond clair et uni",
      "Visage de face, sans ombre"
    ],
    refuse: [
      "Une photo découpée dans un autre document",
      "Une photo de plus de 6 mois",
      "Une photo floue ou de profil"
    ],
    photo: "Scannez la photo plutôt que la photographier, pour éviter le reflet.",
    substituts: []
  },

  'carte-vitale': {
    quoi: "Votre carte d'assurance maladie.",
    ou: "L'organisme qui vous couvre.",
    accepte: [
      "Recto et verso",
      "Lisible",
      "En cours de validité"
    ],
    refuse: [
      "Le recto seul",
      "Une carte expirée"
    ],
    photo: "Les deux faces, à plat.",
    substituts: []
  },

  'diplomes': {
    quoi: "Les diplômes ou attestations qui justifient votre qualification.",
    ou: "Vous les avez ; sinon, l'établissement peut délivrer un duplicata ou une attestation de réussite.",
    accepte: [
      "Toutes les pages",
      "Lisibles",
      "Le diplôme correspondant au poste"
    ],
    refuse: [
      "Une photo partielle",
      "Un relevé de notes à la place du diplôme, si le diplôme est exigé"
    ],
    photo: "Le diplôme entier, cadre compris.",
    substituts: []
  },

  'justif-revenus': {
    quoi: "La preuve de ce que vous gagnez : salaire, activité indépendante ou autre revenu.",
    ou: "Bulletins de salaire, avis d'imposition, ou relevés de votre activité.",
    accepte: [
      "Moins de 3 mois",
      "À votre nom",
      "Avec le montant visible"
    ],
    refuse: [
      "Une déclaration sans justificatif",
      "Des documents au nom d'un tiers"
    ],
    photo: "La page où figure le montant.",
    substituts: [
      "Une attestation de revenus signée par votre employeur"
    ]
  },

  'rccm': {
    quoi: "Le registre du commerce : le document officiel qui prouve que l'entreprise existe légalement.",
    ou: "Le greffe du tribunal de commerce, ou le guichet unique de création d'entreprise.",
    accepte: [
      "En cours de validité",
      "Au nom de la structure",
      "Avec le numéro lisible"
    ],
    refuse: [
      "Un document expiré",
      "Un récépissé de dépôt, si le registre lui-même est exigé"
    ],
    photo: "Le document entier, numéro et cachet visibles.",
    substituts: []
  },

  'bilans': {
    quoi: "Les états financiers de l'exercice précédent : bilan et compte de résultat.",
    ou: "Votre comptable, ou votre logiciel de comptabilité.",
    accepte: [
      "L'exercice demandé",
      "Toutes les pages",
      "Signés si votre interlocuteur le demande"
    ],
    refuse: [
      "Un exercice plus ancien",
      "Des pages manquantes"
    ],
    photo: "Scannez plutôt que photographier.",
    substituts: []
  },

  /* ---- Modèles togolais / OHADA ---- */
  'cif': {
    quoi: "La carte ou l'attestation qui porte le numéro d'identification fiscale (NIF) de la structure, délivrée par l'administration fiscale.",
    ou: "Auprès de l'Office togolais des recettes (OTR), ou via le guichet unique des formalités d'entreprise.",
    accepte: ["Le NIF bien lisible", "Au nom exact de la structure", "Recto et verso si le document en a deux"],
    refuse: ["Un document au nom d'une autre structure", "Une photo où le numéro est coupé ou flou"],
    photo: "À plat, tous les bords visibles, sans reflet sur le numéro.",
    substituts: ["Une attestation de NIF délivrée par l'administration — à faire confirmer par votre cabinet"]
  },
  'carte-cfe': {
    quoi: "Le document remis par le guichet unique des formalités d'entreprise lors de l'immatriculation.",
    ou: "Au Centre de formalités des entreprises (guichet unique) où l'entreprise a été enregistrée.",
    accepte: ["Au nom de la structure", "Toutes les pages", "Cachet et numéro lisibles"],
    refuse: ["Un reçu de paiement seul", "Une page manquante"],
    photo: "À plat, cachet bien visible.",
    substituts: []
  },
  'declarations-fiscales': {
    quoi: "Les déclarations d'impôts déposées par l'entreprise, avec l'accusé ou le justificatif de dépôt.",
    ou: "Dans vos archives, ou sur l'espace en ligne de l'administration fiscale ; sinon votre comptable.",
    accepte: ["La déclaration complète", "L'accusé ou le cachet de dépôt", "La période demandée"],
    refuse: ["Une déclaration sans preuve de dépôt", "Une autre période que celle demandée"],
    photo: "Scannez plutôt que photographier, page par page.",
    substituts: []
  },
  'quittances-impots': {
    quoi: "Les reçus qui prouvent que les impôts ont été payés.",
    ou: "Remis au moment du paiement (caisse, banque ou paiement en ligne) ; sinon votre comptable.",
    accepte: ["Montant, date et référence lisibles", "La période concernée"],
    refuse: ["Un ordre de virement non validé", "Un montant illisible"],
    photo: "À plat, montant et date bien visibles.",
    substituts: ["Relevé bancaire montrant le paiement, en complément"]
  },
  'retenues-source': {
    quoi: "Les justificatifs des retenues d'impôt prélevées à la source, sur vos factures ou sur celles que vous payez.",
    ou: "Attestations de retenue remises par vos clients ou fournisseurs ; sinon votre comptable.",
    accepte: ["Montant retenu et période lisibles", "Nom de la partie concernée"],
    refuse: ["Un justificatif sans montant", "Un document d'une autre période"],
    photo: "À plat, sans pli.",
    substituts: []
  },
  'avis-tpu': {
    quoi: "L'avis ou la quittance de la taxe professionnelle des petites entreprises.",
    ou: "À l'administration fiscale ou à l'ancien point de paiement ; à confirmer avec votre cabinet.",
    accepte: ["Au nom de l'exploitant", "L'année demandée", "Montant lisible"],
    refuse: ["Une année différente", "Un reçu sans nom"],
    photo: "À plat, nom et montant visibles.",
    substituts: []
  },
  'releves-mobile-money': {
    quoi: "L'historique de votre compte T-Money ou Flooz : ce qui entre et ce qui sort.",
    ou: "Dans l'application ou via le code USSD de l'opérateur, ou dans une agence de l'opérateur.",
    accepte: ["La période demandée en entier", "Votre nom et votre numéro visibles", "Un PDF ou des captures qui se suivent sans trou"],
    refuse: ["Seulement quelques opérations", "Des captures sans dates", "Le relevé d'un autre numéro"],
    photo: "Si ce sont des captures d'écran, prenez-les dans l'ordre, sans rien couper.",
    substituts: []
  },
  'domiciliation-salaire': {
    quoi: "Un papier de votre banque ou de votre employeur qui confirme que votre salaire est versé sur votre compte.",
    ou: "À votre banque (agence), ou auprès du service du personnel de votre employeur.",
    accepte: ["Moins de 3 mois", "Nom, banque et numéro de compte visibles", "Cachet et signature"],
    refuse: ["Sans cachet ni signature", "Au nom d'une autre personne"],
    photo: "À plat, cachet visible.",
    substituts: []
  },
  'registre-personnel': {
    quoi: "La liste tenue par l'entreprise de tous ses salariés, avec leur date d'entrée.",
    ou: "Tenu par l'entreprise ; votre responsable administratif l'a.",
    accepte: ["La version à jour", "Toutes les pages"],
    refuse: ["Une version ancienne", "Pages manquantes"],
    photo: "Scannez page par page, à plat.",
    substituts: []
  },
  'cnss-employeur': {
    quoi: "Le document qui prouve que l'entreprise est inscrite à la Caisse nationale de sécurité sociale comme employeur.",
    ou: "À la CNSS, ou via le guichet unique lors de la création.",
    accepte: ["Au nom de l'entreprise", "Numéro employeur lisible"],
    refuse: ["Un document au nom d'un salarié", "Numéro illisible"],
    photo: "À plat, numéro bien visible.",
    substituts: []
  },
  'cnss-salarie': {
    quoi: "Le numéro d'immatriculation du salarié à la CNSS, sur sa carte ou son attestation.",
    ou: "À la CNSS, ou auprès de l'employeur qui fait l'immatriculation.",
    accepte: ["Nom et numéro lisibles"],
    refuse: ["Une photo floue", "Un numéro d'une autre personne"],
    photo: "À plat, numéro net.",
    substituts: ["Si le salarié n'en a pas encore : le dire à l'employeur, qui fait la démarche"]
  },
  'dpe': {
    quoi: "La déclaration que l'employeur fait avant l'arrivée d'un salarié.",
    ou: "Établie par l'employeur ou son cabinet.",
    accepte: ["Datée avant la prise de poste", "Nom du salarié et de l'employeur"],
    refuse: ["Une déclaration non datée", "Un autre salarié"],
    photo: "Scannez, toutes les pages.",
    substituts: []
  },
  'visite-medicale': {
    quoi: "Le certificat du médecin qui constate l'aptitude du salarié avant l'embauche.",
    ou: "Chez un médecin agréé ou un service de santé au travail.",
    accepte: ["Daté", "Nom du salarié", "Cachet et signature du médecin"],
    refuse: ["Un certificat sans cachet", "Une date trop ancienne"],
    photo: "À plat, cachet visible.",
    substituts: []
  },
  'etats-variables': {
    quoi: "Ce qui change le mois : heures supplémentaires, absences, primes, congés.",
    ou: "Votre suivi interne (cahier ou tableur).",
    accepte: ["Tous les salariés concernés", "Le mois précisé", "Les chiffres lisibles"],
    refuse: ["Un tableau sans période", "Des chiffres rayés non corrigés"],
    photo: "Un tableur ou un PDF est préférable à une photo.",
    substituts: []
  },
  'inventaire-stock': {
    quoi: "La liste de ce qui est en stock à la fin de l'exercice, avec quantités et valeurs.",
    ou: "Dressée par l'entreprise à la clôture (comptage physique).",
    accepte: ["Daté et signé", "Quantités et valeurs", "Toutes les pages"],
    refuse: ["Sans date", "Sans valeurs", "Pages manquantes"],
    photo: "Scannez page par page.",
    substituts: []
  },
  'immobilisations': {
    quoi: "Les gros achats ou ventes de l'exercice : véhicule, matériel, immeuble.",
    ou: "Vos factures et actes d'achat ou de vente.",
    accepte: ["Les factures ou actes complets", "La date et le montant lisibles"],
    refuse: ["Un devis à la place de la facture", "Un montant illisible"],
    photo: "À plat, toutes les pages.",
    substituts: []
  },
  'procuration': {
    quoi: "L'autorisation signée qui permet au cabinet d'agir à votre place auprès de l'administration.",
    ou: "Le cabinet vous remet un modèle à signer.",
    accepte: ["Signée par le gérant", "Datée", "Au nom de la bonne structure"],
    refuse: ["Non signée", "Signée par une personne sans pouvoir"],
    photo: "À plat, signature visible.",
    substituts: []
  },
  'acte-naissance': {
    quoi: "L'extrait de votre acte de naissance, délivré par l'état civil.",
    ou: "À la mairie ou au centre d'état civil du lieu de naissance.",
    accepte: ["Moins de 3 mois", "Cachet et signature", "Nom, date et lieu lisibles"],
    refuse: ["Une photocopie sans cachet", "Un extrait trop ancien"],
    photo: "À plat, cachet net.",
    substituts: []
  },
  'non-condamnation': {
    quoi: "Une déclaration signée qui atteste ne pas avoir été condamné pour les infractions qui interdisent de diriger une entreprise.",
    ou: "Le cabinet ou le guichet unique remet le modèle ; vous le signez.",
    accepte: ["Signée et datée", "Votre identité complète"],
    refuse: ["Non signée", "Sans date"],
    photo: "À plat, signature visible.",
    substituts: []
  },
  'pv-nomination': {
    quoi: "Le procès-verbal où les associés nomment le ou les dirigeants.",
    ou: "Établi à la création ou à chaque changement de dirigeant.",
    accepte: ["Signé par les associés", "Daté", "Toutes les pages"],
    refuse: ["Non signé", "Pages manquantes"],
    photo: "Scannez page par page.",
    substituts: []
  },
  'beneficiaire-effectif': {
    quoi: "La déclaration qui indique qui détient ou contrôle réellement l'entreprise.",
    ou: "Un modèle est fourni par la banque ou le cabinet ; le dirigeant le remplit et le signe.",
    accepte: ["Complète", "Signée et datée", "Les personnes concernées nommées"],
    refuse: ["Des champs vides", "Non signée"],
    photo: "À plat, signature visible.",
    substituts: []
  },
  'livre-recettes': {
    quoi: "Le cahier où vous notez ce que vous encaissez et ce que vous dépensez.",
    ou: "Votre propre cahier ; à défaut, un tableur.",
    accepte: ["Les dates et les montants lisibles", "La période demandée en entier"],
    refuse: ["Des pages arrachées", "Une écriture illisible"],
    photo: "Page par page, à plat, bonne lumière.",
    substituts: ["Un tableur ou des notes classées par date"]
  },
  'titre-foncier': {
    quoi: "Le titre qui prouve la propriété d'un terrain ou d'un bien.",
    ou: "À la conservation foncière, ou chez le notaire ou le vendeur.",
    accepte: ["Toutes les pages", "Nom du propriétaire et numéro lisibles"],
    refuse: ["Un seul extrait de page", "Au nom d'un tiers sans acte de vente"],
    photo: "Scannez page par page.",
    substituts: ["Une attestation de propriété — à faire confirmer par votre banque"]
  },
  'permis-construire': {
    quoi: "L'autorisation officielle de construire.",
    ou: "À la mairie ou au service d'urbanisme.",
    accepte: ["Signé et tamponné", "Au nom du demandeur", "Toutes les pages"],
    refuse: ["Une simple demande non accordée", "Pages manquantes"],
    photo: "À plat, cachet visible.",
    substituts: []
  },
  'devis-bien': {
    quoi: "Le devis ou la facture proforma du bien ou des travaux à financer.",
    ou: "Donné par le fournisseur ou l'entrepreneur.",
    accepte: ["Daté et signé du fournisseur", "Montant et description clairs"],
    refuse: ["Sans nom du fournisseur", "Montant illisible"],
    photo: "À plat, signature visible.",
    substituts: []
  }
};

/* Repli par le libellé : une pièce ajoutée à la main (« Pièce n°1 ») n'a pas de
   clé connue. On reconnaît alors le type de document au mot du libellé.
   L'ordre compte : le plus spécifique d'abord. */
const BY_LABEL = [
  [/casier/i, 'casier-judiciaire'],
  [/garant/i, 'garant-revenus', /revenu|salaire|paie/i],
  [/garant/i, 'garant-identite'],
  [/photo/i, 'photo-recente'],
  [/bancaire|relev/i, 'releves-bancaires'],
  [/salaire|paie|bulletin/i, 'bulletins-salaire'],
  [/imp[oô]t|imposition|fiscal/i, 'avis-imposition'],
  [/tva/i, 'declarations-tva'],
  [/domicile|h[ée]bergement/i, 'justif-domicile'],
  [/quittance|loyer/i, 'quittance-loyer'],
  [/employeur/i, 'attestation-employeur'],
  [/contrat.*travail/i, 'contrat-travail'],
  [/contrat/i, 'contrat'],
  [/identit|cni|passeport/i, 'piece-identite'],
  [/rib|iban/i, 'rib'],
  [/statut/i, 'statuts'],
  [/capital/i, 'depot-capital'],
  [/bilan|[ée]tats financiers/i, 'bilans'],
  [/rccm|registre/i, 'rccm'],
  [/revenu/i, 'justif-revenus'],
  [/activit[ée]/i, 'justif-activite'],
  [/dipl[oô]me/i, 'diplomes'],
  [/vitale/i, 'carte-vitale']
];

function byLabel(label) {
  const text = String(label || '');
  for (const entry of BY_LABEL) {
    const [re, key, extra] = entry;
    if (!re.test(text)) continue;
    if (extra && !extra.test(text)) continue;
    if (BY_KEY[key]) return key;
  }
  return null;
}

/* Renvoie le guide d'une pièce, ou null si nous n'avons rien de fiable à dire.
   Mieux vaut ne rien afficher qu'afficher une approximation. */
function forPiece(key, label) {
  if (key && BY_KEY[key]) return BY_KEY[key];
  const guess = byLabel(label);
  return guess ? BY_KEY[guess] : null;
}

/* Conseils de reprise pour un refus : les causes de rejet les plus fréquentes.
   Utilisé côté serveur quand un motif est enregistré, pour ne pas laisser le
   client devant un simple « refusé ». */
function conseils(key, label) {
  const g = forPiece(key, label);
  return g ? { photo: g.photo || '', refuse: g.refuse || [] } : null;
}

module.exports = { forPiece, conseils, keys: Object.keys(BY_KEY) };
