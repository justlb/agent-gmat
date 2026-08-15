#!/usr/bin/env python3
"""Deterministic GMAT script builder for the scenario-builder laboratory.

Only combinations with a validated reference pattern are emitted.  Unsupported
combinations fail loudly instead of creating a plausible but unreliable script.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


EARTH_RADIUS_KM = 6378.1363
EARTH_MU_KM3_S2 = 398600.4418
REPO_ROOT = Path(__file__).resolve().parents[4]
ORBIT_KEEPING_TEMPLATE = REPO_ROOT / "backend" / "workflow_agents" / "gmat_skills" / "orbit-keeping-template" / "references" / "orbit_keeping.script"


def require_number(value: Any, label: str, minimum: float = 0.0) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum:
        raise ValueError(f"{label} must be a finite number >= {minimum}")
    return float(value)


def replace_assignment(script: str, left: str, value: float) -> str:
    pattern = re.compile(rf"(^\s*{re.escape(left)}\s*=\s*)[^;]+;", re.MULTILINE)
    result, count = pattern.subn(rf"\g<1>{value:.15g};", script, count=1)
    if count != 1:
        raise ValueError(f"reference block does not expose {left}")
    return result


def replace_string_assignment(script: str, left: str, value: str) -> str:
    """Set a portable GMAT subscriber filename."""
    pattern = re.compile(rf"(^\s*{re.escape(left)}\s*=\s*)'[^']*';", re.MULTILINE)
    result, count = pattern.subn(rf"\g<1>'{value}';", script, count=1)
    if count != 1:
        raise ValueError(f"reference block does not expose {left}")
    return result


def build_chemical_transfer_2d(scenario: dict[str, Any]) -> tuple[str, dict[str, float]]:
    initial = scenario["initial_orbit"]
    target = scenario["target"]
    spacecraft = scenario["spacecraft"]
    constraints = scenario["constraints"]
    initial_sma = EARTH_RADIUS_KM + require_number(initial["altitude_km"], "initial altitude")
    target_sma = EARTH_RADIUS_KM + require_number(target["altitude_km"], "target altitude")
    eccentricity = require_number(initial["eccentricity"], "initial eccentricity")
    inclination = require_number(initial["inclination_deg"], "initial inclination")
    dry_mass = require_number(spacecraft["dry_mass_kg"], "dry mass", 0.001)
    isp = require_number(spacecraft["specific_impulse_seconds"], "specific impulse", 0.001)
    fuel = require_number(spacecraft["initial_propellant_kg"], "initial propellant", 0.001)
    reserve = require_number(constraints["fuel_reserve_kg"], "fuel reserve")
    pre_transfer_coast_days = require_number(constraints.get("pre_transfer_coast_days", 0.1), "pre-transfer coast duration")
    post_transfer_coast_days = require_number(constraints.get("post_transfer_coast_days", 0.25), "post-transfer coast duration")
    if eccentricity >= 1 or abs(target_sma - initial_sma) < 0.001:
        raise ValueError("chemical Hohmann transfer requires distinct, bound initial and target orbits")

    dv1 = math.sqrt(EARTH_MU_KM3_S2 / initial_sma) * (math.sqrt(2 * target_sma / (initial_sma + target_sma)) - 1)
    dv2 = math.sqrt(EARTH_MU_KM3_S2 / target_sma) * (1 - math.sqrt(2 * initial_sma / (initial_sma + target_sma)))
    required = dry_mass * (math.exp((abs(dv1) + abs(dv2)) * 1000 / (isp * 9.80665)) - 1)
    if fuel < required + reserve:
        raise ValueError(f"insufficient fuel: need {required + reserve:.3f} kg including reserve, received {fuel:.3f} kg")

    reference = ORBIT_KEEPING_TEMPLATE.read_text(encoding="utf-8")
    marker = "BeginMissionSequence;"
    if marker not in reference:
        raise ValueError("reference template is missing BeginMissionSequence")
    script = reference[:reference.index(marker)]
    for left, value in (("DefaultSC.SMA", initial_sma), ("DefaultSC.ECC", eccentricity), ("DefaultSC.INC", inclination), ("DefaultSC.DryMass", dry_mass), ("ChemicalTank1.FuelMass", fuel), ("TOI.Element1", dv1), ("GOI.Element1", dv2), ("TOI.Isp", isp), ("GOI.Isp", isp)):
        script = replace_assignment(script, left, value)
    event = "Apoapsis" if target_sma > initial_sma else "Periapsis"
    transfer_coast_days = math.pi * math.sqrt(((initial_sma + target_sma) / 2) ** 3 / EARTH_MU_KM3_S2) / 86400
    post_transfer_elapsed_days = pre_transfer_coast_days + transfer_coast_days + post_transfer_coast_days
    script += f'''% Scenario-builder laboratory\n% Scenario: transfer / chemical / 2d\n% Source blocks: orbit-keeping spacecraft, chemical hardware, propagation, reports and ephemeris.\n% Fuel check: {required:.6f} kg required + {reserve:.6f} kg reserve.\n% The pre/post coasts make the initial orbit, transfer ellipse, final orbit and fuel steps observable in GMAT subscribers.\n\nBeginMissionSequence;\nToggle EphemerisFile1 On;\nPropagate 'Pre-transfer coast' DefaultProp(DefaultSC) {{DefaultSC.ElapsedDays = {pre_transfer_coast_days:.15g}}};\nReport OrbitAnalysisReport DefaultSC.A1ModJulian DefaultSC.Earth.Altitude DefaultSC.ChemicalTank1.FuelMass DefaultSC.TotalMass DefaultSC.Earth.SMA DefaultSC.ECC DefaultSC.EarthMJ2000Eq.INC;\nManeuver 'Transfer injection' TOI(DefaultSC);\nPropagate 'Coast on transfer ellipse' DefaultProp(DefaultSC) {{DefaultSC.Earth.{event}}};\nReport OrbitAnalysisReport DefaultSC.A1ModJulian DefaultSC.Earth.Altitude DefaultSC.ChemicalTank1.FuelMass DefaultSC.TotalMass DefaultSC.Earth.SMA DefaultSC.ECC DefaultSC.EarthMJ2000Eq.INC;\nManeuver 'Transfer circularization' GOI(DefaultSC);\nPropagate 'Post-transfer coast' DefaultProp(DefaultSC) {{DefaultSC.ElapsedDays = {post_transfer_elapsed_days:.15g}}};\nReport OrbitAnalysisReport DefaultSC.A1ModJulian DefaultSC.Earth.Altitude DefaultSC.ChemicalTank1.FuelMass DefaultSC.TotalMass DefaultSC.Earth.SMA DefaultSC.ECC DefaultSC.EarthMJ2000Eq.INC;\nReport ReboostReport DefaultSC.A1ModJulian DefaultSC.ChemicalTank1.FuelMass DefaultSC.Earth.Altitude;\n'''
    return script, {"delta_v1_km_s": dv1, "delta_v2_km_s": dv2, "propellant_required_kg": required}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a GMAT laboratory script from mission.scenario.json")
    parser.add_argument("scenario", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    scenario = json.loads(args.scenario.read_text(encoding="utf-8"))
    selection = scenario.get("scenario", {})
    supported = (selection.get("family"), selection.get("propulsion"), selection.get("dimension"))
    if supported != ("transfer", "chemical", "2d"):
        raise SystemExit(f"Unsupported laboratory combination: {supported}. Only transfer / chemical / 2d is validated today.")
    script, metrics = build_chemical_transfer_2d(scenario)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Never inherit paths from an old production run. These relative names are
    # resolved by GMAT in the directory of the opened laboratory script.
    script = replace_string_assignment(script, "ReboostReport.Filename", "ReboostReport.txt")
    script = replace_string_assignment(script, "OrbitAnalysisReport.Filename", "OrbitAnalysisReport.txt")
    script = replace_string_assignment(script, "EphemerisFile1.Filename", "EphemerisFile1.oem")
    args.output.write_text(script, encoding="utf-8")
    print(json.dumps({"output": str(args.output.resolve()), "metrics": metrics}, indent=2))


if __name__ == "__main__":
    main()
