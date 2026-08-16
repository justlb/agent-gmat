#!/usr/bin/env python3
"""Extract the human-readable RF-COMLINK reports from a calculated scenario."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if value:
            self.parts.append(value)


def report_text(source: bytes) -> str:
    parser = TextExtractor()
    parser.feed(source.decode("utf-8", errors="replace"))
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    scenario = args.scenario.resolve()
    with zipfile.ZipFile(scenario) as archive:
        report_names = sorted(name for name in archive.namelist() if name.lower().startswith("reports/") and name.lower().endswith((".html", ".htm")))
        reports = [{"path": name, "text": report_text(archive.read(name))[:100_000]} for name in report_names]
        links = sorted(name for name in archive.namelist() if name.lower().startswith("links/") and name.lower().endswith(".xml"))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({
        "schema_version": 1,
        "scenario": scenario.name,
        "sha256": hashlib.sha256(scenario.read_bytes()).hexdigest(),
        "reports": reports,
        "link_files": links,
    }, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
