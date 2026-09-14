# OPALIS Input Contract

This document defines the only authorised sources for an OPALIS execution.
An execution is associated with **one GMAT run** and never mixes data
from another run or another satellite.

```text
satellite.json from the run ─┐
                             ├─> OPALIS adapter ─> static parameters of the .opalis case
CIC/Sat from Simu-CIC ───────┘                     + dynamic fluxes
```

## 1. Dynamic source: CIC files from Simu-CIC

The input directory must be the one produced for the run:

```text
<run>/opalis/02-simu-cic/02-fichiers-cic/Sat/
```

These files are not replaced by values from `satellite.json`. They
describe geometry and vary over time.

| OPALIS data | Expected CIC file | Status |
|---|---|---|
| Sun angle per section | `Sat_SUN_ANGLE_SA_<n>.TXT` | required; explicit SA_1 fallback allowed |
| Earth eclipse | `Sat_SATELLITE_ECLIPSE.TXT` | required |
| Moon eclipse | `Sat_SATELLITE_ECLIPSE_MOON.TXT` | optional |
| Earth angle per section | `Sat_EARTH_ANGLE_SA_<n>.TXT` | required; explicit SA_1 fallback allowed |
| altitude | `Sat_SATELLITE_ALTITUDE.TXT` | required |
| Earth direction in satellite frame | `Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT` | required |
| Sun direction | `Sat_SUN_DIRECTION-SATELLITE_FRAME.TXT`, otherwise `Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT` | required |
| geographical coordinates | `Sat_GEOGRAPHICAL_COORDINATES.TXT` | required |

The existing pipeline produces a `FLOWS-SA-<n>.TXT` for each OPALIS
solar section from these files. The manifest must report any geometry
fallback from SA_1 to another section.

## 2. Static source: satellite.json

The file used is the run snapshot:

```text
<run>/satellite.json
```

For older runs, `satellite.digital-thread.json` is accepted as a
read-compatibility fallback. The satellite library itself is not
a direct input: its values must already have been copied into the
run's `satellite.json`.

The fields below are the OPALIS inputs. They reconstruct all
values from the first tab of the `.opalis` case starting from
`empty.opalis`; embedded files, fluxes, and reference-case results
are excluded. Values are configured once before computation and
traced in `opalis-parameters.json`.

| Data | Path in satellite.json | Unit | Required | Expected OPALIS target |
|---|---|---:|---|---|
| satellite name | `satellite.identity.name` | text | no | `SimulationModel.PowerProfil.SatelliteName` |
| reference time step | `satellite.bus.opalis.simulation.reference_time_step_s` | s | yes | `SimulationModel.SimulationTiming.Timestep` |
| reference duration | `satellite.bus.opalis.simulation.reference_duration_s` | s | yes | `SimulationModel.SimulationTiming.Simultime` |
| power supply mode | `satellite.bus.opalis.model.power_supply` | text | yes | `SimulationModel.GlobalArchitecture.VSupply` |
| regulation type | `satellite.bus.opalis.model.regulation_type` | text | yes | `SimulationModel.GlobalArchitecture.RegulType` |
| distribution resistance | `satellite.bus.opalis.model.distribution_resistance_ohm` | ohm | yes | `SimulationModel.GlobalArchitecture.RDistribution` |
| initial battery voltage | `satellite.bus.opalis.battery.initial_voltage_v` | V | yes | `SimulationModel.SimulationInitialisation.VBatt` |
| initial state of charge | `satellite.bus.opalis.battery.initial_state_of_charge` | 0–1 | yes | `SimulationModel.SimulationInitialisation.SocBattery` |
| battery energy | `satellite.bus.opalis.battery.energy_wh` | Wh | yes | `SimulationModel.Battery.Energy` |
| parallel cell count | `satellite.bus.opalis.battery.cells_parallel` | integer | yes | `SimulationModel.Battery.NParallel` |
| series cell count | `satellite.bus.opalis.battery.cells_series` | integer | yes | `SimulationModel.Battery.NSerie` |
| distribution load | `satellite.bus.opalis.power_distribution.constant_load_w` | W | yes | `SimulationModel.DistributionLines[0].PConstant` |
| distribution margin | `satellite.bus.opalis.power_distribution.margin_w` | W or % depending on mode | yes | `SimulationModel.DistributionLines[0].PMargin` |
| consumption mode | `satellite.bus.opalis.power_distribution.consumption_mode` | text | yes | `SimulationModel.DistributionLines[0].PowerConsumptionMode` |
| solar constant | `satellite.bus.opalis.environment.solar_constant_w_m2` | W/m² | yes | `SimulationModel.SolarGenerator.SolarConstant` |
| albedo | `satellite.bus.opalis.environment.albedo_w_m2` | W/m² | yes | `SimulationModel.SolarGenerator.Albedo` |
| Earth radiation | `satellite.bus.opalis.environment.earth_radiation_w_m2` | W/m² | yes | `SimulationModel.SolarGenerator.PEarth` |
| section n area | `satellite.bus.opalis.solar_generator.sections[n].area_m2` | m² | yes | `SimulationModel.SolarGenerator.Sections[n].SectionArea` |
| section n filling factor | `satellite.bus.opalis.solar_generator.sections[n].filling_factor` | 0–1 | yes | `SimulationModel.SolarGenerator.Sections[n].FillingFactor` |
| section n series cells | `satellite.bus.opalis.solar_generator.sections[n].cells_series` | integer | yes | `SimulationModel.SolarGenerator.Sections[n].NSsection` |
| section n parallel cells | `satellite.bus.opalis.solar_generator.sections[n].cells_parallel` | integer | yes | `SimulationModel.SolarGenerator.Sections[n].NPsection` |

The generic geometry `electrical_subsystem.solar_panels.total_area_m2`
is not used to configure OPALIS: only the sum of
`satellite.bus.opalis.solar_generator.sections[*].area_m2` is used.
The two quantities may differ (projected GMAT area vs. active face/panel
OPALIS area).

Missing properties in a satellite definition must remain `null`.
The adapter then blocks OPALIS and displays the missing path; it must
not invent a value from a template.

## 3. Properties owned by the template

The `.opalis` template remains the owner of architecture not described
by the satellite: thermal model, regulator type, detailed cell data,
resistances, current limits, and dynamic power profile. The adapter
does not override them.

The starting point is `D:/STAGE/APP/opalis-2.4.0/Example/empty.opalis`,
referenced by `satellite.bus.opalis.model.template_id = "empty.opalis"`.
The adapter must populate all static properties from the first tab
of this file before loading CIC files. It never copies embedded
files (`ephemeris/*`), `results.xml`, `charts.xml`, or reference-case
results.

`SimulationModel.InterpolateEphemeris=true` is imposed by the workflow,
not by the satellite: it defines how OPALIS reads CIC fluxes.

> API note: OPALIS XML serialises the element under the name `SolarCell`,
> but the .NET API exposes the property as `Cell`. Manifest paths
> therefore use `SimulationModel.SolarGenerator.Sections[n].Cell.*`.

## 4. Resolved input file

Before OPALIS, the backend must produce this immutable file in the
run directory:

```text
<run>/opalis/02-opalis-input/opalis-parameters.json
```

It must contain at minimum:

```json
{
  "schema_version": 1,
  "source_satellite": "satellite.json",
  "source_cic_directory": "opalis/02-simu-cic/02-fichiers-cic/Sat",
  "template": "<chosen OPALIS template>",
  "parameters": [
    {
      "source_path": "satellite.bus.electrical_subsystem.solar_panels.albedo_w_m2",
      "opalis_path": "SimulationModel.SolarGenerator.Albedo",
      "value": 410,
      "unit": "W/m²"
    }
  ],
  "validation": { "status": "ready", "missing": [], "warnings": [] }
}
```

This file is the interface between TypeScript and Python. The Python
pipeline must therefore no longer receive a series of `--set` flags
decided manually by the frontend.

## 5. Pre-launch validation rules

OPALIS may be launched only if:

1. the CIC directory from the same run exists and contains all required files;
2. `satellite.json` from the same run exists;
3. all mandatory static inputs are numeric, finite, and within their
   physical ranges;
4. the number of sections in `opalis_sections` is compatible with the
   OPALIS template;
5. the sum of section areas matches `total_area_m2`;
6. the `opalis-parameters.json` file is saved before execution.

When changing this contract, update the TypeScript adapter, the Python
pipeline, and their focused tests together. Verify exact paths against the
configured OPALIS template; never infer them from a previous run.
