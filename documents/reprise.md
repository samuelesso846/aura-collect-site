# Point de reprise (21 novembre 2026)

Livré et en ligne (main) : isolation par ligne (0004), champs extraits + contrôles croisés + relances (0005), rôles et droits.

## Double authentification : abandonnée (décision du propriétaire, 21 novembre)
Jugée trop difficile à utiliser pour les cabinets. Le code, la page « Sécurité », les tests et la dépendance `qrcode` ont été retirés de main.
- La migration `0006_double_authentification.sql` est conservée dans le dépôt : elle est déjà appliquée en production (hash enregistré dans aura.schema_migrations) et ne doit jamais être modifiée. Ses quatre colonnes `totp_*` de `aura.users` restent en base, inutilisées et sans effet.
- Le code retiré reste récupérable dans l'historique git (commits edb5c8b, 65abe57, 892c9e2) si le sujet revient, par exemple pour de grands cabinets.
- Alternative légère à étudier plus tard si un acheteur exige plus que le mot de passe : lien de connexion par e-mail ou WhatsApp, sans application à installer.

## Reste à faire
Phases suivantes (documents/feuille-de-route.md) : API publique + clés + webhooks, exports comptables, tableaux de bord de pilotage, file de tâches, sauvegardes, SSO.
