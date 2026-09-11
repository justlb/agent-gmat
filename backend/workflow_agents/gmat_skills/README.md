# backend/workflow_agents/gmat_skills

GMAT mission template resources. Each template is a self-contained directory under `<template-id>-template/` declaring:

1. `template.json` — manifest (ID, propulsion requirement, fields, artifacts, downstream analyses)
2. `references/<script>.script` — immutable reference GMAT script
3. `references/<script>.values.yaml` — default values (optional; some templates derive values from the satellite library)
4. `template/` — directory output used by the backend at runtime

## Registered templates

| ID | Name | Propulsion | Downstream |
|---|---|---|---|
| `orbit-keeping` | Autonomous LEO reboost | chemical | Simu-CIC, OPALIS, RF-COMLINK |
| `electric-propulsion-transfer` | Electric spiral transfer | electric | Simu-CIC, OPALIS |
| `chemical-hohmann-transfer` | Two-impulse Hohmann transfer | chemical | Simu-CIC, OPALIS, RF-COMLINK |
| `electrical-leo-orbit-maintenance` | Electric LEO station keeping | electric | Simu-CIC, OPALIS |

To add a new template, read `ADDING_A_GMAT_mission_scenario.md` (in this directory).
