'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const { migrate } = require('../server/migrate');

let pg, url;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-pg-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 54329, persistent: false, initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_test');
  url = 'postgres://postgres:pw@localhost:54329/aura_test';
});
test.after(async () => { await pg.stop(); });

test('les migrations s\'appliquent, puis sont idempotentes', async () => {
  const r1 = await migrate(url, { ssl: false });
  assert.ok(r1.applied.includes('0000_baseline.sql'));
  const r2 = await migrate(url, { ssl: false });
  assert.deepStrictEqual(r2.applied, []);
});

test('le journal des décisions est en ajout seul pour le rôle applicatif', async () => {
  const c = new Client({ connectionString: url }); await c.connect();
  await c.query("insert into aura.cabinets (name, slug) values ('X','x')");
  await c.query('set role aura_app');
  await c.query("insert into aura.decision_log (dossier_id, action, actor_kind) values ('d1','depot','client')");
  assert.strictEqual((await c.query('select count(*)::int n from aura.decision_log')).rows[0].n, 1);
  await assert.rejects(c.query("update aura.decision_log set reason = 'x'"), /permission denied/);
  await assert.rejects(c.query('delete from aura.decision_log'), /permission denied/);
  await c.end();
});

test('le schéma contient les 11 tables + relation_messages, avec RLS', async () => {
  const c = new Client({ connectionString: url }); await c.connect();
  const { rows } = await c.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='aura' and relkind='r' order by 1");
  await c.end();
  const names = rows.map(r => r.relname);
  for (const t of ['cabinets','users','clients','dossiers','pieces','files','decision_log','payments','webhook_events','outbox','leads','relation_messages'])
    assert.ok(names.includes(t), 'table manquante : ' + t);
  for (const r of rows) if (r.relname !== 'schema_migrations') assert.ok(r.relrowsecurity, 'RLS absente : ' + r.relname);
});
