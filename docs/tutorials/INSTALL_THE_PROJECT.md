# Install the Project on a New Computer

This guide installs a local development copy of the project on Windows with
WSL2. It explains how to obtain the source from GitHub, configure the local
environment, start the application, and check that the installation works.

## 1. Obtain access to the GitHub repository

The source code is hosted at [github.com/justlb/agent-gmat](https://github.com/justlb/agent-gmat).

1. Sign in to GitHub with the account that has access to the repository.
2. Open the repository page and select **Code**.
3. Copy the HTTPS clone URL:

   ```text
   https://github.com/justlb/agent-gmat.git
   ```

If GitHub shows a 404 page or does not allow cloning, the repository owner must
grant your GitHub account access before you continue.

## 2. Install the prerequisites

### Windows

Install the following software:

- Windows 10 or Windows 11 with WSL2 and Ubuntu;
- [Git for Windows](https://git-scm.com/download/win);
- GMAT, including `GmatConsole.exe` and `GMAT.exe`;
- Scilab and OPALIS for the Simu-CIC and electrical analyses;
- RF-COMLINK for radio-link calculations.

The scientific tools must be installed on Windows because the application
starts their Windows executables. Keep their installation paths available for
the configuration step.

### WSL (Ubuntu)

Open an Ubuntu terminal and install the required command-line tools:

```bash
sudo apt update
sudo apt install -y git tmux lsof python3
```

Install the current Node.js LTS release through nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.nvm/nvm.sh
nvm install --lts
node --version
npm --version
```

Close and reopen the Ubuntu terminal if the `nvm` command is not yet found.

## 3. Clone the repository

Choose a directory on a local Windows drive. The example below uses `D:` and
clones the repository from WSL:

```bash
mkdir -p /mnt/d/path/to
git clone https://github.com/justlb/agent-gmat.git /mnt/d/path/to/agent-gmat-main
cd /mnt/d/path/to/agent-gmat-main
git status
```

`git status` should report the active branch and a clean working tree. To
update an existing checkout later, use:

```bash
cd /mnt/d/path/to/agent-gmat-main
git pull
```

## 4. Create the local configuration

Create the local configuration file from the tracked example:

```bash
cd /mnt/d/path/to/agent-gmat-main
cp config.example.json config.json
```

Open `config.json` and replace every placeholder value (`REPLACE_WITH_...` and
`/path/to/...`) with values for the new computer.

At minimum, configure:

| Setting | Purpose | Example |
|---|---|---|
| `server.port` | Backend port | `3002` |
| `frontend.port` / `frontend.httpsPort` | Frontend ports | `5174` / `5175` |
| `frontend.publicHost` | IP address used to open the frontend | Your local IP address |
| `tmux.backendSession` / `tmux.frontendSession` | Names for the local services | `agent-gmat-backend`, `agent-gmat-frontend` |
| `workspace.templateDir` | Repository example data | `/mnt/d/path/to/agent-gmat-main/data/input_data` |
| `workspace.usersRoot` | Local user-run data directory | `/mnt/d/path/to/agent-gmat-main/data/user` |
| `tools.gmat.bin` | Windows GMAT console executable, visible from WSL | `/mnt/c/Program Files/GMAT/bin/GmatConsole.exe` |
| `tools.gmat.guiBin` | Windows GMAT graphical executable, visible from WSL | `/mnt/c/Program Files/GMAT/bin/GMAT.exe` |
| `tools.rfComlink.home` | Windows folder containing `rf-comlink.exe` | `C:\Program Files\RF-COMLINK` |
| `openai` / `chatModel` | API endpoint, model, and API key required by the current backend | Credentials supplied by the project owner |

`config.json` contains local paths and credentials. Do not commit it, send it
by email, or add it to GitHub.

## 5. Install the JavaScript dependencies

The launcher installs dependencies automatically. You can also install them
explicitly to diagnose a setup issue:

```bash
cd /mnt/d/path/to/agent-gmat-main/backend
npm install

cd ../frontend
npm install
```

## 6. Start the application

From WSL, run:

```bash
cd /mnt/d/path/to/agent-gmat-main
python3 scripts/start_local_web.py
```

The launcher starts the backend and frontend in tmux sessions and releases
stale project ports before starting them again.

## 7. Verify the installation

1. Open `https://127.0.0.1:<frontend.httpsPort>` in a browser. For the example
   configuration, this is `https://127.0.0.1:5175`.
2. Accept the self-signed development certificate when the browser asks.
3. Confirm that **New simulation** opens and the satellite library is visible.
4. Check the backend health endpoint at
   `http://127.0.0.1:<server.port>/api/health`.
5. Run one small mission only after GMAT, Simu-CIC, OPALIS, and RF-COMLINK have
   been configured on the computer.

## 8. External-tool checks

| Tool | Used for | Check before the first run |
|---|---|---|
| GMAT | Orbit propagation and transfer calculations | `tools.gmat.bin` points to an existing `GmatConsole.exe` |
| Scilab / Simu-CIC | Attitude, contact, eclipse, and geometry data | Scilab and the Simu-CIC workflow are installed on Windows |
| OPALIS | Electrical-power analysis | OPALIS opens on Windows |
| RF-COMLINK | Telecommand and telemetry link budgets | RF-COMLINK opens on Windows and its station database is available |

The frontend can open without these tools, but a complete mission pipeline
requires all four.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `git clone` asks for credentials or is denied | Sign in to GitHub with an authorised account, or ask the repository owner for access. |
| `nvm: command not found` | Close and reopen the Ubuntu terminal, then run `source ~/.nvm/nvm.sh`. |
| `lsof: command not found` | Run `sudo apt install lsof`. |
| The launcher reports an occupied port | Run `python3 scripts/start_local_web.py` again; it removes stale project listeners. |
| GMAT does not start | Verify that the WSL path in `tools.gmat.bin` maps to the installed Windows executable. |
| Browser certificate warning | Accept the self-signed certificate for this local development instance. |
| RF-COMLINK or OPALIS fails during a run | Confirm that the tool is installed on Windows and that its configured executable path is correct. |
