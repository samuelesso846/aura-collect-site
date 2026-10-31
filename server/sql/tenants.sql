-- Aura Collect — comptes multi-cabinets et isolation des dossiers.
-- À exécuter APRÈS billing.sql, dans le SQL Editor Supabase.

-- 1. Identifiants propres à chaque cabinet.
alter table aura.cabinets add column if not exists password_hash text;

-- 2. Chaque dossier appartient à un cabinet.
alter table aura.dossiers add column if not exists cabinet_id uuid references aura.cabinets(id) on delete cascade;
create index if not exists dossiers_cabinet_idx on aura.dossiers (cabinet_id, created_at desc);

-- 3. Les dossiers déjà présents sont rattachés au cabinet le plus ancien.
update aura.dossiers d
   set cabinet_id = c.id
  from (select id from aura.cabinets order by created_at asc limit 1) c
 where d.cabinet_id is null;

-- 4. Droits du rôle applicatif sur la nouvelle colonne (aucun changement de table).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aura_app') then
    grant select, insert, update, delete on aura.dossiers to aura_app;
  end if;
end $$;
