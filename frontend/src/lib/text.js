// String/template helpers ported from backend/app_core.py.

import { TEMPLATE_PREFIX_SLOTS } from './constants.js';

/**
 * Fold a string down to comparable characters: letters and digits in any script survive,
 * everything else (spaces, punctuation, apostrophes) is dropped.
 *
 * The Python original was `[^a-z0-9]` over a lowercased string, which deleted every
 * non-ASCII character. That made accented text lossy ("Épée" -> "pe") and non-Latin text
 * empty - and an empty normalized query matches *everything* (see matchesQuery), so
 * searching in Russian, Chinese or Korean silently returned the first 24 catalog entries
 * unfiltered, in three of the app's own advertised languages.
 *
 * NFC only, deliberately. Composing means "é" typed as e + combining acute compares equal
 * to a precomposed "é", which is a pure win. Going further to NFKD and stripping combining
 * marks would additionally let "Epee" find "Épée" - tempting, but it also makes Portuguese
 * "Maça Pesada" normalize to "macapesada", which *contains* "cape", so searching "cape" in
 * Portuguese surfaces maces and pushes real capes out of the 24-result limit. Accent
 * folding is a separate feature with that tradeoff to solve properly (match folded and
 * unfolded forms separately), not a free improvement to bundle in here.
 */
export function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// Matches the rank title the game bakes into item names ("Adept's Sword"). ASCII
// apostrophe only, exactly as the Python source - a typographic apostrophe upstream
// would silently stop stripping, which build-catalog.mjs asserts against.
const TIER_TITLE_PATTERN =
  /^(?:Beginner|Novice|Journeyman|Adept|Expert|Master|Grandmaster|Elder)'s\s+/i;

/**
 * Strip the tier-rank title so items of one template group under a single name across
 * tiers. Falls back to the original if stripping would leave nothing.
 */
export function stripTierTitle(name) {
  const stripped = String(name).replace(TIER_TITLE_PATTERN, '').trim();
  return stripped || name;
}

export function formatUniqueName(template, tier, enchantment) {
  const base = `T${tier}_${template}`;
  return enchantment === 0 ? base : `${base}@${enchantment}`;
}

// `^...$` stands in for Python's re.fullmatch. The lazy `.+?` backtracks identically in
// both engines, so "T6_MAIN_SWORD@2" splits to ("MAIN_SWORD", 2) either way.
const UNIQUE_NAME_PATTERN = /^T(\d+)_(.+?)(?:@(\d+))?$/;

/**
 * Split "T6_MAIN_SWORD@2" into { tier, template, enchantment }.
 *
 * Returns null rather than throwing: every Python caller wrapped this in
 * `except ValueError: continue`, so a null return collapses that to a plain check.
 */
export function parseUniqueName(uniqueName) {
  const match = UNIQUE_NAME_PATTERN.exec(String(uniqueName));
  if (!match) {
    return null;
  }
  return {
    tier: Number(match[1]),
    template: match[2],
    enchantment: Number(match[3] || 0),
  };
}

// Python's \b is Unicode-aware on str; JavaScript's is ASCII-only. That difference is
// user-visible: in "меч4.2" Python sees no boundary between "ч" and "4" and finds no
// tier hint, whereas a literal \b port would find one and silently select a different
// variant. These lookarounds reproduce Python's \w = [\p{L}\p{N}_] semantics.
const TIER_HINT_PATTERN = /(?<![\p{L}\p{N}_])T?(\d)\.(\d)(?![\p{L}\p{N}_])/iu;
const ENCHANT_HINT_PATTERN = /@(\d)(?![\p{L}\p{N}_])/u;

/**
 * Pull a "4.2" / "T4.2" / "@3" hint out of a raw search query, used to pick which
 * variant of a matched template to show.
 */
export function requestedVariantHint(query) {
  const tierMatch = TIER_HINT_PATTERN.exec(query);
  if (tierMatch) {
    return { tier: Number(tierMatch[1]), enchantment: Number(tierMatch[2]) };
  }
  const enchantMatch = ENCHANT_HINT_PATTERN.exec(query);
  if (enchantMatch) {
    return { tier: null, enchantment: Number(enchantMatch[1]) };
  }
  return { tier: null, enchantment: null };
}

export function matchesQuery(labels, normalizedQuery) {
  if (!normalizedQuery) {
    return true;
  }
  return labels.some((label) => normalizeText(label).includes(normalizedQuery));
}

export function templateGroup(template) {
  return String(template).split('_')[0];
}

/**
 * Map a template to one of the 10 loadout slots, or null if it is not equipable gear.
 *
 * Two exclusions on top of the prefix allowlist:
 * - Gathering tools (pickaxe, sickle, skinning knife...) are equipped in the weapon slot
 *   in-game and share the "2H_" prefix with real weapons, but carry a "TOOL_" segment -
 *   excluded so weapon search does not surface them.
 * - "_BP" templates are Crests - faction/season trophy items, not capes - despite
 *   sharing the "CAPEITEM_" prefix with real capes (e.g. CAPEITEM_FW_BRIDGEWATCH is
 *   "Bridgewatch Cape", equipable; CAPEITEM_FW_BRIDGEWATCH_BP is "Bridgewatch Crest", a
 *   collectible, and would otherwise show up in cape search results. Verified this
 *   suffix is cape-specific pollution - it does not occur under any other prefix - but
 *   the exclusion is written generally in case a future item category reuses it.
 */
export function deriveSlotFromTemplate(template) {
  const value = String(template);
  if (value.startsWith('2H_TOOL_') || value.endsWith('_BP')) {
    return null;
  }
  return TEMPLATE_PREFIX_SLOTS[templateGroup(value)] || null;
}
