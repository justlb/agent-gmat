# MVP-2b — Orbit-keeping values and deterministic rendering

> **Status: superseded.** This MVP record describes the Handlebars-based
> 193-slot pipeline. The current project replaces Handlebars with slot-based
> auto-extraction directly from .script files. The historical record is
> preserved below.

Status: completed

The reference GMAT script remains immutable. The `orbit_keeping.values.yaml` file contains 193 value slots with their GMAT context. The renderer accepts only that same set of slots and rejects incomplete, invalid, or context-mismatched YAML.

## Manual trial under WSL

Copy the reference values before modification:

```bash
cp workflow_agents/gmat_skills/orbit-keeping-template/references/orbit_keeping.values.yaml /tmp/orbit-keeping.values.yaml
```

Modify `value` fields in the copy, then render the script:

```bash
node --import tsx scripts/render_orbit_keeping_values.mts \
  --values /tmp/orbit-keeping.values.yaml \
  --output /tmp/mission.script
```

The renderer does not contact any LLM and does not execute GMAT.
