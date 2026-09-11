# frontend/src/pages/agent

Mission Studio components mounted by `AgentWorkspacePanel`. This directory
contains both the active GMAT workflow and shared legacy Agent controls; use
the file table below rather than assuming every component is rendered on every
route.

## Key files

| File | Purpose |
|---|---|
| `MissionStudio.tsx` | Legacy Mission Studio container retained for compatibility. |
| `MissionV2.tsx` | Mission authoring: required/optional input fields, prepare and run buttons, run lock state. |
| `AgentWorkspacePanel.tsx` | Selects and mounts New simulation, satellite, template, and Results panels. |
| `ResultsPage.tsx` | Results: unified run table, charts, multi-select comparison, discussion panel. |
| `ResultCharts.tsx` | Altitude/fuel-mass charts rendered from timeseries JSON. |
| `ResultsDiscussion.tsx` | Run-scoped LLM discussion (single-run and multi-run modes). |
| `missionInputValue.ts` | Helpers for reading mission input values from draft state. |
| `runResultsApi.ts` | Frontend API client for run results. |
| `types.ts` | Shared TypeScript types for the Agent workspace. |
| `MissionOverview.tsx` | Shared **Key mission results** panel used by New simulation and Results. It only presents run-view evidence supplied by the backend. |
| `AgentConversationPopover.tsx` | Quick chat popover. |
| `AgentProgressRail.tsx` | Progress rail sidebar for long-running tasks. |
| `AgentRecorderControl.tsx` | Voice recorder UI. |
| `AgentSideNav.tsx` | Side navigation. |
| `AgentTopbar.tsx` | Top bar with workspace info and buttons. |
| `AgentVoiceExchange.tsx` | Voice input/output exchange component. |
| `WorkspaceFilePreviewPanel.tsx` | Preview of workspace files inside the agent page. |

## Subdirectories

| Directory | Purpose |
|---|---|
| `files/` | File explorer panel components. |
| `styles/` | CSS files for Mission Studio. |
