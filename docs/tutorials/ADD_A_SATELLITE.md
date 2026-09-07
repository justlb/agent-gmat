# Add a Satellite to the Project

This guide adds a versioned physical spacecraft definition to the satellite
library. The library is the source of truth for vehicle properties. Mission
orbit, selected ground station, and what-if values belong to a run-local
`satellite.json`, not to the library file.

## What happens when a user selects a satellite

```text
data/satellite-library/<definition>.json
        -> Satellite Library and Mission Studio
        -> user selects an ID and version for a dated run
        -> complete physical vehicle is copied to run-local satellite.json
        -> current mission orbit is retained
        -> GMAT, Simu-CIC, OPALIS, and RF-COMLINK consume the run snapshot
```

The backend scans every `.json` file in `data/satellite-library` at runtime.
There is no additional registration list. Definitions are sorted by display
name, selected by `id` and optional `version`, and remain immutable after a
run starts.

## 1. Choose a stable identity and version

Create a new file in:

```text
data/satellite-library/<satellite-id>.v1.json
```

Use a stable lowercase ID such as `aurora-leo`. Do not reuse an ID for a
materially different spacecraft. When a released design changes, add a new
file and version, such as `aurora-leo.v2.json` with `"version": "2.0.0"`.
Existing mission runs preserve their own satellite snapshot and will not be
changed by a new library definition.

Start from the closest reference:

- [`data/satellite-library/reference-leo-orbit-keeping.v1.json`](../../data/satellite-library/reference-leo-orbit-keeping.v1.json)
  for chemical-propulsion missions.
- [`data/satellite-library/reference-leo-electric.v1.json`](../../data/satellite-library/reference-leo-electric.v1.json)
  for electric-propulsion missions.
- [`data/satellite-library/fudan-satellite.v1.json`](../../data/satellite-library/fudan-satellite.v1.json)
  for a detailed spacecraft and RF link definition.

## 2. Create the definition

This is a compact, practical starting point. It is deliberately incomplete for
an electric or RF-enabled mission; add those sections before declaring the
associated capabilities.

```json
{
  "id": "aurora-leo",
  "version": "1.0.0",
  "name": "Aurora LEO Demonstrator",
  "description": "Physical reference for the Aurora LEO demonstrator. Mission orbit and run-specific values are excluded.",
  "capabilities": ["GMAT", "Simu-CIC"],
  "mission_templates": ["orbit-keeping"],
  "satellite": {
    "identity": {
      "name": "Aurora LEO Demonstrator",
      "operator": "Example operator",
      "mission_type": "Technology demonstration"
    },
    "bus": {
      "physical": {
        "mass_kg": {
          "dry": 120,
          "wet_at_launch": 155,
          "propellant": 35
        },
        "drag_area_m2": 1.2,
        "drag_coefficient": 2.2
      },
      "propulsion_subsystem": {
        "type": "Bipropellant chemical propulsion",
        "propellant": "Chemical bipropellant",
        "specific_impulse_seconds": 315,
        "main_engine_thrust_n": 10
      },
      "electrical_subsystem": {
        "solar_panels": {
          "type": "Triple-junction GaAs",
          "efficiency_percent": 30,
          "total_area_m2": 4,
          "total_power_generated_watts": 1200,
          "array_orientation": "Deployed"
        },
        "batteries": {
          "chemistry": "Li-ion",
          "capacity_ah": 50,
          "energy_wh": 1400
        },
        "bus_voltage_v": 28,
        "spacecraft_bus_load_kw": 0.5,
        "system_margin_percent": 10
      }
    }
  }
}
```

All numbers must use the units encoded in their field names. Do not add a
second field with a different unit for the same quantity. Document assumptions
in `description`, a field-level `note`, or a project source document rather
than using ambiguous names.

## 3. Provide the data required by the declared capabilities

`capabilities` describes what the spacecraft definition can support; it is
not a list of planned activities. Only declare a capability when the required
vehicle data is available.

| Capability or scenario | Required data to review |
| --- | --- |
| GMAT chemical scenario | Dry mass, drag area/coefficient, chemical propulsion type, specific impulse, and compatible `mission_templates`. |
| Electric-propulsion scenario | The above physical data plus `electric_thruster` propellant, power limits, thrust, and electric propulsion type. |
| Simu-CIC / OPALIS | Electrical subsystem, solar panels, battery, and the appropriate `opalis` model, battery, distribution, environment, and solar-generator sections. |
| RF-COMLINK | `rf_comlink` data handling and link records, including frequency band, data rate, direction, and antenna data. |

The data structure is intentionally open for detailed subsystem facts, but the
digital-thread validator checks core physical and electrical values when they
are present. For example, dry mass, drag area, specific impulse, solar area,
solar power, and bus voltage must be positive. Solar efficiency must be in
`(0, 100]`; electrical margin must be between `0` and `100`.

If an electric thruster specifies both minimum and maximum usable power, the
minimum cannot be larger than the maximum.

## 4. Declare compatible scenarios truthfully

The `mission_templates` array controls what Mission V2 offers after the user
selects the spacecraft. It uses registered scenario IDs, such as:

```json
"mission_templates": [
  "orbit-keeping",
  "chemical-hohmann-transfer"
]
```

For an electric vehicle, a typical value is:

```json
"mission_templates": ["electric-propulsion-transfer"]
```

The GMAT digital-thread adapter performs a second, engineering-level
compatibility check. A list entry does not bypass a propulsion or missing-data
guard. Add a new scenario ID here only after the scenario itself has been
implemented and validated; see [Implement a Mission Scenario](IMPLEMENT_A_MISSION_SCENARIO.md).

## 5. Keep orbit and mission requests out of the library

Do **not** place an operational orbit in a library definition. On selection,
the backend replaces the physical satellite section but preserves the current
run's `satellite.orbit` mission state. This prevents a physical library update
from silently altering a mission trajectory.

Likewise, place mission-specific attitude, ground-station, or RF selections in
the dated run. If the definition includes `analysis_requests`, they are merged
into the selected run as initial defaults; they do not change previously
created runs.

## 6. Validate the satellite

Perform these checks before opening a pull request:

1. Parse the JSON with your editor or `node -e "JSON.parse(require('fs').readFileSync('data/satellite-library/aurora-leo.v1.json', 'utf8'))"`.
2. Review every field against its engineering source and unit.
3. Start the application and open **Satellites**. Confirm that the definition,
   physical summary, compatible scenario labels, solar sections, and RF links
   render as expected.
4. Open **New simulation**, select the satellite, choose a compatible
   scenario, and verify that a new dated run has a `satellite.json` containing
   the expected physical data and its own mission orbit.
5. From `backend/`, run `npm run build` and `npm run test:stability`.

The definitive structural checks live in
[`backend/src/digitalThread/digitalThreadSchema.ts`](../../backend/src/digitalThread/digitalThreadSchema.ts),
and library selection behaviour lives in
[`backend/src/digitalThread/satelliteLibrary.ts`](../../backend/src/digitalThread/satelliteLibrary.ts).
