import * as THREE from 'three';

// Colormaps as arrays of 256 [r, g, b] triplets (0-255).
// Generated procedurally from a small set of control-point stops so the
// file stays tiny; interpolation gives a smooth 256-entry ramp.
function buildRamp(stops) {
  const ramp = [];
  const n = stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const segment = Math.min(Math.floor(t * n), n - 1);
    const localT = t * n - segment;
    const [r1, g1, b1] = stops[segment];
    const [r2, g2, b2] = stops[segment + 1];
    ramp.push([
      Math.round(r1 + (r2 - r1) * localT),
      Math.round(g1 + (g2 - g1) * localT),
      Math.round(b1 + (b2 - b1) * localT)
    ]);
  }
  return ramp;
}

// Approximation of matplotlib's viridis
export const viridis = buildRamp([
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142],
  [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89],
  [180, 222, 44], [253, 231, 37]
]);

// Warm "thermal" ramp — good for temperature fields
export const thermal = buildRamp([
  [3, 5, 60], [30, 26, 110], [92, 26, 130], [156, 25, 110],
  [206, 55, 70], [232, 106, 40], [244, 156, 24], [250, 208, 60],
  [255, 250, 180]
]);

// Cool "haline" ramp — good for salinity fields
export const haline = buildRamp([
  [41, 10, 84], [33, 61, 122], [23, 105, 137], [22, 141, 137],
  [45, 172, 125], [110, 197, 106], [187, 215, 96], [246, 231, 120],
  [255, 247, 195]
]);

// Classic jet, as a simple fallback
export const jet = buildRamp([
  [0, 0, 131], [0, 60, 255], [0, 200, 255], [80, 255, 170],
  [200, 255, 60], [255, 210, 0], [255, 100, 0], [128, 0, 0]
]);

export const COLORMAPS = { viridis, thermal, haline, jet };
export const VIRIDIS = viridis;

/**
 * Map a data value to a THREE.Color instance using the given colormap.
 */
export function valueToColor(value, min, max, colormap = viridis) {
  const cmap = typeof colormap === 'string' ? (COLORMAPS[colormap] || viridis) : colormap;
  if (value === null || value === undefined || Number.isNaN(value)) {
    return new THREE.Color(0.29, 0.29, 0.37); // land grey
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const index = Math.floor(t * 255);
  const [r, g, b] = (Array.isArray(cmap) ? cmap : viridis)[index] || [74, 74, 94];
  return new THREE.Color(r / 255, g / 255, b / 255);
}

/**
 * Map a data value to an [r, g, b] triplet (0-255) using the given colormap.
 * Returns the land/grey color for null / NaN.
 */
export function valueToRGB(value, min, max, colormapArray) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return [74, 74, 94]; // land/masked grey, matches --land
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const index = Math.floor(t * 255);
  const cmap = Array.isArray(colormapArray) ? colormapArray : (COLORMAPS[colormapArray] || viridis);
  return cmap[index] || [74, 74, 94];
}

export function rgbToCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}
