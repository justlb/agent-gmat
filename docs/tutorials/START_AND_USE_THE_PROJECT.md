# Start and Use the Project

This is the normal guide for running a mission study. Follow the steps in
order. Commands below are run from **Ubuntu in WSL**, not from Windows
PowerShell.

Before starting, complete [Install the Project](../INSTALL_THE_PROJECT.md).
That guide explains how to install the scientific applications and create
`config.json`.

Related guides: [Add a Satellite](ADD_A_SATELLITE.md) and [Implement a Mission
Scenario](IMPLEMENT_A_MISSION_SCENARIO.md).

## 1. Open the project folder in WSL

Open **Ubuntu** from the Windows Start menu. Go to the project root: it is the
folder containing `config.json`, `backend/`, `frontend/`, and `scripts/`.

For example, if you cloned the project into `C:\JUSTINE\demonstrator`, run:

```bash
cd /mnt/c/JUSTINE/demonstrator
```

Your installation may be on another drive or in another folder. Use the path
that you chose during installation; do not copy this example if it is wrong
for your computer.

Check that you are in the right place:

```bash
ls config.json scripts/start_local_web.py
```

Both file names must be displayed. If not, use `cd` to go to the project root.

## 2. Check the local configuration

`config.json` contains paths to GMAT and, when used, Simu-CIC, OPALIS and
RF-COMLINK. It also contains local ports and workspace locations. Do not share
or commit this file because it can contain API keys and local paths.

The current version needs a complete `chatModel` configuration (API key,
endpoint and model) for Mission Studio discussion. Do not enter fake values:
they only replace a clear configuration error with a connection failure.

You only need to edit `config.json` when something changed on the computer,
such as a moved GMAT installation or a new API key. For help with the fields,
return to [Install the Project](../INSTALL_THE_PROJECT.md).

## 3. Start the application

At the project root, run this single command:

```bash
python3 scripts/start_local_web.py
```

Wait for the script to print the frontend address. It automatically:

1. Stops an earlier local instance of this project.
2. Installs missing backend and frontend Node dependencies.
3. Checks `config.json`.
4. Starts the backend and frontend.
5. Waits until both services are ready.

This is the normal command to start or test the project. Do not start the
backend and frontend separately unless you are diagnosing a reported error.

## 4. Open the web application

Open the frontend address printed by the script. With the default configuration
it is:

```text
https://127.0.0.1:5175
```

Your browser may warn about a self-signed local certificate. This is expected
for a local development server; accept it to continue.

Optional quick check from WSL:

```bash
curl http://127.0.0.1:3002/api/health
```

The exact ports can be different if they were changed in `config.json`.

## 5. Run a first mission study

Use the web application in this order:

1. Open **New simulation** and click **New run**.
2. Choose a **Satellite**.
3. Choose one of its compatible **Mission scenarios**.
4. Select a compatible **Ground station**.
5. Enter the required mission inputs.
6. Open **Optional mission inputs** only if you need to change a pre-filled
   value.
7. Click **Run complete mission pipeline**.

The selected satellite, input values, generated GMAT script, logs and results
are saved together in this run. To try a different satellite or mission,
create a new run rather than modifying a completed one.

## 6. Understand the main pages

| Page | What to do there |
| --- | --- |
| **New simulation** | Create a run, select the satellite, scenario and ground station, enter inputs, then start the calculation. |
| **Satellites** | Inspect the available versioned satellite definitions. |
| **Mission scenarios** | Read what each GMAT scenario does. Click **More information** to see every modifiable mission value and its example-script value. |
| **Results** | Inspect the GMAT, Simu-CIC, OPALIS and RF-COMLINK outputs for one selected run. |

## 7. Review the results

Open **Results** after the pipeline finishes. The artifact list contains the
generated GMAT script, values, reports, time series and downstream outputs.

For a result that you need to share or compare later, record the run ID,
scenario ID, satellite ID and version, input values, and any failed or retried
stage. These make the study reproducible.

## If something goes wrong

| What you see | First action |
| --- | --- |
| The application does not start | Read the error printed by `start_local_web.py`; it usually identifies the missing `config.json` field or executable. |
| The browser cannot connect | Wait until the startup script says both services are ready, then use the URL it printed. |
| A satellite or scenario is unavailable | Select a compatible satellite, then check its `mission_templates` list and the scenario requirements. |
| GMAT cannot start | Check `tools.gmat.bin` and `tools.gmat.guiBin` in `config.json`, then review the required mission inputs. |
| A downstream stage fails | Open **Results**, read the stage error and preserve its artifacts. Correct the source configuration or inputs, then create a new run or re-prepare the draft. |
| The model configuration error appears | Enter real `chatModel` API key, endpoint and model values in `config.json`; do not use placeholder text. |

For a detailed configuration diagnosis, from the project root run:

```bash
node scripts/validate_config.mjs --config config.json
```

## Stop the application

Normally, starting the project again replaces the old local instance. To stop
it without restarting, run:

```bash
tmux kill-session -t agent-gmat-backend
tmux kill-session -t agent-gmat-frontend
```

If a session does not exist, tmux prints an error; this simply means that part
of the application was already stopped. If you changed `tmux.backendSession`
or `tmux.frontendSession` in `config.json`, replace these two names with your
configured names.

## Advanced start options

Use these only when their description matches your situation:

```bash
python3 scripts/start_local_web.py --require-model-health
# Also fail startup when the configured model cannot be reached.

python3 scripts/start_local_web.py --with-remote-gui
# Start configured remote GUI tools in addition to the web application.

python3 scripts/start_local_web.py --keep-proxy
# Keep inherited HTTP(S) proxy settings.

python3 scripts/start_local_web.py --timeout 120
# Wait up to 120 seconds for startup instead of 90 seconds.
```

## Manual start for debugging only

Use separate terminals only when investigating a startup problem:

```bash
# Terminal 1, from the project root
cd backend && npm run dev

# Terminal 2, from the project root
cd frontend && npm run dev:https
```
