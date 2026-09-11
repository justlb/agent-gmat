# backend/tests

Backend regression tests — pure Node test runner (`node --import tsx --test`).

## Run

```bash
cd backend
npm test
```

## Test runner structure

| Directory | Covers |
|---|---|
| `gmat/` | GMAT rendering, drafts, templates, Hohmann chemical analysis. |
| `runs/` | Run workspace, manifest, lifecycle, view model. |
| `digitalThread/` | Satellite library, store, GMAT adapter. |
| `opalis/` | OPALIS adapter, results, workflow log. |
| `api/` | HTTP API integration tests (Fastify server). |
| `e2e/` | End-to-end: full pipeline from planning run to result. |
| `unit/` | Isolated unit tests (shared, codex-run, modelBackends). |
| `analysis/` | LLM-backed analysis context tests. |
| `helpers/` | Test utilities (createTestServer, testConfig, manifestFixture). |

## Targeted runs

```bash
npm run test:gmat:baseline         # GMAT + digital thread baseline
npm run test:gmat:electric          # Electric transfer drafts/runners
node --import tsx --test tests/gmat/chemicalHohmannGeneration.test.ts
```
