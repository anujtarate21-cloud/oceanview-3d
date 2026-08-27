# AGENTS.md — OceanView 3D (SIH26067)
# AI Coding Context & Project Rules
# Last updated: 2026-08-26

---

## 1. PROJECT OVERVIEW & PURPOSE

### What We Are Building
A **browser-native, zero-install 3D ocean data visualization platform** for the Indian National Centre for Ocean Information Services (INCOIS), Ministry of Earth Sciences.

- **SIH Problem Statement:** SIH26067
- **Theme:** Smart Automation
- **Category:** Software
- **Organization:** INCOIS, Ministry of Earth Sciences (MoES)
- **Project Name:** OceanView 3D

### Core Problem
INCOIS generates terabytes of ocean model data (temperature, salinity, currents, chlorophyll) and collects in-situ observations from 4000+ Argo floats, Gliders, and CTDs. No integrated, web-based 3D visualization platform exists to co-visualize model outputs and instrument data. Scientists currently toggle between 4+ desktop tools (Panoply, ODV, ncview, MATLAB).

### Key Features (Priority Order)
1. **3D Volumetric Rendering** — Temperature, salinity, current fields across the full Indian Ocean water column (surface to 5000m) using WebGL
2. **Depth-Slice Navigation** — Draggable clipping plane to explore any ocean depth
3. **Argo Float Overlay** — Clickable markers for Argo/Glider instruments, geospatially positioned
4. **Depth-vs-Variable Profile Charts** — Plotly.js chart showing vertical profile on instrument click
5. **Interactive Controls** — Variable selector, colorbar editor, depth slider, opacity, vertical exaggeration, time playback
6. **Time-Step Animation** — Play/pause/scrub through timesteps showing ocean state evolution
7. **Coastline + Bathymetry** — Geographic context overlay
8. **Multi-Variable Support** — Toggle between temperature, salinity, chlorophyll, currents
9. **Current Vectors** — 3D arrows showing ocean current direction and magnitude (stretch)
10. **Isosurface Extraction** — Render thermocline as a 3D surface via marching cubes (stretch)
11. **Public Outreach Mode** — Simplified view toggle for education/exhibitions (stretch)

### What This Project Is NOT
- NOT an oil spill tracker
- NOT a machine learning project (visualization-first; ML is a future extension)
- NOT a globe/terrain viewer (it's sub-surface volumetric data)
- NOT a real-time data pipeline (uses pre-processed data; OPeNDAP is a roadmap item)

---

## 2. TECH STACK & DEPENDENCIES

### Frontend

| Package | Version | Purpose |
|---------|---------|---------|
| `three` | ^0.168.0 | Core 3D rendering engine (WebGL 2.0) |
| `deck.gl` | ^9.0.0 [Suggested Default] | GPU-accelerated geospatial layer for Argo/Glider markers |
| `plotly.js-dist-min` | ^2.35.0 [Suggested Default] | Depth-vs-variable profile charts |
| `leva` | ^0.9.35 [Suggested Default] | Dynamic controls panel (colorbar, sliders, toggles) — use ONLY if React |
| `dat.gui` | ^0.7.9 [Suggested Default] | Dynamic controls panel — use ONLY if Vanilla JS |
| `vite` | ^5.x | Build tool with HMR |

**Framework Decision:** Vanilla JS + Vite (NOT React). Chosen for speed during the 3.5-day internal round sprint. No framework overhead, simpler Three.js integration.

> If the team later wants React, use `@react-three/fiber` + `@react-three/drei` instead of raw Three.js. But do NOT mix both approaches.

### Backend

| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | ^0.115.0 [Suggested Default] | REST API serving pre-processed ocean data |
| `uvicorn` | ^0.30.0 [Suggested Default] | ASGI server for FastAPI |
| `xarray` | ^2024.9.0 [Suggested Default] | NetCDF ingestion and CF-compliant parsing |
| `netCDF4` | ^1.7.0 [Suggested Default] | NetCDF4 file format backend for xarray |
| `numpy` | ^1.26.0 [Suggested Default] | Array operations, NaN handling, grid math |
| `pandas` | ^2.2.0 [Suggested Default] | Argo CSV/tabular data parsing |
| `matplotlib` | ^3.9.0 [Suggested Default] | Development-only: quick sanity-check plots |

### Standards & Protocols (Awareness, Not Implementation)
- **CF Conventions v1.11** — Variable naming, coordinate axes, units in NetCDF
- **OGC WMS/WCS** — Mentioned in architecture slides; NOT implemented in MVP
- **OPeNDAP** — API design is OPeNDAP-aware for future live data; NOT implemented in MVP

### Explicitly Rejected Technologies

| Technology | Why Rejected |
|------------|-------------|
| **Cesium.js** | Designed for globe-surface rendering, not sub-surface volumetric data. No support for custom depth clipping or vertical exaggeration of underwater volumes. |
| **PostgreSQL / PostGIS** | Over-engineered. Pre-processed JSON tiles are sufficient. No database needed. |
| **GeoServer** | OGC compliance is a roadmap item, not an MVP feature. |
| **Zarr** | Zarr streaming to client-side GPUs is a multi-month engineering effort. Not feasible for hackathon. |
| **PyNIO** | Legacy. xarray + netCDF4 handles everything PyNIO does. |
| **React** | Skipped for internal round speed. Can be reconsidered for finale if team prefers. |
| **TailwindCSS** | Not discussed. Use vanilla CSS with dark theme variables. |

---

## 3. ARCHITECTURE & DESIGN DECISIONS

### Data Flow Pipeline

```
HYCOM/INCOIS NetCDF files (100MB+ each)
    │
    ▼
Python preprocessing script (xarray)
    │ For each variable, for each depth level, for each timestep:
    │   Extract 2D grid (lat × lon) → JSON
    ▼
Static JSON tile files on disk (~200KB each)
    │  /public/data/tiles/temperature_d100_t0.json
    │  /public/data/argo/positions.json
    │  /public/data/argo/profiles/{float_id}.json
    ▼
FastAPI backend (serves JSON via REST GET endpoints)
    │  GET /api/model-data?var=temperature&depth=100&timestep=0
    │  GET /api/argo/positions
    │  GET /api/argo/profile/{float_id}
    │  GET /api/metadata
    ▼
Browser: fetch() → JSON → Three.js BufferGeometry
    │ Map data values → vertex colors via colormap
    ▼
WebGL renders 3D scene in <canvas>
```

### JSON Tile Format (Model Data)

```json
{
  "variable": "temperature",
  "depth": 100,
  "timestep": 0,
  "units": "°C",
  "lats": [5.0, 5.5, 6.0],
  "lons": [70.0, 70.5, 71.0],
  "values": [[28.1, 28.3, null], [27.9, 28.0, null]],
  "min": 4.2,
  "max": 31.5
}
```

- `null` values represent land (masked/fill values from NetCDF)
- `min`/`max` are precomputed across the full dataset for consistent colorbar scaling
- One file per (variable, depth_level, timestep) combination

### JSON Format (Argo Positions)

```json
[
  { "id": "2902150", "lat": 15.234, "lon": 68.891, "date": "2026-03-15", "platform_type": "argo" },
  { "id": "2902151", "lat": 12.567, "lon": 72.345, "date": "2026-03-12", "platform_type": "glider" }
]
```

### JSON Format (Argo Profile)

```json
{
  "float_id": "2902150",
  "lat": 15.234,
  "lon": 68.891,
  "date": "2026-03-15",
  "depths": [5, 10, 20, 50, 100, 200, 500, 1000, 1500, 2000],
  "temperature": [29.1, 29.0, 28.5, 26.1, 22.3, 15.7, 9.2, 5.1, 3.2, 2.1],
  "salinity": [35.2, 35.2, 35.1, 35.0, 34.9, 34.8, 34.7, 34.6, 34.6, 34.6]
}
```

### API Endpoints

```
GET  /api/metadata
     → { variables, depth_levels, timesteps, extent: {lat_min, lat_max, lon_min, lon_max} }

GET  /api/model-data?var=temperature&depth=100&timestep=0
     → { lats, lons, values (2D array), min, max, units }

GET  /api/model-data/volume?var=temperature&timestep=0
     → All depth slices for one variable+timestep (for full volume rendering)

GET  /api/argo/positions
     → [{ id, lat, lon, date, platform_type }, ...]

GET  /api/argo/profile/{float_id}
     → { depths, temperature, salinity, dates }

GET  /api/coastline
     → GeoJSON FeatureCollection
```

### 3D Rendering Strategy

**Approach A (RECOMMENDED for MVP — use this first):** Stacked Colored Planes
- For each depth level, create a `THREE.PlaneGeometry`
- Set vertex colors from data values using colormap lookup
- Stack planes at Z positions: `z = -depth * verticalExaggeration`
- Toggle visibility based on depth slider
- **Pro:** Simple, reliable, works on all GPUs

**Approach B (stretch goal):** Instanced Point Cloud
- `THREE.InstancedMesh` with small `BoxGeometry`
- One instance per (lat, lon, depth) grid point
- Color via instance attributes
- **Pro:** True volume appearance. **Con:** Needs LOD for performance.

**Approach C (advanced stretch):** Shader-Based Volume Rendering
- `THREE.DataTexture3D` with full 3D volume
- Custom ray-marching fragment shader
- Colormap as 1D texture lookup
- **Pro:** Best visual quality. **Con:** Requires GLSL knowledge.

### Coordinate System Mapping

```
Latitude  → X axis (scaled)
Longitude → Y axis (scaled)
Depth     → Z axis (NEGATIVE, multiplied by vertical exaggeration factor)

Conversion:
  x = (lon - lon_center) * scale_factor
  y = (lat - lat_center) * scale_factor
  z = -depth * vertical_exaggeration  (depth increases downward)

Default vertical exaggeration: 50x (adjustable via slider, range 1x-200x)
Default scale_factor: 1.0 (adjust based on grid extent)
```

### Colormap System

```javascript
// Colormaps stored as arrays of 256 RGB triplets
// Options: Viridis (default), Jet, Thermal, Haline

function valueToColor(value, min, max, colormapArray) {
  if (value === null || isNaN(value)) return new THREE.Color(0.2, 0.2, 0.2); // Land = grey
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const index = Math.floor(t * 255);
  const [r, g, b] = colormapArray[index];
  return new THREE.Color(r / 255, g / 255, b / 255);
}
```

### Raycasting for Click Interaction

```javascript
// On mouse click:
// 1. Create Raycaster from camera through click position
// 2. Intersect with Argo marker meshes
// 3. If hit: get float_id from mesh.userData
// 4. Fetch /api/argo/profile/{float_id}
// 5. Open Plotly.js chart in side panel / modal
```

---

## 4. DIRECTORY & FILE STRUCTURE

```
oceanview-3d/
├── backend/
│   ├── main.py                    # FastAPI app with all endpoints
│   ├── requirements.txt           # Python dependencies
│   └── Dockerfile                 # [Suggested Default] Backend container
├── scripts/
│   ├── preprocess_model.py        # NetCDF → JSON tiles (xarray)
│   ├── preprocess_argo.py         # Argo profiles → JSON
│   └── preprocess_bathymetry.py   # ETOPO → heightmap
├── public/
│   └── data/
│       ├── tiles/                 # Pre-processed model data JSON tiles
│       ├── argo/
│       │   ├── positions.json     # All Argo float locations
│       │   └── profiles/          # Individual float profiles
│       ├── coastline.geojson      # Natural Earth 110m coastline
│       └── metadata.json          # Variables, depths, timesteps, extent
├── src/
│   ├── index.html                 # Main HTML: canvas + control panels
│   ├── style.css                  # Dark theme, glassmorphism panels
│   ├── main.js                    # Entry point: init scene, controls, event loop
│   ├── scene/
│   │   ├── OceanScene.js          # Three.js scene setup (camera, lights, OrbitControls)
│   │   ├── VolumeRenderer.js      # Data-driven 3D volume (colored planes)
│   │   ├── DepthSlicer.js         # Depth layer visibility toggle
│   │   └── CoastlineLayer.js      # GeoJSON → Three.js LineSegments
│   ├── instruments/
│   │   ├── ArgoMarkers.js         # Argo float spheres + raycasting
│   │   └── GliderTracks.js        # [Stretch] Glider path line
│   ├── charts/
│   │   └── ProfileChart.js        # Plotly.js depth-vs-variable chart modal
│   ├── controls/
│   │   ├── ControlPanel.js        # Variable selector, depth slider, colormap, opacity
│   │   ├── TimeAnimator.js        # Play/pause/scrub
│   │   ├── ColormapEditor.js      # Colorbar canvas + palette selection
│   │   └── Legend.js              # Dynamic legend with units
│   ├── utils/
│   │   ├── dataLoader.js          # fetch() wrappers for API endpoints
│   │   ├── colormaps.js           # Viridis, Jet, Thermal, Haline arrays
│   │   ├── coordTransform.js      # (lat, lon, depth) → Three.js (x, y, z)
│   │   └── constants.js           # Default camera position, colors, scale
│   └── shaders/                   # [Stretch] Custom GLSL
│       ├── volumetric.vert
│       └── volumetric.frag
├── docker-compose.yml             # [Suggested Default]
├── package.json
├── vite.config.js
├── README.md
├── AGENTS.md                      # THIS FILE
└── .gitignore
```

---

## 5. CODING GUIDELINES & CONSTRAINTS

### JavaScript
- Use **ES modules** (`import`/`export`), NOT CommonJS
- Use `const` by default, `let` only when reassignment needed, NEVER `var`
- Use **arrow functions** for callbacks
- Use `async`/`await` for all fetch calls, NEVER raw `.then()` chains
- Naming: `camelCase` for variables/functions, `PascalCase` for classes
- File naming: `PascalCase.js` for classes, `camelCase.js` for utilities
- All Three.js objects must `dispose()` on cleanup to prevent GPU memory leaks
- **NO `console.log` in production** — remove before demo

### Python
- Use **type hints** on all function signatures
- Use **f-strings** for formatting
- Naming: `snake_case` for functions/variables, `PascalCase` for classes
- Handle `NaN`/fill values explicitly in all xarray operations
- JSON output: convert NaN to `null` before serialization

### CSS
- **Dark theme only**: bg `#0a0a2e`, accent `#00d4aa`, text `#e0e0e0`
- Panels: glassmorphism (`rgba(10,10,46,0.85)` + `backdrop-filter: blur(12px)`)
- Font: `'Inter', 'Segoe UI', sans-serif` [Suggested Default]
- Full-screen canvas: `width: 100vw; height: 100vh; overflow: hidden`
- **NO CSS frameworks** — vanilla CSS only

### Strict Rules
- **NEVER import Cesium.js** — Three.js for sub-surface volumetric rendering
- **NEVER add a database** — JSON files only
- **NEVER parse NetCDF in browser** — Python server-side only
- **NEVER make up statistics** in presentations
- **NEVER add features outside the PS** (no oil spill tracking)
- **ALWAYS handle NaN/null** — land areas are NaN in ocean data
- **ALWAYS use CF Convention names** for data fields
- **ALWAYS dispose Three.js geometries/materials** when replacing data

### Performance
- JSON tiles **<500KB each**
- Target **30+ FPS** on mid-range GPU
- Use `THREE.InstancedMesh` for >1000 objects
- Use `requestAnimationFrame`, never `setInterval`
- Debounce slider inputs

---

## 6. CURRENT STATUS & PENDING TASKS

### ✅ Completed (Decisions Made)
- Problem statement selected: SIH26067
- Competitive analysis done (zero web-based 3D competitors)
- Tech stack finalized
- Architecture designed (all API endpoints, JSON formats, rendering strategy)
- Official 6-slide PPT content written
- Internal round + finale plans created
- Learning syllabus created
- Domain knowledge documented
- Judge Q&A prepared
- All docs exported as PDFs

### 🔧 In Progress (Internal Round — Due Aug 29)
- Download + preprocess HYCOM/Argo data
- Build Three.js scene + volume renderer + controls + charts
- Set up FastAPI backend
- Finalize PPT, rehearse presentation

### 📋 Deferred to Pre-Hackathon
- Additional variables (salinity, chlorophyll)
- Current vectors, isosurface, glider tracks
- Comparison mode, outreach mode
- Docker deployment, export features

### ❌ Not Building
- OPeNDAP, OGC WMS/WCS, plugin hot-swap, mobile layout

---

## 7. KEY COMMANDS

```bash
# Frontend
npm create vite@latest oceanview-3d -- --template vanilla
npm install three plotly.js-dist-min
npm run dev          # Dev server at localhost:5173
npm run build        # Production build

# Backend
cd backend
python -m venv env && .\env\Scripts\activate  # Windows
pip install fastapi uvicorn xarray netCDF4 numpy pandas
uvicorn main:app --reload --port 8000

# Quick static file server (alternative to FastAPI for MVP)
cd public && python -m http.server 8000

# Data preprocessing
python scripts/preprocess_model.py --input raw_data/hycom.nc --output public/data/tiles/
python scripts/preprocess_argo.py --input raw_data/argo/ --output public/data/argo/

# Docker [Suggested Default]
docker compose up --build
```

---

## 8. DATA SOURCES

| Dataset | URL | Format | Region |
|---------|-----|--------|--------|
| HYCOM Ocean Model | https://ncss.hycom.org/thredds/ncss/ | NetCDF | Indian Ocean: 0-25°N, 60-95°E |
| Argo Profiles | https://argovis.colorado.edu/ | JSON/NetCDF | Indian Ocean, 100-200 profiles |
| Coastline | https://naturalearthdata.com/downloads/110m-cultural-vectors/ | GeoJSON | Global (filter to Indian Ocean) |
| Bathymetry | https://www.ngdc.noaa.gov/mgg/global/ | NetCDF | ETOPO Indian Ocean subset |

---

## 9. DOMAIN REFERENCE

| Variable | Meaning | Range (Indian Ocean) | Units |
|----------|---------|---------------------|-------|
| Temperature | Heat content at depth | Surface 26-31°C, 2000m 1-3°C | °C |
| Salinity | Dissolved salt | 33-37 | PSU |
| Current u/v | Water velocity E-W / N-S | -1.5 to 1.5 | m/s |
| Chlorophyll-a | Phytoplankton | 0.01-30 | mg/m³ |

**Key concepts:** Thermocline (100-300m), Mixed Layer, Upwelling, EEZ (2.37M km²), Argo cycle (sink→drift→dive→rise→transmit)

---

## 10. TEAM (6-Person SIH Team)

| Role | Owns | Key Files |
|------|------|-----------|
| 3D Lead | Scene, volume rendering, depth slice | OceanScene.js, VolumeRenderer.js |
| 3D Support | Argo markers, raycasting, stretch | ArgoMarkers.js, GliderTracks.js |
| Data Engineer | Data download, preprocessing | preprocess_model.py, preprocess_argo.py |
| Backend Dev | FastAPI, data serving, Docker | main.py, Dockerfile |
| Frontend/UI | Layout, CSS, controls, charts | index.html, style.css, ControlPanel.js |
| Research/Pres | Domain knowledge, PPT, README | README.md, presentation |

---

## 11. COMPETITION CONTEXT

- **Internal Round:** Aug 29, 2026 — college selection
- **Idea Submission:** Sep 20, 2026
- **Grand Finale:** 36-hour hackathon (Dec/Jan TBD)
- **Pre-work allowed:** Yes
- **PPT:** Official 6-slide template, submit as PDF
- **Key fact:** INCOIS adopts SIH solutions (AutoFiS, SIH 2022)
- **Differentiator:** Zero web-based 3D ocean viz tools exist globally
