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

## Fait ensuite (20 novembre 2026, soir)
- securite.html : activer (QR + clé manuelle + code), codes de secours affichés une seule fois, désactiver (mot de passe + code). Lien « Sécurité » dans app.html. La liste blanche de serveStatic laisse déjà passer cette page.
- tests/2fa-http.test.js : 6 tests de bout en bout (sans code = needCode, mauvais code, bon code, rejeu refusé, code de secours à usage unique, désactivation).
- `npm test` : 90 tests verts (lancer en non-root, embedded-postgres refuse root).

## Reste à faire
1. Vérification visuelle de securite.html dans un navigateur (QR lisible par une vraie application).
2. Appliquer 0006 en production AVANT de fusionner (colonnes ajoutées seulement, sans risque pour l'ancien code), enregistrer son hash dans aura.schema_migrations, puis fusionner wip-2fa dans main.
3. Phases suivantes (documents/feuille-de-route.md) : API publique + clés + webhooks, exports comptables, tableaux de bord de pilotage, file de tâches, sauvegardes, SSO.
