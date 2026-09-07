# Frontend

The frontend is a React and TypeScript application built with Vite. It presents
the mission workspace, the agent-driven mission editor, saved simulation
results, and engineering visualizations. It does not execute scientific tools:
every calculation and persisted artifact is owned by the backend.

## Structure

- `src/app`: runtime configuration and shared HTTP helpers.
- `src/components`: reusable visual and content components.
- `src/hooks`: stateful integrations with workspace and task APIs.
- `src/pages`: application pages and workspace panels.
- `src/pages/agent`: mission drafting, execution controls, saved results, and
  result discussion. Components in this directory must preserve the selected
  run path when requesting data from the backend.
- `tests`: unit and component tests arranged by the corresponding source area.

## Important invariants

- The Results page reads immutable artifacts from the selected run. It never
  starts GMAT, Simu-CIC, OPALIS, or RF-COMLINK work in the browser.
- A result discussion is scoped to one `runPath`; a response that finishes
  after the user switches runs must not appear in the new discussion.
- Time-series visualizations show saved samples only. Missing values remain
  unavailable instead of being invented by the UI.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test
```

Run these commands from `frontend/`. The root launch scripts install frontend
and backend dependencies independently.
