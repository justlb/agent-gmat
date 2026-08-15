#!/usr/bin/env python3
"""Materialise every GMAT scenario pattern that has a local reference script.

This is a laboratory test suite, not a production generator. A candidate is
either reference-derived and safe to open in GMAT, or explicitly blocked with
the reason a reference is still required.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from build_gmat_script import build_chemical_transfer_2d


REPO_ROOT = Path(__file__).resolve().parents[4]
GMAT_SAMPLES = Path("D:/STAGE/APP/gmat/samples")
ELECTRIC_REFERENCE = REPO_ROOT / "backend" / "workflow_agents" / "gmat_skills" / "electric-propulsion-transfer-template" / "references" / "electric_propulsion_transfer.script"
EXAMPLE = Path(__file__).parents[1] / "examples" / "chemical_transfer_300_to_500.json"


REFERENCE_CANDIDATES = [
    ("transfer-chemical-2d-targeted-hohmann", "transfer", "chemical", "2d", GMAT_SAMPLES / "Ex_HohmannTransfer.script", "Two impulsive burns solved by DifferentialCorrector."),
    ("transfer-chemical-2d-targeted-finite-burn", "transfer", "chemical", "2d", GMAT_SAMPLES / "Tut_Target_Finite_Burn_to_Raise_Apogee.script", "Finite chemical burn duration solved to raise apoapsis."),
    ("transfer-chemical-3d-geo", "transfer", "chemical", "3d", GMAT_SAMPLES / "Ex_GEOTransfer.script", "Multi-burn GTO/GEO transfer with plane-change targeting."),
    ("transfer-electric-2d-reference", "transfer", "electric", "2d", ELECTRIC_REFERENCE, "Existing project electric-transfer reference."),
    ("orbit-maintenance-chemical-leo", "orbit-maintenance", "chemical", "3d", GMAT_SAMPLES / "Ex_LEOStationKeeping.script", "Threshold-driven LEO reboost loop."),
]

BLOCKED_CANDIDATES = [
    ("transfer-electric-3d", "transfer", "electric", "3d", "A validated electric transfer with plane change / RAAN targeting is required."),
    ("orbit-maintenance-electric", "orbit-maintenance", "electric", "3d", "A validated electric orbit-maintenance policy is required."),
    ("station-keeping-geo-gso-chemical", "station-keeping-geo-gso", "chemical", "3d", "A GEO/GSO station-keeping reference, not merely a GEO transfer, is required."),
    ("station-keeping-geo-gso-electric", "station-keeping-geo-gso", "electric", "3d", "A GEO/GSO electric station-keeping reference is required."),
    ("escape-chemical", "escape", "chemical", "3d", "A validated Earth-escape / hyperbolic injection reference is required."),
    ("escape-electric", "escape", "electric", "3d", "A validated electric escape trajectory reference is required."),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    output = Path(__file__).parents[1] / "generated" / "candidate-suite"
    output.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []

    scenario = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    analytic_script, metrics = build_chemical_transfer_2d(scenario)
    analytic_path = output / "transfer-chemical-2d-analytic-hohmann.script"
    analytic_path.write_text(analytic_script, encoding="utf-8")
    manifest.append({
        "id": "transfer-chemical-2d-analytic-hohmann",
        "family": "transfer", "propulsion": "chemical", "dimension": "2d",
        "status": "generated", "file": analytic_path.name,
        "source": "laboratory deterministic builder",
        "metrics": metrics,
        "test": "Verify 300 km stable coast, transfer ellipse, 500 km stable coast, and two fuel steps.",
    })

    for identifier, family, propulsion, dimension, source, purpose in REFERENCE_CANDIDATES:
        if not source.exists():
            manifest.append({"id": identifier, "family": family, "propulsion": propulsion, "dimension": dimension, "status": "blocked", "reason": f"Reference file is missing: {source}"})
            continue
        target = output / f"{identifier}.script"
        shutil.copyfile(source, target)
        manifest.append({
            "id": identifier, "family": family, "propulsion": propulsion, "dimension": dimension,
            "status": "reference-copy", "file": target.name, "source": str(source), "source_sha256": digest(source), "test": purpose,
        })

    for identifier, family, propulsion, dimension, reason in BLOCKED_CANDIDATES:
        manifest.append({"id": identifier, "family": family, "propulsion": propulsion, "dimension": dimension, "status": "blocked", "reason": reason})

    manifest_path = output / "candidate_manifest.json"
    manifest_path.write_text(json.dumps({"schema_version": 1, "candidates": manifest}, indent=2) + "\n", encoding="utf-8")
    print(f"Generated candidate suite: {output.resolve()}")
    print(f"Manifest: {manifest_path.resolve()}")


if __name__ == "__main__":
    main()
