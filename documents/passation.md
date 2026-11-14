# Passation — direction du site Aura Collect (état au 14 novembre 2026)

## Publié sur `main` (dernier commit : voir `git log`)
- Corrections d'honnêteté : promesses non prouvées retirées (« 3 secondes », « Hébergement UE », « Le plus choisi », logo/couleurs, prix du pack d'installation, délai de réponse).
- Sécurité : seuls les pages, `/assets`, `robots.txt` et `sitemap.xml` sont servis (le code serveur, le SQL et `render.yaml` étaient exposés avant) ; en-têtes de sécurité ; en production, mot de passe de démonstration fermé et secret de session aléatoire si les variables manquent ; plafonds de dépôt (60/h par dossier, 150/h par IP) ; type de fichier vérifié sur les octets.
- Polices hébergées (plus de Google Fonts), page 404, formulaire de contact réel (WhatsApp ou e-mail, enregistré dans `aura.leads`), information de traitement des données dans le portail client.
- Accueil réécrit pour les cabinets comptables de Lomé (exemples et noms fictifs locaux, marqués « données fictives »).
- Palette passée du violet au bleu profond (jetons dans `assets/css/aura.css`).

## Erreur à ne pas répéter
Une expression régulière avec `re.S` a supprimé puis dupliqué des blocs de tarifs en production. Réparé au commit 3d2ab0d. Toujours modifier ligne par ligne et comparer le diff avant de publier.

## À faire, dans l'ordre
1. Vérifier dans Render : `SESSION_SECRET`, `CABINET_PASSWORD`, `OPERATEUR_CLE` définies.
2. Consentement du client final + route de suppression de dossier/compte + durée de conservation (migration de base : à valider par le propriétaire avant exécution).
3. Numéro WhatsApp professionnel du propriétaire à afficher sur le site (aucun n'existe).
4. Lire les 5 messages de contact en base (4 sans réponse depuis le 4 novembre) : accord du propriétaire requis.
5. Auditer l'interface cabinet (`assets/js/app.js`), le scellement et l'export.
6. Révocation des sessions : un collaborateur révoqué garde l'accès jusqu'à 12 h.
7. Vidéo de démonstration (`assets/video`) : images encore violettes, à refaire une fois l'interface figée.
8. Tester l'IA sur 20 pièces togolaises réelles ; faire sceller un vrai dossier par un cabinet de Lomé.
9. Envoi d'e-mails : à ne pas modifier sans instruction du propriétaire.

## Messages en attente pour Accio
Expliquer les écarts de base (e-mails en attente 46 et non 9 ; 17 transactions FedaPay absentes de `payments` ; webhooks en double) ; versionner les migrations ; confirmer l'isolation par `cabinet_id` ; période absente → « à revoir » plutôt que refus.
