# backend/src/digitalThread

Satellite digital-thread store, schema, and adapters. The digital thread is the single source of truth for satellite physical properties and selected mission state.

## Files

| File | Purpose |
|---|---|
| `satelliteLibrary.ts` | Scans `data/satellite-library/` at runtime; returns versioned satellite definitions. |
| `digitalThreadStore.ts` | Loads/saves run-local `satellite.json` snapshots and conversation state. |
| `digitalThreadSchema.ts` | JSDoc type contracts for satellite definitions. |
| `digitalThread.routes.ts` | API routes for satellite selection and digital-thread queries. |
| `gmatDigitalThreadAdapter.ts` | Converts a run-local satellite.json into GMAT draft values per template. |
| `opalisDigitalThreadAdapter.ts` | Converts satellite.json into OPALIS case parameters. |
| `rfComlinkDigitalThreadAdapter.ts` | Converts satellite.json into RF-COMLINK input JSON. |
| `missionConversationStore.ts` | Persists turn-by-turn mission conversations for the Results discussion panel. |

## Key invariant

A run-local `satellite.json` is a copy of the selected satellite definition at run time. Never write back to the library — the run snapshot must remain immutable.
