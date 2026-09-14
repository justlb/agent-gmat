# Project Handover

This document gives the next maintainer the information needed to operate,
validate, and extend the project without relying on the departing developer's
local machine.

## What the project does

GMAT Agent (formerly Open Codex Web) is a local engineering workspace for spacecraft mission studies.
The React frontend lets an engineer select a versioned satellite and GMAT
mission scenario, prepare a dated mission run, launch GMAT and downstream
analyses, and inspect the resulting artifacts. The Fastify backend owns
workspace isolation, tool invocation, run persistence, and model requests.

The component boundaries are documented in [Code Structure](CODE_STRUCTURE.md).
The complete artifact chain is documented in [Mission Data Flow](MISSION_DATA_FLOW.md).

## Continuity essentials

| Item | Handover information |
| --- | --- |
| **Git repository URL** | https://github.com/justlb/agent-gmat.git. The successor must have this URL and repository access before any clone, update, review, or release is possible. |
| **Tool versions** | Record the versions installed on the target workstation before handover; the verified reference environment is listed below. |
| **Known errors and pitfalls** | Read the installation guide troubleshooting table before changing tool paths or bypassing validation. |
| **Backup and restoration** | No automated backup procedure is defined by this repository. Source recovery comes from the Git remote; mission-run and local-config recovery must use the organisation's approved storage. Search the project owner, shared engineering storage, and the release/tag history for the current backup location. |
| **Business glossary** | See the glossary in this document before assigning maintenance to a non-specialist. |

## Verified tool versions and compatibility

These are the versions used to validate the current Windows/WSL integration.
They are not a substitute for recording the exact versions on the successor's
machine.

| Component | Verified version or requirement | Notes |
| --- | --- | --- |
| WSL | WSL2 with Ubuntu | Runs the web stack, Node.js and WSL Python workers. |
| Node.js | 22 LTS or newer | Used for backend/frontend dependency installation and build. |
| Python for OPALIS | Windows Python 3.12, 64-bit | Must use `pythonnet==3.0.5`; it hosts .NET Framework. |
| OPALIS | 2.3.0 / .NET Framework 4.8 | Must run through Windows Python, not `/usr/bin/python3`. |
| Scilab | 2025.1.0 | Configure `Scilex.exe`; the Simu-CIC launcher selects `WScilex.exe`. |
| Simu-CIC / CelestLab | Local installed pair | `simu_cic/loader.sce` and `celestlab/loader.sce` must both exist. |
| RF-COMLINK | 1.1.1.0 | Must include `rf-comlink.exe` and `Resources/GROUND_STATION_DATABASE.txt`. |
| GMAT | Installed Windows GMAT release | Both `GmatConsole.exe` and `GMAT.exe` are required. Record the actual installed version. |

## Backup and restoration procedure

1. Recover the source by cloning the required Git commit or release tag from
   the repository URL above.
2. Recreate the ignored `config.json` from `config.example.json`, then obtain
   paths and credentials through the approved secret-management process.
3. Restore `data/user/` only from approved engineering storage when historical
   mission evidence is required. Do not copy generated runs into the source
   repository.
4. Restore any required satellite-library additions, tool templates, reports,
   or external-tool licences from the team's approved storage.
5. Run the installation preflight and first-day procedure below before relying
   on a restored workstation.

If no approved backup location is known, escalate to the project owner before
deleting a workstation, cleaning `data/user/`, or replacing external-tool
installations.

## Business glossary

| Term | Meaning in this project |
| --- | --- |
| GMAT | General Mission Analysis Tool. It propagates the mission and produces the OEM ephemeris. |
| OEM | CCSDS Orbit Ephemeris Message produced by GMAT, normally `EphemerisFile1.oem`. |
| Simu-CIC | CNES/Scilab simulation step that converts the trajectory into attitude, visibility, eclipse and geometry CIC files. |
| CIC | Files produced by Simu-CIC and consumed by OPALIS/RF-COMLINK, such as distance, visibility and direction time series. |
| CelestLab | CNES Scilab library loaded before Simu-CIC. |
| OPALIS | Electrical-power simulation tool. It consumes CIC flux/geometry data and satellite electrical parameters. |
| RF-COMLINK | Communication-link tool. It consumes selected ground-station data, CIC geometry and RF system parameters. |
| Digital thread | The run-local `satellite.json` plus its revision history and analysis requests; it is the shared source for tool adapters. |
| Mission run | A dated, immutable evidence directory under `data/user/<user>/gmat/mission-runs/`. |
| Run-local artifact | A file generated or copied for one mission run. It must not overwrite an immutable library/template input. |

## Read this first

For a future human maintainer or coding agent, use this order of precedence:

1. the TypeScript implementation and tests for current behaviour;
2. the run-local artifacts for the evidence of one particular mission run;
3. `config.example.json` for the complete configuration shape;
4. this handover and the tutorials for operational procedure.

Do not treat an old audit, an MVP note, a report, a slide deck, or a completed
run as a specification for current behaviour. Those documents are retained as
historical context. Before changing an external-tool integration, read its
module README and run one focused test plus the relevant end-to-end check.

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

3. Start the services from WSL:

   ```bash
   cd /mnt/d/path/to/agent-gmat-main
   python3 scripts/start_local_web.py
   ```

4. Open the printed frontend URL and complete a small mission run with a
   reference satellite.
5. Confirm that the run has a `satellite.json`, a generated GMAT script,
   workflow status, and visible artifacts in **Results**. If downstream tools
   are configured, confirm their CIC/OPALIS/RF artifacts as well; a stage
   marked complete is not a substitute for reviewing its primary report.

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

## Known operational limitations

- A completed workflow stage means its launcher completed and its declared
  artifacts were recorded. It does not automatically certify an engineering
  result; inspect the primary output before relying on it.
- Simu-CIC contact, propagation-latency, and eclipse summaries are calculated
  from saved CIC samples. Their approximation and units are defined in
  [Results calculation contract](RESULTS_CALCULATION_CONTRACT.md).
- RF-COMLINK saves the calculated `.rfcl` package, extracted reports, and
  parsed link-budget indicators for each configured link. Empty reports or a
  missing link-budget table remain unavailable evidence, even if the stage is
  marked `completed`.
- The Results discussion explains saved evidence; it must never launch a tool
  or modify a completed run.

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
- [RF-COMLINK input contract](contract/RF_COMLINK_INPUT_CONTRACT.md)
- [Results audit and improvement backlog](RESULTS_AUDIT.md)

## Final delivery checklist

- [ ] All intended source, test, and documentation changes are committed in a reviewed Git commit.
- [ ] `git status --short --branch` has no uncommitted or untracked work.
- [ ] The release commit is pushed to the shared remote and tagged if the team uses release tags.
- [ ] The successor has repository access and a secure path to the required secrets and external services.
- [ ] The successor has completed the first-day procedure in the supported
  WSL/Windows environment, including the external tools they are expected to operate.
- [ ] Mission outputs or validation reports that must be retained have been copied to the team's approved storage.
- [ ] Ownership of outstanding work, including the Results-page improvement backlog, has been assigned.
