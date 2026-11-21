'use strict';
/* Scellement : manifeste v1 inchangé, manifeste v2 (historique + contrôles),
   certificat PDF sur plusieurs pages. Fonctions pures, sans base ni réseau. */
const test = require('node:test');
const assert = require('node:assert');
const seal = require('../server/lib/seal');
const controles = require('../server/lib/controles');

const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const texteDe = async (buf) => (await pdfParse(buf)).text;
const nbPages = async (buf) => (await pdfParse(buf)).numpages;

const dossier = (n) => ({
  id: 'd_test', client: 'Kofi Mensah', recipient: 'Banque Atlantique', template: 'bilan',
  createdAt: new Date('2026-11-01T09:00:00Z'),
  pieces: Array.from({ length: n }, (_, i) => ({
    key: 'p' + i, label: 'Pièce numéro ' + i, filename: 'p' + i + '.pdf', status: 'valide',
    dateDocument: '', stored: false, at: new Date('2026-11-02T10:00:00Z')
  }))
});

const ligne = (id, action, extra) => Object.assign({
  id, action, created_at: new Date(Date.UTC(2026, 10, 2, 9, id)),
  actor_kind: 'cabinet', actor_name: 'Ama', actor_email: 'ama@cab.test',
  piece_label: 'RIB', reason: 'RAS', provider: null, confidence: null
}, extra || {});

test('manifeste v1 : sans annexe, ni version 2 ni champs ajoutés', async () => {
  const m = await seal.buildManifest(dossier(2), 'Cab', '2026-11-03T10:00:00Z');
  assert.strictEqual(m.version, 1);
  for (const k of ['decisions', 'decisionsTotal', 'controles']) assert.ok(!(k in m), k);
  assert.strictEqual(seal.hashManifest(m), seal.sha256(seal.canonical(m)));
  assert.strictEqual(seal.annexOf(m), null);
});

test('instantané : ne garde que les gestes du dossier, dans l\'ordre, sans courriel du cabinet', () => {
  const rows = [
    ligne(3, 'validation', { reason: '  ok\n tout  bon ' }),
    ligne(1, 'creation', { actor_kind: 'systeme', actor_name: null, actor_email: null, piece_label: null }),
    ligne(2, 'verdict_ia', { actor_kind: 'ia', provider: 'groq', confidence: '0.9137' }),
    ligne(4, 'relation_message'),
    ligne(5, 'scellement')
  ];
  const a = seal.snapshotAnnex(rows, [{ niveau: 'alerte', code: 'doublon', message: 'Même fichier', pieces: ['x'] }, { niveau: 'info', code: 'x', message: 'FYI' }]);
  assert.strictEqual(a.decisionsTotal, 3);
  assert.deepStrictEqual(a.decisions.map((d) => d.action), ['creation', 'verdict_ia', 'validation']);
  assert.strictEqual(a.decisions[0].acteur, 'Système');
  assert.strictEqual(a.decisions[1].acteur, 'IA');
  assert.strictEqual(a.decisions[1].confiance, 0.91);
  assert.strictEqual(a.decisions[2].acteur, 'Cabinet - Ama');
  assert.strictEqual(a.decisions[2].motif, 'ok tout bon');
  assert.ok(!JSON.stringify(a).includes('@cab.test'), 'aucune adresse e-mail dans le manifeste');
  assert.deepStrictEqual(a.controles.map((c) => c.niveau), ['alerte', 'info']);
  assert.ok(a.controles.every((c) => !('pieces' in c)));
});

test('instantané : plafonné, avec le total réel', () => {
  const rows = Array.from({ length: 450 }, (_, i) => ligne(i + 1, 'depot'));
  const a = seal.snapshotAnnex(rows, []);
  assert.strictEqual(a.decisions.length, 400);
  assert.strictEqual(a.decisionsTotal, 450);
});

test('manifeste v2 : l\'instantané entre dans l\'empreinte, et se relit à l\'identique', async () => {
  const annex = seal.snapshotAnnex([ligne(1, 'depot'), ligne(2, 'validation')], []);
  const m = await seal.buildManifest(dossier(2), 'Cab', '2026-11-03T10:00:00Z', annex);
  assert.strictEqual(m.version, 2);
  const hash = seal.hashManifest(m);

  // Le manifeste relu depuis la base (JSON) redonne la même empreinte.
  const relu = JSON.parse(JSON.stringify(m));
  assert.strictEqual(seal.hashManifest(relu), hash);

  // Le journal grandit après le scellement : on relit l'instantané scellé, pas le journal.
  const recalcule = await seal.buildManifest(dossier(2), 'Cab', relu.sealedAt, seal.annexOf(relu));
  assert.strictEqual(seal.hashManifest(recalcule), hash, 'pas de fausse altération');

  // Toucher à l'historique scellé change l'empreinte.
  relu.decisions[0].motif = 'falsifié';
  assert.notStrictEqual(seal.hashManifest(relu), hash);
});

test('certificat v2 : plusieurs pages, historique, contrôles, mentions prudentes', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ligne(i + 1, i % 2 ? 'validation' : 'depot', { piece_label: 'Pièce ' + i, reason: 'Motif détaillé de la décision numéro ' + i }));
  const alertes = controles.controles([
    { key: 'piece-identite', label: 'Pièce d\'identité', status: 'ok', champs: { titulaire: 'Kofi Mensah' } },
    { key: 'rib', label: 'RIB', status: 'ok', champs: { titulaire: 'Agbeko Yawo' } }
  ]);
  assert.ok(alertes.some((a) => a.code === 'nom_different'), 'cas de test : une alerte existe');
  const m = await seal.buildManifest(dossier(40), 'Cabinet Lemaire', '2026-11-03T10:00:00Z', seal.snapshotAnnex(rows, alertes));
  const pdf = await seal.certificatePdf(m, seal.hashManifest(m));

  const pages = await nbPages(pdf);
  assert.ok(pages >= 3, 'pagination : ' + pages + ' pages');
  const t = await texteDe(pdf);
  assert.match(t, /Page 1 \/ \d+/);
  assert.match(t, new RegExp('Page ' + pages + ' / ' + pages));
  assert.match(t, /HISTORIQUE DES D/);
  assert.match(t, /CONTR.LES AUTOMATIQUES/);
  assert.match(t, /ALERTE/);
  assert.match(t, /Agbeko Yawo/);
  assert.match(t, /ne constitue ni une signature/);
  assert.match(t, /02\/11\/2026 09:0\d UTC/);
  assert.match(t, /Pièce numéro 39/, 'la dernière pièce n\'est plus coupée');
  assert.ok(!/garantie|anti-amende|bouclier/i.test(t), 'aucune promesse de garantie');
});

test('certificat v1 : toujours produit, avec la mention « scellé avant l\'ajout »', async () => {
  const m = await seal.buildManifest(dossier(3), 'Cab', '2026-11-03T10:00:00Z');
  const pdf = await seal.certificatePdf(m, seal.hashManifest(m));
  const t = await texteDe(pdf);
  assert.match(t, /scell. avant l'ajout de cette section/);
  assert.ok(!/ALERTE/.test(t));
  assert.strictEqual(await nbPages(pdf), 1);
});

test('certificat v2 sans incident : le dit clairement', async () => {
  const m = await seal.buildManifest(dossier(2), 'Cab', '2026-11-03T10:00:00Z', seal.snapshotAnnex([], []));
  const t = await texteDe(await seal.certificatePdf(m, seal.hashManifest(m)));
  assert.match(t, /Aucun .v.nement enregistr/);
  assert.match(t, /Aucune incoh.rence d.tect.e/);
});
