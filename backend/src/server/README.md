# backend/src/server

Backend composition: registers all route handlers and creates request context.

## Files

| File | Purpose |
|---|---|
| `routes.ts` | Imports and mounts every module route handler onto the Fastify instance. This is the single entry point that wires the whole API surface. |
| `requestContext.ts` | Extracts per-request user identity and workspace from headers (`x-codex-user-id`) or cookies. |
| `auth.ts` | Optional authentication middleware; disabled in dev (`auth.enabled=false`). |
