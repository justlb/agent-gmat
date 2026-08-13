#!/usr/bin/env python3
"""Prépare un cas RF-COMLINK à partir des sorties Simu-CIC.

Le script ne modifie jamais le .rfcl de référence. Il remplace dans une copie
les fichiers embarqués référencés par RangeFile, SatelliteDirectionFile,
VisibilityFile et, si disponible, PayloadBinayRateFile.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_TEMPLATE = Path(r"D:\STAGE\APP\rf-comlink\example\example.rfcl")
DEFAULT_OUTPUT_ROOT = SCRIPT_DIR / "resultats_rf_comlink"

CIC_CANDIDATES = {
    "Propagation/RangeFile": ["Sat_DISTANCE_GROUND_STATION_{station}.TXT"],
    "Propagation/SatelliteDirectionFile": [
        "Sat_SATELLITE_DIRECTION-GROUND_STATION_{station}_FRAME.TXT",
        "Sat_SATELLITE__DIRECTION-GROUND_STATION_{station}_FRAME_NONE.TXT",
        "Sat_SATELLITE_DIRECTION-GROUND_STATION_{station}_FRAME_NONE.TXT",
    ],
    "Propagation/VisibilityFile": ["Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_{station}.TXT"],
    "DataHandling/PayloadBinayRateFile": [
        "PAYLOAD_DATA_RATE.TXT",
        "Sat_PAYLOAD_DATA_RATE.TXT",
        "PAYLOAD_DATA_RATE_example.txt",
    ],
}


def find_cic_file(cic_dir: Path, xml_path: str, station: int) -> Path | None:
    for pattern in CIC_CANDIDATES[xml_path]:
        path = cic_dir / pattern.format(station=station)
        if path.is_file():
            return path
    return None


def find_entry_by_guid(names: list[str], guid: str) -> str:
    matches = [name for name in names if guid.lower() in name.lower()]
    if len(matches) != 1:
        raise ValueError(f"Référence interne RF-COMLINK introuvable pour GUID {guid}: {matches}")
    return matches[0]


def selected_links(archive: zipfile.ZipFile, names: list[str], requested: list[str]) -> list[tuple[str, ET.Element]]:
    result: list[tuple[str, ET.Element]] = []
    wanted = set(requested)
    for name in names:
        if not name.startswith("links/") or not name.endswith(".xml"):
            continue
        root = ET.fromstring(archive.read(name))
        link_name = root.findtext("Name")
        if link_name in wanted:
            result.append((name, root))
    missing = wanted - {root.findtext("Name") for _, root in result}
    if missing:
        raise ValueError("Lien(s) absent(s) du template RF-COMLINK : " + ", ".join(sorted(missing)))
    return result


def replace_reference(
    root: ET.Element, names: list[str], archive: zipfile.ZipFile,
    xml_path: str, source: Path, replacements: dict[str, bytes], link_name: str,
) -> None:
    element = root.find(xml_path)
    if element is None:
        raise ValueError(f"{link_name}: chemin XML absent: {xml_path}")
    guid = element.findtext("Guid")
    if not guid:
        raise ValueError(
            f"{link_name}: {xml_path} n'est pas activé dans le template. "
            "Utilisez example.rfcl, pas vide.rfcl."
        )
    target_entry = find_entry_by_guid(names, guid)
    replacements[target_entry] = source.read_bytes()
    original = element.find("OriginalFileName")
    if original is not None:
        original.text = source.name


def build_case(template: Path, cic_dir: Path, output: Path, links: list[str], station: int) -> dict:
    required_paths = [
        "Propagation/RangeFile",
        "Propagation/SatelliteDirectionFile",
        "Propagation/VisibilityFile",
    ]
    sources = {path: find_cic_file(cic_dir, path, station) for path in CIC_CANDIDATES}
    missing = [path for path in required_paths if sources[path] is None]
    if missing:
        expected = [pattern.format(station=station) for path in missing for pattern in CIC_CANDIDATES[path]]
        raise FileNotFoundError("Fichiers CIC obligatoires absents : " + ", ".join(expected))

    replacements: dict[str, bytes] = {}
    used: dict[str, str] = {}
    with zipfile.ZipFile(template, "r") as source_zip:
        names = source_zip.namelist()
        edited_links: dict[str, bytes] = {}
        for link_xml, root in selected_links(source_zip, names, links):
            link_name = root.findtext("Name") or link_xml
            for xml_path in required_paths:
                replace_reference(root, names, source_zip, xml_path, sources[xml_path], replacements, link_name)  # type: ignore[arg-type]
                used.setdefault(xml_path, str(sources[xml_path]))
            payload = sources["DataHandling/PayloadBinayRateFile"]
            if payload is not None:
                element = root.find("DataHandling/PayloadBinayRateFile")
                if element is not None and element.findtext("Guid"):
                    replace_reference(root, names, source_zip, "DataHandling/PayloadBinayRateFile", payload, replacements, link_name)
                    used.setdefault("DataHandling/PayloadBinayRateFile", str(payload))
            edited_links[link_xml] = ET.tostring(root, encoding="utf-8", xml_declaration=True)

        replacements.update(edited_links)
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".rfcl", delete=False) as temp:
            temp_path = Path(temp.name)
        try:
            with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as destination:
                for info in source_zip.infolist():
                    destination.writestr(info.filename, replacements.get(info.filename, source_zip.read(info.filename)))
            shutil.move(temp_path, output)
        finally:
            temp_path.unlink(missing_ok=True)

    return {
        "template": str(template),
        "cic_directory": str(cic_dir),
        "ground_station_index": station,
        "links": links,
        "cic_files_used": used,
        "payload_rate_included": "DataHandling/PayloadBinayRateFile" in used,
        "output_rfcl": str(output),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cic-dir", type=Path, required=True, help="Dossier CIC/Sat produit par Simu-CIC")
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE, help="Cas RF-COMLINK de référence")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--name", default=None, help="Nom du cas produit (sans extension)")
    parser.add_argument("--station", type=int, default=1, help="Indice de la station sol Simu-CIC")
    parser.add_argument("--links", nargs="+", default=["Telecommand", "Housekeeping telemetry"])
    args = parser.parse_args()

    template, cic_dir = args.template.resolve(), args.cic_dir.resolve()
    if not template.is_file():
        raise FileNotFoundError(f"Template RF-COMLINK introuvable : {template}")
    if not cic_dir.is_dir():
        raise NotADirectoryError(f"Dossier CIC introuvable : {cic_dir}")
    name = args.name or f"rfcomlink-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    output_dir = args.output_dir.resolve() / name
    if output_dir.exists():
        raise FileExistsError(f"Le dossier de sortie existe déjà : {output_dir}")
    output = output_dir / f"{name}.rfcl"
    summary = build_case(template, cic_dir, output, args.links, args.station)
    summary["created_utc"] = datetime.now(timezone.utc).isoformat()
    summary["status"] = "prepared"
    summary["next_step"] = "Open the generated .rfcl in RF-COMLINK and run the calculation from its GUI."
    (output_dir / "workflow.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (output_dir / "LISEZ-MOI.txt").write_text(
        "Cas RF-COMLINK préparé depuis Simu-CIC.\n"
        f"Ouvrir : {output.name}\n"
        "Les fichiers CIC de distance, direction satellite et visibilité ont été injectés.\n"
        "Le calcul RF-COMLINK reste à lancer dans le GUI.\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
