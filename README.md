# Aura Collect — site d'entreprise + démo produit

**Vitrine en ligne :** https://samuelesso846.github.io/aura-collect-site/
**Application réelle :** `npm start` puis http://localhost:8788/app — données sur Supabase (voir §9)

Site vitrine statique (HTML/CSS/JS, sans build) pour **Aura Collect**, la collecte de pièces justificatives avec validation IA.
Il inclut une **démo fonctionnelle** du parcours cabinet → client, utilisable en rendez-vous commercial.

## 1. Ce qui est livré

| Fichier | Rôle |
|---|---|
| `index.html` | Page d'accueil : promesse, coût du problème, 3 piliers, parcours, validation IA, modèles, tarifs, FAQ |
| `tarifs.html` | Offres détaillées, tableau comparatif, calculateur de ROI interactif |
| `contact.html` | Demande de démo (formulaire sans backend : prépare un email) |
| `demo.html` | Tableau de bord cabinet : création de dossier, pipeline, fiche dossier, aperçu d'export |
| `portail.html` | Portail client mobile : dépôt de pièces, verdict IA simulé, progression |
| `legal.html` | Mentions légales, RGPD, sous-traitants (champs à compléter) |
| `assets/css/aura.css` | Design system complet (couleurs, composants, responsive) |
| `assets/js/store.js` | État partagé de la démo (localStorage) + modèles de pièces |
| `assets/js/dashboard.js` | Logique du tableau de bord |
| `assets/js/portal.js` | Logique du portail client et de la validation simulée |
| `assets/js/site.js` | Navigation, menu mobile, bascule tarifaire, animations |
| `assets/js/contact.js` | Validation du formulaire et préparation de l'email |

## 2. Lancer en local

Un simple serveur statique suffit (les liens `?d=token` et localStorage ne fonctionnent pas en `file://`) :

```bash
cd aura-collect-site
python3 -m http.server 8080
# → http://localhost:8080
```

## 3. Déployer en ligne

**Déjà publié sur GitHub Pages** depuis la branche `main` de `samuelesso846/aura-collect-site`.
Chaque `git push` sur `main` republie le site en une minute environ.

Autres options — le site ne contient aucune dépendance de build : déposez le dossier tel quel.

- **Netlify** : app.netlify.com/drop → glisser le dossier. Domaine personnalisé dans *Domain settings*.
- **Vercel** : `vercel deploy --prod` depuis le dossier (framework : *Other*, aucune commande de build).
- **Cloudflare Pages** : *Upload assets* → glisser le dossier.
- **Hébergement classique** (o2switch, Ionos…) : upload FTP dans `public_html`.

À brancher ensuite : domaine `auracollect.fr`, email `bonjour@auracollect.fr`, HTTPS (automatique chez les hébergeurs ci-dessus).

## 4. Ce qui est réel, ce qui est simulé

**Réel :** navigation, responsive, tarifs et bascule mensuel/annuel, calculateur de ROI, création de dossier, génération du lien client, pipeline, progression, export du manifeste, persistance dans le navigateur, partage d'état entre l'onglet cabinet et l'onglet client.

**Simulé (démo uniquement, sans backend) :**
- la validation IA : elle lit le **nom du fichier**. `flou` → refus de lisibilité, `expire` → refus de validité, `facture` → mauvais type ; sinon accepté ;
- l'envoi d'emails : le bouton « Renvoyer le lien » affiche une confirmation, aucun email n'est parti ;
- l'export ZIP : l'arborescence et le renommage sont réels, le fichier téléchargé est un **manifeste `.txt`** (aucun document n'est stocké) ;
- les données : 6 dossiers fictifs, stockés dans le `localStorage` du visiteur, jamais transmis.

Rien de tout cela n'est présenté comme une fonctionnalité active dans les textes du site : la démo affiche un bandeau explicite.

## 5. Brancher le vrai produit

L'ordre de mise en œuvre qui va le plus vite :

1. **Stockage & base** — Firebase (Firestore + Storage, région `europe-west1`) ou Supabase. Collections : `dossiers`, `pieces`, `evenements`.
2. **Upload** — endpoint serveur qui reçoit le fichier, vérifie la taille et le type MIME, stocke hors URL publique, renvoie un identifiant.
3. **Validation IA** — appel multimodal (Gemini Vision ou équivalent) avec un prompt par type de pièce, sortie JSON stricte :
   `{ type_conforme, lisible, date_detectee, date_valide, motif }`. Trois états : `validé` / `rejeté` / `à confirmer`.
4. **Emails** — Resend ou Postmark : lien magique (token signé, expiration 30 jours), relance J+2 puis J+5, notification cabinet à 100 %.
5. **Export** — `pdf-lib` + `jszip` côté serveur : renommage `Nom_Piece.pdf`, sommaire PDF, archive signée.
6. **Sécurité** — liens signés à durée courte, séparation par cabinet, journal des décisions, hébergement UE, accord de sous-traitance.

Variables d'environnement typiques : `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, `RESEND_API_KEY`, `APP_URL`, `SIGNING_SECRET`.

## 6. Personnaliser

- **Couleurs / typo** : variables CSS en tête de `assets/css/aura.css` (`--violet`, `--ink`, `--radius`…).
- **Prix** : attributs `data-monthly` / `data-yearly` dans `index.html` et `tarifs.html` (le calcul −20 % est déjà appliqué aux valeurs annuelles).
- **Adresse de contact** : `DEST` dans `assets/js/contact.js` et les liens `mailto:` des pages.
- **Modèles de pièces** : tableau `TEMPLATES` dans `assets/js/store.js` (libellé, règle de validité, clé de nommage).
- **Textes** : tout est en français dans le HTML, aucun contenu généré au chargement.

## 7. Avant la mise en ligne

- [ ] Remplir les champs surlignés de `legal.html` (raison sociale, SIREN, hébergeur, sous-traitants).
- [ ] Remplacer `bonjour@auracollect.fr` par l'adresse réelle et configurer SPF/DKIM/DMARC.
- [ ] Ajouter une image Open Graph (`og:image`) pour les partages LinkedIn.
- [ ] Brancher le formulaire de contact sur un vrai endpoint (Formspree, Resend, Make) ou une boîte email dédiée.
- [ ] Installer une mesure d'audience sans cookie (Plausible, Umami) si nécessaire.
- [ ] Tester sur un iPhone réel : prise de photo, PDF, retour arrière, lien expiré.

## 8. Limites connues

- Pas de backend : la démo ne conserve rien après effacement du stockage navigateur.
- Le portail client est un écran de démonstration ; un vrai lien expirant et un contrôle d'accès serveur restent à implémenter.
- Les tarifs, mentions et chiffres d'architecture sont des propositions commerciales à valider avant publication.


## 9. Application réelle (backend Node)

Le dossier contient désormais un serveur qui rend le produit fonctionnel : les pièces sont réellement stockées, analysées et exportées.

### Lancer

```bash
cp .env.example .env      # CABINET_PASSWORD, SESSION_SECRET, DATABASE_URL, GROQ_API_KEY
npm install
npm start                 # http://localhost:8788/app
```

Le mot de passe par défaut est `aura-demo` uniquement si `CABINET_PASSWORD` est absent — à changer avant toute mise en ligne.
`DATABASE_URL` pointe vers le pooler Supabase (voir §10). Sans elle, le serveur démarre mais l'API répond en erreur : la base est obligatoire.

### Ce qui fonctionne réellement

- **Comptes cabinet** : connexion par mot de passe, cookie de session signé (HMAC, HttpOnly, SameSite=Lax, 12 h).
- **Dossiers** : création, lien client unique, suivi des statuts, relance.
- **Dépôt client** : upload multipart (JPEG, PNG, WEBP, PDF — 15 Mo max), stockage hors du dossier public, nom de fichier aléatoire.
- **Validation IA** : appel Groq (modèle vision), sortie JSON stricte (`type_conforme`, `lisible`, `date_document`, `date_valide`, `confiance`, `motif`). Trois états : `ok`, `ko`, `review`. En cas de panne, de doute ou de PDF scanné, la pièce passe en `review` — jamais d'acceptation silencieuse.
- **Export ZIP** : pièces renommées `Nom_Piece.pdf`, sommaire PDF généré avec `pdf-lib`, fichier `_lisez-moi.txt` si des pièces manquent.
- **Portail client** : `/p/<token>`, progression, messages de refus rédigés pour le client.

### Ce qui reste simulé ou incomplet

- **Emails** : sans `RESEND_API_KEY`, les messages sont journalisés dans `data/db.json` (outbox) et affichés dans la console. Le lien est toujours visible dans le dashboard.
- **PDF scannés** : pas de conversion PDF → image (nécessite `pdftoppm` ou un service), donc pas d'analyse visuelle ; la pièce passe en revue humaine.
- **Authentification** : un seul compte cabinet partagé, pas d'utilisateurs ni de rôles.
- **Multi-tenant** : une seule organisation par déploiement ; le schéma n'a pas encore de colonne `cabinet_id`.
- **Fichiers** : stockés en `bytea` dans Postgres (pratique pour le MVP, à basculer vers Supabase Storage au-delà de quelques milliers de pièces).

### Endpoints

| Méthode | Route | Accès |
|---|---|---|
| POST | `/api/login` · `/api/logout` | public |
| GET | `/api/me` | public |
| GET | `/api/templates` | cabinet |
| GET/POST | `/api/dossiers` | cabinet |
| POST | `/api/dossiers/:id/remind` | cabinet |
| GET | `/api/dossiers/:id/export` | cabinet |
| GET | `/api/files/:id/:key` | cabinet |
| GET | `/api/portal/:token` | public (token) |
| POST | `/api/portal/:token/pieces/:key` | public (token) |
| GET | `/p/:token` · `/app` | pages |

### Activer Groq

1. Créer une clé sur console.groq.com.
2. La placer dans `.env` : `GROQ_API_KEY=gsk_...`
3. Vérifier que le modèle est disponible : `GROQ_MODEL` (par défaut `meta-llama/llama-4-scout-17b-16e-instruct`).
4. Redémarrer, puis vérifier la pastille « Groq » dans l'en-tête du dashboard.

### Déploiement

GitHub Pages ne sert que la vitrine statique. Pour l'application, il faut un hébergeur Node (Railway, Render, Fly.io, VPS) avec un volume persistant pour `data/`, puis :

```bash
npm install
npm start
```

Variables à définir : `CABINET_PASSWORD`, `SESSION_SECRET`, `PUBLIC_BASE_URL` (URL publique réelle), `GROQ_API_KEY`, éventuellement `RESEND_API_KEY` et `MAIL_FROM`.


## 10. Base Supabase

Projet dédié `aura-collect`, organisation `TogoMarché`, région `eu-central-1` (coût de création : 0 €).

| Élément | Valeur |
|---|---|
| Référence projet | `jtabbvaebigsklawqlth` |
| Schéma | `aura` (isolé du reste du projet) |
| Tables | `aura.dossiers`, `aura.pieces`, `aura.files`, `aura.outbox` |
| Rôle applicatif | `aura_app` — accès limité au schéma `aura` |
| Connexion | pooler `aws-1-eu-central-1.pooler.supabase.com:6543`, base `postgres` |

### Sécurité

- RLS activé sur les quatre tables, avec une seule politique `to aura_app`.
- `anon` et `authenticated` n'ont aucun droit sur le schéma (révoqués explicitement).
- Les fichiers ne sont jamais exposés : ils sortent uniquement via `/api/files/:id/:key`, derrière la session cabinet, ou dans le ZIP.
- Le mot de passe du rôle `aura_app` et `DATABASE_URL` vivent dans `.env`, jamais dans le dépôt.

### Exploitation

- Sauvegarde : `pg_dump` depuis le pooler (session 5432) ou backups Supabase.
- Rotation du mot de passe : `alter role aura_app with password '...'` via l'éditeur SQL Supabase, puis mise à jour de `DATABASE_URL`.
- Le pooler en mode transaction (6543) ne supporte pas les requêtes préparées nommées : `pg` en mode simple query, ce qui est le cas ici.
