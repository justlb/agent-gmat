#!/usr/bin/env python3
"""Compatibility entry point for the former RF-COMLINK stage-3 location."""

from __future__ import annotations

import runpy
from pathlib import Path


CANONICAL_PIPELINE = (
    Path(__file__).resolve().parent.parent / "4-run_RF-COMLINK" / "rfcomlink_pipeline.py"
)

if __name__ == "__main__":
    runpy.run_path(str(CANONICAL_PIPELINE), run_name="__main__")
