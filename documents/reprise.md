# Point de reprise (21 novembre 2026)

Livré et en ligne (main) : isolation par ligne (0004), champs extraits + contrôles croisés + relances (0005), rôles et droits.

## Double authentification : abandonnée (décision du propriétaire, 21 novembre)
Jugée trop difficile à utiliser pour les cabinets. Le code, la page « Sécurité », les tests et la dépendance `qrcode` ont été retirés de main.
- La migration `0006_double_authentification.sql` est conservée dans le dépôt : elle est déjà appliquée en production (hash enregistré dans aura.schema_migrations) et ne doit jamais être modifiée. Ses quatre colonnes `totp_*` de `aura.users` restent en base, inutilisées et sans effet.
- Le code retiré reste récupérable dans l'historique git (commits edb5c8b, 65abe57, 892c9e2) si le sujet revient, par exemple pour de grands cabinets.
- Alternative légère à étudier plus tard si un acheteur exige plus que le mot de passe : lien de connexion par e-mail ou WhatsApp, sans application à installer.

## Certificat PDF enrichi (21 novembre 2026)
- Nouveaux scellements = manifeste version 2 : instantané de l'historique des décisions (créé, déposé, vérifié par l'IA, validé, refusé, forcé) et des contrôles automatiques, DANS l'empreinte. Pris une seule fois au scellement.
- Dossiers déjà scellés (version 1) : inchangés, toujours vérifiables ; leur certificat indique que l'historique n'est pas joint.
- Vérification d'intégrité : relit l'instantané du manifeste archivé (le journal grandit sans fausse alerte) ; `manifestIntact` couvre l'historique, `ok` couvre les octets des pièces.
- Vocabulaire volontairement prudent : « intégrité et traçabilité », jamais « garantie » ni « conformité ». Le certificat précise qu'il n'atteste pas la conformité réglementaire du cabinet (à faire relire par un juriste local).
- Le certificat est paginé (l'ancien débordait au-delà de ~8 pièces).
- Tests : tests/seal.test.js (purs) et tests/seal-http.test.js (serveur réel).

## Reste à faire
Idée suivante retenue : étendre les contrôles croisés (adresses, NIF/RCCM entre pièces, dates). Coffre-fort réutilisable et widget d'acquisition : reportés (cabinets payants et procédures légales d'abord).

Phases suivantes (documents/feuille-de-route.md) : API publique + clés + webhooks, exports comptables, tableaux de bord de pilotage, file de tâches, sauvegardes, SSO.
