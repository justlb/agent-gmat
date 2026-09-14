# Mission Data Flow and Required Files

This document explains how mission parameters become engineering results. It is
the operational reference for the GMAT -> Simu-CIC -> OPALIS -> RF-COMLINK
pipeline. Every calculation works in a dated, run-local directory so that an
output can be traced back to its inputs.

## 1. End-to-end flow

~~~mermaid
flowchart LR
  A[Satellite library and user mission parameters]
  B[Run-local satellite.json and GMAT script]
  C[GMAT OEM ephemeris]
  D[Simu-CIC scenario and CIC geometry files]
  E[OPALIS electrical case and results]
  F[RF-COMLINK scenario and link-budget results]
  G[Results UI, workflow status and analysis context]
  A --> B --> C --> D --> E --> G
  D --> F --> G
~~~

The pipeline is ordered. OPALIS and RF-COMLINK both require a successful
Simu-CIC stage; neither consumes a frontend-only selection directly.

## 2. Roots and immutable inputs

| Location | Required file or directory | Role |
| --- | --- | --- |
| config.json | tools.gmat, tools.simuCic, tools.opalis, tools.rfComlink | Local executable paths and worker runtimes. Never commit this file. |
| data/satellite-library/ | <satellite-id>.json | Versioned reference satellite definition. Never modify it for one mission. |
| backend/workflow_agents/gmat_skills/ | <template-id>-template/template.json | Declares a supported GMAT mission template, input fields and artifacts. |
| backend/workflow_agents/gmat_skills/ | <template-id>-template/references/*.script | Immutable GMAT reference script. |
| tools/workflow_OPALIS/workflow_OPALIS/3-run_OPALIS/templates/ | empty.opalis | Neutral OPALIS case used to prepare every run. |
| tools/workflow_RF-COMLINK/02-prepare-scenario/ | build_rf_comlink_scenario.py | Creates the run-local RF-COMLINK scenario. |
| RF-COMLINK installation | example/vide.rfcl or example/example.rfcl | Installed RF-COMLINK ZIP scenario template. |
| Simu-CIC installation | GUI/examples/Example_1.scd and loader.sce | Base scenario and Simu-CIC runtime. |
| CelestLab installation | loader.sce | CelestLab runtime loaded before Simu-CIC. |

## 3. Run creation and user parameters

A user selects a satellite and provides mission parameters in Mission Studio.
The backend creates a dated run:

~~~text
data/user/<user>/gmat/mission-runs/<run-id>/
~~~

Required run-local files at this point are:

| File | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| run_manifest.json | Run service | Results UI and backend | Run ID, mission template, selected satellite and lifecycle metadata. |
| satellite.json | Satellite library copy + Mission Studio | GMAT, Simu-CIC, OPALIS and RF-COMLINK adapters | Immutable snapshot of the satellite used by this run. |
| workflow-status.json | Run lifecycle | Frontend progress UI | State and diagnostic message for GMAT, Simu-CIC, OPALIS and RF-COMLINK. |
| conversation.json | Mission Studio | Mission/Results discussion | Run-scoped user and assistant conversation. |
| .digital-thread-revisions/ | Digital-thread store | Audit/recovery code | Historical snapshots of satellite.json. |

User parameters are never passed directly from the browser to a scientific
tool. They are validated, written into the run-local digital thread, and then
translated by an adapter for each tool.

## 4. GMAT: mission parameters to OEM ephemeris

### Inputs

| File | Why it is required |
| --- | --- |
| run_manifest.json | Identifies the selected mission template. |
| satellite.json | Supplies mass, orbit, propulsion and mission-specific engineering values. |
| <template-id>.script reference | Defines the approved GMAT mission structure. |
| <template-id>.values.yaml or draft.json | Holds the validated values applied to the reference script. |
| config.json -> tools.gmat.bin | Points to GmatConsole.exe. |

### Processing

1. A GMAT adapter maps fields from satellite.json and the confirmed user values
   into the template value slots.
2. The renderer writes the exact executable GMAT script into the run directory.
3. GmatConsole.exe runs that rendered script.
4. The backend records the console output, parsed metrics and OEM ephemeris.

### Outputs required by downstream stages

| File | Required by | Purpose |
| --- | --- | --- |
| <mission>.script | Audit and GMAT GUI | Exact script executed for this run. |
| <mission>.values.yaml | Audit | Values substituted into the GMAT template. |
| gmat.log | Debugging | Raw GMAT console output. |
| gmat_result.json | Frontend and pipeline checks | GMAT status and parsed summary metrics. |
| EphemerisFile1.oem | Simu-CIC | OEM trajectory that is converted into Simu-CIC data. |
| ReportFile1.txt and/or mission report | GMAT result parser | Raw time series when the mission template produces one. |
| <mission>_timeseries.json | Results charts | Parsed GMAT time series, when applicable. |

GMAT must produce a non-empty OEM file. Without EphemerisFile1.oem, Simu-CIC
must not start.

## 5. Simu-CIC: OEM ephemeris to CIC geometry and attitude files

### Inputs

| File or setting | Why it is required |
| --- | --- |
| EphemerisFile1.oem | GMAT trajectory source. |
| tools/workflow_OPALIS/workflow_OPALIS/1-conversion_vers_SIMU-CIC/eph_conversion.py | Converts OEM into Simu-CIC ephemeris format. |
| opalis/02-simu-cic/simucic.definition.json | Run-specific attitude mode and selected ground station(s). |
| tools.simuCic.baseScenario | Base .scd scenario copied into this run. |
| tools.simuCic.simucicDir | Simu-CIC installation containing loader.sce and libraries. |
| tools.simuCic.celestlabDir | CelestLab folder containing loader.sce. |
| tools.simuCic.scilabBin | Scilex.exe; the launcher selects WScilex.exe. |
| tools/workflow_OPALIS/workflow_OPALIS/2-run_SIMU-CIC/run_scilab_simulation.py | Cross-platform launcher. |
| tools/workflow_OPALIS/workflow_OPALIS/2-run_SIMU-CIC/run_ephemeris_attitude_simulation.sce | Scilab scenario script. |

### Run-local files

~~~text
opalis/
├── 01-conversion_vers_SIMU-CIC/
│   └── EphemerisFile1_SIMU.txt
└── 02-simu-cic/
    ├── 00-scenario-input/simucic-input.scd
    ├── simucic.definition.json
    ├── 01-execution-complete/run_<id>.scd
    ├── 01-execution-complete/run_<id>.sod
    └── 02-fichiers-cic/Sat/
        ├── Sat_DISTANCE_GROUND_STATION_1.TXT
        ├── Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_1.TXT
        ├── Sat_SATELLITE_DIRECTION-GROUND_STATION_1_FRAME.TXT
        ├── Sat_SATELLITE_ECLIPSE.TXT
        ├── Sat_SUN_DIRECTION-SATELLITE_FRAME.TXT
        └── additional CIC attitude, geometry and eclipse files
~~~

The three ground-station files are required for RF-COMLINK preparation. The
broader CIC set is required by OPALIS to generate its electrical flux inputs.
The Simu-CIC completion marker and existing CIC text files determine success;
a non-zero WScilex exit code alone is not sufficient to reject a completed run.

## 6. OPALIS: CIC inputs to electrical-power results

### Inputs

| File or setting | Why it is required |
| --- | --- |
| satellite.json | Electrical model, solar-array sections and consumption assumptions. |
| opalis/02-simu-cic/02-fichiers-cic/Sat/*.TXT | CIC geometry/eclipse inputs. |
| opalis/02-opalis-input/opalis-parameters.json | Validated backend-to-OPALIS parameter contract. |
| tools/.../3-run_OPALIS/templates/empty.opalis | Neutral OPALIS starting case. |
| tools/.../3-run_OPALIS/opalis_pipeline.py | Generates fluxes, applies parameters and runs OPALIS. |
| tools/.../3-run_OPALIS/opalis_python.py | Pythonnet bridge to OpalisApi.dll. |
| tools.opalis.installationDir/lib/OpalisApi.dll | OPALIS 2.3 API. |
| tools.opalis.workerPython | Windows Python with pythonnet and .NET Framework 4.8. |

### Outputs

~~~text
opalis/03-opalis/
├── 01-fluxes/                         # Generated OPALIS flux inputs
├── 02-resultats/
│   ├── prepared-opalis.opalis
│   ├── prepared-opalis.json
│   ├── calculated-opalis.opalis
│   └── calculated-opalis.json
└── logs and copied input evidence
~~~

The prepared case is a reviewable input. The calculated case and JSON summary
are the electrical-analysis evidence shown in Results. OPALIS must run under
Windows Python because its API targets .NET Framework 4.8.

## 7. RF-COMLINK: CIC geometry to communication-link results

### Inputs

| File or setting | Why it is required |
| --- | --- |
| satellite.json | Link systems, antenna values, frequency bands and data rates. |
| simucic.definition.json | Confirms the selected ground station and tracking attitude. |
| CIC ground-station files | Distance, visibility and satellite-direction data. |
| rf-comlink/01-input/rf-comlink-inputs.json | Validated run-local RF input manifest. |
| RF-COMLINK example template | XML skeleton for the generated .rfcl ZIP scenario. |
| Resources/GROUND_STATION_DATABASE.txt | Installed ground-station equipment data. |
| build_rf_comlink_scenario.py | Rewrites link XML, ephemeris references and system parameters. |
| rf-comlink.exe | Opens the prepared scenario and performs the local calculation. |

### Outputs

~~~text
rf-comlink/
├── 01-input/rf-comlink-inputs.json
├── 02-scenario/prepared-rf-comlink.rfcl
└── 03-results/
    ├── calculated-rf-comlink.rfcl
    ├── rf-comlink-calculation.log
    └── rf-comlink-results.json
~~~

A mission can declare more links than the installed sample template provides.
The preparer creates additional link XML skeletons when needed, then writes the
run-specific frequency, rate, modulation, antenna and CIC data.

## 8. Results and traceability

The frontend reads run-local summaries and never recalculates engineering
values. The main evidence chain is:

~~~text
workflow-status.json
  -> stage status and human-readable failure reason
gmat_result.json
  -> GMAT summary
opalis/03-opalis/02-resultats/calculated-opalis.json
  -> OPALIS electrical summary
rf-comlink/03-results/rf-comlink-results.json
  -> RF-COMLINK saved report inventory and extracted results
consolidated-run-report.json
  -> compact cross-tool export for review
run-analysis-context.json
  -> selected evidence supplied to run-scoped analysis
~~~

When diagnosing a failure, begin with workflow-status.json, then inspect the
primary artifact of the failed stage. Never overwrite a dated mission run to
retry it; create or select a new run so the earlier evidence remains available.

## 9. Ownership rules

- Frontend: sends user intent and displays persisted artifacts; it does not
  access the filesystem or run engineering executables.
- Backend: validates input, creates run-local files, invokes tools and records
  status. It owns all path conversion between WSL and Windows tools.
- Tool scripts: consume only explicit files/arguments and write only under the
  current run output directory.
- External tools: are authoritative for their own calculations. Their raw
  output is kept with the run and must not be replaced by inferred values.

