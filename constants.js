/**
 * constants.js — Global constants for OceanView 3D
 * All magic numbers / defaults live here so other modules stay clean.
 */

// ── Camera ─────────────────────────────────────────────────────────────────
export const CAMERA_INITIAL_POSITION = { x: 0, y: -60, z: 60 };
export const CAMERA_FOV      = 45;
export const CAMERA_NEAR     = 0.1;
export const CAMERA_FAR      = 2000;

// ── Scene scale ─────────────────────────────────────────────────────────────
/** Degrees → scene-unit factor for lat/lon */
export const GEO_SCALE = 1.6;

/** Indian Ocean grid centre used for coordinate transformation */
export const LON_CENTER = 77.5;
export const LAT_CENTER = 12.5;

// ── Vertical exaggeration ───────────────────────────────────────────────────
export const DEFAULT_VERT_EXAG = 50;
export const MIN_VERT_EXAG     = 1;
export const MAX_VERT_EXAG     = 200;

// ── Depth levels (metres) — mirrors metadata.json depth_levels ──────────────
export const DEFAULT_DEPTH_LEVELS = [0, 10, 25, 50, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000, 5000];

// ── Animation ───────────────────────────────────────────────────────────────
/** Milliseconds between auto-play timestep advances */
export const PLAY_INTERVAL_MS   = 1200;

/** Milliseconds to debounce depth-slider input before fetching a tile */
export const DEPTH_DEBOUNCE_MS  = 180;

/** Milliseconds to throttle mousemove raycasting */
export const RAYCAST_THROTTLE_MS = 60;

// ── Colours ──────────────────────────────────────────────────────────────────
export const COLOR_LAND       = 0x222222;  // grey for masked / NaN cells
export const COLOR_COASTLINE  = 0x00d4aa;  // accent teal
export const COLOR_ARGO_FLOAT = 0xffd700;  // gold
export const COLOR_GLIDER     = 0xff6b6b;  // coral

// ── Default variable & colormap ──────────────────────────────────────────────
export const DEFAULT_VARIABLE = 'temperature';
export const DEFAULT_COLORMAP = 'viridis';

// ── Argo marker geometry ─────────────────────────────────────────────────────
export const ARGO_SPHERE_RADIUS   = 0.35;
export const ARGO_SPHERE_SEGMENTS = 8;

// ── Colourbar ────────────────────────────────────────────────────────────────
export const COLORBAR_CANVAS_WIDTH  = 180;
export const COLORBAR_CANVAS_HEIGHT = 16;
