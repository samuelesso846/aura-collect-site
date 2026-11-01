-- ---------------------------------------------------------------------------
-- Aura Collect — demandes entrantes (formulaire de contact public)
-- À exécuter une fois dans l'éditeur SQL de Supabase.
-- ---------------------------------------------------------------------------
-- Le formulaire de contact n'envoyait rien : il ouvrait la messagerie du
-- visiteur. Sur mobile, la plupart des prospects n'ont pas de client mail
-- configuré — la demande était perdue sans trace. Cette table conserve
-- chaque demande, qu'un email parte ou non.

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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aura_app') then
    grant select, insert, update on aura.leads to aura_app;
  end if;
end $$;
