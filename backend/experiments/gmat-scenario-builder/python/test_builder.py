from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_gmat_script import build_chemical_transfer_2d, replace_string_assignment  # noqa: E402


class ChemicalTransferBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        example = Path(__file__).parents[1] / "examples" / "chemical_transfer_300_to_500.json"
        self.scenario = json.loads(example.read_text(encoding="utf-8"))

    def test_builds_chemical_transfer_with_ephemeris_and_two_burns(self) -> None:
        script, metrics = build_chemical_transfer_2d(self.scenario)
        self.assertIn("Create ChemicalTank ChemicalTank1;", script)
        self.assertIn("Maneuver 'Transfer injection' TOI(DefaultSC);", script)
        self.assertIn("Maneuver 'Transfer circularization' GOI(DefaultSC);", script)
        self.assertIn("Toggle EphemerisFile1 On;", script)
        self.assertGreater(metrics["delta_v1_km_s"], 0)
        self.assertGreater(metrics["propellant_required_kg"], 0)

    def test_rejects_insufficient_propellant(self) -> None:
        self.scenario["spacecraft"]["initial_propellant_kg"] = 10
        with self.assertRaisesRegex(ValueError, "insufficient fuel"):
            build_chemical_transfer_2d(self.scenario)

    def test_subscriber_path_is_bound_to_an_existing_output_directory(self) -> None:
        script, _ = build_chemical_transfer_2d(self.scenario)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "ReboostReport.txt"
            rendered = replace_string_assignment(script, "ReboostReport.Filename", output.name)
            self.assertIn("ReboostReport.Filename = 'ReboostReport.txt';", rendered)


if __name__ == "__main__":
    unittest.main()
