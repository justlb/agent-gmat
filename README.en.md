# GMAT Agent

GMAT Agent is a React + Fastify engineering workspace for spacecraft mission
studies centered on GMAT orbit simulation and its downstream pipeline
(Simu-CIC, OPALIS, RF-COMLINK). Runtime settings are loaded from the root
`config.json`, including ports, workspace paths, GMAT location, and model
endpoints for the Mission Studio discussion features.

> Formerly known as "Open Codex Web". The original Codex Agent and remote GUI
> features remain available but the primary workflow is now the determinstic
> GMAT mission pipeline.

For operational ownership transfer, start with [the handover guide](docs/HANDOVER.md).
It records external dependencies and known evidence limitations, including the
current RF-COMLINK result-extraction boundary.
For module boundaries, see [Code Structure](docs/CODE_STRUCTURE.md).

## Configuration

Before the first run, copy the example and fill in environment-specific values:

```bash
cp config.example.json config.json
```

Do not commit real API keys, internal hosts, or private paths. Key fields:

| Field | Description |
| --- | --- |
| `server.port` | Required backend port |
| `frontend.port` / `frontend.httpsPort` | Required frontend HTTP / HTTPS ports |
| `tmux.backendSession` / `tmux.frontendSession` | tmux session names |
| `workspace.templateDir` | Example data root directory |
| `workspace.usersRoot` | Per-user workspace root |
| `tools.gmat.bin` | Path to GMAT console executable |
| `tools.gmat.timeoutMs` | GMAT execution timeout in milliseconds |
| `tools.rfComlink.home` | Windows folder containing `rf-comlink.exe` |
| `chatModel.*` | LLM settings for Mission Studio discussion |

## Start the project (recommended)

**Run from WSL** — the project depends on tmux and Linux tooling:

```bash
cd /mnt/d/path/to/agent-gmat-main
python3 scripts/start_local_web.py
```

The script will:
1. Stop existing tmux sessions and free ports
2. Install frontend/backend npm dependencies automatically
3. Validate `config.json`
4. Start backend and frontend (each in its own tmux session)
5. Wait until both are ready, then print the access URLs

### Options

```bash
python3 scripts/start_local_web.py --require-model-health  # Fail if LLM unreachable
python3 scripts/start_local_web.py --with-remote-gui       # Also start FreeCAD/ParaView/COMSOL
python3 scripts/start_local_web.py --timeout 120          # Increase readiness wait to 120s
```

### Manual start (for debugging)

```bash
# Backend
cd backend && npm run dev

# Frontend (separate terminal)
cd frontend && npm run dev:https
```

### Access

Once ready:
- Frontend: `https://127.0.0.1:<frontend.httpsPort>`
- Backend health: `http://127.0.0.1:<server.port>/api/health`

## Run GMAT tests

```bash
cd backend

# Baseline regression (GMAT + digital thread)
npm run test:gmat:baseline

# Chemical Hohmann
node --import tsx --test tests/gmat/chemicalHohmannGeneration.test.ts

# Electric transfer
npm run test:gmat:electric

# Full suite
npm test
```

## Build check

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

## Project structure

```text
backend/            Fastify API + service layer
  src/gmat/         GMAT templates, drafts, rendering, run lifecycle
  src/digitalThread/  Satellite definitions, mission selection
  src/opalis/       Simu-CIC + OPALIS pipeline
  src/rfComlink/    RF-COMLINK analysis
  src/runs/         Run directories, artifact management, workflow
  src/modelBackends/  Model routing adapters
  src/server/       Server composition, request context
  workflow_agents/  GMAT template assets (scripts, template.json, references)
frontend/           React + TypeScript + Vite
  src/pages/agent/  Mission Studio, Results, Discussion
data/               Satellite library, input data, mission-runs
tools/              OPALIS / RF-COMLINK external scripts
```
