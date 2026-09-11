# backend/src/analysis

LLM-driven analysis context builders for the Results page discussion.

## Files

| File | Purpose |
|---|---|
| `runAnalysisContext.ts` | Aggregates GMAT, Simu-CIC, OPALIS, RF-COMLINK artifacts into a structured context for the LLM. |
| `runAnalysisLlm.ts` | Single-run analysis: sends saved context and a question to the model, then persists a prose answer. Source citations are requested in the prompt but are not machine-validated. |
| `multiRunAnalysisLlm.ts` | Multi-run comparison analysis for 2–5 selected runs. It builds deterministic comparison rows before requesting the explanatory prose. |

The model is an explanation layer, not a calculation engine. A caller must
surface missing evidence and must not treat unverified prose citations as a
substitute for the saved artifacts.
