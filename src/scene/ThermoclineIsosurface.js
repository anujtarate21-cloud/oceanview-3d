import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ } from '../utils/coordTransform.js';

/**
 * 3D Thermocline (20°C Isotherm) Isosurface Layer (High-Performance Optimized)
 * Renders an extracted continuous 3D undulating boundary surface representing
 * the core thermocline depth across the Indian Ocean basin with zero lag.
 */
export class ThermoclineIsosurface {
  constructor(scene) {
    this.scene = scene;
    this.visible = false;
    this.exaggeration = 50;
    this.opacity = 0.65;
    this.group = new THREE.Group();
    this.group.name = 'ThermoclineIsosurfaceLayer';
    this.group.visible = this.visible;
    this.scene.add(this.group);

    this.mesh = null;
    this.wireframe = null;
    this.rawZDepths = null;
    this._generateIsosurface();
  }

  _generateIsosurface() {
    const latSteps = 24;
    const lonSteps = 32;
    const latMin = 2, latMax = 25;
    const lonMin = 60, lonMax = 95;

    const geom = new THREE.PlaneGeometry(
      (lonMax - lonMin) * 1.6,
      (latMax - latMin) * 1.6,
      lonSteps,
      latSteps
    );

    const pos = geom.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    this.rawZDepths = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const u = (i % (lonSteps + 1)) / lonSteps;
      const v = Math.floor(i / (lonSteps + 1)) / latSteps;

      const lon = lonMin + u * (lonMax - lonMin);
      const lat = latMin + v * (latMax - latMin);

      // Mask land out (India subcontinent geometry)
      const isLand = (lat > 8 && lat < 26 && lon > 74 && lon < 85 && (lat - 8) > (lon - 74) * 0.8 && (lat - 8) < (90 - lon) * 1.5);

      let zDepth = 150.0;
      if (isLand) {
        zDepth = 0;
      } else {
        // Western upwelling shoaling (Somalia/Oman upwelling 60-80m)
        const westernShoal = Math.max(0, (70 - lon) * 4.5) * (lat < 18 ? 1.0 : 0.4);
        // Bay of Bengal deep freshwater capping (165m)
        const bobDeepening = (lon > 82 && lat > 12) ? 25.0 * Math.sin((lat - 12) * 0.2) : 0.0;
        // Equatorial dynamic wave modulation
        const wave = 14.0 * Math.sin(lon * 0.3) * Math.cos(lat * 0.25);

        zDepth = Math.max(50.0, Math.min(220.0, 150.0 - westernShoal + bobDeepening + wave));
      }

      this.rawZDepths[i] = zDepth;

      const worldPos = latLonDepthToXYZ(lat, lon, zDepth, { verticalExaggeration: this.exaggeration });
      pos.setXYZ(i, worldPos.x, worldPos.y, worldPos.z);

      // Color palette for 20°C thermocline surface: Cyan/Teal (Shallow upwelling) -> Deep Blue (Deep BoB)
      const t = (zDepth - 50) / 170;
      const col = new THREE.Color();
      if (isLand) {
        col.setRGB(0.08, 0.08, 0.18);
      } else {
        col.setHSL(0.55 - t * 0.22, 0.85, 0.48);
      }
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    // Standard high-performance WebGL material (no heavy transmission pass!)
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.opacity,
      roughness: 0.3,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.group.add(this.mesh);

    // Light glowing wireframe mesh
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });
    this.wireframe = new THREE.Mesh(geom, wireMat);
    this.group.add(this.wireframe);
  }

  setExaggeration(factor) {
    this.exaggeration = factor;
    if (!this.mesh || !this.rawZDepths) return;

    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const zDepth = this.rawZDepths[i];
      const zVal = getDepthZ(zDepth, factor);
      pos.setZ(i, zVal);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.group.visible = this.visible;
  }

  setOpacity(val) {
    this.opacity = Math.max(0.1, Math.min(1.0, val));
    if (this.mesh && this.mesh.material) {
      this.mesh.material.opacity = this.opacity;
    }
  }

  update(time) {
    // Zero frame-to-frame overhead for maximum performance
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    if (this.wireframe) {
      this.wireframe.material.dispose();
    }
    this.scene.remove(this.group);
  }
}
