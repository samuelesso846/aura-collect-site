-- Identité du cabinet affichée sur la page de dépôt de ses clients :
-- logo, mot d'accueil, contact, couleur d'accent.
-- Table à part : `aura.cabinets` est lue en entier (select *) à chaque requête,
-- on n'y fait pas voyager une image.

create table if not exists aura.cabinet_profile (
  cabinet_id    uuid        primary key references aura.cabinets(id) on delete cascade,
  welcome       text        not null default '' check (char_length(welcome) <= 500),
  phone         text        not null default '' check (char_length(phone) <= 20),
  accent        text        not null default 'bleu'
                check (accent in ('bleu','vert','orange','rouge','violet','ardoise')),
  logo          bytea,
  logo_mime     text        check (logo_mime in ('image/png','image/jpeg')),
  logo_version  integer     not null default 0,
  updated_at    timestamptz not null default now(),
  -- Le serveur recompresse le logo ; la base refuse tout de même l'excès.
  constraint cabinet_profile_logo_size check (logo is null or octet_length(logo) <= 262144),
  constraint cabinet_profile_logo_pair check ((logo is null) = (logo_mime is null))
);

alter table aura.cabinet_profile enable row level security;
drop policy if exists aura_app_all on aura.cabinet_profile;
create policy aura_app_all on aura.cabinet_profile
  for all to aura_app using (true) with check (true);

grant select, insert, update, delete on aura.cabinet_profile to aura_app;
