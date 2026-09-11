# electric-propulsion-transfer-template

Template for low-thrust electric-propellant spiral transfer missions.

## Files

| File | Purpose |
|---|---|
| `template.json` | Manifest: ID, fields, artifacts, downstream analyses. |
| `references/electric_propulsion_transfer.script` | Immutable reference GMAT script. |

## What this template models

A satellite using an electric thruster (continuous low-thrust spiral) to raise its orbit. The GMAT script propagates with a `Propagate` block, stops when it reaches the target SMA or runs out of fuel.

## Required satellite properties

Dry mass, initial electric propellant mass, maximum usable power, solar-array properties.

## Mission inputs

Initial orbit and final target altitude. The selected satellite supplies the
propulsion and electrical properties; do not assume undocumented UI fields are
editable inputs.
