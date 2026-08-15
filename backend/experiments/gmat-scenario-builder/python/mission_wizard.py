#!/usr/bin/env python3
"""Interactive, deterministic mission-definition assistant for the GMAT lab.

It collects structured values and writes mission.scenario.json.  It never
writes GMAT syntax and has no dependency on an LLM or an API key.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


FAMILIES = {
    "1": "transfer",
    "2": "orbit-maintenance",
    "3": "station-keeping-geo-gso",
    "4": "escape",
}
PROPULSIONS = {"1": "chemical", "2": "electric"}


def prompt_choice(label: str, choices: dict[str, str]) -> str:
    print(f"\n{label}")
    for key, value in choices.items():
        print(f"  {key}. {value}")
    while True:
        answer = input("> ").strip()
        if answer in choices:
            return choices[answer]
        print("Choose one of the listed numbers.")


def prompt_float(label: str, minimum: float | None = None, default: float | None = None) -> float:
    suffix = f" [{default}]" if default is not None else ""
    while True:
        raw = input(f"{label}{suffix}: ").strip()
        if not raw and default is not None:
            return default
        try:
            value = float(raw)
        except ValueError:
            print("Enter a number.")
            continue
        if minimum is not None and value < minimum:
            print(f"Value must be >= {minimum}.")
            continue
        return value


def get_path(document: dict[str, Any], *keys: str, default: Any = None) -> Any:
    current: Any = document
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    return current if current is not None else default


def load_satellite(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    satellite = document.get("satellite", {})
    bus = satellite.get("bus", {})
    physical = bus.get("physical", {})
    propulsion = bus.get("propulsion_subsystem", {})
    electric = propulsion.get("electric_thruster", {})
    is_electric = "electric" in str(propulsion.get("type", "")).lower()
    return {
        "id": document.get("id", "unknown-satellite"),
        "version": document.get("version", "unknown"),
        "source_file": str(path.resolve()),
        "dry_mass_kg": get_path(physical, "mass_kg", "dry", default=None),
        "specific_impulse_seconds": propulsion.get("specific_impulse_seconds"),
        "initial_propellant_kg": electric.get("propellant_mass_kg") if is_electric else get_path(physical, "mass_kg", "propellant", default=None),
        "propulsion_kind": "electric" if is_electric else "chemical",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a validated mission.scenario.json for the GMAT scenario-builder laboratory.")
    parser.add_argument("--satellite", required=True, type=Path, help="Reference satellite-definition JSON")
    parser.add_argument("--output", type=Path, default=Path("mission.scenario.json"))
    args = parser.parse_args()

    satellite = load_satellite(args.satellite)
    print("GMAT modular mission wizard")
    print(f"Satellite: {satellite['id']} @ {satellite['version']} ({satellite['propulsion_kind']})")
    family = prompt_choice("Mission family", FAMILIES)
    propulsion = prompt_choice("Propulsion", PROPULSIONS)
    if propulsion != satellite["propulsion_kind"]:
        raise SystemExit(f"The selected satellite exposes {satellite['propulsion_kind']} propulsion, not {propulsion} propulsion.")
    dimension = prompt_choice("Transfer model dimension", {"1": "2d", "2": "3d"}) if family == "transfer" else "3d"

    print("\nInitial orbit")
    initial_altitude = prompt_float("Altitude [km]", 0)
    eccentricity = prompt_float("Eccentricity", 0, 0)
    inclination = prompt_float("Inclination [deg]", 0, 0)

    target: dict[str, Any]
    if family == "transfer":
        target = {"altitude_km": prompt_float("Target altitude [km]", 0), "eccentricity": prompt_float("Target eccentricity", 0, 0)}
    elif family == "orbit-maintenance":
        target = {"minimum_altitude_km": prompt_float("Minimum allowed altitude [km]", 0), "target_altitude_km": prompt_float("Reboost target altitude [km]", 0)}
    elif family == "station-keeping-geo-gso":
        target = {"longitude_deg": prompt_float("Target longitude [deg]", -180), "maximum_longitude_error_deg": prompt_float("Maximum longitude error [deg]", 0, 0.05)}
    else:
        target = {"c3_km2_s2": prompt_float("Target C3 [km²/s²]", 0)}

    dry_mass = prompt_float("Dry mass [kg]", 0, float(satellite["dry_mass_kg"] or 0))
    isp = prompt_float("Specific impulse [s]", 0, float(satellite["specific_impulse_seconds"] or 0))
    propellant = prompt_float("Initial propellant [kg]", 0, float(satellite["initial_propellant_kg"] or 0))
    reserve = prompt_float("Fuel reserve [kg]", 0, 1)
    pre_transfer_coast_days = prompt_float("Pre-transfer coast duration [days]", 0, 0.1) if family == "transfer" else None
    post_transfer_coast_days = prompt_float("Post-transfer coast duration [days]", 0, 0.25) if family == "transfer" else None

    scenario = {
        "schema_version": 1,
        "scenario": {"family": family, "propulsion": propulsion, "dimension": dimension},
        "satellite": {key: satellite[key] for key in ("id", "version", "source_file")},
        "spacecraft": {"dry_mass_kg": dry_mass, "specific_impulse_seconds": isp, "initial_propellant_kg": propellant},
        "initial_orbit": {"central_body": "Earth", "altitude_km": initial_altitude, "eccentricity": eccentricity, "inclination_deg": inclination},
        "target": target,
        "constraints": {"fuel_reserve_kg": reserve, **({"pre_transfer_coast_days": pre_transfer_coast_days, "post_transfer_coast_days": post_transfer_coast_days} if family == "transfer" else {})},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(scenario, indent=2) + "\n", encoding="utf-8")
    print(f"\nSaved validated scenario: {args.output.resolve()}")


if __name__ == "__main__":
    main()
