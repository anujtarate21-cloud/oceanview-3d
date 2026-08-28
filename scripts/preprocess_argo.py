"""
preprocess_argo.py
Parses Argo float dataset, performs oceanographic QC cleaning (filtering sensor 0.0/fill values to None),
and outputs positions.json and per-float depth profile JSON files for Plotly charting.
"""

import os
import sys
import json
import argparse

def preprocess_argo(input_path, output_dir):
    argo_dir = os.path.join(output_dir, 'argo')
    profiles_dir = os.path.join(argo_dir, 'profiles')
    os.makedirs(profiles_dir, exist_ok=True)

    print(f"Loading Argo dataset from: {input_path}")
    with open(input_path, 'r', encoding='utf-8') as f:
        records = json.load(f)

    print(f"Found {len(records)} float profiles to process.")

    positions = []
    processed_count = 0

    for rec in records:
        float_id = str(rec.get('_id', rec.get('id', f'argo_{processed_count}')))
        safe_id = float_id.replace('/', '_').replace('\\', '_')

        # Geolocation parsing
        geo = rec.get('geolocation', {})
        coords = geo.get('coordinates', [])
        if len(coords) >= 2:
            lon = round(float(coords[0]), 4)
            lat = round(float(coords[1]), 4)
        else:
            lat = round(float(rec.get('lat', 0.0)), 4)
            lon = round(float(rec.get('lon', 0.0)), 4)

        timestamp_str = rec.get('timestamp', '')
        date_str = timestamp_str[:10] if timestamp_str else "2024-09-05"

        data_arrays = rec.get('data', [])
        data_info = rec.get('data_info', [[]])
        
        var_indices = {}
        if len(data_info) > 0 and isinstance(data_info[0], list):
            for idx, name in enumerate(data_info[0]):
                var_indices[name.lower()] = idx
        else:
            var_indices = {'temperature': 0, 'salinity': 1, 'pressure': 2}

        temp_idx = var_indices.get('temperature', 0)
        sal_idx = var_indices.get('salinity', 1)
        pres_idx = var_indices.get('pressure', var_indices.get('depth', 2))

        temp_raw = data_arrays[temp_idx] if len(data_arrays) > temp_idx else []
        sal_raw = data_arrays[sal_idx] if len(data_arrays) > sal_idx else []
        pres_raw = data_arrays[pres_idx] if len(data_arrays) > pres_idx else []

        depths = []
        temperatures = []
        salinities = []

        max_len = max(len(temp_raw), len(sal_raw), len(pres_raw))
        for i in range(max_len):
            d = pres_raw[i] if i < len(pres_raw) else None
            t = temp_raw[i] if i < len(temp_raw) else None
            s = sal_raw[i] if i < len(sal_raw) else None

            if d is not None:
                d_val = round(float(d), 1)
                
                # Temperature QC: Ocean valid range ~ -2°C to 40°C
                if t is not None:
                    tf = float(t)
                    t_val = round(tf, 2) if (-2.0 <= tf <= 40.0) else None
                else:
                    t_val = None

                # Salinity QC: Ocean valid range ~ 15 to 45 PSU (0.0 is sensor fill value)
                if s is not None:
                    sf = float(s)
                    s_val = round(sf, 2) if (15.0 <= sf <= 45.0) else None
                else:
                    s_val = None

                depths.append(d_val)
                temperatures.append(t_val)
                salinities.append(s_val)

        if not depths:
            continue

        surface_temp = next((t for t in temperatures if t is not None), None)
        surface_sal = next((s for s in salinities if s is not None), None)
        max_depth = max(depths) if depths else 0.0

        pos_item = {
            "id": safe_id,
            "raw_id": float_id,
            "lat": lat,
            "lon": lon,
            "date": date_str,
            "timestamp": timestamp_str,
            "platform_type": "argo",
            "max_depth": max_depth,
            "surface_temp": surface_temp,
            "surface_salinity": surface_sal,
            "levels_count": len(depths)
        }
        positions.append(pos_item)

        profile_data = {
            "float_id": safe_id,
            "lat": lat,
            "lon": lon,
            "date": date_str,
            "timestamp": timestamp_str,
            "platform_type": "argo",
            "depths": depths,
            "temperature": temperatures,
            "salinity": salinities
        }

        profile_path = os.path.join(profiles_dir, f"{safe_id}.json")
        with open(profile_path, 'w', encoding='utf-8') as f:
            json.dump(profile_data, f)

        processed_count += 1

    pos_path = os.path.join(argo_dir, 'positions.json')
    with open(pos_path, 'w', encoding='utf-8') as f:
        json.dump(positions, f, indent=2)

    print(f"\nSaved {len(positions)} float positions to: {pos_path}")
    print(f"Saved {processed_count} profile files to: {profiles_dir}/")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Preprocess Argo float observations to JSON")
    parser.add_argument('--input', type=str, default='dataset/Agro float/argo.json', help='Path to Argo JSON dataset')
    parser.add_argument('--output', type=str, default='public/data', help='Output directory for argo data')

    args = parser.parse_args()
    preprocess_argo(args.input, args.output)
