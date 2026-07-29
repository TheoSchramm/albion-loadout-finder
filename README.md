# Albion Loadout Optimizer

Build a 10-slot [Albion Online](https://albiononline.com) equipment loadout, search items
in 8 languages, and compare live market prices across item-power-equivalent
tier/enchantment variants to find the cheapest way to hit a target IP.

**Live site:** https://theoschramm.github.io/albion-loadout-finder/

Fully static and client-side — plain ES modules, no framework, no build step beyond a file
copy. Hosted on GitHub Pages; prices come from the
[Albion Online Data Project](https://www.albion-online-data.com/).

## Running locally

Requires Node.js 22+.

```bash
cd frontend
npm run dev
```

Serves `src/` at http://127.0.0.1:5173 — no build step, just edit and reload.

## Tests

```bash
cd frontend
npm test
```

## Contributing

Bugs and suggestions welcome — open an issue or a pull request.

## Docs

- [`CLAUDE.md`](CLAUDE.md) — architecture, domain rules, testing.
- [`DEPLOY.md`](DEPLOY.md) — build and deployment details.
- [`CHANGELOG.md`](CHANGELOG.md) — what's changed, by date.
