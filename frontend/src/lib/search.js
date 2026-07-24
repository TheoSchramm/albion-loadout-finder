// Item search: match, group by template, and pick a representative variant.

import { slotLabel } from './constants.js';
import { matchesQuery, normalizeText, requestedVariantHint, stripTierTitle } from './text.js';
import { getCatalog } from './catalog.js';

const DEFAULT_LIMIT = 24;

/** Port of _external_display_name: per-language name, tier title stripped. */
function externalDisplayName(entry, language) {
  const names = entry._localized_names;
  if (names && typeof names === 'object') {
    const value = names[language] || names.en;
    if (typeof value === 'string' && value) {
      return stripTierTitle(value);
    }
  }
  const fallback = entry.display_name || entry.english_name;
  return typeof fallback === 'string' ? stripTierTitle(fallback) : entry.template || '';
}

/**
 * Collapse matching variants into one result per template.
 *
 * Two ordering details are load-bearing and deliberately preserved:
 * - Groups keep catalog order (first appearance), NOT relevance. There is no scoring.
 * - The limit is applied to GROUPS before a representative variant is chosen, so it caps
 *   how many distinct items come back, not how many variants.
 */
function groupSearchResults(candidates, query, slot, language, limit) {
  const normalizedQuery = query ? normalizeText(query) : '';
  const hint = requestedVariantHint(query || '');
  const grouped = new Map();

  for (const candidate of candidates) {
    if (slot && candidate.slot !== slot) continue;
    const labels = [candidate.unique_name, candidate.display_name, candidate.english_name];
    if (!matchesQuery(labels, normalizedQuery)) continue;

    const key = `${candidate.slot}|${candidate.template}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        template: candidate.template,
        slot: candidate.slot,
        slot_label: slotLabel(candidate.slot, language),
        group: candidate.group,
        variants: [],
      };
      grouped.set(key, group);
    }
    group.variants.push(candidate);
  }

  const results = [];
  // Map preserves insertion order, which is what Python's explicit `_order` field
  // reproduced; taking the first `limit` groups is therefore the same cut.
  for (const group of [...grouped.values()].slice(0, limit)) {
    const variants = [...group.variants].sort(
      (a, b) => a.tier - b.tier || a.enchantment - b.enchantment || a.quality - b.quality,
    );

    let selected;
    if (hint.tier !== null) {
      selected = variants.find(
        (variant) =>
          variant.tier === hint.tier &&
          (hint.enchantment === null || variant.enchantment === hint.enchantment),
      );
    } else {
      selected = variants.find((variant) => variant.enchantment === (hint.enchantment || 0));
    }
    if (!selected) {
      selected = variants[0];
    }

    results.push({
      template: group.template,
      slot: group.slot,
      slot_label: group.slot_label,
      group: group.group,
      display_name: selected.display_name,
      english_name: selected.english_name,
      image_url: selected.image_url,
      unique_name: selected.unique_name,
      tier: selected.tier,
      enchantment: selected.enchantment,
      quality: selected.quality,
      equivalent_level: selected.equivalent_level,
      two_handed: selected.two_handed,
      variants,
    });
  }

  return results;
}

/**
 * Search the catalog.
 *
 * This rebuilds a payload for all ~7,479 entries on every call, exactly as the Python
 * original did. That measures at single-digit milliseconds and sits behind the existing
 * 160 ms input debounce, so an index would add cache-invalidation complexity for no
 * perceptible gain.
 */
export function searchItems(query, language = 'en', slot = null, limit = DEFAULT_LIMIT) {
  const languageKey = String(language).toLowerCase();
  const candidates = getCatalog().entries.map((entry) => ({
    unique_name: entry.unique_name,
    template: entry.template,
    slot: entry.slot,
    slot_label: slotLabel(entry.slot, languageKey),
    group: entry.group,
    tier: entry.tier,
    enchantment: entry.enchantment,
    quality: entry.quality,
    equivalent_level: entry.equivalent_level,
    display_name: externalDisplayName(entry, languageKey),
    english_name: entry.english_name,
    image_url: entry.image_url,
    two_handed: entry.two_handed,
  }));
  return groupSearchResults(candidates, query, slot, languageKey, limit);
}
