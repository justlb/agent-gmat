# Installation on Windows with WSL2

The web services and Python workers run in Ubuntu/WSL. GMAT, Scilab, Simu-CIC,
OPALIS and RF-COMLINK are Windows applications. Mixing Windows and WSL paths is
a common cause of failed calculations.

## Quick installation summary

Use this short checklist first. The sections below then explain every action
step by step.

1. Install the required Windows and WSL/Ubuntu prerequisites.
2. Clone the repository from PowerShell into the Windows folder you chose for
   the project.
3. Open that same folder from Ubuntu/WSL.
4. Copy `config.example.json` to `config.json`, then fill in the project paths,
   installed-tool paths, and any required credentials in **`config.json`**.
5. Validate `config.json`, then install the backend and frontend dependencies.
6. Start the local web application.

Do not edit `config.example.json` as the active configuration: the application
reads `config.json`. Follow **Prerequisites**, **Clone and update**, then
**Create config.json** below for the complete tutorial.

## Related guides

- [Start and Use the Project](tutorials/START_AND_USE_THE_PROJECT.md): start, stop, troubleshoot, run and review a mission study.
- [Add a Satellite](tutorials/ADD_A_SATELLITE.md): add a versioned satellite definition.
- [Implement a Mission Scenario](tutorials/IMPLEMENT_A_MISSION_SCENARIO.md): add a GMAT scenario.

## Information an installation LLM must collect first

Before cloning, editing files or installing packages, an LLM must ask the user
for the following information in one concise message. It must not guess paths
or request secret values in a shared chat.

| Required answer | Example | Why it is needed |
|---|---|---|
| Target project folder and drive | C:\\JUSTINE\\demonstrator | Determines the matching WSL repository path. |
| WSL distribution and confirmation it opens | Ubuntu | The launcher, Node.js and Python workers run there. |
| GMAT console and GUI executable paths | C:\\JUSTINE\\APP\\GMAT\\bin\\GmatConsole.exe | GMAT needs both executables. |
| OPALIS installation directory and Windows Python executable | C:\\JUSTINE\\APP\\OPALIS\\Opalis-2.3.0; C:\\Users\\<user>\\...\\Python312\\python.exe | OPALIS 2.3 requires Windows .NET Framework through pythonnet. |
| Scilab, Simu-CIC and CelestLab paths | Scilex.exe; simu_cic; celestlab\\loader.sce | Required for the Simu-CIC launcher. |
| RF-COMLINK installation directory | C:\\JUSTINE\\APP\\RF-COMLINK | Must contain rf-comlink.exe and its station database. |
| Whether OpenAI/chat and database features are needed | yes/no, values entered only locally | Unused credentials must remain null. |
| Local-only or LAN frontend access | 127.0.0.1 or workstation IP | Sets frontend.publicHost. |

The LLM should inspect every supplied path before writing config.json, use WSL
equivalents for WSL workers, preserve config.json secrets, run the preflight
checks below, and report missing software or licences before starting the stack.

## Prerequisites

Install Windows 10 or Windows 11 with WSL2 and Ubuntu, then install:

- [Git for Windows](https://git-scm.com/download/win);
- [GMAT](https://software.nasa.gov/software/GSC-18094-1);
- [Scilab](https://www.scilab.org/download);
- [Simu-CIC](https://www.connectbycnes.fr/en/simu-cic);
- [CelestLab](https://www.connectbycnes.fr/en/celestlab);
- [OPALIS](https://www.connectbycnes.fr/en/opalis);
- [RF-COMLINK](https://www.connectbycnes.fr/en/rf-comlink);
- 64-bit Python 3.12 for Windows.

Check that every licensed scientific application opens on Windows.

In Ubuntu/WSL install the runtime and a current Node LTS (Node 22+ recommended):

    sudo apt update
    sudo apt install -y git tmux lsof python3
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
    source ~/.nvm/nvm.sh
    nvm install --lts
    node --version
    npm --version

Reopen Ubuntu if nvm is not found.

## Clone and update

The repository is public. Choose a Windows parent folder and a name for the
new project folder. This example installs it in `C:\JUSTINE\test2`.

### 1. Clone with PowerShell (recommended on this computer)

Open **PowerShell** and run:

```powershell
cd C:\JUSTINE
git clone https://github.com/justlb/agent-gmat.git test2
cd test2
dir
```

The `git clone` line downloads the repository and creates the `test2` folder.
After it finishes, `dir` must show `backend`, `frontend`, `docs`, `data`, and
`config.example.json`.

Use a plain URL after `git clone`; do not include `[`, `]`, `(`, or `)`.

If `test2` already exists, choose a different new name such as `test3`. Do not
clone over a folder containing files.

### 2. Open the cloned folder

The project folder is now:

```text
C:\JUSTINE\test2
```

Open this exact folder in Windows Explorer. It is the folder you use in
PowerShell and it is the same project that WSL sees as:

```text
/mnt/c/JUSTINE/test2
```

### 3. Use WSL for the project commands

Open Ubuntu and enter the project folder:

```bash
cd /mnt/c/JUSTINE/test2
ls
```

Use Ubuntu for the remaining installation, validation, and launch commands.
The project may be cloned from PowerShell because WSL network access can be
blocked by a VPN or proxy (such as LetsTAP) even when Windows can reach GitHub.

### Choose another installation folder

Replace `C:\JUSTINE\test2` and `/mnt/c/JUSTINE/test2` consistently with your
own folder. For example, Windows `D:\Work\demonstrator` becomes WSL
`/mnt/d/Work/demonstrator`.

In JSON configuration, replace `<your-project-folder>` with your real WSL
folder path; do not leave angle-bracket placeholders in `config.json`.

Always update before diagnosing a known failure. Simu-CIC fixes below are code
fixes, so an old checkout does not contain them:

    git pull --ff-only

If PowerShell cloning fails, check the Git error, network, proxy, or VPN.
Prefer Git over a ZIP archive so updates remain possible.

## Create config.json

config.json is the live local configuration. config.example.json is a tracked
template and must not contain a computer's credentials or paths.

### 1. Create your local configuration file

In Ubuntu, from the project folder, run:

```bash
cd /mnt/c/JUSTINE/test2
cp config.example.json config.json
```

This creates a new file named `config.json`. It is a copy of
`config.example.json`; only `config.json` is used when the application starts.

### 2. Open config.json to edit it

For the example installation, the new file is located here in Windows:

```text
C:\JUSTINE\test2\config.json
```

From the same Ubuntu terminal, open that exact file in its Windows default
editor with:

```bash
explorer.exe config.json
```

Or open `C:\JUSTINE\test2` in Windows Explorer and double-click
`config.json`. If VS Code is installed and available in Ubuntu, this also
opens the file directly:

```bash
code config.json
```

Edit **config.json**, not `config.example.json`. The latter is only the
versioned example kept in Git.

config.json is ignored by Git. Never commit or share it.

### 3. Change the required lines

Use the editor search function to find each setting below in `config.json`.
Only replace the value after the colon; keep the quotes, commas, braces, and
setting names unchanged. For the example project folder `C:\JUSTINE\test2`,
the first section must become:

```json
"workspace": {
  "templateDir": "/mnt/c/JUSTINE/test2/data/input_data",
  "usersRoot": "/mnt/c/JUSTINE/test2/data/user"
}
```

These two paths must point to the new cloned project, not to an older
installation such as `C:\JUSTINE\demonstrator`.

Then find the `"gmat"` section. Change both paths only if GMAT is installed
somewhere else on this computer:

```json
"gmat": {
  "bin": "/mnt/c/Program Files/GMAT/bin/GmatConsole.exe",
  "guiBin": "/mnt/c/Program Files/GMAT/bin/GMAT.exe",
  "timeoutMs": 120000
}
```

Next find the `"rfComlink"` section. Replace the placeholder with the Windows
folder containing `rf-comlink.exe`. This one value uses Windows backslashes,
which must be doubled in JSON:

```json
"rfComlink": {
  "home": "C:\\JUSTINE\\APP\\RF-COMLINK",
  "python": "/usr/bin/python3",
  "waitSeconds": 3
}
```

Do not leave `REPLACE_WITH_RF_COMLINK_HOME`, `xxx`, or
`<your-project-folder>` in `config.json`: validation deliberately rejects
placeholders.

### 4. Decide whether to configure optional services

Leave the following sections as `null` if they are not used on this computer:

| Section | Configure it only when you need… |
|---|---|
| `openai` | OpenAI-backed application features. |
| `chatModel` | Mission Studio discussion with a configured model service. |
| `compliance.database` | The optional PostgreSQL compliance database. |
| `tools.opalis` | OPALIS calculations. |
| `tools.simuCic` | Simu-CIC calculations. |

Do not change `server`, `tmux`, `codex`, `auth`, `logging`, port numbers, or
timeouts during a first local installation unless you know why the default is
not suitable.

### Path convention

WSL Node.js and Python paths use /mnt/<drive>/..., for example:

    Windows: C:\JUSTINE\APP\GMAT\bin\GmatConsole.exe
    WSL:     /mnt/c/JUSTINE/APP/GMAT/bin/GmatConsole.exe

The exception is tools.rfComlink.home: use its normal Windows folder such as
C:\JUSTINE\APP\RF-COMLINK. The backend converts this folder for WSL itself.
It must contain rf-comlink.exe. Windows backslashes in JSON must be escaped.

Core fields:

| Setting | Example |
|---|---|
| workspace.templateDir | `<your-project-folder>/data/input_data` |
| workspace.usersRoot | `<your-project-folder>/data/user` |
| tools.gmat.bin | /mnt/c/Program Files/GMAT/bin/GmatConsole.exe |
| tools.gmat.guiBin | /mnt/c/Program Files/GMAT/bin/GMAT.exe |
| frontend.publicHost | 127.0.0.1 or the workstation LAN IP |

For optional model/database features set real credentials, or null when unused.
Never use xxx or REPLACE_WITH_...; placeholders intentionally fail validation.

### OPALIS

OPALIS 2.3 targets .NET Framework 4.8. Its pipeline must use a Windows Python
executable launched from WSL, with pythonnet installed. Do not set workerPython
to /usr/bin/python3.

    "opalis": {
      "installationDir": "/mnt/c/JUSTINE/APP/OPALIS/Opalis-2.3.0",
      "workerPython": "/mnt/c/Users/<user>/AppData/Local/Programs/Python/Python312/python.exe",
      "timeoutMs": 600000
    }

From Windows PowerShell, install pythonnet with that same Python (replace the path):

    & "C:\Users\<user>\AppData\Local\Programs\Python\Python312\python.exe" -m pip install -r "C:\JUSTINE\demonstrator\tools\workflow_OPALIS\workflow_OPALIS\3-run_OPALIS\requirements-opalis-python.txt"

    test -f /mnt/c/JUSTINE/APP/OPALIS/Opalis-2.3.0/Opalis.exe
    test -f /mnt/c/JUSTINE/APP/OPALIS/Opalis-2.3.0/lib/OpalisApi.dll
    /mnt/c/Users/<user>/AppData/Local/Programs/Python/Python312/python.exe -c "from pythonnet import load; load('netfx'); import clr; print('pythonnet/.NET Framework OK')"

### Simu-CIC

All tools.simuCic fields are required:

    "simuCic": {
      "baseScenario": "/mnt/c/JUSTINE/APP/SIMU_CIC/simu_cic/GUI/examples/Example_1.scd",
      "celestlabDir": "/mnt/c/JUSTINE/APP/____autre/CEF/cnes_software/SIMU-CIC_complet/celestlab",
      "scilabBin": "/mnt/c/Program Files/scilab-2025.1.0/bin/Scilex.exe",
      "simucicDir": "/mnt/c/JUSTINE/APP/SIMU_CIC/simu_cic",
      "simuCicRunner": "<your-project-folder>/tools/workflow_OPALIS/workflow_OPALIS/2-run_SIMU-CIC/run_scilab_simulation.py",
      "timeoutMs": 600000,
      "workerPython": "/usr/bin/python3"
    }

scilabBin points to Scilex.exe. The launcher automatically uses neighbouring
WScilex.exe because Simu-CIC needs the GUI runtime, including a hidden run.

The project script is
tools/workflow_OPALIS/workflow_OPALIS/2-run_SIMU-CIC/run_ephemeris_attitude_simulation.sce.
It receives CELESTLAB_DIR from the Python launcher. Do not hard-code a local
D:/STAGE/... location in the script.

    test -f "/mnt/c/Program Files/scilab-2025.1.0/bin/Scilex.exe"
    test -f "/mnt/c/Program Files/scilab-2025.1.0/bin/WScilex.exe"
    test -f /mnt/c/JUSTINE/APP/SIMU_CIC/simu_cic/GUI/examples/Example_1.scd
    test -f /mnt/c/JUSTINE/APP/____autre/CEF/cnes_software/SIMU-CIC_complet/celestlab/loader.sce
    test -f /mnt/c/JUSTINE/APP/SIMU_CIC/simu_cic/loader.sce

### RF-COMLINK

    "rfComlink": {
      "home": "C:\\JUSTINE\\APP\\RF-COMLINK",
      "python": "/usr/bin/python3",
      "waitSeconds": 3
    }

    test -f /mnt/c/JUSTINE/APP/RF-COMLINK/rf-comlink.exe
    test -f /mnt/c/JUSTINE/APP/RF-COMLINK/Resources/GROUND_STATION_DATABASE.txt

Restart the backend after editing config.json; it reads configuration on startup.

The normal local config no longer requires cosyvoice, gnc, cad, paraview,
comsol or remoteDesktopLauncher. Add them only for an explicitly configured
remote-GUI workflow started with --with-remote-gui.

## Validate, install, start

From WSL:

    cd /mnt/c/JUSTINE/test2
    node scripts/validate_config.mjs --skip-services
    cd backend && npm ci && npm run build
    cd ../frontend && npm ci && npm run build
    cd ..
    python3 scripts/start_local_web.py

The launcher must be run in WSL, not PowerShell. It validates config.json,
releases only project ports/sessions, and starts the backend/frontend. It skips
external-service connectivity by default, but not JSON or path validation.

Open https://127.0.0.1:5175 (or the configured HTTPS port) and accept the
self-signed certificate. Default health URL: http://127.0.0.1:3002/api/health.

## Problems encountered and resolution

| Symptom | Status | Resolution |
|---|---|---|
| xxx API/database values fail validation | Resolved in template | Replace old placeholders with real values or null. |
| FreeCAD/unused remote GUI path fails validation | Resolved in code/default config | Remove obsolete remote-GUI sections from old config.json unless required. |
| RF-COMLINK station list returns 503 | Resolved in code | Configure home as the folder with rf-comlink.exe, verify Resources/GROUND_STATION_DATABASE.txt, restart. |
| Simu-CIC requests tools.opalis.baseScenario | Resolved in code | Use tools.simuCic.baseScenario after updating source. |
| Simu-CIC cannot open C:\...eph_conversion.py | Resolved in code | Pull latest source, build backend, restart and retry. Python receives /mnt paths; Scilab receives Windows paths only inside its launcher. |
| Scilab exits with code 231 and its command uses /tmp/simucic_launcher... | Resolved in code | Pull latest source and retry. The launcher and result markers are now stored in the dated mission directory on C:, and WScilex.exe receives a C:\ path. |
| Scilab returns code 16 (or another non-zero code) although it creates CIC files | Resolved in code | The run is successful when the final marker resolves to a result directory containing CIC text files. Windows-style marker paths are translated back to /mnt paths before the WSL worker validates and copies the output. |
| OPALIS cannot open opalis_pipeline.py and the error combines /mnt/... with C:\\... | Resolved in code | Pull the latest source and restart. The OPALIS Python worker now retains WSL paths instead of receiving Windows paths. |
| OPALIS reports that .NET Framework 4.8 must be run under Windows | Local requirement configured here | Set tools.opalis.workerPython to a Windows Python executable visible from WSL (for example /mnt/c/Users/<user>/AppData/Local/Programs/Python/Python312/python.exe), then install pythonnet 3.0.5 with that Python. Windows arguments are selected automatically. |
| OPALIS cannot import SimulationHelper | Resolved in code | OPALIS 2.3 exposes it as OpalisApi.Helper.SimulationHelper (singular), which the connector now uses. |
| RF-COMLINK cannot access example/vide.rfcl | Resolved in code | Current releases can ship example/example.rfcl instead. The backend now selects vide.rfcl when present, otherwise example.rfcl. Use RF_COMLINK_TEMPLATE only to override this choice deliberately. |
| RF-COMLINK template exposes two links but the mission requires three | Resolved in code | The scenario preparer duplicates a telemetry-link XML skeleton when needed, then applies the third link's X/S-band parameters and CIC references. |
| CelestLab looks for D:/STAGE/... | Resolved in code | Set tools.simuCic.celestlabDir to the folder containing loader.sce. |
| nvm or lsof is absent | Environment issue | Reopen Ubuntu after nvm setup; run sudo apt install -y lsof. |
| Certificate warning | Expected | Accept the local self-signed certificate. |
| Scientific tool starts but calculation fails | Local dependency | Check licence/version/input on Windows and retain workflow-status.json plus generated artefacts for diagnosis. |

SKIP_CONFIG_VALIDATE=1 is diagnostic-only. It can hide a path problem and is
not an installation solution.

### Why the Simu-CIC WSL/Windows failures happened

Simu-CIC is a mixed environment: the backend and its Python launcher run in
WSL, while Scilab is a Windows executable. A path valid on one side is not
automatically valid on the other side. The three observed failures had this
sequence:

1. A Windows C:\\ path was passed to a Python process running in WSL. Python
   treated it as a relative Linux path and could not find eph_conversion.py.
2. The Python launcher created its temporary .sce file under /tmp. WScilex.exe
   is a Windows process and could not open that Linux-only location.
3. After the calculation, Scilab wrote its result marker as C:/... . The WSL
   worker initially read that text as a Linux path, did not find the generated
   CIC directory, and incorrectly reported failure even though CIC files had
   been produced.

Current code performs the conversions at the boundaries: Python retains /mnt
paths, Scilab receives C:/ paths, and marker paths are converted back to /mnt
before the backend validates the CIC output. This is why an old source checkout
must be updated rather than worked around with SKIP_CONFIG_VALIDATE.

## Before publishing

Never commit config.json, credentials, user mission runs, generated scenarios,
CIC output or local logs. Before publishing source or documentation:

    cd /mnt/c/JUSTINE/test2
    node scripts/validate_config.mjs --skip-services
    cd backend && npm run build
    cd ../frontend && npm run build
    git status

Review git status and publish only intended source and documentation changes.
