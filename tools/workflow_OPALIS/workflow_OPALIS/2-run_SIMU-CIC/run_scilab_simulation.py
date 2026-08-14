#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Launch Scilab and execute the Simu-CIC ephemeris simulation script."""

from __future__ import print_function

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile


HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SCILAB_SCRIPT = os.path.join(HERE, "run_ephemeris_attitude_simulation.sce")
DEFAULT_SCIHOME = os.path.join(HERE, ".scilab_home")
DEFAULT_EPHEMERIS_DIR = os.path.join(HERE, "conversion")


def first_existing_dir(candidates):
    for candidate in candidates:
        if candidate and os.path.isdir(candidate):
            return os.path.abspath(candidate)
    return os.path.abspath(candidates[0])


DEFAULT_SIMUCIC_DIR = first_existing_dir(
    [
        os.path.join(os.path.dirname(HERE), "simu_cic"),
        r"D:\STAGE\APP\simu-cic\simu_cic",
        r"D:\STAGE\APP\SIMU_CIC\simu_cic",
    ]
)
DEFAULT_BASE_SCENARIO = os.path.join(
    DEFAULT_SIMUCIC_DIR, "GUI", "examples", "Example_1.scd"
)


def quote_cmd_item(item):
    if " " in item:
        return '"' + item + '"'
    return item


def normalize_path(path):
    return os.path.abspath(os.path.expanduser(path))


def which(program):
    paths = os.environ.get("PATH", "").split(os.pathsep)
    extensions = [""]

    if os.name == "nt":
        pathext = os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD")
        extensions = pathext.split(os.pathsep)
        root, ext = os.path.splitext(program)
        if ext:
            extensions = [""]

    for folder in paths:
        candidate_base = os.path.join(folder, program)
        for ext in extensions:
            candidate = candidate_base + ext
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate

    return None


def scilab_path(path):
    """Return a path string accepted by Scilab on Windows and Unix."""
    return normalize_path(path).replace("\\", "/").replace("'", "''")


def scilab_string(value):
    return "'" + str(value).replace("\\", "/").replace("'", "''") + "'"


def scilab_bool(value):
    if value:
        return "%t"
    return "%f"


def load_attitude_definition(definition_path):
    """Load the backend-produced, run-scoped Simu-CIC attitude definition."""
    if not definition_path:
        return {"mode": "nadir_pointing", "stations": []}
    with open(definition_path, "r") as handle:
        source = json.load(handle)
    attitude = source.get("attitude") if isinstance(source, dict) else None
    if not isinstance(attitude, dict):
        raise IOError("Definition Simu-CIC invalide: attitude absente")
    mode = attitude.get("mode")
    stations = attitude.get("ground_stations", [])
    if mode not in ("nadir_pointing", "ground_station_tracking"):
        raise IOError("Definition Simu-CIC invalide: mode d'attitude inconnu")
    if not isinstance(stations, list):
        raise IOError("Definition Simu-CIC invalide: ground_stations doit etre une liste")
    if mode == "ground_station_tracking" and not stations:
        raise IOError("Definition Simu-CIC invalide: aucune station pour le suivi")
    required_station_fields = ("id", "name", "longitudeDeg", "latitudeDeg", "altitudeM", "minElevationDeg")
    for station in stations:
        if not isinstance(station, dict) or any(field not in station for field in required_station_fields):
            raise IOError("Definition Simu-CIC invalide: station incomplete")
    return {"mode": mode, "stations": stations}


def scilab_attitude_definition_lines(definition):
    """Translate the JSON definition into native Scilab structures before the scenario script runs."""
    lines = [
        "ATTITUDE_MODE = {0};".format(scilab_string(definition["mode"])),
        "ATTITUDE_GROUND_STATIONS = list();",
    ]
    for index, station in enumerate(definition["stations"], 1):
        prefix = "ATTITUDE_GROUND_STATIONS({0})".format(index)
        lines.extend([
            "{0} = struct();".format(prefix),
            "{0}.id = {1};".format(prefix, scilab_string(station["id"])),
            "{0}.name = {1};".format(prefix, scilab_string(station["name"])),
            "{0}.lon = {1};".format(prefix, scilab_string(station["longitudeDeg"])),
            "{0}.lat = {1};".format(prefix, scilab_string(station["latitudeDeg"])),
            "{0}.alt = {1};".format(prefix, scilab_string(station["altitudeM"])),
            "{0}.elevmin = {1};".format(prefix, scilab_string(station["minElevationDeg"])),
        ])
    return lines


def remove_tree(path):
    if os.path.isdir(path):
        shutil.rmtree(path)


def copy_tree(src, dst):
    if not os.path.isdir(src):
        raise IOError("Dossier CIC introuvable: {0}".format(src))
    if os.path.isdir(dst):
        remove_tree(dst)
    shutil.copytree(src, dst)


def find_default_ephemeris(ephemeris_dir):
    if not os.path.isdir(ephemeris_dir):
        raise IOError("Dossier d'ephemerides introuvable: {0}".format(ephemeris_dir))

    matches = []
    for name in os.listdir(ephemeris_dir):
        path = os.path.join(ephemeris_dir, name)
        if not os.path.isfile(path):
            continue

        stem, ext = os.path.splitext(name)
        if stem.upper().endswith(("_SIMU", "-SIMU")):
            matches.append(path)

    if not matches:
        raise IOError(
            "Aucun fichier se terminant par _SIMU ou -SIMU trouve dans: {0}".format(ephemeris_dir)
        )

    matches.sort(key=lambda item: os.path.getmtime(item), reverse=True)
    return normalize_path(matches[0])


def glob_install_dirs(root):
    if not root or not os.path.isdir(root):
        return []

    result = []
    for name in os.listdir(root):
        lower = name.lower()
        if lower.startswith("scilab-"):
            result.append(os.path.join(root, name))
    return result


def candidate_scilab_executables(prefer_gui=False):
    gui_names = ["WScilex.exe", "WScilex"]
    headless_names = [
        "scilab-cli",
        "scilab-cli.exe",
        "scilab-adv-cli",
        "scilab-adv-cli.exe",
        "WScilex-cli.exe",
        "scilab.bat",
        "Scilex.exe",
        "WScilex.exe",
        "scilab",
        "scilab.exe",
    ]
    names = gui_names + headless_names if prefer_gui else headless_names + gui_names

    candidates = []

    for name in names:
        found = which(name)
        if found:
            candidates.append(found)

    program_dirs = [
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
    ]

    for program_dir in program_dirs:
        for install_dir in glob_install_dirs(program_dir):
            bin_dir = os.path.join(install_dir, "bin")
            for name in names:
                exe = os.path.join(bin_dir, name)
                if os.path.isfile(exe):
                    candidates.append(exe)

    unique = []
    seen = set()
    for candidate in candidates:
        key = normalize_path(candidate).lower()
        if key not in seen:
            seen.add(key)
            unique.append(normalize_path(candidate))

    return unique


def find_scilab(explicit_path, prefer_gui=False):
    if explicit_path:
        path = normalize_path(explicit_path)
        if os.path.isfile(path):
            return path
        raise IOError("Executable Scilab introuvable: {0}".format(path))

    candidates = candidate_scilab_executables(prefer_gui=prefer_gui)
    if candidates:
        return candidates[0]

    raise IOError(
        "Scilab est introuvable. Ajoutez Scilab au PATH ou utilisez "
        "--scilab C:\\chemin\\vers\\scilab-cli.exe"
    )


def command_for(executable, launcher, scihome, keep_open, gui):
    command = [executable]
    if not gui:
        command.append("-nb")
    if not keep_open:
        command.append("-quit")
    if scihome:
        command.extend(["-scihome", scihome])
    command.extend(["-f", launcher])
    return command


def explain_process_failure(return_code):
    """Return a readable diagnostic when Scilab exits abnormally."""
    if os.name == "nt" and (return_code < 0 or return_code > 0xFF):
        windows_code = return_code & 0xFFFFFFFF
        if windows_code == 0xC0000409:
            return (
                "Scilab crashed (0xC0000409, stack buffer overrun). "
                "The installed Simu-CIC binaries are not compatible with this "
                "Scilab version; use the Scilab version validated for Simu-CIC."
            )
        return "Scilab crashed (Windows exit code 0x{0:08X}).".format(windows_code)
    return "Scilab exited with code {0}.".format(return_code)


def write_launcher(target_script, options, marker_file, error_marker_file):
    if not os.path.isfile(target_script):
        raise IOError("Script Scilab introuvable: {0}".format(target_script))

    definition = load_attitude_definition(options.simucic_definition)
    lines = [
        "// Launcher generated by run_scilab_simulation.py",
        "SIMUCIC_DIR = {0};".format(scilab_string(scilab_path(options.simucic_dir))),
        "EPHEMERIS_FILE = {0};".format(scilab_string(scilab_path(options.ephemeris))),
        "BASE_SCENARIO = {0};".format(scilab_string(scilab_path(options.base_scenario))),
        "SAVE_ROOT = {0};".format(scilab_string(scilab_path(options.save_root))),
        "ATTITUDE_LAW_NAME = {0};".format(scilab_string("NadirTrace_XY")),
        "ATTITUDE_NADIR_AXIS = {0};".format(scilab_string(options.nadir_axis)),
        "ATTITUDE_TRACE_AXIS = {0};".format(scilab_string(options.trace_axis)),
        "PLOT_AFTER_RUN = {0};".format(scilab_bool(options.plot)),
        "SIMUCIC_HEADLESS = {0};".format(scilab_bool(not options.gui)),
        "RUN_RESULT_MARKER = {0};".format(scilab_string(scilab_path(marker_file))),
        "RUN_ERROR_MARKER = {0};".format(scilab_string(scilab_path(error_marker_file))),
    ] + scilab_attitude_definition_lines(definition) + [
        "try",
        "  exec('{0}', -1);".format(scilab_path(target_script)),
        "catch",
        "  [errmsg, tmp, nline, func] = lasterror();",
        "  error_message = msprintf('%s line %d: %s', func, nline, errmsg);",
        "  mputl(error_message, RUN_ERROR_MARKER);",
        "  mprintf('SIMUCIC_ERROR: %s\\n', error_message);",
        "  clear errmsg tmp nline func error_message;",
        "  exit(1);",
        "end",
    ]

    if not options.keep_open:
        lines.append("exit(0);")

    handle = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".sce",
        prefix="simucic_launcher_",
        delete=False,
    )
    try:
        handle.write(("\n".join(lines) + "\n").encode("utf-8"))
    except TypeError:
        handle.write("\n".join(lines) + "\n")
    finally:
        handle.close()

    return handle.name


def parse_args():
    parser = argparse.ArgumentParser(
        description="Lance Scilab et execute le script Simu-CIC base sur une ephemeride."
    )
    parser.add_argument(
        "--script",
        default=DEFAULT_SCILAB_SCRIPT,
        help="Script Scilab a executer. Defaut: {0}".format(DEFAULT_SCILAB_SCRIPT),
    )
    parser.add_argument(
        "--ephemeris",
        help=(
            "Fichier d'ephemerides OEM/CIC a lire. "
            "Si absent, le plus recent fichier *_SIMU.* est pris dans --ephemeris-dir."
        ),
    )
    parser.add_argument(
        "--ephemeris-dir",
        default=DEFAULT_EPHEMERIS_DIR,
        help=(
            "Dossier ou chercher automatiquement le fichier se terminant par _SIMU. "
            "Defaut: {0}"
        ).format(DEFAULT_EPHEMERIS_DIR),
    )
    parser.add_argument(
        "--simucic-definition",
        help="Definition JSON d'attitude generee depuis le digital thread. Sans cette option: Nadir pointing.",
    )
    parser.add_argument(
        "--base-scenario",
        default=DEFAULT_BASE_SCENARIO,
        help="Scenario Simu-CIC de base (.scd). Defaut: {0}".format(DEFAULT_BASE_SCENARIO),
    )
    parser.add_argument(
        "--simucic-dir",
        help=(
            "Racine de l'installation Simu-CIC (dossiers lib, data et GUI). "
            "Par defaut, elle est deduite du chemin --base-scenario."
        ),
    )
    parser.add_argument(
        "--save-root",
        required=True,
        help="Dossier racine ou sauvegarder les resultats de cette run.",
    )
    parser.add_argument(
        "--nadir-axis",
        default="+X",
        help="Axe satellite pointe vers le nadir pour la loi Nadir Trace. Defaut: +X",
    )
    parser.add_argument(
        "--trace-axis",
        default="+Y",
        help="Axe satellite aligne avec la trace pour la loi Nadir Trace. Defaut: +Y",
    )
    parser.add_argument(
        "--cic-output",
        help="Optionnel: dossier ou copier le repertoire CIC genere.",
    )
    parser.add_argument(
        "--plot",
        action="store_true",
        help="Affiche un graphe Scilab apres la simulation.",
    )
    parser.add_argument(
        "--scilab",
        help="Chemin explicite vers scilab-cli.exe, scilab-adv-cli.exe ou Scilex.exe.",
    )
    parser.add_argument(
        "--keep-open",
        action="store_true",
        help="Ne ferme pas Scilab automatiquement a la fin du script.",
    )
    parser.add_argument(
        "--gui",
        action="store_true",
        help=(
            "Execute via WScilex.exe avec l'interface graphique Simu-CIC. "
            "WScilex.exe est selectionne automatiquement."
        ),
    )
    parser.add_argument(
        "--hide-window",
        action="store_true",
        help="Masque la fenetre Scilab sous Windows tout en conservant l'initialisation GUI requise par Simu-CIC.",
    )
    parser.add_argument(
        "--scihome",
        default=None,
        help=(
            "Dossier SCIHOME utilise par Scilab. En mode headless, le defaut est: {0}. "
            "En mode --gui, le profil Scilab utilisateur est conserve."
        ).format(DEFAULT_SCIHOME),
    )
    return parser.parse_args()


def main():
    args = parse_args()
    target_script = normalize_path(args.script)
    args.ephemeris_dir = normalize_path(args.ephemeris_dir)
    if args.ephemeris:
        args.ephemeris = normalize_path(args.ephemeris)
    else:
        args.ephemeris = find_default_ephemeris(args.ephemeris_dir)
    if args.simucic_definition:
        args.simucic_definition = normalize_path(args.simucic_definition)
        if not os.path.isfile(args.simucic_definition):
            print("Erreur: definition Simu-CIC introuvable: {0}".format(args.simucic_definition), file=sys.stderr)
            return 1
    args.base_scenario = normalize_path(args.base_scenario)
    if args.simucic_dir:
        args.simucic_dir = normalize_path(args.simucic_dir)
    else:
        args.simucic_dir = normalize_path(
            os.path.join(os.path.dirname(args.base_scenario), "..", "..")
        )
    if not os.path.isdir(os.path.join(args.simucic_dir, "lib")):
        print(
            "Erreur: installation Simu-CIC invalide (dossier lib absent): {0}".format(
                args.simucic_dir
            ),
            file=sys.stderr,
        )
        return 1
    args.save_root = normalize_path(args.save_root)
    if args.cic_output:
        args.cic_output = normalize_path(args.cic_output)

    try:
        scilab = find_scilab(args.scilab, prefer_gui=args.gui)
        marker_handle = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".txt",
            prefix="simucic_result_",
            delete=False,
        )
        marker_file = marker_handle.name
        marker_handle.close()
        error_marker_handle = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".txt",
            prefix="simucic_error_",
            delete=False,
        )
        error_marker_file = error_marker_handle.name
        error_marker_handle.close()
        launcher = write_launcher(target_script, args, marker_file, error_marker_file)
    except IOError as exc:
        print("Erreur: {0}".format(exc), file=sys.stderr)
        return 1

    scihome = None
    if args.scihome:
        scihome = normalize_path(args.scihome)
    elif not args.gui:
        scihome = DEFAULT_SCIHOME
    if scihome and not os.path.isdir(scihome):
        os.makedirs(scihome)

    env = os.environ.copy()
    if scihome:
        env["SCIHOME"] = scihome
    command = command_for(scilab, launcher, scihome, args.keep_open, args.gui)

    print("Scilab : {0}".format(scilab))
    print("Script : {0}".format(target_script))
    print("Ephemeride : {0}".format(args.ephemeris))
    print("Mode Scilab : {0}".format("GUI" if args.gui else "headless"))
    print("Definition attitude : {0}".format(args.simucic_definition or "Nadir pointing par defaut"))
    print("SCIHOME : {0}".format(scihome or "profil utilisateur Scilab"))
    print("Commande : {0}".format(" ".join(quote_cmd_item(item) for item in command)))

    try:
        process_options = {"cwd": os.path.dirname(target_script), "env": env}
        if args.hide_window and os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0
            process_options["startupinfo"] = startupinfo
        return_code = subprocess.call(command, **process_options)
        result_dir = None
        if os.path.isfile(marker_file):
            marker = open(marker_file, "r")
            try:
                result_dir = marker.read().strip()
            finally:
                marker.close()

        cic_dir = os.path.join(result_dir, "CIC") if result_dir else None
        cic_complete = bool(
            cic_dir
            and os.path.isdir(cic_dir)
            and any(
                name.upper().endswith(".TXT")
                for root, dirs, files in os.walk(cic_dir)
                for name in files
            )
        )

        scilab_error = None
        if os.path.isfile(error_marker_file):
            with open(error_marker_file, "r") as error_handle:
                scilab_error = error_handle.read().strip() or None

        if return_code != 0 and not cic_complete:
            if scilab_error:
                print("Erreur Simu-CIC: {0}".format(scilab_error), file=sys.stderr)
            print("Erreur Simu-CIC: {0}".format(explain_process_failure(return_code)), file=sys.stderr)
            return return_code
        if return_code != 0:
            print(
                "Avertissement: Scilab a renvoye le code {0}, mais son marqueur "
                "final et les fichiers CIC confirment la fin de la simulation.".format(
                    return_code
                ),
                file=sys.stderr,
            )

        if not result_dir:
            print("Erreur: Scilab n'a pas retourne le dossier de resultats.", file=sys.stderr)
            return 1

        print("Resultats Simu-CIC : {0}".format(result_dir))
        print("Dossier CIC genere : {0}".format(cic_dir))

        if args.cic_output:
            copy_tree(cic_dir, args.cic_output)
            print("Dossier CIC copie  : {0}".format(args.cic_output))

        return 0
    finally:
        if not args.keep_open:
            try:
                os.unlink(launcher)
            except OSError:
                pass
        if not args.keep_open:
            try:
                os.unlink(marker_file)
            except OSError:
                pass
            try:
                os.unlink(error_marker_file)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
