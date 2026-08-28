import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ } from '../utils/coordTransform.js';

/**
 * WaterColumnCage.js — 3D Bounding Box and Depth Ruler for the Indian Ocean Basin
 *
 * Renders:
 *  - 4 vertical corner depth pillars (from Surface 0m to Seafloor 5000m)
 *  - Surface perimeter frame (0m)
 *  - Seafloor perimeter frame & grid (5000m)
 *  - Intermediate depth level guide rings (200m thermocline, 1000m intermediate, 2000m deep)
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
    const pillarMat = new THREE.LineBasicMaterial({
      color: 0x00d4aa,
      transparent: true,
      opacity: 0.45,
    });

    const surfaceMat = new THREE.LineBasicMaterial({
      color: 0x00d4aa,
      transparent: true,
      opacity: 0.7,
    });

    const guideMat = new THREE.LineBasicMaterial({
      color: 0x4a5584,
      transparent: true,
      opacity: 0.35,
    });

    const floorMat = new THREE.LineBasicMaterial({
      color: 0x1e295d,
      transparent: true,
      opacity: 0.5,
    });

    // 1. Surface Border (0m)
    const surfacePts = [
      new THREE.Vector3(cNW.x, cNW.y, 0),
      new THREE.Vector3(cNE.x, cNE.y, 0),
      new THREE.Vector3(cSE.x, cSE.y, 0),
      new THREE.Vector3(cSW.x, cSW.y, 0),
      new THREE.Vector3(cNW.x, cNW.y, 0),
    ];
    const surfaceGeo = new THREE.BufferGeometry().setFromPoints(surfacePts);
    this.group.add(new THREE.Line(surfaceGeo, surfaceMat));

    // 2. Vertical Corner Pillars (Unit length from Z=0 to Z=baseZ5000)
    for (const c of corners) {
      const pillarPts = [
        new THREE.Vector3(c.x, c.y, 0),
        new THREE.Vector3(c.x, c.y, baseZ5000),
      ];
      const pillarGeo = new THREE.BufferGeometry().setFromPoints(pillarPts);
      this.group.add(new THREE.Line(pillarGeo, pillarMat));
    }

    // 3. Intermediate Depth Level Rings (200m, 1000m, 2000m, 5000m)
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
      const mat = d === 5000 ? floorMat : guideMat;
      this.group.add(new THREE.Line(ringGeo, mat));
    }

    // 4. Subtle Seafloor Grid (5000m)
    const floorGridPts = [];
    // Lat lines at floor
    for (let lat = 5; lat <= 20; lat += 5) {
      const p1 = latLonDepthToXYZ(lat, this.minLon, 0);
      const p2 = latLonDepthToXYZ(lat, this.maxLon, 0);
      floorGridPts.push(new THREE.Vector3(p1.x, p1.y, baseZ5000));
      floorGridPts.push(new THREE.Vector3(p2.x, p2.y, baseZ5000));
    }
    // Lon lines at floor
    for (let lon = 65; lon <= 90; lon += 5) {
      const p1 = latLonDepthToXYZ(this.minLat, lon, 0);
      const p2 = latLonDepthToXYZ(this.maxLat, lon, 0);
      floorGridPts.push(new THREE.Vector3(p1.x, p1.y, baseZ5000));
      floorGridPts.push(new THREE.Vector3(p2.x, p2.y, baseZ5000));
    }
    const floorGridGeo = new THREE.BufferGeometry().setFromPoints(floorGridPts);
    this.group.add(new THREE.LineSegments(floorGridGeo, floorMat));
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
