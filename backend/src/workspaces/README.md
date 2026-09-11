# backend/src/workspaces

User workspace management: manifests, versions, stages, uploads, and file queries. Ancillary — the primary project focus is GMAT mission pipelines.

## Files

| File | Purpose |
|---|---|
| `workspaceManager.ts` | Creates and manages workspace directories. |
| `workspacePaths.ts` | Resolves workspace paths and validates access. |
| `workspaceRegistry.ts` | Lists available workspaces for a user. |
| `workspaceQuery.ts` | Queries workspace contents and metadata. |
| `workspaceFiles.ts` | Reads/writes arbitrary files inside a workspace. |
| `workspaceProgressInit.ts` | Initialises progress state for a new workspace. |
| `catchSupportingTable.ts` | Helper for catch-style progress tables. |
| `workspace.routes.ts` | Workspace lifecycle API routes. |
| `workspaceData.routes.ts` | Data upload/download routes. |
| `workspaceUpload.routes.ts` | File upload endpoints. |
| `model.routes.ts` | Workspace model (BOM) routes. |
| `stageLogs.routes.ts` | Stage-log read routes. |
| `complianceCheckConfig.routes.ts` | Compliance-check configuration routes. |
| `index.ts` | Re-exports. |
