'use strict';
/* Tests de bout en bout : le vrai serveur, une vraie base, deux cabinets connectés. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const { migrate } = require('../server/migrate');

const PGPORT = 54331, APPPORT = 38791;
const DB = `postgres://postgres:pw@localhost:${PGPORT}/aura_http`;
const BASE = `http://127.0.0.1:${APPPORT}`;
const PASS = 'Mot-de-passe-test-42';
let pg, srv, ids = {};

const hash = (p) => { const s = crypto.randomBytes(8).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(p, s, 64).toString('hex'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(email) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
  assert.strictEqual(r.status, 200, 'connexion ' + email);
  return r.headers.get('set-cookie').split(';')[0];
}
const call = (cookie, method, url, body) => fetch(BASE + url, {
  method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-http-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PGPORT, persistent: false,
    initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_http');
  await migrate(DB, { ssl: false });

  const c = new Client({ connectionString: DB }); await c.connect();
  const cab = async (n) => (await c.query('insert into aura.cabinets (name, slug, email, plan_status, trial_ends_at) values ($1,$2,$3,$4, now() + interval \'10 days\') returning id', [n, n.toLowerCase(), n.toLowerCase() + '@cab.test', 'trialing'])).rows[0].id;
  ids.A = await cab('CabA'); ids.B = await cab('CabB');
  const usr = async (cabinet, email, role) => (await c.query("insert into aura.users (cabinet_id, name, email, password_hash, role, status) values ($1,$2,$2,$3,$4,'active') returning id", [cabinet, email, hash(PASS), role])).rows[0].id;
  ids.ownerA = await usr(ids.A, 'owner-a@cab.test', 'owner');
  ids.memberA = await usr(ids.A, 'member-a@cab.test', 'member');
  ids.ownerB = await usr(ids.B, 'owner-b@cab.test', 'owner');
  for (const [k, cabinet] of [['dA', ids.A], ['dB', ids.B]]) {
    const id = 'd_' + k, tok = 'tok' + k + 'x'.repeat(16);
    await c.query("insert into aura.dossiers (id, token, client, email, template, cabinet_id) values ($1,$2,'Client','c@client.test','bilan',$3)", [id, tok, cabinet]);
    await c.query("insert into aura.pieces (dossier_id, key, label, rule, position) values ($1,'avis-imposition','Avis','moins de 12 mois',0)", [id]);
    ids[k] = id;
  }
  await c.end();

  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { PATH: process.env.PATH, PORT: String(APPPORT), DATABASE_URL: DB, PG_NO_SSL: '1', SESSION_SECRET: 'secret-de-test', NODE_ENV: 'test' },
    stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch (_) {} await sleep(250); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { if (srv) srv.kill(); await pg.stop(); });

test('fichiers internes introuvables, pages publiques servies', async () => {
  for (const p of ['/server/index.js', '/render.yaml', '/package.json', '/db/migrations/0000_baseline.sql', '/documents/architecture.md', '/.env', '/tests/http.test.js'])
    assert.strictEqual((await fetch(BASE + p)).status, 404, p);
  assert.strictEqual((await fetch(BASE + '/')).status, 200);
  assert.strictEqual((await fetch(BASE + '/contact')).status, 200);
  assert.strictEqual((await fetch(BASE + '/api/health')).status, 200);
});

test('sans connexion, tout l\'espace cabinet est fermé', async () => {
  for (const [m, u] of [['GET', '/api/dossiers'], ['GET', '/api/clients'], ['GET', `/api/dossiers/${ids.dA}/journal`], ['GET', `/api/dossiers/${ids.dA}/export`], ['POST', `/api/dossiers/${ids.dA}/seal`], ['GET', '/api/team']])
    assert.strictEqual((await call('', m, u)).status, 401, m + ' ' + u);
});

test('un cabinet ne voit que ses dossiers', async () => {
  const a = await login('owner-a@cab.test');
  const list = await (await call(a, 'GET', '/api/dossiers')).json();
  const items = Array.isArray(list) ? list : (list.dossiers || []);
  assert.deepStrictEqual(items.map(d => d.id), [ids.dA]);
});

test('un cabinet ne peut agir sur aucun dossier d\'un autre', async () => {
  const b = await login('owner-b@cab.test');
  const routes = [
    ['GET', `/api/dossiers/${ids.dA}/journal`], ['GET', `/api/dossiers/${ids.dA}/export`],
    ['POST', `/api/dossiers/${ids.dA}/seal`], ['POST', `/api/dossiers/${ids.dA}/remind`],
    ['GET', `/api/dossiers/${ids.dA}/relation`], ['POST', `/api/dossiers/${ids.dA}/relation/1/status`, { status: 'envoye' }],
    ['GET', `/api/dossiers/${ids.dA}/certificate`], ['GET', `/api/dossiers/${ids.dA}/integrity`],
    ['POST', `/api/dossiers/${ids.dA}/pieces/avis-imposition/reject`, { reason: 'x' }],
    ['POST', `/api/dossiers/${ids.dA}/pieces/avis-imposition/confirm`, {}]
  ];
  for (const [m, u, body] of routes) {
    const s = (await call(b, m, u, body)).status;
    assert.ok(s === 403 || s === 404, `${m} ${u} a répondu ${s} au lieu de 403/404`);
  }
  // Et rien n'a bougé chez A.
  const c = new Client({ connectionString: DB }); await c.connect();
  const { rows } = await c.query('select seal_hash from aura.dossiers where id = $1', [ids.dA]);
  const pc = await c.query("select status from aura.pieces where dossier_id = $1", [ids.dA]);
  await c.end();
  assert.strictEqual(rows[0].seal_hash, null);
  assert.strictEqual(pc.rows[0].status, 'wait');
});

test('retirer un accès coupe aussitôt sa session', async () => {
  const owner = await login('owner-a@cab.test');
  const member = await login('member-a@cab.test');
  assert.strictEqual((await call(member, 'GET', '/api/dossiers')).status, 200);
  const r = await call(owner, 'POST', `/api/team/${ids.memberA}/revoke`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call(member, 'GET', '/api/dossiers')).status, 401, 'la session révoquée doit être refusée');
  const me = await (await call(member, 'GET', '/api/me')).json();
  assert.strictEqual(me.authenticated, false);
});

test('un membre ne peut pas retirer l\'accès d\'un autre cabinet', async () => {
  const b = await login('owner-b@cab.test');
  const r = await call(b, 'POST', `/api/team/${ids.ownerA}/revoke`);
  assert.ok(r.status === 403 || r.status === 404, 'statut ' + r.status);
});

test('cookie falsifié ou expiré refusé', async () => {
  assert.strictEqual((await call('aura_session=abc.def', 'GET', '/api/dossiers')).status, 401);
  const payload = (Date.now() + 1e6) + ':' + ids.A + ':';
  const forged = 'aura_session=' + Buffer.from(payload).toString('base64url') + '.' + 'x'.repeat(43);
  assert.strictEqual((await call(forged, 'GET', '/api/dossiers')).status, 401);
});
