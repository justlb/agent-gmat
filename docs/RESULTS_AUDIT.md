# Results page and analysis audit

**Audit date:** 14 September 2026

**Previous audit:** 6 September 2026

**Scope:** static review of the Results page, run-view API, analysis context,
single-run and multi-run assistant paths, and their focused tests. This audit
does not include a visual browser review, a real AI-model evaluation, or a
full execution of GMAT, Simu-CIC, OPALIS, and RF-COMLINK.

The current code and tests are the source of truth. This document records the
state observed on the audit date; it is not a release manifest.

## Executive summary

The Results area is substantially more complete than it was on 6 September.
It now presents a backend-owned, run-local view, supports comparison of up to
five runs, exposes downloadable artifacts, and displays parsed RF-COMLINK link
budgets. The assistant receives an evidence context for the selected run(s)
and is instructed not to rerun tools.

The remaining priorities are evidence traceability in assistant answers,
bounded analysis context, cancellation/streaming, separation of discussion
channels, and two failing backend regression tests. The Results calculation
contract also needs a correction for orbit-keeping duration terminology.

## Changes verified since 6 September

| Previous finding | Current state | Evidence |
| --- | --- | --- |
| Altitude derived from semi-major axis was not identified. | **Improved.** The legacy electric-transfer fallback is explicitly documented in code as a semi-major-axis offset, not instantaneous altitude for an ellipse. | `frontend/src/pages/agent/runResultsApi.ts` |
| Charts and Results presentation were entangled in an old panel. | **Improved.** Chart rendering is isolated in `ResultCharts.tsx`; the Results page uses a unified run table, calculation details, artifact downloads, and charts. | `frontend/src/pages/agent/ResultCharts.tsx`, `ResultsPage.tsx` |
| Comparison was based only on template ID and did not give the assistant both runs. | **Improved.** The UI selects up to five runs, displays side-by-side inputs/results and overlays series. The multi-run endpoint sends a separate evidence context for every selected run plus a deterministic comparison table. | `ResultsPage.tsx`, `multiRunAnalysisLlm.ts` |
| RF-COMLINK only exposed an inventory of HTML files. | **Improved.** Parsed link budgets are shown separately per link, including nominal, 3σ, and worst-case RSS values. The displayed pass/fail rule is the worst-case RSS data-recovery margin. | `runViewModel.ts`, `rfComlinkResults.ts`, `ResultsPage.tsx` |
| Results evidence lacked a compact, run-scoped aggregation. | **Improved.** `run-analysis-context.json` aggregates run configuration, workflow status, normalized GMAT/OPALIS/RF outputs, CIC file inventory, verdicts, and source paths. | `backend/src/analysis/runAnalysisContext.ts` |
| A stage could be treated as sufficient engineering evidence. | **Improved.** The UI exposes calculation details and generated files, and the prompts instruct the assistant to name missing evidence and not claim tool reruns. | `ResultsPage.tsx`, `runAnalysisLlm.ts`, `multiRunAnalysisLlm.ts` |

## Open findings and recommended actions

| Priority | Finding | Risk | Recommended action |
| --- | --- | --- | --- |
| High | Assistant answers are still free text. The prompt requests a tool and source file for each factual claim, but the response has no validated structured references or clickable evidence links. | An answer can appear sourced without proving that every conclusion matches an authorised artifact. | Return a structured response containing claims and source references from the run artifact catalogue; validate references server-side and render links in the UI. |
| High | The single-run prompt includes the complete saved `conversation.json`, and no explicit byte/token budget, summary, or relevance selection is applied. | Long histories can exceed model context, increase latency/cost, and make evidence less relevant. | Keep a bounded recent history plus a server-generated summary; impose a size budget for manifest, context, and conversation. |
| High | Two focused backend tests fail (details below). | A passing build does not guarantee that analysis context and Chemical 3D result projection are regression-safe. | Align the fixtures and implementation with the current canonical `satellite.json` schema, then keep both tests passing in CI. |
| Medium | Results analysis is written with the `gmat-draft` channel, so preparatory mission discussion and results discussion remain mixed in one persisted conversation. | The UI may restore unrelated preparation messages when reviewing results. | Add a `results-analysis` channel, preserve legacy reading, and filter/group channels in the Results UI. |
| Medium | The assistant has no streaming output, cancellation, request identifier, or resume protocol. It only displays an `Analyzing…` placeholder and offers reload after an error. | A timeout or lost response can leave the engineer waiting or retrying without controlled deduplication. | Use a cancellable request with an idempotency key; add streaming or explicit polling and a safe retry/resume flow. |
| Medium | `ResultsDiscussion` uses `ReactMarkdown` without `remark-gfm`, although the package is installed. There are no copy controls or context-specific suggested questions. | Markdown tables may not render as expected and the analysis workflow remains less usable than intended. | Enable GFM deliberately, add copy, and provide evidence-oriented suggestions such as “summarise”, “explain alerts”, and “what is missing?”. |
| Medium | The run list polls every five seconds even when the page is idle or hidden. | Unnecessary API activity and refresh churn. | Slow or pause polling when no stage is running and resume on visibility/focus; retain the manual refresh button. |
| Medium | Run views and time series retain prior values during refresh and do not display a freshness timestamp. | Engineers can read stale results without an explicit indication. | Distinguish initial loading, refresh, and stale data; show the last successful refresh time. |
| Medium | The comparison view aligns inputs and results side by side, but does not calculate/display explicit metric deltas or compatibility diagnostics beyond template family text in the assistant prompt. | Users can compare inapplicable values or miss meaningful numerical differences. | Add deterministic deltas with units and template/configuration compatibility warnings before assistant interpretation. |
| Medium | `RESULTS_CALCULATION_CONTRACT.md` says orbit-keeping duration is `final_epoch - initial_epoch`, while current code interprets the stored legacy `epochA1ModJulian` field as elapsed seconds and divides the final value by 86,400. | Documentation and implementation disagree on a mission-duration definition. | Correct the contract and add a test that covers both the correctly named `elapsedSeconds` field and legacy artifacts. |
| Low | The frontend production build emits chunks larger than 650 kB after minification. | Initial load performance may degrade on constrained workstations. | Profile the largest `three` and vendor chunks; lazy-load non-Results views where appropriate. |
| Low | ESLint reports three React Hook dependency warnings in `ResultsDiscussion.tsx` and `ResultsPage.tsx`. | Future refactors can introduce stale closures or unnecessary reloads. | Refactor dependency values into stable variables and resolve the warnings rather than suppressing them. |

## Evidence and safety boundaries verified

- Results reads saved run artifacts; it does not itself start GMAT, Simu-CIC,
  OPALIS, or RF-COMLINK.
- The single-run analysis endpoint receives a run path and question and uses a
  run-local analysis context.
- Multi-run analysis is capped at five runs and sends every selected run's
  context to the model. It returns a deterministic comparison row alongside
  the free-text answer.
- The artifact list is built from the backend registry and only exposes files
  present in the selected run directory.
- RF-COMLINK link budgets remain separate per link; they are not averaged.
- CIC contact, eclipse, and latency values remain sampled engineering
  summaries. Their definitions, units, and limitations are in the
  [Results Calculation Contract](RESULTS_CALCULATION_CONTRACT.md).

## Validation performed on 14 September

| Check | Result |
| --- | --- |
| `backend/npm run build` | Passed. |
| Focused backend tests: analysis context, RF-COMLINK results, run view model, and Results routes | 6 passed, 2 failed. |
| `frontend/npm run build` | Passed. Vite warned that several chunks exceed 650 kB after minification. |
| `frontend/npm run lint` | No errors; 3 React Hook dependency warnings. |
| `npx vitest run src/pages/agent --reporter=dot` | No matching frontend test files; command exited with code 1. |

### Failing backend tests

1. `tests/analysis/runAnalysisContext.test.ts` expects the analysis context to
   read a fixture under `digital-thread/satellite.json`, while the current
   context builder reads the canonical run-root `satellite.json`. The test
   observed a null satellite name instead of `Test satellite`.
2. `tests/runs/runViewModel.test.ts` expects Chemical 3D target fields to be
   projected from `analysis_requests.gmat.chemical_3d_transfer`; the observed
   `transfer.finalAltitudeKm` was `undefined` instead of `35786`.

These are test failures, not evidence that the scientific executables fail.
No full external-tool run, browser test, or live AI response was performed in
this audit.

## Recommended completion order

1. Resolve the two failing backend tests and correct the orbit-keeping
   calculation contract.
2. Add structured, validated evidence references to assistant responses.
3. Bound and summarise analysis history; then add cancellation and safe retry.
4. Separate results-analysis conversation turns from GMAT draft turns.
5. Improve idle polling, freshness indicators, comparison deltas, and
   frontend hook dependencies.
6. Run a browser review and a controlled full-pipeline campaign with known
   successful, failed, partial, elliptical-orbit, and multi-run cases.

## Exit criteria for the next audit

- All focused backend tests pass, including analysis context and Chemical 3D
  projection coverage.
- Every factual assistant claim has a validated run ID and an openable source
  artifact reference.
- Long histories, cancellation, timeout, and retry behaviour are covered by
  tests.
- A comparison clearly labels incompatible templates/configurations and shows
  deterministic metric differences with units.
- A human has reviewed the Results page in a browser using real saved runs and
  at least one complete external-tool pipeline.
