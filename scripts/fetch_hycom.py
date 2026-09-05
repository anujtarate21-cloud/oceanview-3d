"""
fetch_hycom.py — OceanView 3D Automated HYCOM Data Fetcher
Queries the HYCOM NCSS (NetCDF Subset Service) for a specific date,
downloads only the Indian Ocean bounding box (~8-15MB),
and saves it as a local NetCDF file for preprocessing.

Usage:
    python scripts/fetch_hycom.py --date 2024-10-12
    python scripts/fetch_hycom.py --date 2024-10-12 --output-dir dataset
"""

import argparse
import os
import sys
import ssl
import time
import urllib.request
import urllib.parse
from datetime import datetime

# HYCOM/NOAA government servers occasionally have expired SSL certificates.
# Create a permissive SSL context for scientific data access (not sensitive data).
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

# Indian Ocean bounding box (lat: 0-25N, lon: 60-95E)
BBOX = {"north": 25.0, "south": 0.0, "west": 60.0, "east": 95.0}

# HYCOM GLBy 0.08-degree resolution, experiment 93.0
HYCOM_NCSS_BASE = "https://ncss.hycom.org/thredds/ncss/GLBy0.08/expt_93.0/ts3z"
VARIABLES = ["water_temp", "salinity"]


def build_hycom_url(date_str: str) -> str:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    time_param = dt.strftime("%Y-%m-%dT00:00:00Z")
    query_parts = []
    for v in VARIABLES:
        query_parts.append(f"var={urllib.parse.quote(v)}")
    for key, val in BBOX.items():
        query_parts.append(f"{key}={val}")
    query_parts += [
        "disableLLSubset=on",
        "disableProjSubset=on",
        "horizStride=1",
        f"time={urllib.parse.quote(time_param)}",
        "accept=netcdf4",
        "addLatLon=true"
    ]
    return f"{HYCOM_NCSS_BASE}?{'&'.join(query_parts)}"


def fetch_with_progress(url: str, output_path: str, timeout: int = 30) -> bool:
    print(f"Connecting to HYCOM NCSS server...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OceanView3D/1.0 (INCOIS SIH26067)"})
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as response:
            total_size = int(response.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 65536
            with open(output_path, "wb") as out_file:
                start_time = time.time()
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    out_file.write(chunk)
                    downloaded += len(chunk)
                    elapsed = time.time() - start_time
                    speed_kbs = (downloaded / 1024) / max(elapsed, 0.1)
                    if total_size:
                        pct = (downloaded / total_size) * 100
                        print(f"\r  {downloaded/1024/1024:.1f}MB/{total_size/1024/1024:.1f}MB ({pct:.0f}%) - {speed_kbs:.0f}KB/s", end="", flush=True)
                    else:
                        print(f"\r  Downloaded: {downloaded/1024/1024:.1f}MB - {speed_kbs:.0f}KB/s", end="", flush=True)
            print()
            print(f"Download complete: {downloaded/1024/1024:.1f}MB in {time.time()-start_time:.1f}s")
            return True
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        return False


def fetch_hycom_for_date(date_str: str, output_dir: str = "dataset") -> str:
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        print(f"ERROR: Invalid date format '{date_str}'. Use YYYY-MM-DD.")
        return None

    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"hycom_{date_str}.nc")

    if os.path.exists(output_path) and os.path.getsize(output_path) > 100_000:
        print(f"Cache hit: {output_path} ({os.path.getsize(output_path)/1024/1024:.1f}MB). Skipping download.")
        return output_path

    url = build_hycom_url(date_str)
    print(f"Fetching HYCOM Indian Ocean data for: {date_str}")
    success = fetch_with_progress(url, output_path)

    if success and os.path.exists(output_path) and os.path.getsize(output_path) > 100_000:
        return output_path
    if os.path.exists(output_path):
        os.remove(output_path)
    return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OceanView 3D - Automated HYCOM Data Fetcher")
    parser.add_argument("--date", required=True, help="Date in YYYY-MM-DD format")
    parser.add_argument("--output-dir", default="dataset", help="Output directory (default: dataset/)")
    args = parser.parse_args()

    result = fetch_hycom_for_date(args.date, args.output_dir)
    if result:
        print(f"\nReady for preprocessing:")
        print(f"  python scripts/preprocess_model.py --input {result} --output public/data/")
        sys.exit(0)
    else:
        print("\nFetch failed.")
        sys.exit(1)
