// Build the browser item catalog from the ao-bin-dumps items.json.
//
// The upstream dump is ~24-32 MB because it carries long localized descriptions in 15
// languages for all 12,071 items. The app only needs UniqueName + LocalizedNames for the
// ~7,479 equipable ones in the 8 languages it supports, so this prunes and regroups it
// into ~0.5 MB (~70 KB gzipped, which is what a visitor actually downloads).
//
// Usage:
//   node scripts/build-catalog.mjs                  # fetch upstream, write the catalog
//   node scripts/build-catalog.mjs --from <path>    # build from a local dump instead
//   node scripts/build-catalog.mjs --check          # verify the committed file is current
//   node scripts/build-catalog.mjs --out <path>
//
// Output shape - `templates` is an ARRAY, not an object, and in upstream order. That is
// load-bearing: search groups results by first appearance and then truncates to 24, so
// an object would make the visible result set depend on JS property-order rules.
//
//   { version, generatedAt, source, languages,
//     templates: [ [template, [ [tier, [enchantments], {lang: rawName}] ]] ] }
//
// Names are stored RAW (rank title included, e.g. "Adept's Sword"). The browser derives
// both the stripped display name and the market-search alias from them; storing stripped
// names would make the alias unreconstructible.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGUAGES, SLOTS, TEMPLATE_PREFIX_SLOTS } from '../src/lib/constants.js';
import { parseUniqueName, deriveSlotFromTemplate } from '../src/lib/text.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(HERE, '..', 'src', 'data', 'items.catalog.json');
const SOURCE_URL =
  'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/refs/heads/master/formatted/items.json';

// Mirrors _LANGUAGE_LOCALE_ALIASES in the Python original. The dump keys names by full
// locale in UPPERCASE ("EN-US"); the app uses short codes ("en").
const LOCALE_ALIASES = {
  en: 'en-us',
  de: 'de-de',
  fr: 'fr-fr',
  pt: 'pt-br',
  es: 'es-es',
  ru: 'ru-ru',
  zh: 'zh-cn',
  ko: 'ko-kr',
};

const RANK_TITLES = [
  'Beginner',
  'Novice',
  'Journeyman',
  'Adept',
  'Expert',
  'Master',
  'Grandmaster',
  'Elder',
];

function parseArgs(argv) {
  const args = { from: null, check: false, out: DEFAULT_OUT };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--from') {
      args.from = argv[++index];
    } else if (flag === '--out') {
      args.out = argv[++index];
    } else if (flag === '--check') {
      args.check = true;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  return args;
}

function firstValue(payload, ...keys) {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

/** Port of _localized_names_from_raw, narrowed to the 8 supported short codes. */
function localizedNames(rawItem) {
  const rawNames = firstValue(rawItem, 'LocalizedNames', 'localizedNames', 'localized_names');
  const names = {};
  if (rawNames && typeof rawNames === 'object') {
    const lowered = {};
    for (const [key, value] of Object.entries(rawNames)) {
      if (typeof value === 'string' && value) {
        lowered[key.toLowerCase()] = value;
      }
    }
    for (const code of LANGUAGES) {
      const value = lowered[code] || lowered[LOCALE_ALIASES[code]];
      if (value) {
        names[code] = value;
      }
    }
    return names;
  }
  const fallback = firstValue(
    rawItem,
    'LocalizedName',
    'localizedName',
    'DisplayName',
    'displayName',
    'Name',
    'name',
  );
  if (typeof fallback === 'string' && fallback) {
    names.en = fallback;
  }
  return names;
}

function build(rawCatalog, sourceLabel) {
  if (!Array.isArray(rawCatalog)) {
    throw new Error('source catalog is not a JSON array');
  }

  // Insertion-ordered: Map preserves first-appearance order for both templates and tiers.
  const templates = new Map();
  let kept = 0;
  let withEnglish = 0;
  const divergent = [];

  for (const rawItem of rawCatalog) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const uniqueName = firstValue(rawItem, 'UniqueName', 'uniqueName', 'unique_name', 'Id', 'id');
    if (typeof uniqueName !== 'string') continue;
    const parsed = parseUniqueName(uniqueName);
    if (!parsed) continue;
    const names = localizedNames(rawItem);
    if (Object.keys(names).length === 0) continue;
    if (!deriveSlotFromTemplate(parsed.template)) continue;

    kept += 1;
    if (names.en) withEnglish += 1;

    if (!templates.has(parsed.template)) templates.set(parsed.template, new Map());
    const tiers = templates.get(parsed.template);
    if (!tiers.has(parsed.tier)) {
      tiers.set(parsed.tier, { enchantments: new Set(), names });
    }
    const tierGroup = tiers.get(parsed.tier);
    tierGroup.enchantments.add(parsed.enchantment);
    // Grouping is only lossless if every enchantment of a (template, tier) shares one
    // set of names. That holds today (0 of 1,671 groups diverge); assert rather than
    // assume, because a silent divergence would drop real names.
    if (JSON.stringify(tierGroup.names) !== JSON.stringify(names)) {
      divergent.push(uniqueName);
    }
  }

  const payload = {
    version: 1,
    source: sourceLabel,
    languages: [...LANGUAGES],
    templates: [...templates].map(([template, tiers]) => [
      template,
      [...tiers].map(([tier, group]) => [
        tier,
        [...group.enchantments].sort((a, b) => a - b),
        group.names,
      ]),
    ]),
  };
  return { payload, stats: { kept, withEnglish, divergent, templateCount: templates.size } };
}

function assertSane({ payload, stats }, previousCount) {
  const problems = [];

  if (stats.divergent.length > 0) {
    problems.push(
      `${stats.divergent.length} (template,tier) groups have divergent localized names, ` +
        `so grouping would lose data. First: ${stats.divergent.slice(0, 3).join(', ')}`,
    );
  }

  if (previousCount !== null) {
    const delta = Math.abs(stats.kept - previousCount) / previousCount;
    if (delta > 0.2) {
      problems.push(
        `entry count moved ${(delta * 100).toFixed(1)}% (${previousCount} -> ${stats.kept}); ` +
          'upstream may have changed shape. Re-run with --from to compare, or raise the bound ' +
          'deliberately if the change is real.',
      );
    }
  }

  const badTemplates = payload.templates
    .map(([template]) => template)
    .filter((template) => !/^[A-Z0-9_]+$/.test(template));
  if (badTemplates.length > 0) {
    // The browser keys per-tier name lookups by `${template}|${tier}`; a template
    // containing "|" would collide across entries.
    problems.push(`templates with unexpected characters: ${badTemplates.slice(0, 5).join(', ')}`);
  }

  const slotsSeen = new Set(
    payload.templates.map(([template]) => deriveSlotFromTemplate(template)).filter(Boolean),
  );
  const missingSlots = SLOTS.filter((slot) => !slotsSeen.has(slot));
  if (missingSlots.length > 0) {
    problems.push(`no templates for slot(s): ${missingSlots.join(', ')}`);
  }

  const englishRatio = stats.kept === 0 ? 0 : stats.withEnglish / stats.kept;
  if (englishRatio < 0.99) {
    problems.push(`only ${(englishRatio * 100).toFixed(1)}% of entries have an English name`);
  }

  // stripTierTitle only recognizes an ASCII apostrophe. If upstream ever switches to a
  // typographic one, every English display name silently keeps its rank prefix and item
  // grouping splinters per tier. Catch that here rather than in the UI.
  let titled = 0;
  let titleCandidates = 0;
  for (const [template, tiers] of payload.templates) {
    if (!/^(MAIN|2H|OFF|HEAD|ARMOR|SHOES)_/.test(template)) continue;
    for (const [tier, , names] of tiers) {
      if (tier < 4 || !names.en) continue;
      titleCandidates += 1;
      if (RANK_TITLES.some((title) => names.en.startsWith(`${title}'s `))) titled += 1;
    }
  }
  const titledRatio = titleCandidates === 0 ? 1 : titled / titleCandidates;
  if (titledRatio < 0.9) {
    problems.push(
      `only ${(titledRatio * 100).toFixed(1)}% of tier-4+ equipment names carry a rank title ` +
        `(${titled}/${titleCandidates}) - stripTierTitle may no longer match upstream`,
    );
  }

  if (problems.length > 0) {
    console.error('\nCatalog build failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  return { englishRatio, titledRatio };
}

/** Stable serialization - a no-op regeneration must be byte-identical. */
function serialize(payload, generatedAt) {
  return `${JSON.stringify({ ...payload, generatedAt }, null, 0)}\n`;
}

/** Everything except the timestamp, which changes every run by design. */
function comparable(text) {
  const parsed = JSON.parse(text);
  delete parsed.generatedAt;
  return JSON.stringify(parsed);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let rawText;
  let sourceLabel;
  if (args.from) {
    rawText = await readFile(args.from, 'utf8');
    sourceLabel = `local:${path.basename(args.from)}`;
  } else {
    process.stdout.write(`Fetching ${SOURCE_URL}\n`);
    const response = await fetch(SOURCE_URL);
    if (!response.ok) {
      throw new Error(`upstream fetch failed: ${response.status} ${response.statusText}`);
    }
    rawText = await response.text();
    sourceLabel = SOURCE_URL;
  }

  let previousCount = null;
  if (existsSync(args.out)) {
    try {
      const previous = JSON.parse(await readFile(args.out, 'utf8'));
      previousCount = previous.templates.reduce(
        (total, [, tiers]) => total + tiers.reduce((sum, [, enchs]) => sum + enchs.length, 0),
        0,
      );
    } catch {
      previousCount = null; // unreadable/absent previous build is not itself an error
    }
  }

  const result = build(JSON.parse(rawText), sourceLabel);
  const ratios = assertSane(result, previousCount);

  const text = serialize(result.payload, new Date().toISOString());
  const sizeKb = Buffer.byteLength(text) / 1024;

  if (args.check) {
    if (!existsSync(args.out)) {
      console.error(`--check: ${args.out} does not exist`);
      process.exit(1);
    }
    const committed = await readFile(args.out, 'utf8');
    if (comparable(committed) !== comparable(text)) {
      console.error(`--check: ${path.relative(process.cwd(), args.out)} is out of date.`);
      console.error('  Regenerate with: node scripts/build-catalog.mjs');
      process.exit(1);
    }
    console.log(`--check: catalog is up to date (${result.stats.kept} entries).`);
    return;
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, text, 'utf8');

  console.log(`Wrote ${path.relative(process.cwd(), args.out)}`);
  console.log(`  entries    ${result.stats.kept}`);
  console.log(`  templates  ${result.stats.templateCount}`);
  console.log(`  english    ${(ratios.englishRatio * 100).toFixed(1)}%`);
  console.log(`  rank-title ${(ratios.titledRatio * 100).toFixed(1)}% of tier-4+ equipment`);
  console.log(`  size       ${sizeKb.toFixed(0)} KB`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
