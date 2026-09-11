# chemical-hohmann-transfer-template

Template for two-impulse chemical-propellant Hohmann transfer missions.

## Files

| File | Purpose |
|---|---|
| `template.json` | Manifest: ID, fields, artifacts, downstream analyses. |
| `references/chemical_hohmann_transfer.script` | Immutable reference GMAT script (two Target burns, differential corrector). |

## What this template models

A satellite using chemical propulsion to perform an impulsive Hohmann transfer between two coplanar circular orbits. GMAT's differential corrector solves for the TOI (Transfer Orbit Insertion) and GOI (GSO Orbit Insertion) burns.

## Required satellite properties

Dry mass, initial chemical propellant mass, specific impulse (Isp), drag area, drag coefficient.

## Mission inputs

Initial orbit (altitude, eccentricity, inclination), final target altitude, optional initial RAAN/AOP/TA.

## Output artifacts

- `chemical_hohmann_transfer.script` — rendered GMAT script
- `chemical_hohmann_transfer.values.yaml` — values used for rendering
- `ReportFile1.txt` — altitude + fuel mass time series
- `chemical_hohmann_timeseries.json` — parsed timeseries (SMA, altitude, fuel)
- `EphemerisFile1.oem` — OEM ephemeris of the transfer trajectory
- `gmat_result.json` — exit code, delta-v, and summary
