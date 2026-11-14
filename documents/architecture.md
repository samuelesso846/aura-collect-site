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

Toutes les tables ont la sécurité par ligne activée, mais la politique `aura_app_all` autorise tout au rôle applicatif : **l'isolation entre cabinets repose uniquement sur `cabinet_id` dans le code**. C'est la dette de sécurité n° 1. Chemin de remédiation : (1) tests d'intégration qui vérifient qu'un cabinet ne lit jamais un dossier d'un autre, (2) puis politiques par ligne basées sur un paramètre de session `aura.cabinet_id`.

### Journal des décisions

`decision_log` est en ajout seul : depuis la migration `0002`, le rôle applicatif n'a plus que `insert` et `select` (droits et politiques par ligne). Un test vérifie le refus de toute modification ou suppression.

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

1. Politiques par ligne réelles en base (l'isolation entre cabinets est aujourd'hui garantie par le code **et vérifiée par 17 tests**, dont des tests HTTP à deux cabinets, mais la base elle-même ne la fait pas respecter).
2. Contraintes `CHECK` (statuts, plans) absentes.

**Réglé le 14 novembre 2026** : révocation de session (un accès retiré coupe la session immédiatement ; au plus 20 s si la révocation vient d'une autre instance), journal des décisions en ajout seul (migration `0002`, appliquée en production), tests d'isolation.
5. Limiteur de débit en mémoire : à déplacer en base si l'on passe à plusieurs instances.
6. Envoi d'e-mails : volontairement non modifié (file `outbox` non écoulée).
7. Sauvegardes : vérifier la politique de sauvegarde Supabase avant le premier client réel.
