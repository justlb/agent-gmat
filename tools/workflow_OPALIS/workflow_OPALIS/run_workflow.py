#!/usr/bin/env python3
"""Orchestre la chaine conversion -> Simu-CIC -> OPALIS + RF-COMLINK."""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import math
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


PROJECT_DIR = Path(__file__).resolve().parent
APPS_DIR = PROJECT_DIR.parent
CONVERSION_DIR = PROJECT_DIR / "1-conversion_vers_SIMU-CIC"
SIMUCIC_DIR = PROJECT_DIR / "2-run_SIMU-CIC"
OPALIS_RUNNER_DIR = PROJECT_DIR / "3-run_OPALIS"
RFCOMLINK_RUNNER_DIR = PROJECT_DIR / "4-run_RF-COMLINK"

CONVERTER = CONVERSION_DIR / "eph_conversion.py"
SIMUCIC_RUNNER = SIMUCIC_DIR / "run_scilab_simulation.py"
OPALIS_RUNNER = OPALIS_RUNNER_DIR / "opalis_pipeline.py"
RFCOMLINK_RUNNER = RFCOMLINK_RUNNER_DIR / "rfcomlink_pipeline.py"
OPALIS_TEMPLATE_DIR = OPALIS_RUNNER_DIR / "templates"

DEFAULT_SIMUCIC_DIR = APPS_DIR / "SIMU_CIC" / "simu_cic"
DEFAULT_BASE_SCENARIO = DEFAULT_SIMUCIC_DIR / "GUI" / "examples" / "Example_1.scd"
DEFAULT_OPALIS_DIR = APPS_DIR / "OPALIS" / "Opalis-2.3.0"
DEFAULT_SIMULATION = OPALIS_TEMPLATE_DIR / "empty.opalis"
DEFAULT_OUTPUT_ROOT = PROJECT_DIR / "resultats_workflow"
DEFAULT_BUNDLED_PYTHON = (
    Path.home()
    / ".cache"
    / "codex-runtimes"
    / "codex-primary-runtime"
    / "dependencies"
    / "python"
    / "python.exe"
)


def discover_default_input() -> Path:
    """Trouve automatiquement l'ephemeride source placee dans l'etape 1."""
    supported = {".txt", ".oem", ".eph"}
    candidates = [
        path
        for path in CONVERSION_DIR.iterdir()
        if path.is_file()
        and path.suffix.lower() in supported
        and not path.stem.upper().endswith(("_SIMU", "-SIMU", "_CONVERTI"))
    ]
    if not candidates:
        return CONVERSION_DIR / "EPH_GMAT.txt"
    if len(candidates) == 1:
        return candidates[0]
    preferred_names = ("EPH_GMAT.txt", "EPH_GMAT.eph")
    for name in preferred_names:
        preferred = CONVERSION_DIR / name
        if preferred in candidates:
            return preferred
    return max(candidates, key=lambda path: path.stat().st_mtime)


DEFAULT_INPUT = discover_default_input()


def default_worker_python() -> Path:
    """Prefere le Python embarque qui contient pythonnet pour OPALIS."""
    if DEFAULT_BUNDLED_PYTHON.is_file():
        return DEFAULT_BUNDLED_PYTHON
    return Path(sys.executable)


class WorkflowError(RuntimeError):
    """Erreur de workflow affichee sans trace Python inutile."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def absolute_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise WorkflowError(f"{label} introuvable : {path}")
    return path


def require_dir(path: Path, label: str) -> Path:
    if not path.is_dir():
        raise WorkflowError(f"{label} introuvable : {path}")
    return path


def load_converter() -> ModuleType:
    require_file(CONVERTER, "Script de conversion")
    spec = importlib.util.spec_from_file_location("workflow_eph_conversion", CONVERTER)
    if spec is None or spec.loader is None:
        raise WorkflowError(f"Impossible de charger le convertisseur : {CONVERTER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def convert_to_simucic(source: Path, destination: Path) -> dict[str, Any]:
    """Execute l'API du script d'etape 1 vers une sortie *-SIMU.txt."""
    converter = load_converter()
    file_type = converter.detect_file_type(str(source))

    # Le script historique contient quelques emojis dans ses messages. Leur
    # capture evite un echec d'encodage sur les consoles Windows CP1252.
    with contextlib.redirect_stdout(io.StringIO()):
        if file_type == "attitude":
            data = converter.parse_psimu_attitude(str(source))
            writer = converter.write_simu_cic_attitude
        elif file_type == "ephemeris":
            data = converter.parse_psimu_ephemeris(str(source))
            writer = converter.write_simu_cic_ephemeris
        elif file_type == "gmat_ephemeris":
            data = converter.parse_gmat_ephemeris(str(source))
            writer = converter.write_simu_cic_ephemeris
        elif file_type == "ccsds_oem":
            data = converter.parse_ccsds_oem(str(source))
            writer = converter.write_simu_cic_ephemeris
        else:
            raise WorkflowError(f"Format d'ephemeride non reconnu : {source}")

    if not data:
        raise WorkflowError(f"Aucune donnee convertible dans : {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    writer(data, str(destination))
    require_file(destination, "Ephemeride SIMU-CIC generee")
    return {"type": file_type, "records": len(data), "output": str(destination)}


def display_command(command: list[str]) -> None:
    print("Commande : " + subprocess.list2cmdline(command), flush=True)


def run_command(command: list[str], cwd: Path) -> None:
    display_command(command)
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    result = subprocess.run(command, cwd=str(cwd), check=False, env=env)
    if result.returncode != 0:
        raise WorkflowError(
            f"La commande a echoue avec le code {result.returncode} : "
            f"{subprocess.list2cmdline(command)}"
        )


def verify_opalis_python(python: Path) -> None:
    """Echoue avant Simu-CIC si le Python choisi ne charge pas pythonnet."""
    result = subprocess.run(
        [str(python), "-c", "from pythonnet import load"],
        cwd=str(PROJECT_DIR),
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        requirements = OPALIS_RUNNER_DIR / "requirements-opalis-python.txt"
        raise WorkflowError(
            "Le Python des etapes 2/3 ne contient pas pythonnet. Installez-le avec :\n"
            f'  "{python}" -m pip install -r "{requirements}"'
        )


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def opalis_quality_warnings(summary_path: Path) -> list[str]:
    """Signale les resultats OPALIS non finis ou manifestement incoherents."""
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    warnings = []
    for key in ("final_soc", "global_efficiency", "solar_array_energy"):
        value = summary.get(key)
        if isinstance(value, (int, float)) and not math.isfinite(value):
            warnings.append(f"OPALIS retourne {key}=NaN/Inf.")
    completion = summary.get("completion_percent")
    if isinstance(completion, (int, float)) and math.isfinite(completion) and completion > 100:
        warnings.append(f"OPALIS retourne completion_percent={completion} (> 100).")
    return warnings


def write_run_guide(path: Path, manifest: dict[str, Any]) -> None:
    """Cree un index humain lisible des entrees, etapes et resultats du run."""
    run_dir = Path(manifest["run_dir"])

    def relative(value: str | Path | None) -> str:
        if value is None:
            return "pas encore disponible"
        try:
            return str(Path(value).relative_to(run_dir))
        except ValueError:
            return str(value)

    steps = manifest.get("steps", {})
    conversion = steps.get("conversion", {})
    simucic = steps.get("simu_cic", {})
    opalis_step = steps.get("opalis", {})
    rfcomlink_step = steps.get("rf_comlink", {})
    lines = [
        f"RUN : {manifest['name']}",
        f"STATUT : {manifest['status']}",
        "",
        "OU TROUVER LES FICHIERS",
        "-----------------------",
        f"Entrees conservees       : {relative(manifest.get('inputs_dir'))}",
        f"Ephemeride convertie     : {relative(conversion.get('output'))}",
        f"Scenario Simu-CIC (.scd) : {relative(simucic.get('scenario_scd'))}",
        f"Sauvegarde Scilab (.sod) : {relative(simucic.get('scenario_sod'))}",
        f"Fichiers CIC partages     : {relative(simucic.get('cic_dir'))}",
        f"Cas OPALIS final         : {relative(opalis_step.get('case'))}",
        f"Resume OPALIS JSON       : {relative(opalis_step.get('summary'))}",
        f"Cas RF-COMLINK prepare   : {relative(rfcomlink_step.get('case'))}",
        f"Resume RF-COMLINK JSON   : {relative(rfcomlink_step.get('summary'))}",
        "",
        "ORGANISATION",
        "------------",
        "00-entrees          copies des fichiers fournis au workflow",
        "01-conversion       ephemeride convertie au format *-SIMU.txt",
        "02-simu-cic         execution Simu-CIC et fichiers CIC generes",
        "03-opalis           cas, flux dynamiques et resultats OPALIS",
        "04-rf-comlink       cas RF-COMLINK avec entrees CIC embarquees",
        "workflow.json       manifeste technique complet",
    ]
    if manifest.get("error"):
        lines.extend(["", "ERREUR", "------", str(manifest["error"])])
    warnings = manifest.get("warnings", [])
    if warnings:
        lines.extend(["", "AVERTISSEMENTS", "--------------"])
        lines.extend(f"- {warning}" for warning in warnings)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_latest_run(path: Path, run_dir: Path, manifest: dict[str, Any]) -> None:
    """Maintient un pointeur simple vers le run le plus recemment lance."""
    content = [
        f"DERNIER RUN : {manifest['name']}",
        f"STATUT      : {manifest['status']}",
        f"DOSSIER     : {run_dir}",
        f"GUIDE       : {run_dir / 'LISEZ-MOI.txt'}",
        f"RESULTATS OPALIS      : {run_dir / '03-opalis' / '02-resultats'}",
        f"RESULTATS RF-COMLINK  : {run_dir / '04-rf-comlink'}",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Workflow complet : ephemeride -> SIMU-CIC -> OPALIS + RF-COMLINK."
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=str(DEFAULT_INPUT),
        help=f"ephemeride source (defaut : {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--simulation",
        default=str(DEFAULT_SIMULATION),
        help=f"cas .opalis vide a preparer (defaut : {DEFAULT_SIMULATION})",
    )
    parser.add_argument(
        "--parameters-file",
        help=(
            "opalis-parameters.json produit depuis le satellite.json de la run; "
            "requis pour remplir empty.opalis sans utiliser un cas exemple"
        ),
    )
    parser.add_argument(
        "--base-scenario",
        default=str(DEFAULT_BASE_SCENARIO),
        help=f"scenario .scd Simu-CIC (defaut : {DEFAULT_BASE_SCENARIO})",
    )
    parser.add_argument(
        "--simucic-dir",
        default=str(DEFAULT_SIMUCIC_DIR),
        help=f"installation Simu-CIC (defaut : {DEFAULT_SIMUCIC_DIR})",
    )
    parser.add_argument(
        "--opalis-dir",
        default=str(DEFAULT_OPALIS_DIR),
        help=f"installation OPALIS (defaut : {DEFAULT_OPALIS_DIR})",
    )
    parser.add_argument(
        "--output-root",
        default=str(DEFAULT_OUTPUT_ROOT),
        help=f"racine des runs (defaut : {DEFAULT_OUTPUT_ROOT})",
    )
    parser.add_argument("--name", help="nom du run; par defaut : source-date-heure")
    parser.add_argument(
        "--python",
        default=str(default_worker_python()),
        help=(
            "interpreteur Python des etapes 2 et 3; par defaut, utilise le "
            "Python embarque compatible avec pythonnet s'il est disponible"
        ),
    )
    parser.add_argument("--scilab", help="chemin explicite vers l'executable Scilab")
    parser.add_argument("--nadir-axis", default="+X", help="axe nadir Simu-CIC (defaut : +X)")
    parser.add_argument("--trace-axis", default="+Y", help="axe trace Simu-CIC (defaut : +Y)")
    parser.add_argument(
        "--section",
        action="append",
        type=int,
        default=[],
        help="index de section solaire OPALIS; option repetable; defaut : 0",
    )
    parser.add_argument("--sections-count", type=int, help="nombre de sections OPALIS a conserver")
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        dest="settings",
        metavar="CHEMIN=VALEUR",
        help="parametre OPALIS; option repetable",
    )
    parser.add_argument(
        "--no-opalis-run",
        action="store_true",
        help="genere le cas OPALIS sans lancer son calcul",
    )
    parser.add_argument(
        "--no-rf-comlink",
        action="store_true",
        help="ne prepare pas le cas RF-COMLINK",
    )
    parser.add_argument(
        "--rfcomlink-template",
        default=r"D:\STAGE\APP\rf-comlink\example\example.rfcl",
        help="cas .rfcl de reference (defaut : example.rfcl)",
    )
    parser.add_argument(
        "--rfcomlink-station",
        type=int,
        default=1,
        help="indice de station sol Simu-CIC pour RF-COMLINK (defaut : 1)",
    )
    parser.add_argument(
        "--rfcomlink-links",
        nargs="+",
        default=["Telecommand", "Housekeeping telemetry"],
        help="liens RF-COMLINK a alimenter depuis CIC",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    source = require_file(absolute_path(args.input), "Ephemeride source")
    simulation = require_file(absolute_path(args.simulation), "Cas OPALIS")
    parameters_file = (
        require_file(absolute_path(args.parameters_file), "Manifeste OPALIS")
        if args.parameters_file
        else None
    )
    base_scenario = require_file(absolute_path(args.base_scenario), "Scenario Simu-CIC")
    simucic_dir = require_dir(absolute_path(args.simucic_dir), "Installation Simu-CIC")
    require_dir(simucic_dir / "lib", "Bibliotheque Simu-CIC")
    opalis_dir = require_dir(absolute_path(args.opalis_dir), "Installation OPALIS")
    require_file(opalis_dir / "lib" / "OpalisApi.dll", "API OPALIS")
    python = require_file(absolute_path(args.python), "Interpreteur Python")
    verify_opalis_python(python)
    print(f"Python des etapes 2 a 4 : {python}", flush=True)
    require_file(SIMUCIC_RUNNER, "Lanceur Simu-CIC")
    require_file(OPALIS_RUNNER, "Pipeline OPALIS")
    if not args.no_rf_comlink:
        require_file(RFCOMLINK_RUNNER, "Pipeline RF-COMLINK")
        require_file(absolute_path(args.rfcomlink_template), "Cas RF-COMLINK")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_name = args.name or f"{source.stem}-{timestamp}"
    if Path(run_name).name != run_name or run_name in {".", ".."}:
        raise WorkflowError("--name doit etre un nom simple, sans chemin.")
    output_root = absolute_path(args.output_root)
    run_dir = output_root / run_name
    latest_run_path = output_root / "DERNIER-RUN.txt"
    if run_dir.exists():
        raise WorkflowError(
            f"Le dossier du run existe deja : {run_dir}. Choisissez un autre --name."
        )

    inputs_dir = run_dir / "00-entrees"
    conversion_dir = run_dir / "01-conversion"
    simucic_dir_output = run_dir / "02-simu-cic"
    opalis_output = run_dir / "03-opalis"
    rfcomlink_output = run_dir / "04-rf-comlink"
    source_copy = inputs_dir / "ephemeride-source" / source.name
    conversion_output = conversion_dir / f"{source.stem}_SIMU.txt"
    simucic_results = simucic_dir_output / "01-execution-complete"
    cic_output = simucic_dir_output / "02-fichiers-cic"
    manifest_path = run_dir / "workflow.json"
    guide_path = run_dir / "LISEZ-MOI.txt"
    run_dir.mkdir(parents=True)

    source_copy.parent.mkdir(parents=True)
    shutil.copy2(source, source_copy)

    manifest: dict[str, Any] = {
        "name": run_name,
        "status": "running",
        "started_at": utc_now(),
        "input": str(source),
        "input_copy": str(source_copy),
        "inputs_dir": str(inputs_dir),
        "simulation_source": str(simulation),
        "run_dir": str(run_dir),
        "steps": {},
    }
    write_manifest(manifest_path, manifest)
    write_run_guide(guide_path, manifest)
    write_latest_run(latest_run_path, run_dir, manifest)

    try:
        print("\n[1/4] Conversion vers SIMU-CIC", flush=True)
        manifest["steps"]["conversion"] = convert_to_simucic(source_copy, conversion_output)
        write_manifest(manifest_path, manifest)
        write_run_guide(guide_path, manifest)
        write_latest_run(latest_run_path, run_dir, manifest)

        print("\n[2/4] Simulation Simu-CIC", flush=True)
        simucic_command = [
            str(python),
            str(SIMUCIC_RUNNER),
            "--ephemeris",
            str(conversion_output),
            "--base-scenario",
            str(base_scenario),
            "--simucic-dir",
            str(simucic_dir),
            "--save-root",
            str(simucic_results),
            "--cic-output",
            str(cic_output),
            "--nadir-axis",
            args.nadir_axis,
            "--trace-axis",
            args.trace_axis,
        ]
        if args.scilab:
            simucic_command.extend(["--scilab", str(absolute_path(args.scilab))])
        run_command(simucic_command, SIMUCIC_DIR)
        cic_sat = require_dir(cic_output / "Sat", "Dossier CIC/Sat genere")
        cic_files = sorted(cic_sat.glob("*.TXT"))
        if not cic_files:
            raise WorkflowError(f"Aucun fichier CIC genere dans : {cic_sat}")
        scenario_scd_files = sorted(simucic_results.glob("run_*.scd"))
        scenario_sod_files = sorted(simucic_results.glob("run_*.sod"))
        if not scenario_scd_files or not scenario_sod_files:
            raise WorkflowError(
                f"Scenarios .scd/.sod non generes dans : {simucic_results}"
            )
        scenario_scd = scenario_scd_files[-1]
        scenario_sod = scenario_sod_files[-1]
        manifest["steps"]["simu_cic"] = {
            "ephemeris": str(conversion_output),
            "scenario_scd": str(scenario_scd),
            "scenario_sod": str(scenario_sod),
            "cic_dir": str(cic_sat),
            "files": len(cic_files),
        }
        write_manifest(manifest_path, manifest)
        write_run_guide(guide_path, manifest)
        write_latest_run(latest_run_path, run_dir, manifest)

        opalis_action = "Preparation OPALIS" if args.no_opalis_run else "Calcul OPALIS"
        print(f"\n[3/4] {opalis_action}", flush=True)
        opalis_command = [
            str(python),
            str(OPALIS_RUNNER),
            str(simulation),
            "--ephemeris-dir",
            str(cic_sat),
            "--opalis-dir",
            str(opalis_dir),
            "--output-dir",
            str(opalis_output),
            "--name",
            run_name,
        ]
        if parameters_file:
            opalis_command.extend(["--parameters-file", str(parameters_file)])
        for section in args.section:
            opalis_command.extend(["--section", str(section)])
        if args.sections_count is not None:
            opalis_command.extend(["--sections-count", str(args.sections_count)])
        for setting in args.settings:
            opalis_command.extend(["--set", setting])
        if args.no_opalis_run:
            opalis_command.append("--no-run")
        run_command(opalis_command, OPALIS_RUNNER_DIR)

        opalis_results = opalis_output / "02-resultats"
        opalis_reference = opalis_output / "00-cas-reference" / simulation.name
        opalis_case = require_file(opalis_results / f"{run_name}.opalis", "Cas OPALIS genere")
        opalis_json = require_file(opalis_results / f"{run_name}.json", "Resume OPALIS")
        quality_warnings = opalis_quality_warnings(opalis_json) if not args.no_opalis_run else []
        manifest["steps"]["opalis"] = {
            "cic_input": str(cic_sat),
            "simulation_source": str(simulation),
            "simulation_working_copy": str(opalis_reference),
            "case": str(opalis_case),
            "summary": str(opalis_json),
            "simulation_executed": not args.no_opalis_run,
            "quality_warnings": quality_warnings,
        }
        if quality_warnings:
            manifest["warnings"] = quality_warnings
        if not args.no_rf_comlink:
            print("\n[4/4] Preparation RF-COMLINK", flush=True)
            rfcomlink_command = [
                str(python),
                str(RFCOMLINK_RUNNER),
                "--cic-dir", str(cic_sat),
                "--template", str(absolute_path(args.rfcomlink_template)),
                "--output-dir", str(rfcomlink_output),
                "--name", run_name,
                "--station", str(args.rfcomlink_station),
                "--links", *args.rfcomlink_links,
            ]
            run_command(rfcomlink_command, RFCOMLINK_RUNNER_DIR)
            rfcomlink_case = require_file(
                rfcomlink_output / run_name / f"{run_name}.rfcl",
                "Cas RF-COMLINK genere",
            )
            rfcomlink_json = require_file(
                rfcomlink_output / run_name / "workflow.json",
                "Resume RF-COMLINK",
            )
            manifest["steps"]["rf_comlink"] = {
                "cic_input": str(cic_sat),
                "template": str(absolute_path(args.rfcomlink_template)),
                "case": str(rfcomlink_case),
                "summary": str(rfcomlink_json),
                "calculation_executed": False,
                "next_step": "Open the generated .rfcl in RF-COMLINK and run the calculation from its GUI.",
            }
        manifest["status"] = "success"
        manifest["finished_at"] = utc_now()
        write_manifest(manifest_path, manifest)
        write_run_guide(guide_path, manifest)
        write_latest_run(latest_run_path, run_dir, manifest)
    except Exception as exc:
        manifest["status"] = "failed"
        manifest["finished_at"] = utc_now()
        manifest["error"] = str(exc)
        write_manifest(manifest_path, manifest)
        write_run_guide(guide_path, manifest)
        write_latest_run(latest_run_path, run_dir, manifest)
        if isinstance(exc, WorkflowError):
            raise
        raise WorkflowError(str(exc)) from exc

    print("\nWorkflow termine avec succes.")
    print(f"Dossier du run : {run_dir}")
    print(f"Manifeste      : {manifest_path}")
    print(f"Guide du run   : {guide_path}")
    for warning in manifest.get("warnings", []):
        print(f"Avertissement  : {warning}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except WorkflowError as exc:
        print(f"Erreur workflow : {exc}", file=sys.stderr)
        raise SystemExit(1)
