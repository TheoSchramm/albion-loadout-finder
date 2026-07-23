# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A web app for Albion Online players: build a 10-slot equipment loadout, search items with multi-language
autocomplete, and compare live market prices across item-power-equivalent tier/enchantment variants to find
the cheapest way to hit a target IP.

The actual implementation is a lightweight **Flask + vanilla JS** app — not the Angular/TypeScript/FastAPI/Redis
stack an earlier draft of this file described. There's no `controllers/services/cache/utils` split; see the
real structure below.

## Directory Structure

```
backend/
  app_core.py     # All domain logic: item catalog, IP/tier math, search, price fetching, optimizer
  main.py         # Flask app: routes + static file serving for the built frontend
  cache/items.json  # Cached copy of ao-bin-dumps items.json (fetched on first run, reused after)
  tests/test_core.py
frontend/
  src/            # Source: app.js (vanilla JS, no framework/bundler), index.html, styles.css
  dist/           # Built output served by the backend (plain file copy of src/)
  scripts/build.mjs       # Copies src/ -> dist/ (no transpilation/bundling)
  scripts/dev-server.mjs  # Dev server on :5173, proxies /api/* to the Flask backend on :8000
DEPLOY.md         # Setup/run instructions
```

## Common Commands

```bash
# Backend
cd backend && python -m pip install -r requirements.txt
python -m backend.main              # run Flask dev server on http://127.0.0.1:8000 (from repo root)
python -m unittest backend.tests.test_core -v   # run backend tests

# Frontend
cd frontend
node scripts/build.mjs              # build src/ -> dist/ (rerun after editing frontend before restarting backend)
node scripts/dev-server.mjs         # serve src/ directly on :5173 with API proxy to :8000, for live editing
```

There's no bundler, TypeScript compiler, or real lint tooling — `frontend/scripts/lint.mjs` (run via
`npm run lint`) is a no-op placeholder. On Windows, if `npm` is blocked in PowerShell, call the `.mjs` scripts
with `node` directly (as above) or use `npm.cmd`.

## Architecture

**`backend/app_core.py`** is the single source of truth for domain logic — read it before making backend
changes. Key pieces:

- `ITEM_DEFINITIONS` — a small hardcoded catalog of item templates (e.g. `MAIN_SWORD`, `HEAD_PLATE`) used as a
  demo/fallback set, separate from the external `ao-bin-dumps` catalog.
- `load_external_catalog()` — lazily fetches `items.json` from `ao-data/ao-bin-dumps` on GitHub, caching it to
  `backend/cache/items.json` on disk (`@lru_cache`, so only one fetch per process). That file is the
  *formatted* dump: each entry only has `UniqueName` + `LocalizedNames`/`LocalizedDescriptions` — no
  slot/category/two-handed field — so slot and two-handedness must be derived, not read directly.
- **Slot derivation**: `_derive_slot_from_template()` maps the category token right after the tier in a
  template (`T4_MAIN_SWORD` → `MAIN`, `T4_ARTEFACT_2H_BOW_HELL` → `ARTEFACT`) through an explicit allowlist
  (`_TEMPLATE_PREFIX_SLOTS`) to one of the 10 loadout slots. This is intentionally an allowlist, not a
  keyword/substring scan of localized names — free-text matching across ~15 languages produces false
  positives (e.g. Polish "Dębowe" normalizes to contain "bow" and would match raw log/wood resources; items
  literally named `ARTEFACT_*` are crafting resources, not equipable gear, despite containing weapon-like
  substrings such as "bow" or "firestaff" in their template). Anything without a recognized prefix (crafting
  resources, quest items, journals, vanity/skin unlocks, loot chests, farm goods, furniture, tokens...) is
  excluded from search results entirely.
- **Template registry**: `TEMPLATE_DEFINITIONS` / `find_definition()` merge `ITEM_DEFINITIONS` with
  `ItemDefinition`s derived from the external catalog (`_external_template_definitions()`, grouped by
  template with tier range inferred from the data actually present). Both the optimizer and
  `equivalent_variants()` look items up here — **not** just `ITEM_DEFINITIONS` — since almost every item a
  user actually picks via search comes from the external catalog, not the ~24-item hardcoded set.
- **Unique name format**: `T{tier}_{TEMPLATE}` or `T{tier}_{TEMPLATE}@{enchantment}` (e.g. `T6_MAIN_SWORD@2`).
  `parse_unique_name()` / `format_unique_name()` convert between this and `(tier, template, enchantment)`.
- **Display names**: the game's raw localized names bake the tier-rank title into the string itself (e.g.
  "Adept's Sword", "Master's Sword" are literally how T4/T6 swords are named in the source data).
  `strip_tier_title()` strips that leading title (English only — other languages use different grammar, e.g.
  German/Portuguese suffix the rank instead of prefixing it, which isn't handled) so search results group by
  the base item name across tiers instead of splintering per tier-title.
- **Locale codes**: the source data keys `LocalizedNames` by full locale (`de-de`, `pt-br`, ...), but this
  app's `LANGUAGES`/UI use short codes (`de`, `pt`, ...). `_localized_names_from_raw()` aliases the short
  codes it supports so non-English UI languages actually resolve a translated name instead of silently
  falling back to English.
- **Item images**: `item_image_url()` builds render URLs against `https://render.albiononline.com/v1/item/...`
  — always pass the machine `unique_name`, not a display name (the render API resolves by unique name only).
- **Pricing**: `fetch_prices()` batches unique names into comma-joined requests against the Albion Online Data
  Project API (`{region-host}/api/v2/stats/prices/{items}.json?locations={cities}&qualities=1`), splitting
  batches to stay under the 4096-char URL length limit. A live network failure (or a `0` sell price) falls
  back to `_price_fallback()`, a deterministic hash-based synthetic price — so pricing always returns
  *something* even offline, which matters when testing without network access.
- **Optimizer**: `optimize_loadout_with_cities()` takes the selected loadout, expands each slot to its
  IP-equivalent variants via `equivalent_variants()`, fetches prices for all of them, and picks the cheapest
  variant per slot independently (not a global combination search).

**`backend/main.py`** is a thin Flask layer: `/api/health`, `/api/config`, `/api/items` (search), `/api/item/<unique_name>`,
`/api/optimize` (POST). It also serves the frontend — `/` and `/<path:path>` return files from `frontend/dist`
if it exists, else fall back to `frontend/src` directly (so you can skip the build step during iteration, or
use `dev-server.mjs` for proxying without a build).

**`frontend/src/app.js`** is a single vanilla-JS file with no framework: a module-level `state` object, a cached
`elements` lookup of DOM nodes by id, and imperative `render*`/`sync*` functions. There's no component system —
new UI features mean adding state, a render function, and wiring it into `updateAllViews()`. Loadouts can be
saved/loaded from `localStorage` (`SAVED_LOADOUTS_KEY`).

## Core Domain Rules

### Item Power (IP)
- Tiers range T4–T8; each tier adds +100 IP over T4 base.
- Enchantment (`.0`–`.4`) adds +100 IP per level.
- Quality (Normal=1 .. Masterpiece=5) adds up to +100 IP (+20 per step), independent of the equivalence math below.
- **Equivalent level** = `tier + enchantment`. e.g. 4.2, 5.1, and 6.0 are all equivalent level 6 and are treated
  as interchangeable by the optimizer (`equivalent_variants()`).

### Live Market Prices (Albion Online Data Project)
- Region hosts: Americas `https://west.albion-online-data.com`, Asia `https://east.albion-online-data.com`,
  Europe `https://europe.albion-online-data.com`.
- Respect upstream rate limits when touching price-fetching code: 180 requests/min, 300 requests/5 min, plus
  the 4096-character URL cap already enforced in `fetch_prices()`.

## Working Conventions

- Backend: Python with type hints and dataclasses (`ItemDefinition`, `ItemVariant`). Plain Flask — no
  FastAPI/Pydantic.
- Frontend: no TypeScript, no framework, no real build step — keep additions in plain JS/HTML/CSS consistent
  with the existing single-file style unless there's a genuine reason to restructure.
- When adding a supported item template, update `ITEM_DEFINITIONS` (via `_base_catalog()` /
  `_specialized_catalog()`) and its localized names in `BASE_LOCALIZED_NAMES`/`SPECIALIZED_LOCALIZED_NAMES`.
  If the change is about recognizing a *new category* of external-catalog item, extend
  `_TEMPLATE_PREFIX_SLOTS` instead (allowlist, not the hardcoded catalog).
- Handle missing/null `LocalizedNames` entries and stale/zero `sell_price_min`/`buy_price_max` values gracefully
  rather than throwing — the external catalog and price API are both unreliable data sources in practice.
- `styles.css` has a global `[hidden] { display: none !important; }` rule specifically because any class rule
  setting `display` (e.g. `.modal-overlay { display: grid; }`) has the same CSS specificity as the browser's
  built-in `[hidden]` rule and can silently win, leaving an element visible despite `element.hidden = true` in
  JS. Keep relying on that global rule for modals/overlays rather than toggling `display` directly.
