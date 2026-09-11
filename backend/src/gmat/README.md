# backend/src/gmat

Core GMAT mission pipeline: templates, drafts, rendering, execution, and analysis.

## Files

| File | Purpose |
|---|---|
| `templateRegistry.ts` | Central registry of all GMAT template IDs and their metadata. |
| `activeCalculationRegistry.ts` | Tracks in-flight GMAT preparations to prevent duplicates. |
| `artifactHistory.ts` | Lists previous artifact versions for download/history. |
| `missionTemplateRuntime.ts` | Generic lifecycle adapter (create/discuss/confirm/execute) shared by all templates. |
| `missionTemplates.routes.ts` | Generic API routes for every registered GMAT template. |
| `missionAssistant.routes.ts` | Chat endpoints for the Mission Studio GMAT assistant. |
| `missionWorkspace.ts` | Resolves mission workspace paths (run directory vs planning run). |
| `missionRunLifecycle.ts` | Finalises run metadata and status after GMAT execution. |
| `gmatDigitalThreadAdapter.ts` | Converts satellite.json + mission inputs into GMAT render values. |
| `chemicalHohmann.service.ts` | Renderer + report parser for the chemical Hohmann transfer script. |
| `chemicalHohmannDraft.ts` | Draft state, validation, and PATCH endpoint for the chemical Hohmann template. |
| `chemicalHohmann.routes.ts` | Legacy API routes specific to the chemical Hohmann template. |
| `chemicalHohmannTemplate.ts` | Loads the chemical Hohmann reference script. |
| `chemicalHohmannAnalysis.ts` | Computes derived metrics (delta-v, fuel mass) from Hohmann results. |
| `chemical3dTransfer.ts` | Experimental 3D chemical transfer (not exposed in the UI). |
| `orbitKeeping.service.ts` | Renderer for the orbit-keeping GMAT script. |
| `orbitKeepingDraft.ts` | Draft state and validation for orbit-keeping (chemical reboost). |
| `orbitKeepingTemplate.ts` | Loads the orbit-keeping reference script. |
| `orbitKeepingValues.ts` | Default values and slot extraction for orbit-keeping. |
| `orbitKeepingRunner.ts` | Executes the orbit-keeping pipeline and collects artifacts. |
| `orbitKeepingAnalysis.ts` | Computes orbit-keeping metrics (mass decrease, altitude bounds). |
| `orbitKeepingLlmEdit.ts` | LLM-assisted draft editing for orbit-keeping. |

## Template directories

Each template lives under `backend/workflow_agents/gmat_skills/<id>-template/` and owns a `template.json` manifest, a reference `.script`, and (optionally) a `.values.yaml`.
