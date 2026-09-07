# Project Handover

This document gives the next maintainer the information needed to operate,
validate, and extend the project without relying on the departing developer's
local machine.

## What the project does

Open Codex Web is a local engineering workspace for spacecraft mission studies.
The React frontend lets an engineer select a versioned satellite and GMAT
mission scenario, prepare a dated mission run, launch GMAT and downstream
analyses, and inspect the resulting artifacts. The Fastify backend owns
workspace isolation, tool invocation, run persistence, and model requests.

The component boundaries are documented in [Code Structure](CODE_STRUCTURE.md).

## Required access and runtime dependencies

The standard startup scripts target Linux and use Bash, tmux, and the external
tools configured in `config.json`. The handover must give the maintainer access
to the following items through the organisation's approved secret-management
process:

| Item | Why it is needed |
| --- | --- |
| Repository and its Git remote | Source history, release tags, and collaboration. |
| `config.json` values or their replacement secret source | Ports, workspace roots, model endpoints, and optional services are environment-specific and deliberately ignored by Git. |
| GMAT installation | Required for GMAT execution; set `tools.gmat.bin` to its console executable. |
| Workspace storage | `workspace.templateDir` and `workspace.usersRoot` must be accessible and writable by the backend user. |
| Model endpoint credentials | Required only for the Codex and mission-discussion features that use a model. |
| Optional service access | PostgreSQL, FunASR, CosyVoice, FreeCAD, ParaView, COMSOL, and remote desktop tools are enabled only when the corresponding features are used. |

Never send a real `config.json` or its credentials in the source repository,
commit history, a ticket, or this document.

## First-day procedure

1. Clone the release commit and create `config.json` from `config.example.json`.
2. Validate configuration:

   ```bash
   node scripts/validate_config.mjs --config config.json
   ```

3. Start the services:

   ```bash
   ./start_open_codex_web.sh
   ```

4. Open the printed frontend URL and complete a small mission run with a
   reference satellite.
5. Confirm that the run has a `satellite.json`, a generated GMAT script,
   workflow status, and visible artifacts in **Results**.

For installation and manual start commands, see [README.en.md](../README.en.md).
For the engineering workflow, see [Use the Project](tutorials/USE_THE_PROJECT.md).

## Source of truth and data retention

- `data/satellite-library/` stores immutable, versioned physical satellite definitions.
- Each dated mission run stores its own `satellite.json`, draft, generated
  GMAT script, workflow log, and outputs. Preserve these files as engineering evidence.
- `data/` and `tools/` include runtime contracts and external tool inputs.
  Their lack of a direct TypeScript import is not evidence that they can be deleted.
- Generated directories such as `node_modules/`, `dist/`, `tmp/`, Python
  caches, and TypeScript build information are excluded by `.gitignore`.

## Validation before a release

Run the following in the supported environment after installing dependencies:

```bash
cd backend
npm run build
npm run test:gmat:baseline
npm run test:stability
npm test

cd ../frontend
npm run build
npm run lint
npm test
```

Then run one compatible GMAT scenario through the full pipeline. Check the
GMAT output and every enabled downstream stage before tagging a release.

## Extension guides

- [Implement a new GMAT mission scenario](tutorials/IMPLEMENT_A_MISSION_SCENARIO.md)
- [Add a satellite definition](tutorials/ADD_A_SATELLITE.md)
- [Use the project](tutorials/USE_THE_PROJECT.md)
- [Results audit and improvement backlog](RESULTS_AUDIT.md)

## Final delivery checklist

- [ ] All intended source, test, and documentation changes are committed in a reviewed Git commit.
- [ ] `git status --short --branch` has no uncommitted or untracked work.
- [ ] The release commit is pushed to the shared remote and tagged if the team uses release tags.
- [ ] The successor has repository access and a secure path to the required secrets and external services.
- [ ] The successor has completed the first-day procedure on the target Linux environment.
- [ ] Mission outputs or validation reports that must be retained have been copied to the team's approved storage.
- [ ] Ownership of outstanding work, including the Results-page improvement backlog, has been assigned.
