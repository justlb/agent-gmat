# Backend Structure

This document is a navigation aid for `backend/`, not an API contract. For
current behaviour, consult the module README next to the implementation and
the matching tests. Counts and generated contents are intentionally not listed
because they change between revisions.

## Quick map

| Category | Items |
| --- | --- |
| Live source code | `src/` |
| Mission data resources | `workflow_agents/` |
| Regression tests | `tests/` |
| Generated (gitignored) | `dist/`, `node_modules/`, `logs/` |
| Manifest & config | `package.json`, `package-lock.json`, `tsconfig.json`, `skills.json` |
| Ad-hoc utilities | `scripts/`, `experiments/` |

---

## Directories

### `src/` — Live TypeScript source (the heart of the project)

This is the code that actually runs when the demonstrator is started
(`npm run dev` / `npm start`). It is organized by domain, mirroring the
boundaries documented in [CODE_STRUCTURE.md](../docs/CODE_STRUCTURE.md):

| Subdirectory | Responsibility |
| --- | --- |
| `gmat` | Mission templates, draft state, GMAT script generation, slot extraction/substitution, and the mission assistant routes. |
| `digitalThread` | Immutable satellite definitions, selected mission state, conversion to tool inputs, and the provenance store that records the source of every value. |
| `opalis` | Simu-CIC and OPALIS preparation, execution, normalized outputs, and workflow state. |
| `rfComlink` | RF-COMLINK scenario preparation, saved-result inventory, and run-scoped analysis. It does not yet expose deterministic link-budget metrics. |
| `runs` | Dated mission-run paths, artifact registry, run lifecycle, the canonical run view, and the pipeline orchestration that chains GMAT -> Simu-CIC -> OPALIS + RF-COMLINK. |
| `analysis` | The AI analysis assistant: builds the compact `run-analysis-context.json`, the disciplined single-run LLM prompt, and the multi-run comparison LLM prompt. |
| `workspaces` | User workspace isolation, uploaded files, persisted UI data, and workspace routes. |
| `manifests` | Template and workspace manifest registration, versioning, and storage. |
| `codex-run` | Managed Codex SDK execution, streaming events, the responses-compatible API, input files, and the ask-user protocol. |
| `server` | Application entry (`index.ts`), `routes.ts` that registers every Fastify route plugin, and request context/auth helpers. |
| `sessions`, `system`, `shared`, `modelBackends`, `gnc_config`, `vts` | Supporting modules: sessions, auth/health/skills, shared helpers, model backend resolution, GNC configuration, and legacy VTS placeholder. |

### `tests/` — Regression suite

Tests written with `node:test`. They are **never executed at runtime**; they run
only via `npm test` (or the targeted variants like `test:gmat:baseline`,
`test:stability`). They protect the live modules in `src/` against regressions
and validate GMAT templates by hash.

Use `npm test` or the named targeted scripts in `package.json`; do not assume
that a directory count or an old campaign report reflects the current suite.

### `dist/` — Compiled output (generated, gitignored)

JavaScript produced by `npm run build` (= `tsc`). Mirrors the `src/` tree.
`npm start` runs `node dist/index.js`. Never edited by hand and never committed.

### `scripts/` — Development and automation utilities

A mix of helper scripts, not part of the production server:

| File | Purpose |
| --- | --- |
| `dev.mjs` | Launches the backend in development mode (used by `npm run dev`). |
| `gmatCompatibilityCampaign.ts` | Runs a GMAT compatibility campaign (`npm run campaign:gmat`). |
| `migrate-workspace-manifests.mjs` | One-off workspace manifest migration. |
| `repair-freecad-manifest.mjs` | One-off FreeCAD manifest repair. |
| `render_orbit_keeping_values.mts`, `write_orbit_keeping_values.mts`, `edit_orbit_keeping_with_llm.mts` | Helpers for the orbit-keeping scenario. |
| `generate_orbit_keeping.py`, `test_orbit_keeping_api.py`, `test_orbit_keeping_service.py` | Python helpers for the orbit-keeping scenario. |

### `workflow_agents/` — GMAT skill and template catalog (data, not code)

Despite the "agents" name, this folder holds **reference resources** consumed by
the template system in `src/gmat`. It contains `gmat_skills/` with:

- One folder per mission type (`chemical-hohmann-transfer-template`,
  `electric-propulsion-transfer-template`, `electrical-leo-orbit-maintenance-template`,
  `orbit-keeping-template`), each with a `template.json` manifest and a
  `references/*.script` GMAT reference script.
- `mission scenario to implement/` — raw `.script` and `.txt` mission scenarios
  collected as implementation candidates.
- `ADDING_A_GMAT_mission_scenario.md` — guide for adding a new scenario.

These files are read by the backend at runtime; they are not executed directly.

### `node_modules/` — Installed dependencies (generated, gitignored)

Installed by `npm install`. Never edited by hand.

### `experiments/` — Scratch space for prototypes

Currently **empty**. Intended for out-of-production prototyping.

### `logs/` — Runtime logs

Contains `app.log`, the backend's runtime log output. Generated at runtime,
gitignored.

---

## Top-level files

### `package.json` — Module manifest

Declares the module name (`codex-web-backend`), the npm scripts
(`dev`, `build`, `start`, `test`, and the targeted test/campaign variants), the
runtime dependencies, and the devDependencies (`tsx`, `typescript`, type
packages). This is the identity card of the backend.

### `package-lock.json` — Dependency version lock

Deterministic snapshot of every dependency and transitive dependency version.
Guarantees that `npm install` reproduces the same dependency tree on another
machine. Should be committed.

### `tsconfig.json` — TypeScript compilation configuration

Rules for `tsc`: `rootDir: src` compiled to `outDir: dist`, `strict: true`,
`noUnusedLocals`/`noUnusedParameters` (rejects dead variables), `target: ES2022`,
`module: ESNext`. Only `src` is included, so `tests/`, `scripts/`, and
`workflow_agents/` are not compiled into `dist/`.

### `skills.json` — Codex skills registry

Declares the skills exposed to the Codex agent, grouped into categories
(`public`, `thermal`, `aignc`, `check`). The `public` group lists generic
skills (`imagegen`, `openai-docs`, `plugin-creator`, `review-agent`,
`skill-creator`, `skill-installer`); the other groups are currently empty. This
is the declarative bridge between the AI agent and available capabilities.

---

## How the pieces connect at runtime

1. `npm run dev` (or `npm start` on the compiled build) boots the Fastify
   server from `src/server`.
2. `routes.ts` registers every route plugin, exposing the mission pipeline,
   digital thread, GMAT generation, Simu-CIC/OPALIS/RF-COMLINK, the AI
   assistant, workspace, and codex-run endpoints to the frontend.
3. When an engineer triggers a mission, the pipeline in `src/runs` chains the
   four tools, while `src/digitalThread` records provenance for every value and
   `src/analysis` produces the compact evidence layer the AI reads.

Everything under `src/` is authored; everything under `dist/`, `node_modules/`,
and `logs/` is generated; `workflow_agents/` is authored data; `tests/` and
`scripts/` are authored tooling that does not run in the server process.
