#!/usr/bin/env python3
"""Piloter OPALIS 2.3 depuis Python avec pythonnet.

Exemples :
    python opalis_python.py info "Opalis-2.3.0/Example/cas A.opalis"
    python opalis_python.py run "Opalis-2.3.0/Example/cas A.opalis" \
        --set SimulationModel.PowerProfil.PMargin=12 \
        --save resultat.opalis
    python opalis_python.py sweep "Opalis-2.3.0/Example/cas A.opalis" \
        --start 0 --stop 10 --step 1 --csv balayage.csv

Le script charge directement OpalisApi.dll. Il ne lance pas l'interface graphique.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import re
import sys
from pathlib import Path
from typing import Any, Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OPALIS_DIR = SCRIPT_DIR / "Opalis-2.3.0"
POWER_MARGIN_PATH = "SimulationModel.PowerProfil.PMargin"
INDEXED_PROPERTY_RE = re.compile(r"^(?P<name>[^\[\]]+)(?:\[(?P<index>[^\[\]]+)\])?$")
GENERATE_FLUX_FILE_PRESET = {
    "sun_angle": "Sat_SUN_ANGLE_SA_1.TXT",
    "eclipse": "Sat_SATELLITE_ECLIPSE.TXT",
    "moon_eclipse": "Sat_SATELLITE_ECLIPSE_MOON.TXT",
    "earth_angle": "Sat_EARTH_ANGLE_SA_1.TXT",
    "altitude": "Sat_SATELLITE_ALTITUDE.TXT",
    "earth_direction": "Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT",
    "sun_direction": "Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT",
    "coordinates": "Sat_GEOGRAPHICAL_COORDINATES.TXT",
}


class OpalisPythonError(RuntimeError):
    """Erreur présentable à l'utilisateur."""


def absolute_path(value: str | Path, base: Path | None = None) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = (base or Path.cwd()) / path
    return path.resolve()


def load_opalis_api(opalis_dir: Path) -> tuple[Any, Any]:
    """Charge OpalisApi.dll et retourne les types principaux de l'API."""
    if platform.system() != "Windows":
        raise OpalisPythonError(
            "OPALIS 2.3 cible .NET Framework 4.8 et doit être piloté sous Windows."
        )

    opalis_dir = opalis_dir.resolve()
    lib_dir = opalis_dir / "lib"
    api_dll = lib_dir / "OpalisApi.dll"
    if not api_dll.is_file():
        raise OpalisPythonError(f"DLL OPALIS introuvable : {api_dll}")

    native_dir = lib_dir / ("win64" if sys.maxsize > 2**32 else "win32")
    search_dirs = [lib_dir, native_dir, opalis_dir]
    os.environ["PATH"] = os.pathsep.join(map(str, search_dirs)) + os.pathsep + os.environ.get(
        "PATH", ""
    )
    if hasattr(os, "add_dll_directory"):
        # Les handles doivent rester vivants pendant tout le processus.
        load_opalis_api._dll_handles = [  # type: ignore[attr-defined]
            os.add_dll_directory(str(path)) for path in search_dirs if path.is_dir()
        ]
    sys.path.insert(0, str(lib_dir))

    try:
        from pythonnet import load
    except ImportError as exc:
        raise OpalisPythonError(
            "La dépendance 'pythonnet' manque. Installez-la avec :\n"
            f'  "{sys.executable}" -m pip install -r '
            f'"{SCRIPT_DIR / "requirements-opalis-python.txt"}"'
        ) from exc

    try:
        load("netfx")
    except RuntimeError as exc:
        # pythonnet lève aussi RuntimeError si un runtime a déjà été initialisé.
        if "already" not in str(exc).lower():
            raise OpalisPythonError(
                "Impossible d'initialiser .NET Framework. OPALIS exige .NET Framework 4.8."
            ) from exc

    try:
        import clr

        # Le chargement explicite de CicCcsdsNet facilite la résolution de la
        # principale dépendance non système d'OpalisApi.
        clr.AddReference(str(lib_dir / "CicCcsdsNet.dll"))
        clr.AddReference(str(api_dll))
        # OPALIS 2.3 exposes SimulationHelper in the singular Helper
        # namespace. Other utility classes remain under Helpers.
        from OpalisApi.Helper import SimulationHelper
        from OpalisApi.Model import OpalisSimulation
    except Exception as exc:
        message = str(exc)
        hint = ""
        if "0x80131515" in message or "Operation is not supported" in message:
            hint = (
                "\nWindows a probablement marqué les DLL comme téléchargées. "
                "Débloquez le dossier une fois avec PowerShell :\n"
                f"  Get-ChildItem -Recurse '{opalis_dir}' | Unblock-File"
            )
        raise OpalisPythonError(f"Impossible de charger OpalisApi.dll : {message}{hint}") from exc

    return OpalisSimulation, SimulationHelper


def load_flows_manager_api(opalis_dir: Path) -> tuple[Any, Any, Any]:
    """Charge l'API utilisée par le dialogue OPALIS « Generate fluxes »."""
    lib_dir = opalis_dir.resolve() / "lib"
    flows_dll = lib_dir / "FlowsManagerApi.dll"
    if not flows_dll.is_file():
        raise OpalisPythonError(f"DLL de génération de flux introuvable : {flows_dll}")
    try:
        import clr

        clr.AddReference(str(flows_dll))
        from FlowsManagerApi.Flow import FlowTransformation
        from FlowsManagerApi.Util.Ccsds import (
            CcsdsFileHolderFactory,
            CcsdsFileType,
        )
    except Exception as exc:
        raise OpalisPythonError(
            f"Impossible de charger FlowsManagerApi.dll : {exc}"
        ) from exc
    return FlowTransformation, CcsdsFileHolderFactory, CcsdsFileType


def create_flows_input_holder(
    path: Path, file_type: Any, holder_factory: Any, label: str
) -> Any:
    """Charge et valide une entrée CIC-CCSDS de Generate fluxes."""
    if not path.is_file():
        raise OpalisPythonError(f"Fichier {label} introuvable : {path}")
    holder = holder_factory.create(file_type)
    holder.FilePath = str(path)
    if not holder.IsValid:
        raise OpalisPythonError(
            f"Le fichier {label} n'est pas valide pour OPALIS : {path}"
        )
    return holder


def resolve_flux_input_path(
    args: argparse.Namespace,
    argument_name: str,
    invocation_dir: Path,
    required: bool = True,
) -> Path | None:
    raw_value = getattr(args, argument_name)
    if raw_value:
        return absolute_path(raw_value, invocation_dir)
    if args.inputs_dir:
        inputs_dir = absolute_path(args.inputs_dir, invocation_dir)
        preset_name = GENERATE_FLUX_FILE_PRESET[argument_name]
        return inputs_dir / preset_name
    if required:
        raise OpalisPythonError(
            f"Argument manquant : --{argument_name.replace('_', '-')} "
            "ou --inputs-dir."
        )
    return None


def open_simulation(path: Path, simulation_type: Any) -> Any:
    if not path.is_file():
        raise OpalisPythonError(f"Simulation introuvable : {path}")
    simulation = simulation_type()
    simulation.Open(str(path))
    return simulation


def split_property_path(path: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    bracket_depth = 0
    for char in path:
        if char == "[":
            bracket_depth += 1
        elif char == "]":
            bracket_depth -= 1
            if bracket_depth < 0:
                raise OpalisPythonError(f"Chemin de propriete invalide : {path}")
        if char == "." and bracket_depth == 0:
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
        else:
            current.append(char)
    if bracket_depth != 0:
        raise OpalisPythonError(f"Chemin de propriete invalide : {path}")
    final_part = "".join(current).strip()
    if final_part:
        parts.append(final_part)
    if not parts:
        raise OpalisPythonError("Le chemin de propriété est vide.")
    return parts


def parse_property_part(part: str) -> tuple[str, str | None]:
    match = INDEXED_PROPERTY_RE.match(part)
    if not match:
        raise OpalisPythonError(f"Segment de propriete invalide : {part}")
    return match.group("name"), match.group("index")


def get_indexed_item(collection: Any, raw_index: str) -> Any:
    import System

    index = raw_index.strip().strip("'\"")
    if re.fullmatch(r"-?\d+", index):
        method = collection.GetType().GetMethod(
            "get_Item", System.Array[System.Type]([System.Int32])
        )
        if method is not None:
            return method.Invoke(collection, [System.Int32(int(index))])
    method = collection.GetType().GetMethod(
        "get_Item", System.Array[System.Type]([System.String])
    )
    if method is not None:
        return method.Invoke(collection, [index])
    raise OpalisPythonError(
        f"Impossible d'indexer {collection.GetType().FullName} avec [{raw_index}]"
    )


def get_property_part(root: Any, part: str) -> Any:
    property_name, index = parse_property_part(part)
    if not hasattr(root, property_name):
        raise OpalisPythonError(f"Propriete OPALIS inconnue : {property_name}")
    value = getattr(root, property_name)
    if index is not None:
        value = get_indexed_item(value, index)
    return value


def get_property(root: Any, path: str) -> Any:
    current = root
    walked: list[str] = []
    for part in split_property_path(path):
        walked.append(part)
        try:
            current = get_property_part(current, part)
        except OpalisPythonError as exc:
            raise OpalisPythonError(f"{exc} dans {'.'.join(walked)}") from exc
        if current is None and part != split_property_path(path)[-1]:
            raise OpalisPythonError(f"Objet OPALIS nul : {'.'.join(walked)}")
    return current


def convert_text_for_dotnet(text: str, target_type: Any) -> Any:
    """Convertit une valeur CLI vers le type exact attendu par une propriété .NET."""
    import System

    nullable_type = System.Nullable.GetUnderlyingType(target_type)
    if nullable_type is not None:
        target_type = nullable_type

    if target_type.IsEnum:
        return System.Enum.Parse(target_type, text, True)
    if target_type == System.String:
        return text
    if target_type.FullName == "OpalisApi.Helpers.OpalisTime":
        return System.Activator.CreateInstance(target_type, System.Double(float(text)))
    if target_type == System.Boolean:
        lowered = text.strip().lower()
        if lowered in {"1", "true", "yes", "oui", "on"}:
            return True
        if lowered in {"0", "false", "no", "non", "off"}:
            return False
        raise OpalisPythonError(f"Booléen invalide : {text!r}")
    if target_type == System.Byte:
        return System.Byte(int(text))
    if target_type == System.SByte:
        return System.SByte(int(text))
    if target_type == System.Int16:
        return System.Int16(int(text))
    if target_type == System.UInt16:
        return System.UInt16(int(text))
    if target_type == System.Int32:
        return System.Int32(int(text))
    if target_type == System.UInt32:
        return System.UInt32(int(text))
    if target_type == System.Int64:
        return System.Int64(int(text))
    if target_type == System.UInt64:
        return System.UInt64(int(text))
    if target_type == System.Single:
        return System.Single(float(text))
    if target_type == System.Double:
        return System.Double(float(text))
    if target_type == System.Decimal:
        return System.Decimal(float(text))

    try:
        # La culture invariante impose le point comme séparateur décimal.
        return System.Convert.ChangeType(text, target_type, System.Globalization.CultureInfo.InvariantCulture)
    except Exception as exc:
        raise OpalisPythonError(
            f"Impossible de convertir {text!r} en {target_type.FullName}."
        ) from exc


def set_property(root: Any, assignment: str) -> tuple[str, Any]:
    if "=" not in assignment:
        raise OpalisPythonError(
            f"Affectation invalide {assignment!r}; format attendu : Chemin.Propriete=valeur"
        )
    path, raw_value = assignment.split("=", 1)
    parts = split_property_path(path)
    owner = root
    for part in parts[:-1]:
        owner = get_property_part(owner, part)
        if owner is None:
            raise OpalisPythonError(f"Objet OPALIS nul avant {parts[-1]} : {path}")

    property_name, index = parse_property_part(parts[-1])
    if index is not None:
        raise OpalisPythonError(
            "L'affectation directe d'un element indexe n'est pas supportee; "
            "ciblez une propriete de cet element."
        )
    property_info = owner.GetType().GetProperty(property_name)
    if property_info is None or not property_info.CanWrite:
        raise OpalisPythonError(f"Propriété OPALIS absente ou non modifiable : {path}")
    converted = convert_text_for_dotnet(raw_value, property_info.PropertyType)
    property_info.SetValue(owner, converted, None)
    return path, getattr(owner, property_name)


def json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    try:
        import System

        if isinstance(value, System.DateTime):
            return value.ToString("o")
        if value.GetType().IsEnum:
            return str(value)
        type_code = System.Type.GetTypeCode(value.GetType())
        if type_code in {
            System.TypeCode.Byte,
            System.TypeCode.SByte,
            System.TypeCode.Int16,
            System.TypeCode.UInt16,
            System.TypeCode.Int32,
            System.TypeCode.UInt32,
            System.TypeCode.Int64,
            System.TypeCode.UInt64,
        }:
            return int(value)
        if type_code in {System.TypeCode.Decimal, System.TypeCode.Double, System.TypeCode.Single}:
            return float(value)
    except Exception:
        pass
    return str(value)


def optional_property(root: Any, path: str) -> Any:
    try:
        return json_value(get_property(root, path))
    except OpalisPythonError:
        return None


def model_summary(simulation: Any, source: Path) -> dict[str, Any]:
    return {
        "source": str(source),
        "satellite": optional_property(simulation, "SimulationModel.PowerProfil.SatelliteName"),
        "power_margin": optional_property(simulation, POWER_MARGIN_PATH),
        "soc_battery": optional_property(
            simulation, "SimulationModel.SimulationInitialisation.SocBattery"
        ),
        "simulation_duration": optional_property(
            simulation, "SimulationModel.SimulationTiming.Simultime"
        ),
        "time_step": optional_property(simulation, "SimulationModel.SimulationTiming.Timestep"),
        "orbit_duration": optional_property(
            simulation, "SimulationModel.SimulationTiming.OrbitDuration"
        ),
        "solar_sections": optional_property(
            simulation, "SimulationModel.SolarGenerator.Sections.Count"
        ),
    }


def result_summary(simulation: Any, source: Path, initial_soc: Any) -> dict[str, Any]:
    synthesis = "SimulationResult.Synthesis."
    summary = model_summary(simulation, source)
    summary.update(
        {
            "initial_soc": json_value(initial_soc),
            "final_soc": optional_property(simulation, synthesis + "SocBattery"),
            "stop_condition": optional_property(simulation, synthesis + "StopCondition"),
            "computed_duration": optional_property(simulation, synthesis + "Duration"),
            "completion_percent": optional_property(simulation, synthesis + "Percent"),
            "global_efficiency": optional_property(simulation, synthesis + "GlobalEfficiency"),
            "solar_array_energy": optional_property(simulation, synthesis + "Esa"),
            "max_depth_of_discharge": optional_property(simulation, synthesis + "DodMax"),
            "result_rows": optional_property(simulation, "SimulationResult.Rows.Count"),
            "orbits": optional_property(simulation, "SimulationResult.Orbits.Count"),
        }
    )
    return summary


def write_json(data: Any, output: Path | None = None) -> None:
    content = json.dumps(data, ensure_ascii=False, indent=2)
    if output is None:
        print(content)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content + "\n", encoding="utf-8")
        print(f"Résumé JSON écrit dans {output}")


def decimal_range(start: float, stop: float, step: float) -> Iterable[float]:
    if step == 0:
        raise OpalisPythonError("Le pas de balayage ne peut pas être nul.")
    if (stop - start) * step < 0:
        raise OpalisPythonError("Le signe du pas n'atteint pas la borne finale.")
    current = start
    epsilon = abs(step) * 1e-9
    predicate = (lambda x: x <= stop + epsilon) if step > 0 else (lambda x: x >= stop - epsilon)
    while predicate(current):
        yield current
        current += step


def add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("simulation", help="fichier .opalis à ouvrir")
    parser.add_argument(
        "--opalis-dir",
        default=str(DEFAULT_OPALIS_DIR),
        help=f"dossier d'installation OPALIS (défaut : {DEFAULT_OPALIS_DIR})",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Piloter OPALIS 2.3 depuis Python via son API .NET."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    info_parser = subparsers.add_parser("info", help="afficher les paramètres principaux")
    add_common_arguments(info_parser)
    info_parser.add_argument("--get", action="append", default=[], help="propriété supplémentaire")
    info_parser.add_argument("--json", dest="json_path", help="écrire aussi le résumé dans ce fichier")

    run_parser = subparsers.add_parser("run", help="modifier puis exécuter une simulation")
    add_common_arguments(run_parser)
    run_parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="CHEMIN=VALEUR",
        help="modifier une propriété; option répétable",
    )
    run_parser.add_argument("--get", action="append", default=[], help="propriété à afficher après calcul")
    run_parser.add_argument("--reload-inputs", action="store_true", help="recharger les fichiers CCSDS liés")
    run_parser.add_argument("--save", help="sauvegarder la simulation calculée dans un nouveau .opalis")
    run_parser.add_argument("--json", dest="json_path", help="écrire le résumé dans ce fichier JSON")

    sweep_parser = subparsers.add_parser(
        "sweep", help="balayer la marge de puissance et produire un CSV"
    )
    add_common_arguments(sweep_parser)
    sweep_parser.add_argument("--start", type=float, required=True)
    sweep_parser.add_argument("--stop", type=float, required=True)
    sweep_parser.add_argument("--step", type=float, default=1.0)
    sweep_parser.add_argument("--csv", required=True, help="fichier CSV de sortie")

    sections_parser = subparsers.add_parser(
        "resize-sections",
        help="reduire le nombre de sections solaires et sauvegarder un nouveau cas",
    )
    add_common_arguments(sections_parser)
    sections_parser.add_argument(
        "--count",
        type=int,
        required=True,
        help="nombre final de sections solaires a conserver",
    )
    sections_parser.add_argument(
        "--save", required=True, help="nouveau fichier .opalis a creer"
    )
    sections_parser.add_argument("--json", dest="json_path", help="resume JSON facultatif")

    flux_parser = subparsers.add_parser(
        "generate-flux",
        help="générer un profil de flux, l'affecter à une section et sauvegarder le cas",
    )
    add_common_arguments(flux_parser)
    flux_parser.add_argument(
        "--section",
        type=int,
        required=True,
        help="index de la section solaire, à partir de 0",
    )
    flux_parser.add_argument(
        "--inputs-dir",
        help=(
            "dossier contenant les fichiers OPALIS nommes Sat_*.TXT; "
            "peut remplacer les options fichier detaillees"
        ),
    )
    flux_parser.add_argument("--sun-angle", help="Sun angle SA")
    flux_parser.add_argument("--eclipse", help="Satellite eclipse")
    flux_parser.add_argument(
        "--moon-eclipse",
        help="Satellite moon eclipse; omettre pour le mode sans éclipse lunaire",
    )
    flux_parser.add_argument("--earth-angle", help="Earth angle")
    flux_parser.add_argument("--altitude", help="Satellite altitude")
    flux_parser.add_argument(
        "--earth-direction",
        help="Earth direction satellite frame (3 colonnes)",
    )
    flux_parser.add_argument(
        "--sun-direction",
        help="Sun direction satellite frame (3 colonnes)",
    )
    flux_parser.add_argument(
        "--coordinates",
        help="Geographical coordinates (longitude, latitude)",
    )
    flux_parser.add_argument(
        "--flux-output", required=True, help="profil CIC-CCSDS FLUXES_SA à générer"
    )
    flux_parser.add_argument(
        "--save", required=True, help="nouveau fichier .opalis à créer"
    )
    flux_parser.add_argument(
        "--run", action="store_true", help="lancer également la simulation après remplacement"
    )
    flux_parser.add_argument("--json", dest="json_path", help="résumé JSON facultatif")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    invocation_dir = Path.cwd()
    opalis_dir = absolute_path(args.opalis_dir, invocation_dir)
    source = absolute_path(args.simulation, invocation_dir)
    simulation_type, helper_type = load_opalis_api(opalis_dir)

    if args.command == "info":
        simulation = open_simulation(source, simulation_type)
        summary = model_summary(simulation, source)
        for path in args.get:
            summary[path] = json_value(get_property(simulation, path))
        output = absolute_path(args.json_path, invocation_dir) if args.json_path else None
        write_json(summary, output)
        return 0

    if args.command == "run":
        simulation = open_simulation(source, simulation_type)
        for assignment in args.set:
            set_property(simulation, assignment)
        if args.reload_inputs:
            simulation.ReloadAllEphemerisFromFiles(True)
        initial_soc = get_property(
            simulation, "SimulationModel.SimulationInitialisation.SocBattery"
        )
        helper = helper_type()
        helper.LaunchSimulation(simulation, True)
        summary = result_summary(simulation, source, initial_soc)
        for path in args.get:
            summary[path] = json_value(get_property(simulation, path))
        if args.save:
            destination = absolute_path(args.save, invocation_dir)
            destination.parent.mkdir(parents=True, exist_ok=True)
            simulation.Save(str(destination), simulation_type.FILE_TYPE_ALL)
            summary["saved_to"] = str(destination)
        output = absolute_path(args.json_path, invocation_dir) if args.json_path else None
        write_json(summary, output)
        return 0

    if args.command == "sweep":
        rows: list[dict[str, Any]] = []
        for margin in decimal_range(args.start, args.stop, args.step):
            simulation = open_simulation(source, simulation_type)
            set_property(simulation, f"{POWER_MARGIN_PATH}={margin:.15g}")
            initial_soc = get_property(
                simulation, "SimulationModel.SimulationInitialisation.SocBattery"
            )
            helper_type().LaunchSimulation(simulation, True)
            result = result_summary(simulation, source, initial_soc)
            rows.append(
                {
                    "power_margin": margin,
                    "initial_soc": result["initial_soc"],
                    "final_soc": result["final_soc"],
                    "global_efficiency": result["global_efficiency"],
                    "max_depth_of_discharge": result["max_depth_of_discharge"],
                    "stop_condition": result["stop_condition"],
                }
            )
            print(f"Marge {margin:g} W -> SoC final {result['final_soc']}", file=sys.stderr)

        csv_path = absolute_path(args.csv, invocation_dir)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="", encoding="utf-8-sig") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"Balayage écrit dans {csv_path}")
        return 0

    if args.command == "resize-sections":
        if args.count <= 0:
            raise OpalisPythonError("Le nombre de sections doit etre strictement positif.")

        simulation = open_simulation(source, simulation_type)
        sections = get_property(simulation, "SimulationModel.SolarGenerator.Sections")
        initial_count = int(sections.Count)
        if args.count > initial_count:
            raise OpalisPythonError(
                "Cette commande reduit seulement le nombre de sections "
                f"({initial_count} actuellement, {args.count} demandees)."
            )
        while int(sections.Count) > args.count:
            sections.RemoveAt(int(sections.Count) - 1)

        destination = absolute_path(args.save, invocation_dir)
        destination.parent.mkdir(parents=True, exist_ok=True)
        simulation.Save(str(destination), simulation_type.FILE_TYPE_ALL)
        summary = model_summary(simulation, source)
        summary.update(
            {
                "initial_solar_sections": initial_count,
                "solar_sections": int(sections.Count),
                "saved_to": str(destination),
            }
        )
        output = absolute_path(args.json_path, invocation_dir) if args.json_path else None
        write_json(summary, output)
        return 0

    if args.command == "generate-flux":
        if args.section < 0:
            raise OpalisPythonError("L'index de section ne peut pas être négatif.")

        flow_transformation, holder_factory, file_types = load_flows_manager_api(
            opalis_dir
        )
        input_specs = [
            ("sun_angle", "SunAngle", "Sun angle SA"),
            ("eclipse", "Eclipse", "Satellite eclipse"),
            ("earth_angle", "EarthAngle", "Earth angle"),
            ("altitude", "Altitude", "Satellite altitude"),
            ("earth_direction", "Position", "Earth direction satellite frame"),
            ("sun_direction", "SunDirection", "Sun direction satellite frame"),
            ("coordinates", "Coordinates", "Geographical coordinates"),
        ]
        holders: dict[str, Any] = {}
        for argument_name, enum_name, label in input_specs:
            input_path = resolve_flux_input_path(args, argument_name, invocation_dir)
            holders[argument_name] = create_flows_input_holder(
                input_path, getattr(file_types, enum_name), holder_factory, label
            )

        moon_holder = None
        moon_eclipse_path = resolve_flux_input_path(
            args, "moon_eclipse", invocation_dir, required=False
        )
        if moon_eclipse_path is not None:
            moon_holder = create_flows_input_holder(
                moon_eclipse_path,
                file_types.MoonEclipse,
                holder_factory,
                "Satellite moon eclipse",
            )

        flux_output = absolute_path(args.flux_output, invocation_dir)
        flux_output.parent.mkdir(parents=True, exist_ok=True)
        flow_transformation.GenerateFlowsFile(
            holders["sun_angle"],
            holders["eclipse"],
            moon_holder,
            holders["earth_angle"],
            holders["altitude"],
            holders["earth_direction"],
            holders["sun_direction"],
            holders["coordinates"],
            str(flux_output),
        )
        if not flux_output.is_file():
            raise OpalisPythonError(
                f"La génération n'a pas créé le profil attendu : {flux_output}"
            )

        simulation = open_simulation(source, simulation_type)
        section_count = get_property(
            simulation, "SimulationModel.SolarGenerator.Sections.Count"
        )
        if args.section >= int(section_count):
            raise OpalisPythonError(
                f"Section {args.section} inexistante : le cas contient {section_count} section(s)."
            )
        # Cette surcharge importe les valeurs dans RawEphemeris et lie le
        # nouveau fichier à la section sélectionnée.
        simulation.LoadFlowsFile(str(flux_output), args.section)

        if args.run:
            initial_soc = get_property(
                simulation, "SimulationModel.SimulationInitialisation.SocBattery"
            )
            helper_type().LaunchSimulation(simulation, True)
            summary = result_summary(simulation, source, initial_soc)
        else:
            summary = model_summary(simulation, source)

        destination = absolute_path(args.save, invocation_dir)
        destination.parent.mkdir(parents=True, exist_ok=True)
        simulation.Save(str(destination), simulation_type.FILE_TYPE_ALL)
        summary.update(
            {
                "generated_flux_file": str(flux_output),
                "solar_section_index": args.section,
                "saved_to": str(destination),
                "simulation_executed": bool(args.run),
            }
        )
        output = absolute_path(args.json_path, invocation_dir) if args.json_path else None
        write_json(summary, output)
        return 0

    raise AssertionError(f"Commande non gérée : {args.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except OpalisPythonError as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(2)
    except Exception as exc:
        print(f"Erreur OPALIS inattendue : {exc}", file=sys.stderr)
        raise SystemExit(1)
