// Drop-in replacement for the Flask endpoints app.js used to call.
//
// Keeping this seam (rather than having app.js call the domain modules directly) means
// the UI changed in exactly five places during the port, and the payload shapes stayed
// pinned to something the golden fixtures can assert against.

import { LANGUAGES, QUALITY_LABELS, REGIONS, SLOTS, SLOT_LABELS } from './constants.js';
import { parseUniqueName } from './text.js';
import { findDefinition } from './catalog.js';
import { buildVariant, serializeVariant } from './items.js';
import { searchItems } from './search.js';
import { optimizeLoadoutWithCities } from './optimizer.js';

/**
 * Results used to arrive as fresh JSON per request, which quietly guaranteed something
 * the in-process version does not: `best` and its matching entry in `candidates` were
 * two separate objects. They are the same object here, and app.js mutates both when the
 * language changes (`Object.assign(candidate, update)`), so a write meant for one would
 * land on the other.
 *
 * This deliberately uses a JSON round-trip rather than structuredClone: structuredClone
 * faithfully preserves internal aliasing, so it would NOT restore the old isolation.
 * Payloads are plain JSON-safe data, so the round-trip is lossless here.
 */
function detach(value) {
  return JSON.parse(JSON.stringify(value));
}

/** GET /api/config */
export function getConfig() {
  return {
    languages: [...LANGUAGES],
    regions: Object.fromEntries(
      Object.entries(REGIONS).map(([key, region]) => [
        key,
        { key, label: region.label, host: region.host, cities: [...region.cities] },
      ]),
    ),
    slots: SLOTS.map((slot) => ({ key: slot, label: SLOT_LABELS[slot] })),
    qualities: [...QUALITY_LABELS].map(([value, label]) => ({ value, label })),
  };
}

/** GET /api/items?query&lang&slot */
export function getItems({ query = '', lang = 'en', slot = null } = {}) {
  return { items: detach(searchItems(query, lang, slot)) };
}

/**
 * GET /api/item/<unique_name>
 *
 * Returns null where the endpoint used to 404. Note this resolves against the merged
 * definition table, not just the small hand-authored catalog - the Flask version looked
 * only at the latter, so it 404'd for nearly every real item and silently broke
 * language switching.
 */
export function getItem(uniqueName, { lang = 'en' } = {}) {
  const parsed = parseUniqueName(uniqueName);
  if (!parsed) return null;
  const definition = findDefinition(parsed.template);
  if (!definition) return null;
  const variant = buildVariant(definition, parsed.tier, parsed.enchantment);
  return serializeVariant(variant, lang);
}

/**
 * POST /api/optimize
 *
 * `fetchOptions` exists only so tests can inject a fake HTTP layer; the app never passes
 * it and gets the real `fetch`.
 */
export async function optimize({
  loadout = [],
  region = 'americas',
  language = 'en',
  cities = [],
  minQuality = 1,
  fetchOptions = {},
}) {
  const result = await optimizeLoadoutWithCities({ loadout, region, language, cities, minQuality, fetchOptions });
  return detach(result);
}
