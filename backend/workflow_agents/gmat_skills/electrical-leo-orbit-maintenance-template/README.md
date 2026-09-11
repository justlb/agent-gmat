# electrical-leo-orbit-maintenance-template

Template for electric-propellant LEO station-keeping (combined electric + station-keeping inputs).

## Files

| File | Purpose |
|---|---|
| `template.json` | Manifest: ID, fields, artifacts, downstream analyses. |
| `references/electrical_LEOorbit_maintenance.script` | Immutable reference GMAT script. |

## What this template models

An electric-propulsion LEO station-keeping mission with a bounded throttle
control. It is not a hybrid chemical/electric model.

## Required satellite properties

Dry mass, initial electric propellant mass, thruster power limits, solar-array properties.

## Mission inputs

Initial orbit, minimum reboost altitude, optional throttle bias and gain, mission duration limit.
