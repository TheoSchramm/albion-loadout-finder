"""Dump golden fixtures capturing the Python implementation's exact behavior.

These files are the spec the JavaScript port is checked against. They pin behavior
*as it is today, bugs included* - notably the ASCII-only `normalize_text`, which makes
non-Latin queries match everything (see the `normalize` cases in search.json). Fixing
that is a deliberate, separate step; the port itself must reproduce it, otherwise a
parity mismatch is ambiguous between "porting mistake" and "intended fix".

Run from the repo root:

    python -m backend.tools.dump_golden

Output is deterministic - running twice produces byte-identical files. Nothing here
touches the network: `fetch_prices` and `_fetch_price_batch` are stubbed so the
optimizer and batching fixtures are reproducible offline.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

from backend import app_core
from backend.app_core import (
    EXTERNAL_SEARCH_ENTRIES,
    build_config_payload,
    build_variant,
    equivalent_variants,
    find_definition,
    item_image_url,
    optimize_loadout_with_cities,
    price_query_url,
    search_items,
)

GOLDEN_DIR = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "golden"

# Queries chosen to exercise: plain English, multi-word, an excluded gathering tool,
# other-language names, the accent-mangling bug ('Épée' normalizes to 'pe'), the
# non-Latin bug (normalizes to '' and therefore matches everything), the tier.enchant
# hint parser, a raw unique name, empty, and a guaranteed miss.
QUERIES = [
    "sword",
    "hunter hood",
    "pickaxe",
    "Espada",
    "Bogen",
    "Épée",
    "меч",
    "牛肉",
    "검",
    "stew",
    "4.2",
    "@3",
    "T6_MAIN_SWORD",
    "",
    "zzzz",
    "меч4.2",
    "Épée4.2",
    "shoes",
    "cape",
    "bag",
]

LANGUAGES = ["en", "de", "fr", "pt", "es", "ru", "zh", "ko"]

SLOTS = [
    None,
    "head",
    "chest",
    "feet",
    "main_hand",
    "off_hand",
    "cape",
    "bag",
    "mount",
    "food",
    "potion",
]

# (template, tier, enchantment, language) combinations covering every correctness fix
# the Python test suite protects.
ITEM_CASES = [
    ("MEAL_STEW", 4, 0, "en"),          # per-tier identity: Goat Stew
    ("MEAL_STEW", 6, 0, "en"),          # ... Mutton Stew
    ("MEAL_STEW", 8, 0, "en"),          # ... Beef Stew (must not display as Goat Stew)
    ("MEAL_STEW", 8, 0, "de"),
    ("SHOES_LEATHER_SET2", 4, 2, "en"),  # rank title reconstructed for market alias
    ("SHOES_LEATHER_SET2", 4, 2, "ru"),
    ("HEAD_LEATHER_SET2", 4, 0, "en"),
    ("HEAD_LEATHER_SET2", 4, 0, "es"),
    ("CAPE", 2, 0, "en"),               # tier < 4: never enchanted
    ("CAPE", 6, 3, "en"),
    ("MAIN_SWORD", 1, 0, "en"),         # external tier range wins over hardcoded min_tier=4
    ("MAIN_SWORD", 6, 2, "en"),         # '@' in the unique name -> image_url encoding
    ("MAIN_SWORD", 8, 4, "zh"),
    ("HEAD_PLATE", 5, 1, "en"),         # hardcoded-only template (no external counterpart)
    ("MAIN_BOW", 4, 0, "en"),           # hardcoded-only, two_handed
    ("FOOD", 4, 0, "en"),               # hardcoded-only
    ("POTION", 4, 0, "en"),             # hardcoded-only
    ("MOUNT", 4, 0, "en"),              # hardcoded-only
    ("2H_BOW", 6, 1, "en"),             # external two_handed
    ("ARMOR_CLOTH_SET2", 7, 3, "fr"),
]

EQUIVALENT_CASES = [
    ("MEAL_STEW", 8, 0),
    ("MEAL_STEW", 6, 0),
    ("CAPE", 6, 0),
    ("CAPE", 4, 2),
    ("MAIN_SWORD", 6, 0),
    ("MAIN_SWORD", 4, 2),
    ("MAIN_SWORD", 8, 4),
    ("SHOES_LEATHER_SET2", 5, 1),
    ("HEAD_PLATE", 6, 0),
    ("2H_BOW", 7, 2),
]

URL_CASES = [
    ("T4_MAIN_SWORD", "americas", ["Caerleon"]),
    ("T6_MAIN_SWORD@2", "americas", ["Caerleon", "Martlock"]),
    ("T8_ARMOR_PLATE_SET1@4", "asia", ["Bridgewatch", "FortSterling", "Lymhurst"]),
    ("T4_HEAD_LEATHER_SET2", "europe", ["Thetford", "Brecilien"]),
    # Duplicate cities must be de-duplicated (dict.fromkeys) while preserving order.
    ("T5_CAPE@1", "americas", ["Caerleon", "Caerleon", "Martlock"]),
    ("T4_MEAL_STEW", "europe", []),
]

OPTIMIZE_CASES = [
    {
        "name": "single_slot",
        "loadout": [{"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"}],
        "region": "americas",
        "language": "en",
        "cities": ["Caerleon", "Martlock"],
    },
    {
        "name": "multi_slot",
        "loadout": [
            {"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"},
            {"slot": "head", "unique_name": "T6_HEAD_LEATHER_SET2@0"},
            {"slot": "cape", "unique_name": "T5_CAPE@1"},
        ],
        "region": "americas",
        "language": "en",
        "cities": ["Caerleon", "Martlock", "Thetford"],
    },
    {
        "name": "localized",
        "loadout": [{"slot": "food", "unique_name": "T8_MEAL_STEW"}],
        "region": "europe",
        "language": "de",
        "cities": ["Caerleon"],
    },
    {
        "name": "unknown_template_skipped",
        "loadout": [
            {"slot": "main_hand", "unique_name": "T6_NOT_A_REAL_TEMPLATE"},
            {"slot": "head", "unique_name": "T6_HEAD_LEATHER_SET2@0"},
        ],
        "region": "americas",
        "language": "en",
        "cities": ["Caerleon"],
    },
]


def _canonical(payload: Any) -> str:
    """Stable serialization used for hashing - key order must not affect the digest."""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _write(name: str, payload: Any) -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    (GOLDEN_DIR / name).write_text(text, encoding="utf-8", newline="\n")
    print(f"  {name:24} {len(text.encode('utf-8')) / 1024:8.1f} KB")


def _synthetic_price_table(unique_names: list[str]) -> dict[str, dict[str, dict[str, int]]]:
    """A deterministic stand-in for live market data.

    Shaped to exercise the branches that live data would only hit by luck:
    - every 7th item has NO listings at all (candidate dropped; slot dropped if all are)
    - every 5th item is priced identically in two cities (pins the min() tie-break,
      which returns the *first* city in insertion order)
    - one city carries a zero price, which must be treated as "no listing"
    """
    cities = ["Caerleon", "Martlock", "Thetford", "Bridgewatch"]
    table: dict[str, dict[str, dict[str, int]]] = {}
    for index, unique_name in enumerate(sorted(unique_names)):
        if index % 7 == 6:
            table[unique_name] = {}
            continue
        entry: dict[str, dict[str, int]] = {}
        base = 1000 + (index * 137) % 90000
        for city_index, city in enumerate(cities):
            if index % 5 == 4 and city_index < 2:
                price = base  # deliberate tie between Caerleon and Martlock
            else:
                price = base + city_index * 311
            if index % 11 == 10 and city == "Bridgewatch":
                price = 0  # zero must be dropped, not recorded as a real listing
            entry[city] = {
                "sell_price_min": price,
                "quality": 1 + (index + city_index) % 5,
                "buy_price_max": 0,
                "updated_at": f"2026-07-{1 + (index % 28):02d}T{(index % 24):02d}:15:00",
                "fetched_at": 1753000000,
            }
        table[unique_name] = entry
    return table


def _candidate_names_for_cases() -> list[str]:
    """Every unique name the optimizer will look up across all OPTIMIZE_CASES."""
    names: list[str] = []
    for case in OPTIMIZE_CASES:
        for entry in case["loadout"]:
            try:
                tier, template, enchantment = app_core.parse_unique_name(entry["unique_name"])
            except ValueError:
                continue
            definition = find_definition(template)
            if definition is None:
                continue
            for candidate in equivalent_variants(build_variant(definition, tier, enchantment)):
                if candidate.unique_name not in names:
                    names.append(candidate.unique_name)
    return names


def dump_config() -> None:
    _write("config.json", build_config_payload())


def _narrow_localized_names(entry: dict[str, Any]) -> dict[str, Any]:
    """Keep only the 8 short language codes the app actually supports.

    The raw dump carries 15 locales, and `_localized_names_from_raw` adds 8 short-code
    aliases on top, giving every entry 23 keys. The shipped browser catalog only carries
    the 8, so the fixture narrows to match. Verified safe before narrowing: all 7,479
    entries have exactly 23 keys and a non-empty "en", so no entry is dropped and no
    `display_name` changes (the `next(iter(...))` fallback in `_external_search_entries`
    never fires). Nothing downstream reads a full-locale key - every lookup goes through
    a short code from LANGUAGES.
    """
    narrowed = dict(entry)
    names = entry.get("_localized_names") or {}
    narrowed["_localized_names"] = {code: names[code] for code in LANGUAGES if code in names}
    return narrowed


def dump_entries() -> None:
    """A digest plus a sample, rather than all 7,479 entries.

    The digest catches any drift at all; the sample makes a failure readable instead of
    just "hash mismatch". Committing the full list would add megabytes to the repo for
    no extra detection power.
    """
    entries = [_narrow_localized_names(entry) for entry in EXTERNAL_SEARCH_ENTRIES]
    digest = hashlib.sha256(_canonical(entries).encode("utf-8")).hexdigest()
    sample_indexes = list(range(0, len(entries), max(1, len(entries) // 150)))
    _write(
        "entries.json",
        {
            "count": len(entries),
            "sha256": digest,
            "first": entries[:5],
            "last": entries[-5:],
            "sample": {str(index): entries[index] for index in sample_indexes},
        },
    )


def dump_search() -> None:
    """Two layers: broad coverage of *ordering*, narrow coverage of *shape*.

    The full payload for every combination would be enormous, but result order is the
    fragile part (groups are ordered by catalog position and then truncated to 24), so
    the matrix records just the ordered unique_names.
    """
    matrix: dict[str, list[str]] = {}
    for query in QUERIES:
        for language in LANGUAGES:
            key = f"{query}|{language}|*"
            matrix[key] = [item["unique_name"] for item in search_items(query, language=language)]
        for slot in SLOTS:
            key = f"{query}|en|{slot or '*'}"
            matrix[key] = [
                item["unique_name"] for item in search_items(query, language="en", slot=slot)
            ]

    deep = {
        f"{query}|{language}|{slot or '*'}": search_items(query, language=language, slot=slot)
        for query, language, slot in [
            ("sword", "en", "main_hand"),
            ("hunter hood", "en", "head"),
            ("stew", "en", "food"),
            ("stew", "de", "food"),
            ("меч", "ru", "main_hand"),
            ("Épée", "fr", None),
            ("4.2", "en", "main_hand"),
            ("@3", "en", "cape"),
            ("T6_MAIN_SWORD", "en", None),
            ("", "en", "mount"),
            ("zzzz", "en", None),
            ("pickaxe", "en", "main_hand"),
        ]
    }
    _write("search.json", {"matrix": matrix, "deep": deep})


def dump_items() -> None:
    payloads = {}
    for template, tier, enchantment, language in ITEM_CASES:
        definition = find_definition(template)
        if definition is None:
            raise SystemExit(f"fixture error: template {template!r} has no definition")
        variant = build_variant(definition, tier, enchantment)
        payloads[f"{template}|{tier}|{enchantment}|{language}"] = app_core.serialize_variant(
            variant, language=language
        )
    _write("item.json", payloads)


def dump_equivalents() -> None:
    payloads = {}
    for template, tier, enchantment in EQUIVALENT_CASES:
        definition = find_definition(template)
        if definition is None:
            raise SystemExit(f"fixture error: template {template!r} has no definition")
        variant = build_variant(definition, tier, enchantment)
        key = f"{template}|{tier}|{enchantment}"
        payloads[key] = [candidate.unique_name for candidate in equivalent_variants(variant)]
    _write("equivalents.json", payloads)


def dump_urls() -> None:
    price_urls = {
        f"{unique_name}|{region}|{','.join(cities)}": price_query_url(unique_name, region, cities)
        for unique_name, region, cities in URL_CASES
    }
    image_urls = {
        f"{unique_name}|{quality}|{locale}": item_image_url(unique_name, quality, locale)
        for unique_name, quality, locale in [
            ("T4_MAIN_SWORD", 1, "en"),
            ("T6_MAIN_SWORD@2", 1, "en"),
            ("T8_ARMOR_PLATE_SET1@4", 3, "de"),
            ("T4_MEAL_STEW", 5, "zh"),
        ]
    }
    _write("urls.json", {"price_query_url": price_urls, "item_image_url": image_urls})


def dump_batches() -> None:
    """Pin the exact batch split points of fetch_prices.

    The projection at app_core.py:993 and the accumulation at :999 disagree slightly on
    when the separator counts, so the split indexes are not simply "every N names".
    Porting that asymmetry faithfully matters: it changes how many requests the client
    makes against a rate-limited API.
    """
    recorded: dict[str, list[list[str]]] = {}

    def record(case_name: str, names: list[str], cities: list[str]) -> None:
        batches: list[list[str]] = []

        def fake_batch(host, batch, batch_cities, region, accumulator):  # noqa: ANN001
            batches.append(list(batch))

        with patch.object(app_core, "_fetch_price_batch", side_effect=fake_batch):
            app_core.fetch_prices(names, region="americas", cities=cities)
        recorded[case_name] = batches

    record("short", [f"T4_MAIN_SWORD@{index % 5}" for index in range(10)], ["Caerleon"])
    record(
        "long_500",
        [f"T{4 + index % 5}_ARMOR_PLATE_SET{index}@{index % 5}" for index in range(500)],
        ["Caerleon", "Martlock"],
    )
    record(
        "duplicates_collapsed",
        ["T4_MAIN_SWORD", "T4_MAIN_SWORD", "T5_CAPE", "T4_MAIN_SWORD"],
        ["Caerleon", "Caerleon"],
    )
    _write("batches.json", recorded)


def dump_optimize() -> None:
    price_table = _synthetic_price_table(_candidate_names_for_cases())
    _write("prices.fixture.json", price_table)

    def stub_fetch_prices(unique_names, region, cities):  # noqa: ANN001
        return {name: price_table.get(name, {}) for name in dict.fromkeys(unique_names)}

    payloads = {}
    with patch.object(app_core, "fetch_prices", side_effect=stub_fetch_prices):
        for case in OPTIMIZE_CASES:
            payloads[case["name"]] = optimize_loadout_with_cities(
                loadout=case["loadout"],
                region=case["region"],
                language=case["language"],
                cities=case["cities"],
            )
    _write("optimize.json", {"cases": OPTIMIZE_CASES, "results": payloads})


def main() -> None:
    print(f"Writing golden fixtures to {GOLDEN_DIR}")
    dump_config()
    dump_entries()
    dump_search()
    dump_items()
    dump_equivalents()
    dump_urls()
    dump_batches()
    dump_optimize()
    print("Done.")


if __name__ == "__main__":
    main()
