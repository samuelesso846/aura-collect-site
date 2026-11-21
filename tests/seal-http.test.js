'use strict';
/* Certificat enrichi, de bout en bout : le vrai serveur, sous le rôle applicatif. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const { migrate } = require('../server/migrate');
const seal = require('../server/lib/seal');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const PGPORT = 54342, APPPORT = 38797;
const DB = `postgres://postgres:pw@localhost:${PGPORT}/aura_seal`;
const BASE = `http://127.0.0.1:${APPPORT}`;
const PASS = 'Mot-de-passe-test-42';
let pg, srv, admin, cookie, cabinetId;

const hash = (p) => { const s = crypto.randomBytes(8).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(p, s, 64).toString('hex'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (method, url, body) => fetch(BASE + url, {
  method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const journal = (dossierId, action, extra) => admin.query(
  `insert into aura.decision_log (cabinet_id, dossier_id, piece_key, piece_label, action, status, reason, actor_kind, actor_name)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [cabinetId, dossierId, (extra && extra.key) || null, (extra && extra.label) || null, action, null, (extra && extra.reason) || '', (extra && extra.kind) || 'cabinet', (extra && extra.name) || 'Ama']);

async function nouveauDossier(id, titulaires) {
  await admin.query("insert into aura.dossiers (id, token, client, email, template, cabinet_id) values ($1,$2,'Kofi Mensah','k@client.test','bilan',$3)",
    [id, 'tok' + id.padEnd(18, 'x'), cabinetId]);
  let pos = 0;
  for (const [key, label, titulaire] of titulaires) {
    await admin.query("insert into aura.pieces (dossier_id, key, label, rule, position, status, champs) values ($1,$2,$3,'r',$4,'valide',$5)",
      [id, key, label, pos++, JSON.stringify({ titulaire })]);
  }
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-seal-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PGPORT, persistent: false,
    initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_seal');
  await migrate(DB, { ssl: false });
  admin = new Client({ connectionString: DB }); await admin.connect();
  cabinetId = (await admin.query("insert into aura.cabinets (name, slug, email, plan, plan_status, trial_ends_at) values ('CabSeal','cabseal','cabseal@cab.test','cabinet','trialing', now() + interval '10 days') returning id")).rows[0].id;
  await admin.query("insert into aura.users (cabinet_id, name, email, password_hash, role, status) values ($1,'Ama','ama@cabseal.test',$2,'owner','active')", [cabinetId, hash(PASS)]);
  await admin.query("alter role aura_app login password 'pw'");
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { PATH: process.env.PATH, PORT: String(APPPORT), DATABASE_URL: DB.replace('//postgres:pw@', '//aura_app:pw@'), PG_NO_SSL: '1', SESSION_SECRET: 'secret-de-test', NODE_ENV: 'test' }, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/health')).ok; } catch (_) {} if (!up) await sleep(250); }
  assert.ok(up, 'le serveur ne démarre pas');
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ama@cabseal.test', password: PASS }) });
  assert.strictEqual(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { if (srv) srv.kill(); if (admin) await admin.end(); await pg.stop(); });

test('scellement v2 : historique et alertes dans le manifeste, intégrité vérifiée, journal qui grandit sans fausse alerte', async () => {
  await nouveauDossier('d_v2', [['piece-identite', 'Pièce d\'identité', 'Kofi Mensah'], ['rib', 'RIB', 'Agbeko Yawo']]);
  await journal('d_v2', 'creation', { kind: 'systeme', name: null });
  await journal('d_v2', 'depot', { key: 'rib', label: 'RIB', kind: 'client', name: null });
  await journal('d_v2', 'validation', { key: 'rib', label: 'RIB', reason: 'Conforme' });
  await journal('d_v2', 'relation_message', { reason: 'ne doit pas figurer' });

  const sealed = await call('POST', '/api/dossiers/d_v2/seal');
  assert.strictEqual(sealed.status, 200, await sealed.clone().text());
  const { hash: h } = await sealed.json();

  const { rows } = await admin.query("select seal_hash, seal_manifest from aura.dossiers where id = 'd_v2'");
  const m = rows[0].seal_manifest;
  assert.strictEqual(rows[0].seal_hash, h);
  assert.strictEqual(m.version, 2);
  assert.deepStrictEqual(m.decisions.map((d) => d.action), ['creation', 'depot', 'validation']);
  assert.ok(!JSON.stringify(m).includes('ne doit pas figurer'));
  assert.ok(!JSON.stringify(m).includes('@'), 'aucune adresse e-mail dans le manifeste');
  assert.ok(m.controles.some((c) => c.code === 'nom_different' && c.niveau === 'alerte'), 'l\'alerte de nom est figée dans le certificat');
  assert.strictEqual(seal.hashManifest(m), h);

  const i1 = await (await call('GET', '/api/dossiers/d_v2/integrity')).json();
  assert.strictEqual(i1.ok, true); assert.strictEqual(i1.manifestIntact, true);

  // Le journal grandit après le scellement (le scellement lui-même, un rappel…) : aucune fausse altération.
  await journal('d_v2', 'validation', { key: 'rib', label: 'RIB', reason: 'Ajouté après le scellement' });
  const i2 = await (await call('GET', '/api/dossiers/d_v2/integrity')).json();
  assert.strictEqual(i2.ok, true, 'le journal qui grandit ne casse pas l\'intégrité');

  const cert = await call('GET', '/api/dossiers/d_v2/certificate');
  assert.strictEqual(cert.status, 200);
  assert.match(cert.headers.get('content-type'), /pdf/);
  const t = (await pdfParse(Buffer.from(await cert.arrayBuffer()))).text;
  assert.match(t, /HISTORIQUE DES D/);
  assert.match(t, /Conforme/);
  assert.doesNotMatch(t, /Ajouté après le scellement/, 'l\'instantané est celui du scellement');
  assert.match(t, /Agbeko Yawo/);
});

test('altérer l\'historique scellé est détecté', async () => {
  const { rows } = await admin.query("select seal_manifest from aura.dossiers where id = 'd_v2'");
  const m = rows[0].seal_manifest;
  m.decisions[2].motif = 'Réécrit après coup';
  await admin.query("update aura.dossiers set seal_manifest = $1 where id = 'd_v2'", [JSON.stringify(m)]);
  const i = await (await call('GET', '/api/dossiers/d_v2/integrity')).json();
  assert.strictEqual(i.manifestIntact, false, 'le manifeste archivé ne redonne plus l\'empreinte');
});

test('dossier scellé en version 1 : toujours valide, certificat produit avec la mention', async () => {
  await nouveauDossier('d_v1', [['piece-identite', 'Pièce d\'identité', 'Kofi Mensah']]);
  const sealed = await call('POST', '/api/dossiers/d_v1/seal');
  assert.strictEqual(sealed.status, 200, await sealed.clone().text());

  /* Simule un dossier scellé avant cette version : on retire les champs v2 du
     manifeste réel et on recalcule l'empreinte exactement comme le faisait l'ancien code. */
  const { rows } = await admin.query("select seal_manifest from aura.dossiers where id = 'd_v1'");
  const m = rows[0].seal_manifest;
  m.version = 1;
  delete m.decisions; delete m.decisionsTotal; delete m.controles;
  const h = seal.hashManifest(m);
  await admin.query("update aura.dossiers set seal_hash = $1, seal_manifest = $2 where id = 'd_v1'", [h, JSON.stringify(m)]);

  const i = await (await call('GET', '/api/dossiers/d_v1/integrity')).json();
  assert.strictEqual(i.ok, true, 'un ancien dossier reste vérifiable');
  assert.strictEqual(i.manifestIntact, true);

  const cert = await call('GET', '/api/dossiers/d_v1/certificate');
  assert.strictEqual(cert.status, 200);
  assert.match((await pdfParse(Buffer.from(await cert.arrayBuffer()))).text, /avant l'ajout de cette section/);
});
