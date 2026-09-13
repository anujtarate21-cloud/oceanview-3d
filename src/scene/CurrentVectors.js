import * as THREE from 'three';
import { latLonDepthToXYZ } from '../utils/coordTransform.js';

/**
 * CurrentVectors.js — High-Divergence Palette 3D Ocean Streamlines
 * for OceanView 3D (INCOIS / MoES).
 *
 * Renders sleek 3D stream capsules (using InstancedMesh) elevated above the volume plane for
 * high visibility against bright scalar surface maps.
 *
 * Speed Categories use high-contrast fills with darker same-family outlines.
 */

// ── Performance & Scale Constants ────────────────────────────────────────────
const PARTICLE_COUNT   = 100;  // Reduced for low-end GPU support (was 120)
const ADVECT_SCALE     = 2.8;  // Dynamic visual degrees lat/lon advection speed
const MIN_AGE          = 2.5;  // Minimum particle lifetime (seconds)
const MAX_AGE          = 4.5;  // Maximum particle lifetime (seconds)
const MAX_DT           = 0.05; // Frame delta cap (seconds)
const Z_NUDGE          = 0.15; // Z-elevation offset to float cleanly right above volume plane
// GPU upload throttle: advect CPU every frame, upload to GPU every N frames only
const GPU_UPLOAD_EVERY = 2;    // Upload matrices/colors every 2nd frame (invisible to eye)

// ── Speed colors chosen for strong contrast over the model surface
const COLOR_SLOW          = new THREE.Color('#007C91'); // < 0.4 m/s (deep cyan)
const COLOR_MODERATE      = new THREE.Color('#FF9800'); // 0.4 - 0.7 m/s (bright amber)
const COLOR_FAST          = new THREE.Color('#FF000D'); // > 0.7 m/s (bright red)

// Reusable matrix / vector / quaternion objects to avoid GC allocation per frame
const _tempColor     = new THREE.Color();
const _tempPos       = new THREE.Vector3();
const _tempScale     = new THREE.Vector3();
const _tempRot       = new THREE.Quaternion();
const _tempMatrix    = new THREE.Matrix4();
const _euler         = new THREE.Euler();

// Velocity grid bounds — Indian Ocean domain (2°N–24°N, 62°E–94°E)
const LAT_MIN   = 2,  LAT_MAX  = 24, LAT_STEP  = 1.0;
const LON_MIN   = 62, LON_MAX  = 94, LON_STEP  = 1.0;
const GRID_LATS = Math.floor((LAT_MAX - LAT_MIN) / LAT_STEP) + 1; // 23
const GRID_LONS = Math.floor((LON_MAX - LON_MIN) / LON_STEP) + 1; // 33

export class CurrentVectors {
  /**
   * @param {THREE.Scene} scene
   * @param {string} [initialDate='2023-03-21']
   */
  constructor(scene, initialDate = '2023-03-21') {
    this.scene        = scene;
    this.visible      = false;
    this.exaggeration = 50;
    this.currentDate  = initialDate;
    this.activeDepth  = 0;

    this.group = new THREE.Group();
    this.group.name    = 'CurrentVectorsLayer';
    this.group.visible = false;
    this.scene.add(this.group);

    // 1° x 1° velocity grid: Float32Array[GRID_LATS x GRID_LONS x 3] -> (u, v, speed)
    this.velGrid = null;
    this.pData   = new Array(PARTICLE_COUNT);

    this.instancedMesh  = null;
    this._lastTimeMs    = null;
    this._gpuFrame      = 0;  // counts frames for GPU upload throttling
    this._oceanScene    = null; // set via setOceanScene() for nav-aware updates

    this._buildVelocityGrid();
    this._initStreamlines();
  }

  // ── SYNTHETIC VELOCITY FIELD GENERATOR ──

  _computeCurrentAt(lat, lon, depth, dateStr) {
    const month = dateStr ? parseInt(dateStr.split('-')[1], 10) : 8;
    const day   = dateStr ? parseInt(dateStr.split('-')[2] || '15', 10) : 15;

    let swMonsoon = 0.0, neMonsoon = 0.0, wyrtki = 0.0;

    if (month >= 6 && month <= 9) {
      swMonsoon = (month === 7 || month === 8) ? 1.0 : 0.8;
    } else if (month === 12 || month <= 2) {
      neMonsoon = (month === 1) ? 1.0 : 0.85;
    } else if (month === 4 || month === 5) {
      wyrtki = 1.0; swMonsoon = 0.35;
    } else if (month === 10 || month === 11) {
      wyrtki = 0.9; neMonsoon = 0.45;
    } else {
      wyrtki = 0.5; swMonsoon = 0.2;
    }

    let u = 0.0, v = 0.0;

    // 1. Somali Western Boundary Current (strong northward in SW monsoon, reverses in NE)
    if (lon < 68 && lat < 16) {
      const somaliV = swMonsoon > 0 ? (1.25 * swMonsoon) : (-0.55 * neMonsoon);
      const somaliU = swMonsoon > 0 ? (0.45 * swMonsoon) : (-0.2  * neMonsoon);
      v += somaliV * Math.exp(-depth / 300);
      u += somaliU * Math.exp(-depth / 300);
    }

    // 2. West India Coastal Current (WICC)
    if (lon >= 68 && lon <= 75 && lat >= 8 && lat <= 22) {
      const wiccV = (neMonsoon * 0.65) - (swMonsoon * 0.7);
      v += wiccV * Math.exp(-depth / 200);
      u -= 0.15 * Math.sin(lat * 0.4);
    }

    // 3. East India Coastal Current (EICC)
    if (lon >= 80 && lon <= 90 && lat >= 10 && lat <= 22) {
      const eiccV = (swMonsoon * 0.55) - (neMonsoon * 0.5);
      v += eiccV * Math.exp(-depth / 250);
      u += 0.3 * Math.sin(lat * 0.3) * Math.exp(-depth / 250);
    }

    // 4. Equatorial Wyrtki Jet (0–5°N)
    if (lat <= 6) {
      const jetSpeed = 0.95 * wyrtki + 0.35 * swMonsoon + 0.15;
      u += jetSpeed * Math.exp(-depth / 150);
    }

    // Background dynamic eddies
    const eddyPhase = (month * 30 + day) * 0.05;
    u += 0.16 * Math.sin(lat * 0.45 + lon * 0.3  + eddyPhase);
    v += 0.16 * Math.cos(lat * 0.4  - lon * 0.25 + eddyPhase);

    const speed = Math.sqrt(u * u + v * v);
    return { u, v, speed };
  }

  // ── Land Mask Compliance ──────────────────────────────────────────────────

  _isLand(lat, lon) {
    return (lat > 8 && lat < 26 && lon > 74 && lon < 85 &&
            (lat - 8) > (lon - 74) * 0.8 &&
            (lat - 8) < (90 - lon) * 1.5);
  }

  // ── 1° Grid & Bilinear Interpolation (Smooth Advection) ───────────────────

  _buildVelocityGrid() {
    if (!this.velGrid) {
      this.velGrid = new Float32Array(GRID_LATS * GRID_LONS * 3);
    }
    for (let li = 0; li < GRID_LATS; li++) {
      for (let lj = 0; lj < GRID_LONS; lj++) {
        const lat = LAT_MIN + li * LAT_STEP;
        const lon = LON_MIN + lj * LON_STEP;
        const idx = (li * GRID_LONS + lj) * 3;
        if (this._isLand(lat, lon)) {
          this.velGrid[idx] = this.velGrid[idx + 1] = this.velGrid[idx + 2] = 0;
        } else {
          const c = this._computeCurrentAt(lat, lon, this.activeDepth, this.currentDate);
          this.velGrid[idx]     = c.u;
          this.velGrid[idx + 1] = c.v;
          this.velGrid[idx + 2] = c.speed;
        }
      }
    }
  }

  _sampleVelocity(lat, lon) {
    const cLat = Math.max(LAT_MIN, Math.min(LAT_MAX, lat));
    const cLon = Math.max(LON_MIN, Math.min(LON_MAX, lon));

    const lf  = (cLat - LAT_MIN) / LAT_STEP;
    const lof = (cLon - LON_MIN) / LON_STEP;
    const li0 = Math.floor(lf),  li1 = Math.min(li0 + 1, GRID_LATS - 1);
    const lj0 = Math.floor(lof), lj1 = Math.min(lj0 + 1, GRID_LONS - 1);
    const tl  = lf - li0, tlo = lof - lj0;

    const w00 = (1 - tl) * (1 - tlo);
    const w01 = (1 - tl) * tlo;
    const w10 = tl * (1 - tlo);
    const w11 = tl * tlo;

    const g   = this.velGrid;
    const i00 = (li0 * GRID_LONS + lj0) * 3;
    const i01 = (li0 * GRID_LONS + lj1) * 3;
    const i10 = (li1 * GRID_LONS + lj0) * 3;
    const i11 = (li1 * GRID_LONS + lj1) * 3;

    const u     = w00*g[i00]   + w01*g[i01]   + w10*g[i10]   + w11*g[i11];
    const v     = w00*g[i00+1] + w01*g[i01+1] + w10*g[i10+1] + w11*g[i11+1];
    const speed = Math.sqrt(u * u + v * v);
    return { u, v, speed };
  }

  // ── Speed-to-Color Ramping (High-Divergence Palette) ─────────────────────

  _speedToColor(speed) {
    if (speed < 0.4) return _tempColor.copy(COLOR_SLOW);
    if (speed <= 0.7) return _tempColor.copy(COLOR_MODERATE);
    return _tempColor.copy(COLOR_FAST);
  }

  // ── Particle Lifetime & Open-Water Spawning ───────────────────────────────

  _randomOceanCell() {
    let lat, lon, tries = 0;
    do {
      lat = LAT_MIN + Math.random() * (LAT_MAX - LAT_MIN);
      lon = LON_MIN + Math.random() * (LON_MAX - LON_MIN);
      tries++;
    } while (this._isLand(lat, lon) && tries < 30);
    return { lat, lon };
  }

  _spawnParticle(i, staggerAge = true) {
    const { lat, lon } = this._randomOceanCell();
    const maxAge       = MIN_AGE + Math.random() * (MAX_AGE - MIN_AGE);

    this.pData[i] = {
      lat, lon,
      maxAge,
      age: staggerAge ? Math.random() * maxAge : 0.0,
    };

    this._updateInstanceTransform(i, 1.0);
  }

  /**
   * Updates matrix and color for particle instance i.
   */
  _updateInstanceTransform(i, lifeAlpha = 1.0) {
    const p = this.pData[i];
    const { u, v, speed } = this._sampleVelocity(p.lat, p.lon);

    const pos = latLonDepthToXYZ(p.lat, p.lon, this.activeDepth, { verticalExaggeration: this.exaggeration });

    // Elevate Z by Z_NUDGE (+0.15) to float cleanly right above scalar volume slice plane
    _tempPos.set(pos.x, pos.y, pos.z + Z_NUDGE);

    // Direction angle on XY plane: rotation around Z axis
    const rotZ = Math.atan2(v, u) - Math.PI / 2;
    _euler.set(0, 0, rotZ, 'XYZ');
    _tempRot.setFromEuler(_euler);

    // Sleek scale proportional to velocity magnitude
    const lenScale = 0.5 + speed * 0.7;
    _tempScale.set(1.0, lenScale, 1.0);

    // Front-facing colored mesh matrix
    _tempMatrix.compose(_tempPos, _tempRot, _tempScale);
    this.instancedMesh.setMatrixAt(i, _tempMatrix);

    // Set fill color and fade alpha
    const col = this._speedToColor(speed);
    _tempColor.copy(col).multiplyScalar(lifeAlpha);
    this.instancedMesh.setColorAt(i, _tempColor);
  }

  // ── Init InstancedMesh Streamlines ────────────────────────────────────────

  _initStreamlines() {
    // Sleek 3D Tapered Stream Capsule: top radius 0.045 (head), bottom radius 0.01 (tail), height 0.6, 8 radial segments
    const geom = new THREE.CylinderGeometry(0.045, 0.01, 0.6, 8);

    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.90,
      depthWrite: true,
    });

    this.instancedMesh = new THREE.InstancedMesh(geom, mat, PARTICLE_COUNT);

    this.instancedMesh.renderOrder = 20;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this._spawnParticle(i, true);
    }

    if (this.instancedMesh.instanceMatrix) this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor)  this.instancedMesh.instanceColor.needsUpdate  = true;
    this.group.add(this.instancedMesh);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  updateForDate(dateStr, activeDepth = null) {
    if (dateStr) this.currentDate = dateStr;
    if (activeDepth !== null && activeDepth !== undefined) {
      this.activeDepth = Number(activeDepth);
    }
    this._buildVelocityGrid();
    for (let i = 0; i < PARTICLE_COUNT; i++) this._spawnParticle(i, true);
    if (this.instancedMesh) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
      if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  setExaggeration(factor) {
    this.exaggeration = factor;
    this._buildVelocityGrid();
    for (let i = 0; i < PARTICLE_COUNT; i++) this._spawnParticle(i, true);
    if (this.instancedMesh) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
      if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  setVisible(visible) {
    this.visible       = Boolean(visible);
    this.group.visible = this.visible;
  }

  /** Wire the OceanScene instance for navigation-aware update skipping. */
  setOceanScene(oceanScene) {
    this._oceanScene = oceanScene;
  }

  /**
   * Per-frame advection — called from main.js render loop ONLY when visible.
   * During navigation: CPU advects particles but GPU upload is skipped entirely.
   * @param {number} timeMs performance.now() timestamp
   */
  update(timeMs) {
    if (!this.visible || !this.instancedMesh) return;

    const isNav = this._oceanScene?.isNavigating ?? false;

    const dt = this._lastTimeMs !== null
      ? Math.min((timeMs - this._lastTimeMs) / 1000, MAX_DT)
      : 0.016;
    this._lastTimeMs = timeMs;

    // CPU advection always runs (cheap — just float arithmetic)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.pData[i];
      p.age += dt;

      // Respawn on lifetime expiry, domain exit, or land collision
      if (p.age > p.maxAge ||
          p.lat < LAT_MIN || p.lat > LAT_MAX ||
          p.lon < LON_MIN || p.lon > LON_MAX ||
          this._isLand(p.lat, p.lon)) {
        this._spawnParticle(i, false);
        continue;
      }

      // Advect position using bilinear-sampled velocity
      const { u, v } = this._sampleVelocity(p.lat, p.lon);
      p.lon += u * dt * ADVECT_SCALE;
      p.lat += v * dt * ADVECT_SCALE;

      // Smooth fade near birth (0-15%) and death (85-100%)
      const lifeFrac = p.age / p.maxAge;
      let lifeAlpha = 1.0;
      if (lifeFrac < 0.15) {
        lifeAlpha = lifeFrac / 0.15;
      } else if (lifeFrac > 0.85) {
        lifeAlpha = (1.0 - lifeFrac) / 0.15;
      }

      this._updateInstanceTransform(i, lifeAlpha);
    }

    // GPU upload throttled — push buffer every GPU_UPLOAD_EVERY frames.
    // Cuts GPU bus bandwidth in half while keeping particle motion continuously flowing.
    this._gpuFrame = (this._gpuFrame + 1) % GPU_UPLOAD_EVERY;
    if (this._gpuFrame === 0) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
      if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    if (this.instancedMesh) {
      this.instancedMesh.geometry.dispose();
      this.instancedMesh.material.dispose();
      this.group.remove(this.instancedMesh);
      this.instancedMesh = null;
    }
    this.scene.remove(this.group);
  }
}


