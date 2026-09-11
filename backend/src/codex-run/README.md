# backend/src/codex-run

Legacy Codex Agent execution path: SSE streaming, input files, intent routing. Still used by the agent-style conversation page.

## Files

| File | Purpose |
|---|---|
| `agentOrchestrator.ts` | Orchestrates Codex SDK calls, streams events over SSE. |
| `codexConfig.ts` | Reads Codex SDK config from `config.json`. |
| `codexTurn.ts` | Parses a Codex turn response into UI events. |
| `intentRouter.ts` | Classifies a user message and routes it to GMAT, RF-COMLINK, or general. |
| `promptPrefix.ts` | Builds system prompts for Codex conversations. |
| `responsesCompat.ts` | Adapts old Responses API calls to current Codex SDK. |
| `runInput.ts` | Prepares input files (snippets, satellite.json) for Codex runs. |
| `runSessionStore.ts` | Tracks per-session Codex run state. |
| `runTelemetry.ts` | Streams progress and logs to the frontend. |
| `runErrors.ts` | Normalises Codex errors into HTTP responses. |
| `run.routes.ts` | API routes for Codex run lifecycle. |
| `managed.routes.ts` | SSE endpoint for managed Codex agent runs. |
| `inputFiles.routes.ts` | Lists input files a Codex run needs. |
| `askUserProtocol.ts` | Handles `askUser` protocol exchanges between Codex and the user. |
| `runTypes.ts` | Shared types for Codex run state. |
| `index.ts` | Re-exports. |
