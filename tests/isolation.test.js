'use strict';
/* Isolation entre cabinets : un cabinet ne doit jamais lire ni modifier
   les données d'un autre, sur une vraie base PostgreSQL. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;
const { migrate } = require('../server/migrate');

const PORT = 54330;
const URL_DB = `postgres://postgres:pw@localhost:${PORT}/aura_iso`;
let pg, store, A, B, dA, dB;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-iso-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PORT, persistent: false,
    initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_iso');
  await migrate(URL_DB, { ssl: false });

  process.env.DATABASE_URL = URL_DB;
  process.env.PG_NO_SSL = '1';
  store = require('../server/lib/store');

  const mk = async (name, email) => (await store.pool.query(
    'insert into aura.cabinets (name, slug, email) values ($1,$2,$3) returning id', [name, name.toLowerCase(), email])).rows[0].id;
  A = await mk('CabinetA', 'a@exemple.test');
  B = await mk('CabinetB', 'b@exemple.test');

  for (const [cab, label] of [[A, 'Client A'], [B, 'Client B']]) {
    const c = await store.ensureClient(cab, { name: label, email: label.replace(' ', '').toLowerCase() + '@client.test' });
    const d = store.createDossier({ client: label, email: 'x@client.test', template: 'bilan', clientId: c.id });
    d.cabinetId = cab;
    await store.insertDossier(d);
    await store.addDecision({ cabinetId: cab, dossierId: d.id, action: 'depot', actorKind: 'client' });
    await store.addRelationMessage({ cabinetId: cab, dossierId: d.id, client: label, channel: 'whatsapp', body: 'bonjour', status: 'prepare' });
    await store.inviteUser(cab, { name: label, email: `u-${label.replace(' ', '')}@cab.test`, role: 'member', token: 'tk' + label.replace(' ', ''), expiresAt: new Date(Date.now() + 864e5) });
    if (cab === A) dA = { d, c }; else dB = { d, c };
  }
});
test.after(async () => { try { await store.pool.end(); } catch (_) {} await pg.stop(); });

test('dossiers : lecture et liste cloisonnées', async () => {
  assert.ok(await store.getDossier(dA.d.id, A));
  assert.strictEqual(await store.getDossier(dA.d.id, B), null);
  assert.deepStrictEqual((await store.listDossiers(A)).map(x => x.id), [dA.d.id]);
  assert.deepStrictEqual((await store.listDossiers(B)).map(x => x.id), [dB.d.id]);
  assert.strictEqual(await store.countDossiers(A), 1);
});

test('clients : cloisonnés', async () => {
  assert.ok(await store.getClient(dA.c.id, A));
  assert.strictEqual(await store.getClient(dA.c.id, B), null);
  assert.deepStrictEqual((await store.listClients(B)).map(c => c.name), ['Client B']);
});

test('utilisateurs : liste, lecture et révocation cloisonnées', async () => {
  const uA = (await store.listUsers(A))[0];
  assert.ok(uA);
  assert.strictEqual(await store.getUser(uA.id, B), null);
  assert.strictEqual(await store.revokeUser(uA.id, B), null, 'le cabinet B ne peut pas révoquer un utilisateur de A');
  assert.ok(await store.revokeUser(uA.id, A));
});

test('messages de relance : liste et changement de statut cloisonnés', async () => {
  const [m] = await store.listRelationMessages(dA.d.id, A);
  assert.ok(m);
  assert.deepStrictEqual(await store.listRelationMessages(dA.d.id, B), []);
  assert.strictEqual(await store.setRelationStatus(m.id, dA.d.id, B, 'envoye'), null);
  assert.ok(await store.setRelationStatus(m.id, dA.d.id, A, 'envoye'));
});

test('journal des décisions : cloisonné, et fermé si le cabinet est absent', async () => {
  assert.strictEqual((await store.listDecisions(dA.d.id, A)).length, 1);
  assert.deepStrictEqual(await store.listDecisions(dA.d.id, B), []);
  assert.deepStrictEqual(await store.listDecisions(dA.d.id, undefined), []);
  assert.deepStrictEqual(await store.listDecisions(dA.d.id, null), []);
});
