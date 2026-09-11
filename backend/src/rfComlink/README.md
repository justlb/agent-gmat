# backend/src/rfComlink

RF-COMLINK pipeline: scenario preparation, batch probing, saved-result inventory,
and run-scoped LLM analysis. RF-COMLINK itself remains the source of the
link-budget calculation.

## Files

| File | Purpose |
|---|---|
| `rfComlink.routes.ts` | Main API routes for RF-COMLINK scenario lifecycle. |
| `rfComlinkPreparation.routes.ts` | Validates and prepares `.rfcl` ZIP scenarios from satellite + CIC inputs. |
| `rfComlinkBatchProbe.ts` | Probes the RF-COMLINK batch executable and its examples. |
| `rfComlinkResults.ts` | Loads the run-local saved result summary (report text and link-file inventory). It does not yet parse link-budget values. |
| `rfComlinkAnalysis.ts` | Sends saved RF-COMLINK evidence to the run-scoped analysis assistant; it does not execute or recalculate RF-COMLINK. |
| `rfComlinkDigitalThreadAdapter.ts` | Maps satellite.json and ground-station data into RF-COMLINK inputs. |
| `groundStationCatalog.ts` | Lists compatible ground stations and their RF frequency bands (shared with opalis). |

## Important limitation

The saved-result extractor currently stores the HTML report text emitted by
RF-COMLINK. A completed RF-COMLINK stage therefore only proves that the
scenario was saved and extracted; it does **not** prove that usable link-budget
values were present. Do not add margin, Eb/N0, availability, or data-volume
numbers to a summary table until a deterministic parser validates the relevant
non-empty RF-COMLINK result files.
