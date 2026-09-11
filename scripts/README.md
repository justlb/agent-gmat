# scripts

Project-level utility scripts. The primary entry point is `start_local_web.py`.

| File | Purpose |
|---|---|
| `start_local_web.py` | **Recommended launcher**. From WSL: stops existing tmux sessions, frees ports, validates config, starts backend + frontend in tmux, waits for readiness. |
| `validate_start_config.sh` | Bash script that checks `config.json` placeholders, field types, and connectivity to external services. |
| `install_node_deps.sh` | Runs `npm install --no-audit --no-fund` in `backend/` and `frontend/`. |
| `restart_web_services.sh` | Stops old tmux, starts backend and frontend in new tmux sessions. |
| `start_common.sh` | Shared helpers: config reading, port resolution, tmux naming. |
| `start_open_codex_web.sh` | Thin bash wrapper calling the three scripts above (deprecated — use `start_local_web.py`). |
| `validate_config.mjs` | Node configuration validator used for direct checks. |
| `check_chat_model_endpoint.mjs` | Probes the configured LLM with a minimal request. |
| `check_function_interfaces.mjs` | Checks configured function-interface endpoints. |
| `proxy_agent.mjs` | Development proxy helper. |
| `remote_gui_*.sh` | Helpers for optional remote GUI desktop and tool sessions. |

`backend/scripts/dev.mjs` is the backend-only development runner; it is not a
root-level script.
