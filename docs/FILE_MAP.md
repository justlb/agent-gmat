# Where things live — project file map

One-page reference for finding anything in the project.

---

## 1. GMAT templates

Each registered template is a self-contained directory under
`backend/workflow_agents/gmat_skills/<template-id>-template/`.

```text
backend/workflow_agents/gmat_skills/
├── orbit-keeping-template/
│   ├── template.json                    ← MANIFEST: ID, fields, artifacts, propulsion requirement
│   └── references/
│       └── orbit_keeping.script         ← IMMUTABLE GMAT reference script
├── electric-propulsion-transfer-template/
│   ├── template.json
│   └── references/
│       ├── electric_propulsion_transfer.script
│       └── electric_propulsion_transfer.values.yaml
├── chemical-hohmann-transfer-template/
│   ├── template.json
│   └── references/
│       └── chemical_hohmann_transfer.script
└── electrical-leo-orbit-maintenance-template/
    ├── template.json
    └── references/
        └── electrical_leo_orbit_maintenance.script
```

**How a template works:**
1. `template.json` declares mission input fields, required satellite properties, downstream analyses, and artifacts.
2. The backend reads the reference `.script`, auto-extracts value slots, and substitutes values at runtime.
3. Never edit a reference script as a way to modify one run. Reference scripts
   are version-controlled engineering inputs; any intentional change needs
   review, regression tests, and a new run for validation.

**Backend code that renders templates:**
| File | Purpose |
|---|---|
| `backend/src/gmat/missionTemplateRuntime.ts` | Generic lifecycle shared by all templates (create → confirm → execute). |
| `backend/src/gmat/templateRegistry.ts` | Central registry of all template IDs. |
| `backend/src/gmat/missionTemplates.routes.ts` | Generic API routes (POST/PATCH/GET) that every template inherits. |
| `backend/src/gmat/chemicalHohmann.service.ts` | Chemical Hohmann-specific renderer + report parser. |
| `backend/src/gmat/orbitKeeping.service.ts` | Orbit-keeping-specific renderer. |
| `backend/src/gmat/electricPropulsionDraft.ts` | Electric transfer draft state and validation. |

---

## 2. Satellite definitions

Single source of truth: `data/satellite-library/`.

```text
data/satellite-library/
├── ref-leo-orbit-keeping.json       ← Chemical propellant LEO satellite
├── fudan-satellite.json             ← Fudan satellite (electric)
└── ...
```

Each JSON is a **complete, versioned** definition with:
- `satellite.identity.name` / `id` / `version`
- `satellite.bus.physical.*` — dry mass, drag area, drag coefficient
- `satellite.bus.propulsion_subsystem.*` — propellant mass, Isp
- `satellite.bus.opalis.*` — OPALIS electrical parameters

**Important:** the library is **immutable**. When a user selects a satellite, a copy is made into the run directory — never write back to the library.

---

## 3. Run outputs — anatomy of a mission run

Every completed mission run lives under:

```text
data/user/<user>/gmat/mission-runs/YYYY-MM-DD_HH-MM[_NN]/
```

### Typical run directory layout

```text
26-09-08_15-22/                           ← dated run directory
├── run_manifest.json                     ← templateId, satelliteId, status, runId
├── workflow-status.json                  ← per-stage status (GMAT → CIC → OPALIS → RF)
├── satellite.json                        ← RUN-LOCAL satellite snapshot (copied from library)
├── conversation.json                     ← Mission Studio conversation (GMAT draft + Results discussion)
├── .digital-thread-revisions/            ← history of satellite.json snapshots
│   ├── satellite.r000000.json
│   └── satellite.r000001.json
│
├── gmat/
│   └── chemical-hohmann-transfer/         ← per-template draft directory
│       └── drafts/
│           └── draft_<uuid>/
│               ├── draft.json            ← draft state: values, confirmed, missing fields
│               ├── chemical_hohmann_transfer.values.yaml  ← values used to render
│               └── satellite.json         ← draft-time satellite snapshot
│
├── chemical_hohmann_transfer.script      ← RENDERED GMAT script (what GMAT actually executed)
├── chemical_hohmann_transfer.values.yaml  ← rendered values (copied from draft)
├── gmat_result.json                      ← exitCode, delta-v, summary metrics
├── gmat.log                              ← GMAT console output
├── ReportFile1.txt                       ← raw GMAT report (altitude, fuel time series)
├── chemical_hohmann_timeseries.json      ← PARSED timeseries for Results charts
├── EphemerisFile1.oem                    ← OEM ephemeris of the transfer trajectory
│
├── opalis/
│   ├── 01-conversion_vers_SIMU-CIC/      ← GMAT OEM → CIC conversion
│   ├── 02-simu-cic/
│   │   └── 02-fichiers-cic/Sat/          ← Simu-CIC attitude + geometry CIC files
│   └── 03-opalis/
│       └── <run-name>.opalis             ← prepared OPALIS case + result JSON
│
└── rf-comlink/
    ├── 01-input/rf-comlink-inputs.json   ← RF-COMLINK input manifest
    ├── 02-scenario/prepared-rf-comlink.rfcl  ← prepared .rfcl ZIP scenario
    └── 03-results/                        ← RF-COMLINK result outputs
```

### What each artifact is for

| File | Consumed by | What it tells you |
|---|---|---|
| `run_manifest.json` | Frontend Results page, backend run listing | Which template, which satellite, what status |
| `satellite.json` | GMAT, OPALIS, RF-COMLINK | Full physical satellite definition for this run |
| `workflow-status.json` | Frontend progress rail | Launcher state and recorded errors for GMAT / CIC / OPALIS / RF; inspect primary outputs separately for engineering validity |
| `*.script` | GMAT (external process) | The exact GMAT script that was executed |
| `*_values.yaml` | Backend renderer | Which values were substituted into the template |
| `gmat_result.json` | Frontend Results page | Exit code, delta-v, initial/final mass, target altitude |
| `*.log` | Human debugging | Raw GMAT console output |
| `ReportFile1.txt` | Backend parser → timeseries | Raw altitude + fuel-mass time series from GMAT |
| `*_timeseries.json` | Frontend charts | Parsed time series for Results graphs |
| `EphemerisFile1.oem` | Simu-CIC, OPALIS, RF-COMLINK | Orbital trajectory in OEM format |
| `conversation.json` | Frontend Results discussion | All Mission Studio and Results discussion turns for this run |

---

## 4. Where the GMAT pipeline source code lives

| File | What it does |
|---|---|
| `backend/src/runs/missionPipeline.routes.ts` | Orchestrates: prepare GMAT script → execute GMAT → run Simu-CIC → prepare OPALIS → run OPALIS → prepare RF-COMLINK → run RF-COMLINK |
| `backend/src/gmat/chemicalHohmann.service.ts` | Renders the Hohmann GMAT script from reference + values, redirects EphemerisFile1, parses ReportFile1.txt into timeseries |
| `backend/src/gmat/orbitKeeping.service.ts` | Renders the orbit-keeping GMAT script |
| `backend/src/gmat/gmatDigitalThreadAdapter.ts` | Converts satellite.json fields into template-specific GMAT input values |
| `backend/src/opalis/opalisPreparation.routes.ts` | Validates CIC files + satellite.json → writes `opalis-parameters.json` |
| `backend/src/opalis/workflowRunLog.ts` | Persists per-stage workflow status |
| `backend/src/runs/runWorkspace.ts` | Creates/names dated run directories |
| `backend/src/runs/runLifecycle.ts` | Locks a run after GMAT completes (immutable) |
| `backend/src/runs/artifactRegistry.ts` | Declares which files each template produces |
| `backend/src/analysis/runAnalysisContext.ts` | Aggregates all run artifacts into a LLM-readable context for the Results discussion |

---

## 5. External tool scripts

| Tool | Where | How invoked |
|---|---|---|
| GMAT (GmatConsole.exe) | Configured in `config.json` > `tools.gmat.bin` | Backend spawns as external process |
| Simu-CIC (Scilab) | `tools/workflow_OPALIS/workflow_OPALIS/2-run_SIMU-CIC/run_scilab_simulation.py` | Backend calls Python script |
| OPALIS (.NET) | `tools/workflow_OPALIS/workflow_OPALIS/3-run_OPALIS/opalis_pipeline.py` | Backend calls Python → loads `OpalisApi.dll` |
| RF-COMLINK (.exe) | `tools/workflow_RF-COMLINK/` step scripts | Backend calls batch tool |

---

## 6. Configuration

| What | Where |
|---|---|
| Full config | `config.json` (create from `config.example.json`) |
| GMAT path | `config.json` → `tools.gmat.bin` |
| LLM endpoint | `config.json` → `chatModel.apiKey`, `chatModel.baseUrl`, `chatModel.model` |
| Workspace root | `config.json` → `workspace.usersRoot` (where mission-runs lives) |
| Ports | `config.json` → `server.port`, `frontend.httpsPort` |

---

## 7. Frontend key files

| File | Purpose |
|---|---|
| `frontend/src/pages/agent/MissionV2.tsx` | Mission authoring: select satellite → scenario → fill fields → prepare → run |
| `frontend/src/pages/agent/ResultsPage.tsx` | Results: select run → see unified table + charts + discussion |
| `frontend/src/pages/agent/ResultCharts.tsx` | Altitude/fuel-mass time-series charts |
| `frontend/src/pages/agent/ResultsDiscussion.tsx` | Run-scoped LLM discussion (single-run + multi-run comparison) |
| `frontend/src/pages/agent/runResultsApi.ts` | Frontend API client for run results |

---

## 8. Tests

```bash
cd backend
npm run test:gmat:baseline    # GMAT templates + digital thread (recommended minimum)
npm run test:gmat:electric     # Electric transfer drafts and runner
npm test                       # Full backend suite
```

Tests live under `backend/tests/` organised by module (`gmat/`, `runs/`, `digitalThread/`, `opalis/`, `api/`, `e2e/`, `unit/`).
