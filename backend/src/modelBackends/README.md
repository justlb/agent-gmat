# backend/src/modelBackends

LLM endpoint routing: resolves which model backend to use and normalises responses.

## Files

| File | Purpose |
|---|---|
| `modelBackends.ts` | Reads `chatModel` and `openai` from config, creates HTTP clients, and exposes a unified `resolveModelBackend()` used by GMAT assistant, Results analysis, and the legacy Codex agent path. |
