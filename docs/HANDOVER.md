# Project Handover

This is the short guide for the person taking over the project.

## 1. What this project is

GMAT Agent is a local application for spacecraft mission studies.

A user selects a satellite and a mission scenario in the web interface. The
application then runs this chain:

    GMAT -> Simu-CIC -> OPALIS and RF-COMLINK -> Results

- GMAT produces the orbit trajectory.
- Simu-CIC converts that trajectory into attitude, visibility, eclipse and
  geometry files.
- OPALIS uses those files for electrical-power analysis.
- RF-COMLINK uses them for radio-link analysis.
- Results keeps the files and shows their status.

The frontend is React. The backend is Fastify/TypeScript. The scientific tools
are installed locally on Windows; the web stack runs in WSL/Ubuntu.

## 2. First things to obtain

Do not start work until these items are available.

| Item | Why it matters |
| --- | --- |
| Git repository | Source code: https://github.com/justlb/agent-gmat.git |
| config.json or a secure source for its values | It contains local paths, ports and optional credentials. It is not in Git. |
| Windows computer with WSL2/Ubuntu | Required environment for the standard launcher. |
| GMAT installation | Needs GmatConsole.exe and GMAT.exe. |
| Scilab, Simu-CIC and CelestLab | Required for the Simu-CIC stage. |
| OPALIS installation and Windows Python | OPALIS 2.3 needs Windows Python plus pythonnet/.NET Framework 4.8. |
| RF-COMLINK installation | Needs rf-comlink.exe and its ground-station database. |
| Location of historical mission data | Needed only if older runs must be kept or reviewed. |

Never commit config.json, credentials, local logs, or generated mission runs.

## 3. Install or restore on a new computer

Start with [INSTALL_THE_PROJECT.md](INSTALL_THE_PROJECT.md). It explains the
installation step by step, including the download links and setup commands for
Windows, WSL/Ubuntu, Node.js, Python, and the required scientific tools. Do not
skip ahead to manual configuration until that guide has been read.

1. Clone the repository.
2. Copy config.example.json to config.json.
3. Put the local tool paths in config.json.
4. Follow the installation guide exactly.
5. Start the application from WSL.
6. Run one small mission and confirm that GMAT, Simu-CIC, OPALIS and RF-COMLINK
   create their expected outputs.

There is no automated backup process defined by this repository.

- Source code is restored from Git.
- config.json must come from secure local/organisation storage.
- Historical runs are under data/user/ and must come from approved engineering
  storage if they are needed.
- If no backup location is known, ask the project owner before deleting data,
  replacing a workstation, or reinstalling a scientific tool.

## 4. Important compatibility facts

| Component | Important requirement |
| --- | --- |
| WSL | The launcher, Node.js and most Python scripts run in Ubuntu/WSL. |
| GMAT | Both console and GUI executables must be configured. |
| Scilab | Configure Scilex.exe; the Simu-CIC launcher uses WScilex.exe when required. |
| Simu-CIC | Needs both the Simu-CIC loader.sce and the CelestLab loader.sce. |
| OPALIS 2.3 | Runs through Windows Python, not /usr/bin/python3. Windows Python needs pythonnet==3.0.5 and .NET Framework 4.8. |
| RF-COMLINK | Needs rf-comlink.exe and Resources/GROUND_STATION_DATABASE.txt. |
| Paths | WSL workers use /mnt/c/... paths. RF-COMLINK home is configured as a Windows C:\\... folder. |

For detailed path examples and known WSL/Windows issues, read the installation
guide before changing a path.

## 5. Where to find information

Read the document that matches the task. These are all maintained Markdown
documents in docs/.

| Document | Use it when you need to... |
| --- | --- |
| README.md | Choose the right documentation page. |
| HANDOVER.md | Take ownership of the project or restore it. |
| INSTALL_THE_PROJECT.md | Install on a new Windows/WSL computer and configure every tool. |
| tutorials/START_AND_USE_THE_PROJECT.md | Beginner guide: start, stop, run and review a mission study. |
| tutorials/ADD_A_SATELLITE.md | Add a satellite definition to the library. |
| tutorials/IMPLEMENT_A_MISSION_SCENARIO.md | Add or modify a GMAT mission scenario. |
| other/CODE_STRUCTURE.md | Understand source folders, architecture, naming and entry points. |
| other/FILE_MAP.md | Locate source files and run artifacts. |
| other/MISSION_DATA_FLOW.md | Follow every input/output file from user parameters to results. |
| contract/OPALIS_INPUT_CONTRACT.md | Modify the data sent from the project to OPALIS. |
| contract/RF_COMLINK_INPUT_CONTRACT.md | Modify the data sent from the project to RF-COMLINK. |
| contract/RESULTS_CALCULATION_CONTRACT.md | Check how displayed mission values are calculated. |
| audit/RESULTS_AUDIT.md | Review known Results-page limitations and historical improvement work. |

Documentation under docs/other and docs/audit provides technical or historical
context. When it disagrees with current code, current code and run artifacts
take priority.

## 6. The files that matter during one mission

Each mission has its own dated folder:

    data/user/<user>/gmat/mission-runs/<run-id>/

Do not overwrite or delete this folder during troubleshooting.

| File or folder | Meaning |
| --- | --- |
| satellite.json | Exact satellite data used by this mission. |
| run_manifest.json | Mission template and run identity. |
| workflow-status.json | Current stage status and the first place to read after a failure. |
| gmat.log and gmat_result.json | GMAT console output and parsed result. |
| EphemerisFile1.oem | GMAT trajectory; required by Simu-CIC. |
| opalis/02-simu-cic/ | Simu-CIC scenario, CIC output and ground-station geometry. |
| opalis/03-opalis/ | OPALIS inputs, case files and electrical results. |
| rf-comlink/ | RF input, prepared scenario and saved RF results. |
| consolidated-run-report.json | Compact export combining the stage evidence. |

The full file-by-file chain is in other/MISSION_DATA_FLOW.md.

## 7. Known pitfalls

- Do not use SKIP_CONFIG_VALIDATE=1 as a normal fix.
- Do not copy Windows paths into a WSL Python setting.
- Do not configure OPALIS with Linux Python.
- Restart the application after editing config.json.
- A stage marked completed means files were generated; still inspect the main
  result before using it for engineering decisions.
- Do not change reference templates or the satellite library to fix one run.
  Work on the run-local copy instead.

## 8. Validation status

This handover does not claim that the automated test suite has been run or
validated. Test commands may exist in backend/package.json and frontend/package.json,
but treat them as developer tools to investigate, not as proven release checks.

The practical minimum check after an installation or a code change is:

1. Start the web application.
2. Create one small mission.
3. Confirm GMAT produces EphemerisFile1.oem.
4. Confirm Simu-CIC produces CIC files.
5. If configured, confirm OPALIS and RF-COMLINK produce their run-local outputs.
6. Read workflow-status.json and the main result file for every failed stage.

## 9. Small glossary

| Term | Meaning |
| --- | --- |
| OEM | GMAT orbit trajectory file, usually EphemerisFile1.oem. |
| CIC | Geometry/attitude/visibility files created by Simu-CIC. |
| CelestLab | Scilab library used by Simu-CIC. |
| OPALIS | Electrical-power analysis tool. |
| RF-COMLINK | Radio communication-link analysis tool. |
| Mission run | One dated folder containing all evidence for one calculation. |
| Digital thread | Run-local mission data shared by the adapters, especially satellite.json. |
