# Frontend Structure

This document is a navigation aid for every directory and top-level file inside
`frontend/`. The frontend is a React 19 + TypeScript application built with
Vite. It presents the mission workspace, the agent-driven mission editor,
saved simulation results, and engineering visualizations. **It never executes
scientific tools**: every calculation and persisted artifact is owned by the
backend.

## Quick map

| Category | Items |
| --- | --- |
| Live source code | `src/` |
| Tests | `tests/` (use `npm test`; counts change over time) |
| Generated (gitignored) | `dist/`, `node_modules/` |
| Manifest & config | `package.json`, `package-lock.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `eslint.config.js`, `components.json` |
| Static assets | `public/` |
| Extra feature module | `gnc_config/` |

---

## Directories

### `src/` — Live React + TypeScript source

#### Entry and bootstrap (files at `src/` root)

| File | Purpose |
| --- | --- |
| `main.tsx` | Application entry. Sets up React, lazy-loads pages, wires a minimal pathname-based router, installs the dev performance timeline guard, and imports i18n and the global stylesheet. |
| `i18n.ts` | i18next initialization with embedded `en`/`fr` translation resources (via `react-i18next`). |
| `types.ts`, `vite-env.d.ts`, `three-webgpu.d.ts` | Shared types and ambient type declarations. |

#### `src/app/` — Runtime configuration and HTTP helpers

Runtime config and shared API client utilities used across pages:
`apiBase.ts`, `apiClient.ts`, `runtimeConfig.ts`, `sessionUtils.ts`,
`workspaceConfig.ts`.

#### `src/components/` — Reusable visual components

Currently hosts `execution-flow/` (`ExecutionFlow.tsx` + its CSS), the visual
component that renders the staged pipeline flow.

#### `src/hooks/` — Stateful integrations with backend APIs

`useBomInfo.ts`, `useTaskStream.ts`, `useWorkspaceAppState.ts` — React hooks
that subscribe to workspace state, bill-of-materials data, and the task event
stream.

#### `src/pages/` — Application pages and workspace panels

Root-level page components (lazy-loaded from `main.tsx`):

| Page | Role |
| --- | --- |
| `AgentPage.tsx` | Main mission agent/authoring surface. |
| `V3Page.tsx` | V3 alternate mission surface. |
| `WorkspaceSessionPage.tsx` | Workspace session view. |
| `GncWorkspacePage.tsx` | GNC telemetry workspace. |
| `RegionWorkspacePage.tsx` | Regional workspace variant. |
| `ModelViewerPage.tsx`, `EarthPage.tsx` | 3D model and Earth visualizations (Three.js). |
| `SplineBotPage.tsx` | Spline-based bot/assistant page. |
| `HomePage.tsx` | Landing/home page. |
| `ComplianceCheckPanel.tsx`, `WorkspacePageShell.tsx` | Shared shell and compliance-check panel. |

Subfolders:

- `src/pages/agent/` — Mission authoring, execution controls, saved results,
  and result discussion. Includes `MissionStudio.tsx`, `MissionV2.tsx`,
  `SatelliteLibrary.tsx`, `TemplateLibrary.tsx`, `MissionOverview.tsx`,
  `ResultsPage.tsx`, `ResultsDiscussion.tsx`, `ResultCharts.tsx`,
  `ShikiCodePreview.tsx`, plus one `*Api.ts` client per backend capability
  (`chemicalHohmannApi`, `electricPropulsionApi`, `orbitKeepingApi`,
  `simuCicApi`, `rfComlinkApi`, `missionValuesApi`, `runResultsApi`,
  `runViewApi`, `missionAssistantApi`, `satelliteLibraryApi`,
  `missionTemplateCatalogApi`, `missionRoutingApi`, `planningRunApi`,
  `gmatMissionTemplates`, `gmatMissionTypes`, `missionTemplateRuntime`), and
  voice/recorder utilities (`useAgentRecorder`, `useAgentSpeech`,
  `AgentVoiceExchange`, `AgentRecorderControl`).
  - `src/pages/agent/files/` — File-centric agent views: `AgentFilesView.tsx`,
    `GmatMissionChat.tsx`, file upload button and API.
- `src/pages/workspace/` — Workspace panels: BOM inspector and stage panels,
  run logs, conversation log, GNC dashboard and telemetry charts, progress
  card, version flow, and session visibility/version helpers.
- `src/pages/viewer3d/` — 3D viewer helpers: `annotations.ts`, `modelSource.ts`,
  `modelUtils.ts`, `types.ts`.

#### `src/utils/` — Frontend utilities

`codexEventFilter.ts` (filters Codex streaming events), `performanceTimeline.ts`
and `devPerformancePrelude.ts` (dev-only performance instrumentation).

#### `src/styles/` — Global styles

`app.css` (Tailwind-based global stylesheet).

### `tests/` — Unit and component tests

Tests run with **Vitest** (`npm test`) and are arranged by source area.
`app/` (apiClient, sessionUtils), `components/` (bomData, outputMarkdown),
`hooks/` (useWorkspaceAppState), `pages/agent/` (gmatMissionTemplates,
missionInputValue, MissionOverview, missionValuesApi, orbitKeepingApi,
ResultsPage, runResultsApi, WorkspaceFilePreviewPanel), `pages/viewer3d/`
(modelSource), `pages/workspace/` (progressUtils, workspaceVersion), and
`utils/` (codexEventFilter). A shared setup lives in `tests/test/setup.ts`.

### `dist/` — Built output (generated, gitignored)

Bundle produced by `npm run build` (`tsc -b && vite build`). Served by
`npm run preview`. Never edited by hand.

### `node_modules/` — Installed dependencies (generated, gitignored)

Installed by `npm install`. Never edited by hand.

### `gnc_config/` — GNC configuration editor feature

A standalone feature module with `GncConfigEditor.tsx` and its CSS.

### `public/` — Static assets

Served as-is by Vite: `favicon.svg`, `icons.svg`, `logo_1.png`, and other
static images.

---

## Top-level files

### `package.json` — Module manifest

Declares the module (`frontend`, private), the npm scripts (`dev`,
`dev:https`, `build`, `lint`, `preview`, `test`), the runtime dependencies
(React 19, `d3`, `@xyflow/react`, `three`, `@splinetool/react-spline`,
`i18next`/`react-i18next`, `react-markdown` + `remark-gfm`, `shiki`,
`docx-preview`, `read-excel-file`), and the devDependencies (Vite, Vitest,
Tailwind, ESLint, TypeScript, type packages).

### `package-lock.json` — Dependency version lock

Deterministic snapshot of every dependency version. Should be committed.

### `vite.config.ts` — Vite build configuration

Configures Vite with the React plugin, basic SSL (for the HTTPS dev port),
and Tailwind. It reads the root `config.json` to resolve `server.port`
(proxy target), frontend host/ports, and the GNC dashboard telemetry paths.

### `vitest.config.ts` — Test configuration

Vitest configuration (environment, setup file, etc.).

### `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — TypeScript configs

Project references split between the app code and the Node/Vite tooling.

### `eslint.config.js` — Lint configuration

ESLint flat config with React hooks and React Refresh plugins.

### `components.json` — shadcn/ui configuration

Component registry configuration for shadcn/ui.

### `index.html` — HTML entry

The Vite HTML entry that loads `main.tsx`.

### `README.md` — Existing frontend README

Documents the structure, the important invariants (the Results page never
starts a scientific tool; a result discussion is scoped to one `runPath`;
time-series visualizations show saved samples only and never invent values),
and the commands.

---

## Important runtime invariants

- The Results page reads **immutable artifacts** from the selected run. It
  never starts GMAT, Simu-CIC, OPALIS, or RF-COMLINK work in the browser.
- A result discussion is scoped to one `runPath`; a response that finishes
  after the user switches runs must not appear in the new discussion.
- Time-series visualizations show saved samples only. Missing values stay
  unavailable instead of being invented by the UI.

## How the pieces connect at runtime

1. `npm run dev` boots Vite, which serves `index.html` and loads `main.tsx`.
2. `main.tsx` sets up i18n, the dev performance guard, and a lazy pathname
   router that mounts the page matching the current URL.
3. Pages call the backend exclusively through the `*Api.ts` clients in
   `src/app` and `src/pages/agent`, so no scientific calculation ever runs
   in the browser.
