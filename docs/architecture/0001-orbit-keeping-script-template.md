# ADR-0001 — Deterministic generation of a GMAT orbit-keeping script

> **Status: superseded.** This ADR records the original MVP-0 decision that
> selected Handlebars and a two-file template (.script.hbs + .values.yaml).
> The current project uses slot-based auto-extraction directly from .script
> files; Handlebars and the 193-slot YAML were removed. The historical
> decision chain is preserved below.

Status: accepted for MVP-0

## Context

The product must adapt a GMAT orbit-keeping mission to a natural-language request. All produced missions must preserve the structure of the `AutonomousLEOReboost` reference script: same general organization, same GMAT resources, and same mission sequence.

All values must be adjustable, including the initial orbit, target orbit, minimum altitude, masses, areas, atmospheric parameters, propagator, solver, burns, thresholds, durations, and outputs.

LLM calls are slow. The project must therefore use a single LLM call per request and remain deterministic for all other steps. The LLM must not correct encountered errors.

## Decision

The initial pipeline uses a single mission template: `orbit_keeping`.

The template consists of two complementary files:

- `orbit_keeping.script.hbs` contains the fixed GMAT structure derived from the reference script;
- `orbit_keeping.values.yaml` contains all replaceable values in the script.

The generation flow is strictly linear:

1. the backend copies the default values file into an isolated execution workspace;
2. a single LLM call receives the request, the values file, and instructions forbidding any other modification;
3. the returned YAML is parsed and validated without any further LLM call;
4. the template engine produces `mission.script` deterministically;
5. the workflow publishes the script, the values diff, and, on failure, a structured error.

A YAML syntax error, a missing value, or an impossible render stops the generation. There is no automatic LLM repair loop.

## Responsibilities

### LLM

- interpret the user request;
- modify only the values in the working YAML file;
- perform all requested changes during the single call.

### Deterministic code

- prepare the workspace and copy default values;
- parse and validate the YAML;
- compute the diff with default values;
- render the template in strict mode;
- atomically write `mission.script`;
- return an error without attempting to correct it.

### Orbit-keeping template

- preserve the structure of the reference script;
- expose each useful literal value under an explicit name;
- contain no hidden dynamic business logic in the renderer.

## Minimal technical choices

- TypeScript, in the existing backend;
- `yaml` package to read and write values;
- Handlebars in strict mode to render the GMAT text file;
- no GMAT execution in the current scope;
- no generic GMAT generator and no manoeuvre planner.

The `open_codex_web-master` project may provide GMAT property names and sample outputs. Its orchestrator, correction pipeline, and generic generator are not reused without independent validation.

## Verifiable invariants

1. A request triggers at most one LLM call.
2. The renderer never contacts a model.
3. Default values produce a script equivalent to the reference script.
4. Changing a YAML value modifies only the corresponding locations in the `.script`.
5. A missing key causes an explicit error in strict mode.
6. The workflow does not launch GMAT and does not automatically repair errors.

## Progression

MVP-1 validated connectivity to the configured LLM in a single call. MVP-2a now materialises the orbit-keeping reference script and verifies its deterministic rendering, without any LLM call or GMAT execution.
