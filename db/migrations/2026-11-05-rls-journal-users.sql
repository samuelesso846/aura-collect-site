-- Politiques d'accès manquantes pour les deux nouvelles tables.
-- Même règle que les tables existantes : le rôle applicatif gère tout,
-- l'isolation entre cabinets est faite par le code (cabinet_id).
alter table aura.decision_log enable row level security;
drop policy if exists aura_app_all on aura.decision_log;
create policy aura_app_all on aura.decision_log for all to aura_app using (true) with check (true);

alter table aura.users enable row level security;
drop policy if exists aura_app_all on aura.users;
create policy aura_app_all on aura.users for all to aura_app using (true) with check (true);
