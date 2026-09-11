# Driving OPALIS with Python

> **Technical adapter reference.** The active web workflow invokes
> `opalis_pipeline.py` through the backend. The examples below are for local
> diagnosis only; do not run them against a mission run in place. Paths,
> OPALIS versions, and Python installations are environment-specific.

## Reference template and interpolation

The workflow uses by default
`templates/cas A - interpolation lineaire.opalis`. In this template, the
OPALIS option `SimulationModel.InterpolateEphemeris` is enabled. OPALIS
therefore linearly interpolates missing ephemeris values during
computation. Consistent with the GUI behaviour, the power consumption
profile retains its own mode and is not interpolated by this option.

The `opalis_python.py` script directly loads the configured OPALIS .NET
library. It works on Windows with Python 3.10+
and .NET Framework 4.8. Verify that `py -3 --version` selects Python 3
and not the legacy Python 2.7.

If `py -3` is unavailable, use the organisation-supported Python executable
configured for the OPALIS integration. Do not copy a former developer's local
cache path into a new environment.

## Installation

```powershell
py -3 -m pip install -r requirements-opalis-python.txt
```

If Windows refuses to load a downloaded DLL, unblock the OPALIS
folder once:

```powershell
Get-ChildItem -Recurse '.\Opalis-2.3.0' | Unblock-File
```

## Read a simulation

```powershell
py -3 .\opalis_python.py info '.\Opalis-2.3.0\Example\cas A.opalis'
```

An additional API property can be requested with `--get`:

```powershell
py -3 .\opalis_python.py info '.\Opalis-2.3.0\Example\cas A.opalis' `
  --get SimulationModel.Battery.Energy
```

## Modify and execute

```powershell
py -3 .\opalis_python.py run '.\Opalis-2.3.0\Example\cas A.opalis' `
  --set SimulationModel.PowerProfil.PMargin=12 `
  --set SimulationModel.SimulationInitialisation.SocBattery=0.8 `
  --save '.\results\cas-A-computed.opalis' `
  --json '.\results\cas-A.json'
```

`--set` accepts any public modifiable property, with its full path
from `OpalisSimulation`. Decimal numbers use a dot.

Items in OPALIS collections can be targeted with brackets.
Example to modify the first solar section:

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_python.py run `
  '.\results\cas-A-SA1-4-sections.opalis' `
  --set SimulationModel.SolarGenerator.Sections[0].NTsection=12 `
  --save '.\results\cas-A-SA1-4-sections-test-param.opalis'
```

## Sweep the power margin

```powershell
py -3 .\opalis_python.py sweep '.\Opalis-2.3.0\Example\cas A.opalis' `
  --start 0 --stop 10 --step 1 `
  --csv '.\results\margin-sweep.csv'
```

Each trial restarts from the source file so that the final state of one
computation does not become the initial state of the next.

## Replace ephemerides for "Generate fluxes"

With files placed in `file_generate_flux`, the short form is:

```powershell
py -3 .\opalis_python.py generate-flux `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --section 0 `
  --inputs-dir '.\file_generate_flux' `
  --flux-output '.\results\FLOWS-SA-1.TXT' `
  --save '.\results\cas-A-SA1-new-ephemerides.opalis'
```

Add `--run` to launch the OPALIS computation just after replacing the
flux profile. The `--inputs-dir` directory is automatically mapped to:

- `Sat_SUN_ANGLE_SA_1.TXT`
- `Sat_SATELLITE_ECLIPSE.TXT`
- `Sat_SATELLITE_ECLIPSE_MOON.TXT`
- `Sat_EARTH_ANGLE_SA_1.TXT`
- `Sat_SATELLITE_ALTITUDE.TXT`
- `Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT`
- `Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT`
- `Sat_GEOGRAPHICAL_COORDINATES.TXT`

The following command reproduces the **Generate fluxes** dialog
computation, assigns the generated profile to the first solar section
of the example case, then saves a new case without overwriting the
original:

```powershell
py -3 .\opalis_python.py generate-flux `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --section 0 `
  --sun-angle '.\ephemerides\sun-angle-sa-1.mem' `
  --eclipse '.\ephemerides\satellite-eclipse.mem' `
  --earth-angle '.\ephemerides\earth-angle-sa-1.mem' `
  --altitude '.\ephemerides\satellite-altitude.mem' `
  --earth-direction '.\ephemerides\earth-direction-satellite-frame.mem' `
  --sun-direction '.\ephemerides\sun-direction-satellite-frame.mem' `
  --coordinates '.\ephemerides\geographical-coordinates.mem' `
  --flux-output '.\results\fluxes-sa-1.mem' `
  --save '.\results\cas-A-new-ephemerides.opalis' `
  --run
```

Add `--moon-eclipse path.mem` if the lunar eclipse must be taken into
account. The `--section` index is zero-based: `0` is section 1 in the
UI, `1` is section 2, etc. For multiple sections, rerun the command for
each section starting from the last produced `.opalis` file.

## Reduce the number of solar sections

To restart from the generated case and keep only the first 4 sections:

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_python.py resize-sections `
  '.\results\cas-A-SA1-new-ephemerides.opalis' `
  --count 4 `
  --save '.\results\cas-A-SA1-4-sections.opalis' `
  --json '.\results\cas-A-SA1-4-sections.json'
```

## Full automatic pipeline

The `opalis_pipeline.py` script orchestrates the complete chain:

1. read the ephemerides directory;
2. map to the inputs expected by Generate fluxes;
3. generate the `FLOWS-SA-*.TXT` file;
4. modify user parameters with `--set`;
5. launch the OPALIS computation;
6. save the `.opalis` and results JSON.

If the simulation file is not specified, the pipeline directly loads
`Opalis-2.3.0/Example/cas A.opalis`. A working copy is created in the
output directory so the original example is never modified.

The time step and duration are automatically synchronised with the
dynamic flux files:

- the CIC cadence is computed from the MJD and UTC seconds columns;
- the OPALIS time step keeps the cas A value, because it also drives
  the thermal integration; it is only reduced if a dynamic input
  requires a finer step;
- the cas A duration is kept if the fluxes cover it and only reduced
  if their common range is shorter;
- detected values and grids of each file are recorded in
  `automatic_timing` of the output JSON.

Dynamic replacement also reproduces the GUI assignments:

- the 8 geometric CIC files are placed in their respective
  `FlowsManagerApi` types;
- a `FLOWS-SA-n.TXT` with 6 columns is generated and loaded into each
  section of cas A;
- the old `RawEphemeris` lines of cas A are removed;
- the embedded power consumption profile in cas A is resampled to the
  new time range and reloaded with `LoadPowerFile`;
- the JSON records the files used, SA_1 fallbacks, the number of
  lines removed/added, and the generated power profile.

By default, all sections are loaded. `--section 0` can still be used
to explicitly limit the operation to the first section, but this is
only suitable if the OPALIS model itself has a single section or if
the other profiles are managed separately.

The minimal command, from `3-run_OPALIS`, is therefore:

```powershell
python .\opalis_pipeline.py `
  --ephemeris-dir C:\path\to\CIC\Sat
```

`--time-step 60` forces a specific step. `--no-auto-time-step` keeps
the cas A step and `--no-auto-duration` keeps its duration. The
`--set SimulationModel.SimulationTiming...` assignments are applied
last and therefore always take precedence.

Tested example:

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_pipeline.py `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --ephemeris-dir '.\file_generate_flux' `
  --sections-count 4 `
  --section 0 `
  --set SimulationModel.SolarGenerator.Sections[0].NTsection=12 `
  --output-dir '.\results\pipeline-test' `
  --name 'cas-A-pipeline-test'
```

The produced outputs are:

- `00-cas-reference/cas A.opalis`, the working copy of the reference case;
- `01-flux-dynamiques/FLOWS-SA-1.TXT`, the generated flux profile;
- `02-resultats/cas-A-pipeline-test.opalis`, the modified and computed case;
- `02-resultats/cas-A-pipeline-test.json`, the summary of inputs, applied
  parameters, and OPALIS results.

Example with `2304` CIC ephemerides:

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_pipeline.py `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --ephemeris-dir 'C:\JUSTINE\APP\SIMU_CIC\simu_cic\result\2304\CIC\Sat' `
  --sections-count 4 `
  --section 0 `
  --output-dir '.\results\pipeline-2304' `
  --name 'cas-A-2304-4-sections'
```

To prepare the case without launching the computation, add `--no-run`.
