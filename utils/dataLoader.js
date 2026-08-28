// Track whether FastAPI backend is reachable.
// Set to true only after a successful health-check ping at startup.
let _backendAvailable = false;

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
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    // Vite returns 200 + text/html for unmatched routes — check content-type
    if (!/json/i.test(contentType)) return null;
    return await res.json();
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

export async function loadModelData(variable, depth, timestep = 0) {
  const intDepth = Math.round(Number(depth));
  const varClean = String(variable).toLowerCase().trim();
  return smartFetch(
    `/api/model-data?var=${varClean}&depth=${intDepth}&timestep=${timestep}`,
    `/data/tiles/${varClean}_d${intDepth}_t${timestep}.json`
  );
}

export async function loadArgoPositions(timestep = 0) {
  const t = Math.round(Number(timestep)) || 0;
  // Floats drift day to day, so prefer a per-timestep snapshot (mirrors the
  // model-tile naming convention: {var}_d{depth}_t{timestep}.json). If none
  // exists yet — the common case, since DEV-B's plan only guarantees a single
  // positions.json — fall back to the static file so this never breaks.
  const dated = await smartFetch(
    `/api/argo/positions?timestep=${t}`,
    `/data/argo/positions_t${t}.json`
  );
  if (dated) return dated;
  return smartFetch('/api/argo/positions', '/data/argo/positions.json');
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

  const surfaceVal = variable === 'salinity' ? 35.5 : variable === 'chlorophyll' ? 2.0 : 29;
  const deepVal = variable === 'salinity' ? 34.6 : variable === 'chlorophyll' ? 0.05 : 3;
  const depthT = Math.min(1, depth / 2000);
  const baseVal = surfaceVal + (deepVal - surfaceVal) * Math.sqrt(depthT);

  const values = lats.map((lat, i) =>
    lons.map((lon, j) => {
      // Fake a land mask near the Indian coastline shape (very rough).
      const isLand = lat > 8 && lat < 23 && lon > 68 && lon < 78 && (lat - 8) / 15 < (lon - 68) / 10 * 0.6;
      if (isLand) return null;
      const wobble = Math.sin(i * 0.7) * Math.cos(j * 0.5) * (variable === 'chlorophyll' ? 0.3 : 1.2);
      return Math.round((baseVal + wobble) * 100) / 100;
    })
  );

  const flat = values.flat().filter((v) => v !== null);
  return {
    variable,
    depth,
    timestep: 0,
    units: variable === 'salinity' ? 'PSU' : variable === 'chlorophyll' ? 'mg/m³' : '°C',
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
    positions.push({
      id: String(2902100 + i),
      lat: 2 + Math.random() * 21,
      lon: 62 + Math.random() * 31,
      date: '2026-08-01',
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
