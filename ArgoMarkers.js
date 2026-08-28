import * as THREE from 'three';
import { latLonDepthToXYZ } from '../utils/coordTransform.js';

export class ArgoMarkers {
  /**
   * Constructs ArgoMarkers manager.
   * @param {THREE.Scene} scene The Three.js Scene instance
   * @param {Object} [coordTransformConfig] Coordinate transform configuration
   */
  constructor(scene, coordTransformConfig = {}) {
    this.scene = scene;
    this.coordTransformConfig = coordTransformConfig;
    this.markers = [];
    this.geometry = null;
    this.material = null;
    this.group = new THREE.Group();
    this.scene.add(this.group);
  }

  /**
   * Fetches Argo float positions and renders 3D markers.
   * @param {string|Array} [urlOrPositions] URL or JSON array of floats
   */
  async loadPositions(urlOrPositions = '/data/argo/positions.json') {
    this.dispose();

    let positions;
    if (typeof urlOrPositions === 'string') {
      const response = await fetch(urlOrPositions);
      positions = await response.json();
    } else if (Array.isArray(urlOrPositions)) {
      positions = urlOrPositions;
    } else {
      console.error('Invalid arguments passed to loadPositions');
      return;
    }

    this.geometry = new THREE.SphereGeometry(0.3, 8, 8);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffa500 });

    for (const float of positions) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      const xyz = latLonDepthToXYZ(float.lat, float.lon, 0, this.coordTransformConfig);
      // Depth is encoded on Z (see coordTransform.js / AGENTS.md), not Y —
      // nudge along Z so the marker sits slightly above the surface mesh
      // instead of sharing its exact Z and risking z-fighting/clipping.
      mesh.position.set(xyz.x, xyz.y, xyz.z + 0.1);
      mesh.userData = {
        float_id: float.id,
        id: float.id,
        platform_type: float.platform_type,
        lat: float.lat,
        lon: float.lon,
        date: float.date
      };

      this.group.add(mesh);
      this.markers.push(mesh);
    }
  }

  /**
   * Backward-compatible alias for loadPositions.
   */
  async load(positionsOrUrl) {
    return this.loadPositions(positionsOrUrl);
  }

  /**
   * Returns markers array for raycasting.
   * @returns {Array<THREE.Mesh>}
   */
  getMarkers() {
    return this.markers;
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
    for (const marker of this.markers) {
      this.group.remove(marker);
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.markers = [];
  }
}

