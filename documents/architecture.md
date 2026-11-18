# Architecture d'Aura Collect

*État au 14 novembre 2026. À mettre à jour à chaque changement structurant.*

## Vue d'ensemble

| Couche | Choix | Remarque |
|---|---|---|
| Site et application | HTML/CSS/JS sans framework, servis par Express 5 | Pages publiques en liste blanche (voir « Sécurité ») |
| Serveur | Node ≥ 20, un seul processus (`server/index.js`) | Hébergé sur Render, offre gratuite (réveil de 30 à 60 s) |
| Base de données | PostgreSQL 17 (Supabase), schéma `aura` | Rôle applicatif `aura_app`, jamais le propriétaire |
| Fichiers | Supabase Storage, compartiment privé `aura-files` | Repli sur `aura.files` (bytea) si non configuré |
| IA | Groq (`qwen/qwen3.8-27b`) | Délai 45 s, une relance, disjoncteur |
| Paiement | FedaPay (webhook signé) | |
| Scellement | Manifeste + SHA-256 + certificat PDF | |

## Flux principaux

1. **Cabinet** : se connecte (cookie de session signé), crée un dossier à partir d'un modèle, envoie le lien `/p/<jeton>` à son client (WhatsApp).
2. **Client** : ouvre le lien sans compte, dépose photos ou PDF. Le serveur vérifie le type réel (octets d'en-tête), limite le débit, stocke la pièce, appelle l'IA.
3. **IA** : classe, renomme, contrôle la date et la lisibilité. En cas de doute ou de panne, la pièce passe en « à contrôler » : l'IA ne rejette jamais seule sur une panne.
4. **Cabinet** : valide ou refuse, puis scelle le dossier (empreinte + certificat) et exporte.

## Base de données

- **Source de vérité du schéma** : `db/migrations/NNNN_nom.sql`, appliquées dans l'ordre par `npm run migrate` (`server/migrate.js`).
- Chaque migration est exécutée dans une transaction et enregistrée dans `aura.schema_migrations` avec son empreinte SHA-256. **Une migration déjà appliquée ne se modifie jamais** : le lanceur refuse de continuer si son contenu a changé.
- `0000_baseline.sql` reproduit la production du 14 novembre 2026 ; elle est idempotente, donc sans effet sur la base actuelle.
- `0001_relation.sql` crée `relation_messages` (historique des messages de relance). **Non appliquée en production** : à lancer volontairement.
- Les anciens scripts (`db/archive/`, `server/sql/`) sont conservés pour mémoire, ne plus les utiliser.
- Le lanceur n'est **pas** exécuté au démarrage : un changement de schéma est un acte volontaire.

### Isolation entre cabinets

**Depuis la migration `0004`**, la base impose elle-même l'isolation. Pour chaque requête d'un cabinet connecté (`requireAuth` → `scope.run`), `store.pool` ouvre une courte transaction qui pose `aura.scope='cabinet'` et `aura.cabinet_id`. Des politiques RESTRICTIVES (`isolation_cabinet`) limitent alors `cabinets`, `users`, `clients`, `dossiers`, `pieces`, `files`, `decision_log`, `payments`, `relation_messages`, `cabinet_profile` aux lignes de ce cabinet : une requête sans filtre n'expose plus rien d'un autre cabinet.
- Hors contexte (lien client par jeton, webhook, inscription, connexion, opérateur) : accès complet, comme avant. Les vérifications d'unicité globale (e-mail d'un invité, domaine) passent par `scope.system`.
- Non isolées volontairement : `outbox`, `leads`, `webhook_events`.
- Interrupteur de secours : variable `RLS_SCOPE=0` coupe le mode sans redéployer.
- Coût : trois allers-retours base au lieu d'un par requête de cabinet. À surveiller.
- **Limite connue** : le rôle applicatif peut poser ces paramètres. La défense protège contre les erreurs de code, pas contre l'exécution de SQL arbitraire ; la fermer demanderait un rôle de base par cabinet.
- Vérifié par `tests/rls.test.js` (connexion comme le rôle applicatif) et par les tests HTTP qui font tourner le serveur sous ce rôle.

### Journal des décisions

`decision_log` est en ajout seul : depuis la migration `0002`, le rôle applicatif n'a plus que `insert` et `select` (droits et politiques par ligne). Un test vérifie le refus de toute modification ou suppression.

**Identité du cabinet** (migration `0003`, table `cabinet_profile`) : logo, mot d'accueil, contact, couleur, affichés sur la page de dépôt des clients. Table à part pour que le logo (image, 150 Ko au plus) ne voyage pas avec chaque lecture de `cabinets`. Le logo est redessiné par le serveur (PNG ou JPEG uniquement, 360 px au plus, métadonnées retirées ; SVG refusé), le texte est affiché en texte brut, la couleur vient d'une liste fermée de six. Seul le propriétaire modifie, chaque changement est tracé au journal. Le lien client ne révèle que ce que le cabinet a saisi. Tant que la migration n'est pas passée, le portail s'affiche comme avant.

## Sécurité

- Fichiers statiques en **liste blanche** : `/`, `/assets/*`, pages `*.html` à la racine. Jamais `server/`, `db/`, `documents/`, `render.yaml`.
- En production : pas de mot de passe de démonstration, secret de session aléatoire si absent (les sessions sautent alors à chaque redémarrage : définir `SESSION_SECRET`).
- Dépôts clients : 60 par heure et par dossier, 150 par heure et par IP (en mémoire, remis à zéro à chaque redémarrage), type vérifié sur les octets, 25 Mo maximum.
- Liens clients : valables 30 jours.
- En-têtes : `nosniff`, `X-Frame-Options`, `Referrer-Policy`, HSTS en production.

## Observabilité

- Chaque requête reçoit un identifiant (`X-Request-Id`), renvoyé au client et repris dans les erreurs 500 (`ref`).
- Une ligne JSON par requête (date, identifiant, méthode, chemin, statut, durée). Les jetons des liens clients sont masqués. Aucun contenu de pièce ni corps de requête n'est journalisé.
- `/api/health` pour la supervision (non journalisé).

## Résilience

- Appel IA : délai de 45 s, une relance sur 429/5xx, puis **disjoncteur** (4 échecs de suite → une minute sans appel, pièces en « à contrôler »).
- Webhook FedaPay : signature vérifiée sur le corps brut, réponse immédiate, traitement dédoublonné (`UNIQUE(name, object_id)`).
- Limite connue : l'offre gratuite de Render met le service en veille ; le premier visiteur attend 30 à 60 s. À traiter avant le pilote (offre payante ou sonde de réveil).

## Tests et livraison

- `npm test` : tests de la migration sur un vrai PostgreSQL (embedded-postgres, base temporaire) et tests unitaires.
- Localement, PostgreSQL refuse de tourner en administrateur : lancer les tests avec un utilisateur normal.
- CI GitHub (`.github/workflows/ci.yml`) : vérification de syntaxe + tests à chaque envoi sur `main`.
- Déploiement : Render, automatique depuis `main`.

## Dettes connues, par priorité

1. ~~Politiques par ligne~~ : réglé (migration 0004), reste un rôle par cabinet si l'on veut se protéger du SQL arbitraire.
2. Contraintes `CHECK` (statuts, plans) absentes.

**Réglé le 14 novembre 2026** : révocation de session (un accès retiré coupe la session immédiatement ; au plus 20 s si la révocation vient d'une autre instance), journal des décisions en ajout seul (migration `0002`, appliquée en production), tests d'isolation.
5. Limiteur de débit en mémoire : à déplacer en base si l'on passe à plusieurs instances.
6. Envoi d'e-mails : volontairement non modifié (file `outbox` non écoulée).
7. Sauvegardes : vérifier la politique de sauvegarde Supabase avant le premier client réel.
