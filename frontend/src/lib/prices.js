// Live market prices from the Albion Online Data Project.
//
// This runs in the browser now rather than on a shared server, which is an improvement
// for rate limits: the API's 180 req/min budget is per client IP, so it used to be
// shared by every visitor at once and is now each visitor's own.
//
// `fetch` and `now` are injectable so the whole module is testable with no network and
// no dependencies.

import { qualityLabel } from './constants.js';
import { dedupe, joinEncoded, regionHost } from './urls.js';

// The API rejects over-long URLs, so item lists are chunked to stay under this.
const MAX_URL_LENGTH = 4096;

/**
 * Split names into request-sized batches.
 *
 * The projected-size check and the running total below disagree slightly about when a
 * separator counts, which makes the split points not simply "every N names". That
 * asymmetry is preserved deliberately: it decides how many requests are made against a
 * rate-limited API, and the golden fixture pins the exact boundaries.
 */
export function planBatches(uniqueNames) {
  const batches = [];
  let batch = [];
  let batchUrlSize = 0;

  for (const uniqueName of uniqueNames) {
    const token = encodeURIComponent(uniqueName);
    const projected = batchUrlSize + token.length + (batch.length > 0 ? 1 : 0);
    if (batch.length > 0 && projected > MAX_URL_LENGTH) {
      batches.push(batch);
      batch = [];
      batchUrlSize = 0;
    }
    batch.push(uniqueName);
    batchUrlSize += token.length + (batch.length > 1 ? 1 : 0);
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

// Qualities below the requested floor are dropped by the API itself rather than
// fetched and filtered client-side - fewer rows over the wire, and the "cheapest per
// city" fold below never even sees a quality it shouldn't consider.
function qualityRange(minQuality) {
  const floor = Math.min(Math.max(Math.trunc(minQuality) || 1, 1), 5);
  const values = [];
  for (let quality = floor; quality <= 5; quality += 1) {
    values.push(quality);
  }
  return values.join(',');
}

function batchUrl(host, batch, cities, minQuality) {
  return (
    `${host}/api/v2/stats/prices/${joinEncoded(batch)}.json` +
    `?locations=${joinEncoded(cities)}&qualities=${qualityRange(minQuality)}`
  );
}

/**
 * Fold one API response into the accumulator, keeping the cheapest real listing per
 * (item, city) across all five qualities.
 *
 * A zero `sell_price_min` means "nothing listed", not "free" - recording it would make a
 * non-existent listing look like the cheapest option. Ties keep the first row seen,
 * matching the Python original.
 */
function absorb(payload, batch, cities, accumulator, now) {
  const cityset = new Set(cities);
  for (const uniqueName of batch) {
    if (!accumulator.has(uniqueName)) {
      accumulator.set(uniqueName, {});
    }
  }
  if (!Array.isArray(payload)) return;

  for (const entry of payload) {
    const uniqueName = entry.item_id;
    if (!accumulator.has(uniqueName)) continue;
    const city = entry.city;
    if (!cityset.has(city)) continue;
    const sellPrice = Number(entry.sell_price_min) || 0;
    if (sellPrice <= 0) continue;

    const cityPrices = accumulator.get(uniqueName);
    const existing = cityPrices[city];
    if (existing !== undefined && existing.sell_price_min <= sellPrice) continue;

    cityPrices[city] = {
      sell_price_min: sellPrice,
      quality: Number(entry.quality) || 1,
      buy_price_max: Number(entry.buy_price_max) || 0,
      updated_at: entry.sell_price_min_date || entry.buy_price_max_date || '',
      fetched_at: Math.trunc(now / 1000),
    };
  }
}

/**
 * Fetch prices for every name, in as few requests as the URL budget allows.
 *
 * Returns a Map of uniqueName -> { city: priceRecord }. A name with no real listing
 * anywhere maps to an empty object rather than a synthesized price: the optimizer treats
 * that as "no market data" and omits the item instead of showing a made-up number.
 *
 * No request headers are sent. A Content-Type on a cross-origin GET would trigger a CORS
 * preflight per batch, doubling requests against the rate limit for no benefit.
 */
export async function fetchPrices(
  uniqueNames,
  region,
  cities,
  { fetchImpl = globalThis.fetch, now = Date.now, minQuality = 1 } = {},
) {
  const host = regionHost(region);
  const uniqueList = dedupe(uniqueNames);
  const cityList = dedupe(cities);
  const accumulator = new Map(uniqueList.map((name) => [name, {}]));

  for (const batch of planBatches(uniqueList)) {
    let payload = [];
    try {
      const response = await fetchImpl(batchUrl(host, batch, cityList, minQuality));
      if (response.ok) {
        payload = await response.json();
      }
    } catch {
      // Network failure is not fatal: the affected items simply have no data, and the
      // optimizer omits them rather than inventing a price.
      payload = [];
    }
    absorb(payload, batch, cityList, accumulator, now());
  }

  return accumulator;
}

export { qualityLabel };
