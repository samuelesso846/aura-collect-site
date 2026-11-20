-- Double authentification (TOTP) par utilisateur.
-- Le secret est stocké chiffré (AES-256-GCM, côté serveur) ; les codes de secours
-- sous forme d'empreintes SHA-256 ; totp_step mémorise le dernier code accepté
-- pour interdire de le rejouer.
alter table aura.users add column if not exists totp_secret text;
alter table aura.users add column if not exists totp_enabled boolean not null default false;
alter table aura.users add column if not exists totp_recovery text[] not null default '{}';
alter table aura.users add column if not exists totp_step bigint not null default 0;
