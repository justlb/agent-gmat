# backend/src/runs

Run-directory management, pipeline orchestration, and run-result views. Every GMAT run produces a dated directory under `gmat/mission-runs/`.

## Files

| File | Purpose |
|---|---|
| `missionRunService.ts` | Creates planning runs and assigns dated run directories. |
| `runWorkspace.ts` | Resolves run paths under `gmat/mission-runs/YYYY-MM-DD_HH-MM[_NN]`. |
| `runManifest.ts` | Loads/saves `run_manifest.json` (templateId, satelliteId, status, runs). |
| `runLifecycle.ts` | Updates workflow status and locks completed runs. |
| `artifactRegistry.ts` | Declares which files each template produces and their kinds. |
| `missionPipeline.routes.ts` | Orchestrates GMAT → Simu-CIC → OPALIS → RF-COMLINK. |
| `missionPipelineLock.ts` | Prevents parallel pipeline launches on the same run directory. |
| `runResults.ts` | Reads artifacts, computes timeseries, and builds run-analysis contexts. |
| `runView.routes.ts` | API routes for listing and reading run results. |
| `runViewModel.ts` | Aggregates run artifacts into the view model consumed by the Results page. |

## Key invariant

A run that has completed GMAT is **immutable**: its script, satellite.json, manifest, and artifacts must not be modified by a new execution. Create a new run to retry or change scenarios.
