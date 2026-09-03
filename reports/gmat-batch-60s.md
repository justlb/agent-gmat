# GMAT workflow compatibility campaign

Generated: 2026-09-02T14:38:00.558Z
Mode: workflow

- Total combinations: 12
- Compatible drafts rendered: 5
- Rejected by propulsion/input guards: 7
- Draft/render failures: 0

| Satellite | Template | Draft | GMAT | Simu-CIC | OPALIS | RF-COMLINK |
| --- | --- | --- | --- | --- | --- | --- |
| Chemical Propulsion Sat | orbit-keeping | passed | blocked | blocked | not_run | not_run |
| Chemical Propulsion Sat | electric-propulsion-transfer | blocked | blocked | blocked | blocked | blocked |
| Chemical Propulsion Sat | chemical-hohmann-transfer | passed | passed | not_run | not_run | not_run |
| Chemical Propulsion Sat | chemical-3d-transfer | passed | passed | not_run | not_run | not_run |
| Fudan Satellite | orbit-keeping | blocked | blocked | blocked | blocked | blocked |
| Fudan Satellite | electric-propulsion-transfer | passed | passed | not_run | not_run | not_run |
| Fudan Satellite | chemical-hohmann-transfer | blocked | blocked | blocked | blocked | blocked |
| Fudan Satellite | chemical-3d-transfer | blocked | blocked | blocked | blocked | blocked |
| Starlink V1.5 Electric Reference | orbit-keeping | blocked | blocked | blocked | blocked | blocked |
| Starlink V1.5 Electric Reference | electric-propulsion-transfer | passed | blocked | blocked | not_run | not_run |
| Starlink V1.5 Electric Reference | chemical-hohmann-transfer | blocked | blocked | blocked | blocked | blocked |
| Starlink V1.5 Electric Reference | chemical-3d-transfer | blocked | blocked | blocked | blocked | blocked |

## Details

### Chemical Propulsion Sat / orbit-keeping

- Declared compatible: yes
- GMAT: blocked - ariables: TOI.Element1 = 0.013, GOI.Element1 = 0.0127815893997 Goals and achieved values: DefaultSC.Earth.SMA Desired: 6678.1363 Achieved: 6583.16255029 Variance: 94.9737497114 DefaultSC.Earth.ECC Desired: 0 Achieved: 0.000516627068412 Variance: -0.000516627068412 Completed iteration 3, pert 1 (TOI.Element1 = 0.0131) Completed iteration 3, pert 2 (GOI.Element1 = 0.0128815893997) DefaultDC Iteration 4; Nominal Pass Variables: TOI.Element1 = 0.018, GOI.Element1 = 0.0175999968467 Goals and achieved values: DefaultSC.Earth.SMA Desired: 6678.1363 Achieved: 6591.70547815 Variance: 86.4308218484 DefaultSC.Earth.ECC Desired: 0 Achieved: 0.000470830847908 Variance: -0.000470830847908 Completed iteration 4, pert 1 (TOI.Element1 = 0.0181) Completed iteration 4, pert 2 (GOI.Element1 = 0.0176999968467) DefaultDC Iteration 5; Nominal Pass Variables: TOI.Element1 = 0.02, GOI.Element1 = 0.02 Goals and achieved values: DefaultSC.Earth.SMA Desired: 6678.1363 Achieved: 6595.12683199 Variance: 83.0094680104 DefaultSC.Earth.ECC Desired: 0 Achieved: 0.0005747509795 Variance: -0.0005747509795 Completed iteration 5, pert 1 (TOI.Element1 = 0.0199) Completed iteration 5, pert 2 (GOI.Element1 = 0.0199) DefaultDC Iteration 6; Nominal Pass Variables: TOI.Element1 = 0.02, GOI.Element1 = 0.02 Goals and achieved values: DefaultSC.Earth.SMA Desired: 6678.1363 Achieved: 6595.12683199 Variance: 83.0094680104 DefaultSC.Earth.ECC Desired: 0 Achieved: 0.0005747509795 Variance: -0.0005747509795 Completed iteration 6, pert 1 (TOI.Element1 = 0.0199) Completed iteration 6, pert 2 (GOI.Element1 = 0.0199) DefaultDC Iteration 7; Nominal Pass Variables: TOI.Element1 = 0.02, GOI.Element1 = 0.02 Goals and achieved values: DefaultSC.Earth.SMA Desired: 6678.1363 Achieved: 6595.12683199 Variance: 83.0094680104 DefaultSC.Earth.ECC
- Simu-CIC: blocked - GMAT must complete and provide an OEM ephemeris first.
- OPALIS: not_run - Waiting for Simu-CIC CIC output.
- RF-COMLINK: not_run - Waiting for Simu-CIC CIC output; RF-COMLINK calculation remains GUI/manual.
- Values: initialOrbit.epoch=31258.66709490726, initialOrbit.smaKm=6678.1363, initialOrbit.eccentricity=0, initialOrbit.inclinationDeg=28.5, initialOrbit.raanDeg=67, initialOrbit.argPeriapsisDeg=355, initialOrbit.trueAnomalyDeg=250, spacecraft.dryMassKg=300, spacecraft.initialFuelMassKg=100, spacecraft.dragAreaM2=2, spacecraft.dragCoefficient=2.2, propulsion.ispSeconds=320, stationKeeping.minimumAltitudeKm=180, stationKeeping.targetSmaKm=6678.1363, stationKeeping.fuelReserveKg=1, endOfLife.finalAltitudeKm=150

### Chemical Propulsion Sat / electric-propulsion-transfer

- Declared compatible: no
- GMAT: blocked - Required digital-thread value is missing: satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg Required digital-thread value is missing: satellite.bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw Required digital-thread value is missing: satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw
- Simu-CIC: blocked - No compatible GMAT mission.
- OPALIS: blocked - No compatible GMAT mission.
- RF-COMLINK: blocked - No compatible GMAT mission.
- Values: none

### Chemical Propulsion Sat / chemical-hohmann-transfer

- Declared compatible: yes
- GMAT: passed - GMAT completed. Downstream execution requires a non-empty OEM ephemeris.
- Simu-CIC: not_run - Waiting for a completed GMAT OEM ephemeris.
- OPALIS: not_run - Waiting for Simu-CIC CIC output.
- RF-COMLINK: not_run - Waiting for Simu-CIC CIC output; RF-COMLINK calculation remains GUI/manual.
- Values: initialOrbit.epoch=31258.66709490726, initialOrbit.smaKm=6678.1363, initialOrbit.eccentricity=0, initialOrbit.inclinationDeg=28.5, transfer.targetRadiusKm=7378.1363, transfer.targetEccentricity=0.005, transfer.finalPropagationSeconds=86400, spacecraft.dryMassKg=300, spacecraft.dragAreaM2=2, spacecraft.dragCoefficient=2.2, propulsion.ispSeconds=320

### Chemical Propulsion Sat / chemical-3d-transfer

- Declared compatible: yes
- GMAT: passed - GMAT completed. Downstream execution requires a non-empty OEM ephemeris.
- Simu-CIC: not_run - Waiting for a completed GMAT OEM ephemeris.
- OPALIS: not_run - Waiting for Simu-CIC CIC output.
- RF-COMLINK: not_run - Waiting for Simu-CIC CIC output; RF-COMLINK calculation remains GUI/manual.
- Values: initialOrbit.epoch=31258.66709490726, initialOrbit.altitudeKm=300, initialOrbit.eccentricity=0, initialOrbit.inclinationDeg=28.5, transfer.finalAltitudeKm=35786, transfer.finalInclinationDeg=0, spacecraft.dryMassKg=300, spacecraft.dragAreaM2=2, spacecraft.dragCoefficient=2.2, propulsion.ispSeconds=320

### Fudan Satellite / orbit-keeping

- Declared compatible: no
- GMAT: blocked - The orbit-keeping template requires an explicitly identified chemical propulsion subsystem.
- Simu-CIC: blocked - No compatible GMAT mission.
- OPALIS: blocked - No compatible GMAT mission.
- RF-COMLINK: blocked - No compatible GMAT mission.
- Values: none

### Fudan Satellite / electric-propulsion-transfer

- Declared compatible: yes
- GMAT: passed - GMAT completed. Downstream execution requires a non-empty OEM ephemeris.
- Simu-CIC: not_run - Waiting for a completed GMAT OEM ephemeris.
- OPALIS: not_run - Waiting for Simu-CIC CIC output.
- RF-COMLINK: not_run - Waiting for Simu-CIC CIC output; RF-COMLINK calculation remains GUI/manual.
- Values: initialOrbit.epoch=31258.66709490726, initialOrbit.smaKm=6678.1363, initialOrbit.eccentricity=0, initialOrbit.inclinationDeg=28.5, initialOrbit.raanDeg=67, initialOrbit.argPeriapsisDeg=355, initialOrbit.trueAnomalyDeg=250, spacecraft.dryMassKg=49.568, spacecraft.initialFuelMassKg=4.6, transfer.finalAltitudeKm=800, propulsion.maximumUsablePowerKw=0.4, propulsion.minimumUsablePowerKw=0.3, power.initialMaxPowerKw=0.75, power.busLoadKw=0.38, power.systemMarginPercent=0

### Fudan Satellite / chemical-hohmann-transfer

- Declared compatible: no
- GMAT: blocked - The chemical Hohmann-transfer template requires an explicitly identified chemical propulsion subsystem.
- Simu-CIC: blocked - No compatible GMAT mission.
- OPALIS: blocked - No compatible GMAT mission.
- RF-COMLINK: blocked - No compatible GMAT mission.
- Values: none

### Fudan Satellite / chemical-3d-transfer

- Declared compatible: no
- GMAT: blocked - The chemical 3D GEO-transfer template requires an explicitly identified chemical propulsion subsystem.
- Simu-CIC: blocked - No compatible GMAT mission.
- OPALIS: blocked - No compatible GMAT mission.
- RF-COMLINK: blocked - No compatible GMAT mission.
- Values: none

### Starlink V1.5 Electric Reference / orbit-keeping

- Declared compatible: no
- GMAT: blocked - The orbit-keeping template requires an explicitly identified chemical propulsion subsystem.
- Simu-CIC: blocked - No compatible GMAT mission.
- OPALIS: blocked - No compatible GMAT mission.
- RF-COMLINK: blocked - No compatible GMAT mission.
- Values: none

### Starlink V1.5 Electric Reference / electric-propulsion-transfer

- Declared compatible: yes
- GMAT: blocked - ******************************************** *** GMAT Console Application ******************************************** General Mission Analysis Tool Console Based Version Build Date: Mar 26 2026 15:02:55 GMAT working directory set to 'D:\STAGE\APP\gmat\bin\' Moderator is updating data files... Moderator is creating core engine... *** Library "..\plugins\libPythonInterface_py312" did not open. *** Library "..\plugins\libMatlabInterface" did not open. *** Library "..\plugins\libFminconOptimizer" did not open. Successfully set Planetary Source to use: DE405 Successfully set Planetary Source to use: DE405 Successfully set Planetary Source to use: DE405 Setting nutation file to D:\STAGE\APP\gmat\bin\..\data\planetary_coeff\NUTATION.DAT Setting leap seconds file to D:\STAGE\APP\gmat\bin\..\data\time\tai-utc.dat 2026-09-02 22:36:58 GMAT Moderator successfully created core engine Interpreting scripts from the file. ***** file: D:\STAGE\agent-gmat-main\reports\gmat-batch-work\gmat-compatibility-campaign-fC9rsu\ref-starlink-v1-5-public-rf\electric-propulsion-transfer\gmat\mission-runs\26-09-02_22-36\electric_propulsion_transfer.script Successfully set Planetary Source to use: DE405 Successfully set Planetary Source to use: DE405 Note: The GroundTrack component does not have a data size limitation. Successfully interpreted the script .................... Print out the whole sequence ........................................ Command::NoOp Command::BeginMissionSequence Command::Toggle Command::Report Command::BeginFiniteBurn Command::While ... branch 0::Propagate ... branch 0::Report ... branch 0::EndWhile Command::EndFiniteBurn Command::Report .................... End sequence ........................................................
- Simu-CIC: blocked - GMAT must complete and provide an OEM ephemeris first.
- OPALIS: not_run - Waiting for Simu-CIC CIC output.
- RF-COMLINK: not_run - Waiting for Simu-CIC CIC output; RF-COMLINK calculation remains GUI/manual.
- Values: initialOrbit.epoch=31258.66709490726, initialOrbit.smaKm=6678.1363, initialOrbit.eccentricity=0, initialOrbit.inclinationDeg=28.5, initialOrbit.raanDeg=67, initialOrbit.argPeriapsisDeg=355, initialOrbit.trueAnomalyDeg=250, spacecraft.dryMassKg=296, spacecraft.initialFuelMassKg=10, transfer.finalAltitudeKm=800, propulsion.maximumUsablePowerKw=4.2, propulsion.minimumUsablePowerKw=1, power.initialMaxPowerKw=4.2, power.busLoadKw=2.8, power.systemMarginPercent=20

### Starlink V1.5 Electric Reference / chemical-hohmann-transfer

- Declared compatible: no
- GMAT: blocked - The chemical Hohmann-transfer template requires an explicitly identified chemical propulsion subsystem.
- Simu-CIC: blocked - No compatible GMAT mission.
- OPALIS: blocked - No compatible GMAT mission.
- RF-COMLINK: blocked - No compatible GMAT mission.
- Values: none

### Starlink V1.5 Electric Reference / chemical-3d-transfer

- Declared compatible: no
- GMAT: blocked - The chemical 3D GEO-transfer template requires an explicitly identified chemical propulsion subsystem.
- Simu-CIC: blocked - No compatible GMAT mission.
- OPALIS: blocked - No compatible GMAT mission.
- RF-COMLINK: blocked - No compatible GMAT mission.
- Values: none

