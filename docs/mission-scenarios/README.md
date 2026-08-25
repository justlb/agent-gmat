# Mission scenario kit

Each deterministic GMAT mission scenario is described by one versioned manifest
and a manually validated reference script. The manifest is the catalogue
contract; `satellite.json` remains the source of truth for each run.

## Create a skeleton

```bash
cd backend
npm run scenario:create -- --id rendezvous-leo --name "LEO rendezvous"
```

Use `--dry-run` first to inspect the exact files that will be created.

## Complete a scenario before registering it

1. Replace every placeholder in `scenario.json`.
2. Copy the validated GMAT script into `references/`; never generate a
   reference script from an LLM.
3. Define the editable YAML slots and the deterministic adapter from
   `satellite.json` to those slots.
4. Add the scenario ID to `GMAT_MISSION_SCENARIO_IDS` in
   `backend/src/gmat/templateRegistry.ts`.
5. Register its specific draft/runtime implementation in
   `backend/src/gmat/missionTemplateRuntime.ts`.
6. Add render, guardrail and end-to-end tests before exposing it in the UI.

The current four scenarios retain their existing `template.json` manifests as a
temporary backwards-compatible format. New scenarios must use `scenario.json`.
