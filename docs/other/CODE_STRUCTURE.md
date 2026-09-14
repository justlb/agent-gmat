# Code Structure

This repository is a local engineering workspace for spacecraft mission
studies. The frontend presents a mission and saved outputs; the backend owns
workspace access, tool invocation, run persistence, and model requests.

## 1. Directory tree

The tree intentionally shows maintained source and documentation areas only;
generated dependencies, build outputs, and per-user mission runs are omitted.

```text
agent-gmat/
├── backend/
│   ├── src/                 # Fastify API, domain modules, persistence adapters
│   ├── tests/               # Node test suites by backend module
│   ├── scripts/             # Backend development entry point and maintenance scripts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/             # API client, session and runtime configuration
│   │   ├── components/      # Reusable React UI components
│   │   ├── pages/           # Route-level views and Mission Studio screens
│   │   ├── hooks/           # Reusable React hooks
│   │   ├── utils/           # Browser-side utilities
│   │   └── main.tsx         # React/Vite entry point
│   └── package.json
├── tools/                   # GMAT, Simu-CIC, OPALIS and RF-COMLINK adapters
├── data/
│   ├── satellite-library/   # Versioned reference satellite definitions
│   ├── input_data/          # Repository-owned engineering inputs
│   └── user/                # Local, run-scoped mission evidence; not committed
├── scripts/                 # Local stack launcher and configuration validation
├── docs/                    # Operational guides, contracts and architecture notes
├── config.example.json      # Tracked configuration template
└── config.json              # Local ignored configuration and credentials
```

## 2. Role of each area

| Area | Responsibility |
| --- | --- |
| `frontend/src` | Presentation layer: React pages, components, API calls, local UI state and charts. |
| `backend/src` | Application layer: HTTP routes, validation, domain orchestration, storage and external-tool adapters. |
| `tools` | Tool-specific scripts/templates. They are invoked by the backend; they are not frontend code. |
| `data/satellite-library` | Immutable, versioned satellite reference definitions. |
| `data/user` | Run-local user data and generated engineering evidence. |
| `backend/tests` | Unit, integration and end-to-end tests grouped by backend domain. |
| `docs` | User guides, source contracts, file maps and architecture decision records. |
| `scripts` | Start, stop, validation and local-environment support scripts. |

## 3. Architecture and boundaries

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

This is a modular monolith with a layered flow rather than a strict MVC
application. The practical layers are:

1. Presentation: React pages and reusable components in `frontend/src`.
2. Delivery: Fastify route modules in `backend/src/**/**.routes.ts`.
3. Application/domain: services, adapters and validators that create a
   run-scoped input contract or output artifact.
4. Data/integration: run directories, JSON/YAML stores, external executables,
   scientific-tool scripts and LLM endpoints.

The canonical engineering data flow is:

```text
Satellite library / Mission Studio
  -> dated mission run + satellite.json
  -> GMAT OEM
  -> Simu-CIC CIC files
  -> OPALIS case and results
  -> RF-COMLINK scenario and results
  -> Results UI and run-scoped analysis
```

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

## 4. Naming conventions

- TypeScript and JavaScript variables/functions use `camelCase`.
- React components, types and interfaces use `PascalCase`.
- File names use the feature name plus a role suffix: `*.routes.ts`,
  `*.service.ts`, `*Adapter.ts`, `*Store.ts`, `*Results.ts` and `*.test.ts`.
- React route-level pages use `PascalCase.tsx`; shared hooks start with `use`.
- Persisted JSON fields use the schema already established by their owning
  contract. Do not rename a persisted field casually; it may be read by an
  existing mission run or external tool.
- Python scripts follow `snake_case.py`; their command-line flags use
  `--kebab-case`.

## 5. Main dependencies

| Dependency | Role |
| --- | --- |
| React, Vite and TypeScript | Frontend rendering, development server and build. |
| Fastify | Backend HTTP API and route registration. |
| Node filesystem APIs | Run-scoped JSON/artifact persistence and path validation. |
| pythonnet + .NET Framework | Windows-only OPALIS 2.3 API bridge. |
| Scilab / Simu-CIC, GMAT, OPALIS, RF-COMLINK | External engineering calculations; configured locally, not npm dependencies. |
| OpenAI-compatible API / Codex SDK | Optional Mission Studio and run-analysis requests. |

The frontend depends on the backend HTTP contract, not on backend files. Tool
scripts depend on run-local artifacts prepared by backend adapters, not on
frontend state.

## 6. Entry points and configuration

| Entry point | Purpose |
| --- | --- |
| `scripts/start_local_web.py` | Supported WSL command to validate and start backend/frontend tmux sessions. |
| `backend/src/index.ts` | Fastify server composition and backend runtime entry point. |
| `frontend/src/main.tsx` | React/Vite browser entry point. |
| `config.json` | Active local ports, workspace paths, credentials and external-tool paths; ignored by Git. |
| `config.example.json` | Safe tracked configuration template. |
| `scripts/validate_config.mjs` | Checks configuration structure and local paths before startup. |

## 7. Rules and good practices

- Keep route handlers thin: validate requests, call a domain function, and
  return a clear HTTP result. Do not embed scientific calculation logic in UI
  components or routes.
- Put a new external-tool integration in a dedicated backend module and tool
  directory. Keep all generated output under the dated mission run.
- Read/write mission artifacts through existing run/path helpers; never build
  an unchecked path from user input.
- Frontend code must use the API client and must not directly edit files or
  start external tools.
- Preserve reference templates and satellite-library data. Create a run-local
  copy before applying mission-specific changes.
- Prefer explicit imports from the owning module. Avoid circular imports and
  broad cross-feature access to private implementation files.
- Do not commit `config.json`, credentials, generated mission outputs,
  `node_modules`, build outputs or Python caches.

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
