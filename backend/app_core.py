from __future__ import annotations

import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable


LANGUAGES = ("en", "de", "fr", "pt", "es", "ru", "zh", "ko")
REGIONS = {
    "americas": {
        "label": "Americas",
        "host": "https://west.albion-online-data.com",
        "cities": ("Bridgewatch", "Caerleon", "FortSterling", "Lymhurst", "Martlock", "Thetford", "Brecilien"),
    },
    "asia": {
        "label": "Asia",
        "host": "https://east.albion-online-data.com",
        "cities": ("Bridgewatch", "Caerleon", "FortSterling", "Lymhurst", "Martlock", "Thetford","Brecilien"),
    },
    "europe": {
        "label": "Europe",
        "host": "https://europe.albion-online-data.com",
        "cities": ("Bridgewatch", "Caerleon", "FortSterling", "Lymhurst", "Martlock", "Thetford","Brecilien"),
    },
}

SLOTS = (
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
)

SLOT_LABELS = {
    "head": "Head",
    "chest": "Chest",
    "feet": "Feet",
    "main_hand": "Main Hand",
    "off_hand": "Off-Hand",
    "cape": "Cape",
    "bag": "Bag",
    "mount": "Mount",
    "food": "Food",
    "potion": "Potion",
}

LOCALIZED_SLOT_LABELS = {
    "en": SLOT_LABELS,
    "de": {
        "head": "Kopf",
        "chest": "Brust",
        "feet": "Füße",
        "main_hand": "Haupthand",
        "off_hand": "Nebenhand",
        "cape": "Umhang",
        "bag": "Tasche",
        "mount": "Reittier",
        "food": "Essen",
        "potion": "Trank",
    },
    "fr": {
        "head": "Tête",
        "chest": "Torse",
        "feet": "Pieds",
        "main_hand": "Main principale",
        "off_hand": "Main secondaire",
        "cape": "Cape",
        "bag": "Sac",
        "mount": "Monture",
        "food": "Nourriture",
        "potion": "Potion",
    },
    "pt": SLOT_LABELS,
    "es": {
        "head": "Cabeza",
        "chest": "Pecho",
        "feet": "Pies",
        "main_hand": "Mano principal",
        "off_hand": "Mano secundaria",
        "cape": "Capa",
        "bag": "Bolsa",
        "mount": "Montura",
        "food": "Comida",
        "potion": "Poción",
    },
    "ru": SLOT_LABELS,
    "zh": SLOT_LABELS,
    "ko": SLOT_LABELS,
}

QUALITY_LABELS = {
    1: "Normal",
    2: "Good",
    3: "Outstanding",
    4: "Excellent",
    5: "Masterpiece",
}

BASE_LOCALIZED_NAMES = {
    "MAIN_SWORD": {
        "en": "Sword",
        "de": "Schwert",
        "fr": "Épée",
        "pt": "Espada",
        "es": "Espada",
        "ru": "Меч",
        "zh": "长剑",
        "ko": "검",
    },
    "MAIN_BOW": {
        "en": "Bow",
        "de": "Bogen",
        "fr": "Arc",
        "pt": "Arco",
        "es": "Arco",
        "ru": "Лук",
        "zh": "弓",
        "ko": "활",
    },
    "MAIN_FIRESTAFF": {
        "en": "Fire Staff",
        "de": "Feuerstab",
        "fr": "Bâton de feu",
        "pt": "Cajado de Fogo",
        "es": "Bastón de Fuego",
        "ru": "Посох огня",
        "zh": "火焰法杖",
        "ko": "화염 지팡이",
    },
    "MAIN_HAMMER": {
        "en": "Hammer",
        "de": "Hammer",
        "fr": "Marteau",
        "pt": "Martelo",
        "es": "Martillo",
        "ru": "Молот",
        "zh": "锤",
        "ko": "망치",
    },
    "OFF_SHIELD": {
        "en": "Shield",
        "de": "Schild",
        "fr": "Bouclier",
        "pt": "Escudo",
        "es": "Escudo",
        "ru": "Щит",
        "zh": "盾牌",
        "ko": "방패",
    },
    "OFF_TORCH": {
        "en": "Torch",
        "de": "Fackel",
        "fr": "Torche",
        "pt": "Tocha",
        "es": "Antorcha",
        "ru": "Факел",
        "zh": "火把",
        "ko": "횃불",
    },
    "OFF_TOME": {
        "en": "Tome",
        "de": "Buch",
        "fr": "Grimoire",
        "pt": "Tomo",
        "es": "Tomo",
        "ru": "Том",
        "zh": "书卷",
        "ko": "서책",
    },
    "HEAD_PLATE": {
        "en": "Soldier Helmet",
        "de": "Soldatenhelm",
        "fr": "Casque de soldat",
        "pt": "Elmo de Soldado",
        "es": "Yelmo de soldado",
        "ru": "Шлем солдата",
        "zh": "士兵头盔",
        "ko": "병사 투구",
    },
    "HEAD_LEATHER": {
        "en": "Hunter Hood",
        "de": "Jägerkapuze",
        "fr": "Capuche de chasseur",
        "pt": "Capuz de Caçador",
        "es": "Capucha de cazador",
        "ru": "Капюшон охотника",
        "zh": "猎人兜帽",
        "ko": "사냥꾼 두건",
    },
    "HEAD_CLOTH": {
        "en": "Mage Cowl",
        "de": "Magierkapuze",
        "fr": "Capuche de mage",
        "pt": "Capuz de Mago",
        "es": "Capucha de mago",
        "ru": "Капюшон мага",
        "zh": "法师兜帽",
        "ko": "마법사 두건",
    },
    "CHEST_PLATE": {
        "en": "Soldier Armor",
        "de": "Soldatenrüstung",
        "fr": "Armure de soldat",
        "pt": "Armadura de Soldado",
        "es": "Armadura de soldado",
        "ru": "Доспех солдата",
        "zh": "士兵护甲",
        "ko": "병사 갑옷",
    },
    "CHEST_LEATHER": {
        "en": "Mercenary Jacket",
        "de": "Söldnerjacke",
        "fr": "Veste de mercenaire",
        "pt": "Jaqueta de Mercenário",
        "es": "Chaqueta de mercenario",
        "ru": "Куртка наемника",
        "zh": "雇佣兵夹克",
        "ko": "용병 재킷",
    },
    "CHEST_CLOTH": {
        "en": "Scholar Robe",
        "de": "Gelehrtentoga",
        "fr": "Robe d'érudit",
        "pt": "Veste de Estudioso",
        "es": "Túnica de erudito",
        "ru": "Мантия ученого",
        "zh": "学者长袍",
        "ko": "학자 로브",
    },
    "FEET_PLATE": {
        "en": "Soldier Boots",
        "de": "Soldatenstiefel",
        "fr": "Bottes de soldat",
        "pt": "Botas de Soldado",
        "es": "Botas de soldado",
        "ru": "Сапоги солдата",
        "zh": "士兵靴",
        "ko": "병사 장화",
    },
    "FEET_LEATHER": {
        "en": "Hunter Shoes",
        "de": "Jägerschuhe",
        "fr": "Chaussures de chasseur",
        "pt": "Sapatos de Caçador",
        "es": "Zapatos de cazador",
        "ru": "Ботинки охотника",
        "zh": "猎人鞋",
        "ko": "사냥꾼 신발",
    },
    "FEET_CLOTH": {
        "en": "Scholar Sandals",
        "de": "Gelehrtensandalen",
        "fr": "Sandales d'érudit",
        "pt": "Sandálias de Estudioso",
        "es": "Sandalias de erudito",
        "ru": "Сандалии ученого",
        "zh": "学者凉鞋",
        "ko": "학자 샌들",
    },
    "CAPE": {
        "en": "Cape",
        "de": "Umhang",
        "fr": "Cape",
        "pt": "Manto",
        "es": "Capa",
        "ru": "Плащ",
        "zh": "披风",
        "ko": "망토",
    },
    "BAG": {
        "en": "Bag",
        "de": "Tasche",
        "fr": "Sac",
        "pt": "Bolsa",
        "es": "Bolsa",
        "ru": "Сумка",
        "zh": "包",
        "ko": "가방",
    },
    "MOUNT": {
        "en": "Horse",
        "de": "Pferd",
        "fr": "Cheval",
        "pt": "Cavalo",
        "es": "Caballo",
        "ru": "Лошадь",
        "zh": "马匹",
        "ko": "말",
    },
    "FOOD": {
        "en": "Stew",
        "de": "Eintopf",
        "fr": "Ragoût",
        "pt": "Ensopado",
        "es": "Estofado",
        "ru": "Рагу",
        "zh": "炖菜",
        "ko": "스튜",
    },
    "POTION": {
        "en": "Healing Potion",
        "de": "Heiltrank",
        "fr": "Potion de soin",
        "pt": "Poção de Cura",
        "es": "Poción de curación",
        "ru": "Зелье лечения",
        "zh": "治疗药水",
        "ko": "치유 물약",
    },
}

SPECIALIZED_LOCALIZED_NAMES = {
    "ARMOR_CLOTH_SET2": {
        "en": "Cleric Robe",
        "de": "Klerikerrobe",
        "fr": "Robe de clerc",
        "pt": "Veste de Clérigo",
        "es": "Túnica de clérigo",
        "ru": "Ряса клирика",
        "zh": "牧师长袍",
        "ko": "성직자 로브",
    },
    "ARMOR_CLOTH_ROYAL": {
        "en": "Royal Robe",
        "de": "Königsrobe",
        "fr": "Robe royale",
        "pt": "Veste Real",
        "es": "Túnica real",
        "ru": "Королевская мантия",
        "zh": "皇家长袍",
        "ko": "로열 로브",
    },
    "ARMOR_LEATHER_ROYAL": {
        "en": "Royal Jacket",
        "de": "Königsjacke",
        "fr": "Veste royale",
        "pt": "Jaqueta Real",
        "es": "Chaqueta real",
        "ru": "Королевская куртка",
        "zh": "皇家夹克",
        "ko": "로열 재킷",
    },
}


@dataclass(frozen=True)
class ItemDefinition:
    template: str
    slot: str
    group: str
    min_tier: int
    max_tier: int
    max_enchantment: int
    two_handed: bool = False
    min_quality: int = 1
    max_quality: int = 5
    localized_names: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ItemVariant:
    unique_name: str
    template: str
    slot: str
    group: str
    tier: int
    enchantment: int
    quality: int = 1
    two_handed: bool = False
    localized_names: dict[str, str] = field(default_factory=dict)

    @property
    def equivalent_level(self) -> int:
        return self.tier + self.enchantment


def _base_catalog() -> list[ItemDefinition]:
    catalog: list[ItemDefinition] = []
    for slot, group_templates in (
        ("head", ("HEAD_PLATE", "HEAD_LEATHER", "HEAD_CLOTH")),
        ("chest", ("CHEST_PLATE", "CHEST_LEATHER", "CHEST_CLOTH")),
        ("feet", ("FEET_PLATE", "FEET_LEATHER", "FEET_CLOTH")),
        ("main_hand", ("MAIN_SWORD", "MAIN_BOW", "MAIN_FIRESTAFF", "MAIN_HAMMER")),
        ("off_hand", ("OFF_SHIELD", "OFF_TORCH", "OFF_TOME")),
        ("cape", ("CAPE",)),
        ("bag", ("BAG",)),
        ("mount", ("MOUNT",)),
        ("food", ("FOOD",)),
        ("potion", ("POTION",)),
    ):
        for template in group_templates:
            names = BASE_LOCALIZED_NAMES[template]
            catalog.append(
                ItemDefinition(
                    template=template,
                    slot=slot,
                    group=template.split("_", 1)[0],
                    min_tier=4,
                    max_tier=8,
                    max_enchantment=4,
                    two_handed=template in {"MAIN_BOW", "MAIN_FIRESTAFF", "MAIN_HAMMER"},
                    localized_names=names,
                )
            )
    return catalog


def _specialized_catalog() -> list[ItemDefinition]:
    return [
        ItemDefinition(
            template="ARMOR_CLOTH_SET2",
            slot="chest",
            group="ARMOR",
            min_tier=4,
            max_tier=8,
            max_enchantment=4,
            localized_names=SPECIALIZED_LOCALIZED_NAMES["ARMOR_CLOTH_SET2"],
        ),
        ItemDefinition(
            template="ARMOR_CLOTH_ROYAL",
            slot="chest",
            group="ARMOR",
            min_tier=4,
            max_tier=8,
            max_enchantment=4,
            localized_names=SPECIALIZED_LOCALIZED_NAMES["ARMOR_CLOTH_ROYAL"],
        ),
        ItemDefinition(
            template="ARMOR_LEATHER_ROYAL",
            slot="chest",
            group="ARMOR",
            min_tier=4,
            max_tier=8,
            max_enchantment=4,
            localized_names=SPECIALIZED_LOCALIZED_NAMES["ARMOR_LEATHER_ROYAL"],
        ),
    ]


ITEM_DEFINITIONS = _specialized_catalog() + _base_catalog()


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


_TIER_TITLE_PATTERN = re.compile(
    r"^(?:Beginner|Novice|Journeyman|Adept|Expert|Master|Grandmaster|Elder)'s\s+",
    re.IGNORECASE,
)


def strip_tier_title(name: str) -> str:
    """Strip the tier-rank title (e.g. "Adept's", "Master's") the game bakes into item
    names, so items of the same template group under one name regardless of tier."""
    stripped = _TIER_TITLE_PATTERN.sub("", name).strip()
    return stripped or name


def format_unique_name(template: str, tier: int, enchantment: int) -> str:
    base = f"T{tier}_{template}"
    return base if enchantment == 0 else f"{base}@{enchantment}"


def parse_unique_name(unique_name: str) -> tuple[int, str, int]:
    match = re.fullmatch(r"T(\d+)_(.+?)(?:@(\d+))?", unique_name)
    if not match:
        raise ValueError(f"Unsupported unique name: {unique_name}")
    return int(match.group(1)), match.group(2), int(match.group(3) or 0)


def localized_name(definition: ItemDefinition | ItemVariant, language: str) -> str:
    language_key = language.lower()
    if isinstance(definition, ItemVariant):
        # ItemDefinition.localized_names holds one name per template, which is
        # wrong for templates that rename per tier (see TEMPLATE_TIER_LOCALIZED_NAMES) -
        # prefer the exact name for this variant's own tier when we have it.
        tier_names = TEMPLATE_TIER_LOCALIZED_NAMES.get((definition.template, definition.tier))
        if tier_names:
            return tier_names.get(language_key) or tier_names.get("en") or definition.template
    return definition.localized_names.get(language_key) or definition.localized_names.get("en") or definition.template


def build_variant(definition: ItemDefinition, tier: int, enchantment: int, quality: int = 1) -> ItemVariant:
    return ItemVariant(
        unique_name=format_unique_name(definition.template, tier, enchantment),
        template=definition.template,
        slot=definition.slot,
        group=definition.group,
        tier=tier,
        enchantment=enchantment,
        quality=quality,
        two_handed=definition.two_handed,
        localized_names=definition.localized_names,
    )


@lru_cache(maxsize=1)
def load_external_catalog() -> list[dict[str, Any]]:
    cache_dir = Path(__file__).resolve().parent / "cache"
    cache_file = cache_dir / "items.json"
    source_url = "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/refs/heads/master/formatted/items.json"
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    request = urllib.request.Request(source_url, headers={"User-Agent": "albion-helper/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(payload), encoding="utf-8")
            return payload
    except Exception:
        return []


def _first_value(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return value
    return None


_LANGUAGE_LOCALE_ALIASES = {
    "en": "en-us",
    "de": "de-de",
    "fr": "fr-fr",
    "pt": "pt-br",
    "es": "es-es",
    "ru": "ru-ru",
    "zh": "zh-cn",
    "ko": "ko-kr",
}


def _localized_names_from_raw(raw_item: dict[str, Any]) -> dict[str, str]:
    raw_names = _first_value(raw_item, "LocalizedNames", "localizedNames", "localized_names")
    if isinstance(raw_names, dict):
        normalized: dict[str, str] = {}
        for key, value in raw_names.items():
            if not isinstance(value, str) or not value:
                continue
            normalized[key.lower()] = value
        # The source data keys names by full locale (e.g. "de-de"); alias them to the
        # short codes this app's LANGUAGES/search use (e.g. "de") so non-English UI
        # languages actually resolve a translated name instead of silently falling back
        # to English.
        for short_code, locale_code in _LANGUAGE_LOCALE_ALIASES.items():
            if short_code not in normalized and locale_code in normalized:
                normalized[short_code] = normalized[locale_code]
        return normalized
    fallback_name = _first_value(raw_item, "LocalizedName", "localizedName", "DisplayName", "displayName", "Name", "name")
    if isinstance(fallback_name, str) and fallback_name:
        return {"en": fallback_name}
    return {}


def _external_unique_name(raw_item: dict[str, Any]) -> str | None:
    unique_name = _first_value(raw_item, "UniqueName", "uniqueName", "unique_name", "Id", "id")
    return unique_name if isinstance(unique_name, str) else None


# ao-bin-dumps UniqueName templates always start with a category token right after the
# tier (e.g. "T4_MAIN_SWORD", "T4_ARTEFACT_2H_BOW_HELL", "T4_LOOTBAG_..."). Matching on that
# token is far more reliable than scanning localized names: the formatted items.json ships no
# equipment-category/slot field, and free-text keyword matching across ~15 languages produces
# false positives (e.g. Polish "Dębowe" normalizes to contain "bow", matching raw wood/log
# resources as bows; "T4_ARTEFACT_2H_FIRESTAFF_HELL" is a crafting resource named "Burning Orb",
# not an equipable staff, despite containing "firestaff"). This is an allowlist on purpose:
# anything not explicitly equipment (crafting resources, quest items, journals, vanity unlocks,
# loot chests, farm goods, skill books, furniture, tokens...) is excluded by default.
_TEMPLATE_PREFIX_SLOTS = {
    "MAIN": "main_hand",
    "2H": "main_hand",
    "OFF": "off_hand",
    "HEAD": "head",
    "ARMOR": "chest",
    "SHOES": "feet",
    "BAG": "bag",
    "BACKPACK": "bag",
    "CAPE": "cape",
    "CAPEITEM": "cape",
    "MOUNT": "mount",
    "MEAL": "food",
    "POTION": "potion",
}


def _derive_slot_from_template(template: str) -> str | None:
    # Gathering/utility tools (pickaxe, lumberjack axe, sickle, skinning knife, tracking
    # toolkit, siege hammer, fishing rod) are equipped in the weapon slot in-game, so they
    # share the "2H_" prefix with real combat weapons - but the game distinguishes them with
    # a "TOOL_" segment right after it (e.g. "2H_TOOL_PICK" vs the combat "2H_AXE"). Exclude
    # them so weapon search doesn't surface gathering gear.
    if template.startswith("2H_TOOL_"):
        return None
    prefix = template.split("_", 1)[0]
    return _TEMPLATE_PREFIX_SLOTS.get(prefix)


def _slot_label(slot: str, language: str = "en") -> str:
    return LOCALIZED_SLOT_LABELS.get(language.lower(), SLOT_LABELS).get(slot, slot)


def item_image_url(unique_name: str, quality: int = 1, locale: str = "en") -> str:
    encoded_name = urllib.parse.quote(unique_name, safe="")
    return f"https://render.albiononline.com/v1/item/{encoded_name}.png?quality={quality}&locale={urllib.parse.quote(locale, safe='')}"


def _external_search_entries() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for raw_item in load_external_catalog():
        if not isinstance(raw_item, dict):
            continue
        unique_name = _external_unique_name(raw_item)
        if not unique_name:
            continue
        try:
            tier, template, enchantment = parse_unique_name(unique_name)
        except ValueError:
            continue
        localized_names = _localized_names_from_raw(raw_item)
        if not localized_names:
            continue
        slot = _derive_slot_from_template(template)
        if not slot:
            continue
        display_name = strip_tier_title(localized_names.get("en") or next(iter(localized_names.values()), template))
        entries.append(
            {
                "unique_name": unique_name,
                "template": template,
                "slot": slot,
                "slot_label": _slot_label(slot, "en"),
                "group": template.split("_", 1)[0],
                "tier": tier,
                "enchantment": enchantment,
                "quality": 1,
                "equivalent_level": tier + enchantment,
                "display_name": display_name,
                "english_name": strip_tier_title(localized_names.get("en") or display_name),
                "image_url": item_image_url(unique_name, 1, "en"),
                "two_handed": template.split("_", 1)[0] == "2H",
                "_localized_names": localized_names,
            }
        )
    return entries


def _external_display_name(item: dict[str, Any], language: str) -> str:
    localized_names = item.get("_localized_names")
    if isinstance(localized_names, dict):
        value = localized_names.get(language.lower()) or localized_names.get("en")
        if isinstance(value, str) and value:
            return strip_tier_title(value)
    value = item.get("display_name") or item.get("english_name")
    return strip_tier_title(value) if isinstance(value, str) else item.get("template", "")


def _requested_variant_hint(query: str) -> tuple[int | None, int | None]:
    match = re.search(r"\b(?:T)?(\d)\.(\d)\b", query, flags=re.IGNORECASE)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"@(\d)\b", query)
    if match:
        return None, int(match.group(1))
    return None, None


def _matches_query(labels: Iterable[str], normalized_query: str) -> bool:
    return not normalized_query or any(normalized_query in normalize_text(label) for label in labels)


def _group_search_results(
    candidates: Iterable[dict[str, Any]],
    query: str,
    slot: str | None,
    language: str,
    limit: int,
) -> list[dict[str, Any]]:
    normalized_query = normalize_text(query) if query else ""
    requested_tier, requested_enchantment = _requested_variant_hint(query)
    grouped: dict[tuple[str, str], dict[str, Any]] = {}

    for candidate in candidates:
        if slot and candidate["slot"] != slot:
            continue
        labels = [candidate["unique_name"], candidate["display_name"], candidate["english_name"]]
        if not _matches_query(labels, normalized_query):
            continue

        key = (candidate["slot"], candidate["template"])
        group = grouped.get(key)
        if group is None:
            group = {
                "template": candidate["template"],
                "slot": candidate["slot"],
                "slot_label": _slot_label(candidate["slot"], language),
                "group": candidate["group"],
                "variants": [],
                "_order": len(grouped),
            }
            grouped[key] = group
        group["variants"].append(candidate)

    ordered_groups = sorted(grouped.values(), key=lambda item: item["_order"])
    results: list[dict[str, Any]] = []

    for group in ordered_groups[:limit]:
        variants = sorted(group["variants"], key=lambda item: (item["tier"], item["enchantment"], item["quality"]))
        if requested_tier is not None:
            selected_variant = next((variant for variant in variants if variant["tier"] == requested_tier and (requested_enchantment is None or variant["enchantment"] == requested_enchantment)), None)
        else:
            selected_variant = next((variant for variant in variants if variant["enchantment"] == (requested_enchantment or 0)), None)
        if selected_variant is None:
            selected_variant = variants[0]

        results.append(
            {
                "template": group["template"],
                "slot": group["slot"],
                "slot_label": group["slot_label"],
                "group": group["group"],
                "display_name": selected_variant["display_name"],
                "english_name": selected_variant["english_name"],
                "image_url": selected_variant["image_url"],
                "unique_name": selected_variant["unique_name"],
                "tier": selected_variant["tier"],
                "enchantment": selected_variant["enchantment"],
                "quality": selected_variant["quality"],
                "equivalent_level": selected_variant["equivalent_level"],
                "two_handed": selected_variant["two_handed"],
                "variants": variants,
            }
        )

    return results


def all_variants() -> list[ItemVariant]:
    variants: list[ItemVariant] = []
    for definition in ITEM_DEFINITIONS:
        for tier in range(definition.min_tier, definition.max_tier + 1):
            for enchantment in range(0, definition.max_enchantment + 1):
                if tier == definition.min_tier and enchantment > 4:
                    continue
                variants.append(build_variant(definition, tier, enchantment))
    return variants


EXTERNAL_SEARCH_ENTRIES = _external_search_entries()
# ITEM_DEFINITIONS is a small hand-authored catalog with unique_names that don't exist in the
# real game (e.g. "T4_HEAD_LEATHER" isn't a tradeable item - the real one is
# "T4_HEAD_LEATHER_SET2"). It exists purely as an offline fallback for when the external
# ao-bin-dumps catalog can't be fetched. Surfacing it in search *alongside* real data produces
# confusing duplicates (same display name, one with real market prices, one with fabricated
# fallback prices) - so only include it when there's no real catalog to search instead.
ALL_VARIANTS = all_variants() if not EXTERNAL_SEARCH_ENTRIES else []


def _external_template_definitions() -> dict[str, ItemDefinition]:
    """Derive an ItemDefinition per external-catalog template, so equipment picked via
    search (the vast majority of real items) is recognized by the optimizer too, not just
    the small hardcoded ITEM_DEFINITIONS catalog."""
    grouped: dict[str, dict[str, Any]] = {}
    for entry in EXTERNAL_SEARCH_ENTRIES:
        template = entry["template"]
        info = grouped.setdefault(
            template,
            {
                "slot": entry["slot"],
                "min_tier": entry["tier"],
                "max_tier": entry["tier"],
                "two_handed": entry["two_handed"],
                "localized_names": {},
            },
        )
        info["min_tier"] = min(info["min_tier"], entry["tier"])
        info["max_tier"] = max(info["max_tier"], entry["tier"])
        for language, name in (entry.get("_localized_names") or {}).items():
            if language not in info["localized_names"]:
                info["localized_names"][language] = strip_tier_title(name)

    return {
        template: ItemDefinition(
            template=template,
            slot=info["slot"],
            group=template.split("_", 1)[0],
            min_tier=info["min_tier"],
            max_tier=info["max_tier"],
            max_enchantment=4,
            two_handed=info["two_handed"],
            localized_names=info["localized_names"],
        )
        for template, info in grouped.items()
    }


# Prefer the externally-derived definition (tier range grounded in the real
# ao-bin-dumps data) over the hardcoded ITEM_DEFINITIONS fallback catalog whenever
# a template exists in both - several hardcoded templates (CAPE, BAG, MAIN_SWORD,
# MOUNT, FOOD, POTION) reuse real in-game template names but hardcode min_tier=4,
# which is too narrow for items that actually go down to T1-T3 in the real game.
TEMPLATE_DEFINITIONS: dict[str, ItemDefinition] = {**{d.template: d for d in ITEM_DEFINITIONS}, **_external_template_definitions()}


def find_definition(template: str) -> ItemDefinition | None:
    return TEMPLATE_DEFINITIONS.get(template)


def _template_tier_localized_names() -> dict[tuple[str, int], dict[str, str]]:
    # Most equipment keeps the same name across every tier (only the "Adept's" /
    # "Master's" rank title changes, which is already stripped) - but some
    # templates, mainly food, use a genuinely different dish name per tier bracket
    # (T4_MEAL_STEW is "Goat Stew", T8_MEAL_STEW is "Beef Stew"). ItemDefinition
    # only stores one name per template, which is wrong for these - track the real
    # per-language name per (template, tier) instead, used both to keep
    # equivalent_variants() from treating differently-named tiers as substitutes
    # for each other, and so serialize_variant()/localized_name() display the
    # correct name for the specific tier being shown, not just tier 4's name.
    names: dict[tuple[str, int], dict[str, str]] = {}
    for entry in EXTERNAL_SEARCH_ENTRIES:
        key = (entry["template"], entry["tier"])
        if key in names:
            continue
        raw_names = entry.get("_localized_names") or {}
        names[key] = {language: strip_tier_title(name) for language, name in raw_names.items() if isinstance(name, str)}
    return names


TEMPLATE_TIER_LOCALIZED_NAMES: dict[tuple[str, int], dict[str, str]] = _template_tier_localized_names()


def _template_tier_raw_names() -> dict[tuple[str, int], dict[str, str]]:
    # Same idea as TEMPLATE_TIER_LOCALIZED_NAMES, but WITHOUT stripping the tier-rank
    # title ("Adept's", "Master's", ...) - needed to reconstruct the exact full name
    # the game itself displays for an item, e.g. for pasting into the in-game market
    # search ("Adept's Hunter Shoes"). Equipment has a title per tier; food/mounts/
    # etc. simply never had one, so this is a no-op for those.
    names: dict[tuple[str, int], dict[str, str]] = {}
    for entry in EXTERNAL_SEARCH_ENTRIES:
        key = (entry["template"], entry["tier"])
        if key in names:
            continue
        raw_names = entry.get("_localized_names") or {}
        names[key] = {language: name for language, name in raw_names.items() if isinstance(name, str)}
    return names


TEMPLATE_TIER_RAW_NAMES: dict[tuple[str, int], dict[str, str]] = _template_tier_raw_names()


def market_search_alias(variant: ItemVariant, language: str = "en") -> str:
    """The item's exact full in-game name plus its tier.enchantment, formatted for
    pasting straight into the in-game market search bar (e.g. "Adept's Hunter Shoes 4.2")."""
    language_key = language.lower()
    raw_names = TEMPLATE_TIER_RAW_NAMES.get((variant.template, variant.tier))
    full_name = None
    if raw_names:
        full_name = raw_names.get(language_key) or raw_names.get("en")
    if not full_name:
        full_name = localized_name(variant, language)
    return f"{full_name} {variant.tier}.{variant.enchantment}"


def search_items(query: str, language: str = "en", slot: str | None = None, limit: int = 24) -> list[dict[str, Any]]:
    language = language.lower()
    candidate_payloads: list[dict[str, Any]] = [serialize_variant(variant, language=language) for variant in ALL_VARIANTS]
    for item in EXTERNAL_SEARCH_ENTRIES:
        candidate_payloads.append(
            {
                "unique_name": item["unique_name"],
                "template": item["template"],
                "slot": item["slot"],
                "slot_label": _slot_label(item["slot"], language),
                "group": item["group"],
                "tier": item["tier"],
                "enchantment": item["enchantment"],
                "quality": item["quality"],
                "equivalent_level": item["equivalent_level"],
                "display_name": _external_display_name(item, language),
                "english_name": item["english_name"],
                "image_url": item["image_url"],
                "two_handed": item["two_handed"],
            }
        )
    return _group_search_results(candidate_payloads, query=query, slot=slot, language=language, limit=limit)


def serialize_variant(variant: ItemVariant, language: str = "en") -> dict[str, Any]:
    return {
        "unique_name": variant.unique_name,
        "template": variant.template,
        "slot": variant.slot,
        "slot_label": _slot_label(variant.slot, language),
        "group": variant.group,
        "tier": variant.tier,
        "enchantment": variant.enchantment,
        "quality": variant.quality,
        "equivalent_level": variant.equivalent_level,
        "display_name": localized_name(variant, language),
        "english_name": localized_name(variant, "en"),
        "image_url": item_image_url(variant.unique_name, variant.quality, "en"),
        "two_handed": variant.two_handed,
        "market_search_alias": market_search_alias(variant, language),
    }


def regions_payload() -> dict[str, Any]:
    return {
        key: {
            "key": key,
            "label": value["label"],
            "host": value["host"],
            "cities": list(value["cities"]),
        }
        for key, value in REGIONS.items()
    }


def cities_for_region(region: str) -> list[str]:
    return list(REGIONS.get(region, REGIONS["americas"])["cities"])


def region_host(region: str) -> str:
    return REGIONS.get(region, REGIONS["americas"])["host"]


def price_query_url(unique_name: str, region: str, cities: Iterable[str]) -> str:
    """The exact Albion Online Data Project request used to price this item, so a
    user can open it directly in the browser and inspect the raw JSON response."""
    host = region_host(region)
    city_list = list(dict.fromkeys(cities))
    encoded_item = urllib.parse.quote(unique_name, safe="")
    encoded_cities = urllib.parse.quote(",".join(city_list), safe=",")
    return f"{host}/api/v2/stats/prices/{encoded_item}.json?locations={encoded_cities}&qualities=1"


def equivalent_variants(item: ItemVariant) -> list[ItemVariant]:
    target_level = item.equivalent_level
    base_definition = find_definition(item.template)
    if base_definition is None:
        return [item]
    reference_name = TEMPLATE_TIER_LOCALIZED_NAMES.get((item.template, item.tier), {}).get("en")
    candidates: list[ItemVariant] = []
    for tier in range(base_definition.min_tier, base_definition.max_tier + 1):
        # Some templates (mainly food) use a different real item name per tier
        # bracket, or skip tiers entirely (e.g. MEAL_STEW only exists at T4/T6/T8,
        # not T5/T7) - those tiers are different items, not IP-scaled versions of
        # the same one, so only substitute tiers that share the item's actual name.
        if reference_name is not None and TEMPLATE_TIER_LOCALIZED_NAMES.get((item.template, tier), {}).get("en") != reference_name:
            continue
        # Only tier 4+ items can carry an enchantment (.1-.4) in Albion; tiers 1-3
        # only ever exist at enchantment 0, so synthesizing e.g. "T2_CAPE@4" would
        # price a variant that doesn't exist in the game.
        max_enchantment = base_definition.max_enchantment if tier >= 4 else 0
        enchantment = target_level - tier
        if 0 <= enchantment <= max_enchantment:
            candidates.append(build_variant(base_definition, tier, enchantment))
    if not candidates:
        candidates.append(item)
    return candidates


def fetch_prices(unique_names: Iterable[str], region: str, cities: Iterable[str]) -> dict[str, dict[str, dict[str, int]]]:
    host = region_host(region)
    unique_list = list(dict.fromkeys(unique_names))
    city_list = list(dict.fromkeys(cities))
    result: dict[str, dict[str, dict[str, int]]] = {name: {} for name in unique_list}
    max_url = 4096
    batch: list[str] = []
    batch_url_size = 0
    for unique_name in unique_list:
        token = urllib.parse.quote(unique_name)
        projected = batch_url_size + len(token) + (1 if batch else 0)
        if batch and projected > max_url:
            _fetch_price_batch(host, batch, city_list, region, result)
            batch = []
            batch_url_size = 0
        batch.append(unique_name)
        batch_url_size += len(token) + (1 if len(batch) > 1 else 0)
    if batch:
        _fetch_price_batch(host, batch, city_list, region, result)
    return result


def _fetch_price_batch(
    host: str,
    batch: list[str],
    cities: list[str],
    region: str,
    accumulator: dict[str, dict[str, dict[str, int]]],
) -> None:
    joined_items = ",".join(batch)
    joined_cities = ",".join(cities)
    url = (
        f"{host}/api/v2/stats/prices/{urllib.parse.quote(joined_items, safe=',')}.json"
        f"?locations={urllib.parse.quote(joined_cities, safe=',')}&qualities=1,2,3,4,5"
    )
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "albion-helper/1.0"})
        with urllib.request.urlopen(request, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        payload = []
    now = time.time()
    for unique_name in batch:
        accumulator.setdefault(unique_name, {})
    if isinstance(payload, list):
        for entry in payload:
            unique_name = entry.get("item_id")
            if unique_name not in accumulator:
                continue
            city = entry.get("city")
            if city not in cities:
                continue
            sell_price = int(entry.get("sell_price_min") or 0)
            if sell_price <= 0:
                # No real listing for this specific city/quality combination - skip it
                # rather than recording a fake price, so a cheaper quality/city elsewhere
                # in the response can still win.
                continue
            existing = accumulator[unique_name].get(city)
            if existing is not None and existing["sell_price_min"] <= sell_price:
                continue
            accumulator[unique_name][city] = {
                "sell_price_min": sell_price,
                "quality": int(entry.get("quality") or 1),
                "buy_price_max": int(entry.get("buy_price_max") or 0),
                "updated_at": entry.get("sell_price_min_date") or entry.get("buy_price_max_date") or "",
                "fetched_at": int(now),
            }
    # No fake price is synthesized when a unique_name has no real listing anywhere -
    # accumulator[unique_name] is simply left empty, and optimize_loadout_with_cities()
    # treats that as "no real market data" and omits it rather than showing a made-up
    # number as if it were a genuine price.


def optimize_loadout(loadout: list[dict[str, Any]], region: str = "americas", language: str = "en") -> dict[str, Any]:
    return optimize_loadout_with_cities(loadout=loadout, region=region, language=language, cities=None)


def optimize_loadout_with_cities(
    loadout: list[dict[str, Any]],
    region: str = "americas",
    language: str = "en",
    cities: Iterable[str] | None = None,
) -> dict[str, Any]:
    selected_variants: list[ItemVariant] = []
    for entry in loadout:
        unique_name = entry.get("unique_name") or entry.get("uniqueName") or ""
        if not unique_name:
            continue
        try:
            tier, template, enchantment = parse_unique_name(unique_name)
        except ValueError:
            continue
        definition = find_definition(template)
        if definition is None:
            continue
        selected_variants.append(build_variant(definition, tier, enchantment))

    if not selected_variants:
        return {
            "region": region,
            "language": language,
            "cities": list(cities) if cities else cities_for_region(region),
            "slots": [],
            "total_cost": 0,
        }

    selected_cities = list(cities) if cities else cities_for_region(region)
    price_map = fetch_prices(
        [variant.unique_name for variant in selected_variants for variant in equivalent_variants(variant)],
        region=region,
        cities=selected_cities,
    )

    slots: list[dict[str, Any]] = []
    total_cost = 0
    for variant in selected_variants:
        candidates = equivalent_variants(variant)
        candidate_payloads = []
        cheapest = None
        for candidate in candidates:
            city_prices = price_map.get(candidate.unique_name, {})
            if not city_prices:
                # No real listing anywhere for this specific tier/enchant - omit it
                # rather than showing a fabricated price for an item that isn't
                # actually for sale.
                continue
            best_city, best_data = min(city_prices.items(), key=lambda item: item[1]["sell_price_min"])
            best_price = best_data["sell_price_min"]
            best_quality = best_data.get("quality", 1)
            updated_at = best_data.get("updated_at", "")
            candidate_payloads.append(
                {
                    **serialize_variant(candidate, language=language),
                    "cheapest_city": best_city,
                    "cheapest_price": best_price,
                    "cheapest_quality": best_quality,
                    "cheapest_quality_label": QUALITY_LABELS.get(best_quality, "Normal"),
                    "updated_at": updated_at,
                    "api_url": price_query_url(candidate.unique_name, region, selected_cities),
                }
            )
            if cheapest is None or best_price < cheapest["cheapest_price"]:
                cheapest = candidate_payloads[-1]
        if cheapest is None:
            # None of this slot's equivalent tiers had any real market data - omit
            # the whole slot rather than reporting a made-up total.
            continue
        total_cost += cheapest["cheapest_price"]
        slots.append(
            {
                "selected": serialize_variant(variant, language=language),
                "candidates": sorted(candidate_payloads, key=lambda item: item["cheapest_price"]),
                "best": cheapest,
            }
        )

    return {
        "region": region,
        "language": language,
        "cities": selected_cities,
        "slots": slots,
        "total_cost": total_cost,
        "currency": "silver",
    }


def normalize_loadout_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    loadout = payload.get("loadout")
    if isinstance(loadout, list):
        return loadout
    slots = payload.get("slots")
    if isinstance(slots, dict):
        normalized: list[dict[str, Any]] = []
        for slot_name, value in slots.items():
            if isinstance(value, dict):
                value = {**value, "slot": slot_name}
                normalized.append(value)
        return normalized
    return []


def build_config_payload() -> dict[str, Any]:
    return {
        "languages": list(LANGUAGES),
        "regions": regions_payload(),
        "slots": [
            {
                "key": slot,
                "label": SLOT_LABELS[slot],
            }
            for slot in SLOTS
        ],
        "qualities": [
            {"value": quality, "label": QUALITY_LABELS[quality]}
            for quality in range(1, 6)
        ],
    }


def loadout_from_query(values: list[str]) -> list[dict[str, Any]]:
    loadout: list[dict[str, Any]] = []
    for value in values:
        if ":" not in value:
            continue
        slot, unique_name = value.split(":", 1)
        loadout.append({"slot": slot, "unique_name": unique_name})
    return loadout
