# frontend/src/app

Runtime configuration and HTTP helpers used by every page.

| File | Purpose |
|---|---|
| `apiClient.ts` | Fetch helper that reads backend URL from `runtimeConfig.ts`. |
| `apiBase.ts` | Base API URL construction. |
| `runtimeConfig.ts` | Loads config (backend port, model settings) injected by Vite at build time. |
| `sessionUtils.ts` | Session key helpers. |
| `workspaceConfig.ts` | Workspace identity helpers. |
