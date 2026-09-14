# Launch the Project

Related guides: [Install the Project](INSTALL_THE_PROJECT.md),
[Use the Project](USE_THE_PROJECT.md), [Add a Satellite](ADD_A_SATELLITE.md),
and [Implement a Mission Scenario](IMPLEMENT_A_MISSION_SCENARIO.md).

## Prerequisites

- WSL (Windows Subsystem for Linux) installed and configured
- `config.json` configured at the project root (see [Install the Project](INSTALL_THE_PROJECT.md))
- Node.js installed via nvm in WSL
- GMAT installed on Windows (path configured in `config.json` > `tools.gmat.bin`)
- AI configuration is optional: leave the `openai` and `chatModel` fields at
  `null` when AI-assisted discussion is not needed.

## Quick start

From WSL, open a terminal in the project root: the directory that contains
`config.json` and the `scripts/` directory. Then run:

```bash
python3 scripts/start_local_web.py
```

Every installation can place the clone in a different directory; do not copy a
path from this guide.

The script will:
1. Stop existing tmux sessions and free ports
2. Launch `start_open_codex_web.sh` which:
   - Installs npm dependencies (backend + frontend)
   - Validates the configuration
   - Starts the backend in tmux (`server.port` from `config.json`)
   - Starts the frontend in tmux (`frontend.httpsPort` from `config.json`)
3. Wait until backend and frontend are ready (default timeout 90s)
4. Print the access URLs

This is the normal command to test the project. Do not run individual tool,
Node, or Python diagnostics unless this command reports an error.

## Access

Once ready:
- Frontend: `https://127.0.0.1:<frontend.httpsPort>` (self-signed dev certificate)
- Backend health: `http://127.0.0.1:<server.port>/api/health`

## Script options

```bash
python3 scripts/start_local_web.py --require-model-health
# Fail startup if the configured LLM is unreachable.

python3 scripts/start_local_web.py --with-remote-gui
# Also start remote GUI tools (FreeCAD, ParaView, COMSOL).

python3 scripts/start_local_web.py --keep-proxy
# Keep inherited HTTP(S) proxy variables instead of using a direct connection.

python3 scripts/start_local_web.py --timeout 120
# Wait up to 120 seconds instead of 90.
```

## Troubleshooting

On failure the script prints the tmux logs of backend and frontend. Check:
- `config.json` exists and ports are valid
- `npm install` succeeded in `backend/` and `frontend/`
- No other process is occupying the configured ports

## Stop the project

```bash
tmux kill-session -t ocw-backend
tmux kill-session -t ocw-frontend
```

Or simply run `start_local_web.py` again — it kills the old sessions before starting.

## Manual start (for debugging)

If you need to debug services separately:

```bash
# Backend
cd backend && npm run dev

# Frontend (separate terminal)
cd frontend && npm run dev:https
```
