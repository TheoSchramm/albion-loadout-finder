// URL construction for the two third-party services the app talks to directly:
// the item render CDN and the Albion Online Data Project price API.
//
// Encoding note: Python's `urllib.parse.quote(x, safe='')` and JS's `encodeURIComponent`
// agree on everything here, including the "@" in enchanted names ("T6_MAIN_SWORD@2" ->
// "T6_MAIN_SWORD%402") - verified against both runtimes. They differ only where the
// Python side passes `safe=','` to keep comma separators literal, which is why the
// multi-value helpers below encode each element and join with a raw comma rather than
// encoding the joined string (encodeURIComponent('A,B') would give 'A%2CB', changing
// both the request and the user-visible "inspect this query" link).

import { REGIONS } from './constants.js';

const RENDER_HOST = 'https://render.albiononline.com';

export function regionHost(region) {
  return (REGIONS[region] || REGIONS.americas).host;
}

export function citiesForRegion(region) {
  return [...(REGIONS[region] || REGIONS.americas).cities];
}

/** Encode each value, then join with literal commas (Python's `quote(..., safe=',')`). */
export function joinEncoded(values) {
  return values.map(encodeURIComponent).join(',');
}

/** Remove duplicates while preserving first-seen order (Python's `dict.fromkeys`). */
export function dedupe(values) {
  return [...new Set(values)];
}

export function itemImageUrl(uniqueName, quality = 1, locale = 'en') {
  const encodedName = encodeURIComponent(uniqueName);
  return `${RENDER_HOST}/v1/item/${encodedName}.png?quality=${quality}&locale=${encodeURIComponent(locale)}`;
}

// Qualities below the requested floor are dropped by the API itself rather than fetched
// and filtered client-side - fewer rows over the wire, and prices.js's "cheapest per
// city" fold never even sees a quality it shouldn't consider.
export function qualityRange(minQuality) {
  const floor = Math.min(Math.max(Math.trunc(minQuality) || 1, 1), 5);
  const values = [];
  for (let quality = floor; quality <= 5; quality += 1) {
    values.push(quality);
  }
  return values.join(',');
}

/**
 * The exact price-API request used for this item, so a user can open it and inspect the
 * raw JSON. `minQuality` should be whatever floor was actually used for this candidate -
 * the caller's Minimum quality filter, or a fixed floor of 1 for food/potion candidates,
 * which never list above Normal - so the link reflects the real request made rather than
 * a value fixed independently of it.
 */
export function priceQueryUrl(uniqueName, region, cities, minQuality = 1) {
  const host = regionHost(region);
  const cityList = dedupe(cities);
  return (
    `${host}/api/v2/stats/prices/${encodeURIComponent(uniqueName)}.json` +
    `?locations=${joinEncoded(cityList)}&qualities=${qualityRange(minQuality)}`
  );
}
