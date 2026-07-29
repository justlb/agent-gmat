#!/usr/bin/env python3
"""Submit one orbit-keeping request to the deterministic GMAT backend pipeline.

Start the backend first (for example: ``npm run dev`` in backend/), then run:

    python3 scripts/generate_orbit_keeping.py

The backend performs the complete pipeline: loads the fixed template and
reference values YAML, makes one LLM request, validates its YAML patch, writes
the modified values YAML, renders the GMAT script, and saves both artefacts in
the selected user's workspace.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import shutil
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_PROMPT = (
    "Change dry mass to 200 kg, drag area to 10 m2, "
    "and minimum altitude to 210 km."
)
DEFAULT_USER_ID = "justine"


def default_output_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "output_data" / "manuel_test"


def default_backend_url() -> str:
    """Read the configured backend port so the CLI follows config.json."""
    config_path = Path(__file__).resolve().parents[2] / "config.json"
    try:
        port = int(json.loads(config_path.read_text(encoding="utf-8"))["server"]["port"])
        return f"http://localhost:{port}"
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return "http://localhost:3000"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a GMAT orbit-keeping script through the backend.")
    parser.add_argument("--request", default=DEFAULT_PROMPT, help="Natural-language mission change request.")
    parser.add_argument("--backend-url", default=default_backend_url(), help="Backend base URL.")
    parser.add_argument("--user-id", default=DEFAULT_USER_ID, help="User workspace owner.")
    parser.add_argument("--output-dir", type=Path, default=default_output_dir(), help="Directory receiving timestamped copies of the YAML and GMAT script.")
    return parser.parse_args()


def save_manual_test_artifacts(result: dict[str, object], output_dir: Path) -> tuple[Path, Path]:
    """Copy backend artefacts to the project manual-test directory without overwriting a run."""
    values_source = Path(str(result["valuesPath"]))
    script_source = Path(str(result["scriptPath"]))
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%y-%m-%d_%H-%M")
    suffix = ""
    attempt = 1
    while True:
        values_destination = output_dir / f"orbit_keeping_{timestamp}{suffix}.values.yaml"
        script_destination = output_dir / f"orbit_keeping_{timestamp}{suffix}.script"
        if not values_destination.exists() and not script_destination.exists():
            break
        attempt += 1
        suffix = f"_{attempt:02d}"

    shutil.copy2(values_source, values_destination)
    shutil.copy2(script_source, script_destination)
    return values_destination, script_destination


def main() -> int:
    args = parse_args()
    endpoint = f"{args.backend_url.rstrip('/')}/api/gmat/orbit-keeping/generate"
    payload = json.dumps({"request": args.request}).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-codex-user-id": args.user_id,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=90) as response:
            result = json.load(response)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"Backend rejected the request (HTTP {exc.code}): {detail}", file=sys.stderr)
        return 1
    except URLError as exc:
        print(f"Cannot reach the backend at {endpoint}: {exc.reason}", file=sys.stderr)
        print("Start the backend first with: npm run dev", file=sys.stderr)
        return 1

    try:
        saved_values, saved_script = save_manual_test_artifacts(result, args.output_dir)
    except (KeyError, OSError) as exc:
        print(f"Mission generated, but manual-test copies could not be saved: {exc}", file=sys.stderr)
        return 1

    print("Orbit-keeping mission generated.")
    print(f"Latency: {result['latencyMs']} ms")
    print("Accepted changes:")
    for change in result["changes"]:
        print(f"  - {change['id']} = {change['value']}")
    print(f"Backend Values YAML: {result['valuesPath']}")
    print(f"Backend GMAT script: {result['scriptPath']}")
    print(f"Saved Values YAML: {saved_values}")
    print(f"Saved GMAT script: {saved_script}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
