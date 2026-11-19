-- Champs lus sur chaque pièce (titulaire, numéro, date d'expiration…) et empreinte
-- du fichier. Servent aux contrôles croisés du dossier (nom différent, pièce
-- expirée, même fichier déposé deux fois). Colonnes facultatives : sans effet sur
-- les pièces existantes.
alter table aura.pieces add column if not exists champs jsonb;
alter table aura.pieces add column if not exists empreinte text;
