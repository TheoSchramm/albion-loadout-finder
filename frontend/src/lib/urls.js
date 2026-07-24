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

/**
 * The exact price-API request used for this item, so a user can open it and inspect the
 * raw JSON. Deliberately `qualities=1` even though the real fetch asks for all five -
 * this mirrors the Python original, whose link was always the quality-1 query.
 */
export function priceQueryUrl(uniqueName, region, cities) {
  const host = regionHost(region);
  const cityList = dedupe(cities);
  return (
    `${host}/api/v2/stats/prices/${encodeURIComponent(uniqueName)}.json` +
    `?locations=${joinEncoded(cityList)}&qualities=1`
  );
}
