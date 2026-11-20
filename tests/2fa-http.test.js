'use strict';
/* Double authentification, de bout en bout : le vrai serveur, sous le rôle applicatif. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const { migrate } = require('../server/migrate');
const totp = require('../server/lib/totp');

const PGPORT = 54341, APPPORT = 38796;
const DB = `postgres://postgres:pw@localhost:${PGPORT}/aura_2fa`;
const BASE = `http://127.0.0.1:${APPPORT}`;
const PASS = 'Mot-de-passe-test-42';
const EMAIL = 'proprio@cab2fa.test';
let pg, srv, cabinetId, secret, recovery;

const hash = (p) => { const s = crypto.randomBytes(8).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(p, s, 64).toString('hex'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body, cookie) => fetch(BASE + url, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie || '' }, body: JSON.stringify(body || {}) });
const loginCall = (extra) => post('/api/login', Object.assign({ email: EMAIL, password: PASS }, extra || {}));
const cookieOf = (r) => r.headers.get('set-cookie').split(';')[0];
const codeAt = (decalage) => totp.code(secret, totp.pasDe(Date.now()) + decalage);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-2fa-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PGPORT, persistent: false,
    initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_2fa');
  await migrate(DB, { ssl: false });
  const c = new Client({ connectionString: DB }); await c.connect();
  cabinetId = (await c.query("insert into aura.cabinets (name, slug, email, plan, plan_status, trial_ends_at) values ('Cab2FA','cab2fa','cab2fa@cab.test','cabinet','trialing', now() + interval '10 days') returning id")).rows[0].id;
  await c.query("insert into aura.users (cabinet_id, name, email, password_hash, role, status) values ($1,'Proprio',$2,$3,'owner','active')", [cabinetId, EMAIL, hash(PASS)]);
  await c.query("alter role aura_app login password 'pw'");
  await c.end();
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { PATH: process.env.PATH, PORT: String(APPPORT), DATABASE_URL: DB.replace('//postgres:pw@', '//aura_app:pw@'), PG_NO_SSL: '1', SESSION_SECRET: 'secret-de-test', NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (_) {} await sleep(250); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { if (srv) srv.kill(); await pg.stop(); });

test('sans double authentification : la connexion se fait avec le mot de passe seul', async () => {
  const r = await loginCall();
  assert.strictEqual(r.status, 200);
  const cookie = cookieOf(r);
  const etat = await (await fetch(BASE + '/api/2fa', { headers: { cookie } })).json();
  assert.deepStrictEqual(etat, { available: true, enabled: false, recoveryLeft: 0 });
});

test('activation : il faut un bon code, puis les codes de secours ne sont donnés qu\'une fois', async () => {
  const cookie = cookieOf(await loginCall());

  // Activer sans avoir généré de QR code
  assert.strictEqual((await post('/api/2fa/enable', { code: '123456' }, cookie)).status, 400);

  const setup = await post('/api/2fa/setup', {}, cookie);
  assert.strictEqual(setup.status, 200);
  const s = await setup.json();
  assert.match(s.qr, /<svg/);
  assert.match(s.otpauth, /^otpauth:\/\/totp\//);
  secret = s.secret.replace(/\s+/g, '');
  assert.match(secret, /^[A-Z2-7]{32}$/);

  // Mauvais code (un pas très éloigné de la fenêtre acceptée)
  const mauvais = await post('/api/2fa/enable', { code: codeAt(-10) }, cookie);
  assert.strictEqual(mauvais.status, 400);
  assert.strictEqual((await (await fetch(BASE + '/api/2fa', { headers: { cookie } })).json()).enabled, false);

  const bon = await post('/api/2fa/enable', { code: codeAt(0) }, cookie);
  assert.strictEqual(bon.status, 200);
  recovery = (await bon.json()).recoveryCodes;
  assert.strictEqual(recovery.length, 8);
  assert.ok(recovery.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)));

  const etat = await (await fetch(BASE + '/api/2fa', { headers: { cookie } })).json();
  assert.deepStrictEqual(etat, { available: true, enabled: true, recoveryLeft: 8 });

  // Déjà active : on ne regénère ni secret ni codes
  assert.strictEqual((await post('/api/2fa/setup', {}, cookie)).status, 409);
});

test('connexion : sans code = needCode, mauvais code refusé, bon code accepté, rejeu refusé', async () => {
  const sans = await loginCall();
  assert.strictEqual(sans.status, 401);
  assert.strictEqual((await sans.json()).needCode, true);
  assert.strictEqual(sans.headers.get('set-cookie'), null, 'aucune session sans second facteur');

  const mauvais = await loginCall({ code: codeAt(-10) });
  assert.strictEqual(mauvais.status, 401);
  assert.strictEqual((await mauvais.json()).needCode, true);
  assert.strictEqual(mauvais.headers.get('set-cookie'), null);

  // Le code de l'activation (pas courant) est déjà consommé : on prend le pas suivant.
  const code = codeAt(1);
  const bon = await loginCall({ code });
  assert.strictEqual(bon.status, 200);
  assert.ok(bon.headers.get('set-cookie'));

  const rejeu = await loginCall({ code });
  assert.strictEqual(rejeu.status, 401, 'un code déjà accepté ne sert pas deux fois');
  assert.strictEqual((await rejeu.json()).needCode, true);
});

test('le code utilisé à l\'activation ne peut pas servir à se connecter', async () => {
  const r = await loginCall({ code: codeAt(0) });
  assert.strictEqual(r.status, 401);
});

test('code de secours : accepté une fois, puis consommé', async () => {
  const [premier, second] = recovery;
  const ok = await loginCall({ code: premier });
  assert.strictEqual(ok.status, 200);
  const cookie = cookieOf(ok);

  const encore = await loginCall({ code: premier });
  assert.strictEqual(encore.status, 401, 'un code de secours ne sert qu\'une fois');

  // Saisie tolérante : minuscules, sans tiret
  const tolere = await loginCall({ code: second.toLowerCase().replace('-', '') });
  assert.strictEqual(tolere.status, 200);

  const etat = await (await fetch(BASE + '/api/2fa', { headers: { cookie } })).json();
  assert.strictEqual(etat.recoveryLeft, 6);
});

test('désactivation : exige le mot de passe ET un code, puis la connexion redevient simple', async () => {
  const cookie = cookieOf(await loginCall({ code: recovery[2] }));

  const mauvaisMdp = await post('/api/2fa/disable', { password: 'faux', code: recovery[3] }, cookie);
  assert.strictEqual(mauvaisMdp.status, 400);
  const sansCode = await post('/api/2fa/disable', { password: PASS, code: '' }, cookie);
  assert.strictEqual(sansCode.status, 400);
  assert.strictEqual((await (await fetch(BASE + '/api/2fa', { headers: { cookie } })).json()).enabled, true);

  const ok = await post('/api/2fa/disable', { password: PASS, code: recovery[3] }, cookie);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await (await fetch(BASE + '/api/2fa', { headers: { cookie } })).json()).enabled, false);

  assert.strictEqual((await loginCall()).status, 200, 'plus de code demandé');
});
