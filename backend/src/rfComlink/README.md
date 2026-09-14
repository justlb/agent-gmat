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
| `rfComlinkResults.ts` | Loads the run-local saved result summary, including recognised labelled indicators and parsed link-budget values. |
| `rfComlinkAnalysis.ts` | Sends saved RF-COMLINK evidence to the run-scoped analysis assistant; it does not execute or recalculate RF-COMLINK. |
| `rfComlinkDigitalThreadAdapter.ts` | Maps satellite.json and ground-station data into RF-COMLINK inputs. |
| `groundStationCatalog.ts` | Lists compatible ground stations and their RF frequency bands (shared with opalis). |

## Important limitation

The saved-result extractor recognises labelled report values and parsed
link-budget tables. A completed RF-COMLINK stage still does not certify an
engineering conclusion: inspect the raw, non-empty report and calculated
`.rfcl` package. Treat a missing or unavailable parsed value as unavailable
evidence, not as zero or a pass.
