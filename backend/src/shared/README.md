# backend/src/shared

Cross-module utilities: request parsing, path validation, atomic persistence.

## Files

| File | Purpose |
|---|---|
| `request.ts` | Parses Fastify request bodies and query params with Zod-like validation. |
| `http.ts` | Maps thrown errors to HTTP responses (400, 422, 500). |
| `path.ts` | Resolves and validates workspace paths to prevent path traversal. |
| `atomicPersistence.ts` | Writes files atomically (write-to-temp + rename) to avoid half-written artifacts on crash. |
| `index.ts` | Re-exports the main helpers. |
