-- Isolation entre cabinets imposée par la base.
--
-- Jusqu'ici l'isolation reposait sur `cabinet_id` dans chaque requête du code.
-- Une erreur de code (une requête oubliée) pouvait donc exposer un autre cabinet.
-- Cette migration ajoute des politiques RESTRICTIVES : elles s'ajoutent (ET) aux
-- politiques existantes sans les remplacer.
--
-- Fonctionnement : le serveur ouvre une transaction par requête d'un cabinet
-- connecté et y pose `aura.scope = 'cabinet'` et `aura.cabinet_id = <uuid>`
-- (set_config local à la transaction). Dans ce mode, la base ne montre ni ne
-- laisse écrire que les lignes de ce cabinet.
-- Hors de ce mode (lien client par jeton, webhook de paiement, inscription,
-- connexion, opérateur), rien ne change : accès complet, comme avant.
--
-- Limite honnête : le rôle applicatif peut poser ces paramètres lui-même. Cette
-- défense protège contre les ERREURS de code (requête sans filtre, identifiant
-- deviné), pas contre quelqu'un qui exécuterait du SQL arbitraire. La fermer
-- demanderait un rôle de base distinct par cabinet : voir architecture.md.
--
-- Sans effet sur le code déployé avant : tant que `aura.scope` n'est pas posé,
-- toutes les politiques laissent passer.

create or replace function aura.dans_le_cabinet(c uuid) returns boolean
language sql stable as $$
  select coalesce(current_setting('aura.scope', true), '') <> 'cabinet'
      or c = nullif(current_setting('aura.cabinet_id', true), '')::uuid
$$;

create or replace function aura.hors_cabinet() returns boolean
language sql stable as $$
  select coalesce(current_setting('aura.scope', true), '') <> 'cabinet'
$$;

grant execute on function aura.dans_le_cabinet(uuid) to aura_app;
grant execute on function aura.hors_cabinet() to aura_app;

do $$
declare t text;
begin
  -- Tables portant `cabinet_id`
  foreach t in array array['users','clients','dossiers','decision_log','payments',
                           'relation_messages','cabinet_profile']
  loop
    if to_regclass('aura.' || t) is null then continue; end if;
    execute format('drop policy if exists isolation_cabinet on aura.%I', t);
    execute format(
      'create policy isolation_cabinet on aura.%I as restrictive for all to aura_app
         using (aura.dans_le_cabinet(cabinet_id)) with check (aura.dans_le_cabinet(cabinet_id))', t);
  end loop;
end $$;

-- La table des cabinets : un cabinet ne voit que sa propre ligne.
drop policy if exists isolation_cabinet on aura.cabinets;
create policy isolation_cabinet on aura.cabinets as restrictive for all to aura_app
  using (aura.dans_le_cabinet(id)) with check (aura.dans_le_cabinet(id));

-- Pièces et fichiers : rattachés à un dossier, donc au cabinet de ce dossier
-- (la sous-requête est elle-même filtrée par la politique des dossiers).
drop policy if exists isolation_cabinet on aura.pieces;
create policy isolation_cabinet on aura.pieces as restrictive for all to aura_app
  using (aura.hors_cabinet() or exists (select 1 from aura.dossiers d where d.id = pieces.dossier_id))
  with check (aura.hors_cabinet() or exists (select 1 from aura.dossiers d where d.id = pieces.dossier_id));

drop policy if exists isolation_cabinet on aura.files;
create policy isolation_cabinet on aura.files as restrictive for all to aura_app
  using (aura.hors_cabinet() or exists (select 1 from aura.dossiers d where d.id = files.dossier_id))
  with check (aura.hors_cabinet() or exists (select 1 from aura.dossiers d where d.id = files.dossier_id));

-- Volontairement non isolées : outbox, leads, webhook_events (pas de données de
-- cabinet à protéger, et l'envoi d'e-mails ne doit pas être touché).
