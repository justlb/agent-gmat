# GMAT Digital Thread Assistant

## Project objective

The project aims to build an AI-assisted engineering environment for concurrent spacecraft design. The long-term goal is a **digital thread** connecting several deterministic engineering tools, while keeping the engineer in control of assumptions, inputs, results, and decisions.

The first implemented use case is autonomous low-Earth-orbit station keeping with GMAT (General Mission Analysis Tool). It provides a controlled foundation for later integrations with:

- OPALIS for power-budget analysis;
- RF-COMLINK for communications-budget analysis;
- SIMU-CIC for geometry analysis;
- VTS for mission visualisation.

## Design principles

The architecture separates AI reasoning from deterministic engineering execution.

```text
Engineer request
      ↓
AI-assisted mission discussion
      ↓
Validated mission configuration
      ↓
Deterministic tool adapter
      ↓
GMAT / future engineering tools
      ↓
Structured artefacts, metrics, and visualisations
      ↓
AI-assisted interpretation and engineering discussion
```

The language model is used to understand natural-language requests and explain results. It is not allowed to write arbitrary GMAT syntax or change the structure of an engineering model.

## Satellite JSON as the source of truth

Each workspace owns one versioned engineering document:

```text
digital-thread/satellite.json
```

It is created from `data/templates/satellite.digital-thread.template.json`. The template describes identity, orbit, bus subsystems, payload, lifecycle, analysis requests, provenance, and deterministic derivations. Empty values are `null`; tutorial values are never treated as satellite facts.

For every managed mission discussion, the LLM may emit only value patches against known JSON leaf paths. The backend rejects unknown paths and records provenance. Before a tool can run, its adapter reads this JSON, derives tool-specific inputs, and returns explicit missing-data guards. GMAT execution reloads the JSON immediately before confirmation/execution, so the digital thread remains authoritative.

The current GMAT adapter maps the orbital state, masses, drag, propulsion and mission-policy values. For an electric transfer it also derives the initial maximum solar power from either:

```text
declared total generated power
or
1361 W/m² × total array area × cell efficiency
```

Bus load, power margin, and electric-thruster usable-power limits also come from the JSON. Each managed run receives an immutable `satellite.digital-thread.json` snapshot; its schema version, revision, thread ID, and SHA-256 are recorded in `run_manifest.json`.

## GMAT orbit-keeping implementation

### Fixed template and controlled parameters

The current GMAT use case is based on a fixed Keplerian Earth orbit-keeping template:

- a spacecraft with a chemical tank;
- an Earth-centred Keplerian initial state;
- atmospheric drag and a fourth-order gravity field;
- two impulsive burns used to restore the target orbit;
- a protected fuel reserve;
- final propagation to a controlled decay altitude.

All modifiable values are extracted from the template into a reference YAML file. The YAML contains named, validated slots such as spacecraft dry mass, drag area, orbital elements, fuel reserve, and reboost altitude.

```text
Fixed GMAT template
      ↓
Reference values YAML
      ↓
One LLM request returns a minimal patch: { id, value }
      ↓
Strict backend validation
      ↓
Complete modified YAML
      ↓
Deterministic GMAT script rendering
```

This approach prevents the LLM from adding commands, objects, solvers, or unsafe syntax to the GMAT script.

### Backend pipeline

For each generated run, the backend:

1. Reads the immutable GMAT template and its reference YAML values.
2. Makes one LLM call to interpret the user request.
3. Accepts only a minimal YAML patch referring to known slots.
4. Rejects unknown identifiers, invalid YAML, unsafe syntax, duplicate changes, and structural changes.
5. Renders the complete GMAT script deterministically.
6. Executes GMAT when the GMAT executable is configured.
7. Saves all artefacts in a timestamped run directory in the user workspace.

Each run contains, among other files:

```text
orbit_keeping.script
orbit_keeping.values.yaml
run_manifest.json
gmat_result.json
ReboostReport.txt
OrbitAnalysisReport.txt
orbit_timeseries.json
gmat.log
```

The run directory is an immutable engineering record: it stores the request, accepted changes, generated input files, execution output, and normalised results.

### Execution progress and frontend integration

The frontend provides two chat modes:

- **General**: existing managed-agent behaviour;
- **GMAT Orbit Keeping**: direct access to the controlled GMAT pipeline.

During a GMAT generation, the backend emits real pipeline states to the frontend:

```text
Load fixed template
Create and validate LLM patch
Render deterministic GMAT script
Run GMAT simulation
Save artefacts and results
```

The interface displays these states as `Pending`, `Running`, `Completed`, or `Failed`.

Generated files are visible in the Files area. Selecting a run makes it the active conversation context, so the engineer can ask questions about that run without rerunning GMAT.

### Engineering data and visualisation

The template now produces a controlled engineering report containing:

- epoch;
- altitude;
- fuel mass;
- total mass;
- semi-major axis;
- eccentricity;
- inclination.

The backend parses this report into `orbit_timeseries.json`. The Tools area includes a first **GMAT Analysis** panel displaying altitude versus GMAT report sample, as well as minimum altitude, maximum altitude, and final fuel mass.

Using report files rather than screenshots of the GMAT GUI makes the outputs reproducible, machine-readable, reusable by other tools, and available to the LLM for grounded analysis.

## Current limitations

The implementation is an MVP and intentionally constrained.

- Only one template is currently available: Earth, Keplerian, autonomous orbit keeping.
- The LLM can modify only values exposed by the YAML contract; it cannot alter GMAT structure.
- The current report is sampled at reboost and final-propagation points, not at every numerical propagation step.
- A full continuous time series and advanced charts are future work.
- The total mission delta-v budget is not yet an enforced GMAT stopping condition. The current template has per-burn solver bounds and a fuel-reserve end condition.
- Multi-run comparison, scenario optimisation, and cross-tool orchestration are not implemented yet.
- OPALIS, RF-COMLINK, SIMU-CIC, and VTS are not connected yet.

## Next step: mission drafts before execution

The next major capability is an interactive **mission draft** phase. A user should be able to discuss a mission before any simulation is launched.

```text
User discussion
      ↓
Template routing
      ↓
Mission draft with required fields
      ↓
Backend validation and missing-information questions
      ↓
Engineer confirmation
      ↓
Deterministic GMAT execution
```

Each template will define a machine-readable contract containing:

- supported mission type and central body;
- mandatory fields;
- allowed optional/environmental profiles;
- units, ranges, and conditional dependencies;
- mappings from engineering concepts to template YAML slots.

For the current Earth Keplerian orbit-keeping template, the draft must resolve:

| Area | Mandatory information |
|---|---|
| Initial state | Epoch, SMA, eccentricity, inclination, RAAN, argument of periapsis, true anomaly |
| Spacecraft | Dry mass, initial fuel mass, drag area, drag coefficient |
| Propulsion | Specific impulse |
| Orbit-keeping policy | Minimum altitude, target SMA, fuel reserve |
| End of life | Final altitude |

The template also records fixed assumptions, including Earth as central body, the EarthMJ2000Eq frame, JGM2 gravity degree/order 4, and the MSISE90 atmospheric model.

The backend—not the LLM—will compute whether mandatory fields are missing or invalid. The `Run GMAT simulation` action will remain disabled until the draft is complete and explicitly confirmed.

## Multi-template and multi-tool roadmap

### Phase 1 — GMAT mission definition

- Add mission-draft persistence and validation.
- Add template routing.
- Add additional GMAT templates, for example Earth Cartesian orbit keeping and Mars orbit keeping.
- Add continuous report sampling and richer GMAT charts.
- Add controlled comparison of multiple GMAT runs against an engineering objective.

### Phase 2 — Shared scenario and artefact graph

- Define a common scenario identifier and immutable run identifiers.
- Record tool inputs, outputs, versions, dependencies, and assumptions.
- Publish normalised orbit products that downstream tools can consume.

### Phase 3 — Connect deterministic engineering tools

```text
GMAT orbit solution
      ├── OPALIS power-budget analysis
      ├── RF-COMLINK communication-budget analysis
      ├── SIMU-CIC geometry analysis
      └── VTS visualisation
```

Each adapter should follow the same pattern:

```text
Validated scenario input
→ deterministic tool execution
→ raw artefacts
→ normalised metrics
→ traceable run record
```

### Phase 4 — AI engineering assistant

The LLM becomes an engineering interface over the traceable artefact graph. It can answer questions such as:

> Using this specific GMAT orbit and this OPALIS configuration, does the spacecraft maintain sufficient power during the complete simulation?

The answer should reference the exact scenario, tool runs, assumptions, metrics, and source files used to produce it.

## Expected value

The proposed approach combines speed and safety:

- natural-language interaction for engineers;
- deterministic and reproducible engineering calculations;
- no uncontrolled LLM modification of simulation structure;
- transparent assumptions and explicit validation before execution;
- reusable data products across simulation tools;
- persistent traceability from question to engineering result.

This establishes a practical path from a single GMAT assistant to a multi-disciplinary spacecraft digital-thread environment.
