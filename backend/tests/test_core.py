import unittest
import urllib.parse
from unittest.mock import patch

from backend.app_core import (
    EXTERNAL_SEARCH_ENTRIES,
    build_config_payload,
    build_variant,
    equivalent_variants,
    find_definition,
    optimize_loadout,
    parse_unique_name,
    search_items,
    serialize_variant,
)
from backend.main import app


def _stub_fetch_prices(price=12345, quality=2, updated_at="2026-01-01T00:00:00"):
    """A deterministic stand-in for app_core.fetch_prices(). The optimizer's own
    logic (total_cost math, slot inclusion, field wiring) shouldn't depend on
    whatever happens to be listed on the real market right now - that live network
    dependency is exactly what made these tests flaky: they'd fail whenever a
    tested item genuinely had zero real listings, which is now correctly treated
    as "omit this slot" rather than a bug (see optimize_loadout_with_cities())."""

    def fetch_prices(unique_names, region, cities):
        city = next(iter(cities), "Caerleon")
        return {
            name: {
                city: {
                    "sell_price_min": price,
                    "quality": quality,
                    "buy_price_max": 0,
                    "updated_at": updated_at,
                    "fetched_at": 0,
                }
            }
            for name in unique_names
        }

    return fetch_prices


class CoreTests(unittest.TestCase):
    def test_parse_unique_name(self) -> None:
        self.assertEqual(parse_unique_name("T6_MAIN_SWORD@2"), (6, "MAIN_SWORD", 2))

    def test_search_items_by_language(self) -> None:
        results = search_items("Espada", language="es", slot="main_hand")
        self.assertTrue(results)
        self.assertEqual(results[0]["slot"], "main_hand")

    def test_optimize_loadout_returns_total_cost(self) -> None:
        loadout = [{"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"}]
        with patch("backend.app_core.fetch_prices", side_effect=_stub_fetch_prices()):
            optimized = optimize_loadout(loadout, region="americas", language="en")
        self.assertGreater(optimized["total_cost"], 0)
        self.assertTrue(optimized["slots"])

    def test_optimize_loadout_includes_price_timestamp(self) -> None:
        loadout = [{"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"}]
        with patch("backend.app_core.fetch_prices", side_effect=_stub_fetch_prices()):
            optimized = optimize_loadout(loadout, region="americas", language="en")
        best = optimized["slots"][0]["best"]
        self.assertEqual(best["updated_at"], "2026-01-01T00:00:00")

    def test_optimize_loadout_considers_all_qualities(self) -> None:
        loadout = [{"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"}]
        with patch("backend.app_core.fetch_prices", side_effect=_stub_fetch_prices(quality=2)):
            optimized = optimize_loadout(loadout, region="americas", language="en")
        best = optimized["slots"][0]["best"]
        self.assertEqual(best["cheapest_quality"], 2)
        self.assertEqual(best["cheapest_quality_label"], "Good")

    def test_optimize_loadout_includes_price_query_url(self) -> None:
        loadout = [{"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"}]
        with patch("backend.app_core.fetch_prices", side_effect=_stub_fetch_prices()):
            optimized = optimize_loadout(loadout, region="americas", language="en")
        best = optimized["slots"][0]["best"]
        self.assertIn("api_url", best)
        self.assertTrue(best["api_url"].startswith("https://west.albion-online-data.com/api/v2/stats/prices/"))
        self.assertIn(best["unique_name"], urllib.parse.unquote(best["api_url"]))

    def test_optimize_loadout_returns_every_slot(self) -> None:
        loadout = [
            {"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"},
            {"slot": "head", "unique_name": "T6_HEAD_PLATE_SET1@0"},
            {"slot": "chest", "unique_name": "T6_ARMOR_PLATE_SET1@0"},
        ]
        with patch("backend.app_core.fetch_prices", side_effect=_stub_fetch_prices()):
            optimized = optimize_loadout(loadout, region="americas", language="en")
        self.assertEqual({slot["selected"]["slot"] for slot in optimized["slots"]}, {"main_hand", "head", "chest"})

    def test_optimize_loadout_omits_slots_with_no_real_market_data(self) -> None:
        # The core behavior this change is about: never fabricate a price. A slot
        # with zero real listings anywhere must be left out of the response
        # entirely, not filled in with a made-up number.
        loadout = [{"slot": "main_hand", "unique_name": "T6_MAIN_SWORD@0"}]

        def empty_fetch_prices(unique_names, region, cities):
            return {name: {} for name in unique_names}

        with patch("backend.app_core.fetch_prices", side_effect=empty_fetch_prices):
            optimized = optimize_loadout(loadout, region="americas", language="en")
        self.assertEqual(optimized["slots"], [])
        self.assertEqual(optimized["total_cost"], 0)

    def test_config_has_regions_and_slots(self) -> None:
        config = build_config_payload()
        self.assertIn("regions", config)
        self.assertEqual(len(config["slots"]), 10)

    def test_search_excludes_non_equipable_items(self) -> None:
        unique_names = {entry["unique_name"] for entry in EXTERNAL_SEARCH_ENTRIES}
        self.assertFalse(any("ARTEFACT" in name for name in unique_names))

    def test_search_excludes_gathering_tools(self) -> None:
        templates = {entry["template"] for entry in EXTERNAL_SEARCH_ENTRIES}
        self.assertFalse(any(template.startswith("2H_TOOL_") for template in templates))
        results = search_items("pickaxe", language="en", slot="main_hand")
        self.assertEqual(results, [])

    def test_search_display_name_has_no_tier_title(self) -> None:
        results = search_items("sword", language="en", slot="main_hand")
        self.assertTrue(results)
        for result in results:
            self.assertNotIn("'s ", result["display_name"])

    def test_search_does_not_duplicate_hardcoded_catalog_against_real_data(self) -> None:
        # T4_HEAD_LEATHER is a synthetic unique_name from the offline-fallback catalog; the
        # real item is T4_HEAD_LEATHER_SET2. Both should not appear side by side when the
        # real (external) catalog is available.
        results = search_items("hunter hood", language="en", slot="head")
        unique_names = {result["unique_name"] for result in results}
        self.assertNotIn("T4_HEAD_LEATHER", unique_names)

    def test_market_search_alias_includes_full_prefix_and_tier(self) -> None:
        # The in-game market search needs the exact full name including the tier
        # rank title ("Adept's"), which display_name deliberately strips for grouping.
        definition = find_definition("SHOES_LEATHER_SET2")
        variant = build_variant(definition, 4, 2)
        payload = serialize_variant(variant, language="en")
        self.assertEqual(payload["market_search_alias"], "Adept's Hunter Shoes 4.2")

    def test_market_search_alias_has_no_fake_prefix_for_food(self) -> None:
        # Food never had a rank-title prefix in the game; the alias must not invent one.
        definition = find_definition("MEAL_STEW")
        variant = build_variant(definition, 8, 0)
        payload = serialize_variant(variant, language="en")
        self.assertEqual(payload["market_search_alias"], "Beef Stew 8.0")

    def test_equivalent_variants_never_enchant_below_tier_4(self) -> None:
        # Tiers 1-3 only ever exist at enchantment 0 in Albion; the optimizer must not
        # synthesize a fake item like "T2_CAPE@4" when expanding a high-level cape's
        # IP-equivalent candidates.
        definition = find_definition("CAPE")
        self.assertLess(definition.min_tier, 4)
        variant = build_variant(definition, 6, 0)
        candidates = equivalent_variants(variant)
        self.assertFalse(any(candidate.tier < 4 and candidate.enchantment != 0 for candidate in candidates))

    def test_external_tier_range_wins_over_hardcoded_catalog(self) -> None:
        # MAIN_SWORD is hardcoded with min_tier=4, but the real game has T1-T3 swords too;
        # the externally-derived (accurate) range must win the merge.
        definition = find_definition("MAIN_SWORD")
        self.assertEqual(definition.min_tier, 1)

    def test_equivalent_variants_respects_per_tier_item_identity(self) -> None:
        # MEAL_STEW is one crafting template, but T4/T6/T8 are different real dishes
        # ("Goat Stew", "Mutton Stew", "Beef Stew") - not IP-scaled versions of one
        # item. Picking Beef Stew (T8.0) must never surface Goat Stew as an "equivalent".
        definition = find_definition("MEAL_STEW")
        beef_stew = build_variant(definition, 8, 0)
        candidates = equivalent_variants(beef_stew)
        self.assertEqual([candidate.unique_name for candidate in candidates], ["T8_MEAL_STEW"])

    def test_serialize_variant_uses_correct_per_tier_name(self) -> None:
        # ItemDefinition only stores one localized name per template; T8_MEAL_STEW
        # must display as "Beef Stew", not the T4 template-level name "Goat Stew".
        definition = find_definition("MEAL_STEW")
        beef_stew = build_variant(definition, 8, 0)
        payload = serialize_variant(beef_stew, language="en")
        self.assertEqual(payload["display_name"], "Beef Stew")


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()

    def test_health_endpoint(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")
