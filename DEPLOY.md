# Deployment

The app is fully static — HTML, CSS and ES modules, with no server, no build step beyond a
file copy, and no dependencies. It is hosted on GitHub Pages and calls the Albion Online
Data Project API directly from the browser.

## Prerequisites

Node.js 22+. That is the whole list.

## Local development

```bash
cd frontend
npm run dev
```

Serves `src/` at http://127.0.0.1:5173 with no build step — edit and reload. There is no
API proxy and nothing else to start.

## Tests

```bash
cd frontend
npm test                        # 45 tests
node --test tests/core.test.js  # a single file
```

The suite runs offline by design: `tests/helpers.mjs` replaces `globalThis.fetch` with a
throw, so anything needing HTTP must take an injected fake. See the "Testing" section of
`CLAUDE.md`.

## Build

```bash
cd frontend
npm run build
```

Copies `src/` to `dist/`, adds `.nojekyll` and `404.html`, and fails the build if it finds
anything that would break when served from a subpath (a root-relative `/asset` path or
`window.location.origin`), or if the item catalog exceeds its 1.5 MB budget.

## Deploying to GitHub Pages

Deployment is automatic via `.github/workflows/pages.yml` — on every push to `main`, on
manual dispatch, and weekly.

**One-time setup:** in the repository, go to **Settings → Pages → Build and deployment**
and set **Source** to **GitHub Actions**. Nothing else is required; the workflow already
requests the `pages: write` and `id-token: write` permissions it needs.

The site is then served from `https://<user>.github.io/<repo>/`.

The workflow runs: `npm test` → `npm run build:catalog` → `npm run build` → deploy. That
order is deliberate — see the comment in the workflow file. If any step fails nothing is
deployed and the previous build keeps serving.

### Keeping item data current

Item data changes with game patches. The weekly cron re-fetches the catalog from
`ao-data/ao-bin-dumps`, rebuilds, and redeploys, so the live site stays current without
anyone committing anything. The catalog committed to the repo is only the offline/dev
fallback and the fixture the parity tests run against.

Two things worth knowing:

- **GitHub disables scheduled workflows after 60 days of repository inactivity.** The
  `workflow_dispatch` trigger is the manual escape hatch; a push re-enables the schedule.
- If upstream ever changes which items exist, `build-catalog.mjs` warns that the parity
  fixtures no longer match, and its own assertions (entry count within 20%, no divergent
  names within a group, rank titles still parseable) fail the build rather than shipping
  malformed data.

To refresh the committed catalog manually:

```bash
cd frontend
npm run build:catalog     # from live upstream
npm run check:catalog     # verify the committed copy is current
```

## Manual check before considering a deploy good

There is no browser automation in this repo, so these are worth a quick pass by eye,
ideally in an incognito window (which also catches anything accidentally depending on
`localStorage`):

- Search returns sensible results in each of the 8 languages.
- Equipping a two-handed weapon locks the off-hand slot.
- Save, load, edit and delete a preset.
- **Switch language while priced results are on screen** — names should relabel in place
  without prices, cities or timestamps changing.
- Compare prices returns real numbers, and the button disables while it is working.
- The API link on a result row opens a valid JSON query.
- The copy button yields a market alias like `Adept's Hunter Shoes 4.2`.
