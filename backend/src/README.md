# Backend Modules

The backend is grouped by business capability. Keep route handlers inside the
module that owns the API surface, and move shared behavior into services or
small shared helpers when a second module needs it.

## Core GMAT and mission pipeline

- `gmat`: Mission templates, draft conversations, GMAT script rendering and
  generation, run lifecycle, and the template registry. This is the primary
  mission-authoring module.
- `digitalThread`: Satellite definitions (versioned library), run-local
  satellite snapshots, mission selection, and conversion to tool inputs
  (GMAT, OPALIS, RF-COMLINK).
- `runs`: Dated mission-run paths, artifact registry, workflow status, run
  view models, and the canonical run lifecycle (draft → prepare → execute →
  complete).
- `opalis`: Simu-CIC and OPALIS preparation, execution, normalized outputs,
  and workflow state for the electrical analysis stage.
- `rfComlink`: RF-COMLINK scenario preparation, result parsing, and
  engineering analysis of the communication link.

## Supporting modules

- `modelBackends`: Model endpoint routing, connection selection, and
  response handling for the LLM-backed Mission Studio discussion.
- `server`: Backend route registration and server composition. All API
  routes are mounted here.
- `shared`: Cross-module request parsing, HTTP response helpers, path
  validation, and atomic persistence primitives.
- `system`: Health checks, skill cache, and other backend support APIs.
- `sessions`: Conversation history APIs and workspace-backed persistence.

## Legacy / ancillary modules

- `codex-run`: Managed Codex SDK execution, SSE streaming, input files,
  and user-input protocol. Used by the agent-style conversation path.
- `artifacts`: Static/local artifact delivery such as images.
- `manifests`: Workspace manifests, versions, runs, artifacts, checkpoints,
  and scores.
- `workspaces`: Workspace selection, uploaded files, persisted UI data,
  BOM, models, progress, and stage logs.
- `gnc_config`: GNC (Guidance, Navigation, Control) configuration
  management and telemetry dashboard support.

## Dependency direction

Prefer this direction when adding new code:

```text
*.routes.ts -> *.service.ts -> stores/adapters -> shared utilities
```

Routes should stay thin: validate request shape, call module services, and map
errors to HTTP responses. Stores and adapters should avoid importing routes.
