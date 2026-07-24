// Does the shipped browser catalog reproduce the Python catalog exactly?
//
// This is the foundation the rest of the port stands on: if the entry list drifts in
// content or ORDER, search silently returns a different set of items (results are
// grouped by first appearance and truncated to 24) and nobody notices, because it is
// still 24 plausible-looking items.

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveEntries, setCatalog, findDefinition, resetCatalog } from '../src/lib/catalog.js';
import { catalogData, golden, sha256 } from './helpers.mjs';

const expected = golden('entries.json');
const entries = deriveEntries(catalogData());

test('catalog expands to the same number of entries as Python', () => {
  assert.equal(entries.length, expected.count);
});

test('catalog expands to byte-identical entries (digest over all 7,479)', () => {
  assert.equal(sha256(entries), expected.sha256);
});

test('first and last entries match, pinning order at both ends', () => {
  assert.deepEqual(entries.slice(0, 5), expected.first);
  assert.deepEqual(entries.slice(-5), expected.last);
});

test('sampled entries match at their exact indexes', () => {
  for (const [index, entry] of Object.entries(expected.sample)) {
    assert.deepEqual(entries[Number(index)], entry, `entry #${index} diverged`);
  }
});

test('every entry carries the 8 supported languages and no others', () => {
  const languages = new Set();
  for (const entry of entries) {
    for (const code of Object.keys(entry._localized_names)) {
      languages.add(code);
    }
  }
  assert.deepEqual([...languages].sort(), ['de', 'en', 'es', 'fr', 'ko', 'pt', 'ru', 'zh']);
});

test('gathering tools and non-equipment are excluded', () => {
  assert.equal(
    entries.filter((entry) => entry.template.startsWith('2H_TOOL_')).length,
    0,
    'gathering tools must not appear',
  );
  assert.equal(
    entries.filter((entry) => entry.unique_name.includes('ARTEFACT')).length,
    0,
    'crafting artefacts must not appear',
  );
});

test('readers throw before the catalog is loaded, instead of returning undefined', () => {
  resetCatalog();
  assert.throws(() => findDefinition('MAIN_SWORD'), /catalog not loaded/);
  setCatalog(catalogData());
  assert.ok(findDefinition('MAIN_SWORD'));
});

test('definitions merge external over fallback, keeping fallback-only templates', () => {
  setCatalog(catalogData());
  // External data wins: the hand-authored catalog hardcodes min_tier=4, but real swords
  // go down to T1.
  assert.equal(findDefinition('MAIN_SWORD').min_tier, 1);
  // ...while templates with no external counterpart survive, because presets saved
  // before the external catalog existed still reference them.
  for (const template of ['HEAD_PLATE', 'MAIN_BOW', 'FOOD', 'POTION', 'OFF_TOME']) {
    assert.ok(findDefinition(template), `${template} must remain resolvable`);
  }
});
