# Modèles de dossiers — sources et niveau de confiance

Source de vérité du code : `server/lib/templates.js` (modèles) et `server/lib/guide.js` (guides).
Les modèles **proposent** ; le cabinet coche et décoche. Aucun n'est présenté au client comme « exigence officielle ».

## Établi (sources officielles ou publiques)
- Actes fiscaux courants de l'OTR (CIF/NIF, attestations de régularité, quitus pour marchés, domiciliation fiscale) et pièces habituelles : modèles `regularite`, `bilan`, `tva`.
- Seuil de TVA de 100 M FCFA depuis le 1er janvier 2025 (auparavant 60 M) : non écrit dans les libellés pour ne pas vieillir.
- Retenue à la source sur BNC (taux selon présence de NIF/ARF) : pièce « justificatifs de retenues ».
- États financiers SYSCOHADA révisé : système normal (bilan, compte de résultat, TFT, notes annexes) vs système minimal de trésorerie.
- CNSS : déclaration préalable à l'embauche, immatriculation, registre du personnel, visite médicale d'embauche : modèles `paie`, `onboarding`.

## Plausible mais à faire valider par un expert-comptable togolais
- Liste exacte des pièces du guichet unique (CFE) : source de 2018, tarifs périmés, non repris.
- Taxe professionnelle unique (modèle `tpu`) : intitulé et pièce à confirmer.
- Pièces KYC bancaires / microfinance (`kyc`, `kyc-entreprise`) : à aligner sur les exigences de chaque établissement.
- Pièces d'un dossier locataire au Togo (aucune source fiable trouvée) : pièces génériques.
- Crédit immobilier : liste inspirée de la pratique UEMOA (source Côte d'Ivoire).

## Volontairement absents
- Dates limites de dépôt, montants, tarifs : trop changeants, non écrits dans les guides.
- Dénomination IRPP / ITS : évitée.
- Pièces françaises par défaut : carte vitale, avis d'imposition, casier systématique (restent possibles à la demande).

## Compatibilité
Les dossiers existants gardent leurs pièces (copiées à la création). Les clés historiques conservent leur guide.
