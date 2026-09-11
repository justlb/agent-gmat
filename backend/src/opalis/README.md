# backend/src/opalis

Simu-CIC and OPALIS pipeline: preparation, execution, result parsing, and workflow state.

## Files

| File | Purpose |
|---|---|
| `simuCic.routes.ts` | API routes for converting GMAT OEM to CIC format and launching Simu-CIC. |
| `simuCicDefinition.ts` | Builds the run-local ground-station/attitude definition consumed by Simu-CIC. |
| `simuCicResults.ts` | Parses Simu-CIC attitude and geometry CIC files. |
| `opalisPreparation.routes.ts` | API routes for validating OPALIS inputs before launch. |
| `opalisRun.routes.ts` | API routes for launching OPALIS via the Python pipeline. |
| `opalisResults.ts` | Parses OPALIS result JSON and computes consolidated metrics. |
| `opalisDigitalThreadAdapter.ts` | Maps satellite.json fields to OPALIS case parameters. |
| `consolidatedRunReport.ts` | Merges GMAT, Simu-CIC, OPALIS and RF-COMLINK results into the consolidated run report. |
| `groundStationCatalog.ts` | Lists the predefined Simu-CIC ground stations and validates requested IDs. RF-COMLINK compatibility is resolved separately from its installed database. |
| `workflowRunLog.ts` | Persists per-stage workflow status and errors in the run directory. |

## Key contract

Only one GMAT run feeds one OPALIS execution. Dynamic inputs come from the run's own CIC directory; static inputs come from the run's `satellite.json`. See `docs/OPALIS_INPUT_CONTRACT.md`.
