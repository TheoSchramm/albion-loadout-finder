// Pick the cheapest IP-equivalent variant for each equipped slot.

import { qualityLabel } from './constants.js';
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
 * Slots and candidates with no real market data are omitted entirely rather than shown
 * with a placeholder price. An absent row is honest; a fabricated number that looks
 * exactly like a real one is not.
 */
export async function optimizeLoadoutWithCities({
  loadout,
  region = 'americas',
  language = 'en',
  cities = null,
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
  // same number of API calls as a single slot would.
  const allCandidateNames = [];
  for (const variant of selectedVariants) {
    for (const candidate of equivalentVariants(variant)) {
      allCandidateNames.push(candidate.unique_name);
    }
  }
  const priceMap = await fetchPrices(allCandidateNames, region, selectedCities, fetchOptions);

  const slots = [];
  let totalCost = 0;

  for (const variant of selectedVariants) {
    const candidatePayloads = [];
    let cheapest = null;

    for (const candidate of equivalentVariants(variant)) {
      const cityPrices = priceMap.get(candidate.unique_name) || {};
      const best = cheapestCity(cityPrices);
      if (!best) continue;

      const payload = {
        ...serializeVariant(candidate, language),
        cheapest_city: best.city,
        cheapest_price: best.data.sell_price_min,
        cheapest_quality: best.data.quality,
        cheapest_quality_label: qualityLabel(best.data.quality),
        updated_at: best.data.updated_at,
        api_url: priceQueryUrl(candidate.unique_name, region, selectedCities),
      };
      candidatePayloads.push(payload);
      if (cheapest === null || payload.cheapest_price < cheapest.cheapest_price) {
        cheapest = payload;
      }
    }

    if (cheapest === null) continue;

    totalCost += cheapest.cheapest_price;
    slots.push({
      selected: serializeVariant(variant, language),
      candidates: [...candidatePayloads].sort((a, b) => a.cheapest_price - b.cheapest_price),
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
