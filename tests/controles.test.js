'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { controles, score, aRelancer, nomsCompatibles } = require('../server/lib/controles');

const NOW = new Date('2026-11-18T10:00:00Z');
const piece = (key, o) => Object.assign({ key, label: key, status: 'ok', champs: null, empreinte: '', confidence: 0.9 }, o);

test('noms : ordre libre, titres et accents ignorés, prénom facultatif', () => {
  assert.ok(nomsCompatibles('KOFI Mensah', 'Mensah Kofi Yao'));
  assert.ok(nomsCompatibles('Mme Akouvi Dédé', 'DEDE Akouvi'));
  assert.ok(!nomsCompatibles('Mensah Kofi', 'Agbeko Yao'));
  assert.ok(nomsCompatibles('', 'Quelqu\'un'), 'rien de lisible : pas d\'alerte');
});

test('contrôles : nom différent entre identité et domicile', () => {
  const r = controles([
    piece('piece-identite', { champs: { titulaire: 'Kofi Mensah' } }),
    piece('justif-domicile', { champs: { titulaire: 'Yao Agbeko' } })
  ], NOW);
  assert.strictEqual(r.filter((x) => x.code === 'nom_different').length, 1);
});

test('contrôles : mêmes noms = aucune alerte ; pièces de garant ignorées', () => {
  const r = controles([
    piece('piece-identite', { champs: { titulaire: 'Kofi Mensah' } }),
    piece('rib', { champs: { titulaire: 'MENSAH KOFI' } }),
    piece('garant-identite', { champs: { titulaire: 'Autre Personne' } })
  ], NOW);
  assert.strictEqual(r.length, 0);
});

test('contrôles : pièce expirée et pièce qui expire bientôt', () => {
  const r = controles([
    piece('piece-identite', { champs: { dateExpiration: '2026-10-01' } }),
    piece('rccm', { champs: { dateExpiration: '2026-12-05' } }),
    piece('statuts', { champs: { dateExpiration: '2030-01-01' } })
  ], NOW);
  assert.deepStrictEqual(r.map((x) => x.code).sort(), ['expire_bientot', 'expiree']);
});

test('contrôles : même fichier pour deux pièces', () => {
  const r = controles([piece('rib', { empreinte: 'abc' }), piece('piece-identite', { empreinte: 'abc' }), piece('statuts', { empreinte: 'zzz' })], NOW);
  assert.strictEqual(r.filter((x) => x.code === 'doublon').length, 1);
});

test('contrôles : les pièces non déposées ou refusées ne déclenchent rien', () => {
  const r = controles([piece('piece-identite', { status: 'wait', champs: { dateExpiration: '2020-01-01' } }), piece('rib', { status: 'ko', empreinte: 'a' }), piece('statuts', { status: 'ko', empreinte: 'a' })], NOW);
  assert.strictEqual(r.length, 0);
});

test('score : prêt seulement si tout est accepté sans alerte', () => {
  const ok = [piece('a'), piece('b')];
  assert.strictEqual(score(ok, []).pret, true);
  assert.strictEqual(score(ok, [{ niveau: 'alerte' }]).pret, false);
  assert.strictEqual(score(ok, [{ niveau: 'info' }]).pret, true);
  const mix = score([piece('a'), piece('b', { status: 'review' }), piece('c', { status: 'wait' }), piece('d', { status: 'ko' })], []);
  assert.strictEqual(mix.pct, 38);
  assert.strictEqual(mix.pret, false);
  assert.strictEqual(score([], []).pret, false);
});

test('relances : dossiers silencieux avec pièces manquantes, scellés exclus', () => {
  const d = (id, jours, statuts, sealed) => ({
    id, client: id, lastActivity: new Date(NOW - jours * 864e5).toISOString(), sealed: sealed || null,
    pieces: statuts.map((s, i) => ({ key: 'k' + i, status: s }))
  });
  const r = aRelancer([d('A', 5, ['ok', 'wait']), d('B', 1, ['wait']), d('C', 9, ['ok', 'ok']), d('D', 8, ['wait'], { hash: 'x' }), d('E', 12, ['ko'])], NOW, 3);
  assert.deepStrictEqual(r.map((x) => x.id), ['E', 'A']);
});

test('extraction : champs nettoyés, dates mal formées ignorées, vide = null', () => {
  const { extraireChamps } = require('../server/lib/ai');
  assert.deepStrictEqual(extraireChamps({ champs: { titulaire: '  Kofi   Mensah ', numero: 'TG123', date_expiration: '2029-03-01', emetteur: null } }),
    { titulaire: 'Kofi Mensah', numero: 'TG123', dateExpiration: '2029-03-01', emetteur: '' });
  assert.strictEqual(extraireChamps({ champs: { date_expiration: '01/03/2029' } }), null);
  assert.strictEqual(extraireChamps({}), null);
  assert.strictEqual(extraireChamps({ champs: { titulaire: 'x'.repeat(500) } }).titulaire.length, 120);
});
