import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFindings, isComplementaryFinding } from './finding-sources.js';

test('splitFindings separa axe-core de la revisión del Agente (visual y UX)', () => {
  const { primary, complementary } = splitFindings([
    { id: 'a', source: 'axe-core' }, { id: 'b', source: 'visual_audit' }, { id: 'c', source: 'ux_review' }, { id: 'd' }
  ]);
  assert.deepEqual(primary.map((f) => f.id), ['a', 'd']);
  assert.deepEqual(complementary.map((f) => f.id), ['b', 'c']);
});

test('isComplementaryFinding tolera valores vacíos', () => {
  assert.equal(isComplementaryFinding(null), false);
  assert.deepEqual(splitFindings(undefined), { primary: [], complementary: [] });
});
