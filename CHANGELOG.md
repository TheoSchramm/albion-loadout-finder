# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project
deploys continuously (every push to `main` rebuilds and redeploys automatically via GitHub
Actions), so entries are grouped by date rather than by version number — there's no separate
"release" step to hang a version on.

## [Unreleased]

## 2026-07-28

### Added

- City and quality names in the "Market city" and "Minimum quality" dropdowns are now
  colored to match their in-game colors, both in the open list and the closed selector,
  matching how they're already shown throughout the results table. (#7)
- A flag icon on the Language selector (Brazilian flag for Portuguese, since that's the
  only Portuguese Albion ships), and a neutral globe icon on the Region selector - regions
  are server clusters, not single countries, so no one flag fits all three. Both selectors
  are now a small custom dropdown rather than a native `<select>`, so the icon shows in
  the open option list too, not just the closed control - no browser renders an image
  inside a native `<option>`.
- A "View on GitHub" link at the bottom of the sidebar, so players can find the repository
  to open issues, suggest features, or follow development without hunting for the URL. (#9)
- A disclaimer under the "Compare prices" button noting that prices are only a suggestion
  and may not be accurate, and to verify them in-game before acting on them.
- A "Sort" control for saved loadouts, next to the loadout dropdown: "Recently updated"
  (the previous, only, behavior) or "A–Z" by title. The choice persists across reloads. (#5)

### Changed

- The Load/Save/Edit/Delete/Export/Import loadout buttons now each carry their own icon,
  and Save/Load/Delete each have a distinct accent color (brass/verdigris/red) instead of
  four of the six buttons all looking identical. (#8)
- The saved-loadout dropdown now shows only the title. Its description (if any) shows as
  a separate line below the dropdown for whichever loadout is currently selected, instead
  of being appended into the option text ("Title — description"). (#6)

### Fixed

- Picking a Region/Language option immediately reopened the dropdown instead of staying
  closed. The `<label>` wrapped both the trigger button and the option list, and clicking
  a plain (non-form-control) element inside a `<label>` makes the browser also fire a
  synthetic click on the label's associated control right after - reopening it the instant
  it closed. Region and Language now use a `<label for>` that only references the trigger,
  with the option list moved outside the label entirely.
- Saving with a changed title while a loadout was already loaded silently renamed and
  overwrote that loadout instead of creating a new one, contradicting the save dialog's
  own hint ("Change the title to save as a new preset instead"). Changing the title now
  does save a new entry, leaving the original untouched; saving with the title unchanged
  still updates in place.

## 2026-07-24

### Added

- "Clear all" button to empty the loadout in one click.
- Confirmation prompts before overwriting or editing a saved preset, and before deleting one.
- Silver amounts now show an "M" suffix above 1,000,000 (e.g. "2.5M") instead of an unwieldy "k" value.
- Results now list every IP-equivalent tier/enchant alternative for each slot, even ones with no
  market listing, each with its own copy-to-clipboard button for the in-game market search text.
- An "X/Y items found" counter next to the total loadout price. It updates live as each item's
  price comes back, instead of jumping straight to a final count once the whole loadout is priced.
- Up to 10x quantity for potion/food slots, scaling the displayed price and total.
- Export/import a loadout as a short copy-pasteable code.
- A subtle separator between the Equipment and Search columns.
- A "Minimum quality" filter next to Region/Language/Market city: prices below the selected
  quality are excluded when comparing.

### Changed

- The saved-loadout selector no longer preselects a preset on page load (or right after
  deleting one) — it starts on a neutral "Select a loadout..." placeholder, with Load/Edit/Delete
  disabled until one is chosen.
- Saving the current loadout while a preset is already loaded now updates that same preset in
  place instead of creating a duplicate entry with a colliding id. Saving with no preset loaded
  starts a fresh one, prefilled with a unique default title ("My loadout N").
- Selecting an empty slot now immediately lists every item available for it, instead of
  requiring the user to start typing first.
- The copy-to-clipboard button in the results table moved from its own trailing column to sit
  right next to the item name, with no gap between them regardless of how short the name is.
  The same applies to each row in the expanded equivalent-options list, whose price/city/quality/
  age columns shift left to fill the freed space.

### Fixed

- T8 items with a purely cosmetic tier-8 name (e.g. "The Hand of Khor" for the Greataxe line)
  were excluded from their own tier/enchant price comparison.
- Searching "cape" surfaced non-equipable items: faction Crests, the Arena Veteran's Banner, and
  decorative vanity skins.
- The results table could visually spill past its card's rounded border on narrow viewports or
  at high browser zoom; it now scrolls horizontally within its own card instead.
- The item search results could likewise spill past their column at high browser zoom, before
  the layout was narrow enough to trigger the mobile breakpoint.

## 2026-07-23

### Changed

- Rebuilt the app as a fully static, client-side site — no backend. All search, IP-equivalence,
  and pricing logic now runs in the browser and talks to the Albion Online Data Project API
  directly. Deployed via GitHub Pages, rebuilding and redeploying automatically on every push to
  `main` and on a weekly schedule to keep the item catalog current.

### Fixed

- Search silently matched everything instead of returning no results for Russian, Chinese, and
  Korean queries.
