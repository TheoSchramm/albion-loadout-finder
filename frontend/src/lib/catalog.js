// Item catalog: loading, and the derived lookup tables the rest of the app reads.
//
// In the Python original these tables were module-level constants built at import time,
// which included a network fetch as a side effect of `import app_core`. That does not
// translate to a browser, so everything here is behind an explicit async bootstrap:
// `loadCatalog()` once during boot, `getCatalog()` everywhere after. Calling any reader
// before the bootstrap throws loudly rather than silently returning undefined.

import { FALLBACK_DEFINITIONS, LANGUAGES, slotLabel } from './constants.js';
import {
  deriveSlotFromTemplate,
  formatUniqueName,
  stripTierTitle,
  templateGroup,
} from './text.js';
import { itemImageUrl } from './urls.js';

const MAX_ENCHANTMENT = 4;

let catalog = null;

/** Composite key for the per-tier name maps; Python keyed these by a (template, tier) tuple. */
export function tierKey(template, tier) {
  return `${template}|${tier}`;
}

/**
 * Expand the grouped catalog into the flat, per-unique-name entry list.
 *
 * Order matters and is preserved: templates and tiers keep their upstream order and
 * enchantments ascend, which reproduces the original items.json ordering exactly
 * (verified against the golden fixture). Search groups results by first appearance and
 * then truncates to 24, so any reordering here silently changes what users see.
 */
export function deriveEntries(data) {
  const entries = [];
  for (const [template, tiers] of data.templates) {
    const slot = deriveSlotFromTemplate(template);
    if (!slot) continue;
    const group = templateGroup(template);
    const label = slotLabel(slot, 'en');
    const twoHanded = group === '2H';
    for (const [tier, enchantments, names] of tiers) {
      const fallbackName = names.en || Object.values(names)[0] || template;
      const displayName = stripTierTitle(fallbackName);
      const englishName = stripTierTitle(names.en || displayName);
      for (const enchantment of enchantments) {
        const uniqueName = formatUniqueName(template, tier, enchantment);
        entries.push({
          unique_name: uniqueName,
          template,
          slot,
          slot_label: label,
          group,
          tier,
          enchantment,
          quality: 1,
          equivalent_level: tier + enchantment,
          display_name: displayName,
          english_name: englishName,
          image_url: itemImageUrl(uniqueName, 1, 'en'),
          two_handed: twoHanded,
          _localized_names: names,
        });
      }
    }
  }
  return entries;
}

/**
 * One definition per template, with the tier range inferred from the data actually
 * present. Externally-derived definitions deliberately win over the hand-authored
 * fallbacks: several fallback templates (CAPE, MAIN_SWORD, MOUNT, FOOD...) reuse real
 * in-game names but hardcode min_tier=4, which is too narrow for items that go down to
 * T1 in the real game.
 *
 * The fallbacks are still merged in first, because 14 of them (HEAD_PLATE, MAIN_BOW,
 * FOOD, POTION, OFF_TOME, and the CHEST_ and FEET_ families) have no external
 * counterpart and are the only definition source for loadout presets saved before the
 * external catalog existed.
 */
function buildDefinitions(data) {
  const definitions = new Map();
  for (const definition of FALLBACK_DEFINITIONS) {
    definitions.set(definition.template, definition);
  }

  for (const [template, tiers] of data.templates) {
    const slot = deriveSlotFromTemplate(template);
    if (!slot) continue;
    const localizedNames = {};
    let minTier = Infinity;
    let maxTier = -Infinity;
    for (const [tier, , names] of tiers) {
      minTier = Math.min(minTier, tier);
      maxTier = Math.max(maxTier, tier);
      // First name seen per language wins, matching the Python original.
      for (const language of LANGUAGES) {
        if (names[language] !== undefined && localizedNames[language] === undefined) {
          localizedNames[language] = stripTierTitle(names[language]);
        }
      }
    }
    definitions.set(template, {
      template,
      slot,
      group: templateGroup(template),
      min_tier: minTier,
      max_tier: maxTier,
      max_enchantment: MAX_ENCHANTMENT,
      two_handed: templateGroup(template) === '2H',
      localized_names: localizedNames,
    });
  }
  return definitions;
}

/**
 * Per-(template, tier) names, in both stripped and raw form.
 *
 * Most equipment keeps one name across tiers with only the rank title changing, but some
 * templates - mainly food - are genuinely different dishes per tier (T4_MEAL_STEW is
 * "Goat Stew", T8_MEAL_STEW is "Beef Stew"). A single name per template is wrong for
 * those, which is what made the optimizer offer Goat Stew as a substitute for Beef Stew.
 * Raw names are kept because the in-game market alias needs the rank title back.
 */
function buildTierNames(data) {
  const stripped = new Map();
  const raw = new Map();
  for (const [template, tiers] of data.templates) {
    for (const [tier, , names] of tiers) {
      const key = tierKey(template, tier);
      if (raw.has(key)) continue;
      raw.set(key, names);
      const strippedNames = {};
      for (const [language, name] of Object.entries(names)) {
        strippedNames[language] = stripTierTitle(name);
      }
      stripped.set(key, strippedNames);
    }
  }
  return { stripped, raw };
}

function derive(data) {
  const entries = deriveEntries(data);
  const tierNames = buildTierNames(data);
  return {
    version: data.version,
    generatedAt: data.generatedAt || null,
    entries,
    definitions: buildDefinitions(data),
    tierLocalizedNames: tierNames.stripped,
    tierRawNames: tierNames.raw,
  };
}

/** Build the derived tables from an already-parsed catalog (used by tests). */
export function setCatalog(data) {
  catalog = derive(data);
  return catalog;
}

/** Fetch and install the catalog. Call once, during boot, before anything else. */
export async function loadCatalog(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load the item catalog (${response.status} ${response.statusText})`);
  }
  return setCatalog(await response.json());
}

export function getCatalog() {
  if (!catalog) {
    throw new Error('catalog not loaded - call loadCatalog() during boot first');
  }
  return catalog;
}

export function findDefinition(template) {
  return getCatalog().definitions.get(template) || null;
}

/** Reset the singleton. Test-only; there is no reason to call this from the app. */
export function resetCatalog() {
  catalog = null;
}
