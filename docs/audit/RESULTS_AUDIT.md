# Results Page and Analysis Audit

**Updated:** 14 September 2026

This audit replaces the 6 September audit for the Results area. It records the
current design boundaries and the remaining work; it is not a release manifest.

## Scope

The review covers saved-run results, charts, artifact downloads, single-run and
multi-run discussion, and the data supplied to the analysis assistant. A visual
browser review, a real model evaluation, and a complete scientific-tool run are
still required before release certification.

## Improvements confirmed in the design

- Results are run-local: the page reads saved GMAT, Simu-CIC, OPALIS, and
  RF-COMLINK artifacts and does not start a calculation.
- A multi-run comparison can display several selected runs and sends each
  selected run's evidence context to the comparison assistant.
- The backend creates a compact run-analysis context containing configuration,
  workflow state, normalized results, verdicts, and named source files.
- Results expose downloadable generated artifacts. Raw artifacts remain more
  authoritative than any overview, chart, or assistant answer.
- RF-COMLINK results include parsed per-link budget data when populated report
  values are available. Missing values remain unavailable evidence.
- The legacy altitude fallback is identified as a semi-major-axis offset, not
  an instantaneous altitude for an elliptical orbit.

## Open findings

| Priority | Finding | Required action |
| --- | --- | --- |
| High | Assistant responses are free text. Prompt instructions request source files, but references are not structured or validated. | Return claims with validated run IDs and artifact references; render openable evidence links. |
| High | Complete persisted discussion history can be sent to the model without an explicit context budget or summary. | Keep bounded recent turns plus a summary and enforce a size budget. |
| High | The Results calculation contract and implementation must remain aligned for Orbit Keeping duration, especially legacy elapsed-time fields. | Test both `elapsedSeconds` and historical artifacts; update documentation with the exact formula. |
| Medium | Results analysis and GMAT-draft discussion can share the same persisted channel. | Add a `results-analysis` channel and filter or group conversations in the UI. |
| Medium | Discussion has no streaming, cancellation, idempotency key, or controlled resume. | Add cancellation and safe retry/resume behaviour. |
| Medium | Idle run-list polling can continue every five seconds and stale data is not clearly marked. | Pause or slow idle polling and display the last refresh time. |
| Medium | Comparison presents values side by side but needs deterministic deltas and compatibility warnings. | Add unit-aware deltas and template/configuration compatibility checks. |
| Low | Frontend bundle size and React Hook dependency warnings should be monitored. | Split non-critical views where useful and resolve hook warnings. |

## Evidence rules

- A completed workflow stage does not by itself certify an engineering result.
- The assistant must not launch a tool or modify a completed run.
- CIC contact, eclipse, and latency values are sampled engineering summaries;
  see [Results Calculation Contract](RESULTS_CALCULATION_CONTRACT.md).
- RF-COMLINK links must remain separate; do not average different uplink or
  downlink budgets.

## Validation required before the next release

```bash
cd backend
npm run build
npm run test:gmat:baseline
npm run test:stability
npm test

cd ../frontend
npm run build
npm run lint
npm test
```

Then review a complete, failed, partial, elliptical-orbit, and multi-run case
in a browser. Verify source isolation, missing-evidence messages, retries, and
every enabled external-tool primary report.
