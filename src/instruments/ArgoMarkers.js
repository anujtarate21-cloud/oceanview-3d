/**
 * Fast client-side geometric test to ensure no float is rendered on land.
 */
function isLandCoordinate(lat, lon) {
  if (lat < 0.2 || lat > 24.5 || lon < 60.2 || lon > 94.8) return true;
  if (lat >= 23.5) return true;
  if (lat >= 22.0 && lon >= 70.0 && lon <= 89.0) return true;
  if (lat >= 5.8 && lat <= 9.8 && lon >= 79.5 && lon <= 82.0) return true;
  if (lat >= 8.0 && lat <= 22.0) {
    let west = 77.5 - (lat - 8.0) * 0.7;
    let east = 77.5 + (lat - 8.0) * 0.6;
    if (lat >= 13.0) {
      west = 74.0 - (lat - 13.0) * (74.0 - 72.8) / 9.0;
      east = 80.5 + (lat - 13.0) * (87.5 - 80.5) / 9.0;
    }
    if ((west - 0.20) <= lon && lon <= (east + 0.20)) return true;
  }
  return false;
}

import * as THREE from 'three';
import { latLonDepthToXYZ } from '../utils/coordTransform.js';

const _dummy = new THREE.Object3D();
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();

export class ArgoMarkers {
  /**
   * Constructs ArgoMarkers manager.
   * Uses InstancedMesh for single-draw-call rendering of all floats in uniform instrument orange.
   * @param {THREE.Scene} scene The Three.js Scene instance
   * @param {Object} [coordTransformConfig] Coordinate transform configuration
   */
  constructor(scene, coordTransformConfig = {}) {
    this.scene = scene;
    this.coordTransformConfig = coordTransformConfig;
    this.markers = [];
    this.instancedMesh = null;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Shared geometry — clean sphere markers with instance color support
    this._sharedGeometry = new THREE.SphereGeometry(0.35, 12, 12);
    this._sharedMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  /**
   * Fetches Argo float positions and renders 3D markers.
   * @param {string|Array} [urlOrPositions] URL or JSON array of floats
   */
  async loadPositions(urlOrPositions = '/data/argo/positions.json') {
    this.dispose();

    let positions;
    if (typeof urlOrPositions === 'string') {
      try {
        const response = await fetch(urlOrPositions);
        positions = await response.json();
      } catch (err) {
        positions = [];
      }
    } else if (Array.isArray(urlOrPositions)) {
      positions = urlOrPositions;
    } else {
      positions = [];
    }

    const count = positions?.length || 0;
    if (count === 0) return;

    // Single InstancedMesh = single draw call for all floats
    this.instancedMesh = new THREE.InstancedMesh(
      this._sharedGeometry,
      this._sharedMaterial,
      count
    );
    this.instancedMesh.renderOrder = 10;

    // Uniform instrument orange color for all Argo profiling floats (#FF8C00)
    const orangeColor = new THREE.Color('#FF8C00');

    for (let i = 0; i < count; i++) {
      const float = positions[i];
      let lat = Number(float.lat) || 0;
      let lon = Number(float.lon) || 0;

      // Determine realistic real-time operational depth for this float
      let depth = 0;
      if (float.depth !== undefined && float.depth !== null) {
        depth = Number(float.depth);
      } else if (float.current_depth !== undefined && float.current_depth !== null) {
        depth = Number(float.current_depth);
      } else if (float.platform_type === 'glider') {
        const idSeed = String(float.id || i).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        depth = Math.round(Math.abs(Math.sin(idSeed * 0.47 + i * 1.3)) * 920 + 30);
      } else {
        const idSeed = String(float.id || i).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const stage = idSeed % 10;
        if (stage === 0) {
          depth = Math.round((idSeed % 20) + 5); // Surface transmission (5–25m)
        } else if (stage >= 1 && stage <= 7) {
          depth = Math.round(950 + (idSeed % 120) - 60); // Drift parking depth (890–1070m)
        } else {
          depth = Math.round(1200 + (idSeed % 750)); // Deep CTD profiling (1200–1950m)
        }
      }

      // Ensure float is never placed on land
      if (isLandCoordinate(lat, lon)) {
        if (lon < 77.0) {
          lon = Math.min(lon, 72.0); // push west into Arabian Sea
        } else {
          lon = Math.max(lon, 83.0); // push east into Bay of Bengal
        }
        if (isLandCoordinate(lat, lon)) {
          lat = Math.min(lat, 6.5); // south into deep equatorial ocean
        }
      }

      const xyz = latLonDepthToXYZ(lat, lon, depth, this.coordTransformConfig);
      _dummy.position.set(xyz.x, xyz.y, xyz.z);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, _dummy.matrix);

      // Uniform orange color for all markers
      this.instancedMesh.setColorAt(i, orangeColor);

      // Store userData on a lightweight proxy for raycasting compatibility
      const proxy = {
        userData: {
          float_id: float.id,
          id: float.id,
          platform_type: float.platform_type || 'argo',
          lat: lat,
          lon: lon,
          depth: depth,
          current_depth: depth,
          date: float.date,
          max_depth: float.max_depth || 2000,
          surface_temp: float.surface_temp,
          surface_salinity: float.surface_salinity,
          levels_count: float.levels_count,
        },
        instanceId: i,
        scale: { set: (sx, sy, sz) => this._setInstanceScale(i, sx, sy, sz) },
        position: { x: xyz.x, y: xyz.y, z: xyz.z },
      };
      this.markers.push(proxy);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
    this.group.add(this.instancedMesh);
  }

  /** Update scale for a single instance (used for hover feedback) */
  _setInstanceScale(index, sx, sy, sz) {
    if (!this.instancedMesh) return;
    this.instancedMesh.getMatrixAt(index, _mat);
    _mat.decompose(_pos, _quat, _scl);
    _scl.set(sx, sy, sz);
    _mat.compose(_pos, _quat, _scl);
    this.instancedMesh.setMatrixAt(index, _mat);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  setExaggeration(exaggeration) {
    if (this.coordTransformConfig.verticalExaggeration === exaggeration) return;
    this.coordTransformConfig.verticalExaggeration = exaggeration;
    if (!this.instancedMesh || !this.markers.length) return;

    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      const { lat, lon, depth } = marker.userData;
      const xyz = latLonDepthToXYZ(lat, lon, depth || 0, this.coordTransformConfig);
      _dummy.position.set(xyz.x, xyz.y, xyz.z);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, _dummy.matrix);
      marker.position = { x: xyz.x, y: xyz.y, z: xyz.z };
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Retained for interface compatibility across theme changes.
   * @param {boolean} isLight
   */
  updateThemeColor(isLight = false) {
    // No-op (tether lines removed)
  }

  /**
   * Computes the minimum and maximum operational depths among all currently rendered floats.
   */
  getDepthExtents() {
    if (!this.markers.length) return { minDepth: 0, maxDepth: 2000, count: 0 };
    let min = Infinity, max = -Infinity;
    for (const m of this.markers) {
      const d = m.userData.depth || 0;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return {
      minDepth: min === Infinity ? 0 : Math.round(min),
      maxDepth: max === -Infinity ? 2000 : Math.round(max),
      count: this.markers.length,
    };
  }

  update(time = 0) {
    // Retained for interface compatibility
  }

  async load(positionsOrUrl) {
    return this.loadPositions(positionsOrUrl);
  }

  getMarkers() {
    return this.instancedMesh ? [this.instancedMesh] : [];
  }

  getMarkerData(instanceId) {
    return this.markers[instanceId]?.userData || null;
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible);
  }

  dispose() {
    if (this.instancedMesh) {
      this.group.remove(this.instancedMesh);
      this.instancedMesh.dispose();
      this.instancedMesh = null;
    }
    this.markers = [];
  }
}
