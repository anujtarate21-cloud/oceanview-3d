"""
main.py - OceanView 3D FastAPI Backend
High-performance backend serving pre-processed ocean model JSON tiles, Argo profiles, 
float drift tracking, coastline, and metadata with direct FileResponse streaming, 
HTTP Cache-Control headers, CORS, and GZip compression.
"""

import os
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse
from starlette.middleware.base import BaseHTTPMiddleware

app = FastAPI(
    title="OceanView 3D API",
    description="High-performance backend for INCOIS 3D Ocean Data Visualization Platform (SIH26067)",
    version="1.0.0"
)

# Custom Middleware for HTTP Cache-Control headers (max-age=3600)
class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        if request.method == "GET" and not request.url.path.endswith("/health"):
            response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
        return response

app.add_middleware(CacheControlMiddleware)

# Enable CORS for all frontend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enable GZip compression (minimum 1KB)
app.add_middleware(GZipMiddleware, minimum_size=1000)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "public" / "data"

if not DATA_DIR.exists():
    DATA_DIR = Path("public/data").resolve()


@app.get("/api/health")
async def health_check():
    """Health check endpoint to verify backend status."""
    return {
        "status": "online",
        "service": "OceanView 3D API",
        "data_dir_exists": DATA_DIR.exists(),
        "version": "1.0.0"
    }


@app.get("/api/metadata")
async def get_metadata():
    """Returns dataset metadata (variables, depth levels, timesteps, spatial extent, units, global min/max)."""
    meta_path = DATA_DIR / "metadata.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Metadata file not found on server")
    return FileResponse(meta_path, media_type="application/json")


@app.get("/api/model-data")
async def get_model_data(
    var: str = Query("temperature", description="Variable name: 'temperature' or 'salinity'"),
    depth: int = Query(0, description="Depth level in meters (e.g., 0, 50, 100, 200, 500, 1000)"),
    timestep: int = Query(0, description="Timestep index (0, 1, 2)")
):
    """
    Direct ultra-low-latency file stream for 2D ocean model slice.
    """
    var_clean = var.lower().strip()
    tile_filename = f"{var_clean}_d{depth}_t{timestep}.json"
    tile_path = DATA_DIR / "tiles" / tile_filename

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

    return FileResponse(tile_path, media_type="application/json")


@app.get("/api/model-data/volume")
async def get_model_volume(
    var: str = Query("temperature", description="Variable name: 'temperature' or 'salinity'"),
    timestep: int = Query(0, description="Timestep index (0, 1, 2)")
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
        with open(tf, "r", encoding="utf-8") as f:
            data = json.load(f)
        slices.append({
            "depth": data.get("depth"),
            "values": data.get("values"),
            "slice_min": data.get("slice_min"),
            "slice_max": data.get("slice_max")
        })

    with open(DATA_DIR / "metadata.json", "r", encoding="utf-8") as f:
        meta = json.load(f)

    with open(tile_files[0], "r", encoding="utf-8") as f:
        sample_tile = json.load(f)

    return {
        "variable": var_clean,
        "timestep": timestep,
        "timestamp": sample_tile.get("timestamp", ""),
        "units": meta.get("units", {}).get(var_clean, ""),
        "lats": sample_tile.get("lats", []),
        "lons": sample_tile.get("lons", []),
        "slices_count": len(slices),
        "slices": slices,
        "global_min": meta.get("var_ranges", {}).get(var_clean, {}).get("min"),
        "global_max": meta.get("var_ranges", {}).get(var_clean, {}).get("max")
    }


@app.get("/api/argo/positions")
async def get_argo_positions(
    timestep: int = Query(0, description="Timestep index (0, 1, 2) for Lagrangian float drift")
):
    """
    Returns list of all active Argo profiling float locations.
    Supports timestep parameter: GET /api/argo/positions?timestep=1 returns drifted positions for Day 2.
    """
    # Check for timestep-specific drift file
    pos_file = DATA_DIR / "argo" / f"positions_t{timestep}.json"
    if not pos_file.exists():
        pos_file = DATA_DIR / "argo" / "positions.json"

    if not pos_file.exists():
        raise HTTPException(status_code=404, detail="Argo positions file not found")
    return FileResponse(pos_file, media_type="application/json")


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

    return FileResponse(profile_path, media_type="application/json")


@app.get("/api/coastline")
async def get_coastline():
    """Returns GeoJSON coastline FeatureCollection for geographic 3D boundary rendering."""
    coast_path = DATA_DIR / "coastline.geojson"
    if not coast_path.exists():
        raise HTTPException(status_code=404, detail="Coastline GeoJSON not found")
    return FileResponse(coast_path, media_type="application/json")
