# Add a Satellite to the Project

This tutorial adds one physical satellite definition to the application. The
normal task changes **one file only**: a new JSON file under
`data/satellite-library/`. Do not change backend TypeScript files merely to add
a normal satellite.

## Before starting

**Where to work**

Open a WSL terminal in the project root:

```bash
cd /mnt/c/JUSTINE/demonstrator
```

**What to do**

Keep this terminal open. Use a JSON-capable editor, such as VS Code, to edit
the new file.

**Expected result**

You are in the folder that contains `data/`, `backend/`, `frontend/`, and
`config.json`.

## Step 1 — Create a new JSON file

**Where to work**

The satellite library is this folder:

```text
data/satellite-library/
```

**What to do**

Choose the closest existing satellite, then copy it. For a chemical satellite,
start with [reference-leo-orbit-keeping.v1.json](../../data/satellite-library/reference-leo-orbit-keeping.v1.json):

```bash
cp data/satellite-library/reference-leo-orbit-keeping.v1.json \
  data/satellite-library/my-chemical-demo.v1.json
```

Replace `my-chemical-demo` with a stable, lowercase identifier for your own
satellite. Use hyphens, not spaces.

**Expected result**

The folder contains a new file:

```text
data/satellite-library/my-chemical-demo.v1.json
```

Nothing else has to be created. In particular, do not add the satellite name
to a TypeScript list or a frontend file: the backend reads every `.json` file
in this folder automatically.

## Step 2 — Give the satellite its identity

**Where to work**

Open the new file created in step 1:

```text
data/satellite-library/my-chemical-demo.v1.json
```

**What to do**

At the top of the file, replace these values with your satellite information:

```json
{
  "id": "my-chemical-demo",
  "version": "1.0.0",
  "name": "My Chemical Demonstrator",
  "description": "Physical reference for a chemical-propulsion LEO demonstrator.",
  "capabilities": ["GMAT", "Simu-CIC", "OPALIS", "RF-COMLINK"],
  "mission_templates": ["orbit-keeping", "chemical-hohmann-transfer"]
}
```

- `id` must match the filename before `.v1.json`.
- `version` is `1.0.0` for the first version.
- `name` is the name shown in the interface.
- `description` records what the data represents and any important assumption.
- `mission_templates` lists the mission types offered after selection.

For a chemical satellite, keep `orbit-keeping` and/or
`chemical-hohmann-transfer`. Do not list `electric-propulsion-transfer`.

**Expected result**

The new satellite has its own ID and display name. It will not be confused
with the reference satellite that was copied.

## Step 3 — Enter the physical values

**Where to work**

Stay in the same new JSON file. Find this section:

```text
satellite -> bus -> physical
```

**What to do**

Replace the numbers with your spacecraft's values. Keep the field names and
their units unchanged:

```json
"physical": {
  "mass_kg": {
    "dry": 120,
    "wet_at_launch": 155,
    "propellant": 35
  },
  "drag_area_m2": 1.2,
  "drag_coefficient": 2.2
}
```

- `dry` is the spacecraft mass without propellant, in kg.
- `wet_at_launch` is the launch mass, in kg.
- `propellant` is the initial usable propellant mass, in kg.
- `drag_area_m2` is the drag reference area, in m².
- `drag_coefficient` has no unit.

Use real engineering data when it exists. If the definition is only a
demonstrator, state the assumption in `description` or in a nearby `note`.

**Expected result**

The file describes the physical vehicle. The mission orbit is not entered
here; it will be entered when a user creates a mission.

## Step 4 — Configure chemical propulsion

**Where to work**

In the same JSON file, find:

```text
satellite -> bus -> propulsion_subsystem
```

**What to do**

For a chemical vehicle, make the section look like this and replace the
example values with your own:

```json
"propulsion_subsystem": {
  "type": "Bipropellant chemical propulsion",
  "propellant": "Chemical bipropellant",
  "specific_impulse_seconds": 315,
  "main_engine_thrust_n": 10
}
```

The `type` value must contain one of these words: `chemical`, `bipropellant`,
or `monopropellant`. The GMAT adapter uses those words to allow chemical
mission templates.

If you copied an **electric** satellite instead, delete these two complete
objects before saving:

```text
satellite.bus.propulsion_subsystem.electric_thruster
satellite.bus.electrical_subsystem.electric_propulsion_mode
```

Do not keep an `electric_thruster` object in a chemical satellite. Otherwise
the definition mixes two incompatible propulsion models.

**Expected result**

The application recognises the satellite as chemical. The chemical scenario
choices declared in step 2 can be used; electric-only scenarios are not.

## Step 5 — Decide which optional analyses the satellite supports

**Where to work**

Still edit the same JSON file. Look at the top-level `capabilities` list and
at these optional sections under `satellite -> bus`:

```text
electrical_subsystem
opalis
rf_comlink
```

**What to do**

Use this simple decision table:

| If you have… | Keep or add… | Otherwise… |
| --- | --- | --- |
| Mass, drag, and chemical engine data | `GMAT` and chemical `mission_templates` | These are the minimum fields for this tutorial. |
| Solar panels, battery, bus voltage and a valid Simu-CIC setup | `Simu-CIC` | Remove `Simu-CIC` from `capabilities`. |
| Electrical model, battery, load and solar-generator data | `OPALIS` plus the `opalis` section | Remove `OPALIS` from `capabilities`. |
| Radio links, frequencies, data rates and antenna data | `RF-COMLINK` plus the `rf_comlink` section | Remove `RF-COMLINK` from `capabilities`. |

If you copied the chemical reference file and do not have replacement
electrical or RF values, leave the existing structure only while it is clearly
labelled as an engineering assumption. For a real satellite, replace every
copied value with a documented source before using the result.

**Expected result**

`capabilities` matches the data actually present in the file. The interface
will not present an analysis as supported solely because it sounds useful.

## Step 6 — Save, check, and select the satellite

**Where to work**

First use the WSL terminal in the project root. Then use the running web
application.

**What to do**

1. Check the JSON syntax:

   ```bash
   node -e "JSON.parse(require('fs').readFileSync('data/satellite-library/my-chemical-demo.v1.json', 'utf8'))"
   ```

2. Start the project if it is not running:

   ```bash
   python3 scripts/start_local_web.py
   ```

3. Open the frontend URL printed by the launcher.
4. Open **Satellites**, find **My Chemical Demonstrator**, and select it.
5. Open **New simulation** and confirm that a chemical scenario is available.
6. Create a new mission run. Do not edit the generated run folder manually.

**Expected result**

The selected satellite is copied into the new run as `satellite.json`. The
library file in `data/satellite-library/` remains unchanged. If the satellite
does not appear, refresh the browser and check that the new file is valid JSON
and ends with `.json`.

## When backend files must be changed (advanced)

For the normal steps above, do **not** change any file in this section. These
files are changed only when the application itself needs a new rule or a new
data model.

### Change library discovery rules

**Where to work:** [satelliteLibrary.ts](../../backend/src/digitalThread/satelliteLibrary.ts).

**When to change it:** only if satellite files move to another directory or if
new mandatory top-level fields are introduced.

**What to change:**

- Change `LIBRARY_DIR` only when the library directory itself moves.
- Extend `SatelliteDefinition` and `validDefinition()` together when adding a
  mandatory top-level field.
- Do not add one satellite ID to this file. Discovery is automatic.

**Expected result:** every valid JSON file in the configured library folder is
listed; malformed definitions produce a clear error.

### Change run-local validation rules

**Where to work:** [digitalThreadSchema.ts](../../backend/src/digitalThread/digitalThreadSchema.ts).

**When to change it:** only when a new field needs a rule, such as “this value
must be positive” or “these two values must be consistent”.

**What to change:** add the field path to the appropriate validation block;
then add a matching passing and failing test in
`backend/tests/digitalThread/`.

**Expected result:** an invalid selected `satellite.json` is rejected with the
name of the field that must be corrected.

### Change GMAT compatibility rules

**Where to work:** [gmatDigitalThreadAdapter.ts](../../backend/src/digitalThread/gmatDigitalThreadAdapter.ts).

**When to change it:** only when adding a new GMAT template, a new propulsion
class, or a new satellite field that GMAT must consume.

**What to change:** map the new field to the GMAT value expected by the
template, add a guard for missing or incompatible data, then add adapter tests
under `backend/tests/digitalThread/`.

**Expected result:** a compatible satellite produces GMAT inputs; an
incompatible one is blocked before GMAT starts.

### Add or update the selection test

**Where to work:** [fudanLikeChemicalSatellite.test.ts](../../backend/tests/digitalThread/fudanLikeChemicalSatellite.test.ts).

**When to change it:** after adding a new tutorial satellite or changing its
ID, propulsion type, or offered templates.

**What to change:** copy this test, rename it for the new satellite, then
update the ID, version, expected propulsion type, mission templates, and key
physical values.

**Expected result:** from WSL, this command confirms that the backend discovers
and selects the satellite correctly:

```bash
cd /mnt/c/JUSTINE/demonstrator/backend
node --import tsx --test tests/digitalThread/fudanLikeChemicalSatellite.test.ts
```

Run TypeScript tests from WSL, not Windows Node, when `node_modules` was
installed in WSL: `tsx` and `esbuild` use platform-specific binaries.

## Optional release checks

After the normal steps work, a maintainer can run:

```bash
cd /mnt/c/JUSTINE/demonstrator/backend
npm run build
npm run test:stability
```

## Worked example: Fudan-like chemical demonstrator

[fudan-like-chemical-demo.v1.json](../../data/satellite-library/fudan-like-chemical-demo.v1.json)
is a complete fictional example. It is structurally similar to the Fudan
reference, with chemical propulsion substituted for electric propulsion. Its
chemical figures are labelled assumptions; it does not describe the real Fudan
spacecraft.

Files used to create it:

- [Fudan reference definition](../../data/satellite-library/fudan-satellite.v1.json)
  — source structure for electrical, OPALIS, and RF fields.
- [Chemical reference definition](../../data/satellite-library/reference-leo-orbit-keeping.v1.json)
  — source for chemical propulsion naming and chemical scenarios.
- [Completed example](../../data/satellite-library/fudan-like-chemical-demo.v1.json)
  — the actual new library file.
- [Satellite-library loader](../../backend/src/digitalThread/satelliteLibrary.ts)
  — automatic discovery and selection behaviour.
- [Digital-thread validator](../../backend/src/digitalThread/digitalThreadSchema.ts)
  — selected run-local validation.
- [GMAT adapter](../../backend/src/digitalThread/gmatDigitalThreadAdapter.ts)
  — chemical compatibility rule.
- [Focused selection test](../../backend/tests/digitalThread/fudanLikeChemicalSatellite.test.ts)
  — automated discovery and selection check.
