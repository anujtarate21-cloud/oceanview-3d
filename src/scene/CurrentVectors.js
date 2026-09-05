import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ } from '../utils/coordTransform.js';

/**
 * 3D Ocean Current Vector Field (Stretch Feature)
 * Renders directional 3D vector arrows and flow pulses for u/v ocean velocity
 * across the Indian Ocean basin (Somali current, WICC, EICC, and Equatorial Jet).
 */
export class CurrentVectors {
  constructor(scene) {
    this.scene = scene;
    this.visible = false;
    this.exaggeration = 50;
    this.group = new THREE.Group();
    this.group.name = 'CurrentVectorsLayer';
    this.group.visible = this.visible;
    this.scene.add(this.group);

    this.instances = [];
    this.arrowMesh = null;
    this.flowParticles = null;
    this._initVectors();
  }

  _initVectors() {
    // Generate physical current field nodes across 0-25°N, 60-95°E and depths (0m, 100m, 500m, 1000m)
    const vectorData = [];
    const depths = [0, 50, 150, 500];

    for (let lat = 2; lat <= 24; lat += 2.0) {
      for (let lon = 62; lon <= 94; lon += 2.0) {
        // Exclude land approximation (India subcontinent ~ lat 8-28, lon 72-88)
        if (lat > 8 && lat < 26 && lon > 74 && lon < 85 && (lat - 8) > (lon - 74) * 0.8 && (lat - 8) < (90 - lon) * 1.5) {
          continue;
        }

        for (const depth of depths) {
          // Physics-based current calculation (Somali jet, equatorial current, coastal eddies)
          let u = 0.0;
          let v = 0.0;

          // 1. Somali western boundary current (strong northward along 60-68°E)
          if (lon < 68 && lat < 16) {
            v += 0.8 * Math.exp(-depth / 300);
            u += 0.3 * Math.exp(-depth / 300);
          }

          // 2. West India Coastal Current (WICC) - southward in summer / northward in winter
          if (lon >= 68 && lon <= 75 && lat >= 8 && lat <= 20) {
            v -= 0.5 * Math.exp(-depth / 200);
            u -= 0.15;
          }

          // 3. East India Coastal Current (EICC) - Bay of Bengal cyclonic gyre
          if (lon >= 80 && lon <= 90 && lat >= 10 && lat <= 20) {
            u += 0.4 * Math.sin(lat * 0.3) * Math.exp(-depth / 250);
            v += 0.4 * Math.cos(lon * 0.2) * Math.exp(-depth / 250);
          }

          // 4. Equatorial Jet (Wyrtki Jet along 0-5°N)
          if (lat <= 6) {
            u += 0.7 * Math.exp(-depth / 150);
          }

          // Background eddies
          u += 0.15 * Math.sin(lat * 0.5 + lon * 0.3);
          v += 0.15 * Math.cos(lat * 0.4 - lon * 0.2);

          const speed = Math.sqrt(u * u + v * v);
          if (speed < 0.1) continue;

          vectorData.push({ lat, lon, depth, u, v, speed });
        }
      }
    }

    this.vectorData = vectorData;
    const count = vectorData.length;

    // Arrow geometry: cone head + thin cylinder stem
    const arrowGeom = new THREE.ConeGeometry(0.22, 0.7, 6);
    arrowGeom.rotateX(Math.PI / 2); // Point along +Z

    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.2,
    });

    this.arrowMesh = new THREE.InstancedMesh(arrowGeom, arrowMat, count);
    this.arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Color buffer for velocity magnitude
    const colors = new Float32Array(count * 3);
    const dummy = new THREE.Object3D();

    vectorData.forEach((vec, i) => {
      const pos = latLonDepthToXYZ(vec.lat, vec.lon, vec.depth, { verticalExaggeration: this.exaggeration });
      dummy.position.set(pos.x, pos.y, pos.z);

      // Orientation based on u (east) and v (north)
      const angle = Math.atan2(vec.v, vec.u);
      dummy.rotation.set(0, 0, angle - Math.PI / 2);

      const scale = Math.min(1.8, Math.max(0.6, vec.speed * 1.5));
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      this.arrowMesh.setMatrixAt(i, dummy.matrix);

      // Speed colormap: cyan (<0.3) -> turquoise (<0.6) -> yellow (<0.9) -> coral (>1.0 m/s)
      const t = Math.min(1.0, Math.max(0.0, (vec.speed - 0.1) / 0.9));
      const col = new THREE.Color();
      if (t < 0.33) {
        col.setRGB(0.0, 0.85 + t * 0.45, 0.9);
      } else if (t < 0.66) {
        col.setRGB((t - 0.33) * 3.0, 0.95, 0.4);
      } else {
        col.setRGB(1.0, 0.8 - (t - 0.66) * 1.8, 0.2);
      }

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    });

    this.arrowMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.group.add(this.arrowMesh);

    // Dynamic animated streamline particles
    const particleCount = 450;
    const pGeom = new THREE.BufferGeometry();
    const pPos = new Float32Array(particleCount * 3);
    const pMeta = [];

    for (let i = 0; i < particleCount; i++) {
      const parentVec = vectorData[Math.floor(Math.random() * vectorData.length)];
      const pos = latLonDepthToXYZ(parentVec.lat, parentVec.lon, parentVec.depth, { verticalExaggeration: this.exaggeration });
      pPos[i * 3] = pos.x;
      pPos[i * 3 + 1] = pos.y;
      pPos[i * 3 + 2] = pos.z;

      pMeta.push({
        baseX: pos.x,
        baseY: pos.y,
        baseZ: pos.z,
        vx: parentVec.u * 0.8,
        vy: parentVec.v * 0.8,
        progress: Math.random(),
        speed: parentVec.speed * 0.02 + 0.005,
      });
    }

    pGeom.setAttribute('position', new THREE.BufferAttribute(pPos, 3));

    const pMat = new THREE.PointsMaterial({
      color: 0x00ffff,
      size: 0.35,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });

    this.flowParticles = new THREE.Points(pGeom, pMat);
    this.pMeta = pMeta;
    this.group.add(this.flowParticles);
  }

  setExaggeration(factor) {
    this.exaggeration = factor;
    if (!this.arrowMesh || !this.vectorData) return;

    const dummy = new THREE.Object3D();
    this.vectorData.forEach((vec, i) => {
      const pos = latLonDepthToXYZ(vec.lat, vec.lon, vec.depth, { verticalExaggeration: this.exaggeration });
      dummy.position.set(pos.x, pos.y, pos.z);
      const angle = Math.atan2(vec.v, vec.u);
      dummy.rotation.set(0, 0, angle - Math.PI / 2);
      const scale = Math.min(1.8, Math.max(0.6, vec.speed * 1.5));
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      this.arrowMesh.setMatrixAt(i, dummy.matrix);
    });
    this.arrowMesh.instanceMatrix.needsUpdate = true;

    if (this.pMeta) {
      this.pMeta.forEach((p, i) => {
        const vec = this.vectorData[i % this.vectorData.length];
        const pos = latLonDepthToXYZ(vec.lat, vec.lon, vec.depth, { verticalExaggeration: this.exaggeration });
        p.baseZ = pos.z;
      });
    }
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.group.visible = this.visible;
  }

  update(time) {
    if (!this.visible || !this.flowParticles) return;

    const positions = this.flowParticles.geometry.attributes.position.array;
    for (let i = 0; i < this.pMeta.length; i++) {
      const p = this.pMeta[i];
      p.progress += p.speed;
      if (p.progress > 1.0) p.progress = 0.0;

      positions[i * 3] = p.baseX + p.vx * p.progress * 4.0;
      positions[i * 3 + 1] = p.baseY + p.vy * p.progress * 4.0;
      positions[i * 3 + 2] = p.baseZ;
    }
    this.flowParticles.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (this.arrowMesh) {
      this.arrowMesh.geometry.dispose();
      this.arrowMesh.material.dispose();
    }
    if (this.flowParticles) {
      this.flowParticles.geometry.dispose();
      this.flowParticles.material.dispose();
    }
    this.scene.remove(this.group);
  }
}
