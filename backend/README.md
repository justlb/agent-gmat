# backend

Fastify API for the GMAT Agent. See `STRUCTURE.md` for the full directory map and `src/README.md` for the module organisation.

## Key files

| File | Purpose |
|---|---|
| `package.json` | npm scripts: `dev`, `build`, `test`, `test:gmat:baseline`, `campaign:gmat`. |
| `tsconfig.json` | TypeScript configuration. |
| `tsconfig.tsbuildinfo` | Generated build cache (gitignored). |

## Directories

| Directory | Purpose |
|---|---|
| `src/` | Live TypeScript source (the heart of the project). |
| `tests/` | Regression and integration tests. |
| `workflow_agents/` | GMAT template resources (scripts, template.json, references). |
| `scripts/` | Utility scripts (dev runner, validation, install). |
| `dist/` | Compiled JavaScript (generated, gitignored). |
| `logs/` | Runtime log files (gitignored). |
| `experiments/` | Ad-hoc prototyping area. |

## Run the backend alone

```bash
cd backend
npm run dev          # development mode (tsx, watch)
npm run build        # compile TypeScript to dist/
npm start            # production: node dist/index.js
npm test             # full test suite
```
