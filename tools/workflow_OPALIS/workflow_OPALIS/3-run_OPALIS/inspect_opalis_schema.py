#!/usr/bin/env python3
"""Inspect the public OPALIS .NET model without changing a simulation.

This utility exists so that satellite-to-OPALIS adapters are based on real,
writable API properties instead of guessed names.  It intentionally limits
collection traversal to the first item and avoids recursive object cycles.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import opalis_python as opalis


DEFAULT_ROOTS = (
    "SimulationModel.Battery",
    "SimulationModel.SolarGenerator",
    "SimulationModel.DistributionLines",
    "SimulationModel.PowerProfil",
    "SimulationModel.SimulationInitialisation",
)

BACK_REFERENCE_PROPERTIES = {"Parent", "ParentSimulation"}


def scalar(value: Any) -> bool:
    if value is None or isinstance(value, (str, bool, int, float)):
        return True
    try:
        return bool(value.GetType().IsPrimitive or value.GetType().IsEnum)
    except Exception:
        return False


def inspect_object(value: Any, path: str, depth: int, visited: set[int]) -> None:
    if value is None or depth < 0:
        return
    identity = id(value)
    if identity in visited:
        return
    visited.add(identity)
    try:
        properties = value.GetType().GetProperties()
    except Exception:
        return
    for prop in sorted(properties, key=lambda item: str(item.Name)):
        if str(prop.Name) in BACK_REFERENCE_PROPERTIES:
            continue
        if not prop.CanRead or prop.GetIndexParameters().Length:
            continue
        child_path = f"{path}.{prop.Name}"
        try:
            child = prop.GetValue(value, None)
        except Exception as exc:
            print(f"{child_path}\t{prop.PropertyType.FullName}\tread-error={exc}")
            continue
        writable = "writable" if prop.CanWrite else "readonly"
        if scalar(child):
            print(f"{child_path}\t{prop.PropertyType.FullName}\t{writable}\t{opalis.json_value(child)!r}")
            continue
        print(f"{child_path}\t{prop.PropertyType.FullName}\t{writable}")
        if depth > 0:
            inspect_object(child, child_path, depth - 1, visited)
        try:
            count = int(child.Count)
        except Exception:
            count = 0
        if depth > 0 and count:
            try:
                first = child[0]
            except Exception:
                try:
                    first_key = next(iter(child.Keys))
                    first = child[first_key]
                except Exception:
                    first = None
            if first is not None:
                inspect_object(first, f"{child_path}[0]", depth - 1, visited)


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect writable OPALIS model properties.")
    parser.add_argument("simulation")
    parser.add_argument("--opalis-dir", default=str(opalis.DEFAULT_OPALIS_DIR))
    parser.add_argument("--root", action="append", default=[])
    parser.add_argument("--depth", type=int, default=2)
    args = parser.parse_args()
    simulation_path = Path(args.simulation).resolve()
    opalis_dir = Path(args.opalis_dir).resolve()
    simulation_type, _ = opalis.load_opalis_api(opalis_dir)
    simulation = opalis.open_simulation(simulation_path, simulation_type)
    for root in args.root or DEFAULT_ROOTS:
        print(f"# {root}")
        inspect_object(opalis.get_property(simulation, root), root, args.depth, set())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
