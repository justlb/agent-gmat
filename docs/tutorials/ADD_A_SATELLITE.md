# Add a Satellite to the Project

This is the beginner path for adding one physical spacecraft to the project.
You create **one JSON file** in the satellite library. You do not need to edit
TypeScript, register the satellite anywhere, or create a mission run by hand.

The library stores physical spacecraft data. A mission orbit, selected ground
station, and what-if values are created later in a run-local `satellite.json`.
Do not add them to the library file.

## Before you start

Open a WSL terminal in the project root:

```bash
cd /mnt/c/JUSTINE/demonstrator
```

You need a text editor that preserves valid JSON (for example VS Code). Every
JSON file in `data/satellite-library/` becomes available in the **Satellites**
screen automatically. There is no second registration file to edit.

## Quick path: add a chemical satellite

Follow these five steps in order.

### Step 1 — choose the closest starting file

For a chemical-propulsion satellite, copy this existing example:

[reference-leo-orbit-keeping.v1.json](../../data/satellite-library/reference-leo-orbit-keeping.v1.json)

For an electric-propulsion satellite, use
[reference-leo-electric.v1.json](../../data/satellite-library/reference-leo-electric.v1.json).

If the new satellite needs a detailed OPALIS and RF-COMLINK structure, use
[fudan-satellite.v1.json](../../data/satellite-library/fudan-satellite.v1.json)
as a structural reference. Do not copy real spacecraft values without an
engineering source.

### Step 2 — copy it to the satellite-library folder

Choose a short, stable, lowercase identifier. In this example it is
`my-chemical-demo`. Create the new file beside the other satellite files:

```bash
cp data/satellite-library/reference-leo-orbit-keeping.v1.json \
  data/satellite-library/my-chemical-demo.v1.json
```

The destination must be exactly under:

```text
data/satellite-library/
```

The filename and the JSON identity should agree:

```text
my-chemical-demo.v1.json  ->  id: "my-chemical-demo", version: "1.0.0"
```

When the design changes later, do not overwrite a released definition. Copy
it to `my-chemical-demo.v2.json` and set `"version": "2.0.0"`.

### Step 3 — edit only the new file

Open the file you just created:

```text
data/satellite-library/my-chemical-demo.v1.json
```

First, change these top-level fields. They identify the satellite in the UI:

```json
{
  "id": "my-chemical-demo",
  "version": "1.0.0",
  "name": "My Chemical Demonstrator",
  "description": "Physical reference for a fictional chemical-propulsion LEO demonstrator.",
  "capabilities": ["GMAT", "Simu-CIC", "OPALIS", "RF-COMLINK"],
  "mission_templates": ["orbit-keeping", "chemical-hohmann-transfer"]
}
```

Next, update the physical and chemical-propulsion values in the existing
`"satellite" -> "bus"` section. Keep the field names; replace only the values
with values supported by your engineering source:

```json
"physical": {
  "mass_kg": { "dry": 120, "wet_at_launch": 155, "propellant": 35 },
  "drag_area_m2": 1.2,
  "drag_coefficient": 2.2
},
"propulsion_subsystem": {
  "type": "Bipropellant chemical propulsion",
  "propellant": "Chemical bipropellant",
  "specific_impulse_seconds": 315,
  "main_engine_thrust_n": 10
}
```

For a chemical satellite, the word `chemical`, `bipropellant`, or
`monopropellant` must appear in `propulsion_subsystem.type`. This is how the
GMAT adapter recognises it as compatible with chemical scenarios.

Do not add an `electric_thruster` section to a chemical satellite. If you
started from an electric reference file, delete both:

```text
satellite.bus.propulsion_subsystem.electric_thruster
satellite.bus.electrical_subsystem.electric_propulsion_mode
```

Keep the copied `electrical_subsystem`, `opalis`, and `rf_comlink` sections
only if their values are applicable and documented. If you do not have enough
data for OPALIS or RF-COMLINK, remove the unsupported capability from
`capabilities` instead of inventing values.

### Step 4 — save the JSON file

Check that commas, braces, and quotation marks are intact. The quickest local
check is:

```bash
node -e "JSON.parse(require('fs').readFileSync('data/satellite-library/my-chemical-demo.v1.json', 'utf8'))"
```

No output means the JSON syntax is valid. An error tells you the line to fix.

### Step 5 — select it in the application

1. Start the application from the project root:

   ```bash
   python3 scripts/start_local_web.py
   ```

2. Open the frontend URL printed by the launcher.
3. Open **Satellites** and find **My Chemical Demonstrator**.
4. Select it, then open **New simulation**.
5. Confirm that `orbit-keeping` or `chemical-hohmann-transfer` is offered.
6. Create a new run. The application copies the physical satellite data to
   that run's `satellite.json`; it never modifies your library JSON file.

If the satellite is not visible, refresh the browser first. The backend scans
the library on each request. Check that the file ends in `.json`, is placed in
`data/satellite-library/`, and has valid JSON.

## Important rules

- Use the unit in the field name: `mass_kg`, `drag_area_m2`,
  `specific_impulse_seconds`, and so on.
- Give the source or an explicit assumption in `description` or a `note`.
- Do not put a mission orbit, ground station, or single-run RF selection in a
  library definition.
- Do not change an existing library record to repair one mission. Create a new
  version or change the run-local snapshot instead.
- Declare only capabilities the definition can support with available data.

## Worked project example

[fudan-like-chemical-demo.v1.json](../../data/satellite-library/fudan-like-chemical-demo.v1.json)
is a complete, fictional example. It follows the detailed Fudan data shape,
but replaces electric propulsion with explicitly labelled chemical assumptions.
It is not a description of the real Fudan spacecraft.

Files used to implement and check that example:

- [Fudan reference definition](../../data/satellite-library/fudan-satellite.v1.json)
  — detailed electrical and RF structure.
- [Chemical reference definition](../../data/satellite-library/reference-leo-orbit-keeping.v1.json)
  — chemical field names and compatible scenarios.
- [Completed example](../../data/satellite-library/fudan-like-chemical-demo.v1.json)
  — the new satellite record.
- [Satellite-library loader](../../backend/src/digitalThread/satelliteLibrary.ts)
  — automatic discovery and selection.
- [Digital-thread validator](../../backend/src/digitalThread/digitalThreadSchema.ts)
  — run-local structural checks.
- [GMAT adapter](../../backend/src/digitalThread/gmatDigitalThreadAdapter.ts)
  — chemical-propulsion compatibility checks.
- [Focused selection test](../../backend/tests/digitalThread/fudanLikeChemicalSatellite.test.ts)
  — automated discovery and selection check.

## Optional developer verification

These checks are not required to add the file, but use them before publishing
the project or changing the satellite schema.

From **WSL**, where the backend dependencies were installed:

```bash
cd /mnt/c/JUSTINE/demonstrator/backend
node --import tsx --test tests/digitalThread/fudanLikeChemicalSatellite.test.ts
npm run build
npm run test:stability
```

Do not run the TypeScript test with Windows Node when `node_modules` was
installed in WSL: `tsx` and `esbuild` contain platform-specific binaries.

For a new GMAT scenario rather than a new satellite, read
[Implement a Mission Scenario](IMPLEMENT_A_MISSION_SCENARIO.md).
