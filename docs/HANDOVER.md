# Project Handover

This handover gives the next maintainer the information needed to understand,
run, maintain, and extend GMAT Agent without relying on the previous
maintainer's computer. Keep this document current whenever ownership, external
tools, deployment, or operational limitations change.

## 1. Context and overview

### Purpose

GMAT Agent is a local engineering workspace for spacecraft mission studies. An
engineer selects a versioned satellite and a GMAT mission scenario, prepares a
dated mission run, launches GMAT and downstream analyses, then reviews the
resulting artifacts. The downstream pipeline can include Simu-CIC, OPALIS, and
RF-COMLINK.

### History and current status

- The project was formerly called **Open Codex Web**.
- It is a local engineering application, not a hosted production service.
- The primary workflow is the deterministic GMAT mission pipeline. The older
  Codex-agent and remote-GUI capabilities remain optional.
- The current implementation and tests are the source of truth for behaviour;
  older reports, MVP notes, and completed runs are historical evidence, not
  current specifications.

### Roadmap and decisions

- Review [Results Audit](RESULTS_AUDIT.md) for the current results-page
  improvement backlog.
- Before changing an external-tool integration, read its module documentation,
  run a focused test, and perform the relevant end-to-end check.
- A mission run is engineering evidence. Do not overwrite or delete a
  completed run to retry an analysis; create a new run or re-prepare its draft.

## 2. Technical information

### Repository and architecture

- Repository: use the Git remote configured for the checkout. The shared
  branch and release-tag policy must be confirmed with the project owner.
- Architecture: React frontend, Fastify backend, and run-local mission
  artifacts. The frontend communicates with backend routes; it must not write
  directly to a mission-run directory or launch a scientific tool.
- Component and module boundaries: [Code Structure](CODE_STRUCTURE.md).
- File-level map: [File Map](FILE_MAP.md).

| Area | Responsibility |
| --- | --- |
| `frontend/` | React user interface for mission authoring, results, and discussion. |
| `backend/` | Fastify API, domain services, workspace isolation, tool invocation, and run persistence. |
| `backend/src/gmat/` | Mission templates, drafts, GMAT generation, and run lifecycle. |
| `backend/src/opalis/` | Simu-CIC and OPALIS preparation, execution, and workflow state. |
| `backend/src/rfComlink/` | RF-COMLINK scenario preparation and result parsing. |
| `data/` | Satellite library, runtime inputs, and mission-run evidence. |
| `tools/` | External-tool scripts and templates called by the backend. |

### Runtime and installation

The application is run from WSL because its startup scripts use Bash, tmux,
and Linux command-line tools. The scientific applications themselves are
installed on Windows and their paths are set in `config.json`.

1. Create `config.json` from `config.example.json` and set local ports,
   workspace paths, and executable paths.
2. From a WSL terminal opened in the project root (the directory containing
   `config.json` and `scripts/`), run:

   ```bash
   python3 scripts/start_local_web.py
   ```

3. Open the frontend URL printed by the launcher. The backend health endpoint
   is printed as well.

Follow [Install the Project](tutorials/INSTALL_THE_PROJECT.md) for a new
computer and [Launch the Project](tutorials/LAUNCH_THE_PROJECT.md) for the
normal day-to-day command.

### Dependencies and external services

| Dependency | Role | Required? |
| --- | --- | --- |
| Node.js, npm, Python 3, tmux, and `lsof` in WSL | Build and launch the local web application. | Yes |
| GMAT | Orbit propagation and mission calculations. | Required for GMAT runs |
| Scilab, Simu-CIC, and CelestLab | Attitude, contact, eclipse, and geometry workflow. | Required for the Simu-CIC stage |
| OPALIS | Electrical-power analysis. | Required for the OPALIS stage |
| RF-COMLINK | Telecommand and telemetry link budgets. | Required for the RF stage |
| AI model endpoint | Mission discussion and AI-assisted analysis. | Optional; leave model configuration `null` when unused |
| PostgreSQL, speech, remote CAD, and remote-desktop services | Optional integrations. | Only when the corresponding feature is enabled |

Use `config.example.json` as the complete configuration reference. Do not
commit `config.json`: it contains machine-specific paths and may contain
credentials.

## 3. Deployment and infrastructure

The supported deployment is a local Windows + WSL installation started with
`python3 scripts/start_local_web.py`. The launcher starts backend and frontend
in tmux sessions, frees stale project ports, validates configuration, and
prints the local URLs.

No shared hosting, CI/CD pipeline, staging environment, production URL, or
central monitoring service is documented in this repository. If any of these
exist outside the repository, record the owner, access method, environment
URLs, deployment procedure, and log location here before handover.

On a launch failure, read the tmux logs printed by the launcher and check
`config.json`, installed npm dependencies, executable paths, and port usage.

## 4. Data, access, and security

- `data/satellite-library/` stores versioned physical satellite definitions.
- Each mission run stores its own `satellite.json`, draft values, generated
  GMAT script, workflow log, and output artifacts. Preserve them as evidence.
- `data/` and `tools/` are runtime contracts; do not remove them merely
  because they are not directly imported by TypeScript.
- Generated `node_modules/`, `dist/`, `tmp/`, Python caches, and TypeScript
  build information are local artifacts and are ignored by Git.
- Give the maintainer repository access, access to the required Windows tool
  installations, writable workspace storage, and approved access to optional
  services they will operate.
- Store credentials through the organisation's approved secret-management
  process. Never place real secrets, internal hosts, or a real `config.json`
  in Git, tickets, email, or this document.
- Backup, retention, restoration, personal-data, and compliance procedures are
  not defined in the repository. The project owner must provide them when they
  apply to the installation.

## 5. Tests and quality checks

Run these checks in the supported WSL environment after installing
dependencies:

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

Before a release, run one compatible GMAT scenario through the full pipeline.
Review the GMAT output and each enabled downstream tool's primary report; a
stage marked `completed` does not by itself certify an engineering result.

## 6. Process and ownership

The repository does not define Scrum, Kanban, ticketing, chat tools, team
rituals, or contact ownership. Before a handover is complete, the project
owner must record:

- the maintainer responsible for the application and each external tool;
- the person who grants repository, service, and secret access;
- the location of open tickets, known bugs, and planned work;
- the review and release/tagging process.

## 7. Documentation and resources

- [Install the Project](tutorials/INSTALL_THE_PROJECT.md)
- [Launch the Project](tutorials/LAUNCH_THE_PROJECT.md)
- [Use the Project](tutorials/USE_THE_PROJECT.md)
- [Add a Satellite](tutorials/ADD_A_SATELLITE.md)
- [Implement a Mission Scenario](tutorials/IMPLEMENT_A_MISSION_SCENARIO.md)
- [Code Structure](CODE_STRUCTURE.md)
- [Results Calculation Contract](RESULTS_CALCULATION_CONTRACT.md)
- [OPALIS Input Contract](OPALIS_INPUT_CONTRACT.md)
- [RF-COMLINK Input Contract](RF_COMLINK_INPUT_CONTRACT.md)
- [Results Audit](RESULTS_AUDIT.md)

## 8. Important cautions

- Simu-CIC contact, propagation-latency, and eclipse summaries are calculated
  from saved CIC samples. Their approximations and units are defined in the
  [Results Calculation Contract](RESULTS_CALCULATION_CONTRACT.md).
- RF-COMLINK currently records extracted HTML reports and link files. It does
  not deterministically expose RF margins, Eb/N0, availability, or data-volume
  figures in the overview. Empty reports are unavailable evidence, even when
  the stage says `completed`.
- The Results discussion may explain saved evidence, but it must never launch
  a tool or modify a completed run.
- External-tool paths, versions, licences, and user access are environment
  dependencies. A working configuration on one computer is not portable until
  these values have been checked on the successor's computer.

## Handover completion checklist

- [ ] All intended source, test, and documentation changes are in a reviewed
  Git commit.
- [ ] `git status --short --branch` is clean.
- [ ] The release commit is pushed to the shared remote and tagged if the team
  uses release tags.
- [ ] The successor has repository access and a secure route to required
  secrets and external services.
- [ ] The successor has launched the project successfully in the supported
  Windows + WSL environment and completed a small reference mission run.
- [ ] Required mission outputs and validation reports are stored in the
  team's approved location.
- [ ] Owners for outstanding work, known issues, and external-tool access are
  recorded.
