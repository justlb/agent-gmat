# backend/workflow_agents

GMAT template assets and Codex agent skills. The GMAT templates are the primary content; the `agents/` subdirectory is legacy.

## Directory structure

```text
workflow_agents/
├── gmat_skills/                          ← GMAT template resources (active)
│   ├── orbit-keeping-template/
│   ├── electric-propulsion-transfer-template/
│   ├── chemical-hohmann-transfer-template/
│   ├── electrical-leo-orbit-maintenance-template/
│   ├── ADDING_A_GMAT_mission_scenario.md
│   └── ...
├── agents/                               ← Legacy Codex agent CLI tools
│   ├── freecad_cli_tools/src
│   └── sim_cli_tools/src
└── ...
```

See `gmat_skills/ADDING_A_GMAT_mission_scenario.md` for how to add a new GMAT template.
