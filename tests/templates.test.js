'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TEMPLATES, LIB } = require('../server/lib/templates');
const guide = require('../server/lib/guide');

test('modèles : identifiants uniques, défauts dans le catalogue, clés sans doublon', () => {
  const ids = new Set();
  for (const t of TEMPLATES) {
    assert.ok(!ids.has(t.id), 'id en double ' + t.id);
    ids.add(t.id);
    const keys = t.catalog.map((c) => c.key);
    assert.strictEqual(new Set(keys).size, keys.length, 'clé en double dans ' + t.id);
    for (const d of t.defaults) assert.ok(keys.includes(d), t.id + ' : défaut hors catalogue ' + d);
    assert.ok(t.defaults.length <= 25 && t.catalog.length <= 25, t.id + ' dépasse 25 pièces');
    for (const c of t.catalog) {
      assert.ok(c.label && c.rule && c.group, t.id + ' : pièce incomplète ' + c.key);
      assert.match(c.key, /^[A-Za-z0-9_-]+$/);
    }
  }
});

test('modèles : toute pièce (hors sur-mesure) a un guide écrit', () => {
  for (const t of TEMPLATES) {
    if (t.id === 'surmesure') continue;
    for (const c of t.catalog) assert.ok(guide.keys.includes(c.key), 'guide manquant : ' + c.key);
  }
});

test('modèles : les ids historiques existent toujours', () => {
  for (const id of ['bilan', 'tva', 'creation', 'credit', 'locataire', 'onboarding', 'kyc', 'surmesure']) {
    assert.ok(TEMPLATES.some((t) => t.id === id), id);
  }
  assert.ok(Object.keys(LIB).length > 40);
});

test('modèles : plus de références françaises par défaut', () => {
  for (const t of TEMPLATES) {
    assert.ok(!t.defaults.includes('carte-vitale'));
    assert.ok(!t.defaults.includes('avis-imposition'));
  }
});
