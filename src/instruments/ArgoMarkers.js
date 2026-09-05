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
   * Uses InstancedMesh for single-draw-call rendering of all floats.
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
    // Shared geometry — clean sphere markers
    this._sharedGeometry = new THREE.SphereGeometry(0.35, 12, 12);
    this._sharedMaterial = new THREE.MeshBasicMaterial({ color: 0xffa500 });
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

    for (let i = 0; i < count; i++) {
      const float = positions[i];
      let lat = Number(float.lat) || 0;
      let lon = Number(float.lon) || 0;

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
      const xyz = latLonDepthToXYZ(lat, lon, 0, this.coordTransformConfig);
      _dummy.position.set(xyz.x, xyz.y, xyz.z + 0.35);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, _dummy.matrix);

      // Store userData on a lightweight proxy for raycasting compatibility
      const proxy = {
        userData: {
          float_id: float.id,
          id: float.id,
          platform_type: float.platform_type || 'argo',
          lat: lat,
          lon: lon,
          date: float.date,
          max_depth: float.max_depth,
          surface_temp: float.surface_temp,
          surface_salinity: float.surface_salinity,
          levels_count: float.levels_count,
        },
        instanceId: i,
        // Scale methods for hover feedback
        scale: { set: (sx, sy, sz) => this._setInstanceScale(i, sx, sy, sz) },
        position: { x: xyz.x, y: xyz.y, z: xyz.z + 0.35 },
      };
      this.markers.push(proxy);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
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
    // Retained for interface compatibility
  }

  update(time = 0) {
    // Retained for interface compatibility
  }

  /**
   * Backward-compatible alias for loadPositions.
   */
  async load(positionsOrUrl) {
    return this.loadPositions(positionsOrUrl);
  }

  /**
   * Returns the instanced mesh for raycasting.
   * @returns {Array<THREE.InstancedMesh>}
   */
  getMarkers() {
    return this.instancedMesh ? [this.instancedMesh] : [];
  }

  /**
   * Returns userData for a given instanceId.
   */
  getMarkerData(instanceId) {
    return this.markers[instanceId]?.userData || null;
  }

  /**
   * Sets visibility of markers group.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.group.visible = visible;
  }

  /**
   * Cleans up GPU memory and removes objects from scene.
   */
  dispose() {
    if (this.instancedMesh) {
      this.group.remove(this.instancedMesh);
      this.instancedMesh.dispose();
      this.instancedMesh = null;
    }
    this.markers = [];
  }
}
