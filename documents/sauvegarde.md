# Sauvegarder la base Aura Collect

Supabase **Free n'inclut aucune sauvegarde automatique**. Les sauvegardes
quotidiennes commencent au plan Pro (25 $/mois). Sans rien mettre en place,
une suppression accidentelle ou un projet suspendu = perte définitive des
dossiers clients.

Solution retenue, gratuite : un export automatique chaque nuit par GitHub
Actions, conservé 90 jours.

---

## Étape 1 — Créer le fichier de workflow sur GitHub

GitHub refuse qu'un jeton personnel crée un fichier dans `.github/workflows/`
sans le droit `workflow`. On le crée donc depuis l'interface web, en deux clics.

1. Sur le dépôt, bouton **Add file** → **Create new file**
2. Nom du fichier, exactement : `.github/workflows/sauvegarde.yml`
3. Coller le contenu ci-dessous
4. **Commit changes**

```yaml
name: Sauvegarde de la base

on:
  schedule:
    - cron: '0 2 * * *'      # tous les jours à 02 h 00 UTC
  workflow_dispatch:

jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - name: Vérifier que le secret existe
        run: |
          if [ -z "${{ secrets.SUPABASE_DB_URL }}" ]; then
            echo "::error::Le secret SUPABASE_DB_URL n'est pas défini."
            exit 1
          fi

      - name: Exporter le schéma aura
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          mkdir -p out
          STAMP=$(date -u +%Y-%m-%d-%H%M)

          # L'URL Supabase passe par le pooler en mode transaction (6543),
          # sur lequel pg_dump ne peut pas travailler. On bascule sur le
          # port 5432 du même hôte, qui est le mode session.
          URL=$(printf '%s' "$DB_URL" | sed 's/:6543/:5432/')
          case "$URL" in *sslmode*) ;; *) URL="$URL?sslmode=require" ;; esac

          docker run --rm -v "$PWD/out:/out" postgres:17 \
            pg_dump --no-owner --no-privileges --clean --if-exists \
                    --schema=aura -d "$URL" -Fc -f "/out/aura-$STAMP.dump"
          ls -lh out/

      - name: Publier l'export
        uses: actions/upload-artifact@v4
        with:
          name: sauvegarde-${{ github.run_number }}
          path: out/*.dump
          retention-days: 90
          if-no-files-found: error
```

## Étape 2 — Enregistrer la chaîne de connexion

1. Dépôt → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Nom : `SUPABASE_DB_URL`
4. Valeur : la chaîne de connexion Supabase (celle du fichier `.env`,
   `DATABASE_URL`). Le port 6543 convient : le workflow le convertit.

## Étape 3 — Vérifier que ça marche

1. Onglet **Actions** → **Sauvegarde de la base** → **Run workflow**
2. Au bout d'une minute, le job doit être vert
3. Ouvrir le job → section **Artifacts** → `sauvegarde-1` contient un `.dump`

Si le job échoue, l'erreur est explicite : secret manquant, connexion refusée,
ou droits insuffisants.

---

## Restaurer une sauvegarde

```bash
# Récupérer le fichier .dump depuis l'artefact GitHub, puis :
pg_restore --clean --if-exists --no-owner \
  --schema=aura -d "<DATABASE_URL>" aura-2026-11-02-0200.dump
```

`pg_restore` doit être en version 17, comme le serveur.

---

## Ce que cette sauvegarde ne couvre pas

- **Les fichiers clients** sont stockés en base (colonne `bytea`), donc
  inclus dans le dump. C'est une chance aujourd'hui, un poids demain :
  la taille de l'export grandira avec le nombre de dossiers.
- **Rétention de 90 jours** : GitHub supprime l'artefact au-delà. Pour
  garder plus longtemps, télécharger l'export le premier de chaque mois.
- **Restauration non testée.** Une sauvegarde jamais restaurée n'est pas
  une sauvegarde, c'est une intention. À tester une fois sur une base vide.
