-- Aura Collect — comptes multi-cabinets et isolation des dossiers.
-- À exécuter APRÈS billing.sql, dans le SQL Editor Supabase.

-- 1. Identifiants propres à chaque cabinet.
alter table aura.cabinets add column if not exists password_hash text;

-- 2. Chaque dossier appartient à un cabinet.
alter table aura.dossiers add column if not exists cabinet_id uuid references aura.cabinets(id) on delete cascade;
create index if not exists dossiers_cabinet_idx on aura.dossiers (cabinet_id, created_at desc);

-- 3. Les dossiers déjà présents restent rattachés à votre cabinet historique.
update aura.dossiers
   set cabinet_id = (select id from aura.cabinets order by created_at asc limit 1)
 where cabinet_id is null;

-- 4. Votre accès existant reçoit l'email de connexion.
--    Le mot de passe actuel du cabinet continue de fonctionner tant qu'aucun
--    mot de passe personnel n'a été défini.
update aura.cabinets
   set email = lower('samuelesso846@gmail.com')
 where id = (select id from aura.cabinets order by created_at asc limit 1);

-- 5. Droits du rôle applicatif.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aura_app') then
    grant select, insert, update, delete on aura.dossiers to aura_app;
  end if;
end $$;
