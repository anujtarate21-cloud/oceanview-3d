import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ, coordDefaults } from '../utils/coordTransform.js';
import { valueToColor, VIRIDIS } from '../utils/colormaps.js';
import { loadModelData, generateSyntheticTile } from '../utils/dataLoader.js';

// Reusable Color object — avoids per-vertex allocation in tight loops
const _tmpColor = new THREE.Color();

// Curated 3D context horizons (Thermocline 200m, Intermediate 1000m, Deep 2000m)
const CONTEXT_DEPTHS = [200, 1000, 2000];

// Context layer subsampling factor — context planes render at 1/CONTEXT_STRIDE resolution.
// At stride=3 the context mesh has 1/9 the vertices (~7,300 vs 66,000) → 9× faster rasterization on low-end GPUs.
const CONTEXT_STRIDE = 3;

// Reusable grid coordinate and topology cache — avoids repeating latLonDepthToXYZ per cell
const _gridCache = new Map();

export class VolumeRenderer {
  /**
   * High-Performance 3D Volumetric Ocean Stack Renderer.
   * Renders the active depth slice at full resolution and high opacity (0.95),
   * with lightweight, semi-transparent context horizons (0.35 opacity) always visible.
   * Includes theme-aware soft edge falloff and subtle volumetric vignette shading.
   *
   * @param {THREE.Scene} scene
   * @param {string}      colormap
   * @param {object}      [oceanScene]  Reference to OceanScene container
   */
  constructor(scene, colormap = VIRIDIS, oceanScene = null) {
    this.scene        = scene;
    this.colormap     = colormap;
    this.opacity      = 0.95;
    this.contextOpacity = 0.35;
    this.exaggeration = coordDefaults.verticalExaggeration || 75;

    this._oceanScene  = oceanScene;

    this.activeMesh   = null;
    this.activeDepth  = 0;
    this.lastTile     = null;

    /** Active Theme background color for soft edge blending (zero dark halo on light mode) */
    this.themeBgColor = new THREE.Color(0x0a0a2e);
    this.isLightMode  = false;
    this.isLogScale   = false;

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

  setLogScale(isLogScale) {
    const next = Boolean(isLogScale);
    if (this.isLogScale === next) return;
    this.isLogScale = next;
    this.updateColors();
  }

  _getCurrentContextOpacity() {
    const contextFactor = this.opacity / 0.95;
    return Math.max(0.0, Math.min(1.0, this.contextOpacity * contextFactor));
  }

  setOpacity(opacity) {
    const val = Number(opacity);
    const validOpacity = Number.isFinite(val) ? Math.max(0.0, Math.min(1.0, val)) : 0.95;
    this.opacity = validOpacity;

    // Update active slice mesh
    if (this.activeMesh?.material) {
      this.activeMesh.material.transparent = this.opacity < 0.99;
      this.activeMesh.material.opacity = this.opacity;
      this.activeMesh.material.visible = (this.opacity > 0.001);
      this.activeMesh.material.needsUpdate = true;
    }

    // Scale context horizons opacity proportionally (at 0% slider, hides context horizons completely)
    const curCtxOpacity = this._getCurrentContextOpacity();
    for (const [d, layer] of this.contextLayers.entries()) {
      if (layer.mesh?.material) {
        layer.mesh.material.transparent = curCtxOpacity < 0.99;
        layer.mesh.material.opacity = curCtxOpacity;
        layer.mesh.material.visible = (curCtxOpacity > 0.001) && (d !== this.activeDepth);
        layer.mesh.material.needsUpdate = true;
      }
    }
  }

  /**
   * Updates theme background color to ensure soft plane edge fades match light/dark ambient environment.
   * @param {number|string} bgHex
   * @param {boolean} [isLight=false]
   */
  setThemeColors(bgHex, isLight = false) {
    if (bgHex !== undefined && bgHex !== null) {
      this.themeBgColor.set(bgHex);
    }
    this.isLightMode = Boolean(isLight);
    this.updateColors();
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

  /**
   * Build a Three.js mesh for a given 2D grid depth tile with soft edge falloff.
   * @param {object}  tile
   * @param {number}  opacity
   * @param {boolean} depthWrite   true = active slice, false = context layer
   * @param {number}  [stride=1]   Subsampling stride: stride=3 → 1/9th vertex count
   */
  _createSliceMesh(tile, opacity, depthWrite, stride = 1) {
    if (!tile || !tile.values || !tile.lats || !tile.lons) return null;
    const { lats, lons, values } = tile;
    const { min, max } = this._computeMinMax(tile);

    // Build subsampled lat/lon index arrays
    const latIdxs = [];
    const lonIdxs = [];
    for (let i = 0; i < lats.length; i += stride) latIdxs.push(i);
    for (let j = 0; j < lons.length; j += stride) lonIdxs.push(j);

    const numLats = latIdxs.length;
    const numLons = lonIdxs.length;
    const totalVertices = numLats * numLons;

    const gridKey = `${numLats}_${numLons}_${lats[latIdxs[0]]}_${lons[lonIdxs[0]]}_s${stride}`;
    let cachedGrid = _gridCache.get(gridKey);
    if (!cachedGrid) {
      const pos = new Float32Array(totalVertices * 3);
      let p = 0;
      for (let ii = 0; ii < numLats; ii++) {
        const i = latIdxs[ii];
        for (let jj = 0; jj < numLons; jj++) {
          const j = lonIdxs[jj];
          const xyz = latLonDepthToXYZ(lats[i], lons[j], 0);
          pos[p * 3]     = xyz.x;
          pos[p * 3 + 1] = xyz.y;
          pos[p * 3 + 2] = 0;
          p++;
        }
      }

      const indexCount = (numLats - 1) * (numLons - 1) * 6;
      const IndexArray = totalVertices > 65535 ? Uint32Array : Uint16Array;
      const ind = new IndexArray(indexCount);
      let idx = 0;
      for (let ii = 0; ii < numLats - 1; ii++) {
        for (let jj = 0; jj < numLons - 1; jj++) {
          const a = ii * numLons + jj;
          const b = a + 1;
          const c = a + numLons;
          const d = c + 1;
          ind[idx++] = a;
          ind[idx++] = b;
          ind[idx++] = d;
          ind[idx++] = a;
          ind[idx++] = d;
          ind[idx++] = c;
        }
      }
      cachedGrid = { positions: pos, indices: ind };
      _gridCache.set(gridKey, cachedGrid);
    }

    const colors = new Float32Array(totalVertices * 3);
    const edgeMarginX = Math.max(1, Math.floor(numLons * 0.04));
    const edgeMarginY = Math.max(1, Math.floor(numLats * 0.04));

    let ptr = 0;
    for (let ii = 0; ii < numLats; ii++) {
      const i = latIdxs[ii];
      const distToEdgeY = Math.min(ii, numLats - 1 - ii);
      const edgeFactorY = Math.min(1.0, distToEdgeY / edgeMarginY);

      for (let jj = 0; jj < numLons; jj++) {
        const j = lonIdxs[jj];
        valueToColor(values[i][j], min, max, this.colormap, _tmpColor, this.isLogScale);

        // Soft Edge Falloff & Subtle Volumetric Vignette Shading
        const distToEdgeX = Math.min(jj, numLons - 1 - jj);
        const edgeFactorX = Math.min(1.0, distToEdgeX / edgeMarginX);
        const edgeFalloff = Math.min(edgeFactorX, edgeFactorY);
        const smoothEdge = edgeFalloff * edgeFalloff * (3 - 2 * edgeFalloff);

        // Subtle ambient edge depth
        const vignette = 0.92 + 0.08 * smoothEdge;
        _tmpColor.multiplyScalar(vignette);

        // Soft boundary blend toward current theme background (zero dark halo on light mode)
        if (smoothEdge < 1.0) {
          _tmpColor.lerp(this.themeBgColor, (1.0 - smoothEdge) * 0.40);
        }

        colors[ptr * 3]     = _tmpColor.r;
        colors[ptr * 3 + 1] = _tmpColor.g;
        colors[ptr * 3 + 2] = _tmpColor.b;
        ptr++;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(cachedGrid.positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(cachedGrid.indices, 1));

    const isSolid = opacity >= 0.99 && depthWrite;
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: depthWrite ? THREE.DoubleSide : THREE.FrontSide, // FrontSide for context layers (50% fragment speedup)
      transparent: !isSolid,
      opacity: opacity,
      depthWrite: depthWrite,
      blending: THREE.NormalBlending,
      visible: opacity > 0.001,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, getDepthZ(tile.depth || 0, this.exaggeration));
    mesh.renderOrder = depthWrite ? 2 : 1;
    return mesh;
  }

  /**
   * Compatibility method for main.js. Depth slices remain visible at all times.
   * @param {boolean} _isNavigating
   */
  setNavigating(_isNavigating) {
    // Retained for interface compatibility — context layers stay visible
  }

  /** Ensure context horizons remain visible while avoiding active slice duplicates */
  setZoomLevel(distance) {
    for (const [d, layer] of this.contextLayers.entries()) {
      if (layer.mesh) {
        layer.mesh.visible = (d !== this.activeDepth);
      }
    }
  }

  /**
   * Fast color-only update — recomputes vertex colors across active mesh
   * and all translucent context layers with theme-aware edge fades.
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

    // Determine stride from vertex count mismatch vs full grid
    const fullLats = lats.length;
    const fullLons = lons.length;
    const meshVerts = colors.count;
    let stride = 1;
    if (meshVerts < fullLats * fullLons * 0.4) stride = CONTEXT_STRIDE;

    const numLats = Math.ceil(fullLats / stride);
    const numLons = Math.ceil(fullLons / stride);
    const edgeMarginX = Math.max(1, Math.floor(numLons * 0.04));
    const edgeMarginY = Math.max(1, Math.floor(numLats * 0.04));

    const arr = colors.array;
    let ptr = 0;
    let ii = 0;
    for (let i = 0; i < fullLats; i += stride) {
      const distToEdgeY = Math.min(ii, numLats - 1 - ii);
      const edgeFactorY = Math.min(1.0, distToEdgeY / edgeMarginY);

      let jj = 0;
      for (let j = 0; j < fullLons; j += stride) {
        valueToColor(values[i][j], min, max, this.colormap, _tmpColor, this.isLogScale);

        const distToEdgeX = Math.min(jj, numLons - 1 - jj);
        const edgeFactorX = Math.min(1.0, distToEdgeX / edgeMarginX);
        const edgeFalloff = Math.min(edgeFactorX, edgeFactorY);
        const smoothEdge = edgeFalloff * edgeFalloff * (3 - 2 * edgeFalloff);

        const vignette = 0.92 + 0.08 * smoothEdge;
        _tmpColor.multiplyScalar(vignette);

        if (smoothEdge < 1.0) {
          _tmpColor.lerp(this.themeBgColor, (1.0 - smoothEdge) * 0.40);
        }

        arr[ptr]     = _tmpColor.r;
        arr[ptr + 1] = _tmpColor.g;
        arr[ptr + 2] = _tmpColor.b;
        ptr += 3;
        jj++;
      }
      ii++;
    }
    colors.needsUpdate = true;
  }

  /**
   * Loads the active depth slice and triggers progressive background loading
   * of the 3D context horizons.
   */
  loadDepthSlice(tile) {
    if (!tile || !tile.values || !tile.lats || !tile.lons) return;

    const prevVar  = this.lastTile?.variable;
    const prevDate = this.lastTile?.date;
    const isNewSeries = prevVar !== tile.variable || prevDate !== tile.date;

    this.lastTile   = tile;
    const targetDepth = Number(tile.depth || 0);
    this.activeDepth  = targetDepth;

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

    // Build fresh active mesh at full resolution + full opacity (0.95)
    this.activeMesh = this._createSliceMesh(tile, this.opacity, true, 1);
    if (this.activeMesh) {
      this.scene.add(this.activeMesh);
    }

    // Context layers are always visible (except when d === targetDepth to avoid z-fighting)
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
   * Context layers are built at CONTEXT_STRIDE resolution (stride=3 -> 1/9th vertex count).
   */
  async _loadContextStack(variable, date, timestep) {
    const token = ++this._loadContextToken;
    const depthsToLoad = CONTEXT_DEPTHS.filter(d => d !== this.activeDepth);

    for (const d of depthsToLoad) {
      if (token !== this._loadContextToken) return;

      // If already loaded for current variable/date, ensure visibility and proper opacity
      const curCtxOpacity = this._getCurrentContextOpacity();
      if (this.contextLayers.has(d)) {
        const layer = this.contextLayers.get(d);
        if (layer.mesh) {
          layer.mesh.visible = (curCtxOpacity > 0.001) && (d !== this.activeDepth);
          layer.mesh.material.opacity = curCtxOpacity;
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

        // Build context mesh at light resolution (CONTEXT_STRIDE=3) for fast performance
        const mesh = this._createSliceMesh(tile, curCtxOpacity, false, CONTEXT_STRIDE);
        if (mesh) {
          mesh.visible = (curCtxOpacity > 0.001) && (d !== this.activeDepth);
          this.scene.add(mesh);
          this.contextLayers.set(d, { mesh, tile });
        }
      } catch (err) {
        // Soft fail — context layers are non-critical
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
