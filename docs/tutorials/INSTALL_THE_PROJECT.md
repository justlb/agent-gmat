# Install the Project

## 1. System prerequisites

### Windows
- Windows 10/11 with WSL2 installed
- GMAT (General Mission Analysis Tool) installed, with `GmatConsole.exe` accessible
- Python 3 installed in WSL
- tmux installed in WSL: `sudo apt install tmux`
- lsof installed in WSL: `sudo apt install lsof`

### WSL (Ubuntu)
- Node.js via nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.nvm/nvm.sh
nvm install --lts
```

## 2. Clone the project

```bash
git clone <repo-url> /mnt/d/STAGE/agent-gmat-main
cd /mnt/d/STAGE/agent-gmat-main
```

## 3. Create configuration

Copy the example and edit it:

```bash
cp config.example.json config.json
```

Fields you **must** fill in:

| Field | Description | Example |
|---|---|---|
| `server.port` | Backend port | 3002 |
| `server.host` | Backend host | 0.0.0.0 |
| `frontend.port` | Frontend HTTP port | 5174 |
| `frontend.httpsPort` | Frontend HTTPS port | 5175 |
| `frontend.publicHost` | Accessible IP | your local IP |
| `tmux.backendSession` | Backend tmux session name | ocw-backend |
| `tmux.frontendSession` | Frontend tmux session name | ocw-frontend |
| `workspace.templateDir` | Example data directory | /mnt/d/STAGE/agent-gmat-main/data/input_data |
| `workspace.usersRoot` | User workspace root | /mnt/d/STAGE/agent-gmat-main/data/user |
| `chatModel.apiKey` | LLM API key | (per your environment) |
| `chatModel.baseUrl` | LLM endpoint URL | http://10.110.34.83:4000/v1 |
| `chatModel.model` | LLM model name | Qwen3.6 |
| `tools.gmat.bin` | GMAT console path | /mnt/d/path/to/GMAT/bin/GmatConsole.exe |
| `tools.gmat.timeoutMs` | GMAT timeout in ms | 600000 (10 min) |

Do not commit `config.json` with real keys, passwords, or private paths.

## 4. Install dependencies

The startup script does this automatically, but to verify manually:

```bash
cd /mnt/d/STAGE/agent-gmat-main/backend && npm install
cd /mnt/d/STAGE/agent-gmat-main/frontend && npm install
```

## 5. Start the project

```bash
cd /mnt/d/STAGE/agent-gmat-main
python3 scripts/start_local_web.py
```

## 6. Verify

- Open `https://127.0.0.1:<httpsPort>` in a browser
- Accept the self-signed development certificate
- The Mission Studio page should load
- Backend health check: `http://127.0.0.1:<port>/api/health`

## 7. Optional external tools

| Tool | Configuration | Required for |
|---|---|---|
| GMAT | `tools.gmat.bin` | Orbit simulation runs |
| Scilab | Installed on Windows | Simu-CIC (attitude) |
| OPALIS | Installed on Windows | Communication link analysis |
| RF-COMLINK | Installed on Windows | Radio frequency link analysis |

Without these tools, the frontend works but GMAT simulations will fail.

## Common issues

| Symptom | Fix |
|---|---|
| `lsof: command not found` | `sudo apt install lsof` |
| tmux session port still occupied | Run `start_local_web.py` again — it cleans up stale ports |
| GMAT fails to launch | Verify `tools.gmat.bin` points to a valid Windows `.exe` path from WSL (`/mnt/c/...`) |
| Certificate warning in browser | Accept the self-signed dev certificate — it is expected |
| `nvm: command not found` | Restart your WSL shell after installing nvm |
