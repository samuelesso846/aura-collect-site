-- Aura Collect — schéma de référence (migration 0000).
--
-- Cet état reproduit la base de PRODUCTION telle qu'elle a été relevée le
-- 14 novembre 2026 (schéma `aura`, 11 tables). Il remplace server/sql/*.sql et
-- les trois migrations datées du 5 novembre, qui sont archivées.
--
-- Il est idempotent : sur la base de production il ne change rien (tout existe
-- déjà) et sert seulement à enregistrer le point de départ. Sur une base neuve
-- (développement, tests, reprise après sinistre) il reconstruit le schéma.

create schema if not exists aura;

-- Rôle applicatif : celui que l'application utilise (jamais le propriétaire).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aura_app') then
    create role aura_app nologin;
  end if;
end $$;
grant usage on schema aura to aura_app;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- cabinets
create table if not exists aura.cabinets (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text,
  email          text,
  phone          text,
  plan           text not null default 'starter',
  plan_status    text not null default 'trialing',
  trial_ends_at  timestamptz,
  paid_until     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  password_hash  text,
  domain         text,
  constraint cabinets_slug_key unique (slug)
);
create unique index if not exists cabinets_domain_unique on aura.cabinets (lower(domain)) where domain is not null;
create unique index if not exists cabinets_email_unique  on aura.cabinets (lower(email))  where email  is not null;

-- ------------------------------------------------------------------- users
create table if not exists aura.users (
  id                 uuid primary key default gen_random_uuid(),
  cabinet_id         uuid not null references aura.cabinets(id),
  name               text not null default '',
  email              text not null,
  password_hash      text,
  role               text not null default 'member',
  status             text not null default 'active',
  invited_by         text,
  invite_token       text,
  invite_expires_at  timestamptz,
  created_at         timestamptz not null default now(),
  last_login_at      timestamptz
);
create index if not exists users_cabinet_idx on aura.users (cabinet_id);
create unique index if not exists users_email_unique on aura.users (lower(email));
create unique index if not exists users_invite_token_unique on aura.users (invite_token) where invite_token is not null;

-- ----------------------------------------------------------------- clients
create table if not exists aura.clients (
  id          uuid primary key default gen_random_uuid(),
  cabinet_id  uuid not null references aura.cabinets(id),
  name        text not null,
  email       text,
  phone       text,
  created_at  timestamptz not null default now()
);
create index if not exists clients_cabinet_idx on aura.clients (cabinet_id, name);
create unique index if not exists clients_cabinet_email_uniq on aura.clients (cabinet_id, lower(email))
  where email is not null and email <> '';

-- ----------------------------------------------------------------- dossiers
create table if not exists aura.dossiers (
  id             text primary key,
  token          text not null,
  client         text not null,
  email          text not null,
  template       text not null,
  created_at     timestamptz not null default now(),
  last_activity  timestamptz not null default now(),
  recipient      text not null default '',
  seal_hash      text,
  sealed_at      timestamptz,
  seal_manifest  jsonb,
  cabinet_id     uuid references aura.cabinets(id),
  client_id      uuid references aura.clients(id),
  constraint dossiers_token_key unique (token)
);
create index if not exists dossiers_cabinet_idx on aura.dossiers (cabinet_id, created_at desc);
create index if not exists dossiers_client_idx  on aura.dossiers (client_id, created_at desc);

-- ------------------------------------------------------------------ pièces
create table if not exists aura.pieces (
  dossier_id     text not null references aura.dossiers(id),
  key            text not null,
  label          text not null,
  rule           text not null,
  status         text not null default 'wait',
  filename       text default '',
  stored         text default '',
  mime           text default '',
  size           bigint default 0,
  reason         text default '',
  type_detecte   text default '',
  date_document  text default '',
  confidence     numeric,
  provider       text default '',
  at             timestamptz,
  position       integer not null default 0,
  primary key (dossier_id, key)
);

create table if not exists aura.files (
  dossier_id   text not null references aura.dossiers(id),
  piece_key    text not null,
  name         text not null,
  mime         text not null,
  size         bigint not null,
  content      bytea,
  created_at   timestamptz not null default now(),
  storage_key  text,
  primary key (dossier_id, piece_key)
);

-- ------------------------------------------------------- journal des décisions
create table if not exists aura.decision_log (
  id           bigserial primary key,
  cabinet_id   uuid references aura.cabinets(id),
  dossier_id   text not null,
  piece_key    text,
  piece_label  text,
  action       text not null,
  status       text,
  reason       text,
  actor_kind   text not null,
  actor_email  text,
  actor_name   text,
  provider     text,
  confidence   numeric,
  created_at   timestamptz not null default now()
);
create index if not exists decision_log_cabinet_idx on aura.decision_log (cabinet_id, created_at desc);
create index if not exists decision_log_dossier_idx on aura.decision_log (dossier_id, created_at);

-- ------------------------------------------------------------ facturation
create table if not exists aura.payments (
  id                      uuid primary key default gen_random_uuid(),
  cabinet_id              uuid not null references aura.cabinets(id),
  plan                    text not null,
  months                  integer not null,
  amount                  integer not null,
  currency                text not null default 'XOF',
  status                  text not null default 'pending',
  fedapay_transaction_id  bigint,
  fedapay_reference       text,
  checkout_url            text,
  raw                     jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint payments_fedapay_transaction_id_key unique (fedapay_transaction_id)
);
create index if not exists payments_cabinet_idx on aura.payments (cabinet_id, created_at desc);

create table if not exists aura.webhook_events (
  id           bigserial primary key,
  name         text not null,
  object_id    bigint,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  constraint webhook_events_name_object_id_key unique (name, object_id)
);

-- ------------------------------------------------------- courrier sortant, prospects
create table if not exists aura.outbox (
  id           text primary key,
  dossier_id   text,
  recipient    text not null,
  subject      text not null,
  body         text not null,
  mode         text not null,
  status       text not null,
  provider_id  text default '',
  created_at   timestamptz not null default now()
);

create table if not exists aura.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  prenom      text,
  nom         text,
  email       text not null,
  structure   text,
  metier      text,
  volume      text,
  message     text,
  source      text default 'contact',
  user_agent  text,
  ip          text,
  traite      boolean not null default false,
  note        text
);
create index if not exists leads_created_at_idx on aura.leads (created_at desc);
create index if not exists leads_traite_idx on aura.leads (traite);

-- --------------------------------------------------- droits et sécurité par ligne
-- Le rôle applicatif gère les données ; l'isolation entre cabinets est faite par
-- le code (cabinet_id dans chaque requête) et vérifiée par les tests d'intégration.
do $$
declare t text;
begin
  foreach t in array array['cabinets','users','clients','dossiers','pieces','files',
                           'decision_log','payments','webhook_events','outbox','leads']
  loop
    execute format('alter table aura.%I enable row level security', t);
    execute format('drop policy if exists aura_app_all on aura.%I', t);
    execute format('create policy aura_app_all on aura.%I for all to aura_app using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on aura.%I to aura_app', t);
  end loop;
end $$;
grant usage, select on all sequences in schema aura to aura_app;
