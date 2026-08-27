"""
main.py - OceanView 3D FastAPI Backend
Serves pre-processed ocean model JSON tiles, Argo profiles, coastline, and metadata with CORS, auto-invalidating cache, and GZip compression.
"""

import os
import json
from pathlib import Path
from typing import Optional
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse

app = FastAPI(
    title="OceanView 3D API",
    description="Backend service for INCOIS 3D Ocean Data Visualization Platform (SIH26067)",
    version="1.0.0"
)

# Enable CORS for all frontend origins (Vite dev server, localhost, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enable GZip compression for fast JSON tile streaming (min size 1KB)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Resolve data directory dynamically
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "public" / "data"

if not DATA_DIR.exists():
    DATA_DIR = Path("public/data").resolve()


@lru_cache(maxsize=256)
def _read_json_file_cached(file_path_str: str, mtime: float) -> dict:
    """
    Reads and caches JSON data from disk. 
    Including file mtime in the cache key guarantees automatic cache invalidation
    whenever a JSON file is regenerated on disk!
    """
    path = Path(file_path_str)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path_str}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def read_json(file_path: Path) -> dict:
    """Helper that passes current file modification timestamp to cache."""
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File '{file_path.name}' not found on server")
    mtime = file_path.stat().st_mtime
    return _read_json_file_cached(str(file_path), mtime)


@app.get("/api/health")
async def health_check():
    """Health check endpoint to verify backend status."""
    return {
        "status": "online",
        "service": "OceanView 3D API",
        "data_dir_exists": DATA_DIR.exists(),
        "version": "1.0.0",
        "cached_entries": _read_json_file_cached.cache_info().currsize
    }


@app.post("/api/cache/clear")
async def clear_cache():
    """Manually flushes the backend in-memory cache."""
    _read_json_file_cached.cache_clear()
    return {"message": "Cache successfully cleared", "status": "ok"}


@app.get("/api/metadata")
async def get_metadata():
    """Returns dataset metadata (variables, depth levels, spatial extent, units, global min/max)."""
    meta_path = DATA_DIR / "metadata.json"
    return read_json(meta_path)


@app.get("/api/model-data")
async def get_model_data(
    var: str = Query("temperature", description="Variable name: 'temperature' or 'salinity'"),
    depth: int = Query(0, description="Depth level in meters (e.g., 0, 50, 100, 200, 500, 1000)"),
    timestep: int = Query(0, description="Timestep index (default: 0)")
):
    """
    Returns 2D ocean model slice for specified variable, depth, and timestep.
    Matches filename pattern: {var}_d{depth}_t{timestep}.json
    """
    var_clean = var.lower().strip()
    tile_filename = f"{var_clean}_d{depth}_t{timestep}.json"
    tile_path = DATA_DIR / "tiles" / tile_filename

    # Look for nearest depth match if exact depth file not found
    if not tile_path.exists():
        available_tiles = list((DATA_DIR / "tiles").glob(f"{var_clean}_d*_t{timestep}.json"))
        if not available_tiles:
            raise HTTPException(
                status_code=404, 
                detail=f"No tiles found for variable '{var_clean}' at timestep {timestep}"
            )
        
        try:
            depths = [int(p.stem.split('_d')[1].split('_t')[0]) for p in available_tiles]
            nearest_depth = min(depths, key=lambda x: abs(x - depth))
            tile_path = DATA_DIR / "tiles" / f"{var_clean}_d{nearest_depth}_t{timestep}.json"
        except Exception:
            raise HTTPException(
                status_code=404,
                detail=f"Tile '{tile_filename}' not found and could not resolve nearest depth."
            )

    data = read_json(tile_path)
    # Ensure requested_depth is explicitly tagged so frontend knows what was requested vs actual
    data["requested_depth"] = depth
    return data


@app.get("/api/model-data/volume")
async def get_model_volume(
    var: str = Query("temperature", description="Variable name: 'temperature' or 'salinity'"),
    timestep: int = Query(0, description="Timestep index (default: 0)")
):
    """
    Returns all depth slices for one variable+timestep (for full 3D volumetric rendering).
    """
    var_clean = var.lower().strip()
    tile_files = sorted(
        (DATA_DIR / "tiles").glob(f"{var_clean}_d*_t{timestep}.json"),
        key=lambda p: int(p.stem.split('_d')[1].split('_t')[0])
    )

    if not tile_files:
        raise HTTPException(
            status_code=404, 
            detail=f"No volume tiles found for variable '{var_clean}' at timestep {timestep}"
        )

    slices = []
    for tf in tile_files:
        data = read_json(tf)
        slices.append({
            "depth": data.get("depth"),
            "values": data.get("values"),
            "slice_min": data.get("slice_min"),
            "slice_max": data.get("slice_max")
        })

    meta = read_json(DATA_DIR / "metadata.json") if (DATA_DIR / "metadata.json").exists() else {}

    return {
        "variable": var_clean,
        "timestep": timestep,
        "units": meta.get("units", {}).get(var_clean, ""),
        "lats": read_json(tile_files[0]).get("lats", []),
        "lons": read_json(tile_files[0]).get("lons", []),
        "slices_count": len(slices),
        "slices": slices,
        "global_min": meta.get("var_ranges", {}).get(var_clean, {}).get("min"),
        "global_max": meta.get("var_ranges", {}).get(var_clean, {}).get("max")
    }


@app.get("/api/argo/positions")
async def get_argo_positions():
    """Returns list of all active Argo profiling float locations, timestamps, and metadata."""
    pos_path = DATA_DIR / "argo" / "positions.json"
    return read_json(pos_path)


@app.get("/api/argo/profile/{float_id}")
async def get_argo_profile(float_id: str):
    """
    Returns vertical profile data (depths, temperature, salinity) for a specific float.
    """
    clean_id = float_id.replace("/", "_").replace("\\", "_").strip()
    profile_path = DATA_DIR / "argo" / "profiles" / f"{clean_id}.json"

    if not profile_path.exists():
        matching = list((DATA_DIR / "argo" / "profiles").glob(f"*{clean_id}*.json"))
        if matching:
            profile_path = matching[0]
        else:
            raise HTTPException(status_code=404, detail=f"Profile for float ID '{float_id}' not found")

    return read_json(profile_path)


@app.get("/api/coastline")
async def get_coastline():
    """Returns GeoJSON coastline FeatureCollection for geographic 3D boundary rendering."""
    coast_path = DATA_DIR / "coastline.geojson"
    return read_json(coast_path)
