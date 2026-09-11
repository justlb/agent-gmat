# orbit-keeping-template

Template for chemical-propellant autonomous LEO reboost / orbit-keeping missions.

## Files

| File | Purpose |
|---|---|
| `template.json` | Manifest: ID, fields, artifacts, downstream analyses. |
| `references/orbit_keeping.script` | Immutable reference GMAT script (AutonomousLEOReboost variant). |
| `references/orbit_keeping.values.yaml` | Default rendered values for the reference script. |
| `references/earth_radius.txt` | Reference constant used by some offline validators. |

## What this template models

A chemical-propellant satellite that periodically fires its thruster to maintain a target semi-major axis against atmospheric drag. The GMAT script runs a `Propagate` loop checking `FuelMass > fuelReserve` and `Altitude < minimumAltitude`, performs a `Target` burn, then continues propagation.

## Required satellite properties

Dry mass, initial chemical propellant mass, specific impulse (Isp), drag area, drag coefficient.

## Mission inputs

Initial orbit (altitude, eccentricity, inclination), target or minimum altitude, fuel reserve, mission duration limit.
