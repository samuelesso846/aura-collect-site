'use strict';
/* Isolation par ligne imposée par la base (migration 0004).
   On se connecte comme le rôle applicatif (pas administrateur, sinon la
   sécurité par ligne est ignorée) et on exécute des requêtes SANS filtre de
   cabinet, comme le ferait un oubli dans le code. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const { migrate } = require('../server/migrate');

const PORT = 54331;
const ADMIN = `postgres://postgres:pw@localhost:${PORT}/aura_rls`;
const APP = `postgres://aura_app:pw@localhost:${PORT}/aura_rls`;
let pg, store, scope, A, B, dA, dB;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-rls-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PORT, persistent: false,
    initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_rls');
  await migrate(ADMIN, { ssl: false });
  const admin = new Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query("alter role aura_app login password 'pw'");
  await admin.end();

  process.env.DATABASE_URL = APP;
  process.env.PG_NO_SSL = '1';
  store = require('../server/lib/store');
  scope = require('../server/lib/scope');

  const mk = async (name, email) => (await store.pool.query(
    'insert into aura.cabinets (name, slug, email) values ($1,$2,$3) returning id', [name, name.toLowerCase(), email])).rows[0].id;
  A = await mk('CabinetA', 'a@exemple.test');
  B = await mk('CabinetB', 'b@exemple.test');
  for (const cab of [A, B]) {
    const c = await store.ensureClient(cab, { name: 'Client ' + cab.slice(0, 4), email: cab.slice(0, 4) + '@client.test' });
    const d = store.createDossier({ client: 'Client ' + cab.slice(0, 4), email: 'x@client.test', template: 'bilan', clientId: c.id });
    d.cabinetId = cab;
    await store.insertDossier(d);
    await store.addDecision({ cabinetId: cab, dossierId: d.id, action: 'depot', actorKind: 'client' });
    if (cab === A) dA = d; else dB = d;
  }
});
test.after(async () => { try { await store.pool.end(); } catch (_) {} await pg.stop(); });

const ids = (r) => r.rows.map((x) => x.id);

test('hors périmètre : accès complet, comme avant', async () => {
  const r = await store.pool.query('select id from aura.dossiers');
  assert.strictEqual(r.rowCount, 2);
});

test('dans le périmètre : une requête SANS filtre ne voit que son cabinet', async () => {
  const r = await scope.run(A, () => store.pool.query('select id from aura.dossiers'));
  assert.deepStrictEqual(ids(r), [dA.id]);
  const cabs = await scope.run(A, () => store.pool.query('select id from aura.cabinets'));
  assert.deepStrictEqual(ids(cabs), [A]);
  const p = await scope.run(B, () => store.pool.query('select dossier_id from aura.pieces'));
  assert.ok(p.rows.length > 0 && p.rows.every((x) => x.dossier_id === dB.id));
  const j = await scope.run(B, () => store.pool.query('select dossier_id from aura.decision_log'));
  assert.ok(j.rows.length > 0 && j.rows.every((x) => x.dossier_id === dB.id));
});

test('dans le périmètre : lecture par identifiant deviné d\'un autre cabinet = vide', async () => {
  const r = await scope.run(A, () => store.pool.query('select * from aura.dossiers where id = $1', [dB.id]));
  assert.strictEqual(r.rowCount, 0);
  const p = await scope.run(A, () => store.pool.query('select * from aura.pieces where dossier_id = $1', [dB.id]));
  assert.strictEqual(p.rowCount, 0);
});

test('dans le périmètre : modifier ou supprimer chez un autre cabinet n\'atteint aucune ligne', async () => {
  const u = await scope.run(A, () => store.pool.query("update aura.dossiers set client = 'piraté' where id = $1", [dB.id]));
  assert.strictEqual(u.rowCount, 0);
  const d = await scope.run(A, () => store.pool.query('delete from aura.pieces where dossier_id = $1', [dB.id]));
  assert.strictEqual(d.rowCount, 0);
  const intact = await store.pool.query('select client from aura.dossiers where id = $1', [dB.id]);
  assert.notStrictEqual(intact.rows[0].client, 'piraté');
});

test('dans le périmètre : écrire pour un autre cabinet est refusé', async () => {
  await assert.rejects(scope.run(A, () => store.pool.query(
    "insert into aura.clients (cabinet_id, name, email) values ($1, 'intrus', 'i@client.test')", [B])));
  await assert.rejects(scope.run(A, () => store.insertDossier(Object.assign(
    store.createDossier({ client: 'Intrus', email: 'i@client.test', template: 'bilan' }), { cabinetId: B }))));
});

test('transaction multi-requêtes : périmètre posé au begin, retiré au release', async () => {
  const d = store.createDossier({ client: 'Légitime', email: 'l@client.test', template: 'bilan' });
  d.cabinetId = A;
  await scope.run(A, () => store.insertDossier(d));
  const apres = await store.pool.query('select count(*)::int n from aura.dossiers');
  assert.strictEqual(apres.rows[0].n, 3, 'une connexion rendue ne garde pas de périmètre');
});

test('un cabinet connecté ne peut pas lire les lignes d\'un autre via le journal des décisions', async () => {
  const r = await scope.run(A, () => store.listDecisions(dB.id, B));
  assert.strictEqual(r.length, 0);
});

test('requêtes concurrentes de deux cabinets : aucun mélange', async () => {
  const out = await Promise.all(Array.from({ length: 20 }, (_, i) => {
    const cab = i % 2 ? A : B;
    return scope.run(cab, () => store.pool.query('select cabinet_id from aura.dossiers'))
      .then((r) => r.rows.every((x) => x.cabinet_id === cab));
  }));
  assert.ok(out.every(Boolean));
});

test('interrupteur RLS_SCOPE=0 : retour à l\'accès complet', async () => {
  process.env.RLS_SCOPE = '0';
  try {
    const r = await scope.run(A, () => store.pool.query('select id from aura.dossiers'));
    assert.ok(r.rowCount >= 2);
  } finally { delete process.env.RLS_SCOPE; }
});
