# Use the Project

This guide is for an engineer running a mission study through the web
application. It explains the normal path from configuration to a reviewed set
of results.

## Before the first start

The project uses `config.json` for ports, workspace locations, model
connections, GMAT, and optional remote tools. Create it from the example and
enter environment-specific values:

```bash
cp config.example.json config.json
```

At minimum, replace the placeholder values needed in your environment:

- `server` and `frontend` ports and host names;
- `workspace.templateDir` and `workspace.usersRoot`;
- `tools.gmat.bin` for GMAT runs;
- model API settings when mission discussion is enabled;
- optional database, speech, and remote CAD settings only when those features
  are used.

Do not commit `config.json` with keys, passwords, private hosts, or personal
paths. The example file contains the available fields and inline hints.

## Start the application

Run from WSL (the project depends on tmux and Linux tooling):

```bash
cd /mnt/d/path/to/agent-gmat-main
python3 scripts/start_local_web.py
```

The script stops existing tmux sessions and frees ports, installs
backend/frontend npm dependencies automatically, validates `config.json`, and
starts both web services. The printed frontend URL is the address to open in
a browser.

For local diagnosis without model connectivity checks:

```bash
python3 scripts/start_local_web.py --keep-proxy
```

To also start remote GUI tools (FreeCAD, ParaView, COMSOL):

```bash
python3 scripts/start_local_web.py --with-remote-gui
```

Useful manual checks are:

```bash
node scripts/validate_config.mjs --config config.json

cd backend && npm run build
cd ../frontend && npm run build
```

The detailed installation and service guide is
[`README.en.md`](../../README.en.md).

## Know the four main views

The Agent workspace navigation exposes four views:

| View | Use it for |
| --- | --- |
| **New simulation** | Create a dated mission run, select a satellite and scenario, supply parameters, then prepare and execute the pipeline. |
| **Satellites** | Browse and download versioned physical satellite definitions. This page documents definitions; it does not alter a completed run. |
| **Mission scenarios** | Browse the available deterministic GMAT models, their inputs, requirements, outputs, and reference script. |
| **Results** | Inspect the selected run's GMAT, Simu-CIC, OPALIS, and RF-COMLINK artifacts, charts, and run-scoped discussion. |

## Run a mission study

### 1. Start a new simulation

Open **New simulation** and create a new run. A run receives its own dated
workspace directory. Treat it as the evidence record for that study: it keeps
the selected satellite snapshot, draft values, generated script, workflow log,
and outputs together.

Do not reuse a run that has completed GMAT to test another mission scenario.
Create a new run instead so the prior script and results remain reproducible.

### 2. Select a satellite

Choose a spacecraft from the satellite selector. The application copies the
complete versioned physical definition into the new run's `satellite.json` and
records the definition ID and version as provenance.

The satellite's `mission_templates` list controls the compatible scenarios.
If your satellite does not offer the scenario you need, review its physical
properties and the scenario compatibility requirements before changing that
list.

### 3. Select a mission scenario

Choose a compatible GMAT mission scenario. The application creates a draft
seeded with values from the run-local digital thread and displays the mission
fields declared by that scenario's manifest.

Enter the requested parameters with their displayed units. The scenario may
derive values such as altitude from a defined orbital representation. Do not
replace a derived value with a manually converted number unless the scenario
explicitly asks for it.

### 4. Review and prepare the GMAT script

Prepare the scenario once every required value is complete. This generates and
saves the reviewed GMAT script and values in the mission run. Review the
visible fields and generated artifacts before launching a long analysis.

If a value is wrong, correct the draft and prepare again before executing. If
the scenario or satellite physical definition must change, start a new run.

### 5. Choose ground-station tracking when required

For the full pipeline, select a compatible ground station when Mission V2
requests one. Compatibility is evaluated from the spacecraft's RF frequency
bands. The saved Simu-CIC configuration uses ground-station tracking and the
same selection is available to RF-COMLINK.

### 6. Launch the pipeline and monitor it

Launch GMAT or the **full pipeline** after the reviewed script is ready. The
workflow records the state of GMAT and downstream stages in the run directory.
The page refreshes the status and artifacts as calculations finish.

If a stage fails, read its status and error before retrying. Correct the
configuration, satellite data, or draft inputs that caused the failure. Avoid
editing generated files in place: re-prepare a draft or create a new run so
the run record remains coherent.

## Work with results

Open **Results** and choose the mission run. Use the artifact list to inspect
the generated GMAT script, values, reports, time series, and downstream
outputs. The page combines artifacts declared by the scenario with the shared
Simu-CIC, OPALIS, and RF-COMLINK artifact registry.

The Results discussion is scoped to the chosen run. Ask it to explain a chart,
compare the recorded outputs, identify a failed stage, or point you to an
artifact. It is an analysis interface: it does not replace the files or alter
the completed run.

For a credible report or comparison, record:

- the run ID and scenario ID;
- the selected satellite ID and version;
- the GMAT script and values artifact version;
- downstream-tool status and primary reports;
- assumptions, inputs, and any failure/retry that affects interpretation.

## Common recovery paths

| Symptom | First action |
| --- | --- |
| The app will not start | Run `node scripts/validate_config.mjs --config config.json` and fix the reported value or executable. |
| A satellite is missing from the selector | Confirm that its JSON is valid and stored under `data/satellite-library/`, then restart the backend. |
| A scenario is not offered | Select a satellite whose `mission_templates` includes it, then check scenario propulsion guards and required physical data. |
| GMAT cannot launch | Verify `tools.gmat.bin`, executable permissions, timeout, and the prepared script's input values. |
| A downstream stage fails | Inspect the run workflow status and its stage artifacts; fix the source data and prepare or create a new run as appropriate. |
| A result looks inconsistent | Compare the run's `satellite.json`, values file, generated GMAT script, and report before interpreting a chart. |

## Maintain a clean workspace

Mission runs, `data/`, and `tools/` are engineering evidence or tool
contracts. Keep them. Generated caches such as `tmp/`, Python `__pycache__`,
build outputs, and TypeScript build information can be removed when they are
not needed.

For the project boundaries and retention policy, see
[Code Structure](../CODE_STRUCTURE.md). For extension work, see
[Implement a Mission Scenario](IMPLEMENT_A_MISSION_SCENARIO.md) and
[Add a Satellite](ADD_A_SATELLITE.md).
