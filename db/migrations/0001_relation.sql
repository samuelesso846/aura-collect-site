-- Aura Relation — historique des messages de fin de dossier.
-- Un message préparé n'est jamais « envoyé » par la plateforme : on enregistre
-- ce que le cabinet a préparé, ouvert et déclaré envoyé. La remise et la
-- lecture ne sont pas connues sans fournisseur, et ne sont donc pas stockées.

create table if not exists aura.relation_messages (
  id            bigserial primary key,
  cabinet_id    uuid        not null,
  dossier_id    text        not null,
  client        text,
  channel       text        not null default 'whatsapp',
  template_key  text,
  body          text        not null,
  status        text        not null default 'prepare',
  actor_email   text,
  actor_name    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists relation_messages_dossier_idx
  on aura.relation_messages (dossier_id, created_at desc);

-- Même règle que les autres tables : le rôle applicatif gère tout,
-- l'isolation entre cabinets est faite par le code (cabinet_id).
alter table aura.relation_messages enable row level security;
drop policy if exists aura_app_all on aura.relation_messages;
create policy aura_app_all on aura.relation_messages
  for all to aura_app using (true) with check (true);

grant select, insert, update, delete on aura.relation_messages to aura_app;
grant usage, select on sequence aura.relation_messages_id_seq to aura_app;
