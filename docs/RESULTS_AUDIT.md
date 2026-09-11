# Finalisation audit: results, chatbot, and cleanup

Date: 6 September 2026. This is a historical audit snapshot, not the current
operational contract. For current computed metrics, see
[Results calculation contract](RESULTS_CALCULATION_CONTRACT.md); for current
ownership and known limitations, see [Project Handover](HANDOVER.md).

## Scope and limitations

Targeted static audit of the Results page, charts, conversation, routes, and analysis context, with inspection of the repository layout. This document constitutes the requested finalisation plan; no deletions or functional overhauls were performed. It does not certify the absence of dead code across the entire project. No visual inspection of the application and no evaluation with a real model were carried out.

The list of modifications below was an observation at the time of the audit,
not a release manifest. Use Git history and `git status` for the current tree.

## What already works in the design

- The page selects the summary, charts, and discussion of an execution together.
- ResultsDiscussion is keyed by runPath; a late response must not contaminate another selection. A test covers this scenario.
- POST /api/runs/analysis bypasses the intent router and analyses only the selected execution. It does not launch a simulation.
- The context gathers GMAT, Simu-CIC, OPALIS, and RF-COMLINK, with references to files and missing data.
- The prompt asks to distinguish facts from interpretations, cite sources, and respond in the language of the question.
- Conversations use existing atomic persistence. Full success requires all four stages completed.

## Findings and priorities

| Priority | Verified finding | Proposed action |
| --- | --- | --- |
| High | runResultsApi.ts derives altitudeKm from semiMajorAxisKm - 6378.1363 when altitude is missing; electricSamples does the same conversion. | Explicitly identify this quantity as derived from the semi-major axis; for instantaneous altitude, use an available radial distance. Test a non-circular orbit. |
| High | runAnalysisLlm.ts asks for citations but returns only free text; no structured validation of references. | Return structured references linked to an authorised evidence catalogue, then display openable sources. Path validity alone does not prove a conclusion: keep a response evaluation. |
| High | The manifest and the entire conversation are re-injected at each question, without an explicit context budget. | Limit context, keep recent exchanges and a conversation summary; keep full history separately. Prioritise relevant evidence. |
| Medium | The frontend waits for a complete response; no cancel button or progressive flow in this path. | Add progressive display, cancellation, and controlled resume. Provide request identifiers to avoid duplicates after a lost response. |
| Medium | Results analysis is saved with channel: gmat-draft; loading also restores preparatory discussions. | Introduce a results-analysis channel, maintain archive compatibility, and differentiate preparation from analysis in the UI. |
| Medium | ResultsDiscussion uses ReactMarkdown without remark-gfm. | Reuse existing Markdown capabilities for tables; add copy response and contextual suggestions. |
| Medium | The page refreshes the list every five seconds, even without an active execution. | Space out idle checks, suspend them when the page is hidden, keep Refresh and new-execution detection. |
| Medium | Each question regenerates the context and re-reads outputs, including CIC. | Cache by a version or fingerprint of the artifacts; invalidate during workflow advancement. Do not reuse stale context. |
| Medium | SelectedResults does not re-enable loading during a refresh; old data remains visible during reload. | Distinguish initial loading, refresh, and stale data; display the freshness of the summary and curves. |
| Medium | The comparison relies solely on templateId and overlays curves. | Show configuration, unit, and duration differences; add relevant numerical gaps. The chatbot does not currently receive the second execution. |

## Target experience

1. An initial summary: chain status, objectives achieved or not assessable, alerts, and key indicators with units and sources.
2. Per-tool details and selectable charts, with hover values and data export; keep unavailable data as such.
3. An assistant offering "Summarise this simulation", "Explain alerts", and "What data is missing?". For a comparison, explicitly transmit both executions and identify the provenance of each conclusion.
4. Short answers organised as finding, explanation, evidence, and limitations. Numbers come from deterministic results; the model serves to explain them.
5. On small screens, direct access to the discussion, rather than having to scroll through the entire page to reach the panel placed after the results.

## Cleanup and simplification

### Observed candidates, to be treated according to their nature

- backend/tsconfig.tsbuildinfo: generated cache not tracked; candidate for cleanup and a *.tsbuildinfo rule in .gitignore.
- archive/legacy: the only files found during inspection are two Python caches; verify the final inventory and documentation references before removing directories.
- package-lock.json at the root: packages is empty and no root package.json was found. Likely candidate for removal after verifying scripts. Keep frontend and backend lockfiles.
- tmp: contains RF/OPALIS inspections, but also a script and internship report renders. Do not treat the entire folder as waste; isolate deliverables and references before cleanup.
- reports/gmat-batch-60s.json and .md: reports tracked by Git, potentially validation evidence. Keep or archive them explicitly.
- node_modules and dist: reproducible outputs, not dead code. Removing them does not simplify the architecture and may prevent offline validation.
- data, workflow tools, and models: resources used indirectly by configuration, paths, or external processes. The absence of a TypeScript import does not prove they are unused.

### Targeted simplifications

- Extract ResultCharts and its pure functions from GmatAnalysisPanel.tsx. No usage of the exported GmatAnalysisPanel component was found in frontend/src; its file remains used for ResultCharts. Verify full references before removing the old panel.
- Reuse requestApiJson instead of the local client in runResultsApi, preserving cache: no-store and useful messages when the server returns something other than JSON.
- Mutualise responseText decoding, present in seven backend files, after comparing variants; keep specific business prompts.
- Decompose the long JSX lines and async effects of ResultsPage and ResultsDiscussion into readable functions. A discussion hook can group loading, sending, error, and cancellation.
- Add English comments on invariants: per-execution isolation, provenance, units, stale context, cancellation, legacy file compatibility. Avoid commenting every obvious instruction.
- Defer the decomposition of large out-of-scope modules, such as ComplianceCheckPanel.tsx (~148 KB) and AgentPage.tsx (~77 KB), to a separate intervention if truly necessary.

## Execution order and exit criteria

1. Stabilise the Windows validation environment and obtain a baseline of existing tests, preserving local modifications.
2. Clean only the identified artifacts, extract charts, and mutualise utilities; verify imports, compilation, and targeted tests after each batch.
3. Fix quantity provenance, introduce structured sources, and bound the chatbot context.
4. Add suggestions, resume, cancellation, and progressive display; clarify history-loading and sending errors.
5. Finalise the summary, comparisons, and mobile display; add English comments to touched modules.

Expected validation: no modification of mission inputs and no tool launch from the chatbot; isolation between executions even with a late response; missing evidence explicitly flagged; citations resolved in the correct execution; handling of a long history, a timeout, a network failure, and retries; comparison without source mixing; preservation of existing business behaviours.

Prepare a small corpus of questions on known executions (success, failure, partial results, missing evidence, elliptical orbit, comparison), with verified expected facts. Tests with simulated model responses do not measure the real quality of the assistant.

## Verifications performed

Code inspection and reading of existing tests, without functional modification. Attempts:

- Frontend: ResultsPage.test.tsx, runResultsApi.test.ts, and MissionOverview.test.tsx. Startup blocked by the missing native module @rollup/rollup-win32-x64-msvc.
- Backend: runAnalysisContext.test.ts, runResults.routes.test.ts, and runResults.test.ts. Startup blocked in tsx by uv_os_get_passwd / ENOMEM.

These errors occur before assertions; they do not demonstrate business regressions. No passing test result is claimed.
