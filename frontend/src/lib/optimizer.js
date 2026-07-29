// Pick the cheapest IP-equivalent variant for each equipped slot.

import { qualityLabel, SLOTS_WITHOUT_QUALITY } from './constants.js';
import { parseUniqueName } from './text.js';
import { citiesForRegion, priceQueryUrl } from './urls.js';
import { findDefinition } from './catalog.js';
import { buildVariant, equivalentVariants, serializeVariant } from './items.js';
import { fetchPrices } from './prices.js';

/**
 * Cheapest city for one item, or null if it has no real listing anywhere.
 *
 * Ties keep the FIRST city in insertion order, matching Python's `min()`. A `<=`
 * comparison here would silently flip which city is shown whenever two match.
 */
function cheapestCity(cityPrices) {
  let bestCity = null;
  let bestData = null;
  for (const [city, data] of Object.entries(cityPrices)) {
    if (bestData === null || data.sell_price_min < bestData.sell_price_min) {
      bestCity = city;
      bestData = data;
    }
  }
  return bestData === null ? null : { city: bestCity, data: bestData };
}

/**
 * Price a loadout.
 *
 * Each slot is optimized independently - the cheapest equivalent variant per slot, not a
 * global combination search, which is what the UI presents.
 *
 * Every equipped slot and every IP-equivalent candidate is always returned, even ones
 * with no real market listing anywhere - `cheapest_price` is `null` for those rather than
 * a fabricated number, and the UI is responsible for showing "no market data" instead of
 * a price. This is a deliberate change from only returning priced rows: a user comparing
 * options wants to see every tier/enchant alternative that exists, including ones AODP
 * simply has no data for right now, with a one-click way to check the in-game market
 * search directly (market_search_alias) rather than having the item vanish from the list
 * entirely. total_cost still only ever sums real prices.
 */
export async function optimizeLoadoutWithCities({
  loadout,
  region = 'americas',
  language = 'en',
  cities = null,
  minQuality = 1,
  fetchOptions = {},
}) {
  const selectedVariants = [];
  for (const entry of loadout) {
    const uniqueName = entry.unique_name || entry.uniqueName || '';
    if (!uniqueName) continue;
    const parsed = parseUniqueName(uniqueName);
    if (!parsed) continue;
    const definition = findDefinition(parsed.template);
    if (!definition) continue;
    selectedVariants.push(buildVariant(definition, parsed.tier, parsed.enchantment));
  }

  const selectedCities = cities && cities.length > 0 ? [...cities] : citiesForRegion(region);

  if (selectedVariants.length === 0) {
    return {
      region,
      language,
      cities: selectedCities,
      slots: [],
      total_cost: 0,
      currency: 'silver',
    };
  }

  // One request wave for every candidate of every slot, so the whole loadout costs the
  // same number of API calls as a single slot would. Food/potion candidates are pulled
  // out into their own wave at a fixed quality floor of 1 - they never list above Normal,
  // so applying the user's minQuality filter to them would silently zero out their only
  // real data instead of narrowing it.
  const allCandidateNames = [];
  const qualityFreeNames = new Set();
  for (const variant of selectedVariants) {
    const isQualityFree = SLOTS_WITHOUT_QUALITY.includes(variant.slot);
    for (const candidate of equivalentVariants(variant)) {
      allCandidateNames.push(candidate.unique_name);
      if (isQualityFree) {
        qualityFreeNames.add(candidate.unique_name);
      }
    }
  }
  const standardNames = allCandidateNames.filter((name) => !qualityFreeNames.has(name));
  const [standardPrices, qualityFreePrices] = await Promise.all([
    standardNames.length
      ? fetchPrices(standardNames, region, selectedCities, { minQuality, ...fetchOptions })
      : Promise.resolve(new Map()),
    qualityFreeNames.size
      ? fetchPrices([...qualityFreeNames], region, selectedCities, { ...fetchOptions, minQuality: 1 })
      : Promise.resolve(new Map()),
  ]);
  const priceMap = new Map([...standardPrices, ...qualityFreePrices]);

  const slots = [];
  let totalCost = 0;

  for (const variant of selectedVariants) {
    const candidatePayloads = [];
    let cheapest = null;

    for (const candidate of equivalentVariants(variant)) {
      const cityPrices = priceMap.get(candidate.unique_name) || {};
      const best = cheapestCity(cityPrices);
      // Matches whichever floor was actually used to fetch this candidate: food/potion
      // candidates were queried at a fixed floor of 1 regardless of minQuality (see
      // above), so their link must say so too rather than implying the user's filter
      // applied to them.
      const candidateMinQuality = qualityFreeNames.has(candidate.unique_name) ? 1 : minQuality;

      const payload = {
        ...serializeVariant(candidate, language),
        cheapest_city: best ? best.city : null,
        cheapest_price: best ? best.data.sell_price_min : null,
        cheapest_quality: best ? best.data.quality : null,
        cheapest_quality_label: best ? qualityLabel(best.data.quality) : null,
        updated_at: best ? best.data.updated_at : '',
        api_url: priceQueryUrl(candidate.unique_name, region, selectedCities, candidateMinQuality),
      };
      candidatePayloads.push(payload);
      if (best && (cheapest === null || payload.cheapest_price < cheapest.cheapest_price)) {
        cheapest = payload;
      }
    }

    // equivalentVariants() always includes the equipped variant itself, so
    // candidatePayloads is never empty. If nothing had real data, fall back to that
    // variant's own (unpriced) payload so the slot still appears, just with no price,
    // instead of disappearing from the results entirely.
    if (cheapest === null) {
      cheapest = candidatePayloads.find((c) => c.unique_name === variant.unique_name) || candidatePayloads[0];
    }

    if (cheapest.cheapest_price != null) {
      totalCost += cheapest.cheapest_price;
    }

    slots.push({
      selected: serializeVariant(variant, language),
      // Priced candidates first (cheapest to most expensive), unpriced ones after in
      // their natural tier/enchant order.
      candidates: [...candidatePayloads].sort((a, b) => {
        if (a.cheapest_price == null && b.cheapest_price == null) return 0;
        if (a.cheapest_price == null) return 1;
        if (b.cheapest_price == null) return -1;
        return a.cheapest_price - b.cheapest_price;
      }),
      best: cheapest,
    });
  }

  return {
    region,
    language,
    cities: selectedCities,
    slots,
    total_cost: totalCost,
    currency: 'silver',
  };
}

export function optimizeLoadout(loadout, region = 'americas', language = 'en', fetchOptions = {}) {
  return optimizeLoadoutWithCities({ loadout, region, language, cities: null, fetchOptions });
}
