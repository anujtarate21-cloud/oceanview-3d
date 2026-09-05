// Track whether FastAPI backend is reachable.
// Set to true only after a successful health-check ping at startup.
let _backendAvailable = false;

// ── LRU Tile Cache ──────────────────────────────────────────────────────────
// Avoids redundant fetch() calls when the user drags sliders, switches
// colormaps, or revisits a previously loaded depth/timestep combination.
const TILE_CACHE_MAX = 64;
const _tileCache = new Map(); // Map<url, {data, ts}>

function _cachePut(key, data) {
  if (_tileCache.size >= TILE_CACHE_MAX) {
    // Evict oldest entry (first inserted key)
    const oldest = _tileCache.keys().next().value;
    _tileCache.delete(oldest);
  }
  _tileCache.set(key, { data, ts: Date.now() });
}

function _cacheGet(key) {
  const entry = _tileCache.get(key);
  if (!entry) return null;
  // Move to end (most recently used)
  _tileCache.delete(key);
  _tileCache.set(key, entry);
  return entry.data;
}

/** Manually clear the tile cache (e.g. when user deletes cached date data) */
export function clearTileCache() {
  _tileCache.clear();
}

/**
 * Probe the FastAPI backend once. Called at app bootstrap.
 * Resolves in <300ms regardless — if the server is down we don't stall startup.
 */
export async function detectBackend() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(tid);
    _backendAvailable = res.ok;
  } catch {
    _backendAvailable = false;
  }
  return _backendAvailable;
}

async function tryFetch(url) {
  // Check LRU cache first
  const cached = _cacheGet(url);
  if (cached !== null) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    // Vite returns 200 + text/html for unmatched routes — check content-type
    if (!/json/i.test(contentType)) return null;
    const data = await res.json();
    if (data) _cachePut(url, data);
    return data;
  } catch {
    return null;
  }
}

// Fetch from API first (only if backend is up), then fall back to static files
async function smartFetch(apiPath, staticPath) {
  if (_backendAvailable) {
    const result = await tryFetch(apiPath);
    if (result) return result;
  }
  return tryFetch(staticPath);
}

export async function loadMetadata() {
  return smartFetch('/api/metadata', '/data/metadata.json');
}

const ALL_KNOWN_DATES = [
  '2022-01-04', '2022-09-06', '2023-03-21', '2023-08-02', '2023-08-31',
  '2024-07-31', '2024-08-25', '2024-08-28', '2024-08-31',
  '2024-09-01', '2024-09-02', '2024-09-03', '2024-09-04',
  '2024-09-05', '2024-09-06', '2024-09-07'
];

const LEGACY_DATE_MAP = {
  '2024-09-05': 0,
  '2024-09-06': 1,
  '2024-09-07': 2,
};

export async function loadModelData(variable, depth, timestep = 0, date = null) {
  const intDepth = Math.round(Number(depth));
  const varClean = String(variable).toLowerCase().trim();
  const effectiveDate = date || (typeof timestep === 'number' && ALL_KNOWN_DATES[timestep]) || null;

  // 1. Try date-keyed format: {var}_d{depth}_{date}.json
  if (effectiveDate) {
    const dated = await smartFetch(
      `/api/model-data?var=${varClean}&depth=${intDepth}&date=${effectiveDate}`,
      `/data/tiles/${varClean}_d${intDepth}_${effectiveDate}.json`
    );
    if (dated) return dated;

    // 2. If date is one of the legacy baseline dates, try _t0, _t1, _t2
    if (effectiveDate in LEGACY_DATE_MAP) {
      const legTs = LEGACY_DATE_MAP[effectiveDate];
      const legTile = await smartFetch(
        `/api/model-data?var=${varClean}&depth=${intDepth}&timestep=${legTs}`,
        `/data/tiles/${varClean}_d${intDepth}_t${legTs}.json`
      );
      if (legTile) return legTile;
    }
  }

  // 3. Try legacy index-based format: {var}_d{depth}_t{timestep}.json
  const t = typeof timestep === 'number' ? Math.round(timestep) : 0;
  return smartFetch(
    `/api/model-data?var=${varClean}&depth=${intDepth}&timestep=${t}`,
    `/data/tiles/${varClean}_d${intDepth}_t${t}.json`
  );
}

export async function loadArgoPositions(timestep = 0, date = null) {
  const effectiveDate = date || (typeof timestep === 'number' && ALL_KNOWN_DATES[timestep]) || null;

  // 1. Try date-keyed format: positions_{date}.json
  if (effectiveDate) {
    const dated = await smartFetch(
      `/api/argo/positions?date=${effectiveDate}`,
      `/data/argo/positions_${effectiveDate}.json`
    );
    if (dated && Array.isArray(dated) && dated.length > 0) return dated;

    if (effectiveDate in LEGACY_DATE_MAP) {
      const legTs = LEGACY_DATE_MAP[effectiveDate];
      const legDated = await smartFetch(
        `/api/argo/positions?timestep=${legTs}`,
        `/data/argo/positions_t${legTs}.json`
      );
      if (legDated && Array.isArray(legDated) && legDated.length > 0) return legDated;
    }
  }

  // 2. Try legacy timestep format: positions_t{timestep}.json
  const t = typeof timestep === 'number' ? Math.round(timestep) : 0;
  const dated = await smartFetch(
    `/api/argo/positions?timestep=${t}`,
    `/data/argo/positions_t${t}.json`
  );
  if (dated && Array.isArray(dated) && dated.length > 0) return dated;

  // 3. Fall back to base positions.json
  const base = await smartFetch('/api/argo/positions', '/data/argo/positions.json');
  if (base && Array.isArray(base) && base.length > 0) return base;

  return generateSyntheticArgoPositions();
}

export async function loadArgoProfile(floatId) {
  const cleanId = String(floatId).replace(/[\/\\]/g, '_').trim();
  return smartFetch(`/api/argo/profile/${cleanId}`, `/data/argo/profiles/${cleanId}.json`);
}

export async function loadCoastline() {
  return smartFetch('/api/coastline', '/data/coastline.geojson');
}

/**
 * Generates a synthetic depth-slice tile so the UI is fully demoable before
 * DEV-B's real HYCOM/Argo pipeline lands (per the AGENTS.md fallback plan).
 */
export function generateSyntheticTile(variable, depth, gridSize = 24) {
  const latMin = 0, latMax = 25, lonMin = 60, lonMax = 95;
  const lats = Array.from({ length: gridSize }, (_, i) => latMin + (i / (gridSize - 1)) * (latMax - latMin));
  const lons = Array.from({ length: gridSize }, (_, i) => lonMin + (i / (gridSize - 1)) * (lonMax - lonMin));

  let surfaceVal, deepVal;
  if (variable === 'salinity') { surfaceVal = 35.5; deepVal = 34.6; }
  else if (variable === 'chlorophyll') { surfaceVal = 2.0; deepVal = 0.05; }
  else if (variable === 'currents') { surfaceVal = 0.8; deepVal = 0.02; }
  else { surfaceVal = 29; deepVal = 3; } // temperature default
  const depthT = Math.min(1, depth / 2000);
  const baseVal = surfaceVal + (deepVal - surfaceVal) * Math.sqrt(depthT);

  const values = lats.map((lat, i) =>
    lons.map((lon, j) => {
      // Fake a land mask near the Indian coastline shape (very rough).
      const isLand = lat > 8 && lat < 23 && lon > 68 && lon < 78 && (lat - 8) / 15 < (lon - 68) / 10 * 0.6;
      if (isLand) return null;
      const wobbleScale = variable === 'chlorophyll' ? 0.3 : variable === 'currents' ? 0.15 : 1.2;
      const wobble = Math.sin(i * 0.7) * Math.cos(j * 0.5) * wobbleScale;
      return Math.round((baseVal + wobble) * 100) / 100;
    })
  );

  const flat = values.flat().filter((v) => v !== null);
  return {
    variable,
    depth,
    timestep: 0,
    units: variable === 'salinity' ? 'PSU' : variable === 'chlorophyll' ? 'mg/m\u00B3' : variable === 'currents' ? 'm/s' : '\u00B0C',
    lats: lats.map((l) => Math.round(l * 100) / 100),
    lons: lons.map((l) => Math.round(l * 100) / 100),
    values,
    min: Math.min(...flat),
    max: Math.max(...flat),
  };
}

export function generateSyntheticArgoPositions(count = 40) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    let lat, lon;
    const region = Math.random();
    if (region < 0.45) {
      lat = 4 + Math.random() * 16;
      lon = 62 + Math.random() * 9.5;
    } else if (region < 0.85) {
      lat = 5 + Math.random() * 15;
      lon = 83 + Math.random() * 10;
    } else {
      lat = 1 + Math.random() * 5;
      lon = 64 + Math.random() * 28;
    }
    positions.push({
      id: String(2902100 + i),
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      date: '2024-09-05',
      platform_type: Math.random() > 0.8 ? 'glider' : 'argo',
    });
  }
  return positions;
}

export function generateSyntheticProfile(floatId, lat, lon) {
  const depths = [5, 10, 20, 50, 100, 200, 500, 1000, 1500, 2000];
  const temperature = [29.4, 29.2, 28.6, 26.0, 21.5, 14.8, 8.6, 4.9, 3.1, 2.2].map(
    (v) => Math.round((v + (Math.random() - 0.5) * 0.6) * 10) / 10
  );
  const salinity = [35.3, 35.3, 35.2, 35.1, 35.0, 34.9, 34.8, 34.7, 34.6, 34.6].map(
    (v) => Math.round((v + (Math.random() - 0.5) * 0.1) * 100) / 100
  );
  return { float_id: floatId, lat, lon, date: '2026-08-01', depths, temperature, salinity };
}
