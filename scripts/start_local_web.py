#!/usr/bin/env python3
"""Start the local frontend/backend stack from WSL and wait until it is usable.

The project launcher remains the single source of truth for starting services.
This wrapper stops its tmux sessions and their listening ports first, then checks:
  * backend HTTP service;
  * frontend HTTPS service;
  * model connectivity separately (without treating a temporary model outage as a port failure).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import ssl


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TIMEOUT_SECONDS = 90


def run(command: list[str], *, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=PROJECT_ROOT, check=check, text=True, capture_output=True)


def listening_pids(port: int) -> list[int]:
    """Return only processes listening on the explicitly requested TCP port."""
    result = run(["lsof", "-tiTCP:%d" % port, "-sTCP:LISTEN"])
    return [int(value) for value in result.stdout.split() if value.isdigit()]


def close_port(port: int) -> bool:
    pids = listening_pids(port)
    if not pids:
        return True
    print(f"Stopping listener(s) on port {port}: {', '.join(map(str, pids))}")
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(20):
        if not listening_pids(port):
            return True
        time.sleep(0.2)
    pids = listening_pids(port)
    if pids:
        print(f"Force stopping listener(s) on port {port}: {', '.join(map(str, pids))}")
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for _ in range(15):
        if not listening_pids(port):
            return True
        time.sleep(0.2)
    return False


def stop_tmux_session(name: str) -> None:
    if run(["tmux", "has-session", "-t", name]).returncode == 0:
        print(f"Stopping tmux session: {name}")
        run(["tmux", "kill-session", "-t", name])


def stop_existing_stack(backend_session: str, frontend_session: str, ports: tuple[int, int]) -> None:
    """Stop project-owned sessions and wait through orphan-process shutdown races.

    Killing a tmux session can return before npm/tsx/Vite children have released
    their sockets.  Repeat the narrowly-scoped listener cleanup after a short
    settling delay, rather than requiring the user to manually kill ports.
    """
    stop_tmux_session(backend_session)
    stop_tmux_session(frontend_session)
    for attempt in range(1, 4):
        open_ports = [port for port in ports if listening_pids(port)]
        if not open_ports:
            if attempt == 1:
                # Give tmux children a moment to either exit or become visible
                # as listeners before the final check.
                time.sleep(0.5)
                continue
            return
        print(f"Cleanup pass {attempt}: closing listener(s) on {', '.join(map(str, open_ports))}")
        for port in open_ports:
            close_port(port)
        time.sleep(0.5)
    remaining = [port for port in ports if listening_pids(port)]
    if remaining:
        raise RuntimeError(f"could not release required local port(s): {', '.join(map(str, remaining))}")


def http_json(url: str, *, verify_tls: bool) -> tuple[int, object]:
    context = None if verify_tls else ssl._create_unverified_context()  # noqa: SLF001 - localhost Vite uses a development certificate.
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=6, context=context) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            return error.code, json.loads(body)
        except json.JSONDecodeError:
            return error.code, body


def frontend_ready(url: str) -> bool:
    context = ssl._create_unverified_context()  # noqa: SLF001 - localhost Vite uses a development certificate.
    try:
        with urllib.request.urlopen(url, timeout=4, context=context) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def backend_ready(url: str) -> bool:
    """Check a local API route that does not trigger an external LLM request."""
    try:
        status, _ = http_json(url, verify_tls=True)
        return status == 200
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return False


def tmux_log(session: str) -> str:
    result = run(["tmux", "capture-pane", "-pt", session, "-S", "-60"])
    return result.stdout.strip() if result.returncode == 0 else "(tmux log unavailable)"


def main() -> int:
    parser = argparse.ArgumentParser(description="Restart the local Codex Web frontend/backend stack and verify it.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS, help="maximum readiness wait in seconds (default: 90)")
    parser.add_argument("--skip-model-health", action="store_true", help="deprecated: model health is informational by default")
    parser.add_argument("--require-model-health", action="store_true", help="fail startup unless the configured LLM is reachable")
    parser.add_argument("--keep-proxy", action="store_true", help="keep inherited HTTP(S) proxy variables instead of using a direct model connection")
    parser.add_argument("--with-remote-gui", action="store_true", help="start configured remote GUI tools too")
    args = parser.parse_args()

    if not Path("/proc/version").exists():
        print("This launcher must be run from WSL because the project services use tmux.", file=sys.stderr)
        return 2

    config = json.loads((PROJECT_ROOT / "config.json").read_text(encoding="utf-8"))
    backend_port = int(config["server"]["port"])
    frontend_port = int(config["frontend"]["httpsPort"])
    backend_session = config.get("tmux", {}).get("backendSession", "ocw-backend")
    frontend_session = config.get("tmux", {}).get("frontendSession", "ocw-frontend")

    # These actions are intentionally scoped to the project sessions and the two
    # configured local ports; unrelated services are never terminated.
    try:
        stop_existing_stack(backend_session, frontend_session, (backend_port, frontend_port))
    except RuntimeError as error:
        print(f"Unable to prepare local ports: {error}", file=sys.stderr)
        return 1

    environment = os.environ.copy()
    environment.setdefault("SKIP_CONFIG_SERVICE_CHECKS", "1")
    if not args.keep_proxy and not environment.get("OPENAI_PROXY_URL"):
        # WSL can inherit a Windows proxy that is no longer listening. The
        # backend honours HTTPS_PROXY independently of OPENAI_PROXY_URL, which
        # otherwise makes model health fail despite a valid direct connection.
        for proxy_key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            environment.pop(proxy_key, None)
        print("Inherited HTTP proxy variables cleared; model requests will use the direct connection.")
    if not args.with_remote_gui:
        environment["SKIP_REMOTE_GUI"] = "1"

    print("Starting backend and frontend...")
    started = subprocess.run(["bash", "./start_open_codex_web.sh"], cwd=PROJECT_ROOT, env=environment, text=True)
    if started.returncode != 0:
        print("Startup script failed.", file=sys.stderr)
        return started.returncode

    backend_url = f"http://127.0.0.1:{backend_port}/api/health"
    backend_service_url = f"http://127.0.0.1:{backend_port}/api/skills"
    frontend_url = f"https://127.0.0.1:{frontend_port}"
    deadline = time.monotonic() + args.timeout
    last_backend: object = "backend has not responded yet"
    while time.monotonic() < deadline:
        backend_ok = backend_ready(backend_service_url)
        model_ok = False
        try:
            status, last_backend = http_json(backend_url, verify_tls=True)
            model_ok = status == 200 and isinstance(last_backend, dict) and last_backend.get("ok") is True
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
            last_backend = str(error)
        frontend_ok = frontend_ready(frontend_url)
        if frontend_ok and backend_ok and (model_ok or not args.require_model_health):
            if model_ok:
                print("\nReady: frontend, backend, and LLM connection are healthy.")
            else:
                print("\nReady: frontend and backend are running, but the LLM is currently unreachable.")
                print("The UI is usable; GMAT chat requests will work once model connectivity returns.")
            print(f"Frontend: {frontend_url}")
            print(f"Backend:  {backend_url}")
            return 0
        time.sleep(1)

    print("\nThe stack did not become fully ready before the timeout.", file=sys.stderr)
    print(f"Backend health: {last_backend}", file=sys.stderr)
    print(f"\n--- {backend_session} log ---\n{tmux_log(backend_session)}", file=sys.stderr)
    print(f"\n--- {frontend_session} log ---\n{tmux_log(frontend_session)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
