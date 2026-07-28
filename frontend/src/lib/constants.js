// Static domain data, ported from the original Python backend (backend/app_core.py).
//
// Field names deliberately stay snake_case rather than switching to JS camelCase: these
// objects ARE the payload shape that app.js consumes (it reads `unique_name`,
// `slot_label`, `two_handed`, ...), and keeping one convention across internal and
// serialized data made the port mechanical instead of a rename-everything exercise.
//
// The localized-name blocks below were generated from the Python source at port time to
// guarantee an exact transcription; they are hand-maintained from here on.


export const LANGUAGES = Object.freeze([
  "en",
  "de",
  "fr",
  "pt",
  "es",
  "ru",
  "zh",
  "ko"
]);

// Key order drives the region <select> build order in app.js.
export const REGIONS = Object.freeze({
  "americas": {
    "label": "Americas",
    "host": "https://west.albion-online-data.com",
    "cities": [
      "Bridgewatch",
      "Caerleon",
      "FortSterling",
      "Lymhurst",
      "Martlock",
      "Thetford",
      "Brecilien"
    ]
  },
  "asia": {
    "label": "Asia",
    "host": "https://east.albion-online-data.com",
    "cities": [
      "Bridgewatch",
      "Caerleon",
      "FortSterling",
      "Lymhurst",
      "Martlock",
      "Thetford",
      "Brecilien"
    ]
  },
  "europe": {
    "label": "Europe",
    "host": "https://europe.albion-online-data.com",
    "cities": [
      "Bridgewatch",
      "Caerleon",
      "FortSterling",
      "Lymhurst",
      "Martlock",
      "Thetford",
      "Brecilien"
    ]
  }
});

// Order is load-bearing: app.js auto-selects slots[0] on boot and finds the "next empty
// slot" by array position.
export const SLOTS = Object.freeze([
  "head",
  "chest",
  "feet",
  "main_hand",
  "off_hand",
  "cape",
  "bag",
  "mount",
  "food",
  "potion"
]);

// Food and potions are only ever listed on the market at Normal quality - the game has no
// higher-quality consumables, unlike gear. Requesting a "qualities=2,3,4,5" floor for them
// (as the minimum-quality filter does for everything else) would always return zero rows,
// not a narrower result, so pricing code must query these slots at their own floor of 1
// regardless of the user's selected minimum quality.
export const SLOTS_WITHOUT_QUALITY = Object.freeze(["food", "potion"]);

export const SLOT_LABELS = Object.freeze({
  "head": "Head",
  "chest": "Chest",
  "feet": "Feet",
  "main_hand": "Main Hand",
  "off_hand": "Off-Hand",
  "cape": "Cape",
  "bag": "Bag",
  "mount": "Mount",
  "food": "Food",
  "potion": "Potion"
});

// Only de/fr/es are genuinely translated; the rest intentionally alias the English
// labels, exactly as the Python source did.
export const LOCALIZED_SLOT_LABELS = Object.freeze({
  en: SLOT_LABELS,
  de: Object.freeze({
    "head": "Kopf",
    "chest": "Brust",
    "feet": "Füße",
    "main_hand": "Haupthand",
    "off_hand": "Nebenhand",
    "cape": "Umhang",
    "bag": "Tasche",
    "mount": "Reittier",
    "food": "Essen",
    "potion": "Trank"
  }),
  fr: Object.freeze({
    "head": "Tête",
    "chest": "Torse",
    "feet": "Pieds",
    "main_hand": "Main principale",
    "off_hand": "Main secondaire",
    "cape": "Cape",
    "bag": "Sac",
    "mount": "Monture",
    "food": "Nourriture",
    "potion": "Potion"
  }),
  pt: SLOT_LABELS,
  es: Object.freeze({
    "head": "Cabeza",
    "chest": "Pecho",
    "feet": "Pies",
    "main_hand": "Mano principal",
    "off_hand": "Mano secundaria",
    "cape": "Capa",
    "bag": "Bolsa",
    "mount": "Montura",
    "food": "Comida",
    "potion": "Poción"
  }),
  ru: SLOT_LABELS,
  zh: SLOT_LABELS,
  ko: SLOT_LABELS,
});

// A Map, not an object: the Python source keys these by integer, and JS object keys
// would silently coerce to strings.
export const QUALITY_LABELS = new Map([
  [1, "Normal"],
  [2, "Good"],
  [3, "Outstanding"],
  [4, "Excellent"],
  [5, "Masterpiece"],
]);

export function qualityLabel(quality) {
  return QUALITY_LABELS.get(quality) || 'Normal';
}

// ao-bin-dumps UniqueName templates always start with a category token right after the
// tier (e.g. "T4_MAIN_SWORD", "T4_ARTEFACT_2H_BOW_HELL"). Matching that token is far more
// reliable than scanning localized names: the formatted items.json ships no slot/category
// field, and free-text matching across ~15 languages produces false positives (Polish
// "Debowe" normalizes to contain "bow", matching raw wood as bows; "ARTEFACT_2H_FIRESTAFF_HELL"
// is a crafting resource, not an equipable staff). This is an allowlist on purpose -
// crafting resources, quest items, journals, vanity unlocks, loot chests, farm goods and
// tokens are all excluded by default.
export const TEMPLATE_PREFIX_SLOTS = Object.freeze({
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
  "POTION": "potion"
});

// The original hand-authored fallback catalog. It is NOT dead weight: 14 of these
// templates (HEAD_PLATE, MAIN_BOW, FOOD, POTION, MOUNT, OFF_TOME, the CHEST_*/FEET_*
// families...) have no counterpart in the external ao-bin-dumps catalog, and are the only
// definition source for loadout presets saved to localStorage before the external catalog
// existed. Externally-derived definitions still win the merge where both exist - see
// buildDefinitions() in catalog.js.
export const FALLBACK_DEFINITIONS = Object.freeze([
  {
    "template": "ARMOR_CLOTH_SET2",
    "slot": "chest",
    "group": "ARMOR",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Cleric Robe",
      "de": "Klerikerrobe",
      "fr": "Robe de clerc",
      "pt": "Veste de Clérigo",
      "es": "Túnica de clérigo",
      "ru": "Ряса клирика",
      "zh": "牧师长袍",
      "ko": "성직자 로브"
    }
  },
  {
    "template": "ARMOR_CLOTH_ROYAL",
    "slot": "chest",
    "group": "ARMOR",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Royal Robe",
      "de": "Königsrobe",
      "fr": "Robe royale",
      "pt": "Veste Real",
      "es": "Túnica real",
      "ru": "Королевская мантия",
      "zh": "皇家长袍",
      "ko": "로열 로브"
    }
  },
  {
    "template": "ARMOR_LEATHER_ROYAL",
    "slot": "chest",
    "group": "ARMOR",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Royal Jacket",
      "de": "Königsjacke",
      "fr": "Veste royale",
      "pt": "Jaqueta Real",
      "es": "Chaqueta real",
      "ru": "Королевская куртка",
      "zh": "皇家夹克",
      "ko": "로열 재킷"
    }
  },
  {
    "template": "HEAD_PLATE",
    "slot": "head",
    "group": "HEAD",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Soldier Helmet",
      "de": "Soldatenhelm",
      "fr": "Casque de soldat",
      "pt": "Elmo de Soldado",
      "es": "Yelmo de soldado",
      "ru": "Шлем солдата",
      "zh": "士兵头盔",
      "ko": "병사 투구"
    }
  },
  {
    "template": "HEAD_LEATHER",
    "slot": "head",
    "group": "HEAD",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Hunter Hood",
      "de": "Jägerkapuze",
      "fr": "Capuche de chasseur",
      "pt": "Capuz de Caçador",
      "es": "Capucha de cazador",
      "ru": "Капюшон охотника",
      "zh": "猎人兜帽",
      "ko": "사냥꾼 두건"
    }
  },
  {
    "template": "HEAD_CLOTH",
    "slot": "head",
    "group": "HEAD",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Mage Cowl",
      "de": "Magierkapuze",
      "fr": "Capuche de mage",
      "pt": "Capuz de Mago",
      "es": "Capucha de mago",
      "ru": "Капюшон мага",
      "zh": "法师兜帽",
      "ko": "마법사 두건"
    }
  },
  {
    "template": "CHEST_PLATE",
    "slot": "chest",
    "group": "CHEST",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Soldier Armor",
      "de": "Soldatenrüstung",
      "fr": "Armure de soldat",
      "pt": "Armadura de Soldado",
      "es": "Armadura de soldado",
      "ru": "Доспех солдата",
      "zh": "士兵护甲",
      "ko": "병사 갑옷"
    }
  },
  {
    "template": "CHEST_LEATHER",
    "slot": "chest",
    "group": "CHEST",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Mercenary Jacket",
      "de": "Söldnerjacke",
      "fr": "Veste de mercenaire",
      "pt": "Jaqueta de Mercenário",
      "es": "Chaqueta de mercenario",
      "ru": "Куртка наемника",
      "zh": "雇佣兵夹克",
      "ko": "용병 재킷"
    }
  },
  {
    "template": "CHEST_CLOTH",
    "slot": "chest",
    "group": "CHEST",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Scholar Robe",
      "de": "Gelehrtentoga",
      "fr": "Robe d'érudit",
      "pt": "Veste de Estudioso",
      "es": "Túnica de erudito",
      "ru": "Мантия ученого",
      "zh": "学者长袍",
      "ko": "학자 로브"
    }
  },
  {
    "template": "FEET_PLATE",
    "slot": "feet",
    "group": "FEET",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Soldier Boots",
      "de": "Soldatenstiefel",
      "fr": "Bottes de soldat",
      "pt": "Botas de Soldado",
      "es": "Botas de soldado",
      "ru": "Сапоги солдата",
      "zh": "士兵靴",
      "ko": "병사 장화"
    }
  },
  {
    "template": "FEET_LEATHER",
    "slot": "feet",
    "group": "FEET",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Hunter Shoes",
      "de": "Jägerschuhe",
      "fr": "Chaussures de chasseur",
      "pt": "Sapatos de Caçador",
      "es": "Zapatos de cazador",
      "ru": "Ботинки охотника",
      "zh": "猎人鞋",
      "ko": "사냥꾼 신발"
    }
  },
  {
    "template": "FEET_CLOTH",
    "slot": "feet",
    "group": "FEET",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Scholar Sandals",
      "de": "Gelehrtensandalen",
      "fr": "Sandales d'érudit",
      "pt": "Sandálias de Estudioso",
      "es": "Sandalias de erudito",
      "ru": "Сандалии ученого",
      "zh": "学者凉鞋",
      "ko": "학자 샌들"
    }
  },
  {
    "template": "MAIN_SWORD",
    "slot": "main_hand",
    "group": "MAIN",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Sword",
      "de": "Schwert",
      "fr": "Épée",
      "pt": "Espada",
      "es": "Espada",
      "ru": "Меч",
      "zh": "长剑",
      "ko": "검"
    }
  },
  {
    "template": "MAIN_BOW",
    "slot": "main_hand",
    "group": "MAIN",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": true,
    "localized_names": {
      "en": "Bow",
      "de": "Bogen",
      "fr": "Arc",
      "pt": "Arco",
      "es": "Arco",
      "ru": "Лук",
      "zh": "弓",
      "ko": "활"
    }
  },
  {
    "template": "MAIN_FIRESTAFF",
    "slot": "main_hand",
    "group": "MAIN",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": true,
    "localized_names": {
      "en": "Fire Staff",
      "de": "Feuerstab",
      "fr": "Bâton de feu",
      "pt": "Cajado de Fogo",
      "es": "Bastón de Fuego",
      "ru": "Посох огня",
      "zh": "火焰法杖",
      "ko": "화염 지팡이"
    }
  },
  {
    "template": "MAIN_HAMMER",
    "slot": "main_hand",
    "group": "MAIN",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": true,
    "localized_names": {
      "en": "Hammer",
      "de": "Hammer",
      "fr": "Marteau",
      "pt": "Martelo",
      "es": "Martillo",
      "ru": "Молот",
      "zh": "锤",
      "ko": "망치"
    }
  },
  {
    "template": "OFF_SHIELD",
    "slot": "off_hand",
    "group": "OFF",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Shield",
      "de": "Schild",
      "fr": "Bouclier",
      "pt": "Escudo",
      "es": "Escudo",
      "ru": "Щит",
      "zh": "盾牌",
      "ko": "방패"
    }
  },
  {
    "template": "OFF_TORCH",
    "slot": "off_hand",
    "group": "OFF",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Torch",
      "de": "Fackel",
      "fr": "Torche",
      "pt": "Tocha",
      "es": "Antorcha",
      "ru": "Факел",
      "zh": "火把",
      "ko": "횃불"
    }
  },
  {
    "template": "OFF_TOME",
    "slot": "off_hand",
    "group": "OFF",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Tome",
      "de": "Buch",
      "fr": "Grimoire",
      "pt": "Tomo",
      "es": "Tomo",
      "ru": "Том",
      "zh": "书卷",
      "ko": "서책"
    }
  },
  {
    "template": "CAPE",
    "slot": "cape",
    "group": "CAPE",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Cape",
      "de": "Umhang",
      "fr": "Cape",
      "pt": "Manto",
      "es": "Capa",
      "ru": "Плащ",
      "zh": "披风",
      "ko": "망토"
    }
  },
  {
    "template": "BAG",
    "slot": "bag",
    "group": "BAG",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Bag",
      "de": "Tasche",
      "fr": "Sac",
      "pt": "Bolsa",
      "es": "Bolsa",
      "ru": "Сумка",
      "zh": "包",
      "ko": "가방"
    }
  },
  {
    "template": "MOUNT",
    "slot": "mount",
    "group": "MOUNT",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Horse",
      "de": "Pferd",
      "fr": "Cheval",
      "pt": "Cavalo",
      "es": "Caballo",
      "ru": "Лошадь",
      "zh": "马匹",
      "ko": "말"
    }
  },
  {
    "template": "FOOD",
    "slot": "food",
    "group": "FOOD",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Stew",
      "de": "Eintopf",
      "fr": "Ragoût",
      "pt": "Ensopado",
      "es": "Estofado",
      "ru": "Рагу",
      "zh": "炖菜",
      "ko": "스튜"
    }
  },
  {
    "template": "POTION",
    "slot": "potion",
    "group": "POTION",
    "min_tier": 4,
    "max_tier": 8,
    "max_enchantment": 4,
    "two_handed": false,
    "localized_names": {
      "en": "Healing Potion",
      "de": "Heiltrank",
      "fr": "Potion de soin",
      "pt": "Poção de Cura",
      "es": "Poción de curación",
      "ru": "Зелье лечения",
      "zh": "治疗药水",
      "ko": "치유 물약"
    }
  }
]);

/** Localized label for a loadout slot, falling back to English and then the raw key. */
export function slotLabel(slot, language = 'en') {
  const labels = LOCALIZED_SLOT_LABELS[String(language).toLowerCase()] || SLOT_LABELS;
  return labels[slot] || slot;
}

