# Point de reprise (20 novembre 2026)

Livré et en ligne (main) : isolation par ligne (0004), champs extraits + contrôles croisés + relances (0005), rôles et droits.
En cours, NON déployé, sur la branche `wip-2fa` : double authentification TOTP.

## Fait sur wip-2fa
- server/lib/totp.js + tests/totp.test.js (5 tests verts, vecteurs RFC 6238)
- db/migrations/0006_double_authentification.sql (PAS encore appliquée en production)
- store.js : totpOf, totpPending, totpEnable, totpAdvance, totpUseRecovery, totpDisable
- index.js : login en deux étapes (needCode), routes /api/2fa, /api/2fa/setup|enable|disable
- app.html / app.js : champ « Code de sécurité » à la connexion
- dépendance `qrcode`

## Reste à faire
1. Page securite.html (activer : QR + saisie du code + affichage UNIQUE des codes de secours ; désactiver) + lien dans app.html. Vérifier la liste blanche de pages dans `serveStatic` (server/index.js ~ligne 2135).
2. Test HTTP de bout en bout (tests/roles-http.test.js sert de modèle : serveur sous le rôle aura_app) : login sans code = needCode, mauvais code, bon code, rejeu refusé, code de secours consommé une fois.
3. Lancer `npm test` (en non-root : voir notes), appliquer 0006 en production AVANT de pousser, enregistrer son hash dans aura.schema_migrations, puis fusionner dans main.
4. Phases suivantes (documents/feuille-de-route.md) : API publique + clés + webhooks, exports comptables, tableaux de bord de pilotage, file de tâches, sauvegardes, SSO.
