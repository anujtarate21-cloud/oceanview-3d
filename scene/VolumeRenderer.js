import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ, coordDefaults } from '../utils/coordTransform.js';
import { valueToColor, VIRIDIS } from '../utils/colormaps.js';

export class VolumeRenderer {
  /**
   * Data-driven 3D depth slice renderer.
   * Uses MeshBasicMaterial (no lighting calc) for best performance.
   */
  constructor(scene, colormap = VIRIDIS) {
    this.scene = scene;
    this.colormap = colormap;
    this.opacity = 1.0;
    this.exaggeration = coordDefaults.verticalExaggeration;
    this.currentMesh = null;
    this.lastTile = null;
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
    if (this.lastTile) {
      this.loadDepthSlice(this.lastTile);
    }
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0, Math.min(1, opacity));
    if (this.currentMesh?.material) {
      this.currentMesh.material.transparent = this.opacity < 1;
      this.currentMesh.material.opacity = this.opacity;
      this.currentMesh.material.needsUpdate = true;
    }
  }

  loadDepthSlice(tile) {
    this.lastTile = tile;
    this.dispose();

    const { lats, lons, values, depth = 0 } = tile;
    const min = tile.global_min !== undefined ? tile.global_min : (tile.min !== undefined ? tile.min : (tile.slice_min !== undefined ? tile.slice_min : 0));
    const max = tile.global_max !== undefined ? tile.global_max : (tile.max !== undefined ? tile.max : (tile.slice_max !== undefined ? tile.slice_max : 100));
    
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

        const color = valueToColor(values[i][j], min, max, this.colormap);
        colors[ptr * 3]     = color.r;
        colors[ptr * 3 + 1] = color.g;
        colors[ptr * 3 + 2] = color.b;
        ptr++;
      }
    }

    // Build index buffer for triangle mesh
    const indices = [];
    for (let i = 0; i < numLats - 1; i++) {
      for (let j = 0; j < numLons - 1; j++) {
        const a = i * numLons + j;
        const b = i * numLons + (j + 1);
        const c = (i + 1) * numLons + j;
        const d = (i + 1) * numLons + (j + 1);
        indices.push(a, b, d, a, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    geometry.setIndex(indices);

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

