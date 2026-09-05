import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ } from '../utils/coordTransform.js';

/**
 * 3D Ocean Current Vector Field (Stretch Feature)
 * Renders directional 3D vector arrows and flow pulses for u/v ocean velocity
 * across the Indian Ocean basin (Somali current, WICC, EICC, and Equatorial Wyrtki Jet).
 * Dynamically updates based on the active date and depth slice selected in Date Navigator.
 */
export class CurrentVectors {
  constructor(scene, initialDate = '2023-03-21') {
    this.scene = scene;
    this.visible = false;
    this.exaggeration = 50;
    this.currentDate = initialDate;
    this.activeDepth = 0;
    this.group = new THREE.Group();
    this.group.name = 'CurrentVectorsLayer';
    this.group.visible = this.visible;
    this.scene.add(this.group);

    this.instances = [];
    this.arrowMesh = null;
    this.flowParticles = null;
    this.vectorData = [];
    this.pMeta = [];
    this._initVectors();
  }

  _computeCurrentAt(lat, lon, depth, dateStr) {
    const month = dateStr ? parseInt(dateStr.split('-')[1], 10) : 8;
    const day = dateStr ? parseInt(dateStr.split('-')[2] || '15', 10) : 15;

    let swMonsoon = 0.0;
    let neMonsoon = 0.0;
    let wyrtki = 0.0;

    if (month >= 6 && month <= 9) {
      swMonsoon = (month === 7 || month === 8) ? 1.0 : 0.8;
    } else if (month === 12 || month <= 2) {
      neMonsoon = (month === 1) ? 1.0 : 0.85;
    } else if (month === 4 || month === 5) {
      wyrtki = 1.0;
      swMonsoon = 0.35;
    } else if (month === 10 || month === 11) {
      wyrtki = 0.9;
      neMonsoon = 0.45;
    } else {
      wyrtki = 0.5;
      swMonsoon = 0.2;
    }

    let u = 0.0;
    let v = 0.0;

    // 1. Somali western boundary current (strong northward in SW monsoon, reverses in NE monsoon)
    if (lon < 68 && lat < 16) {
      const somaliV = swMonsoon > 0 ? (1.25 * swMonsoon) : (-0.55 * neMonsoon);
      const somaliU = swMonsoon > 0 ? (0.45 * swMonsoon) : (-0.2 * neMonsoon);
      v += somaliV * Math.exp(-depth / 300);
      u += somaliU * Math.exp(-depth / 300);
    }

    // 2. West India Coastal Current (WICC) - southward in summer / northward in winter
    if (lon >= 68 && lon <= 75 && lat >= 8 && lat <= 22) {
      const wiccV = (neMonsoon * 0.65) - (swMonsoon * 0.7);
      v += wiccV * Math.exp(-depth / 200);
      u -= 0.15 * Math.sin(lat * 0.4);
    }

    // 3. East India Coastal Current (EICC) - Bay of Bengal cyclonic/anticyclonic gyre
    if (lon >= 80 && lon <= 90 && lat >= 10 && lat <= 22) {
      const eiccV = (swMonsoon * 0.55) - (neMonsoon * 0.5);
      v += eiccV * Math.exp(-depth / 250);
      u += 0.3 * Math.sin(lat * 0.3) * Math.exp(-depth / 250);
    }

    // 4. Equatorial Wyrtki Jet along 0-5°N (semi-annual eastward surge during transitions)
    if (lat <= 6) {
      const jetSpeed = 0.95 * wyrtki + 0.35 * swMonsoon + 0.15;
      u += jetSpeed * Math.exp(-depth / 150);
    }

    // Background dynamic eddies modulated by calendar date
    const eddyPhase = (month * 30 + day) * 0.05;
    u += 0.16 * Math.sin(lat * 0.45 + lon * 0.3 + eddyPhase);
    v += 0.16 * Math.cos(lat * 0.4 - lon * 0.25 + eddyPhase);

    const speed = Math.sqrt(u * u + v * v);
    return { u, v, speed };
  }

  _initVectors() {
    const vectorData = [];
    const depths = [0, 50, 150, 500];

    for (let lat = 2; lat <= 24; lat += 2.0) {
      for (let lon = 62; lon <= 94; lon += 2.0) {
        // Exclude land (India subcontinent approximation)
        if (lat > 8 && lat < 26 && lon > 74 && lon < 85 && (lat - 8) > (lon - 74) * 0.8 && (lat - 8) < (90 - lon) * 1.5) {
          continue;
        }

        for (const depth of depths) {
          const calc = this._computeCurrentAt(lat, lon, depth, this.currentDate);
          if (calc.speed < 0.08) continue;
          vectorData.push({ lat, lon, depth, u: calc.u, v: calc.v, speed: calc.speed });
        }
      }
    }

    this.vectorData = vectorData;
    const count = vectorData.length;

    // Arrow geometry: cone head
    const arrowGeom = new THREE.ConeGeometry(0.22, 0.7, 6);
    arrowGeom.rotateX(Math.PI / 2);

    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.2,
    });

    this.arrowMesh = new THREE.InstancedMesh(arrowGeom, arrowMat, count);
    this.arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const colors = new Float32Array(count * 3);
    const dummy = new THREE.Object3D();

    vectorData.forEach((vec, i) => {
      const pos = latLonDepthToXYZ(vec.lat, vec.lon, vec.depth, { verticalExaggeration: this.exaggeration });
      dummy.position.set(pos.x, pos.y, pos.z);

      const angle = Math.atan2(vec.v, vec.u);
      dummy.rotation.set(0, 0, angle - Math.PI / 2);

      const scale = Math.min(1.8, Math.max(0.6, vec.speed * 1.5));
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      this.arrowMesh.setMatrixAt(i, dummy.matrix);

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

  updateForDate(dateStr, activeDepth = null) {
    if (dateStr) this.currentDate = dateStr;
    if (activeDepth !== null && activeDepth !== undefined) {
      this.activeDepth = Number(activeDepth);
    }
    if (!this.arrowMesh || !this.vectorData) return;

    const dummy = new THREE.Object3D();
    const colors = this.arrowMesh.instanceColor ? this.arrowMesh.instanceColor.array : null;

    this.vectorData.forEach((vec, i) => {
      const calc = this._computeCurrentAt(vec.lat, vec.lon, vec.depth, this.currentDate);
      vec.u = calc.u;
      vec.v = calc.v;
      vec.speed = calc.speed;

      const pos = latLonDepthToXYZ(vec.lat, vec.lon, vec.depth, { verticalExaggeration: this.exaggeration });
      dummy.position.set(pos.x, pos.y, pos.z);

      const angle = Math.atan2(vec.v, vec.u);
      dummy.rotation.set(0, 0, angle - Math.PI / 2);

      const isSliceDepth = this.activeDepth !== null && Math.abs(vec.depth - this.activeDepth) <= 50;
      const depthBoost = isSliceDepth ? 1.3 : 0.9;
      const scale = Math.min(2.2, Math.max(0.5, vec.speed * 1.5 * depthBoost));
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      this.arrowMesh.setMatrixAt(i, dummy.matrix);

      if (colors) {
        const t = Math.min(1.0, Math.max(0.0, (vec.speed - 0.1) / 0.9));
        const col = new THREE.Color();
        if (t < 0.33) {
          col.setRGB(0.0, 0.85 + t * 0.45, 0.9);
        } else if (t < 0.66) {
          col.setRGB((t - 0.33) * 3.0, 0.95, 0.4);
        } else {
          col.setRGB(1.0, 0.8 - (t - 0.66) * 1.8, 0.2);
        }
        if (isSliceDepth) {
          col.multiplyScalar(1.25);
        }
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
    });

    this.arrowMesh.instanceMatrix.needsUpdate = true;
    if (this.arrowMesh.instanceColor) this.arrowMesh.instanceColor.needsUpdate = true;

    if (this.pMeta && this.vectorData.length > 0) {
      for (let i = 0; i < this.pMeta.length; i++) {
        const parent = this.vectorData[i % this.vectorData.length];
        this.pMeta[i].vx = parent.u * 0.8;
        this.pMeta[i].vy = parent.v * 0.8;
        this.pMeta[i].speed = parent.speed * 0.02 + 0.005;
      }
    }
  }

  setExaggeration(factor) {
    this.exaggeration = factor;
    if (!this.arrowMesh || !this.vectorData) return;
    this.updateForDate(this.currentDate, this.activeDepth);
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
