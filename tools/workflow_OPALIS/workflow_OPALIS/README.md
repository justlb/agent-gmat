# Active workflow: GMAT -> Simu-CIC -> OPALIS

The web workflow orchestrates the three separate steps below. The scripts
remain here as technical adapters; they must not be launched via
a global orchestrator in this repository.

1. `1-conversion_vers_SIMU-CIC/eph_conversion.py` converts the GMAT OEM
   ephemeris into a file usable by Simu-CIC.
2. `2-run_SIMU-CIC/run_scilab_simulation.py` launches Simu-CIC with a
   mandatory `--save-root`, provided by the backend.
3. `3-run_OPALIS/opalis_pipeline.py` prepares and executes the OPALIS
   scenario from the CIC files and the satellite definition.

All outputs of a mission are stored exclusively in:

```text
data/user/<user>/gmat/mission-runs/<run-id>/opalis/
|-- 01-conversion_vers_SIMU-CIC/
|-- 02-simu-cic/
`-- 03-opalis/
```

Legacy manual launchers, example outputs, and RF-COMLINK prototypes are
kept under `archive/legacy/` and are not part of the active workflow.
