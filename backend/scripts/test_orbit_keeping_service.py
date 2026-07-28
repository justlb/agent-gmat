#!/usr/bin/env python3
"""Run the two deterministic orbit-keeping service tests from any directory."""

from pathlib import Path
import shutil
import subprocess
import sys


def main() -> int:
    backend_dir = Path(__file__).resolve().parent.parent
    node = shutil.which("node")
    if node is None:
        print("Node.js is required to run the TypeScript tests.", file=sys.stderr)
        return 1
    command = [node, "--import", "tsx", "--test", "tests/gmat/orbitKeepingService.test.ts"]
    return subprocess.run(command, cwd=backend_dir, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
