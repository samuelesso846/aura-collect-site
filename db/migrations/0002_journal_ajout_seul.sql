-- Journal des décisions en ajout seul.
-- Le code n'a jamais modifié ni supprimé une ligne ; la base l'interdit désormais
-- au rôle applicatif. Une trace d'audit qu'on peut réécrire n'est pas une preuve.
revoke update, delete, truncate on aura.decision_log from aura_app;

-- Même la politique par ligne ne laisse plus que l'ajout et la lecture.
drop policy if exists aura_app_all on aura.decision_log;
drop policy if exists aura_app_read on aura.decision_log;
drop policy if exists aura_app_insert on aura.decision_log;
create policy aura_app_read   on aura.decision_log for select to aura_app using (true);
create policy aura_app_insert on aura.decision_log for insert to aura_app with check (true);
