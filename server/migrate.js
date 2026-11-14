#!/usr/bin/env node
'use strict';
/* Lanceur de migrations : applique db/migrations/NNNN_nom.sql dans l'ordre,
   chacune dans une transaction, et note le résultat dans aura.schema_migrations
   avec une empreinte SHA-256 (une migration déjà appliquée ne doit jamais être modifiée).

   Usage :  DATABASE_URL=... node server/migrate.js [--status]
   Il n'est PAS lancé au démarrage de l'application : on l'exécute volontairement. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'db', 'migrations');

function listMigrations() {
  return fs.readdirSync(DIR).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f => {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    return { name: f, sql, hash: crypto.createHash('sha256').update(sql).digest('hex') };
  });
}

async function migrate(connectionString, { statusOnly = false, ssl } = {}) {
  const client = new Client({ connectionString, ssl });
  await client.connect();
  const done = [], skipped = [];
  try {
    await client.query('create schema if not exists aura');
    await client.query(`create table if not exists aura.schema_migrations (
      name text primary key, hash text not null, applied_at timestamptz not null default now())`);
    const { rows } = await client.query('select name, hash from aura.schema_migrations');
    const applied = new Map(rows.map(r => [r.name, r.hash]));
    for (const m of listMigrations()) {
      if (applied.has(m.name)) {
        if (applied.get(m.name) !== m.hash) throw new Error(`Migration modifiée après application : ${m.name}`);
        skipped.push(m.name); continue;
      }
      if (statusOnly) { done.push(m.name + ' (en attente)'); continue; }
      try {
        await client.query('begin');
        await client.query(m.sql);
        await client.query('insert into aura.schema_migrations(name, hash) values ($1,$2)', [m.name, m.hash]);
        await client.query('commit');
        done.push(m.name);
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw new Error(`Échec de ${m.name} : ${e.message}`);
      }
    }
  } finally { await client.end(); }
  return { applied: done, alreadyApplied: skipped };
}

module.exports = { migrate, listMigrations };

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL manquant'); process.exit(1); }
  const ssl = process.env.PG_NO_SSL === '1' ? false : { rejectUnauthorized: false };
  migrate(url, { statusOnly: process.argv.includes('--status'), ssl })
    .then(r => { console.log(JSON.stringify(r, null, 2)); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
