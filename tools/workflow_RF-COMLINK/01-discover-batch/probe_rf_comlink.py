#!/usr/bin/env python3
"""Non-invasive RF-COMLINK installation and CLI discovery probe.

Without --probe-cli this script never starts RF-COMLINK.  The optional flag is
kept only for another installation: on the project's installed version, the
usual help switches are interpreted as a scenario filename, not as CLI help.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, default=os.environ.get("RF_COMLINK_HOME"), help="RF-COMLINK installation directory")
    parser.add_argument("--probe-cli", action="store_true")
    parser.add_argument("--timeout-seconds", type=float, default=5)
    args = parser.parse_args()
    if args.home is None:
        parser.error("--home or RF_COMLINK_HOME is required")
    executable = args.home / "rf-comlink.exe"
    report: dict[str, object] = {
        "rf_comlink_home": str(args.home),
        "executable": str(executable),
        "executable_exists": executable.is_file(),
        "documentation_exists": (args.home / "doc" / "index.html").is_file(),
        "batch_mode": "gui_only" if args.probe_cli else "unknown",
        "cli_attempts": [],
    }
    if args.probe_cli and executable.is_file():
        attempts: list[dict[str, object]] = []
        for option in ("--help", "-h", "/?"):
            try:
                completed = subprocess.run([str(executable), option], capture_output=True, text=True, timeout=args.timeout_seconds)
                attempts.append({"option": option, "exit_code": completed.returncode, "stdout": completed.stdout[-2000:], "stderr": completed.stderr[-2000:]})
            except subprocess.TimeoutExpired:
                attempts.append({"option": option, "status": "timeout_or_gui_started"})
        report["cli_attempts"] = attempts
    print(json.dumps(report, indent=2))
    return 0 if executable.is_file() else 2


if __name__ == "__main__":
    raise SystemExit(main())
