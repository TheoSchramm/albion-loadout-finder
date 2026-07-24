// Item variants: construction, naming, serialization, and IP-equivalence.

import { slotLabel } from './constants.js';
import { formatUniqueName } from './text.js';
import { itemImageUrl } from './urls.js';
import { findDefinition, getCatalog, tierKey } from './catalog.js';

export function buildVariant(definition, tier, enchantment, quality = 1) {
  return {
    unique_name: formatUniqueName(definition.template, tier, enchantment),
    template: definition.template,
    slot: definition.slot,
    group: definition.group,
    tier,
    enchantment,
    quality,
    two_handed: definition.two_handed,
    localized_names: definition.localized_names,
    equivalent_level: tier + enchantment,
  };
}

/**
 * The display name for a specific variant.
 *
 * A definition holds one name per template, which is wrong for templates that rename per
 * tier (T4_MEAL_STEW is "Goat Stew", T8_MEAL_STEW is "Beef Stew"), so the exact per-tier
 * name wins when there is one.
 */
export function localizedVariantName(variant, language) {
  const languageKey = String(language).toLowerCase();
  const tierNames = getCatalog().tierLocalizedNames.get(tierKey(variant.template, variant.tier));
  if (tierNames) {
    return tierNames[languageKey] || tierNames.en || variant.template;
  }
  const names = variant.localized_names || {};
  return names[languageKey] || names.en || variant.template;
}

/**
 * The item's full in-game name plus tier.enchantment, for pasting straight into the
 * in-game market search ("Adept's Hunter Shoes 4.2").
 *
 * Uses the RAW per-tier name, i.e. with the rank title that display names strip - the
 * market searches on the game's own wording. Food and mounts never had a rank title, so
 * this is a no-op for them rather than inventing one.
 */
export function marketSearchAlias(variant, language = 'en') {
  const languageKey = String(language).toLowerCase();
  const rawNames = getCatalog().tierRawNames.get(tierKey(variant.template, variant.tier));
  let fullName = null;
  if (rawNames) {
    fullName = rawNames[languageKey] || rawNames.en;
  }
  if (!fullName) {
    fullName = localizedVariantName(variant, language);
  }
  return `${fullName} ${variant.tier}.${variant.enchantment}`;
}

/**
 * The public shape of a single item.
 *
 * The key set here is a contract, not an implementation detail: app.js merges this
 * response over already-rendered results when the language changes
 * (`Object.assign(candidate, update)`), so adding a market-data key such as
 * `cheapest_price` or `updated_at` would overwrite real prices with undefined. The test
 * suite freezes these 14 keys for that reason.
 */
export function serializeVariant(variant, language = 'en') {
  return {
    unique_name: variant.unique_name,
    template: variant.template,
    slot: variant.slot,
    slot_label: slotLabel(variant.slot, language),
    group: variant.group,
    tier: variant.tier,
    enchantment: variant.enchantment,
    quality: variant.quality,
    equivalent_level: variant.tier + variant.enchantment,
    display_name: localizedVariantName(variant, language),
    english_name: localizedVariantName(variant, 'en'),
    image_url: itemImageUrl(variant.unique_name, variant.quality, 'en'),
    two_handed: variant.two_handed,
    market_search_alias: marketSearchAlias(variant, language),
  };
}

/**
 * Every tier/enchantment combination with the same item power as `variant`.
 *
 * Equivalent level is tier + enchantment, so 4.2, 5.1 and 6.0 all hit the same IP and
 * are interchangeable - that substitution is the whole point of the optimizer.
 *
 * Two rules keep it from inventing items that do not exist:
 * - Only tier 4+ can be enchanted. Tiers 1-3 exist only at .0, so a "T2_CAPE@4" would
 *   price a variant the game has never had.
 * - Tiers that carry a genuinely different item name are different items, not IP-scaled
 *   versions of one (MEAL_STEW exists at T4/T6/T8 as three separate dishes, and skips
 *   T5/T7 entirely). Substituting across those would offer Goat Stew for Beef Stew.
 */
export function equivalentVariants(variant) {
  const definition = findDefinition(variant.template);
  if (!definition) {
    return [variant];
  }
  const targetLevel = variant.tier + variant.enchantment;
  const tierNames = getCatalog().tierLocalizedNames;
  const referenceEntry = tierNames.get(tierKey(variant.template, variant.tier));
  const referenceName = referenceEntry ? referenceEntry.en : undefined;

  const candidates = [];
  for (let tier = definition.min_tier; tier <= definition.max_tier; tier += 1) {
    if (referenceName !== undefined) {
      const entry = tierNames.get(tierKey(variant.template, tier));
      const name = entry ? entry.en : undefined;
      if (name !== referenceName) continue;
    }
    const maxEnchantment = tier >= 4 ? definition.max_enchantment : 0;
    const enchantment = targetLevel - tier;
    if (enchantment >= 0 && enchantment <= maxEnchantment) {
      candidates.push(buildVariant(definition, tier, enchantment));
    }
  }
  if (candidates.length === 0) {
    candidates.push(variant);
  }
  return candidates;
}
