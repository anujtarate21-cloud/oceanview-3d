# OceanView 3D — INCOIS Ocean Data Visualization Platform

[![SIH 2026](https://img.shields.io/badge/SIH%202026-SIH26067-blue.svg)](https://sih.gov.in)
[![Ministry of Earth Sciences](https://img.shields.io/badge/MoES-INCOIS-teal.svg)](https://incois.gov.in)
[![Stack](https://img.shields.io/badge/Stack-Three.js%20%7C%20FastAPI%20%7C%20xarray-emerald.svg)]()

> **Browser-native 3D ocean data visualization platform** for the Indian National Centre for Ocean Information Services (INCOIS), Ministry of Earth Sciences.
> Integrates 3D volumetric numerical ocean model outputs (temperature, salinity) and in-situ observations (Argo profiling floats, Gliders) in a unified interactive environment.

---

## 🌊 System Architecture & Data Flow

```
HYCOM NetCDF (Indian Ocean) ──→ xarray Preprocessor ──→ JSON Tiles (public/data/tiles/)
Argo Float Profiles (GDAC)  ──→ QC & Parser         ──→ Profile JSON (public/data/argo/)
Coastline (Natural Earth)   ──→ GeoJSON Parser      ──→ GeoJSON (public/data/coastline.geojson)
                                                            │
                                                            ▼
                                                FastAPI Backend (localhost:8000)
                                                            │ (CORS + GZip + LRU Cache)
                                                            ▼
                                        Three.js / WebGL 3D Visualization + Plotly Charts
```

---

## 🚀 Quick Start for Team Members

### 1. Backend Server Setup (Data API)

```bash
# Create and activate virtual environment
python -m venv env
.\env\Scripts\activate   # Windows (or source env/bin/activate on Linux/Mac)

# Install Python dependencies
pip install -r backend/requirements.txt

# Start FastAPI server on port 8000
uvicorn backend.main:app --reload --port 8000
```
API Documentation available at: `http://localhost:8000/docs`

### 2. Frontend Web App Setup (3D Viewer)

```bash
# Install Node packages
npm install

# Start Vite dev server on port 5173
npm run dev
```
Open your browser at: `http://localhost:5173`

---

## 🌐 API Endpoints Overview

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | `GET` | Service status and data directory validation |
| `/api/metadata` | `GET` | Variables, 16 depth levels (`0m` to `5000m`), bounding box, units, and ranges |
| `/api/model-data` | `GET` | `?var=temperature&depth=100&timestep=0` returns 313×219 2D slice at requested depth |
| `/api/model-data/volume` | `GET` | Returns all 16 depth slices (1.1M 3D vertices) with GZip streaming |
| `/api/argo/positions` | `GET` | Coordinates and surface metrics for 64 Argo floats |
| `/api/argo/profile/{id}` | `GET` | Vertical profile data (depths, temperature, salinity) for float ID |
| `/api/coastline` | `GET` | Natural Earth 110m coastline GeoJSON features |
| `/api/cache/clear` | `POST` | Flushes backend in-memory cache |

---

## 📁 Repository Structure

```
oceanview-3d/
├── backend/
│   ├── main.py                    # FastAPI server with all endpoints & caching
│   └── requirements.txt           # Python backend dependencies
├── scripts/
│   ├── preprocess_model.py        # NetCDF -> JSON depth slices
│   └── preprocess_argo.py         # Argo profiles parser & QC filter
├── public/
│   └── data/
│       ├── tiles/                 # 32 model tiles (temperature & salinity, 0-5000m)
│       ├── argo/
│       │   ├── positions.json     # 64 float coordinates
│       │   └── profiles/          # 64 individual float profiles
│       ├── coastline.geojson      # Coastline vector lines
│       └── metadata.json          # Dataset metadata
├── src/                           # Frontend Three.js & UI components
├── AGENTS.md                      # AI coding context & project rules
└── README.md
```

---

## 👥 Team Responsibilities

- **DEV-A (3D Lead):** Three.js scene, camera, lights, volume rendering, depth slice, Argo markers, raycasting.
- **DEV-B (Data & Backend):** Data acquisition, NetCDF preprocessing, FastAPI backend, API endpoints.
- **DEV-C (Frontend & Charts):** HTML layout, dark theme CSS, controls panel, colorbar canvas, Plotly modal charts.
