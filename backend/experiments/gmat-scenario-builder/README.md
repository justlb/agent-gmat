# GMAT scenario-builder laboratory

This directory is intentionally **not** registered by the web backend. It is
where modular GMAT generation is explored and validated before it can affect
Mission Studio or an existing GMAT workflow.

## Scope of the first experiment

`python/mission_wizard.py` is the interactive mission-definition assistant.
It writes structured JSON only; it does not use an LLM and cannot write GMAT
syntax. `python/build_gmat_script.py` is the deterministic builder.

The currently supported laboratory path is a **2D chemical Hohmann transfer**.
It has deterministic unit tests and still requires a manual GMAT Console/GUI
validation before it can be called an approved reference:

- the approved orbit-keeping template supplies the spacecraft, chemical tank,
  force model, propagator, reporting and ephemeris blocks;
- the laboratory supplies only a transfer mission-sequence block;
- all inputs are structured numbers, never LLM-written GMAT lines;
- the builder refuses an insufficient fuel load before it writes a script.

The generated previews are under `generated/`. They are test artefacts, not
production runs and not part of `mission-runs`.

## Run the laboratory

From `backend/` in WSL:

```bash
python3 experiments/gmat-scenario-builder/python/mission_wizard.py \
  --satellite ../data/satellite-library/reference-leo-orbit-keeping.v1.json \
  --output experiments/gmat-scenario-builder/generated/my-mission.scenario.json

python3 experiments/gmat-scenario-builder/python/build_gmat_script.py \
  experiments/gmat-scenario-builder/generated/my-mission.scenario.json \
  --output experiments/gmat-scenario-builder/generated/my-mission.script

python3 experiments/gmat-scenario-builder/python/test_builder.py

python3 experiments/gmat-scenario-builder/python/generate_candidate_suite.py
```

At this stage the builder deliberately accepts only `transfer / chemical / 2d`.
All other selections are saved by the wizard, but the builder stops with a
clear unsupported-combination error until a GMAT reference pattern has been
analysed and validated.

`generate_candidate_suite.py` creates `generated/candidate-suite/`. It
materialises every locally available reference-derived candidate and writes a
manifest which explicitly marks the unavailable combinations as `blocked`.

## GMAT reference samples

The source GMAT installation remains the canonical location. No copies are
kept here, so updates to the installation are visible during analysis.

| Sample | What it teaches |
| --- | --- |
| `Ex_HohmannTransfer.script` | Targeted two-impulse orbital transfer. |
| `Tut_SimpleOrbitTransfer.script` | Minimal transfer mission sequencing. |
| `Ex_FiniteBurn.script` | Chemical tank, chemical thruster and finite-burn lifecycle. |
| `Tut_Target_Finite_Burn_to_Raise_Apogee.script` | Targeting a finite burn to reach an orbital objective. |
| `Ex_GEOTransfer.script` | Multi-burn GTO/GEO transfer and plane-change targeting. |
| `Ex_LEOStationKeeping.script` | Low-Earth station keeping. |
| `Ex_LunarOrbitStationKeeping.script` | Station keeping around another body. |
| `Ex_LunarTransfer.script` | Multi-body transfer. |
| `Ex_MarsOrbit.script` / `Ex_MarsBPlane.script` | Planetary arrival and B-plane targeting. |
| `Ex_ConstellationScript.script` | Multiple-spacecraft constructs. |

## Test order

1. Open `generated/chemical-transfer-preview.script` in GMAT and run it.
2. Verify final SMA, final eccentricity, fuel remaining and OEM output.
3. Compare its sequence with `Ex_HohmannTransfer.script`.
4. Add one new block only after there is a GMAT sample that demonstrates it.

The first blocks to extract after this validation are: `impulsive-transfer`,
`finite-chemical-burn`, `finite-electric-burn`, and `targeting`.
