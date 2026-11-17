'use strict';
/* Identité du cabinet, de bout en bout : vrai serveur, vraie base, deux cabinets.
   Vérifie les droits, l'isolation entre cabinets et ce que voit le client. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const { migrate } = require('../server/migrate');

const PGPORT = 54332, APPPORT = 38792;
const DB = `postgres://postgres:pw@localhost:${PGPORT}/aura_brand`;
const BASE = `http://127.0.0.1:${APPPORT}`;
const PASS = 'Mot-de-passe-test-42';
let pg, srv, ids = {};
const TOK = { A: 'tokbrandA' + 'x'.repeat(13), B: 'tokbrandB' + 'x'.repeat(13) };

const hash = (p) => { const s = crypto.randomBytes(8).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(p, s, 64).toString('hex'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function login(email) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
  assert.strictEqual(r.status, 200, 'connexion ' + email);
  return r.headers.get('set-cookie').split(';')[0];
}
const call = (cookie, method, url, body) => fetch(BASE + url, {
  method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const upload = (cookie, buf, type = 'image/png', name = 'logo.png') => {
  const fd = new FormData(); fd.append('logo', new Blob([buf], { type }), name);
  return fetch(BASE + '/api/cabinet/logo', { method: 'POST', headers: { cookie: cookie || '' }, body: fd });
};
const portal = async (t) => (await fetch(BASE + '/api/portal/' + t)).json();
const page = async (t) => (await fetch(BASE + '/p/' + t)).text();
const png = (w, h, c = '#cc2233') => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-brand-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PGPORT, persistent: false,
    initdbFlags: ['--lc-messages=C', '--locale=C', '--encoding=UTF8'], onLog: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('aura_brand');
  await migrate(DB, { ssl: false });

  const c = new Client({ connectionString: DB }); await c.connect();
  const cab = async (n) => (await c.query('insert into aura.cabinets (name, slug, email, plan_status, trial_ends_at) values ($1,$2,$3,$4, now() + interval \'10 days\') returning id', [n, n.toLowerCase(), n.toLowerCase() + '@cab.test', 'trialing'])).rows[0].id;
  ids.A = await cab('CabA'); ids.B = await cab('CabB');
  const usr = async (cabinet, email, role) => (await c.query("insert into aura.users (cabinet_id, name, email, password_hash, role, status) values ($1,$2,$2,$3,$4,'active') returning id", [cabinet, email, hash(PASS), role])).rows[0].id;
  await usr(ids.A, 'owner-a@cab.test', 'owner');
  await usr(ids.A, 'member-a@cab.test', 'member');
  await usr(ids.B, 'owner-b@cab.test', 'owner');
  for (const [k, cabinet] of [['A', ids.A], ['B', ids.B]]) {
    const id = 'd_' + k;
    await c.query("insert into aura.dossiers (id, token, client, email, template, cabinet_id) values ($1,$2,'Client','client@exemple.test','bilan',$3)", [id, TOK[k], cabinet]);
    await c.query("insert into aura.pieces (dossier_id, key, label, rule, position) values ($1,'avis-imposition','Avis','moins de 12 mois',0)", [id]);
  }
  await c.end();

  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { PATH: process.env.PATH, PORT: String(APPPORT), DATABASE_URL: DB, PG_NO_SSL: '1', SESSION_SECRET: 'secret-de-test', NODE_ENV: 'test' },
    stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch (_) {} await sleep(250); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { if (srv) srv.kill(); await pg.stop(); });

test('sans identité saisie : le portail reste neutre, aperçu sans image', async () => {
  const j = await portal(TOK.A);
  assert.deepStrictEqual(j.brand, { name: 'CabA', welcome: '', phone: '', phoneDisplay: '', accent: { hex: '#1264A3', hex2: '#3A8FD6' }, logo: null });
  const html = await page(TOK.A);
  assert.ok(html.includes('property="og:title" content="Vos documents à déposer — CabA"'));
  assert.ok(!html.includes('og:image'));
  assert.strictEqual((await fetch(`${BASE}/api/portal/${TOK.A}/logo`)).status, 404);
});

test('lien inconnu : page neutre, aucune information de cabinet', async () => {
  const html = await page('jetoninconnu');
  assert.strictEqual((await fetch(BASE + '/p/jetoninconnu')).status, 200);
  assert.ok(!html.includes('og:title') && !html.includes('CabA') && !html.includes('CabB'));
  assert.ok(html.includes('Déposer mes pièces'));
});

test('sans connexion ou sans être propriétaire : modification refusée', async () => {
  assert.strictEqual((await call('', 'GET', '/api/cabinet/profile')).status, 401);
  assert.strictEqual((await call('', 'POST', '/api/cabinet/profile', { accent: 'vert' })).status, 401);
  assert.strictEqual((await upload('', await png(200, 200))).status, 401);
  assert.strictEqual((await call('', 'DELETE', '/api/cabinet/logo')).status, 401);
  const member = await login('member-a@cab.test');
  const g = await call(member, 'GET', '/api/cabinet/profile');
  assert.strictEqual(g.status, 200);
  assert.strictEqual((await g.json()).owner, false);
  assert.strictEqual((await call(member, 'POST', '/api/cabinet/profile', { welcome: 'x', phone: '', accent: 'vert' })).status, 403);
  assert.strictEqual((await upload(member, await png(200, 200))).status, 403);
  assert.strictEqual((await call(member, 'DELETE', '/api/cabinet/logo')).status, 403);
  assert.strictEqual((await portal(TOK.A)).brand.welcome, '', 'rien n\'a changé');
});

test('entrées invalides refusées, rien d\'enregistré', async () => {
  const a = await login('owner-a@cab.test');
  for (const body of [
    { welcome: '', phone: '90123456', accent: 'bleu' },
    { welcome: 'x'.repeat(501), phone: '', accent: 'bleu' },
    { welcome: '', phone: '', accent: 'red;}body{display:none' },
    { welcome: '', phone: '', accent: '#ff0000' },
    {}
  ]) assert.strictEqual((await call(a, 'POST', '/api/cabinet/profile', body)).status, 400, JSON.stringify(body).slice(0, 60));
  assert.strictEqual((await portal(TOK.A)).brand.accent.hex, '#1264A3');
});

test('enregistrement : visible côté client, texte échappé dans l\'aperçu', async () => {
  const a = await login('owner-a@cab.test');
  const piege = 'Bonjour !\n\n<script>alert(1)</script> "><img src=x onerror=alert(2)>';
  const r = await call(a, 'POST', '/api/cabinet/profile', { welcome: piege, phone: '+228 90 12 34 56', accent: 'vert' });
  assert.strictEqual(r.status, 200);
  const j = await portal(TOK.A);
  assert.strictEqual(j.brand.welcome, piege.trim());
  assert.strictEqual(j.brand.phone, '+22890123456');
  assert.strictEqual(j.brand.phoneDisplay, '+228 90 12 34 56');
  assert.strictEqual(j.brand.accent.hex, '#087A4E');
  const html = await page(TOK.A);
  assert.ok(!html.includes('<script>alert(1)'), 'le HTML saisi ne doit jamais ressortir tel quel');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('content="Bonjour !"'), 'description = première ligne');
  assert.ok(html.includes('name="theme-color" content="#087A4E"'));
  assert.strictEqual((html.match(/name="theme-color"/g) || []).length, 1, 'une seule couleur de thème');
  assert.strictEqual((html.match(/<title>/g) || []).length, 1, 'un seul titre');
});

test('un cabinet ne touche pas à l\'identité d\'un autre', async () => {
  const jb = await portal(TOK.B);
  assert.strictEqual(jb.brand.welcome, '');
  assert.strictEqual(jb.brand.accent.hex, '#1264A3');
  const b = await login('owner-b@cab.test');
  assert.strictEqual((await call(b, 'POST', '/api/cabinet/profile', { welcome: 'Bienvenue chez B', phone: '', accent: 'rouge' })).status, 200);
  assert.strictEqual((await portal(TOK.B)).brand.welcome, 'Bienvenue chez B');
  assert.strictEqual((await portal(TOK.A)).brand.welcome.startsWith('Bonjour !'), true, 'A inchangé');
  const gb = await (await call(b, 'GET', '/api/cabinet/profile')).json();
  assert.strictEqual(gb.name, 'CabB');
  assert.ok(!JSON.stringify(gb).includes('Bonjour !'));
});

test('logo : téléversé, redimensionné, servi par le lien du bon cabinet seulement', async () => {
  const a = await login('owner-a@cab.test');
  const r = await upload(a, await png(1600, 800));
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.hasLogo, true);
  assert.match(body.logoUrl, /^\/api\/cabinet\/logo\?v=\d+$/);

  const j = await portal(TOK.A);
  assert.match(j.brand.logo, new RegExp(`^/api/portal/${TOK.A}/logo\\?v=\\d+$`));
  const img = await fetch(BASE + j.brand.logo);
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');
  assert.strictEqual(img.headers.get('x-content-type-options'), 'nosniff');
  const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
  assert.ok(meta.width <= 360, 'largeur ' + meta.width);

  // Le cabinet B n'a pas de logo : son lien n'en sert aucun, et celui de A reste lisible par A.
  assert.strictEqual((await fetch(`${BASE}/api/portal/${TOK.B}/logo`)).status, 404);
  assert.strictEqual((await portal(TOK.B)).brand.logo, null);
  assert.strictEqual((await fetch(`${BASE}/api/portal/jetoninconnu/logo`)).status, 404);
  assert.strictEqual((await call('', 'GET', '/api/cabinet/logo')).status, 401);
  assert.strictEqual((await call(a, 'GET', '/api/cabinet/logo')).status, 200);
  const b = await login('owner-b@cab.test');
  assert.strictEqual((await call(b, 'GET', '/api/cabinet/logo')).status, 404, 'B ne voit pas le logo de A');

  const html = await page(TOK.A);
  assert.ok(html.includes(`property="og:image" content="http://127.0.0.1:${APPPORT}/api/portal/${TOK.A}/logo?v=`), 'aperçu avec logo, adresse absolue');
});

test('logo : formats dangereux, fichier déguisé ou trop lourd refusés', async () => {
  const a = await login('owner-a@cab.test');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.strictEqual((await upload(a, svg, 'image/png', 'logo.png')).status, 400, 'SVG déguisé en PNG');
  assert.strictEqual((await upload(a, svg, 'image/svg+xml', 'logo.svg')).status, 400);
  assert.strictEqual((await upload(a, Buffer.from('<html>x</html>'), 'text/html', 'x.html')).status, 400);
  assert.strictEqual((await upload(a, Buffer.concat([await png(300, 300), Buffer.alloc(3 * 1024 * 1024)]))).status, 413);
  assert.strictEqual((await fetch(BASE + '/api/cabinet/logo', { method: 'POST', headers: { cookie: a }, body: new FormData() })).status, 400);
  // Le logo précédent est intact après ces échecs.
  assert.strictEqual((await fetch(BASE + (await portal(TOK.A)).brand.logo)).status, 200);
});

test('logo : changer l\'image change l\'adresse (cache), retirer le supprime', async () => {
  const a = await login('owner-a@cab.test');
  const v1 = (await portal(TOK.A)).brand.logo;
  assert.strictEqual((await upload(a, await png(400, 400, '#2233cc'))).status, 200);
  const v2 = (await portal(TOK.A)).brand.logo;
  assert.notStrictEqual(v1, v2);
  assert.strictEqual((await call(a, 'DELETE', '/api/cabinet/logo')).status, 200);
  assert.strictEqual((await portal(TOK.A)).brand.logo, null);
  assert.strictEqual((await fetch(`${BASE}/api/portal/${TOK.A}/logo`)).status, 404);
  assert.ok(!(await page(TOK.A)).includes('og:image'));
  // Le texte, lui, n'a pas bougé.
  assert.strictEqual((await portal(TOK.A)).brand.accent.hex, '#087A4E');
});

test('le lien client ne révèle toujours rien de plus', async () => {
  const txt = JSON.stringify(await portal(TOK.A)) + await page(TOK.A);
  for (const secret of ['client@exemple.test', '@cab.test', ids.A, ids.B, 'scrypt$', 'seal_hash']) assert.ok(!txt.includes(secret), 'fuite : ' + secret);
  assert.ok(!txt.includes('CabB'), 'rien d\'un autre cabinet');
});

test('chaque modification est tracée au journal, du bon cabinet', async () => {
  const c = new Client({ connectionString: DB }); await c.connect();
  const { rows } = await c.query("select cabinet_id, reason from aura.decision_log where action = 'identite' order by id");
  await c.end();
  assert.ok(rows.length >= 5, 'lignes : ' + rows.length);
  assert.ok(rows.some(r => r.cabinet_id === ids.A && /Logo du cabinet remplacé/.test(r.reason)));
  assert.ok(rows.some(r => r.cabinet_id === ids.A && /Logo du cabinet retiré/.test(r.reason)));
  assert.strictEqual(rows.filter(r => r.cabinet_id === ids.B).length, 1);
});
