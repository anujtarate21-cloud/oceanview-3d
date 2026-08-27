"""
preprocess_model.py
Extracts 2D depth slices from HYCOM NetCDF dataset and exports optimized JSON tiles for WebGL 3D rendering.
"""

import os
import sys
import json
import argparse
import numpy as np
import xarray as xr

# Default curated depth levels across the water column (surface to 5000m)
DEFAULT_DEPTH_LEVELS = [0, 10, 25, 50, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000, 5000]

VAR_NAME_MAP = {
    'water_temp': 'temperature',
    'temperature': 'temperature',
    'temp': 'temperature',
    'salinity': 'salinity',
    'salt': 'salinity'
}

UNITS_MAP = {
    'temperature': '°C',
    'salinity': 'PSU'
}

def preprocess_hycom(input_path, output_dir, step=2, depth_levels=None):
    if depth_levels is None:
        depth_levels = DEFAULT_DEPTH_LEVELS

    tiles_dir = os.path.join(output_dir, 'tiles')
    os.makedirs(tiles_dir, exist_ok=True)

    print(f"Loading NetCDF dataset: {input_path}")
    ds = xr.open_dataset(input_path)

    # Detect available variables
    avail_vars = {}
    for var in ds.data_vars:
        standard_name = VAR_NAME_MAP.get(var.lower())
        if standard_name:
            avail_vars[standard_name] = var

    print(f"Found variables to process: {list(avail_vars.keys())}")

    # Subsample coordinates
    lat_sub = ds.lat.values[::step]
    lon_sub = ds.lon.values[::step]

    lat_list = [round(float(l), 3) for l in lat_sub]
    lon_list = [round(float(l), 3) for l in lon_sub]

    extent = {
        "lat_min": round(float(np.min(lat_list)), 3),
        "lat_max": round(float(np.max(lat_list)), 3),
        "lon_min": round(float(np.min(lon_list)), 3),
        "lon_max": round(float(np.max(lon_list)), 3),
        "grid_rows": len(lat_list),
        "grid_cols": len(lon_list),
        "step": step
    }

    metadata = {
        "dataset_name": "HYCOM Ocean Model (Indian Ocean)",
        "source": ds.attrs.get("source", "HYCOM GLBv0.08"),
        "conventions": ds.attrs.get("Conventions", "CF-1.6"),
        "timestamp": str(ds.time.values[0]) if 'time' in ds.coords else "2024-09-05T09:00:00",
        "timesteps": [0],
        "depth_levels": [],
        "variables": list(avail_vars.keys()),
        "units": UNITS_MAP,
        "extent": extent,
        "var_ranges": {}
    }

    # Compute global min and max for each variable
    for std_name, raw_var in avail_vars.items():
        raw_vals = ds[raw_var].values
        valid_vals = raw_vals[~np.isnan(raw_vals)]
        min_v = float(np.nanmin(valid_vals))
        max_v = float(np.nanmax(valid_vals))
        metadata["var_ranges"][std_name] = {
            "min": round(min_v, 2),
            "max": round(max_v, 2),
            "units": UNITS_MAP.get(std_name, "")
        }
        print(f"Global range for {std_name}: {min_v:.2f} to {max_v:.2f} {UNITS_MAP.get(std_name, '')}")

    # Process each depth level
    processed_depths = []
    for depth_req in depth_levels:
        # Find nearest depth slice in dataset
        try:
            depth_slice = ds.sel(depth=depth_req, method='nearest')
            actual_depth = round(float(depth_slice.depth.values), 1)
        except Exception as e:
            print(f"Warning: could not select depth {depth_req}: {e}")
            continue

        if actual_depth not in processed_depths:
            processed_depths.append(actual_depth)

        for std_name, raw_var in avail_vars.items():
            var_slice = depth_slice[raw_var]
            if 'time' in var_slice.dims:
                var_2d = var_slice.isel(time=0).values
            else:
                var_2d = var_slice.values

            # Subsample
            var_sub = var_2d[::step, ::step]

            # Convert to list and replace NaNs with None for JSON compatibility
            formatted_values = []
            valid_slice_vals = []
            for row in var_sub:
                new_row = []
                for val in row:
                    if np.isnan(val) or val is None:
                        new_row.append(None)
                    else:
                        fval = round(float(val), 2)
                        new_row.append(fval)
                        valid_slice_vals.append(fval)
                formatted_values.append(new_row)

            slice_min = float(np.min(valid_slice_vals)) if valid_slice_vals else metadata["var_ranges"][std_name]["min"]
            slice_max = float(np.max(valid_slice_vals)) if valid_slice_vals else metadata["var_ranges"][std_name]["max"]

            tile_data = {
                "variable": std_name,
                "depth": actual_depth,
                "requested_depth": depth_req,
                "timestep": 0,
                "units": UNITS_MAP.get(std_name, ""),
                "lats": lat_list,
                "lons": lon_list,
                "values": formatted_values,
                "slice_min": round(slice_min, 2),
                "slice_max": round(slice_max, 2),
                "global_min": metadata["var_ranges"][std_name]["min"],
                "global_max": metadata["var_ranges"][std_name]["max"]
            }

            filename = f"{std_name}_d{int(actual_depth)}_t0.json"
            tile_path = os.path.join(tiles_dir, filename)
            with open(tile_path, 'w', encoding='utf-8') as f:
                json.dump(tile_data, f)

            tile_size_kb = os.path.getsize(tile_path) / 1024
            print(f"Generated tile: {filename} ({tile_size_kb:.1f} KB, depth={actual_depth}m, range=[{slice_min:.1f}, {slice_max:.1f}])")

    metadata["depth_levels"] = sorted(processed_depths)
    meta_path = os.path.join(output_dir, 'metadata.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    print(f"\nMetadata saved to: {meta_path}")
    print(f"Successfully processed {len(processed_depths)} depth levels across {len(avail_vars)} variables!")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Preprocess HYCOM NetCDF to JSON tiles")
    parser.add_argument('--input', type=str, default='hycom_data.nc', help='Path to NetCDF file')
    parser.add_argument('--output', type=str, default='public/data', help='Output directory for tiles and metadata')
    parser.add_argument('--step', type=int, default=2, help='Spatial subsampling step (2 = half resolution, 3 = 1/3 resolution)')

    args = parser.parse_args()
    preprocess_hycom(args.input, args.output, step=args.step)
