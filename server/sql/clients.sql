-- Aura Collect — fiches clients et rattachement des dossiers.
-- À exécuter dans Supabase → SQL Editor. Réexécutable.

create table if not exists aura.clients (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references aura.cabinets(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create index if not exists clients_cabinet_idx on aura.clients (cabinet_id, name);
create unique index if not exists clients_cabinet_email_uniq
  on aura.clients (cabinet_id, lower(email)) where email is not null and email <> '';

alter table aura.dossiers add column if not exists client_id uuid references aura.clients(id) on delete set null;
create index if not exists dossiers_client_idx on aura.dossiers (client_id, created_at desc);

-- Reprise des dossiers existants : un client par couple (cabinet, email) ou (cabinet, nom).
insert into aura.clients (cabinet_id, name, email)
select distinct on (d.cabinet_id, lower(coalesce(nullif(d.email, ''), d.client)))
  d.cabinet_id,
  d.client,
  nullif(d.email, '')
from aura.dossiers d
where d.client_id is null and d.cabinet_id is not null
order by d.cabinet_id, lower(coalesce(nullif(d.email, ''), d.client)), d.created_at
on conflict do nothing;

update aura.dossiers d
   set client_id = c.id
  from aura.clients c
 where d.client_id is null
   and c.cabinet_id = d.cabinet_id
   and lower(coalesce(nullif(c.email, ''), c.name)) = lower(coalesce(nullif(d.email, ''), d.client));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aura_app') then
    grant usage on schema aura to aura_app;
    grant select, insert, update, delete on aura.clients to aura_app;
  end if;
end $$;
