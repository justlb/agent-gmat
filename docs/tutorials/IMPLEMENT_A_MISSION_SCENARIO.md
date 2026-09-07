# Implement a New GMAT Mission Scenario

This guide adds a maintained GMAT mission scenario to the application. A
scenario is more than a GMAT script: it defines a versioned engineering
contract, accepts a satellite digital thread, produces declared artifacts, and
participates in the shared Mission Studio lifecycle.

Use an existing scenario as the closest starting point:

| Scenario | Good reference when your scenario needs |
| --- | --- |
| `orbit-keeping` | Chemical reboost and orbit-maintenance logic. |
| `electric-propulsion-transfer` | A draft driven by electric-propulsion inputs. |
| `electrical-leo-orbit-maintenance` | Electric propulsion plus an electrical downstream workflow. |
| `chemical-hohmann-transfer` | A deterministic two-impulse transfer and its dedicated artifacts. |

## Understand the lifecycle

```text
template.json + immutable GMAT reference
        -> template registry
        -> digital-thread adapter
        -> draft adapter
        -> shared create / edit / confirm / prepare / execute routes
        -> dated run with GMAT and downstream artifacts
        -> Mission V2 and Results
```

The shared routes are under `/api/gmat/templates/:template/...`. Do not create
a second family of HTTP routes for a normal scenario. The common lifecycle
already creates drafts, saves values, supports discussion, confirms the draft,
prepares the reviewed script, executes GMAT, and starts the full pipeline.

Every dated run is immutable after GMAT completes. A changed scenario must use
a new run; do not overwrite an existing trajectory or its satellite snapshot.

## 1. Create the template contract

Create this directory, using a lowercase, stable identifier:

```text
backend/workflow_agents/gmat_skills/<scenario-id>-template/
  template.json
  references/
    <scenario-id>.script
    <scenario-id>.values.yaml       # optional
```

`references/` contains source-controlled, immutable engineering references.
The generator may copy and parameterize them into a run directory, but must
never rewrite them in place.

Create `template.json`. This minimal example shows the required shape; replace
the paths, fields, and descriptions with real engineering values.

```json
{
  "id": "inclined-orbit-keeping",
  "name": "Inclined Orbit Keeping",
  "description": "Maintains an inclined low-Earth orbit with chemical reboosts.",
  "analysis_request_key": "inclined_orbit_keeping",
  "chat_mode": "gmat-inclined-orbit-keeping",
  "initial_state_representation": "EarthMJ2000Eq Keplerian elements",
  "propulsion_requirement": "chemical",
  "satellite_inputs": [
    "satellite.bus.physical.mass_kg.dry",
    "satellite.bus.propulsion_subsystem.specific_impulse_seconds"
  ],
  "draft_directory": ["gmat", "drafts"],
  "gmat_reference_script": "references/inclined-orbit-keeping.script",
  "gmat_reference_values": "references/inclined-orbit-keeping.values.yaml",
  "artifacts": [
    { "kind": "script", "path": "inclined_orbit_keeping.script", "primary": true },
    { "kind": "values", "path": "inclined_orbit_keeping.values.yaml", "primary": false },
    { "kind": "report", "path": "InclinedOrbitKeepingReport.txt", "primary": true }
  ],
  "downstream_analyses": ["simu-cic", "opalis", "rf-comlink"],
  "ui": {
    "objective": "Maintain the requested inclined orbit.",
    "summary": "Chemical station keeping for an inclined LEO mission.",
    "satellite_requirements": ["Chemical propulsion", "Positive dry mass"],
    "outputs": ["Propellant consumption", "Orbital-element history"],
    "mission_input_fields": [
      {
        "label": "Mission duration",
        "path": "mission.durationDays",
        "unit": "days"
      }
    ]
  }
}
```

Manifest paths must be relative paths without `.` or `..`. Declare every
artifact that users should be able to find or download. The registry rejects
unsafe artifact paths and missing reference scripts.

Use only the existing UI transforms when they are appropriate:

```json
{ "label": "Initial altitude", "path": "orbit.initialAltitudeKm", "unit": "km", "derived": "initialAltitude", "value_transform": "earth-radius" }
```

The frontend reads the labels, input fields, requirements, and outputs from
this manifest. Avoid duplicating those presentation strings in a component.

## 2. Register the scenario

In [`backend/src/gmat/templateRegistry.ts`](../../backend/src/gmat/templateRegistry.ts):

1. Add `"inclined-orbit-keeping"` to `GMAT_TEMPLATE_IDS`.
2. Add `"inclined_orbit_keeping"` to `GmatAnalysisRequestKey`.

The maintained ID list is an allow-list for the API. The registry loads every
registered `template.json` during startup, so a typo or malformed manifest
fails early.

In [`frontend/src/pages/agent/gmatMissionTemplates.ts`](../../frontend/src/pages/agent/gmatMissionTemplates.ts):

1. Add the scenario ID to `GMAT_MISSION_TEMPLATES`.
2. Add its chat-mode literal to `GmatChatMode`.
3. Add the matching entry to `CHAT_MODE_BY_TEMPLATE`.

The type unions intentionally force every frontend lifecycle call to recognize
the new scenario.

## 3. Adapt the satellite digital thread

The selected satellite is the source of physical vehicle data. The adapter
converts that data to draft fields and guards against incompatible choices:

```text
run-local satellite.json
    -> adaptDigitalThreadToGmat(..., scenarioId)
    -> required draft values and compatibility guards
```

Extend [`backend/src/digitalThread/gmatDigitalThreadAdapter.ts`](../../backend/src/digitalThread/gmatDigitalThreadAdapter.ts).
Map the scenario's draft field names to the paths in `satellite.json`, then
add explicit guards for its physical requirements. For example, a chemical
scenario should reject an electric-only satellite rather than silently using a
nominal value. Keep deterministic calculations, such as Earth-radius to
altitude conversion, in this adapter or the generator rather than in chat.

When a draft changes, the shared route synchronizes mission values to both the
draft snapshot and the run-local digital thread. Do not write the selected
library definition from this code.

## 4. Implement the engineering adapter

Add a template-specific draft and generator module, or reuse a module only
when its engineering contract truly matches. It must implement these lifecycle
operations:

```ts
type MissionTemplateRuntime = {
  create: (...args: unknown[]) => Promise<MissionTemplateDraft>
  load: (...args: unknown[]) => Promise<MissionTemplateDraft>
  setValue: (...args: unknown[]) => Promise<MissionTemplateDraft>
  discuss: (...args: unknown[]) => Promise<MissionTemplateDraft>
  confirm: (...args: unknown[]) => Promise<MissionTemplateDraft>
  execute: (...args: unknown[]) => Promise<MissionTemplateExecution>
  recordRun: (...args: unknown[]) => Promise<MissionTemplateDraft>
  appendConversation: (...args: unknown[]) => Promise<MissionTemplateDraft>
}
```

Register the implementation in the `runtimes` map in
[`backend/src/gmat/missionTemplateRuntime.ts`](../../backend/src/gmat/missionTemplateRuntime.ts).
That map is the only explicit link between the generic workflow and
template-specific engineering code.

The adapter should:

- validate values and units before rendering the GMAT script;
- copy reference data into the dated run and generate only run-local files;
- return the run ID, run path, execution result, and declared artifact paths;
- preserve the draft and input snapshot when execution fails, so the user can
  correct it and create a new run.

Keep LLM discussion constrained to clarifying or updating allowed draft fields.
GMAT rendering, unit conversion, validation, and numerical engineering rules
must remain deterministic TypeScript code.

## 5. Connect downstream analysis

The template manifest identifies the downstream analysis names. Confirm that
the generated GMAT outputs have the input form expected by Simu-CIC, OPALIS,
and RF-COMLINK. If the scenario produces a new file type, add a narrow entry
to [`backend/src/runs/artifactRegistry.ts`](../../backend/src/runs/artifactRegistry.ts)
only when it is shared across scenarios. Scenario-only files belong in the
manifest's `artifacts` list.

The generic route merges the template artifacts with the shared downstream
artifact registry. This keeps the Results page and artifact history consistent
without another scenario-specific file browser.

## 6. Make it selectable

Mission Studio loads the template catalogue from the backend. Its scenario
selector uses `template.json`; its satellite selector reads each satellite's
`mission_templates` list. Add the new scenario ID to compatible satellite
definitions, for example:

```json
"mission_templates": ["orbit-keeping", "inclined-orbit-keeping"]
```

The Mission V2 flow additionally filters the displayed scenarios by this list.
Do not hard-code a new scenario page. The intended path is **New simulation**
→ choose a satellite → choose a compatible mission scenario → enter fields →
prepare → launch the pipeline.

## 7. Validate before merging

From `backend/`, run:

```bash
npm run build
npm run test:gmat:baseline
npm test
```

Add a focused registry test and draft/generator test. Update
[`backend/tests/gmat/templateRegistry.test.ts`](../../backend/tests/gmat/templateRegistry.test.ts)
to check the scenario ID, its request key, reference script, unique chat mode,
and declared UI contract. Then execute one real GMAT run with a compatible
satellite and verify all expected artifacts in the Results view.

If the new scenario needs a tool configuration or executable, validate it
through `config.json` and the normal startup check before testing the full
pipeline. See [Using the Project](USE_THE_PROJECT.md) for setup and operator
workflow.
