#!/usr/bin/env python3
"""Pipeline automatique OPALIS.

Ce script prend un cas .opalis de reference, un dossier d'ephemerides, genere
les flux attendus par OPALIS, applique des modifications utilisateur, lance le
calcul, puis sauvegarde les resultats.
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import shutil
import statistics
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import opalis_python as opalis


SCRIPT_DIR = Path(__file__).resolve().parent
APPS_DIR = SCRIPT_DIR.parent.parent
INSTALLED_OPALIS_DIR = APPS_DIR / "OPALIS" / "Opalis-2.3.0"
DEFAULT_OPALIS_DIR = (
    INSTALLED_OPALIS_DIR if INSTALLED_OPALIS_DIR.is_dir() else opalis.DEFAULT_OPALIS_DIR
)
# Le pipeline part toujours d'un cas neutre. Les proprietes physiques sont
# ensuite injectees depuis le manifeste cree par le backend, jamais depuis un
# ancien cas OPALIS de reference.
DEFAULT_SIMULATION = SCRIPT_DIR / "templates" / "empty.opalis"
TIMESTEP_PATH = "SimulationModel.SimulationTiming.Timestep"
DURATION_PATH = "SimulationModel.SimulationTiming.Simultime"
INTERPOLATION_PATH = "SimulationModel.InterpolateEphemeris"


SHARED_EPHEMERIS_FILES = {
    "eclipse": "Sat_SATELLITE_ECLIPSE.TXT",
    "moon_eclipse": "Sat_SATELLITE_ECLIPSE_MOON.TXT",
    "altitude": "Sat_SATELLITE_ALTITUDE.TXT",
    "earth_direction": "Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT",
    "coordinates": "Sat_GEOGRAPHICAL_COORDINATES.TXT",
}

SUN_DIRECTION_CANDIDATES = [
    "Sat_SUN_DIRECTION-SATELLITE_FRAME.TXT",
    "Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT",
]


SECTION_DEFAULTS = {
    "TemperatureFront": "20",
    "TemperatureRear": "20",
    "Activation": "true",
    "NTsection": "0",
    "AlphaFront": "0.9",
    "AlphaRear": "0.3",
    "EpsilonFront": "0.9",
    "EpsilonRear": "0.9",
    "HeatCapacity": "1000",
    "TemperatureDay": "0",
    "TemperatureNight": "0",
    "Conductivity": "50",
    "Vdiode": "0.5",
    "KefficiencySA0": "0",
    "KefficiencySA1": "0.95",
    "KefficiencyMax": "0.96",
    "Rls": "0.05",
    "TypeRegulatorLeftDomain": "Boost",
    "TypeRegulatorRightDomain": "Buck",
    "FlowFile": "",
    "TemperaturesFile": "",
}

SOLAR_CELL_DEFAULTS = {
    "Tref": "78",
    "Ki10": "0.5089967090604",
    "Discsa": "0.000304135575876",
    "Ki2": "-7.5E-13",
    "Ki3": "11.4",
    "Kvt": "-0.006",
    "VpMaxSa0": "2.1",
}

DISTRIBUTION_DEFAULTS = {
    "KEfficiency0": "0",
    "KEfficiencyMax": "1",
    "KEfficiency1": "1",
    "ConsumptionFile": "",
}


def abs_path(value: str | Path, base: Path | None = None) -> Path:
    return opalis.absolute_path(value, base)


def require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise opalis.OpalisPythonError(f"Fichier {label} introuvable : {path}")
    return path


def parameter_text(value: Any) -> str:
    """Serialise une valeur du manifeste au format attendu par OPALIS/.NET."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def load_parameters_file(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Lit le contrat backend -> OPALIS et refuse un manifeste incomplet."""
    require_file(path, "manifeste OPALIS")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise opalis.OpalisPythonError(
            f"Manifeste OPALIS JSON invalide : {path}"
        ) from exc
    if payload.get("schema_version") != 1 or not isinstance(payload.get("parameters"), list):
        raise opalis.OpalisPythonError(
            "Manifeste OPALIS invalide : schema_version=1 et parameters sont requis."
        )
    validation = payload.get("validation") or {}
    missing = validation.get("missing") or []
    if missing:
        raise opalis.OpalisPythonError(
            "Le satellite.json ne definit pas encore les parametres OPALIS requis : "
            + ", ".join(map(str, missing))
        )
    parameters: dict[str, Any] = {}
    for item in payload["parameters"]:
        if not isinstance(item, dict) or not item.get("opalis_path"):
            raise opalis.OpalisPythonError("Entree parameters OPALIS invalide.")
        parameters[str(item["opalis_path"])] = item.get("value")
    return parameters, payload


def parameter_value(parameters: dict[str, Any], path: str, default: Any = None) -> Any:
    value = parameters.get(path, default)
    return default if value is None else value


def append_text(parent: ElementTree.Element, tag: str, value: Any) -> None:
    ElementTree.SubElement(parent, tag).text = parameter_text(value)


def new_solar_section(index: int, parameters: dict[str, Any]) -> ElementTree.Element:
    prefix = f"SimulationModel.SolarGenerator.Sections[{index}]"
    section = ElementTree.Element("SolarGeneratorSection", {"Key": f"sgsection.{index}"})
    values = dict(SECTION_DEFAULTS)
    for tag in ("Type", "SectionArea", "AnchorType", "FillingFactor", "NPsection", "NSsection", "PdimSA"):
        value = parameter_value(parameters, f"{prefix}.{tag}")
        if value is None:
            raise opalis.OpalisPythonError(f"Parametre solaire OPALIS manquant : {prefix}.{tag}")
        values[tag] = value
    for tag in (
        "TemperatureFront", "TemperatureRear", "Activation", "Type", "AnchorType",
        "SectionArea", "FillingFactor", "NTsection", "NPsection", "NSsection",
        "AlphaFront", "AlphaRear", "EpsilonFront", "EpsilonRear", "HeatCapacity",
        "TemperatureDay", "TemperatureNight", "Conductivity", "Vdiode", "PdimSA",
        "KefficiencySA0", "KefficiencySA1", "KefficiencyMax", "Rls",
        "TypeRegulatorLeftDomain", "TypeRegulatorRightDomain", "FlowFile", "TemperaturesFile",
    ):
        append_text(section, tag, values[tag])
    cell = ElementTree.SubElement(section, "SolarCell", {"Key": "db_sgcell.0"})
    append_text(cell, "Name", parameter_value(parameters, f"{prefix}.Cell.Name", "default"))
    for tag, value in SOLAR_CELL_DEFAULTS.items():
        append_text(cell, tag, value)
    append_text(cell, "AreaCell", parameter_value(parameters, f"{prefix}.Cell.AreaCell"))
    return section


def bootstrap_empty_simulation(
    simulation_path: Path, parameters: dict[str, Any]
) -> int | None:
    """Ajoute a empty.opalis ses sections et sa ligne de distribution.

    OPALIS fournit ``empty.opalis`` sans collections. Elles doivent exister
    avant de pouvoir leur affecter les proprietes du satellite via son API.
    La fonction modifie uniquement la copie de travail de la run.
    """
    section_indexes = sorted(
        {
            int(path.split("Sections[", 1)[1].split("]", 1)[0])
            for path in parameters
            if path.startswith("SimulationModel.SolarGenerator.Sections[")
        }
    )
    if not section_indexes:
        return None
    if section_indexes != list(range(len(section_indexes))):
        raise opalis.OpalisPythonError(
            "Les sections solaires OPALIS doivent etre indexees consecutivement a partir de 0."
        )

    try:
        with zipfile.ZipFile(simulation_path, "r") as archive:
            entries = {entry.filename: archive.read(entry.filename) for entry in archive.infolist()}
        root = ElementTree.fromstring(entries["simulation.xml"])
    except (KeyError, OSError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
        raise opalis.OpalisPythonError(
            f"Impossible de preparer le cas OPALIS vide : {simulation_path}"
        ) from exc

    solar_generator = root.find("SolarGenerator")
    distribution_lines = root.find("DistributionLines")
    if solar_generator is None or distribution_lines is None:
        raise opalis.OpalisPythonError("Le cas OPALIS vide ne contient pas le schema attendu.")

    # empty.opalis contient deux balises XML ``Sections`` pour des raisons de
    # serialisation interne. L'API les fusionne a l'ouverture : les remplir
    # toutes les deux dupliquerait donc chaque panneau solaire. Seul le premier
    # conteneur est l'entree de construction; l'API ecrira ensuite sa forme
    # normalisee lors du Save().
    section_containers = solar_generator.findall("Sections")
    if not section_containers:
        raise opalis.OpalisPythonError("Le cas OPALIS vide ne contient aucune collection de sections solaires.")
    for container in section_containers:
        for child in list(container):
            container.remove(child)
    for index in section_indexes:
        section_containers[0].append(new_solar_section(index, parameters))

    for child in list(distribution_lines):
        distribution_lines.remove(child)
    line = ElementTree.SubElement(distribution_lines, "DistributionLine", {"Key": "dline.0"})
    distribution_values = dict(DISTRIBUTION_DEFAULTS)
    for tag in ("Pdim", "PowerConsumptionMode", "PConstant", "PMargin"):
        value = parameter_value(parameters, f"SimulationModel.DistributionLines[0].{tag}")
        if value is None:
            raise opalis.OpalisPythonError(f"Parametre de distribution OPALIS manquant : {tag}")
        distribution_values[tag] = value
    for tag in (
        "Pdim", "KEfficiency0", "KEfficiencyMax", "KEfficiency1",
        "PowerConsumptionMode", "PConstant", "PMargin", "ConsumptionFile",
    ):
        append_text(line, tag, distribution_values[tag])

    entries["simulation.xml"] = ElementTree.tostring(
        root, encoding="utf-8", xml_declaration=True
    )
    temporary_path = simulation_path.with_suffix(".bootstrap.tmp")
    with zipfile.ZipFile(temporary_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for filename, content in entries.items():
            archive.writestr(filename, content)
    temporary_path.replace(simulation_path)
    return len(section_indexes)


def ephemeris_time_grid(path: Path) -> dict[str, float | int | str]:
    """Lit la grille CIC (MJD, secondes UTC) d'un fichier dynamique."""
    timestamps: list[float] = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line in handle:
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                mjd = float(parts[0])
                seconds = float(parts[1])
            except ValueError:
                continue
            if not 30000 <= mjd <= 100000 or not -1 <= seconds <= 172800:
                continue
            timestamps.append(mjd * 86400.0 + seconds)

    timestamps = sorted(set(timestamps))
    if len(timestamps) < 2:
        raise opalis.OpalisPythonError(
            f"Grille temporelle insuffisante dans le fichier : {path}"
        )
    deltas = [
        current - previous
        for previous, current in zip(timestamps, timestamps[1:])
        if current - previous > 1e-6
    ]
    if not deltas:
        raise opalis.OpalisPythonError(f"Pas temporel indetectable dans : {path}")
    return {
        "file": str(path),
        "samples": len(timestamps),
        "start": timestamps[0],
        "stop": timestamps[-1],
        "duration_seconds": timestamps[-1] - timestamps[0],
        "step_seconds": float(statistics.median(deltas)),
        "minimum_step_seconds": min(deltas),
        "maximum_step_seconds": max(deltas),
    }


def read_cic_values_from_text(content: str, minimum_values: int = 1) -> list[tuple[float, list[float]]]:
    """Lit les lignes numeriques CIC sous forme temps absolu + valeurs."""
    rows: list[tuple[float, list[float]]] = []
    for line in content.splitlines():
        parts = line.split()
        if len(parts) < 2 + minimum_values:
            continue
        try:
            mjd = float(parts[0])
            seconds = float(parts[1])
            values = [float(value) for value in parts[2:]]
        except ValueError:
            continue
        if 30000 <= mjd <= 100000 and -1 <= seconds <= 172800:
            rows.append((mjd * 86400.0 + seconds, values))
    return sorted(rows, key=lambda row: row[0])


def read_cic_values(path: Path, minimum_values: int = 1) -> list[tuple[float, list[float]]]:
    return read_cic_values_from_text(
        path.read_text(encoding="utf-8-sig"), minimum_values=minimum_values
    )


def embedded_ephemeris_text(simulation_file: Path, internal_filename: str) -> str:
    """Extrait un fichier dynamique embarque dans l'archive .opalis."""
    member = f"ephemeris/{internal_filename}"
    try:
        with zipfile.ZipFile(simulation_file) as archive:
            return archive.read(member).decode("utf-8-sig")
    except (KeyError, OSError, zipfile.BadZipFile) as exc:
        raise opalis.OpalisPythonError(
            f"Profil dynamique embarque introuvable dans {simulation_file} : {member}"
        ) from exc


def write_rebased_power_profile(
    source_rows: list[tuple[float, list[float]]],
    target_times: list[float],
    destination: Path,
) -> dict[str, Any]:
    """Recale cycliquement la consommation du cas A sur la nouvelle grille."""
    if len(source_rows) < 2 or len(target_times) < 2:
        raise opalis.OpalisPythonError("Profil de consommation ou grille cible insuffisant.")
    source_times = [row[0] for row in source_rows]
    source_values = [row[1][0] for row in source_rows]
    source_relative = [value - source_times[0] for value in source_times]
    source_steps = [
        current - previous
        for previous, current in zip(source_times, source_times[1:])
        if current > previous
    ]
    source_step = float(statistics.median(source_steps))
    cycle_seconds = source_relative[-1] + source_step

    target_start = target_times[0]
    target_stop = target_times[-1]
    target_duration = target_stop - target_start
    dense_target_times = [
        target_start + index * source_step
        for index in range(math.floor(target_duration / source_step) + 1)
    ]
    if target_stop - dense_target_times[-1] > 1e-6:
        dense_target_times.append(target_stop)

    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "CIC_MEM_VERS = 1.0",
        "COMMENT Rebased automatically by workflow_OPALIS",
        f"CREATION_DATE = {datetime.now(timezone.utc).isoformat(timespec='microseconds')}",
        "ORIGINATOR = CNES",
        "",
        "META_START",
        "",
        "USER_DEFINED_PROTOCOL = CIC",
        "USER_DEFINED_CONTENT = SATELLITE_CONSUMED_POWER",
        "TIME_SYSTEM = UTC",
        "",
        "META_STOP",
        "",
    ]
    for timestamp in dense_target_times:
        phase = (timestamp - target_start) % cycle_seconds
        source_index = max(0, bisect.bisect_right(source_relative, phase) - 1)
        mjd_day = math.floor(timestamp / 86400.0)
        seconds = timestamp - mjd_day * 86400.0
        lines.append(f"{mjd_day}\t{seconds:.6f}\t{source_values[source_index]:.9f}")
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "output": str(destination),
        "source_rows": len(source_rows),
        "target_rows": len(dense_target_times),
        "source_step_seconds": source_step,
        "source_cycle_seconds": cycle_seconds,
        "strategy": "cyclic_rebase_on_new_ephemeris_grid",
    }


def automatic_timing(flux_files: list[Path]) -> dict[str, Any]:
    """Calcule un pas sans sous-division et la plage commune des flux OPALIS."""
    grids = [ephemeris_time_grid(path) for path in flux_files]
    common_start = max(float(grid["start"]) for grid in grids)
    common_stop = min(float(grid["stop"]) for grid in grids)
    duration = common_stop - common_start
    if duration <= 0:
        raise opalis.OpalisPythonError(
            "Les fichiers de flux ne possedent aucune plage temporelle commune."
        )

    # D'apres la documentation OPALIS, un pas inferieur au pas d'une
    # ephemeride subdivise la boucle. Le plus grand pas nominal evite donc les
    # sous-pas inutiles; un fichier plus fin conserve sa propre cadence.
    step = max(float(grid["step_seconds"]) for grid in grids)
    # Neutralise les petites erreurs flottantes MJD (ex. 35999.9999904 s).
    duration = round(duration / step) * step
    return {
        "time_step_seconds": step,
        "duration_seconds": duration,
        "common_start": common_start,
        "common_stop": common_stop,
        "files": grids,
    }


def section_input_files(
    ephemeris_dir: Path, section_index: int
) -> tuple[dict[str, Path | None], int]:
    """Retourne les entrees d'une section, avec repli documente sur SA_1."""
    section_number = section_index + 1
    angle_source_section = section_number
    sun_angle = ephemeris_dir / f"Sat_SUN_ANGLE_SA_{section_number}.TXT"
    earth_angle = ephemeris_dir / f"Sat_EARTH_ANGLE_SA_{section_number}.TXT"
    if not sun_angle.is_file() or not earth_angle.is_file():
        angle_source_section = 1
        sun_angle = ephemeris_dir / "Sat_SUN_ANGLE_SA_1.TXT"
        earth_angle = ephemeris_dir / "Sat_EARTH_ANGLE_SA_1.TXT"

    files: dict[str, Path | None] = {
        "sun_angle": sun_angle,
        "earth_angle": earth_angle,
    }
    for key, filename in SHARED_EPHEMERIS_FILES.items():
        files[key] = ephemeris_dir / filename

    sun_direction = None
    for filename in SUN_DIRECTION_CANDIDATES:
        candidate = ephemeris_dir / filename
        if candidate.is_file():
            sun_direction = candidate
            break
    files["sun_direction"] = sun_direction

    required = [
        "sun_angle",
        "eclipse",
        "earth_angle",
        "altitude",
        "earth_direction",
        "sun_direction",
        "coordinates",
    ]
    for key in required:
        require_file(files[key], key)  # type: ignore[arg-type]
    if files["moon_eclipse"] is not None and not files["moon_eclipse"].is_file():
        files["moon_eclipse"] = None
    return files, angle_source_section


def generate_flux_file(
    opalis_dir: Path,
    ephemeris_dir: Path,
    output_dir: Path,
    section_index: int,
) -> tuple[Path, dict[str, Any]]:
    flow_transformation, holder_factory, file_types = opalis.load_flows_manager_api(opalis_dir)
    files, angle_source_section = section_input_files(ephemeris_dir, section_index)

    specs = [
        ("sun_angle", "SunAngle", "Sun angle"),
        ("eclipse", "Eclipse", "Satellite eclipse"),
        ("earth_angle", "EarthAngle", "Earth angle"),
        ("altitude", "Altitude", "Satellite altitude"),
        ("earth_direction", "Position", "Earth direction"),
        ("sun_direction", "SunDirection", "Sun direction"),
        ("coordinates", "Coordinates", "Coordinates"),
    ]
    holders: dict[str, Any] = {}
    for key, enum_name, label in specs:
        holders[key] = opalis.create_flows_input_holder(
            files[key], getattr(file_types, enum_name), holder_factory, label
        )

    moon_holder = None
    if files["moon_eclipse"] is not None:
        moon_holder = opalis.create_flows_input_holder(
            files["moon_eclipse"],
            file_types.MoonEclipse,
            holder_factory,
            "Satellite moon eclipse",
        )

    flux_file = output_dir / f"FLOWS-SA-{section_index + 1}.TXT"
    flow_transformation.GenerateFlowsFile(
        holders["sun_angle"],
        holders["eclipse"],
        moon_holder,
        holders["earth_angle"],
        holders["altitude"],
        holders["earth_direction"],
        holders["sun_direction"],
        holders["coordinates"],
        str(flux_file),
    )
    require_file(flux_file, "flux genere")
    mapping: dict[str, Any] = {
        key: str(value) if value is not None else None for key, value in files.items()
    }
    mapping["target_section"] = section_index + 1
    mapping["angle_source_section"] = angle_source_section
    mapping["reused_sa_1_geometry"] = angle_source_section != section_index + 1
    return flux_file, mapping


def resize_sections(simulation: Any, target_count: int) -> tuple[int, int]:
    sections = opalis.get_property(simulation, "SimulationModel.SolarGenerator.Sections")
    initial_count = int(sections.Count)
    if target_count <= 0:
        raise opalis.OpalisPythonError("Le nombre de sections doit etre strictement positif.")
    if target_count > initial_count:
        raise opalis.OpalisPythonError(
            "Le pipeline sait reduire le nombre de sections, mais pas encore en creer "
            f"({initial_count} actuellement, {target_count} demandees)."
        )
    while int(sections.Count) > target_count:
        sections.RemoveAt(int(sections.Count) - 1)
    return initial_count, int(sections.Count)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Executer automatiquement une chaine OPALIS depuis des ephemerides."
    )
    parser.add_argument(
        "simulation",
        nargs="?",
        default=str(DEFAULT_SIMULATION),
        help=f"cas .opalis vide a preparer; defaut : {DEFAULT_SIMULATION}",
    )
    parser.add_argument(
        "--ephemeris-dir",
        required=True,
        help="dossier contenant les fichiers Sat_*.TXT",
    )
    parser.add_argument(
        "--parameters-file",
        help=(
            "opalis-parameters.json produit par le backend depuis satellite.json; "
            "il initialise les proprietes statiques et les sections de empty.opalis"
        ),
    )
    parser.add_argument(
        "--opalis-dir",
        default=str(DEFAULT_OPALIS_DIR),
        help=f"dossier OPALIS, defaut : {DEFAULT_OPALIS_DIR}",
    )
    parser.add_argument(
        "--output-dir",
        default="resultats/pipeline",
        help="dossier de sortie pour le .opalis, les flux et le JSON",
    )
    parser.add_argument(
        "--name",
        default="opalis-run",
        help="prefixe des fichiers de sortie",
    )
    parser.add_argument(
        "--section",
        action="append",
        type=int,
        default=[],
        help=(
            "section solaire OPALIS a alimenter, index 0; option repetable. "
            "Sans cette option, toutes les sections sont alimentees."
        ),
    )
    parser.add_argument(
        "--sections-count",
        type=int,
        help="nombre final de sections solaires a conserver avant calcul",
    )
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="CHEMIN=VALEUR",
        help="parametre OPALIS a modifier; option repetable",
    )
    parser.add_argument(
        "--time-step",
        type=float,
        help="pas OPALIS force en secondes; sinon detection automatique des flux",
    )
    parser.add_argument(
        "--no-auto-time-step",
        action="store_true",
        help="conserver le pas du cas A (sauf si --time-step est fourni)",
    )
    parser.add_argument(
        "--no-auto-duration",
        action="store_true",
        help="conserver la duree du cas A au lieu de la plage commune des flux",
    )
    parser.add_argument(
        "--no-run",
        action="store_true",
        help="preparer et sauvegarder le cas sans lancer le calcul",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    invocation_dir = Path.cwd()
    opalis_dir = abs_path(args.opalis_dir, invocation_dir)
    source = abs_path(args.simulation, invocation_dir)
    ephemeris_dir = abs_path(args.ephemeris_dir, invocation_dir)
    output_dir = abs_path(args.output_dir, invocation_dir)
    manifest_parameters: dict[str, Any] = {}
    manifest_payload: dict[str, Any] | None = None
    parameters_path: Path | None = None
    if args.parameters_file:
        parameters_path = abs_path(args.parameters_file, invocation_dir)
        manifest_parameters, manifest_payload = load_parameters_file(parameters_path)
        template = manifest_payload.get("template")
        if template != "empty.opalis":
            raise opalis.OpalisPythonError(
                "Le manifeste OPALIS doit referencer empty.opalis; "
                f"template recu : {template!r}"
            )
    reference_dir = output_dir / "00-cas-reference"
    flux_dir = output_dir / "01-flux-dynamiques"
    results_dir = output_dir / "02-resultats"
    for directory in (reference_dir, flux_dir, results_dir):
        directory.mkdir(parents=True, exist_ok=True)

    simulation_type, helper_type = opalis.load_opalis_api(opalis_dir)
    working_source = reference_dir / source.name
    if source != working_source:
        shutil.copy2(source, working_source)
    bootstrap_sections = bootstrap_empty_simulation(working_source, manifest_parameters)
    simulation = opalis.open_simulation(working_source, simulation_type)

    # Le bouton « Interpolation » du GUI correspond à cette propriété. Quand
    # elle est vraie, OPALIS effectue pendant le calcul une interpolation
    # linéaire des valeurs d'éphéméride manquantes (hors consommation).
    _, interpolation_value = opalis.set_property(
        simulation, f"{INTERPOLATION_PATH}=true"
    )

    applied_parameters = []
    if manifest_parameters:
        # Le manifeste est la source de verite des proprietes statiques. Les
        # sections ont deja ete creees dans le zip avant Open(), elles peuvent
        # donc deja contenir leurs valeurs. OPALIS 2.4 rehydrate ses sections
        # lorsqu'une propriete de section est reaffectee par son API, ce qui
        # ajoute une copie du panneau. Les sections sont ainsi seulement
        # construites dans bootstrap_empty_simulation(), puis ne sont plus
        # reaffectees ici.
        for path, value in manifest_parameters.items():
            if path.startswith("SimulationModel.SolarGenerator.Sections["):
                applied_parameters.append(
                    {"path": path, "value": value, "source": f"{parameters_path} (bootstrap)"}
                )
                continue
            _, applied_value = opalis.set_property(
                simulation, f"{path}={parameter_text(value)}"
            )
            applied_parameters.append(
                {
                    "path": path,
                    "value": opalis.json_value(applied_value),
                    "source": str(parameters_path),
                }
            )

    resize_summary = None
    if args.sections_count is not None:
        initial_count, final_count = resize_sections(simulation, args.sections_count)
        resize_summary = {
            "initial_solar_sections": initial_count,
            "solar_sections": final_count,
        }

    section_count = int(opalis.get_property(simulation, "SimulationModel.SolarGenerator.Sections.Count"))
    sections_to_apply = args.section or list(range(section_count))
    if any(section < 0 for section in sections_to_apply):
        raise opalis.OpalisPythonError("Les index de section doivent etre positifs.")
    generated_fluxes = []
    generated_flux_paths: list[Path] = []
    ephemeris_mapping = {}
    reference_time_step = float(opalis.get_property(simulation, TIMESTEP_PATH))
    reference_duration = float(str(opalis.get_property(simulation, DURATION_PATH)))

    # LoadFlowsFile fusionne avec RawEphemeris au lieu de remplacer les dates
    # existantes. Le cas A contient ses propres profils historiques; ils
    # doivent etre retires avant de charger les nouvelles ephemerides CIC.
    raw_ephemeris = opalis.get_property(simulation, "SimulationModel.RawEphemeris")
    previous_ephemeris_rows = int(raw_ephemeris.List.Count)
    raw_ephemeris.Clear()

    for section_index in sections_to_apply:
        if section_index >= section_count:
            raise opalis.OpalisPythonError(
                f"Section {section_index} inexistante : le cas contient {section_count} section(s)."
            )
        flux_file, mapping = generate_flux_file(
            opalis_dir, ephemeris_dir, flux_dir, section_index
        )
        simulation.LoadFlowsFile(str(flux_file), section_index)
        generated_fluxes.append(
            {
                "section_index": section_index,
                "section_number": section_index + 1,
                "flux_file": str(flux_file),
                "angle_source_section": mapping["angle_source_section"],
                "reused_sa_1_geometry": mapping["reused_sa_1_geometry"],
            }
        )
        generated_flux_paths.append(flux_file)
        ephemeris_mapping[str(section_index)] = mapping

    target_rows = read_cic_values(generated_flux_paths[0], minimum_values=6)
    target_times = [row[0] for row in target_rows]
    rebased_power_profiles = []
    distribution_lines = opalis.get_property(
        simulation, "SimulationModel.DistributionLines"
    )
    for distribution_index, distribution_key in enumerate(distribution_lines.Keys):
        distribution = distribution_lines[distribution_key]
        if str(distribution.PowerConsumptionMode).lower() != "profile":
            continue
        holder = distribution.ConsumptionFile
        internal_filename = str(holder.InternalFileName or "")
        if not internal_filename:
            # Les valeurs du premier onglet sont conservees telles quelles.
            # Un profil de consommation est un fichier dynamique distinct :
            # il sera fourni lors de l'etape de calcul, pas copie depuis un
            # cas exemple dans ce scenario prepare depuis empty.opalis.
            rebased_power_profiles.append(
                {
                    "distribution_index": distribution_index,
                    "distribution_key": str(distribution_key),
                    "status": "profile_not_loaded",
                    "reason": "empty.opalis has no embedded consumption profile",
                }
            )
            continue
        source_power_rows = read_cic_values_from_text(
            embedded_ephemeris_text(working_source, internal_filename)
        )
        power_output = flux_dir / f"POWER-DISTRIBUTION-{distribution_index + 1}.TXT"
        power_summary = write_rebased_power_profile(
            source_power_rows, target_times, power_output
        )
        holder.Load(str(power_output), True)
        if not holder.IsValid:
            raise opalis.OpalisPythonError(
                f"Profil de consommation recale invalide : {power_output}"
            )
        simulation.LoadPowerFile(distribution_index)
        power_summary.update(
            {
                "distribution_index": distribution_index,
                "distribution_key": str(distribution_key),
                "original_file": str(holder.OriginalFileName),
            }
        )
        rebased_power_profiles.append(power_summary)

    applied_parameters.insert(
        0,
        {
            "path": INTERPOLATION_PATH,
            "value": opalis.json_value(interpolation_value),
            "source": "workflow",
        },
    )
    timing = automatic_timing(generated_flux_paths)
    loaded_power_profiles = [
        profile for profile in rebased_power_profiles
        if "source_step_seconds" in profile
    ]
    if loaded_power_profiles:
        power_step = min(
            float(profile["source_step_seconds"])
            for profile in loaded_power_profiles
        )
        timing["flow_step_seconds"] = timing["time_step_seconds"]
        timing["power_step_seconds"] = power_step
        timing["time_step_seconds"] = min(
            float(timing["time_step_seconds"]), power_step
        )
    if args.time_step is not None:
        if args.time_step <= 0:
            raise opalis.OpalisPythonError("--time-step doit etre strictement positif.")
        automatic_step = args.time_step
        step_source = "--time-step"
    elif args.no_auto_time_step:
        automatic_step = None
        step_source = "cas de reference"
    else:
        # Le pas du cas A est aussi le pas d'integration du modele thermique.
        # L'augmenter rend le calcul instable (-300/+300 degC observes a 10 s).
        # On le conserve donc, sauf si une entree dynamique demande plus fin.
        automatic_step = min(
            reference_time_step, float(timing["time_step_seconds"])
        )
        step_source = "minimum(cas de reference, ephemerides)"

    if automatic_step is not None:
        _, value = opalis.set_property(
            simulation, f"{TIMESTEP_PATH}={automatic_step:.15g}"
        )
        applied_parameters.append(
            {"path": TIMESTEP_PATH, "value": opalis.json_value(value), "source": step_source}
        )
    if not args.no_auto_duration:
        # Ne remplace pas un parametre statique du cas A si les nouvelles
        # entrees couvrent deja sa duree. Reduit seulement si elles sont plus
        # courtes afin d'eviter un arret Input flow.
        duration = (
            min(reference_duration, float(timing["duration_seconds"]))
            if reference_duration > 0
            else float(timing["duration_seconds"])
        )
        _, value = opalis.set_property(
            simulation, f"{DURATION_PATH}={duration:.15g}"
        )
        applied_parameters.append(
            {"path": DURATION_PATH, "value": opalis.json_value(value), "source": "ephemerides"}
        )

    for assignment in args.set:
        path, value = opalis.set_property(simulation, assignment)
        applied_parameters.append(
            {"path": path, "value": opalis.json_value(value), "source": "--set"}
        )

    final_step = opalis.optional_property(simulation, TIMESTEP_PATH)
    final_duration = opalis.optional_property(simulation, DURATION_PATH)
    print(
        "Synchronisation temporelle OPALIS : "
        f"pas={final_step} s, duree={final_duration} s "
        f"(cas A: pas={reference_time_step} s, duree={reference_duration} s; "
        f"cadence dynamique={timing['time_step_seconds']} s)"
    )

    if args.no_run:
        summary = opalis.model_summary(simulation, source)
    else:
        initial_soc = opalis.get_property(
            simulation, "SimulationModel.SimulationInitialisation.SocBattery"
        )
        helper_type().LaunchSimulation(simulation, True)
        summary = opalis.result_summary(simulation, source, initial_soc)

    case_output = results_dir / f"{args.name}.opalis"
    simulation.Save(str(case_output), simulation_type.FILE_TYPE_ALL)
    json_output = results_dir / f"{args.name}.json"
    summary.update(
        {
            "source": str(source),
            "working_source": str(working_source),
            "parameters_file": str(parameters_path) if parameters_path else None,
            "parameters_source": "satellite.json" if parameters_path else None,
            "bootstrap_solar_sections": bootstrap_sections,
            "ephemeris_dir": str(ephemeris_dir),
            "generated_fluxes": generated_fluxes,
            "ephemeris_mapping": ephemeris_mapping,
            "raw_ephemeris_replacement": {
                "previous_rows_removed": previous_ephemeris_rows,
                "new_rows": int(raw_ephemeris.List.Count),
                "sections_loaded": [section + 1 for section in sections_to_apply],
            },
            "rebased_power_profiles": rebased_power_profiles,
            "automatic_timing": timing,
            "reference_timing": {
                "time_step_seconds": reference_time_step,
                "duration_seconds": reference_duration,
                "policy": "preserve_case_a_and_only_reduce_for_shorter_inputs",
            },
            "ephemeris_interpolation": {
                "enabled": bool(
                    opalis.get_property(simulation, INTERPOLATION_PATH)
                ),
                "method": "linear",
                "power_consumption_interpolated": False,
            },
            "applied_parameters": applied_parameters,
            "saved_to": str(case_output),
            "json": str(json_output),
            "simulation_executed": not args.no_run,
        }
    )
    if resize_summary is not None:
        summary.update(resize_summary)
    write_json(json_output, summary)
    print(f"Cas OPALIS sauvegarde : {case_output}")
    print(f"Resume JSON sauvegarde : {json_output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except opalis.OpalisPythonError as exc:
        print(f"Erreur : {exc}")
        raise SystemExit(2)
    except Exception as exc:
        print(f"Erreur OPALIS inattendue : {exc}")
        raise SystemExit(1)
