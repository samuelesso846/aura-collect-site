'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { redact, breaker } = require('../server/lib/observe');

test('les jetons sont masqués dans les journaux', () => {
  assert.strictEqual(redact('/p/abc123?x=1'), '/p/:jeton');
  assert.strictEqual(redact('/api/portal/tok/pieces/a'), '/api/portal/:jeton/pieces/a');
  assert.strictEqual(redact('/api/health'), '/api/health');
});

test('le disjoncteur s\'ouvre après des échecs répétés puis se referme', async () => {
  const b = breaker(2, 40);
  assert.ok(b.allow());
  b.fail(); assert.ok(b.allow());
  b.fail(); assert.ok(!b.allow());
  await new Promise(r => setTimeout(r, 60));
  assert.ok(b.allow());
  b.ok(); assert.strictEqual(b.state().fails, 0);
});
