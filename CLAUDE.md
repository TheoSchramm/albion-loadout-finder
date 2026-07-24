# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A web app for Albion Online players: build a 10-slot equipment loadout, search items with multi-language
autocomplete, and compare live market prices across item-power-equivalent tier/enchantment variants to find
the cheapest way to hit a target IP.

It is a **fully static, client-side app** — plain ES modules, no framework, no bundler, no dependencies, and
no server of any kind. It is deployed to GitHub Pages and talks to the Albion Online Data Project API directly
from the browser.

There used to be a Python/Flask backend holding all the domain logic. It was ported to JavaScript and deleted;
`frontend/tests/golden/` still records its exact behavior and is what the port is asserted against. If you need
the original Python (e.g. to regenerate a fixture), recover it from git history — see
`frontend/tests/golden/README.md`.

## Directory Structure

```
frontend/
  src/
    index.html            # single page; loads ./app.js as type="module"
    app.js                # all UI: module-level `state`, cached `elements`, imperative render*/sync* fns
    styles.css            # dark "Quartermaster's Ledger" theme, CSS custom properties
    lib/                  # the domain logic (ported from the old Python backend)
      constants.js        # static data: languages, regions, slots, quality labels, template allowlist
      text.js             # normalize/strip/parse helpers for names and templates
      urls.js             # price-API and item-render URL construction
      catalog.js          # async catalog bootstrap + derived lookup tables
      items.js            # variant building, naming, serialization, IP-equivalence
      search.js           # search, grouping, representative-variant selection
      prices.js           # market price fetching and batching
      optimizer.js        # cheapest-variant-per-slot optimization
      api.js              # shim preserving the five payload shapes the old HTTP API returned
    data/items.catalog.json  # generated; 7,479 equipable items in 8 languages (~520 KB, ~70 KB gzipped)
  scripts/
    build.mjs             # copies src/ -> dist/, emits .nojekyll + 404.html, runs deploy guards
    build-catalog.mjs     # builds data/items.catalog.json from ao-bin-dumps
    dev-server.mjs        # static dev server on :5173
    lint.mjs              # no-op placeholder
  tests/                  # node:test suite, zero dependencies
    golden/               # frozen fixtures recording the original Python behavior
.github/workflows/pages.yml  # test -> refresh catalog -> build -> deploy to Pages
```

## Common Commands

```bash
cd frontend
npm test                  # node:test suite (45 tests). No network - see below.
npm run dev               # static server on http://127.0.0.1:5173
npm run build             # src/ -> dist/ plus Pages files and guards
npm run build:catalog     # regenerate the item catalog from live upstream
npm run check:catalog     # verify the committed catalog is current

node --test tests/core.test.js          # a single test file
node scripts/build-catalog.mjs --from <path-to-items.json>   # build from a local dump
```

There is no bundler, transpiler, or linter (`lint.mjs` is a placeholder). On Windows, if `npm` is blocked in
PowerShell, call the `.mjs` scripts with `node` directly or use `npm.cmd`.

## Architecture

`frontend/src/lib/` is the single source of truth for domain logic — read it before making behavioral changes.
The dependency direction is strictly one-way:

```
constants.js -> text.js -> urls.js -> catalog.js -> items.js -> search.js
                                                        \-> optimizer.js -> prices.js
                                                                  \-> api.js -> app.js
```

- **`catalog.js` is an async bootstrap, not a module-level constant.** The Python original built its lookup
  tables at import time, including a network fetch as a side effect of `import app_core`. In a browser that
  has to be explicit: call `loadCatalog(url)` once during boot, then `getCatalog()` everywhere. Readers
  **throw** before the catalog is loaded rather than returning `undefined` — do not "fix" that by returning a
  default, it exists to make an ordering mistake loud.
- **`api.js` is a deliberate seam.** It reproduces the five payload shapes the old Flask endpoints returned, so
  `app.js` changed in only five places during the port and the golden fixtures have something stable to assert
  against. New UI code may call the domain modules directly, but do not change `api.js`'s payload shapes
  casually.
- **`app.js` has no component system.** New UI features mean adding to `state`, writing a `render*` function,
  and wiring it into `updateAllViews()`. Loadouts persist to `localStorage` under `SAVED_LOADOUTS_KEY`.

### Item catalog

`data/items.catalog.json` is generated from
[`ao-data/ao-bin-dumps`](https://raw.githubusercontent.com/ao-data/ao-bin-dumps/refs/heads/master/formatted/items.json).
The upstream dump is ~24 MB of all 12,071 items with long descriptions in 15 languages; the build prunes it to
the 7,479 equipable ones in the 8 supported languages and groups them by template.

Two properties of the format are load-bearing:

- **`templates` is a JSON array, in upstream order.** Search groups results by first appearance and truncates
  to 24, so serializing it as an object would make the visible result set depend on JS property-order rules.
  Flattening the grouped form reproduces the original entry order exactly — there is a test for this.
- **Names are stored raw**, with the rank title ("Adept's Sword") intact. Display names strip it; the in-game
  market alias needs it back. Storing stripped names would make the alias unreconstructible.

The source dump ships **no slot or category field**, so slots are derived from the template prefix via an
explicit allowlist (`TEMPLATE_PREFIX_SLOTS` in `constants.js`). This is an allowlist on purpose: free-text
matching across 15 languages produces false positives (Polish "Dębowe" normalizes to contain "bow", matching
raw wood as bows), and items named `ARTEFACT_*` are crafting resources despite containing weapon-like
substrings. **To support a new category of item, extend that allowlist** — do not add keyword matching.

The prefix allowlist alone isn't always enough: `deriveSlotFromTemplate()` (`text.js`) also excludes specific
false positives that share a real equipment prefix. `2H_TOOL_*` (gathering tools) shares `2H_` with real
weapons; `*_BP` templates (faction/season "Crests", e.g. `CAPEITEM_FW_BRIDGEWATCH_BP` = "Bridgewatch Crest",
a trophy item) share `CAPEITEM_` with real capes. **If a new false positive turns up sharing a legitimate
prefix, add a targeted exclusion here** rather than narrowing the prefix allowlist itself.

## Core Domain Rules

### Item Power (IP)
- Tiers T4–T8; each tier adds +100 IP over T4 base.
- Enchantment `.0`–`.4` adds +100 IP per level. **Only tier 4+ can be enchanted** — tiers 1–3 exist only at
  `.0`, so a `T2_CAPE@4` would price an item the game has never had.
- Quality (Normal=1 .. Masterpiece=5) adds up to +100 IP, independent of the equivalence math.
- **Equivalent level = tier + enchantment.** 4.2, 5.1 and 6.0 are interchangeable, which is what
  `equivalentVariants()` expands.
- **Some templates rename per tier and are not substitutes — but only when the tier range has a gap.**
  `MEAL_STEW` is Goat Stew at T4, Mutton Stew at T6 and Beef Stew at T8, and skips T5/T7 entirely; that gap is
  what signals "these are different items", so substitution is gated on the English name matching. A
  continuous tier range whose name only changes at T8 is a *different* pattern and must NOT be gated: most
  weapon/shield/tome lines get a cosmetic-only T8 flavor name (`2H_AXE` is "Greataxe" at T4-T7 and "The Hand
  of Khor" at T8) while remaining the same item mechanically. `equivalentVariants()` in `items.js` checks for
  a gap first and only applies the name filter when one exists.

### Market prices
- Region hosts: Americas `west`, Asia `east`, Europe `europe` `.albion-online-data.com`.
- Requests are chunked to stay under a 4096-character URL. **Send no request headers** — a `Content-Type` on a
  cross-origin GET forces a CORS preflight per batch, doubling requests against the 180 req/min budget.
- **Never fabricate a price, but never hide the row either.** A zero `sell_price_min` means "nothing listed",
  not "free". Every equipped slot and every IP-equivalent candidate is always returned by the optimizer, even
  with no real listing anywhere — `cheapest_price`/`cheapest_city`/`cheapest_quality`/`cheapest_quality_label`
  are `null` and `updated_at` is `''` rather than a made-up number, and the UI shows "no market data" plus a
  copy-to-clipboard market alias so the user can check in-game directly. `total_cost` only ever sums real
  prices.
- Rate limits are per client IP and now belong to each visitor rather than a shared server, which is why
  Compare prices is disabled while a request is in flight.

## Testing

`npm test` runs `node:test` with zero dependencies, in three layers:

1. **Parity** (`parity.test.js`) — asserts against `tests/golden/`, generated from the Python implementation.
   Covers the full search matrix, serialized items, equivalents, URLs, batch boundaries, and optimizer output.
2. **Ported unit tests** (`core.test.js`) — the original Python suite, 1:1, with names mirrored.
3. **Port-specific guards** — hazards that exist only because this is browser JavaScript.

**The suite never touches the network**, and that is enforced: `tests/helpers.mjs` replaces `globalThis.fetch`
with a throw. Code needing HTTP takes an injected `fetchImpl`. If you add a test that hits the network, it will
fail — inject a fake instead.

The fixtures **pin the original behavior including its bugs**, so a parity failure can only mean "the port
diverged". If you intentionally change behavior, regenerate the affected fixture in a commit that does nothing
else and say so explicitly.

## Working Conventions

- **Field names in payloads are `snake_case`** (`unique_name`, `slot_label`, `two_handed`), inherited from the
  Python original and relied on by `app.js`. Function names are `camelCase`. Do not "modernize" the data keys.
- `serializeVariant()` returns exactly 14 keys, and there is a test freezing that set. `app.js` merges this
  over live results with `Object.assign` when the language changes, so adding a market-data key such as
  `updated_at` would blank prices that were correct a moment earlier.
- Handle missing/null localized names and stale/zero prices gracefully rather than throwing — the item dump and
  the price API are both unreliable in practice.
- **Everything must work from a subpath.** GitHub Pages serves this from `https://<user>.github.io/<repo>/`, so
  asset paths stay document-relative (`./app.js`) and URLs are built against `import.meta.url`, never
  `window.location.origin`. `build.mjs` fails the build if a root-relative path or `window.location.origin`
  appears in the output.
- `styles.css` has a global `[hidden] { display: none !important; }` rule specifically because any class rule
  setting `display` (e.g. `.modal-overlay { display: grid; }`) has the same specificity as the browser's
  built-in `[hidden]` rule and can silently win, leaving an element visible despite `element.hidden = true`.
  Keep relying on that rule rather than toggling `display` directly.
- Visual conventions the design deliberately follows: dark theme only, no gradients anywhere, no emoji, and
  city/quality colors derived from the in-game palette (adjusted only for contrast, preserving hue).
