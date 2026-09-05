import * as THREE from 'three';
import { latLonDepthToXYZ } from '../utils/coordTransform.js';

/**
 * 3D Autonomous Ocean Glider Mission Trajectories (Stretch Feature)
 * Renders undulating sawtooth dive paths (0–1000m) for autonomous ocean gliders
 * deployed across the Arabian Sea and Bay of Bengal (INCOIS missions).
 */
const _lookTarget = new THREE.Vector3();
const _tmpPoint = new THREE.Vector3();
const _tmpTangent = new THREE.Vector3();

export class GliderTracks {
  constructor(scene) {
    this.scene = scene;
    this.visible = false;
    this.exaggeration = 50;
    this.group = new THREE.Group();
    this.group.name = 'GliderTracksLayer';
    this.group.visible = this.visible;
    this.scene.add(this.group);

    this.gliderMissions = [
      {
        id: 'IN-GL01',
        name: 'Bay of Bengal Deep Glider Mission (INCOIS-BoB)',
        startLat: 13.5,
        startLon: 84.0,
        endLat: 17.5,
        endLon: 89.0,
        maxDepth: 1000,
        cycles: 12,
        color: 0x00ff88,
      },
      {
        id: 'IN-GL02',
        name: 'Arabian Sea High-Salinity Glider Patrol (INCOIS-AS)',
        startLat: 15.0,
        startLon: 70.0,
        endLat: 11.0,
        endLon: 73.5,
        maxDepth: 900,
        cycles: 10,
        color: 0xffaa00,
      }
    ];

    this.trackMeshes = [];
    this.gliderHeads = [];
    this._buildTracks();
  }

  _buildTracks() {
    this.gliderMissions.forEach((mission, mIdx) => {
      const points = [];
      const totalSteps = mission.cycles * 40;

      for (let s = 0; s <= totalSteps; s++) {
        const prog = s / totalSteps;
        const lat = mission.startLat + prog * (mission.endLat - mission.startLat);
        const lon = mission.startLon + prog * (mission.endLon - mission.startLon);

        // Sawtooth triangular dive profile from surface (0m) to maxDepth (1000m)
        const phase = (s % 40) / 40;
        const depthNorm = phase < 0.5 ? (phase * 2.0) : ((1.0 - phase) * 2.0);
        const depth = depthNorm * mission.maxDepth;

        const pos = latLonDepthToXYZ(lat, lon, depth, { verticalExaggeration: this.exaggeration });
        points.push(new THREE.Vector3(pos.x, pos.y, pos.z));
      }

      // Smooth 3D spline curve for the glider dive trajectory
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeom = new THREE.TubeGeometry(curve, 200, 0.12, 6, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: mission.color,
        emissive: mission.color,
        emissiveIntensity: 0.35,
        roughness: 0.3,
        metalness: 0.6,
      });

      const trackMesh = new THREE.Mesh(tubeGeom, tubeMat);
      trackMesh.userData = { mission };
      this.group.add(trackMesh);
      this.trackMeshes.push(trackMesh);

      // Glider active vehicle model (arrow/delta wing representation)
      const gliderGeom = new THREE.ConeGeometry(0.35, 0.9, 5);
      gliderGeom.rotateX(Math.PI / 2);
      const gliderMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: mission.color,
        emissiveIntensity: 0.8,
      });
      const gliderHead = new THREE.Mesh(gliderGeom, gliderMat);
      gliderHead.userData = { curve, speed: 0.04 + mIdx * 0.01 };
      this.group.add(gliderHead);
      this.gliderHeads.push(gliderHead);
    });
  }

  setExaggeration(factor) {
    this.exaggeration = factor;
    this.trackMeshes.forEach(m => {
      m.geometry.dispose();
      m.material.dispose();
    });
    this.gliderHeads.forEach(g => {
      g.geometry.dispose();
      g.material.dispose();
    });
    this.group.clear();
    this.trackMeshes = [];
    this.gliderHeads = [];
    this._buildTracks();
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.group.visible = this.visible;
  }

  update(time) {
    if (!this.visible) return;
    const sec = time * 0.0005;

    this.gliderHeads.forEach((head) => {
      const curve = head.userData.curve;
      if (!curve) return;
      const t = (sec * head.userData.speed) % 1.0;
      curve.getPointAt(t, _tmpPoint);
      curve.getTangentAt(t, _tmpTangent);

      head.position.copy(_tmpPoint);
      _lookTarget.copy(_tmpPoint).add(_tmpTangent);
      head.lookAt(_lookTarget);
    });
  }

  dispose() {
    this.trackMeshes.forEach(m => {
      m.geometry.dispose();
      m.material.dispose();
    });
    this.gliderHeads.forEach(g => {
      g.geometry.dispose();
      g.material.dispose();
    });
    this.scene.remove(this.group);
  }
}
