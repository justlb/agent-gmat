# Code Structure

This repository is a local engineering workspace for spacecraft mission
studies. The frontend presents a mission and saved outputs; the backend owns
workspace access, tool invocation, run persistence, and model requests.

## Boundaries

```text
React frontend
    -> HTTP and Server-Sent Events
Fastify routes
    -> domain services, stores, and adapters
Mission run directory
    -> GMAT -> Simu-CIC -> OPALIS -> RF-COMLINK artifacts
```

The frontend must not directly alter a run directory or start a scientific
tool. Route handlers validate input and translate failures to HTTP responses.
Domain services create and update mission artifacts. Shared helpers provide
path validation, atomic persistence, and request parsing.

## Main areas

| Area | Responsibility |
| --- | --- |
| `backend/src/gmat` | Mission templates, draft conversations, GMAT generation, and run lifecycle. |
| `backend/src/digitalThread` | Satellite definitions, selected mission state, and conversion to tool inputs. |
| `backend/src/runs` | Dated mission-run paths, artifact registry, status, and the canonical run view. |
| `backend/src/opalis` | Simu-CIC and OPALIS preparation, execution, normalized outputs, and workflow state. |
| `backend/src/rfComlink` | RF-COMLINK scenario preparation, result parsing, and engineering analysis. |
| `backend/src/modelBackends` | LLM endpoint routing and response handling for Mission Studio discussion. |
| `backend/src/server` | Route registration, request context, and server composition. |
| `backend/src/workspaces` | User workspace isolation, uploaded files, persisted UI data, and workspace routes. |
| `backend/src/codex-run` | Managed Codex execution, streaming events, input files, and user-input protocol (legacy agent path). |
| `backend/src/gnc_config` | GNC configuration and telemetry dashboard support. |
| `frontend/src/pages/agent` | Mission authoring, archived results, comparisons, and run-scoped discussion. |
| `tools` | External workflow scripts and templates called by the backend. |

## Data and cleanup policy

- A mission run is evidence. Its manifest, `satellite.json`, workflow log, and
  generated outputs are never removed by a frontend action or an assistant
  discussion.
- `data/` and `tools/` contain runtime inputs and tool contracts. They are not
  candidates for deletion merely because TypeScript does not import them.
- `tmp/`, build outputs, Python caches, and TypeScript build information are
  generated local files. They are ignored and may be deleted safely.
- `reports/` contains versioned validation evidence. Keep it unless a
  replacement report has been reviewed.

## Commenting convention

Comments are written in English. They explain an invariant, an external-tool
constraint, a unit conversion, a security boundary, or a non-obvious reason
for a decision. They do not repeat the code directly below them.

## Tutorials

- [Implement a new GMAT mission scenario](tutorials/IMPLEMENT_A_MISSION_SCENARIO.md)
- [Add a satellite definition](tutorials/ADD_A_SATELLITE.md)
- [Use the project](tutorials/USE_THE_PROJECT.md)
