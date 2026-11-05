-- Aura Collect — migration du 5 novembre 2026
-- Journal des décisions, utilisateurs multiples, domaine personnalisé.
-- À coller d'un bloc dans Supabase → SQL Editor → Run.
-- Le script est idempotent : le relancer ne casse rien.

-- ---------------------------------------------------------------------------
-- 1. JOURNAL DES DÉCISIONS (qui, quand, pourquoi)
-- Append-only : aucune ligne n'est jamais modifiée ni supprimée.
-- ---------------------------------------------------------------------------
create table if not exists aura.decision_log (
  id           bigserial primary key,
  cabinet_id   uuid references aura.cabinets(id) on delete cascade,
  dossier_id   text not null,
  piece_key    text,
  piece_label  text,
  action       text not null,   -- creation | depot | verdict_ia | validation | refus | forcage | redemande | scellement
  status       text,            -- état de la pièce après l'événement
  reason       text,
  actor_kind   text not null,   -- ia | client | cabinet | systeme
  actor_email  text,
  actor_name   text,
  provider     text,
  confidence   numeric,
  created_at   timestamptz not null default now()
);

create index if not exists decision_log_dossier_idx on aura.decision_log (dossier_id, created_at);
create index if not exists decision_log_cabinet_idx on aura.decision_log (cabinet_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. UTILISATEURS MULTIPLES
-- ---------------------------------------------------------------------------
create table if not exists aura.users (
  id                uuid primary key default gen_random_uuid(),
  cabinet_id        uuid not null references aura.cabinets(id) on delete cascade,
  name              text not null default '',
  email             text not null,
  password_hash     text,
  role              text not null default 'member',  -- owner | member
  status            text not null default 'active',  -- active | invited | revoked
  invited_by        text,
  invite_token      text,
  invite_expires_at timestamptz,
  created_at        timestamptz not null default now(),
  last_login_at     timestamptz
);

create unique index if not exists users_email_unique on aura.users (lower(email));
create index if not exists users_cabinet_idx on aura.users (cabinet_id);
create unique index if not exists users_invite_token_unique on aura.users (invite_token) where invite_token is not null;

-- Chaque cabinet existant devient propriétaire de son propre compte.
insert into aura.users (cabinet_id, name, email, password_hash, role, status)
select c.id, c.name, c.email, c.password_hash, 'owner', 'active'
  from aura.cabinets c
 where not exists (select 1 from aura.users u where lower(u.email) = lower(c.email));

-- ---------------------------------------------------------------------------
-- 3. DOMAINE PERSONNALISÉ
-- ---------------------------------------------------------------------------
alter table aura.cabinets add column if not exists domain text;
create unique index if not exists cabinets_domain_unique
  on aura.cabinets (lower(domain)) where domain is not null;

-- ---------------------------------------------------------------------------
-- 4. DROITS POUR LE COMPTE APPLICATIF
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on aura.decision_log to aura_app;
grant usage on sequence aura.decision_log_id_seq to aura_app;
grant select, insert, update, delete on aura.users to aura_app;

-- ---------------------------------------------------------------------------
-- 5. VÉRIFICATION (doit renvoyer trois lignes)
-- ---------------------------------------------------------------------------
select 'decision_log' as objet, count(*) as lignes from aura.decision_log
union all select 'users', count(*) from aura.users
union all select 'cabinets_avec_domaine', count(*) from aura.cabinets where domain is not null;
