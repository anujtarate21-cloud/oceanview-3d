import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ, coordDefaults } from '../utils/coordTransform.js';
import { valueToColor, VIRIDIS } from '../utils/colormaps.js';

// Reusable Color object — avoids per-vertex allocation in tight loops
const _tmpColor = new THREE.Color();

export class VolumeRenderer {
  /**
   * Data-driven 3D depth slice renderer.
   * Uses MeshBasicMaterial (no lighting calc) for best performance.
   * Optimizations: typed index arrays, color-only update path, zero GC allocations.
   */
  constructor(scene, colormap = VIRIDIS) {
    this.scene = scene;
    this.colormap = colormap;
    this.opacity = 1.0;
    this.exaggeration = coordDefaults.verticalExaggeration;
    this.currentMesh = null;
    this.lastTile = null;
    /** Cached min/max from last render — used for color-only updates */
    this._lastMin = 0;
    this._lastMax = 1;
  }

  setExaggeration(exaggeration) {
    const next = Number(exaggeration);
    this.exaggeration = Number.isFinite(next) ? Math.max(1, Math.min(200, next)) : 50;
    coordDefaults.verticalExaggeration = this.exaggeration;
    if (this.currentMesh && this.lastTile) {
      const depth = this.lastTile.depth || 0;
      this.currentMesh.position.z = getDepthZ(depth, this.exaggeration);
    }
  }

  setColormap(colormap) {
    this.colormap = colormap;
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0, Math.min(1, opacity));
    if (this.currentMesh?.material) {
      this.currentMesh.material.transparent = this.opacity < 1;
      this.currentMesh.material.opacity = this.opacity;
      this.currentMesh.material.needsUpdate = true;
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

  /**
   * Fast color-only update — reuses existing geometry and just recomputes
   * vertex colors with the current colormap. Called on colormap-change to
   * avoid the expensive full geometry rebuild.
   */
  updateColors() {
    if (!this.currentMesh || !this.lastTile) return;
    const tile = this.lastTile;
    const { min, max } = this._computeMinMax(tile);
    this._lastMin = min;
    this._lastMax = max;

    const { lats, lons, values } = tile;
    const colors = this.currentMesh.geometry.attributes.color;
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

  loadDepthSlice(tile) {
    this.lastTile = tile;
    this.dispose();

    const { lats, lons, values, depth = 0 } = tile;
    const { min, max } = this._computeMinMax(tile);
    this._lastMin = min;
    this._lastMax = max;
    
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
        positions[ptr * 3 + 2] = 0; // Local Z is 0; depth offset is applied to mesh.position.z

        valueToColor(values[i][j], min, max, this.colormap, _tmpColor);
        colors[ptr * 3]     = _tmpColor.r;
        colors[ptr * 3 + 1] = _tmpColor.g;
        colors[ptr * 3 + 2] = _tmpColor.b;
        ptr++;
      }
    }

    // Build typed index buffer — avoids GC from plain JS array
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
      side: THREE.DoubleSide,
      transparent: this.opacity < 1,
      opacity: this.opacity,
    });

    this.currentMesh = new THREE.Mesh(geometry, material);
    // Position mesh vertically along Z according to its depth and exaggeration
    this.currentMesh.position.set(0, 0, getDepthZ(depth, this.exaggeration));
    this.scene.add(this.currentMesh);
  }

  dispose() {
    if (this.currentMesh) {
      this.scene.remove(this.currentMesh);
      this.currentMesh.geometry?.dispose();
      this.currentMesh.material?.dispose();
      this.currentMesh = null;
    }
  }
}


