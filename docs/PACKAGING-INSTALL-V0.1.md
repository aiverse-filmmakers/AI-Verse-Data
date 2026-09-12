# AI-Verse Data Packaging and Install

**Status:** Canonical Task 40 / 41 packaging contract
**Date:** 2026-09-12

Docs plus pack proof only. No new engine, no new `src/`, no npm
publication. Publication stays explicitly deferred until the release
acceptance suite (Task 41) passes.

## Stable distribution metadata

- name: `@ai-verse/data`;
- version: `0.1.0-alpha.0` (pre-release; public API is not yet frozen);
- license: `UNLICENSED` (private pre-release; no public license granted);
- `type: module`, `engines: node >=22.0.0`;
- `bin.ai-verse-data`: `dist/src/cli.js` with `--help`, `--version`,
  `install`, `update`, `disable`, `uninstall`, `doctor`, `status`;
- `exports`: root plus `protocol`, `storage`, `scope`, `catalog`,
  `records`, `query`, `transactions`, `idempotency`, `provenance`,
  `bulk`, `backup`, `schema-migrations`, `recovery`, `client`,
  `bots`, `brain`, `memory`, `dashboard`, `apps`, `connections`,
  `automation`, `native`;
- `files`: `dist/src/` plus `README.md` only (sources, tests,
  examples, and fixtures never ship);
- `scripts.prepare`: `npm run build` so a GitHub dependency builds
  `dist/` on install;
- `dependencies`: `better-sqlite3 13.0.3` with prebuilt binaries on
  the supported matrix; `devDependencies` are TypeScript plus
  `@types/*` and never ship.

## Clean GitHub install path

No registry publication is needed to consume this repo:

```text
npm install github:aiverse-filmmakers/AI-Verse-Data
npx ai-verse-data --help
npx ai-verse-data install --root <os-root>
```

The `prepare` script compiles `dist/` during that install, so the
`bin` entry and every `exports` subpath resolve without a separate
build step. Consumers on Node 22+ on ubuntu, macOS, or Windows get
the same entry points the CI matrix proves.

Verified locally (this host, Node 22):

- `npm pack --dry-run`: 490 files, 255.5 kB package, 1.4 MB unpacked;
- `npm pack --pack-destination <tmpdir>`: tarball materializes and
  contains `package.json`, `README.md`, `dist/src/cli.js`,
  `dist/src/index.js`, plus every `dist/src/<surface>/index.js`;
- `node dist/src/cli.js --help`: stable usage tokens for all eight
  commands;
- `npm install --ignore-scripts` plus `npm run check`: full suite
  path the CI matrix runs on every leg.

## What publication requires

- Task 41 release acceptance green on a clean environment;
- an explicit version bump out of `-alpha.0`;
- an explicit license decision replacing `UNLICENSED`;
- an explicit registry decision (npm scope plus provenance).

Until then: GitHub path only, no `npm publish`, no store listing.
