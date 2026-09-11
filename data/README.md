# data

Runtime data directory — everything here is either generated or versioned input.

| Directory | Purpose |
|---|---|
| `satellite-library/` | **Immutable, versioned** physical satellite definitions (JSON). Scanned at runtime. |
| `input_data/` | Legacy template inputs (thermal, GNC, derating). Not directly used by GMAT pipeline. |
| `templates/` | Legacy workspace templates. |
| `compliance/` | Compliance-check configuration. |
| `gmat-script-validation-20260904/` | One-off validation artefact. |
| `user/` | Per-user workspaces (gitignored). The GMAT pipeline writes to `user/default/gmat/mission-runs/`. |
