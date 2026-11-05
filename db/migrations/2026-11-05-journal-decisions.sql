-- Journal des décisions : qui, quand, pourquoi. Append-only : aucune ligne
-- n'est jamais mise à jour ni supprimée, même si le dossier évolue.
create table if not exists aura.decision_log (
  id           bigserial primary key,
  cabinet_id   uuid references aura.cabinets(id) on delete cascade,
  dossier_id   text not null,
  piece_key    text,
  piece_label  text,
  action       text not null,     -- creation | depot | verdict_ia | validation | refus | forcage | redemande | scellement
  status       text,              -- état de la pièce après l'événement
  reason       text,
  actor_kind   text not null,     -- ia | client | cabinet | systeme
  actor_email  text,
  actor_name   text,
  provider     text,
  confidence   numeric,
  created_at   timestamptz not null default now()
);

create index if not exists decision_log_dossier_idx on aura.decision_log (dossier_id, created_at);
create index if not exists decision_log_cabinet_idx on aura.decision_log (cabinet_id, created_at desc);
