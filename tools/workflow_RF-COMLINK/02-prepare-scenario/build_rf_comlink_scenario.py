#!/usr/bin/env python3
"""Build a run-local RF-COMLINK scenario from the validated input manifest.

RF-COMLINK stores scenarios as ZIP containers whose link files are XML.  The
installed application has no batch interface, so this step only prepares the
deterministic file; the following GUI step opens it.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


# The Simu-CIC catalogue uses site-level IDs, whereas RF-COMLINK exposes
# several antenna records at some sites.  These are the agreed station assets
# for the first mission workflow; the chosen Simu-CIC ID therefore resolves to
# one stable RF-COMLINK code instead of depending on database row order.
PREFERRED_GROUND_STATION_CODES = {
    "aussaguel": "AUS",
    "inuvik": "IVK",
    "kiruna": "KIR_SSC",
    "kourou": "KOU_CNES",
}


def text(parent: ET.Element, tag: str, value: object) -> None:
    """Update only an existing scalar field.

    RF-COMLINK uses identical XML names for scalar fields and serialized
    objects (notably the two ``Modulation`` nodes). Creating or clearing an
    object node makes the WPF deserializer crash with a null reference.
    """
    for node in parent.findall(tag):
        if not list(node):
            node.text = "" if value is None else str(value)
            return


def set_distribution(parent: ET.Element, tag: str, value: object) -> None:
    node = parent.find(tag)
    if node is None:
        return
    design = node.find("Design")
    if design is None:
        design = ET.SubElement(node, "Design")
    design.text = "" if value is None else str(value)
    for child in ("Favorable", "Adverse"):
        item = node.find(child)
        if item is None:
            item = ET.SubElement(node, child)
        item.text = design.text
    distribution = node.find("Distribution")
    if distribution is None:
        distribution = ET.SubElement(node, "Distribution")
    distribution.text = "UNI"


def set_distribution_triplet(parent: ET.Element, tag: str, values: tuple[str, str, str]) -> None:
    """Write a database distribution without flattening its uncertainty."""
    node = parent.find(tag)
    if node is None:
        return
    for child, value in zip(("Design", "Favorable", "Adverse"), values):
        item = node.find(child)
        if item is not None:
            item.text = value


def find_ground_station_database_record(template: Path, station_id: str | None, band: object) -> dict[str, object] | None:
    """Resolve the selected Simu-CIC station against RF-COMLINK's own database.

    The satellite's selected station is deliberately only an ID (``kourou``),
    whereas RF-COMLINK needs its hardware and RF properties.  This lookup
    keeps the RF scenario tied to the database installed with RF-COMLINK.
    """
    if not station_id or not band:
        return None
    database = template.parent.parent / "Resources" / "GROUND_STATION_DATABASE.txt"
    if not database.is_file():
        return None
    rows: list[list[str]] = []
    for line in database.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.startswith('"'):
            continue
        row = next(csv.reader([line], delimiter="\t"))
        if len(row) >= 30 and row[1].upper() == str(band).upper():
            rows.append(row)
    normalized = station_id.replace("-", "").replace("_", " ").upper()
    matching = [row for row in rows if normalized in row[2].upper() or normalized in row[0].replace("_", " ").upper()]
    preferred_code = PREFERRED_GROUND_STATION_CODES.get(station_id.lower())
    if preferred_code:
        matching.sort(key=lambda row: 0 if row[0] == preferred_code else 1)
    # Keep the selected station for downlinks too: an X-band record may have
    # no transmit EIRP but is still its valid RF-COMLINK receiver entry.
    chosen = matching[0] if matching else None
    if chosen is None:
        return None
    return {
        "code": chosen[0], "band": chosen[1], "location": chosen[2], "network": chosen[3],
        "longitude": chosen[4], "latitude": chosen[5], "altitude": chosen[6],
        "min_elevation": chosen[7], "diameter": chosen[8],
        "eirp": (chosen[9], chosen[10], chosen[11]),
        "gpt": (chosen[12], chosen[13], chosen[14]),
        "gain_rx": (chosen[15], chosen[16], chosen[17]),
        "pointing_rx": (chosen[18], chosen[19], chosen[20]),
        "pointing_tx": (chosen[21], chosen[22], chosen[23]),
        "axial_rx": (chosen[24], chosen[25], chosen[26]),
        "axial_tx": (chosen[27], chosen[28], chosen[29]),
    }


def rf_comlink_cic(source: Path, destination: Path) -> Path:
    """Convert Simu-CIC's MJD timestamps to RF-COMLINK's UTC CIC dates.

    Simu-CIC writes valid CIC v3 with a two-field MJD date. RF-COMLINK's
    scenario importer expects ISO-8601 UTC dates at the beginning of each
    data line; the application itself writes result CIC files with MJD dates.
    """
    lines: list[str] = []
    origin = datetime(1858, 11, 17, tzinfo=timezone.utc)
    for raw in source.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        fields = raw.split()
        if len(fields) >= 3:
            try:
                mjd, seconds = float(fields[0]), float(fields[1])
                if 30000 <= mjd <= 100000 and -1 <= seconds <= 172800:
                    instant = origin + timedelta(days=mjd, seconds=seconds)
                    timestamp = instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    lines.append("\t".join([timestamp, *fields[2:]]))
                    continue
            except ValueError:
                pass
        lines.append("CIC_MEM_VERS = 2.0" if raw.strip().startswith("CIC_MEM_VERS") else raw)
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination


def set_file_reference(parent: ET.Element, tag: str, source: Path, ephemeris_dir: Path) -> None:
    """Embed a CIC file using RF-COMLINK's serialized file-reference form."""
    reference = parent.find(tag)
    if reference is None:
        return
    identifier = str(uuid.uuid4())
    for child in list(reference):
        if child.tag in {"OriginalFileName", "Guid"}:
            reference.remove(child)
    comment = reference.find("CommentCollection")
    index = list(reference).index(comment) if comment is not None else len(reference)
    original = ET.Element("OriginalFileName")
    original.text = source.name
    guid = ET.Element("Guid")
    guid.text = identifier
    reference.insert(index, original)
    reference.insert(index + 1, guid)
    ephemeris_dir.mkdir(parents=True, exist_ok=True)
    # RF-COMLINK resolves ZIP entries with a fixed lowercase `.txt` suffix,
    # even when OriginalFileName carries an uppercase `.TXT` extension.
    rf_comlink_cic(source, ephemeris_dir / f"{source.stem}_{identifier}.txt")


def cic_sources(run_dir: Path, cic_inputs: list[str]) -> tuple[Path, Path, Path]:
    candidates = [run_dir / Path(item) for item in cic_inputs]
    def select(fragment: str) -> Path:
        match = next((item for item in candidates if fragment in item.name and item.is_file()), None)
        if match is None:
            raise SystemExit(f"Missing CIC input for RF-COMLINK: {fragment}")
        return match
    return (
        select("DISTANCE_GROUND_STATION"),
        select("GEOMETRICAL_VISIBILITY_GROUND_STATION"),
        select("SATELLITE_DIRECTION-GROUND_STATION"),
    )


def payload_rate_profile(data_handling: dict, distance_file: Path, destination: Path) -> Path | None:
    """Build the optional CIC payload-generation profile from satellite.json.

    RF-COMLINK's DataHandling model needs a time series, not merely one
    number.  The run's distance CIC provides the authoritative mission time
    grid, so the generated payload profile remains aligned with Simu-CIC.
    """
    payload = data_handling.get("payload_binary_rate")
    if not isinstance(payload, dict) or payload.get("mode") == "none":
        return None
    if payload.get("mode") != "periodic":
        raise SystemExit("Unsupported RF-COMLINK payload_binary_rate mode")
    try:
        rate = float(payload["rate_bps"])
        active_duration = float(payload["active_duration_s"])
        repeat_period = float(payload["repeat_period_s"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SystemExit("Invalid RF-COMLINK periodic payload_binary_rate configuration") from exc
    if rate <= 0 or active_duration <= 0 or repeat_period <= 0 or active_duration > repeat_period:
        raise SystemExit("Invalid RF-COMLINK periodic payload_binary_rate values")

    timestamps: list[tuple[float, float]] = []
    for line in distance_file.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        fields = line.split()
        if len(fields) < 2:
            continue
        try:
            mjd, seconds = float(fields[0]), float(fields[1])
        except ValueError:
            continue
        if 30000 <= mjd <= 100000 and -1 <= seconds <= 172800:
            timestamps.append((mjd, seconds))
    if len(timestamps) < 2:
        raise SystemExit(f"Cannot build RF-COMLINK payload profile: no usable time grid in {distance_file}")

    start_seconds = timestamps[0][0] * 86400 + timestamps[0][1]
    lines = [
        "CIC_MEM_VERS = 2.0",
        f"CREATION_DATE = {datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}",
        "ORIGINATOR = digital-thread",
        "",
        "META_START",
        "",
        "COMMENT = days (MJD), sec (UTC), payload instantaneous data rate (bits/s)",
        "COMMENT = Generated from satellite.json data_handling.payload_binary_rate",
        "OBJECT_NAME = Sat",
        "USER_DEFINED_PROTOCOL = NONE",
        "USER_DEFINED_CONTENT = PAYLOAD_DATA_RATE",
        "USER_DEFINED_SIZE = 1",
        "USER_DEFINED_TYPE = REAL",
        "USER_DEFINED_UNIT = bits/s",
        "TIME_SYSTEM = UTC",
        "",
        "META_STOP",
        "",
    ]
    for mjd, seconds in timestamps:
        elapsed = mjd * 86400 + seconds - start_seconds
        active = (elapsed % repeat_period) < active_duration
        lines.append(f"{mjd:.9f}\t{seconds:.6f}\t{rate if active else 0:.9f}")
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination


def update_link(
    xml_path: Path,
    link: dict,
    station_id: str | None,
    ground_station: dict[str, object] | None,
    cic: tuple[Path, Path, Path],
    ephemeris_dir: Path,
    data_handling: dict,
    payload_profile: Path | None,
) -> None:
    tree = ET.parse(xml_path)
    root = tree.getroot()
    system = link.get("system") or {}
    # The run manifest is JSON-facing and therefore keeps the satellite
    # schema's camelCase field name.  Accept the snake_case alias as well so
    # this low-level writer remains compatible with manually authored input
    # manifests.
    antenna = link.get("spacecraftAntenna") or link.get("spacecraft_antenna") or {}
    propagation = link.get("propagation") or {}
    run_geometry = link.get("run_geometry") or {}
    direction = link.get("direction")

    text(root, "Name", link.get("name"))
    system_node = root.find("SystemParameters")
    if system_node is None:
        system_node = ET.SubElement(root, "SystemParameters")
    text(system_node, "LinkType", direction)
    text(system_node, "FrequencyBand", system.get("frequency_band"))
    text(system_node, "Frequency", system.get("frequency_mhz"))
    text(system_node, "DataRate", system.get("data_rate_bps"))
    text(system_node, "DataRateUnit", "bit")
    text(system_node, "BitErrorRate", system.get("bit_error_rate"))
    text(system_node, "RequiredEbN0", system.get("required_ebn0_db"))
    text(system_node, "ManualEbN0", str(bool(system.get("required_ebn0_manual", False))).lower())
    modulation_model = system_node.find("Modulation")
    if modulation_model is not None:
        text(modulation_model, "Acronym", system.get("modulation"))

    ground = root.find("GroundStation")
    if ground is not None and station_id:
        text(ground, "Code", (ground_station or {}).get("code", station_id))
        text(ground, "Location", (ground_station or {}).get("location", station_id))
        text(ground, "Band", (ground_station or {}).get("band", system.get("frequency_band")))
        if ground_station:
            for field, key in (("Network", "network"), ("Longitude", "longitude"), ("Latitude", "latitude"),
                               ("Altitude", "altitude"), ("MinElevation", "min_elevation"), ("Diameter", "diameter")):
                text(ground, field, ground_station[key])
            set_distribution_triplet(ground, "Eirp", ground_station["eirp"])
            set_distribution_triplet(ground, "GpT", ground_station["gpt"])
            set_distribution_triplet(ground, "GainRx", ground_station["gain_rx"])
            set_distribution_triplet(ground, "PointingLossRx", ground_station["pointing_rx"])
            set_distribution_triplet(ground, "AxialRatioRx", ground_station["axial_rx"])
            set_distribution_triplet(ground, "PointingLossTx", ground_station["pointing_tx"])
            set_distribution_triplet(ground, "AxialRatioTx", ground_station["axial_tx"])

    emission = root.find("EmissionData")
    reception = root.find("ReceptionData")
    if emission is not None and direction == "EarthSpace" and ground_station:
        # The transmitter is the selected ground station, not the spacecraft.
        # Keep RF-COMLINK in database mode and copy the resolved record so the
        # generated scenario is self-contained and opens directly in its GUI.
        text(emission, "EarthDeviceType", "Database")
        text(emission, "GroundStationManualSetting", "true")
        text(emission, "EirpManual", "true")
        set_distribution_triplet(emission, "Eirp", ground_station["eirp"])
        set_distribution_triplet(emission, "PointingLoss", ground_station["pointing_tx"])
        set_distribution_triplet(emission, "AxialRatio", ground_station["axial_tx"])
    if reception is not None and direction == "SpaceEarth" and ground_station:
        # For a downlink the receiver is the same selected ground station as
        # the uplink transmitter.  Its RF hardware comes from the installed
        # RF-COMLINK station catalogue, not from the spacecraft antenna.
        text(reception, "EarthDeviceType", "Database")
        text(reception, "GroundStationManualSetting", "true")
        text(reception, "GpTManual", "true")
        set_distribution_triplet(reception, "Gain", ground_station["gain_rx"])
        set_distribution_triplet(reception, "PointingLoss", ground_station["pointing_rx"])
        set_distribution_triplet(reception, "AxialRatio", ground_station["axial_rx"])
        set_distribution_triplet(reception, "FigureOfMeritRef", ground_station["gpt"])
        set_distribution_triplet(reception, "FigureOfMerit", ground_station["gpt"])
    if emission is not None and direction == "SpaceEarth":
        if antenna.get("eirp_dbw") is not None:
            set_distribution(emission, "Eirp", antenna.get("eirp_dbw"))
            text(emission, "EirpManual", "true")
        elif system.get("transmit_power_dbm") is not None:
            # Let RF-COMLINK calculate EIRP from the explicitly provided
            # transmitter power, gain and losses.
            text(emission, "EirpManual", "false")
            set_distribution(emission, "TransmitPower", system.get("transmit_power_dbm"))
            text(emission, "PowerUnit", "dBm")
        if antenna.get("gain_db") is not None:
            set_distribution(emission, "Gain", antenna.get("gain_db"))
        if antenna.get("pointing_loss_db") is not None:
            set_distribution(emission, "PointingLoss", antenna.get("pointing_loss_db"))
        if antenna.get("axial_ratio_db") is not None:
            set_distribution(emission, "AxialRatio", antenna.get("axial_ratio_db"))
    if reception is not None and direction == "EarthSpace":
        if antenna.get("gain_db") is not None:
            set_distribution(reception, "Gain", antenna.get("gain_db"))
        if antenna.get("pointing_loss_db") is not None:
            set_distribution(reception, "PointingLoss", antenna.get("pointing_loss_db"))
        if antenna.get("axial_ratio_db") is not None:
            set_distribution(reception, "AxialRatio", antenna.get("axial_ratio_db"))
        if antenna.get("figure_of_merit_db_per_k") is not None:
            text(reception, "GpTManual", "true")
            set_distribution(reception, "FigureOfMeritRef", antenna.get("figure_of_merit_db_per_k"))
            set_distribution(reception, "FigureOfMerit", antenna.get("figure_of_merit_db_per_k"))

    system_temperature = run_geometry.get("system_temperature_k")
    if reception is not None and isinstance(system_temperature, (int, float)) and system_temperature > 0:
        text(reception, "SystemTemperatureManual", "true")
        set_distribution(reception, "SystemTemperature", system_temperature)

    propagation_node = root.find("Propagation")
    if propagation_node is not None:
        if "atmospheric_loss_db" in propagation:
            text(propagation_node, "AtmosphericLoss", propagation.get("atmospheric_loss_db"))
            text(propagation_node, "IsAtmosphericLossManual", "true")
        if "weather_unavailability_percent" in propagation:
            text(propagation_node, "WeatherIndisponibility", propagation.get("weather_unavailability_percent"))
        if isinstance(run_geometry.get("mean_range_km"), (int, float)):
            text(propagation_node, "Range", run_geometry["mean_range_km"])
        if isinstance(run_geometry.get("mean_elevation_deg"), (int, float)):
            text(propagation_node, "Elevation", run_geometry["mean_elevation_deg"])
        distance, visibility, direction = cic
        set_file_reference(propagation_node, "RangeFile", distance, ephemeris_dir)
        set_file_reference(propagation_node, "VisibilityFile", visibility, ephemeris_dir)
        set_file_reference(propagation_node, "SatelliteDirectionFile", direction, ephemeris_dir)

    handling_node = root.find("DataHandling")
    if handling_node is not None:
        text(handling_node, "InitialMemoryUsage", data_handling.get("initial_memory_usage_bits"))
        text(handling_node, "InitialMemoryUsageDisplayUnit", "Bits")
        text(handling_node, "MemoryCapacity", data_handling.get("memory_capacity_bits"))
        text(handling_node, "MemoryCapacityDisplayUnit", "Bits")
        # A payload-generation profile only belongs to the payload downlink;
        # housekeeping and telecommand nevertheless expose the same shared
        # storage capacity for an auditable, non-zero data-handling model.
        if payload_profile is not None and link.get("id") == "payload-telemetry":
            set_file_reference(handling_node, "PayloadBinayRateFile", payload_profile, ephemeris_dir)

    tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.inputs.read_text(encoding="utf-8"))
    validation = manifest.get("validation") or {}
    if validation.get("status") != "ready":
        raise SystemExit("RF-COMLINK inputs are blocked: " + ", ".join(validation.get("missing", [])))
    links = manifest.get("links") or []
    if not links:
        raise SystemExit("RF-COMLINK inputs contain no links")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rf-comlink-") as temp:
        work = Path(temp)
        with zipfile.ZipFile(args.template) as archive:
            archive.extractall(work)
        files = sorted((work / "links").glob("*.xml"))
        if len(files) < len(links):
            raise SystemExit(f"template exposes {len(files)} link files, but {len(links)} are required")
        station = manifest.get("selected_ground_station_id")
        run_dir = args.inputs.parents[2]
        cic = cic_sources(run_dir, manifest.get("cic_inputs", []))
        geometry = manifest.get("run_geometry") or {}
        data_handling = manifest.get("data_handling") or {}
        if not isinstance(data_handling, dict):
            raise SystemExit("RF-COMLINK data_handling must be an object")
        ephemeris_dir = work / "ephemeris"
        payload_profile = payload_rate_profile(data_handling, cic[0], work / "payload-data-rate.TXT")
        for file, link in zip(files, links):
            # Database entries are band-specific, so resolve each link rather
            # than incorrectly reusing the first link's S/X-band equipment.
            station_record = find_ground_station_database_record(args.template, station, (link.get("system") or {}).get("frequency_band"))
            link_geometry = {
                "mean_range_km": geometry.get("mean_range_km"),
                "mean_elevation_deg": geometry.get("mean_elevation_deg"),
                "system_temperature_k": (geometry.get("system_temperature_k_by_link") or {}).get(link.get("id")),
            }
            update_link(file, {**link, "run_geometry": link_geometry}, station, station_record, cic, ephemeris_dir, data_handling, payload_profile)
        # The official empty scenario contains three placeholder links.  A
        # run must expose only the links declared by its satellite.json.
        for file in files[len(links):]:
            report = work / "reports" / f"{file.stem}.html"
            file.unlink()
            report.unlink(missing_ok=True)
        with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file in work.rglob("*"):
                if file.is_file():
                    archive.write(file, file.relative_to(work).as_posix())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
