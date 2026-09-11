# backend/src/manifests

Legacy workspace manifest system (versions, checkpoints, scores). Mostly superseded by `runs/runManifest.ts` for GMAT mission runs.

## Files

| File | Purpose |
|---|---|
| `store.ts` | Low-level manifest persistence. |
| `schema.ts` | TypeScript validation and shape helpers for workspace manifests. |
| `manifest.routes.ts` | Manifest read/write API. |
| `version.routes.ts` | Workspace version and branch management. |
| `run.routes.ts` | Legacy run routes (GMAT runs now live under `runs/`). |
| `registration.routes.ts` | Workspace registration. |
| `workspaceManifest.routes.ts` | Workspace manifest summary. |
| `index.ts` | Re-exports. |
