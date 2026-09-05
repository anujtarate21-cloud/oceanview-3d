"""
file_ingestor.py - Ingests user-uploaded NetCDF, CSV, and JSON datasets
to provide instant statistical summary context for the AI Chatbox and 3D visualization.
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, Any

try:
    import xarray as xr
except ImportError:
    xr = None

BASE_DIR = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR = BASE_DIR / "public" / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def ingest_uploaded_file(file_path: Path, filename: str) -> Dict[str, Any]:
    """
    Parses an uploaded file (NetCDF, CSV, or JSON) and returns metadata and statistical context.
    """
    ext = file_path.suffix.lower()

    if ext in [".csv", ".txt"]:
        return _ingest_csv(file_path, filename)
    elif ext in [".json", ".geojson"]:
        return _ingest_json(file_path, filename)
    elif ext in [".nc", ".nc4", ".netcdf"]:
        return _ingest_netcdf(file_path, filename)
    else:
        return {
            "filename": filename,
            "status": "unsupported_format",
            "summary": f"Uploaded file '{filename}' has extension '{ext}', which is not currently indexed."
        }


def _ingest_csv(file_path: Path, filename: str) -> Dict[str, Any]:
    try:
        df = pd.read_csv(file_path)
        rows, cols = df.shape
        col_names = list(df.columns)
        
        numeric_summary = {}
        for col in col_names:
            if pd.api.types.is_numeric_dtype(df[col]):
                numeric_summary[col] = {
                    "min": float(df[col].min()),
                    "max": float(df[col].max()),
                    "mean": float(df[col].mean())
                }

        summary_text = (
            f"Successfully ingested tabular dataset '{filename}' containing {rows} rows and {cols} columns: "
            f"{', '.join(col_names[:6])}. "
        )
        if "lat" in df.columns or "latitude" in df.columns:
            summary_text += "Geospatial coordinate columns detected (lat/lon). "

        return {
            "filename": filename,
            "type": "tabular_csv",
            "rows": rows,
            "columns": col_names,
            "numeric_metrics": numeric_summary,
            "summary": summary_text
        }
    except Exception as e:
        return {"filename": filename, "error": str(e), "summary": f"Error parsing CSV '{filename}': {str(e)}"}


def _ingest_json(file_path: Path, filename: str) -> Dict[str, Any]:
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        if isinstance(data, list):
            count = len(data)
            sample_keys = list(data[0].keys()) if count > 0 and isinstance(data[0], dict) else []
            summary_text = f"JSON array with {count} records. Keys: {', '.join(sample_keys[:5])}."
        elif isinstance(data, dict):
            keys = list(data.keys())
            summary_text = f"JSON object containing top-level fields: {', '.join(keys[:8])}."
        else:
            summary_text = "JSON payload ingested."

        return {
            "filename": filename,
            "type": "json",
            "summary": f"Successfully loaded '{filename}': {summary_text}"
        }
    except Exception as e:
        return {"filename": filename, "error": str(e), "summary": f"Error parsing JSON '{filename}': {str(e)}"}


def _ingest_netcdf(file_path: Path, filename: str) -> Dict[str, Any]:
    if xr is None:
        return {
            "filename": filename,
            "type": "netcdf",
            "summary": f"Uploaded NetCDF file '{filename}'. (xarray library not loaded in runtime)."
        }

    try:
        ds = xr.open_dataset(file_path)
        vars_list = list(ds.data_vars)
        dims_list = list(ds.dims)
        
        summary_text = (
            f"NetCDF dataset '{filename}' parsed with dimensions {dims_list} and variables: {vars_list}. "
            f"Attributes: {dict(list(ds.attrs.items())[:3])}."
        )
        ds.close()
        return {
            "filename": filename,
            "type": "netcdf",
            "dimensions": dims_list,
            "variables": vars_list,
            "summary": summary_text
        }
    except Exception as e:
        return {"filename": filename, "error": str(e), "summary": f"Error reading NetCDF '{filename}': {str(e)}"}
