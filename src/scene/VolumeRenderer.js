import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ, coordDefaults } from '../utils/coordTransform.js';
import { valueToColor, VIRIDIS } from '../utils/colormaps.js';
import { loadModelData, generateSyntheticTile } from '../utils/dataLoader.js';

// Reusable Color object — avoids per-vertex allocation in tight loops
const _tmpColor = new THREE.Color();

// Curated context horizons that match the aquarium ruler badges
const CONTEXT_DEPTHS = [0, 200, 500, 1000, 2000];

export class VolumeRenderer {
  /**
   * High-Performance 3D Volumetric Ocean Stack Renderer.
   * Renders the active depth slice at high opacity (0.95), with vividly visible,
   * semi-transparent context horizons (0.38 opacity) lining up with the depth ruler.
   */
  constructor(scene, colormap = VIRIDIS) {
    this.scene = scene;
    this.colormap = colormap;
    this.opacity = 0.95;
    this.contextOpacity = 0.38; // Clearly visible translucent wash
    this.exaggeration = coordDefaults.verticalExaggeration || 75;

    this.activeMesh = null;
    this.activeDepth = 0;
    this.lastTile = null;

    /** Map<depth, { mesh, tile }> for background context depth slices */
    this.contextLayers = new Map();

    /** Token to cancel stale background loads when variable/date changes */
    this._loadContextToken = 0;

    /** Cached min/max from last render — used for color updates */
    this._lastMin = 0;
    this._lastMax = 1;
  }

  get currentMesh() {
    return this.activeMesh;
  }

  setExaggeration(exaggeration) {
    const next = Number(exaggeration);
    this.exaggeration = Number.isFinite(next) ? Math.max(1, Math.min(200, next)) : 75;
    coordDefaults.verticalExaggeration = this.exaggeration;

    // Reposition active mesh
    if (this.activeMesh) {
      this.activeMesh.position.z = getDepthZ(this.activeDepth, this.exaggeration);
    }

    // Reposition all context layer meshes
    for (const [depth, layer] of this.contextLayers.entries()) {
      if (layer.mesh) {
        layer.mesh.position.z = getDepthZ(depth, this.exaggeration);
      }
    }
  }

  setColormap(colormap) {
    this.colormap = colormap;
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0.1, Math.min(1.0, Number(opacity) || 0.95));
    if (this.activeMesh?.material) {
      this.activeMesh.material.opacity = this.opacity;
      this.activeMesh.material.needsUpdate = true;
    }
  }

  updateDepth(tile) {
    this.loadDepthSlice(tile);
  }

  /** Compute min/max for the current tile and variable */
  _computeMinMax(tile) {
    const varName = String(tile.variable || 'temperature').toLowerCase();
    let min, max;
    if (varName === 'salinity') {
      const sliceMin = tile.slice_min !== undefined ? tile.slice_min : (tile.min !== undefined ? tile.min : 33.0);
      const sliceMax = tile.slice_max !== undefined ? tile.slice_max : (tile.max !== undefined ? tile.max : 36.5);
      min = Math.max(32.5, Math.min(sliceMin, 34.0));
      max = Math.min(36.8, Math.max(sliceMax, 35.8));
    } else if (varName === 'chlorophyll') {
      min = tile.slice_min !== undefined ? tile.slice_min : (tile.min !== undefined ? tile.min : 0.02);
      max = tile.slice_max !== undefined ? Math.min(tile.slice_max, 4.0) : (tile.max !== undefined ? Math.min(tile.max, 4.0) : 2.5);
    } else if (varName === 'currents') {
      min = 0.0;
      max = tile.slice_max !== undefined ? Math.max(tile.slice_max, 0.6) : (tile.max !== undefined ? Math.max(tile.max, 0.6) : 1.2);
    } else {
      min = tile.global_min !== undefined ? tile.global_min : (tile.min !== undefined ? tile.min : (tile.slice_min !== undefined ? tile.slice_min : 2.0));
      max = tile.global_max !== undefined ? tile.global_max : (tile.max !== undefined ? tile.max : (tile.slice_max !== undefined ? tile.slice_max : 31.5));
    }
    if (min >= max) { min = 0; max = 1; }
    return { min, max };
  }

  /** Build a Three.js mesh for a given 2D grid depth tile */
  _createSliceMesh(tile, opacity, depthWrite) {
    if (!tile || !tile.values || !tile.lats || !tile.lons) return null;
    const { lats, lons, values } = tile;
    const { min, max } = this._computeMinMax(tile);

    const numLats = lats.length;
    const numLons = lons.length;
    const totalVertices = numLats * numLons;

    const positions = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 3);

    let ptr = 0;
    for (let i = 0; i < numLats; i++) {
      for (let j = 0; j < numLons; j++) {
        const xyz = latLonDepthToXYZ(lats[i], lons[j], 0);
        positions[ptr * 3]     = xyz.x;
        positions[ptr * 3 + 1] = xyz.y;
        positions[ptr * 3 + 2] = 0;

        valueToColor(values[i][j], min, max, this.colormap, _tmpColor);
        colors[ptr * 3]     = _tmpColor.r;
        colors[ptr * 3 + 1] = _tmpColor.g;
        colors[ptr * 3 + 2] = _tmpColor.b;
        ptr++;
      }
    }

    const indexCount = (numLats - 1) * (numLons - 1) * 6;
    const IndexArray = totalVertices > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(indexCount);
    let idx = 0;
    for (let i = 0; i < numLats - 1; i++) {
      for (let j = 0; j < numLons - 1; j++) {
        const a = i * numLons + j;
        const b = a + 1;
        const c = a + numLons;
        const d = c + 1;
        indices[idx++] = a;
        indices[idx++] = b;
        indices[idx++] = d;
        indices[idx++] = a;
        indices[idx++] = d;
        indices[idx++] = c;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide, // Fully visible from all angles (above, tilt, side)
      transparent: true,
      opacity: opacity,
      depthWrite: depthWrite,
      blending: THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, getDepthZ(tile.depth || 0, this.exaggeration));
    mesh.renderOrder = depthWrite ? 2 : 1;
    return mesh;
  }

  /**
   * Fast color-only update — recomputes vertex colors across active mesh
   * and all translucent context layers.
   */
  updateColors() {
    if (this.activeMesh && this.lastTile) {
      this._updateMeshColors(this.activeMesh, this.lastTile);
    }
    for (const layer of this.contextLayers.values()) {
      if (layer.mesh && layer.tile) {
        this._updateMeshColors(layer.mesh, layer.tile);
      }
    }
  }

  _updateMeshColors(mesh, tile) {
    if (!mesh || !tile || !tile.values) return;
    const { min, max } = this._computeMinMax(tile);
    const { lats, lons, values } = tile;
    const colors = mesh.geometry.attributes.color;
    if (!colors) return;

    const arr = colors.array;
    let ptr = 0;
    for (let i = 0; i < lats.length; i++) {
      for (let j = 0; j < lons.length; j++) {
        valueToColor(values[i][j], min, max, this.colormap, _tmpColor);
        arr[ptr]     = _tmpColor.r;
        arr[ptr + 1] = _tmpColor.g;
        arr[ptr + 2] = _tmpColor.b;
        ptr += 3;
      }
    }
    colors.needsUpdate = true;
  }

  /**
   * Loads the active depth slice and triggers progressive background loading
   * of the 3D context horizons.
   */
  loadDepthSlice(tile) {
    if (!tile || !tile.values || !tile.lats || !tile.lons) return;

    const prevVar = this.lastTile?.variable;
    const prevDate = this.lastTile?.date;
    const isNewSeries = prevVar !== tile.variable || prevDate !== tile.date;

    this.lastTile = tile;
    const targetDepth = Number(tile.depth || 0);
    this.activeDepth = targetDepth;

    const { min, max } = this._computeMinMax(tile);
    this._lastMin = min;
    this._lastMax = max;

    // If dataset variable or date changed, clear old context slices
    if (isNewSeries) {
      this._clearContextMeshes();
    }

    // Dispose old active mesh
    if (this.activeMesh) {
      this.scene.remove(this.activeMesh);
      this.activeMesh.geometry?.dispose();
      this.activeMesh.material?.dispose();
      this.activeMesh = null;
    }

    // Build fresh active mesh at full opacity (0.95)
    this.activeMesh = this._createSliceMesh(tile, this.opacity, true);
    if (this.activeMesh) {
      this.scene.add(this.activeMesh);
    }

    // Toggle visibility of context layers so they never duplicate the active depth
    for (const [d, layer] of this.contextLayers.entries()) {
      if (layer.mesh) {
        layer.mesh.visible = (d !== targetDepth);
      }
    }

    // Trigger asynchronous fetch of context depth horizons
    this._loadContextStack(tile.variable, tile.date, tile.timestep);
  }

  /**
   * Fetches and renders the context depth horizons in the background.
   */
  async _loadContextStack(variable, date, timestep) {
    const token = ++this._loadContextToken;
    const depthsToLoad = CONTEXT_DEPTHS.filter(d => d !== this.activeDepth);

    for (const d of depthsToLoad) {
      if (token !== this._loadContextToken) return;

      // If already loaded for current variable/date, ensure visibility and proper opacity
      if (this.contextLayers.has(d)) {
        const layer = this.contextLayers.get(d);
        if (layer.mesh) {
          layer.mesh.visible = (d !== this.activeDepth);
          layer.mesh.material.opacity = this.contextOpacity;
          layer.mesh.material.depthWrite = false;
        }
        continue;
      }

      try {
        let tile = await loadModelData(variable, d, timestep, date);
        if (!tile) {
          tile = generateSyntheticTile(variable, d);
        }
        if (token !== this._loadContextToken) return;
        if (!tile || !tile.values) continue;

        // Build context mesh with DoubleSide and rich 0.38 opacity
        const mesh = this._createSliceMesh(tile, this.contextOpacity, false);
        if (mesh) {
          mesh.visible = (d !== this.activeDepth);
          this.scene.add(mesh);
          this.contextLayers.set(d, { mesh, tile });
        }
      } catch (err) {
        // Soft fail
      }
    }
  }

  _clearContextMeshes() {
    this._loadContextToken++;
    for (const layer of this.contextLayers.values()) {
      if (layer.mesh) {
        this.scene.remove(layer.mesh);
        layer.mesh.geometry?.dispose();
        layer.mesh.material?.dispose();
      }
    }
    this.contextLayers.clear();
  }

  dispose() {
    if (this.activeMesh) {
      this.scene.remove(this.activeMesh);
      this.activeMesh.geometry?.dispose();
      this.activeMesh.material?.dispose();
      this.activeMesh = null;
    }
    this._clearContextMeshes();
  }
}
