# AGENTS.md — OceanView 3D (SIH26067)
# AI Coding Context & Project Rules
# Last updated: 2026-09-10

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

### Data Flow Pipeline (Implemented)

```
HYCOM NCSS Server (https://ncss.hycom.org/thredds/ncss/)
    │
    ▼  PipelineManager.js triggers on-demand fetch via backend
FastAPI backend: /api/pipeline/fetch-date?date=YYYY-MM-DD
    │  Downloads NetCDF → xarray → extracts 2D grid per (var, depth) → JSON
    ▼
Cached JSON tile files on disk (~200KB each)
    │  /public/data/tiles/temperature_d100_2023-03-21.json
    │  /public/data/argo/positions_{date}.json
    │  /public/data/argo/profiles/{float_id}.json
    ▼
FastAPI backend (serves JSON via REST GET endpoints)
    │  GET /api/model-data?var=temperature&depth=100&date=2023-03-21
    │  GET /api/argo/positions?date=2023-03-21
    │  GET /api/argo/profile/{float_id}
    │  GET /api/metadata
    │  GET /api/pipeline/available-dates
    │  GET /api/pipeline/fetch-date?date=YYYY-MM-DD
    │  GET /api/health
    ▼
Browser: fetch() → JSON → Three.js BufferGeometry
    │ Map data values → vertex colors via colormap
    │ Active slice at full opacity (0.95) + 5 context horizons at 0.38 opacity
    ▼
WebGL renders 3D scene in <canvas>
    │ 3D Aquarium Cage + Depth Ruler Labels + Argo Float Markers
    ▼
Raycasting + Screen-space hit testing for interactive depth/marker selection
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

### API Endpoints (Implemented)

```
GET  /api/health
     → { status: "ok" }  (Used by frontend detectBackend() with 800ms timeout)

GET  /api/metadata
     → { variables, depth_levels, timesteps, timestamps, extent, units }

GET  /api/model-data?var=temperature&depth=100&date=2023-03-21
     → { variable, depth, date, lats, lons, values (2D), min, max, global_min, global_max,
        slice_min, slice_max, units }

GET  /api/argo/positions?date=2023-03-21
     → [{ id, lat, lon, date, platform_type, max_depth }, ...]

GET  /api/argo/profile/{float_id}
     → { float_id, lat, lon, date, depths, temperature, salinity }

GET  /api/coastline
     → GeoJSON FeatureCollection (Natural Earth 110m, filtered to Indian Ocean)

GET  /api/pipeline/available-dates
     → { dates: ["2020-03-17", "2022-03-21", ...], count: 12 }

GET  /api/pipeline/fetch-date?date=2023-03-21
     → Downloads HYCOM NetCDF for that date, preprocesses to JSON tiles, returns status

GET  /api/pipeline/status
     → { fetching: false, current_date: null, cached_count: 12 }

POST /api/ai/chat
     → AI assistant endpoint (Gemini-powered oceanographic Q&A)

POST /api/analyze/netcdf
     → Upload & analyze arbitrary NetCDF files
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

### Coordinate System Mapping (Implemented)

```
Longitude → X axis (East-West, scaled)
Latitude  → Y axis (North-South, scaled)
Depth     → Z axis (NEGATIVE, depth increases downward, multiplied by vertical exaggeration)

Conversion (coordTransform.js):
  x = (lon - 77.5) * 1.6
  y = (lat - 12.5) * 1.6
  z = -depth * (verticalExaggeration / 50) * 0.003

Defaults (constants.js):
  LON_CENTER = 77.5, LAT_CENTER = 12.5
  GEO_SCALE = 1.6
  DEFAULT_VERT_EXAG = 75 (adjustable via slider, range 1x-200x)
  Camera Z-up: camera.up.set(0, 0, 1)
  Camera initial: (-35, -75, 55) looking at (0, 0, -8)
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

### Raycasting & Interaction (Implemented)

```javascript
// ArgoInteraction.js handles ALL pointer interactions on the 3D canvas:
//
// 1. Depth Ruler Label Selection (priority):
//    - Dual-mode: 3D Raycasting against billboard sprites + screen-space bounding box fallback
//    - On click: setSelectedDepth() → controlPanel.setDepth() → refreshVolume()
//    - On hover: scale pop (5.9, 1.05, 1), pointer cursor, status bar update
//    - Drag-tolerant: pointerdown+pointerup with <8px delta to avoid OrbitControls conflicts
//
// 2. Argo Float Marker Selection:
//    - Standard THREE.Raycaster against InstancedMesh markers
//    - On click: dispatch 'argo-click' → ProfileChart opens Plotly.js modal
//    - On hover: tooltip with float_id, lat/lon, date; marker scale 1.3x
//
// 3. Ocean Plane Coordinates:
//    - Ray-plane intersection for lat/lon readout in status bar
```

---

## 4. DIRECTORY & FILE STRUCTURE (Actual — Sep 10, 2026)

```
oceanview-3d/
├── backend/
│   ├── main.py                    # FastAPI app — all REST endpoints + HYCOM pipeline + AI chat
│   ├── requirements.txt           # Python dependencies
│   ├── Dockerfile                 # Backend container
│   ├── __init__.py
│   └── services/
│       ├── ai_service.py          # Gemini-powered oceanographic AI chat assistant
│       ├── file_ingestor.py       # NetCDF file upload & ingestion
│       └── netcdf_analyzer.py     # NetCDF structure analysis & variable extraction
├── scripts/
│   ├── preprocess_model.py        # NetCDF → JSON tiles (xarray, supports --date-label)
│   ├── preprocess_argo.py         # Argo profiles → JSON (Argovis API)
│   └── preprocess_bathymetry.py   # ETOPO → heightmap
├── public/
│   └── data/
│       ├── tiles/                 # Pre-processed model data JSON tiles (~200KB each)
│       │                          # Naming: {var}_d{depth}_{date}.json
│       ├── argo/
│       │   ├── positions_{date}.json  # Argo float locations per date
│       │   └── profiles/              # Individual float profiles
│       ├── coastline.geojson      # Natural Earth 110m coastline (Indian Ocean filtered)
│       └── metadata.json          # Variables, depths, timesteps, extent, units
├── src/
│   ├── index.html                 # Main HTML: canvas + accordion sidebar + status strip
│   ├── style.css                  # 65KB dark theme, glassmorphism, light mode support
│   ├── main.js                    # Entry point (27KB): init scene, event wiring, state mgmt
│   ├── scene/
│   │   ├── OceanScene.js          # Three.js scene, camera (Z-up), OrbitControls, render loop
│   │   ├── VolumeRenderer.js      # Active slice + 5 context horizon layers (0.38 opacity)
│   │   ├── WaterColumnCage.js     # 3D aquarium cage, depth ruler billboard labels, selection
│   │   ├── DepthSlicer.js         # Depth layer visibility toggle
│   │   ├── CoastlineLayer.js      # GeoJSON → Three.js LineSegments
│   │   ├── CurrentVectors.js      # 3D arrows showing ocean current direction + magnitude
│   │   └── ThermoclineIsosurface.js  # 20°C isosurface via marching cubes approximation
│   ├── instruments/
│   │   ├── ArgoMarkers.js         # InstancedMesh Argo float markers + land filtering
│   │   ├── ArgoInteraction.js     # Dual raycast + screen-space hit test for labels & markers
│   │   └── GliderTracks.js        # Glider dive path lines
│   ├── charts/
│   │   └── ProfileChart.js        # Plotly.js depth-vs-variable chart modal
│   ├── controls/
│   │   ├── ControlPanel.js        # Variable, depth, colormap, opacity, exaggeration, presets
│   │   ├── TimeAnimator.js        # Play/pause/scrub with date label sync
│   │   ├── ColormapEditor.js      # Colorbar canvas + palette selection
│   │   ├── Legend.js              # Dynamic legend with units + colormap
│   │   ├── PipelineManager.js     # On-demand HYCOM date fetching + date chip navigation
│   │   ├── ThemeManager.js        # Dark/light/ocean theme toggle with full 3D sync
│   │   ├── OutreachMode.js        # Public exhibition mode with guided tours
│   │   └── AIChatAssistant.js     # In-app AI chat for oceanographic questions
│   └── utils/
│       ├── dataLoader.js          # fetch() wrappers, backend detection, synthetic fallbacks
│       ├── colormaps.js           # Viridis, Jet, Thermal, Haline (256 RGB triplets each)
│       ├── coordTransform.js      # (lat, lon, depth) → Three.js (x, y, z)
│       └── constants.js           # Camera, scale, colors, timing, geometry defaults
├── docker-compose.yml
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

## 6. CURRENT STATUS & PENDING TASKS (Updated Sep 10, 2026)

### ✅ Completed — Planning & Documentation
- Problem statement selected: SIH26067
- Competitive analysis done (zero web-based 3D competitors)
- Tech stack finalized (Vanilla JS + Vite + Three.js + FastAPI)
- Architecture designed (all API endpoints, JSON formats, rendering strategy)
- Official 6-slide PPT content written
- Internal round + finale plans created
- Learning syllabus created, domain knowledge documented
- Judge Q&A prepared, all docs exported as PDFs
- **Internal round completed (Aug 29) — selected for grand finale**

### ✅ Completed — Frontend 3D Engine
- Three.js scene with Z-up camera, OrbitControls, fog, ambient+directional lighting
- `VolumeRenderer`: Active depth slice (0.95 opacity) + 5 auto-loaded context horizons (0.38 opacity)
- `WaterColumnCage`: 3D aquarium cage with 4 corner pillars, surface/seafloor grids, depth guide rings
- 3D depth ruler billboard labels (0m, 200m, 500m, 1000m, 2000m, 5000m) with click-to-select
- Selected label gets neon cyan glow halo + `[SELECTED]` text + scale pop
- `ArgoInteraction`: Dual-mode hit testing (3D raycast + screen-space projection), drag-tolerant clicks
- `ArgoMarkers`: InstancedMesh gold spheres with geometric land-coordinate filtering
- `CoastlineLayer`: GeoJSON → Three.js LineSegments
- `CurrentVectors`: 3D arrows showing u/v current direction and magnitude per depth
- `ThermoclineIsosurface`: 20°C isosurface rendered as translucent mesh
- `GliderTracks`: Glider dive path line rendering
- 4 colormaps: Viridis, Thermal, Haline, Jet (256 RGB triplets each)
- Auto-suggested colormap per variable (temperature→thermal, salinity→haline, etc.)

### ✅ Completed — Frontend Controls & UI
- Accordion sidebar with expand/collapse all (Shift+A)
- Variable selector (temperature, salinity, chlorophyll, currents)
- Depth slider with tick marks + quick-jump preset chips (0m, 150m, 500m, 1000m, 3000m)
- Colormap palette selector + vertical colorbar with min/mid/max labels
- Opacity slider (0–100%), vertical exaggeration slider (1x–200x)
- Time playback: play/pause/scrub with date labels
- `PipelineManager`: On-demand HYCOM date fetching, date chip navigation, available-dates sync
- `ThemeManager`: Dark, light, and ocean theme toggle with full 3D scene color sync
- `OutreachMode`: Guided exhibition tours (Surface, Thermocline, Abyssal)
- `AIChatAssistant`: In-app AI-powered oceanographic Q&A (Gemini backend)
- Factor status pills: Ocean (depth·var), Optics (colormap), Date, Overlays (active count)
- Dynamic overlay badges: IRL depth ranges for coastline, Argo, currents, isosurface, gliders
- `ProfileChart`: Plotly.js depth-vs-variable modal on Argo float click
- `Legend`: Dynamic legend with variable name, units, min/max, colormap indicator
- Keyboard shortcuts modal (? key)
- Loading screen with sonar ring animation
- Glassmorphism panels, dark theme (`#0a0a2e` bg, `#00d4aa` accent)
- Responsive sidebar collapse on mobile viewport
- Full light-mode theme adaptation for all 3D and 2D elements

### ✅ Completed — Backend
- FastAPI with all REST endpoints (model-data, argo, coastline, metadata, pipeline, AI, health)
- On-demand HYCOM NetCDF download via NCSS API → xarray preprocessing → JSON tiles
- Argo float positions fetched from Argovis API per date
- Pipeline status tracking, available-dates endpoint
- AI chat service (Gemini integration) for domain Q&A
- NetCDF file upload & analysis service
- CORS middleware for frontend dev server
- Static file fallback when backend is offline

### ✅ Completed — Data
- 12+ HYCOM dates cached as JSON tiles (temperature + salinity, 16 depth levels each)
- Argo float positions per date (real data from Argovis)
- Indian Ocean coastline GeoJSON (Natural Earth 110m)
- Metadata.json with variables, depth_levels, timestamps, extent, units
- Synthetic data fallbacks for offline/demo mode

### 🔧 In Progress (Pre-Hackathon Polish)
- Model vs. Argo observation comparison (dual-line profile chart)
- HYCOM data quality validation (range clamping, coastal artifact flagging)
- Performance optimization (Plotly lazy-loading, context layer cap)
- WebGL context loss recovery handler

### 📋 Deferred to Grand Finale (36-Hour Hackathon)
- Model-observation anomaly heatmap overlay
- Temporal discontinuity detection between consecutive dates
- Bathymetry-aware depth masking (ETOPO integration)
- Docker end-to-end deployment validation
- Export features (screenshot, data download)
- Additional Argo profile variables in comparison chart

### ❌ Not Building
- OPeNDAP live streaming, OGC WMS/WCS compliance
- Plugin hot-swap architecture
- Mobile-optimized layout
- Climatological baseline / z-score anomaly detection
- Real-time data pipeline (WebSocket streaming)

---

## 7. KEY COMMANDS

```bash
# Frontend
npm run dev          # Vite dev server at localhost:5173 (HMR)
npm run build        # Production build → dist/ (~5MB JS, ~49KB CSS)

# Backend (from project root, using venv)
& "env\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
# OR with auto-reload for development:
uvicorn main:app --reload --port 8000

# On-demand HYCOM date fetch (triggered by PipelineManager UI, or manually):
curl http://localhost:8000/api/pipeline/fetch-date?date=2023-03-21

# Check cached dates:
curl http://localhost:8000/api/pipeline/available-dates

# Data preprocessing (manual, if needed)
python scripts/preprocess_model.py --input raw_data/hycom.nc --output public/data/tiles/ --date-label 2023-03-21
python scripts/preprocess_argo.py --input raw_data/argo/ --output public/data/argo/

# Docker
docker compose up --build

# Git (current branch: main)
git log --oneline -10
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

- **Internal Round:** Aug 29, 2026 — ✅ **SELECTED** (college selection passed)
- **Idea Submission:** Sep 20, 2026
- **Grand Finale:** 36-hour hackathon (Dec/Jan TBD)
- **Pre-work allowed:** Yes
- **PPT:** Official 6-slide template, submit as PDF
- **Key fact:** INCOIS adopts SIH solutions (AutoFiS, SIH 2022)
- **Differentiator:** Zero web-based 3D ocean viz tools exist globally

---

## 12. KNOWN HYCOM DATA LIMITATIONS

These are inherent limitations of the HYCOM ocean model data — NOT bugs in our code.
Our platform visualizes the raw model output faithfully. These cannot be "fixed" by us.

| Anomaly | Description | Our Handling |
|---------|-------------|-------------|
| **Fill values / NaN** | Land cells and missing data come as NaN or 9.96921e+36 | ✅ Converted to `null` in JSON, rendered as grey |
| **Coastal interpolation artifacts** | HYCOM's ~8km grid mixes ocean/land near coastlines, producing unrealistic values (e.g., 35°C at 500m near Gujarat) | ⚠️ Not detected — rendered as valid. Mitigate with coastal cell masking (future). |
| **Depth extrapolation below bathymetry** | HYCOM fills all 40 depth levels even where ocean is shallower. 5000m data in Arabian Sea (real depth ~3500m) is extrapolated. | ⚠️ Not flagged — needs ETOPO bathymetry cross-reference (future). |
| **Temporal discontinuities** | Reanalysis vs nowcast transitions cause 1–3°C jumps between consecutive dates at same depth | ⚠️ Not detected — each tile rendered independently. Detectable with diff computation (future). |
| **Salinity spikes near rivers** | Ganges/Indus outflow creates artificially sharp gradients. HYCOM doesn't model river discharge well at coarse resolution. | ⚠️ No range validation. Can add `np.clip()` clamping (future). |

**Recommended judge response:** "HYCOM is a global ocean model at ~8km resolution. Like all numerical models, it has known artifacts. Our platform visualizes the raw output faithfully. The model-vs-observation comparison feature lets scientists see exactly where HYCOM diverges from reality, which is itself the primary tool for identifying these artifacts."

---

## 13. TECHNICAL RISKS & KNOWN ISSUES

| Risk | Severity | Description |
|------|----------|-------------|
| **GPU memory climb** | 🔴 High | Rapid variable/date switching creates new BufferGeometry meshes. Context layers only cleared on series change. Memory can reach 800MB+ after extended use. |
| **Plotly.js main-thread block** | 🟠 Medium | First Argo profile chart render parses ~3MB Plotly bundle synchronously, causing 400–800ms frame freeze. Fix: dynamic `import()`. |
| **No WebGL context loss recovery** | 🟠 Medium | No `webglcontextlost` handler. Tab switch on laptop GPU can kill canvas with no recovery except page reload. |
| **PipelineManager infinite retry** | 🟠 Medium | No max-retry or exponential backoff on network failure. Console floods with errors. |
| **Context layer race condition** | 🟡 Low | Token-based cancellation exists but concurrent loads completing out of order can produce ghost slices from previous variable. |
| **Slow orbit mis-click** | 🟡 Low | 8px drag threshold can register gentle orbit rotations near ruler labels as depth clicks. Increase to 12px. |
| **Bundle size (5MB)** | 🟡 Low | Production JS is 5,050KB (1.5MB gzipped). Mostly Plotly. Slow on hackathon WiFi. |
| **`depthTest: false` on sprites** | 🟡 Low | Ruler labels visible from behind the aquarium — breaks spatial perception at extreme camera angles. |
| **Vite HMR full reload** | 🟢 Dev-only | Every file change triggers full page reload instead of hot module replacement. Wastes 3–5s per save. |
