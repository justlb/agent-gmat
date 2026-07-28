#!/usr/bin/env python3
"""Run the orbit-keeping HTTP API tests (including its fake LLM)."""

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
    return subprocess.run(
        [node, "--import", "tsx", "--test", "tests/api/gmat/orbitKeeping.routes.test.ts"],
        cwd=backend_dir,
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
