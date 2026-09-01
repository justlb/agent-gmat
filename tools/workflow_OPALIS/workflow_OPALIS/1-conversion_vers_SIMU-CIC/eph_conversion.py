#!/usr/bin/env python3
"""
Converts a PSIMU file, CCSDS OEM file, or GMAT ephemeris file to SIMU-cic format
- Handles GMAT format with headers
- Preserves CCSDS OEM positions in kilometers and velocities in km/s
- Converts legacy PSIMU positions from meters to kilometers
- Removes duplicates based on (MJD, seconds) keeping the first occurrence
- Supports CCSDS OEM format with metadata headers
"""

import argparse
import json
from datetime import datetime, timedelta, timezone
import math
import re
import os
import glob

def iso_to_mjd_seconds(iso_str):
    """Converts an ISO date to (MJD, seconds_utc)"""
    # Gère les formats avec et sans millisecondes
    if '.' not in iso_str:
        iso_str = iso_str + '.000'
    
    # Gère le format CCSDS (peut avoir Z à la fin)
    iso_str = iso_str.replace('Z', '+00:00')
    dt = datetime.fromisoformat(iso_str)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    MJD_2000_01_01 = 51544.0
    delta = dt - datetime(2000, 1, 1)
    mjd = MJD_2000_01_01 + delta.days + delta.seconds / 86400.0
    seconds = dt.hour * 3600 + dt.minute * 60 + dt.second + dt.microsecond / 1e6
    return mjd, seconds

def remove_duplicates(data_lines, key_func):
    """
    Removes duplicates keeping the first occurrence.
    key_func: function that extracts the comparison key (e.g., (mjd, sec))
    """
    seen = set()
    unique_lines = []
    for line in data_lines:
        key = key_func(line)
        if key not in seen:
            seen.add(key)
            unique_lines.append(line)
    return unique_lines

def parse_psimu_attitude(filename):
    """Extracts quaternions from a PSIMU file (attitude)"""
    data_lines = []
    with open(filename, 'r', encoding='utf-8') as f:
        for line in f:
            match = re.match(r'\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})', line)
            if match:
                parts = line.strip().split()
                if len(parts) >= 5:
                    mjd, sec = iso_to_mjd_seconds(parts[0])
                    q0 = float(parts[1])
                    q1 = float(parts[2])
                    q2 = float(parts[3])
                    q3 = float(parts[4])
                    data_lines.append((mjd, sec, q0, q1, q2, q3))
    
    # Suppression des doublons basée sur (mjd, sec)
    original_count = len(data_lines)
    data_lines = remove_duplicates(data_lines, lambda x: (x[0], x[1]))
    removed_count = original_count - len(data_lines)
    if removed_count > 0:
        print(f"   [info] {removed_count} duplicate(s) removed from attitude data")
    
    return data_lines

GMAT_A1MJD_TO_STANDARD_MJD = 29999.5
# A1 = TAI + 0.0343817 s et TAI-UTC = 37 s pour l'epoque 2025 du fichier GMAT.
GMAT_A1_MINUS_UTC_SECONDS = 37.0343817


def gmat_a1mjd_to_mjd_seconds(a1_modified_julian):
    """Convertit l'epoque A1ModJulian GMAT en (jour MJD UTC, secondes UTC)."""
    utc_mjd = (
        float(a1_modified_julian)
        + GMAT_A1MJD_TO_STANDARD_MJD
        - GMAT_A1_MINUS_UTC_SECONDS / 86400.0
    )
    mjd_day = math.floor(utc_mjd)
    seconds = (utc_mjd - mjd_day) * 86400.0
    # Neutralise les erreurs flottantes autour d'une frontiere de jour.
    if seconds >= 86400.0 - 1e-5:
        mjd_day += 1
        seconds = 0.0
    elif seconds < 1e-5:
        seconds = 0.0
    return mjd_day, seconds


def parse_gmat_ephemeris(filename):
    """
    Extracts ephemeris from a GMAT ephemeris file
    Format: A1ModJulian, ElapsedSecs, X, Y, Z, Vx, Vy, Vz
    Units: positions in km, velocities in km/s
    """
    data_lines = []
    
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
        # Trouver la ligne d'en-tête et commencer après
        start_idx = 0
        for i, line in enumerate(lines):
            # Cherche la ligne qui contient les noms de colonnes
            if 'Sat.A1ModJulian' in line or 'MJD' in line or 'Sat.X' in line:
                start_idx = i + 1
                break
        
        # Traiter les lignes de données
        for line in lines[start_idx:]:
            line = line.strip()
            if not line:
                continue
            
            parts = line.split()
            if len(parts) >= 8:  # MJD, ElapsedSecs, X, Y, Z, Vx, Vy, Vz
                try:
                    mjd, seconds_utc = gmat_a1mjd_to_mjd_seconds(float(parts[0]))
                    # ElapsedSecs est informatif : A1ModJulian contient deja
                    # l'avancement temporel. L'utiliser comme seconde CIC
                    # compterait la duree une deuxieme fois apres chaque jour.
                    x = float(parts[2])      # déjà en km
                    y = float(parts[3])      # déjà en km
                    z = float(parts[4])      # déjà en km
                    vx = float(parts[5])     # déjà en km/s
                    vy = float(parts[6])     # déjà en km/s
                    vz = float(parts[7])     # déjà en km/s
                    
                    data_lines.append((mjd, seconds_utc, x, y, z, vx, vy, vz))
                except (ValueError, IndexError):
                    continue
    
    # Suppression des doublons basée sur (mjd, sec)
    original_count = len(data_lines)
    data_lines = remove_duplicates(data_lines, lambda x: (x[0], x[1]))
    removed_count = original_count - len(data_lines)
    if removed_count > 0:
        print(f"   [info] {removed_count} duplicate(s) removed from ephemeris data")
    
        print("   [info] Data already in kilometers (no conversion needed)")
    
    return data_lines

def parse_ccsds_oem(filename):
    """
    Extracts ephemeris from a CCSDS OEM file
    Format: DATE, X, Y, Z, Vx, Vy, Vz
    CCSDS OEM state-vector units are km and km/s.
    """
    data_lines = []
    in_metadata = True
    
    with open(filename, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            
            # Détecte la fin du méta-bloc
            if line == 'META_START':
                in_metadata = True
                continue
            if line == 'META_STOP':
                in_metadata = False
                continue
            
            # Si on est dans le méta-bloc, on cherche des indices sur les unités
            if in_metadata:
                continue
            
            # Traite les lignes de données
            # GMAT writes CCSDS OEM epochs as ISO timestamps without a `Z`
            # suffix (for example `2026-08-01T00:00:00.000`).  The suffix is
            # optional in CCSDS data, so accept both forms before parsing the
            # six Cartesian state components.
            parts = line.split()
            if len(parts) >= 7 and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?', parts[0]):
                if len(parts) >= 7:  # Date + 6 valeurs
                    try:
                        mjd, sec = iso_to_mjd_seconds(parts[0])
                        
                        # Lecture des valeurs
                        x = float(parts[1])
                        y = float(parts[2])
                        z = float(parts[3])
                        vx = float(parts[4])
                        vy = float(parts[5])
                        vz = float(parts[6])
                        
                        # CCSDS 502.0 OEM defines Cartesian position in km and
                        # velocity in km/s. A magnitude heuristic would corrupt
                        # valid MEO, GEO, lunar, or interplanetary coordinates.
                        data_lines.append((mjd, sec, x, y, z, vx, vy, vz))
                    except (ValueError, IndexError):
                        continue
    
    # Suppression des doublons basée sur (mjd, sec)
    original_count = len(data_lines)
    data_lines = remove_duplicates(data_lines, lambda x: (x[0], x[1]))
    removed_count = original_count - len(data_lines)
    if removed_count > 0:
        print(f"   [info] {removed_count} duplicate(s) removed from ephemeris data")
    
    print("   CCSDS OEM data preserved in km and km/s")
    
    return data_lines

def parse_psimu_ephemeris(filename):
    """
    Extracts ephemeris from a PSIMU file
    Expected format: DATE, X(m), Y(m), Z(m), Vx(m/s), Vy(m/s), Vz(m/s)
    """
    data_lines = []
    with open(filename, 'r', encoding='utf-8') as f:
        for line in f:
            match = re.match(r'\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})', line)
            if match:
                parts = line.strip().split()
                if len(parts) >= 7:  # Au moins date + 6 valeurs (X,Y,Z,Vx,Vy,Vz)
                    mjd, sec = iso_to_mjd_seconds(parts[0])
                    # Conversion m -> km (division par 1000)
                    x_km = float(parts[1]) / 1000.0
                    y_km = float(parts[2]) / 1000.0
                    z_km = float(parts[3]) / 1000.0
                    vx_kms = float(parts[4]) / 1000.0
                    vy_kms = float(parts[5]) / 1000.0
                    vz_kms = float(parts[6]) / 1000.0
                    data_lines.append((mjd, sec, x_km, y_km, z_km, vx_kms, vy_kms, vz_kms))
    
    # Suppression des doublons basée sur (mjd, sec)
    original_count = len(data_lines)
    data_lines = remove_duplicates(data_lines, lambda x: (x[0], x[1]))
    removed_count = original_count - len(data_lines)
    if removed_count > 0:
        print(f"   [info] {removed_count} duplicate(s) removed from ephemeris data")
    
    return data_lines

def detect_file_type(filename):
    """Detects if the file contains quaternions (attitude) or positions (ephemeris)"""
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read(2000)  # Lit les premières lignes
        
        # Détecte le format GMAT
        if 'Sat.A1ModJulian' in content or 'Sat.X' in content:
            return "gmat_ephemeris"
        
        # Détecte le format CCSDS OEM
        if 'CCSDS_OEM_VERS' in content:
            return "ccsds_oem"
        
        # Détecte le format PSIMU
        for line in content.split('\n'):
            if re.match(r'\s*\d{4}-\d{2}-\d{2}', line):
                parts = line.strip().split()
                if len(parts) == 5:
                    return "attitude"
                elif len(parts) >= 7:
                    return "ephemeris"
    return "unknown"

def write_simu_cic_attitude(data, output_filename, start_date_iso=None, stop_date_iso=None):
    """Writes an attitude file in SIMU-cic format"""
    if start_date_iso is None or stop_date_iso is None:
        start_date_iso, stop_date_iso = get_time_range(data)
    with open(output_filename, 'w', encoding='utf-8') as f:
        f.write("CIC_AEM_VERS = 2.0\n")
        f.write(f"CREATION_DATE  = {datetime.now().isoformat(timespec='milliseconds')}\n")
        f.write("ORIGINATOR     = CNES\n\n")
        f.write("META_START\n\n")
        f.write("COMMENT days (MJD), sec (UTC), q0 (real part), q1, q2, q3\n\n")
        f.write("OBJECT_NAME = Sat\n")
        f.write("OBJECT_ID = Sat\n\n")
        f.write("REF_FRAME_A = ICRF\n")
        f.write("REF_FRAME_B = SC_BODY_1\n")
        f.write("ATTITUDE_DIR = A2B\n")
        f.write("TIME_SYSTEM = UTC\n")
        f.write(f"START_TIME = {start_date_iso}\n")
        f.write(f"STOP_TIME = {stop_date_iso}\n")
        f.write("ATTITUDE_TYPE = QUATERNION\n")
        f.write("QUATERNION_TYPE = FIRST\n\n")
        f.write("META_STOP\n\n")
        
        for mjd, sec, q0, q1, q2, q3 in data:
            f.write(f"{int(mjd)}\t{sec:.6f}\t{q0:.9f}\t{q1:.9f}\t{q2:.9f}\t{q3:.9f}\n")

def write_simu_cic_ephemeris(data, output_filename, start_date_iso=None, stop_date_iso=None):
    """
    Writes an ephemeris file in SIMU-cic format
    Positions in km, velocities in km/s (CCSDS OEM standard)
    """
    if start_date_iso is None or stop_date_iso is None:
        start_date_iso, stop_date_iso = get_time_range(data)
    with open(output_filename, 'w', encoding='utf-8') as f:
        f.write("CIC_OEM_VERS = 2.0\n")
        f.write(f"CREATION_DATE  = {datetime.now().isoformat(timespec='milliseconds')}\n")
        f.write("ORIGINATOR     = CNES\n\n")
        f.write("META_START\n\n")
        f.write("COMMENT days (MJD), sec (UTC), X(km), Y(km), Z(km), Vx(km/s), Vy(km/s), Vz(km/s)\n\n")
        f.write("OBJECT_NAME = Sat\n")
        f.write("OBJECT_ID = Sat\n\n")
        f.write("CENTER_NAME = EARTH\n")
        f.write("REF_FRAME   = ICRF\n")
        f.write("TIME_SYSTEM = UTC\n")
        f.write(f"START_TIME = {start_date_iso}\n")
        f.write(f"STOP_TIME = {stop_date_iso}\n\n")
        f.write("META_STOP\n\n")
        
        for mjd, sec, x, y, z, vx, vy, vz in data:
            f.write(f"{int(mjd)}\t{sec:.6f}\t{x:.6f}\t{y:.6f}\t{z:.6f}\t{vx:.6f}\t{vy:.6f}\t{vz:.6f}\n")

def get_time_range_legacy(data):
    """Extract start and stop times from data"""
    if not data:
        return "2000-01-01T00:00:00.000", "2000-01-02T00:00:00.000"
    
    # On utilise les dates ISO des premières et dernières lignes
    # Pour simplifier, on utilise des valeurs par défaut
    return "2000-01-01T00:00:00.000", "2000-01-02T00:00:00.000"

def get_time_range(data):
    """Retourne les dates ISO des premiere et derniere lignes CIC."""
    if not data:
        return "2000-01-01T00:00:00.000", "2000-01-02T00:00:00.000"

    def to_iso(sample):
        mjd_day = math.floor(float(sample[0]))
        seconds = float(sample[1])
        date = datetime(1858, 11, 17) + timedelta(days=mjd_day, seconds=seconds)
        return date.isoformat(timespec="milliseconds")

    return to_iso(data[0]), to_iso(data[-1])


def downsample_records(data, max_records):
    """Keep a deterministic, evenly distributed subset of an ephemeris.

    GMAT can write tens of thousands of state records for long LEO runs.  That
    is useful as a raw OEM archive, but can make the Simu-CIC GUI unstable or
    impractically slow.  Simu-CIC receives a bounded copy while the original
    OEM remains untouched in the mission run directory.
    """
    if not max_records or len(data) <= max_records:
        return data, 1
    if max_records < 2:
        raise ValueError("max_records must be at least 2")

    # Use index positions rather than a floating time accumulator: input
    # records can have adaptive GMAT propagation steps and this always keeps
    # the exact first and final state.
    indexes = [round(index * (len(data) - 1) / (max_records - 1)) for index in range(max_records)]
    selected = [data[index] for index in indexes]
    stride = int(math.ceil(float(len(data)) / float(max_records)))
    return selected, stride


def convert_ephemeris(input_filename, output_filename, max_records=None):
    """Convert one supported ephemeris deterministically, without UI prompts.

    This is the API used by the application workflow.  It intentionally keeps
    the historical interactive mode below for engineers who launch this file
    manually with no arguments.
    """
    file_type = detect_file_type(input_filename)
    if file_type == "attitude":
        data = parse_psimu_attitude(input_filename)
        writer = write_simu_cic_attitude
    elif file_type == "ephemeris":
        data = parse_psimu_ephemeris(input_filename)
        writer = write_simu_cic_ephemeris
    elif file_type == "gmat_ephemeris":
        data = parse_gmat_ephemeris(input_filename)
        writer = write_simu_cic_ephemeris
    elif file_type == "ccsds_oem":
        data = parse_ccsds_oem(input_filename)
        writer = write_simu_cic_ephemeris
    else:
        raise ValueError("Unsupported ephemeris format: {0}".format(input_filename))

    if not data:
        raise ValueError("No convertible records found in: {0}".format(input_filename))
    source_records = len(data)
    data, sample_stride = downsample_records(data, max_records)
    parent = os.path.dirname(os.path.abspath(output_filename))
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    writer(data, output_filename)
    if not os.path.isfile(output_filename):
        raise IOError("SIMU-CIC ephemeris was not generated: {0}".format(output_filename))
    return {
        "input": os.path.abspath(input_filename),
        "output": os.path.abspath(output_filename),
        "records": len(data),
        "source_records": source_records,
        "sample_stride": sample_stride,
        "type": file_type,
    }


# ========== PROGRAMME PRINCIPAL ==========
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert GMAT/CCSDS/PSIMU ephemeris to SIMU-CIC CIC-OEM")
    parser.add_argument("input", nargs="?", help="source ephemeris (.oem, .eph or .txt)")
    parser.add_argument("--output", "-o", help="destination CIC-OEM file")
    parser.add_argument("--json", action="store_true", help="print conversion metadata as JSON")
    parser.add_argument(
        "--max-records",
        type=int,
        default=None,
        help="maximum number of CIC records to write (raw GMAT input is not modified)",
    )
    arguments = parser.parse_args()
    if arguments.input:
        source = os.path.abspath(arguments.input)
        destination = os.path.abspath(arguments.output or (os.path.splitext(source)[0] + "_SIMU.txt"))
        try:
            result = convert_ephemeris(source, destination, arguments.max_records)
        except Exception as error:
            parser.error(str(error))
        if arguments.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print("Converted {0} record(s): {1}".format(result["records"], result["output"]))
        raise SystemExit(0)

    print("=" * 60)
    print("🔄 PSIMU/CCSDS/GMAT → SIMU-cic CONVERTER (WITH DEDUPLICATION)")
    print("   (Attitude + Ephemeris with automatic unit detection)")
    print("=" * 60)
    print()
    
    # Cherche tous les fichiers possibles
    patterns = ["*_1.txt", "*_psimu.txt", "*.txt", "EPH_GMAT.txt", "*.oem", "*.eph"]
    fichiers_trouves = []
    
    for pattern in patterns:
        fichiers_trouves.extend(glob.glob(pattern))
    
    # Filtre pour éviter de reconvertir les fichiers déjà convertis
    fichiers_psimu = [f for f in fichiers_trouves if "_SIMU" not in f and "_CONVERTI" not in f]
    
    # Si aucun fichier trouvé, on cherche spécifiquement EPH_GMAT.txt
    if not fichiers_psimu:
        if os.path.exists("EPH_GMAT.txt"):
            fichiers_psimu = ["EPH_GMAT.txt"]
        else:
            print("❌ No PSIMU, CCSDS or GMAT files found!")
            input("Press Enter to quit...")
            exit()
    
    print(f"📁 {len(fichiers_psimu)} file(s) found:")
    for f in fichiers_psimu:
        print(f"   - {f}")
    print()
    
    success = 0
    failures = 0
    
    for input_file in fichiers_psimu:
        print(f"🔄 Processing: {input_file}")
        
        # Détection automatique du type
        file_type = detect_file_type(input_file)
        print(f"   📋 Detected type: {file_type}")
        
        # Génère le nom du fichier de sortie
        base = os.path.splitext(input_file)[0]
        output_file = f"{base}_SIMU.txt"
        
        if file_type == "attitude":
            data = parse_psimu_attitude(input_file)
            if data:
                write_simu_cic_attitude(data, output_file)
                print(f"   ✅ {len(data)} unique quaternions converted → {output_file}")
                success += 1
            else:
                print(f"   ⚠️ No attitude data found")
                failures += 1
                
        elif file_type == "ephemeris":
            data = parse_psimu_ephemeris(input_file)
            if data:
                write_simu_cic_ephemeris(data, output_file)
                print(f"   ✅ {len(data)} unique positions converted (m→km, m/s→km/s) → {output_file}")
                success += 1
            else:
                print(f"   ⚠️ No ephemeris data found")
                failures += 1
                
        elif file_type == "gmat_ephemeris":
            data = parse_gmat_ephemeris(input_file)
            if data:
                write_simu_cic_ephemeris(data, output_file)
                print(f"   ✅ {len(data)} unique positions converted → {output_file}")
                success += 1
            else:
                print(f"   ⚠️ No ephemeris data found")
                failures += 1
                
        elif file_type == "ccsds_oem":
            data = parse_ccsds_oem(input_file)
            if data:
                write_simu_cic_ephemeris(data, output_file)
                print(f"   ✅ {len(data)} unique positions converted → {output_file}")
                success += 1
            else:
                print(f"   ⚠️ No ephemeris data found")
                failures += 1
        else:
            print(f"   ❌ Unknown type (check file format)")
            failures += 1
        print()
    
    print("=" * 60)
    print(f"📊 SUMMARY: {success} file(s) converted, {failures} failure(s)")
    print("=" * 60)
    input("Press Enter to close...")
