'use strict';
/* Rôles et droits, de bout en bout : le vrai serveur, sous le rôle applicatif. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const { migrate } = require('../server/migrate');
const droits = require('../server/lib/droits');

const PGPORT = 54340, APPPORT = 38795;
const DB = `postgres://postgres:pw@localhost:${PGPORT}/aura_roles`;
const BASE = `http://127.0.0.1:${APPPORT}`;
const PASS = 'Mot-de-passe-test-42';
let pg, srv, ids = {};

const hash = (p) => { const s = crypto.randomBytes(8).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(p, s, 64).toString('hex'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(email) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
  assert.strictEqual(r.status, 200, 'connexion ' + email);
  return r.headers.get('set-cookie').split(';')[0];
}
const call = (cookie, method, url, body) => fetch(BASE + url, {
  method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-roles-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PGPORT, persistent: false,
    initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_roles');
  await migrate(DB, { ssl: false });
  const c = new Client({ connectionString: DB }); await c.connect();
  ids.cab = (await c.query("insert into aura.cabinets (name, slug, email, plan, plan_status, trial_ends_at) values ('CabR','cabr','cabr@cab.test','cabinet','trialing', now() + interval '10 days') returning id")).rows[0].id;
  for (const [n, role] of [['owner', 'owner'], ['associe', 'associe'], ['collab', 'collaborateur'], ['lecture', 'lecture'], ['ancien', 'member']]) {
    ids[n] = (await c.query("insert into aura.users (cabinet_id, name, email, password_hash, role, status) values ($1,$2,$3,$4,$5,'active') returning id",
      [ids.cab, n, n + '@cab.test', hash(PASS), role])).rows[0].id;
  }
  await c.query("insert into aura.dossiers (id, token, client, email, template, cabinet_id) values ('d_r','tokrrrrrrrrrrrrrrrrrr','Client','c@client.test','bilan',$1)", [ids.cab]);
  await c.query("insert into aura.pieces (dossier_id, key, label, rule, position) values ('d_r','rib','RIB','au nom du titulaire',0)");
  await c.query("alter role aura_app login password 'pw'");
  await c.end();
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { PATH: process.env.PATH, PORT: String(APPPORT), DATABASE_URL: DB.replace('//postgres:pw@', '//aura_app:pw@'), PG_NO_SSL: '1', SESSION_SECRET: 'secret-de-test', NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (_) {} await sleep(250); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { if (srv) srv.kill(); await pg.stop(); });

test('droits : matrice par rôle, ancien rôle « member » = associé, inconnu = lecture', () => {
  assert.ok(droits.peut('owner', 'equipe.gerer'));
  assert.ok(!droits.peut('associe', 'equipe.gerer'));
  assert.ok(droits.peut('associe', 'dossier.sceller'));
  assert.ok(!droits.peut('collaborateur', 'dossier.sceller'));
  assert.ok(droits.peut('collaborateur', 'piece.decider'));
  assert.ok(!droits.peut('lecture', 'dossier.creer'));
  assert.ok(droits.peut('member', 'dossier.sceller'));
  assert.ok(!droits.peut('nimportequoi', 'dossier.creer'));
});

test('lecture seule : consulte, ne modifie rien', async () => {
  const c = await login('lecture@cab.test');
  assert.strictEqual((await call(c, 'GET', '/api/dossiers')).status, 200);
  for (const [m, u, b] of [['POST', '/api/dossiers', { client: 'X', email: 'x@client.test', template: 'bilan' }],
    ['POST', '/api/dossiers/d_r/pieces/rib/confirm', {}], ['POST', '/api/dossiers/d_r/pieces/rib/reject', { reason: 'x' }],
    ['POST', '/api/dossiers/d_r/seal'], ['POST', '/api/dossiers/d_r/remind'], ['POST', '/api/dossiers/d_r/relation', { text: 'x' }]]) {
    const r = await call(c, m, u, b);
    assert.strictEqual(r.status, 403, m + ' ' + u);
    assert.strictEqual((await r.json()).code, 'role');
  }
  const me = await (await call(c, 'GET', '/api/me')).json();
  assert.deepStrictEqual(me.droits, []);
  assert.strictEqual(me.role, 'lecture');
});

test('collaborateur : prépare les dossiers mais ne scelle pas', async () => {
  const c = await login('collab@cab.test');
  assert.strictEqual((await call(c, 'POST', '/api/dossiers/d_r/seal')).status, 403);
  for (const [m, u, b] of [['POST', '/api/dossiers/d_r/remind'], ['POST', '/api/dossiers/d_r/pieces/rib/reject', { reason: 'flou' }]]) {
    assert.notStrictEqual((await call(c, m, u, b)).status, 403, m + ' ' + u);
  }
  assert.strictEqual((await call(c, 'POST', '/api/billing/checkout', { plan: 'cabinet' })).status, 403);
  assert.strictEqual((await call(c, 'POST', '/api/team/invite', { name: 'x', email: 'x@y.test' })).status, 403);
});

test('associé et ancien « member » : peuvent sceller (la règle métier répond, pas le rôle)', async () => {
  for (const who of ['associe', 'ancien']) {
    const c = await login(who + '@cab.test');
    assert.notStrictEqual((await call(c, 'POST', '/api/dossiers/d_r/seal')).status, 403, who);
    assert.strictEqual((await call(c, 'POST', '/api/team/invite', { name: 'x', email: 'x@y.test' })).status, 403, who + ' ne gère pas l\'équipe');
  }
});

test('propriétaire : invite avec un rôle, change un rôle, jamais celui du propriétaire', async () => {
  const o = await login('owner@cab.test');
  const bad = await call(o, 'POST', '/api/team/invite', { name: 'Z', email: 'z1@nouveau.test', role: 'owner' });
  assert.strictEqual(bad.status, 400);
  const ok = await call(o, 'POST', '/api/team/invite', { name: 'Z', email: 'z2@nouveau.test', role: 'lecture' });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual((await ok.json()).user.role, 'lecture');

  const c = await login('collab@cab.test');
  assert.strictEqual((await call(o, 'POST', `/api/team/${ids.collab}/role`, { role: 'associe' })).status, 200);
  assert.notStrictEqual((await call(c, 'POST', '/api/dossiers/d_r/seal')).status, 403, 'le nouveau rôle s\'applique aussitôt');
  assert.strictEqual((await call(o, 'POST', `/api/team/${ids.owner}/role`, { role: 'lecture' })).status, 404);
  assert.strictEqual((await call(o, 'POST', `/api/team/${ids.associe}/role`, { role: 'owner' })).status, 400);
  const nonProprio = await login('associe@cab.test');
  assert.strictEqual((await call(nonProprio, 'POST', `/api/team/${ids.lecture}/role`, { role: 'associe' })).status, 403);
});
