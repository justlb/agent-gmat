# backend/src/system

System-level APIs: health checks, skill cache, auth, remote tools.

## Files

| File | Purpose |
|---|---|
| `health.routes.ts` | GET `/api/health` — checks backend + model connectivity. |
| `skills.routes.ts` | GET `/api/skills` — lists available Codex skills. |
| `skills.ts` | Loads and caches skills from `skills.json`. |
| `auth.routes.ts` | Auth status endpoints (used when `auth.enabled=true`). |
| `remoteTools.routes.ts` | Starts/stops FreeCAD, ParaView, COMSOL remote GUI containers. |
| `index.ts` | Re-exports route handlers. |
