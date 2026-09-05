import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ } from '../utils/coordTransform.js';

/**
 * WaterColumnCage.js — 3D Bounding Box, Depth Ruler and Coordinate Grid for Indian Ocean Basin
 *
 * Renders:
 *  - 4 vertical corner depth pillars (from Surface 0m to Seafloor 5000m)
 *  - Surface perimeter frame (0m) & surface geographic graticule grid
 *  - Seafloor perimeter frame & bathymetric grid (5000m)
 *  - Intermediate depth level guide rings (200m thermocline, 1000m intermediate, 2000m deep)
 *  - High-contrast color and opacity switching for all 5 Light themes + Dark mode
 *  - Real-time vertical scaling when vertical exaggeration changes
 */
export class WaterColumnCage {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'WaterColumnCage';
    this.scene.add(this.group);

    this.minLat = 0;
    this.maxLat = 25;
    this.minLon = 60;
    this.maxLon = 95;
    this.maxDepth = 5000;
    this.depthLevels = [0, 200, 1000, 2000, 5000];

    this._buildCage();
  }

  _buildCage() {
    // 4 Corner coordinates at surface (z=0)
    const cNW = latLonDepthToXYZ(this.maxLat, this.minLon, 0); // (60°E, 25°N)
    const cNE = latLonDepthToXYZ(this.maxLat, this.maxLon, 0); // (95°E, 25°N)
    const cSE = latLonDepthToXYZ(this.minLat, this.maxLon, 0); // (95°E, 0°N)
    const cSW = latLonDepthToXYZ(this.minLat, this.minLon, 0); // (60°E, 0°N)

    const corners = [cNW, cNE, cSE, cSW];
    const baseZ5000 = getDepthZ(5000, 50); // base Z for 5000m at 50x = -15.0

    // Material for cage borders and vertical pillars
    this.pillarMat = new THREE.LineBasicMaterial({
      color: 0x00d4aa,
      transparent: true,
      opacity: 0.6,
      linewidth: 2,
    });

    this.surfaceMat = new THREE.LineBasicMaterial({
      color: 0x00d4aa,
      transparent: true,
      opacity: 0.85,
      linewidth: 2,
    });

    this.surfaceGridMat = new THREE.LineBasicMaterial({
      color: 0x00d4aa,
      transparent: true,
      opacity: 0.35,
    });

    this.guideMat = new THREE.LineBasicMaterial({
      color: 0x4a5584,
      transparent: true,
      opacity: 0.45,
    });

    this.floorMat = new THREE.LineBasicMaterial({
      color: 0x1e295d,
      transparent: true,
      opacity: 0.6,
    });

    // 1. Surface Outer Border (0m)
    const surfacePts = [
      new THREE.Vector3(cNW.x, cNW.y, 0),
      new THREE.Vector3(cNE.x, cNE.y, 0),
      new THREE.Vector3(cSE.x, cSE.y, 0),
      new THREE.Vector3(cSW.x, cSW.y, 0),
      new THREE.Vector3(cNW.x, cNW.y, 0),
    ];
    const surfaceGeo = new THREE.BufferGeometry().setFromPoints(surfacePts);
    this.group.add(new THREE.Line(surfaceGeo, this.surfaceMat));

    // 2. Surface Coordinate Grid (Every 5° Lat / Lon)
    const surfGridPts = [];
    for (let lat = 5; lat <= 20; lat += 5) {
      const p1 = latLonDepthToXYZ(lat, this.minLon, 0);
      const p2 = latLonDepthToXYZ(lat, this.maxLon, 0);
      surfGridPts.push(new THREE.Vector3(p1.x, p1.y, 0.05));
      surfGridPts.push(new THREE.Vector3(p2.x, p2.y, 0.05));
    }
    for (let lon = 65; lon <= 90; lon += 5) {
      const p1 = latLonDepthToXYZ(this.minLat, lon, 0);
      const p2 = latLonDepthToXYZ(this.maxLat, lon, 0);
      surfGridPts.push(new THREE.Vector3(p1.x, p1.y, 0.05));
      surfGridPts.push(new THREE.Vector3(p2.x, p2.y, 0.05));
    }
    const surfGridGeo = new THREE.BufferGeometry().setFromPoints(surfGridPts);
    this.group.add(new THREE.LineSegments(surfGridGeo, this.surfaceGridMat));

    // 3. Vertical Corner Pillars (Unit length from Z=0 to Z=baseZ5000)
    for (const c of corners) {
      const pillarPts = [
        new THREE.Vector3(c.x, c.y, 0),
        new THREE.Vector3(c.x, c.y, baseZ5000),
      ];
      const pillarGeo = new THREE.BufferGeometry().setFromPoints(pillarPts);
      this.group.add(new THREE.Line(pillarGeo, this.pillarMat));
    }

    // 4. Intermediate Depth Level Rings (200m thermocline, 1000m, 2000m, 5000m seafloor)
    for (const d of [200, 1000, 2000, 5000]) {
      const z = getDepthZ(d, 50);
      const ringPts = [
        new THREE.Vector3(cNW.x, cNW.y, z),
        new THREE.Vector3(cNE.x, cNE.y, z),
        new THREE.Vector3(cSE.x, cSE.y, z),
        new THREE.Vector3(cSW.x, cSW.y, z),
        new THREE.Vector3(cNW.x, cNW.y, z),
      ];
      const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      const mat = d === 5000 ? this.floorMat : this.guideMat;
      this.group.add(new THREE.Line(ringGeo, mat));
    }

    // 5. Seafloor Bathymetric Grid (5000m)
    const floorGridPts = [];
    for (let lat = 5; lat <= 20; lat += 5) {
      const p1 = latLonDepthToXYZ(lat, this.minLon, 0);
      const p2 = latLonDepthToXYZ(lat, this.maxLon, 0);
      floorGridPts.push(new THREE.Vector3(p1.x, p1.y, baseZ5000));
      floorGridPts.push(new THREE.Vector3(p2.x, p2.y, baseZ5000));
    }
    for (let lon = 65; lon <= 90; lon += 5) {
      const p1 = latLonDepthToXYZ(this.minLat, lon, 0);
      const p2 = latLonDepthToXYZ(this.maxLat, lon, 0);
      floorGridPts.push(new THREE.Vector3(p1.x, p1.y, baseZ5000));
      floorGridPts.push(new THREE.Vector3(p2.x, p2.y, baseZ5000));
    }
    const floorGridGeo = new THREE.BufferGeometry().setFromPoints(floorGridPts);
    this.group.add(new THREE.LineSegments(floorGridGeo, this.floorMat));
  }

  /**
   * Updates cage, depth ruler and grid colors based on active theme & light/dark mode.
   * @param {number|string} primaryHex Accent/surface frame color
   * @param {number|string} guideHex Intermediate depth ring color
   * @param {number|string} gridHex Surface & seafloor coordinate grid color
   * @param {boolean} [isLight] Whether light mode is active
   */
  updateThemeColor(primaryHex = 0x00d4aa, guideHex = 0x4a5584, gridHex = 0x1e295d, isLight = false) {
    if (this.surfaceMat) {
      this.surfaceMat.color.set(primaryHex);
      this.surfaceMat.opacity = isLight ? 0.95 : 0.85;
      this.surfaceMat.needsUpdate = true;
    }
    if (this.pillarMat) {
      this.pillarMat.color.set(primaryHex);
      this.pillarMat.opacity = isLight ? 0.85 : 0.60;
      this.pillarMat.needsUpdate = true;
    }
    if (this.surfaceGridMat) {
      this.surfaceGridMat.color.set(gridHex);
      this.surfaceGridMat.opacity = isLight ? 0.55 : 0.35;
      this.surfaceGridMat.needsUpdate = true;
    }
    if (this.guideMat) {
      this.guideMat.color.set(guideHex);
      this.guideMat.opacity = isLight ? 0.80 : 0.45;
      this.guideMat.needsUpdate = true;
    }
    if (this.floorMat) {
      this.floorMat.color.set(gridHex);
      this.floorMat.opacity = isLight ? 0.85 : 0.60;
      this.floorMat.needsUpdate = true;
    }
  }

  /**
   * Scales the water column cage vertically in real-time.
   * @param {number} exaggeration e.g. 50 (1x scale), 100 (2x scale), 200 (4x scale)
   */
  setExaggeration(exaggeration) {
    const factor = Number(exaggeration) / 50;
    this.group.scale.set(1, 1, factor);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.scene.remove(this.group);
  }
}
