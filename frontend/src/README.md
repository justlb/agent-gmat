# frontend/src

React + TypeScript source. This is the React 19 application that presents the GMAT mission workspace, Results, and legacy Agent pages. It never executes GMAT — every calculation and persisted artifact is owned by the backend.

## Top-level directories

| Directory | Purpose |
|---|---|
| `pages/` | Application pages: Agent, workspace, 3D viewer, GNC, compliance. |
| `components/` | Reusable UI components shared across pages. |
| `hooks/` | Custom React hooks (task streams, workspace state). |
| `app/` | Runtime config, HTTP helpers, session utilities. |
| `utils/` | Pure utility functions (event filtering, perf). |
| `styles/` | Global CSS. |

See `frontend/STRUCTURE.md` for the full directory map.
