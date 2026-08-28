const DEFAULTS = {
  latCenter: 12.5,
  lonCenter: 77.5,
  scaleFactor: 1.6,
  verticalExaggeration: 50,
};

export function getDepthZ(depth, verticalExaggeration = 50) {
  // Proportional vertical scaling: at 50x exaggeration, 5000m = -15 scene units (~30% of horizontal domain)
  return -Number(depth || 0) * (Number(verticalExaggeration || 50) / 50) * 0.003;
}

export function latLonDepthToXYZ(lat, lon, depth = 0, config = {}) {
  const { latCenter, lonCenter, scaleFactor, verticalExaggeration } = { ...DEFAULTS, ...config };
  return {
    x: (lon - lonCenter) * scaleFactor,
    y: (lat - latCenter) * scaleFactor,
    z: getDepthZ(depth, verticalExaggeration),
  };
}

export { DEFAULTS as coordDefaults };

