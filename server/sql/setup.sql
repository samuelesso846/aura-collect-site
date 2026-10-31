-- Aura Collect — installation complète (facturation + comptes cabinets).
-- À exécuter dans Supabase → SQL Editor. Réexécutable sans risque.

-- ---------------------------------------------------------------------------
-- 1. Cabinets
-- ---------------------------------------------------------------------------
create table if not exists aura.cabinets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  email text,
  phone text,
  plan text not null default 'starter',
  plan_status text not null default 'trialing',
  trial_ends_at timestamptz,
  paid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table aura.cabinets add column if not exists password_hash text;

-- ---------------------------------------------------------------------------
-- 2. Paiements
-- ---------------------------------------------------------------------------
create table if not exists aura.payments (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references aura.cabinets(id) on delete cascade,
  plan text not null,
  months integer not null,
  amount integer not null,
  currency text not null default 'XOF',
  status text not null default 'pending',
  fedapay_transaction_id bigint unique,
  fedapay_reference text,
  checkout_url text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_cabinet_idx on aura.payments (cabinet_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Journal des webhooks (anti-doublon)
-- ---------------------------------------------------------------------------
create table if not exists aura.webhook_events (
  id bigserial primary key,
  name text not null,
  object_id bigint,
  payload jsonb,
  received_at timestamptz not null default now(),
  unique (name, object_id)
);

-- ---------------------------------------------------------------------------
-- 4. Isolation des dossiers par cabinet
-- ---------------------------------------------------------------------------
alter table aura.dossiers add column if not exists cabinet_id uuid references aura.cabinets(id) on delete cascade;
create index if not exists dossiers_cabinet_idx on aura.dossiers (cabinet_id, created_at desc);

-- Les dossiers déjà présents restent rattachés au cabinet historique.
update aura.dossiers
   set cabinet_id = (select id from aura.cabinets order by created_at asc limit 1)
 where cabinet_id is null;

-- Votre accès existant reçoit l'email de connexion. Le mot de passe actuel
-- continue de fonctionner tant qu'aucun mot de passe personnel n'est défini.
update aura.cabinets
   set email = lower('samuelesso846@gmail.com')
 where id = (select id from aura.cabinets order by created_at asc limit 1);

-- ---------------------------------------------------------------------------
-- 5. Droits et politiques pour le rôle applicatif
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aura_app') then
    grant usage on schema aura to aura_app;
    grant select, insert, update, delete on aura.cabinets to aura_app;
    grant select, insert, update, delete on aura.payments to aura_app;
    grant select, insert, update, delete on aura.webhook_events to aura_app;
    grant select, insert, update, delete on aura.dossiers to aura_app;
    grant usage, select on sequence aura.webhook_events_id_seq to aura_app;

    if not exists (select 1 from pg_policies where schemaname = 'aura' and tablename = 'cabinets' and policyname = 'aura_app_all') then
      alter table aura.cabinets enable row level security;
      create policy aura_app_all on aura.cabinets for all to aura_app using (true) with check (true);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'aura' and tablename = 'payments' and policyname = 'aura_app_all') then
      alter table aura.payments enable row level security;
      create policy aura_app_all on aura.payments for all to aura_app using (true) with check (true);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'aura' and tablename = 'webhook_events' and policyname = 'aura_app_all') then
      alter table aura.webhook_events enable row level security;
      create policy aura_app_all on aura.webhook_events for all to aura_app using (true) with check (true);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Fichiers hors base (Supabase Storage)
-- ---------------------------------------------------------------------------
-- `content` devient facultatif : le binaire vit dans le compartiment, la base
-- ne garde que les métadonnées et la clé de l'objet.
alter table aura.files add column if not exists storage_key text;
alter table aura.files alter column content drop not null;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aura_app') then
    grant select, insert, update, delete on aura.files to aura_app;
  end if;
end $$;
