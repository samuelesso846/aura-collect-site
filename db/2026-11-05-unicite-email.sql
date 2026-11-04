-- Aura Collect — unicité des adresses email des espaces
--
-- À exécuter une fois, dans Supabase → SQL Editor (rôle postgres).
-- Le rôle applicatif aura_app ne peut pas créer d'index : il n'est pas
-- propriétaire de la table. D'où cette migration manuelle.
--
-- Pourquoi : aura.cabinets n'avait aucune contrainte sur email. L'unicité
-- n'était assurée que par un SELECT avant INSERT dans /api/signup. Deux
-- inscriptions simultanées avec la même adresse pouvaient donc créer deux
-- espaces distincts ; le second ne recevait plus jamais ses emails.
--
-- L'index porte sur lower(email) : les adresses sont enregistrées en
-- minuscules et comparées sans tenir compte de la casse (findByEmail).

begin;

-- Garde-fou : on refuse de créer l'index si des doublons existent déjà,
-- plutôt que de laisser une contrainte échouer en production.
do $$
declare doublons integer;
begin
  select count(*) into doublons from (
    select lower(email)
      from aura.cabinets
     where email is not null
     group by 1
    having count(*) > 1
  ) d;

  if doublons > 0 then
    raise exception 'Refus : % adresse(s) email en double dans aura.cabinets. Corrigez-les avant de relancer.', doublons;
  end if;
end $$;

create unique index if not exists cabinets_email_unique
  on aura.cabinets (lower(email))
  where email is not null;

commit;

-- Vérification après coup :
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'aura' and tablename = 'cabinets';
