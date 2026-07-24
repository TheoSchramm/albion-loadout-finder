// The Python suite (backend/tests/test_core.py), ported 1:1, plus guards for hazards
// that only exist because this is now JavaScript running in a browser.
//
// Test names mirror the Python ones so the two files can be diffed side by side.

import test from 'node:test';
import assert from 'node:assert/strict';

import { setCatalog, findDefinition, getCatalog } from '../src/lib/catalog.js';
import { parseUniqueName, requestedVariantHint } from '../src/lib/text.js';
import { buildVariant, equivalentVariants, serializeVariant } from '../src/lib/items.js';
import { searchItems } from '../src/lib/search.js';
import { fetchPrices } from '../src/lib/prices.js';
import { optimizeLoadoutWithCities } from '../src/lib/optimizer.js';
import { getConfig, getItem } from '../src/lib/api.js';
import { catalogData } from './helpers.mjs';

setCatalog(catalogData());

/** Deterministic stand-in for live market data, mirroring the Python test stub. */
function stubPrices({ price = 12345, quality = 2, updatedAt = '2026-01-01T00:00:00' } = {}) {
  return {
    now: () => 1753000000000,
    fetchImpl: async (url) => {
      const items = decodeURIComponent(url.split('/prices/')[1].split('.json')[0]).split(',');
      const city = decodeURIComponent(url.split('locations=')[1].split('&')[0]).split(',')[0];
      return {
        ok: true,
        json: async () =>
          items.map((item) => ({
            item_id: item,
            city,
            quality,
            sell_price_min: price,
            buy_price_max: 0,
            sell_price_min_date: updatedAt,
          })),
      };
    },
  };
}

const EMPTY_PRICES = { now: () => 0, fetchImpl: async () => ({ ok: true, json: async () => [] }) };

// ---------------------------------------------------------------- ported CoreTests

test('parse unique name', () => {
  assert.deepEqual(parseUniqueName('T6_MAIN_SWORD@2'), {
    tier: 6,
    template: 'MAIN_SWORD',
    enchantment: 2,
  });
});

test('search items by language', () => {
  const results = searchItems('Espada', 'es', 'main_hand');
  assert.ok(results.length > 0);
  assert.equal(results[0].slot, 'main_hand');
});

test('optimize loadout returns total cost', async () => {
  const result = await optimizeLoadoutWithCities({
    loadout: [{ slot: 'main_hand', unique_name: 'T6_MAIN_SWORD@0' }],
    fetchOptions: stubPrices(),
  });
  assert.ok(result.total_cost > 0);
  assert.ok(result.slots.length > 0);
});

test('optimize loadout includes price timestamp', async () => {
  const result = await optimizeLoadoutWithCities({
    loadout: [{ slot: 'main_hand', unique_name: 'T6_MAIN_SWORD@0' }],
    fetchOptions: stubPrices(),
  });
  assert.equal(result.slots[0].best.updated_at, '2026-01-01T00:00:00');
});

test('optimize loadout considers all qualities', async () => {
  const result = await optimizeLoadoutWithCities({
    loadout: [{ slot: 'main_hand', unique_name: 'T6_MAIN_SWORD@0' }],
    fetchOptions: stubPrices({ quality: 2 }),
  });
  assert.equal(result.slots[0].best.cheapest_quality, 2);
  assert.equal(result.slots[0].best.cheapest_quality_label, 'Good');
});

test('optimize loadout includes price query url', async () => {
  const result = await optimizeLoadoutWithCities({
    loadout: [{ slot: 'main_hand', unique_name: 'T6_MAIN_SWORD@0' }],
    region: 'americas',
    fetchOptions: stubPrices(),
  });
  const best = result.slots[0].best;
  assert.ok(best.api_url.startsWith('https://west.albion-online-data.com/api/v2/stats/prices/'));
  assert.ok(decodeURIComponent(best.api_url).includes(best.unique_name));
});

test('optimize loadout returns every slot', async () => {
  const result = await optimizeLoadoutWithCities({
    loadout: [
      { slot: 'main_hand', unique_name: 'T6_MAIN_SWORD@0' },
      { slot: 'head', unique_name: 'T6_HEAD_PLATE_SET1@0' },
      { slot: 'chest', unique_name: 'T6_ARMOR_PLATE_SET1@0' },
    ],
    fetchOptions: stubPrices(),
  });
  assert.deepEqual(
    new Set(result.slots.map((slot) => slot.selected.slot)),
    new Set(['main_hand', 'head', 'chest']),
  );
});

test('optimize loadout omits slots with no real market data', async () => {
  // Never fabricate a price: a slot with zero listings anywhere is left out entirely
  // rather than filled in with a made-up number.
  const result = await optimizeLoadoutWithCities({
    loadout: [{ slot: 'main_hand', unique_name: 'T6_MAIN_SWORD@0' }],
    fetchOptions: EMPTY_PRICES,
  });
  assert.deepEqual(result.slots, []);
  assert.equal(result.total_cost, 0);
});

test('config has regions and slots', () => {
  const config = getConfig();
  assert.ok(config.regions);
  assert.equal(config.slots.length, 10);
});

test('search excludes non-equipable items', () => {
  const uniqueNames = getCatalog().entries.map((entry) => entry.unique_name);
  assert.ok(!uniqueNames.some((name) => name.includes('ARTEFACT')));
});

test('search excludes gathering tools', () => {
  const templates = new Set(getCatalog().entries.map((entry) => entry.template));
  assert.ok(![...templates].some((template) => template.startsWith('2H_TOOL_')));
  assert.deepEqual(searchItems('pickaxe', 'en', 'main_hand'), []);
});

test('search display name has no tier title', () => {
  const results = searchItems('sword', 'en', 'main_hand');
  assert.ok(results.length > 0);
  for (const result of results) {
    assert.ok(!result.display_name.includes("'s "), `${result.display_name} kept its rank title`);
  }
});

test('search does not duplicate hardcoded catalog against real data', () => {
  // T4_HEAD_LEATHER is a synthetic name from the offline fallback catalog; the real item
  // is T4_HEAD_LEATHER_SET2. Both must not appear side by side.
  const uniqueNames = searchItems('hunter hood', 'en', 'head').map((item) => item.unique_name);
  assert.ok(!uniqueNames.includes('T4_HEAD_LEATHER'));
});

test('market search alias includes full prefix and tier', () => {
  // The in-game market needs the exact full name including the rank title that
  // display_name deliberately strips for grouping.
  const variant = buildVariant(findDefinition('SHOES_LEATHER_SET2'), 4, 2);
  assert.equal(serializeVariant(variant, 'en').market_search_alias, "Adept's Hunter Shoes 4.2");
});

test('market search alias has no fake prefix for food', () => {
  const variant = buildVariant(findDefinition('MEAL_STEW'), 8, 0);
  assert.equal(serializeVariant(variant, 'en').market_search_alias, 'Beef Stew 8.0');
});

test('equivalent variants never enchant below tier 4', () => {
  const definition = findDefinition('CAPE');
  assert.ok(definition.min_tier < 4);
  const candidates = equivalentVariants(buildVariant(definition, 6, 0));
  assert.ok(!candidates.some((candidate) => candidate.tier < 4 && candidate.enchantment !== 0));
});

test('external tier range wins over hardcoded catalog', () => {
  // MAIN_SWORD is hardcoded with min_tier=4, but real swords go down to T1.
  assert.equal(findDefinition('MAIN_SWORD').min_tier, 1);
});

test('equivalent variants respects per-tier item identity', () => {
  // MEAL_STEW is one template, but T4/T6/T8 are three different dishes - picking Beef
  // Stew must never surface Goat Stew as an "equivalent".
  const candidates = equivalentVariants(buildVariant(findDefinition('MEAL_STEW'), 8, 0));
  assert.deepEqual(
    candidates.map((candidate) => candidate.unique_name),
    ['T8_MEAL_STEW'],
  );
});

test('serialize variant uses correct per-tier name', () => {
  const variant = buildVariant(findDefinition('MEAL_STEW'), 8, 0);
  assert.equal(serializeVariant(variant, 'en').display_name, 'Beef Stew');
});

// ------------------------------------------------- guards specific to the JS port

const ITEM_KEYS = [
  'display_name',
  'enchantment',
  'english_name',
  'equivalent_level',
  'group',
  'image_url',
  'market_search_alias',
  'quality',
  'slot',
  'slot_label',
  'template',
  'tier',
  'two_handed',
  'unique_name',
];

test('getItem returns exactly the 14 documented keys', () => {
  // app.js merges this over live results with Object.assign when the language changes.
  // An extra key such as `updated_at` or `cheapest_price` would overwrite real market
  // data with undefined, blanking prices that were correct a moment earlier.
  const payload = getItem('T4_MAIN_SWORD', { lang: 'en' });
  assert.deepEqual(Object.keys(payload).sort(), ITEM_KEYS);
});

test('getItem resolves external-catalog items, not just the hardcoded ones', () => {
  // The Flask version looked items up in the 24-item hardcoded catalog, so it 404'd for
  // nearly every real item and silently broke language switching.
  const payload = getItem('T4_HEAD_LEATHER_SET2', { lang: 'es' });
  assert.ok(payload);
  assert.notEqual(payload.display_name, getItem('T4_HEAD_LEATHER_SET2', { lang: 'en' }).display_name);
  assert.equal(getItem('T4_NOT_A_TEMPLATE'), null);
});

test('tier hint respects Python word-boundary semantics for non-Latin text', () => {
  // JS \b is ASCII-only, so a literal port would find a tier hint here where Python
  // finds none, silently selecting a different variant.
  assert.deepEqual(requestedVariantHint('меч4.2'), { tier: null, enchantment: null });
  assert.deepEqual(requestedVariantHint('Épée4.2'), { tier: null, enchantment: null });
  assert.deepEqual(requestedVariantHint('sword 4.2'), { tier: 4, enchantment: 2 });
});

test('cheapest city ties keep the first city, not the last', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      { item_id: 'T4_CAPE', city: 'Caerleon', quality: 1, sell_price_min: 500, buy_price_max: 0, sell_price_min_date: '2026-01-01T00:00:00' },
      { item_id: 'T4_CAPE', city: 'Martlock', quality: 1, sell_price_min: 500, buy_price_max: 0, sell_price_min_date: '2026-01-01T00:00:00' },
    ],
  });
  const result = await optimizeLoadoutWithCities({
    loadout: [{ slot: 'cape', unique_name: 'T4_CAPE' }],
    cities: ['Caerleon', 'Martlock'],
    fetchOptions: { fetchImpl, now: () => 0 },
  });
  assert.equal(result.slots[0].best.cheapest_city, 'Caerleon');
});

test('a tied price keeps the first row seen, so quality does not flip', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      { item_id: 'T4_CAPE', city: 'Caerleon', quality: 3, sell_price_min: 700, buy_price_max: 0, sell_price_min_date: '2026-01-01T00:00:00' },
      { item_id: 'T4_CAPE', city: 'Caerleon', quality: 5, sell_price_min: 700, buy_price_max: 0, sell_price_min_date: '2026-01-01T00:00:00' },
    ],
  });
  const prices = await fetchPrices(['T4_CAPE'], 'americas', ['Caerleon'], {
    fetchImpl,
    now: () => 0,
  });
  assert.equal(prices.get('T4_CAPE').Caerleon.quality, 3);
});

test('zero prices are treated as no listing, never as free', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      { item_id: 'T4_CAPE', city: 'Caerleon', quality: 1, sell_price_min: 0, buy_price_max: 0, sell_price_min_date: '2026-01-01T00:00:00' },
    ],
  });
  const prices = await fetchPrices(['T4_CAPE'], 'americas', ['Caerleon'], {
    fetchImpl,
    now: () => 0,
  });
  assert.deepEqual(prices.get('T4_CAPE'), {});
});

test('price requests send no headers, avoiding a CORS preflight per batch', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => [] };
  };
  await fetchPrices(['T4_CAPE'], 'americas', ['Caerleon'], { fetchImpl, now: () => 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options, undefined, 'no request init - a Content-Type forces a preflight');
});

test('optimize hands out detached objects, so best does not alias a candidate', async () => {
  // Over HTTP, `best` and its twin in `candidates` arrived as two separate objects. In
  // process they are one, and app.js writes to both when the language changes. Note that
  // structuredClone would NOT fix this - it preserves internal aliasing by design.
  const { optimize } = await import('../src/lib/api.js');
  const result = await optimize({
    loadout: [{ slot: 'main_hand', unique_name: 'T6_MAIN_SWORD@0' }],
    cities: ['Caerleon'],
    fetchOptions: stubPrices(),
  });
  const twin = result.slots[0].candidates.find(
    (candidate) => candidate.unique_name === result.slots[0].best.unique_name,
  );
  assert.ok(twin, 'best must also appear among the candidates');
  assert.notEqual(result.slots[0].best, twin, 'best must not be the same object as its candidate');
  assert.deepEqual(result.slots[0].best, twin, '...but must still carry identical values');
});

test('a network failure yields no data rather than a fabricated price', async () => {
  const fetchImpl = async () => {
    throw new TypeError('network down');
  };
  const result = await optimizeLoadoutWithCities({
    loadout: [{ slot: 'cape', unique_name: 'T4_CAPE' }],
    fetchOptions: { fetchImpl, now: () => 0 },
  });
  assert.deepEqual(result.slots, []);
  assert.equal(result.total_cost, 0);
});
