import * as THREE from 'three';
import { latLonDepthToXYZ, getDepthZ } from '../utils/coordTransform.js';

/**
 * WaterColumnCage.js — 3D "Fish Tank" Aquarium Bounding Box & Interactive Depth Ruler
 *
 * Features:
 *  - 4 vertical corner pillars (Surface 0m to Seafloor 5000m)
 *  - Surface & seafloor perimeter frames and geographic graticule grids
 *  - Intermediate depth level guide rings (200m thermocline, 1000m intermediate, 2000m deep)
 *  - Interactive billboard depth ruler badges along front-left corner pillar with click-to-select
 *  - Luminous cyan halo and [SELECTED] indicator on active depth
 *  - Dynamic scaling with vertical exaggeration (75x default)
 *  - High-contrast color adaptation for all Light and Dark themes
 */
export class WaterColumnCage {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'WaterColumnCage';
    this.scene.add(this.group);

    this.labelGroup = new THREE.Group();
    this.labelGroup.name = 'WaterColumnCageLabels';
    this.scene.add(this.labelGroup);

    this.minLat = 0;
    this.maxLat = 25;
    this.minLon = 60;
    this.maxLon = 95;
    this.maxDepth = 5000;
    this.currentExaggeration = 75;
    this.isLightMode = false;
    this.selectedDepth = 0;

    this.rulerLevels = [
      { depth: 0,    label: '0m · Surface' },
      { depth: 200,  label: '200m · Thermocline' },
      { depth: 500,  label: '500m · Mesopelagic' },
      { depth: 1000, label: '1000m · Argo Drift' },
      { depth: 2000, label: '2000m · Deep CTD' },
      { depth: 5000, label: '5000m · Seafloor' },
    ];

    this._buildCage();
    this._buildRulerLabels();
    this.setExaggeration(75);
  }

  _buildCage() {
    // 4 Corner coordinates at surface (z=0)
    const cNW = latLonDepthToXYZ(this.maxLat, this.minLon, 0); // (60°E, 25°N)
    const cNE = latLonDepthToXYZ(this.maxLat, this.maxLon, 0); // (95°E, 25°N)
    const cSE = latLonDepthToXYZ(this.minLat, this.maxLon, 0); // (95°E, 0°N)
    const cSW = latLonDepthToXYZ(this.minLat, this.minLon, 0); // (60°E, 0°N) - Front-Left

    this.corners = [cNW, cNE, cSE, cSW];
    const baseZ5000 = getDepthZ(5000, 50); // base Z for 5000m at 50x = -15.0

    // Materials for cage borders and vertical pillars
    this.pillarMat = new THREE.LineBasicMaterial({
      color: 0x00d4aa,
      transparent: true,
      opacity: 0.70,
      linewidth: 2,
    });

    this.surfaceMat = new THREE.LineBasicMaterial({
      color: 0x00d4aa,
      transparent: true,
      opacity: 0.90,
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
      opacity: 0.50,
    });

    this.floorMat = new THREE.LineBasicMaterial({
      color: 0x1e295d,
      transparent: true,
      opacity: 0.65,
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
    for (const c of this.corners) {
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

    // 6. Horizontal depth notches along front pillar (cSW)
    const notchPts = [];
    for (const item of this.rulerLevels) {
      const z = getDepthZ(item.depth, 50);
      notchPts.push(new THREE.Vector3(cSW.x, cSW.y, z));
      notchPts.push(new THREE.Vector3(cSW.x - 1.2, cSW.y - 1.2, z));
    }
    const notchGeo = new THREE.BufferGeometry().setFromPoints(notchPts);
    this.group.add(new THREE.LineSegments(notchGeo, this.pillarMat));
  }

  _buildRulerLabels() {
    // Front-Left corner at (60°E, 0°N)
    const cSW = latLonDepthToXYZ(this.minLat, this.minLon, 0);

    this.labelGroup.renderOrder = 999;
    this.rulerSprites = [];
    for (const item of this.rulerLevels) {
      const isSelected = (item.depth === this.selectedDepth);
      const sprite = this._createTextSprite(item.label, this.isLightMode, isSelected);
      sprite.userData = { depth: item.depth, label: item.label, isSelected };
      sprite.position.set(cSW.x - 3.2, cSW.y - 3.2, getDepthZ(item.depth, this.currentExaggeration));
      sprite.renderOrder = 999;
      this.labelGroup.add(sprite);
      this.rulerSprites.push(sprite);
    }
  }

  _createTextSprite(text, isLight = false, isSelected = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 390;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const r = 18;
    const x = 5, y = 5, w = 380, h = 54;

    if (isSelected) {
      // Selected / Active state: Luminous cyan halo with glowing border
      ctx.shadowColor = isLight ? 'rgba(0, 139, 116, 0.7)' : '#00ffff';
      ctx.shadowBlur = isLight ? 12 : 18;

      ctx.fillStyle = isLight ? 'rgba(215, 255, 245, 0.98)' : 'rgba(0, 46, 68, 0.96)';
      ctx.strokeStyle = isLight ? '#008b74' : '#00ffff';
      ctx.lineWidth = 4;
    } else {
      // Unselected state: Translucent dark glass pill with subtle border
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 6;

      ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(8, 20, 36, 0.90)';
      ctx.strokeStyle = isLight ? '#008b74' : '#00d4aa';
      ctx.lineWidth = 2.5;
    }

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Reset shadow for razor-sharp typography
    ctx.shadowBlur = 0;

    // Text rendering: Active badge has bullet indicator
    const displayText = isSelected ? ('● ' + text + ' [SELECTED]') : text;
    ctx.font = isSelected
      ? 'bold 21px "Inter", "Segoe UI", system-ui, sans-serif'
      : 'bold 22px "Inter", "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = isSelected
      ? (isLight ? '#004d40' : '#ffffff')
      : (isLight ? '#061a2b' : '#38efc6');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, 195, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    sprite.scale.set(isSelected ? 5.6 : 4.8, isSelected ? 0.92 : 0.75, 1);
    return sprite;
  }

  updateThemeColor(primaryHex = 0x00d4aa, guideHex = 0x4a5584, gridHex = 0x1e295d, isLight = false) {
    this.isLightMode = !!isLight;
    if (this.surfaceMat) {
      this.surfaceMat.color.set(primaryHex);
      this.surfaceMat.opacity = isLight ? 0.95 : 0.90;
      this.surfaceMat.needsUpdate = true;
    }
    if (this.pillarMat) {
      this.pillarMat.color.set(primaryHex);
      this.pillarMat.opacity = isLight ? 0.85 : 0.70;
      this.pillarMat.needsUpdate = true;
    }
    if (this.surfaceGridMat) {
      this.surfaceGridMat.color.set(gridHex);
      this.surfaceGridMat.opacity = isLight ? 0.55 : 0.35;
      this.surfaceGridMat.needsUpdate = true;
    }
    if (this.guideMat) {
      this.guideMat.color.set(guideHex);
      this.guideMat.opacity = isLight ? 0.80 : 0.50;
      this.guideMat.needsUpdate = true;
    }
    if (this.floorMat) {
      this.floorMat.color.set(gridHex);
      this.floorMat.opacity = isLight ? 0.85 : 0.65;
      this.floorMat.needsUpdate = true;
    }

    // Re-render label textures for high-contrast in light mode
    if (this.rulerSprites) {
      for (const sprite of this.rulerSprites) {
        if (!sprite.userData?.label) continue;
        const isSelected = !!sprite.userData?.isSelected;
        const newSprite = this._createTextSprite(sprite.userData.label, isLight, isSelected);
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.map = newSprite.material.map;
        sprite.material.needsUpdate = true;
        newSprite.material.dispose();
      }
    }
  }

  setExaggeration(exaggeration) {
    const ex = Number(exaggeration) || 75;
    this.currentExaggeration = ex;
    const factor = ex / 50;
    this.group.scale.set(1, 1, factor);

    // Reposition depth labels accurately without vertical sprite stretching
    if (this.rulerSprites) {
      for (const sprite of this.rulerSprites) {
        const depth = sprite.userData?.depth || 0;
        sprite.position.z = getDepthZ(depth, ex);
        const isSelected = !!sprite.userData?.isSelected;
        sprite.scale.set(isSelected ? 5.6 : 4.8, isSelected ? 0.92 : 0.75, 1);
      }
    }
  }

  /**
   * Visually highlights the selected depth ruler badge (cyan halo, [SELECTED] tag, scaled up)
   * and restores other depth badges to default state.
   * @param {number} depth Depth in meters
   */
  setSelectedDepth(depth) {
    const target = Number(depth);
    let closestDepth = this.rulerLevels[0].depth;
    let minDiff = Infinity;
    for (const item of this.rulerLevels) {
      const diff = Math.abs(item.depth - target);
      if (diff < minDiff) {
        minDiff = diff;
        closestDepth = item.depth;
      }
    }
    this.selectedDepth = closestDepth;

    if (this.rulerSprites) {
      for (const sprite of this.rulerSprites) {
        const isSelected = (sprite.userData?.depth === this.selectedDepth);
        sprite.userData.isSelected = isSelected;

        const newSprite = this._createTextSprite(sprite.userData.label, this.isLightMode, isSelected);
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.map = newSprite.material.map;
        sprite.material.needsUpdate = true;
        newSprite.material.dispose();

        if (isSelected) {
          sprite.scale.set(5.6, 0.92, 1);
        } else {
          sprite.scale.set(4.8, 0.75, 1);
        }
      }
    }
  }

  getRulerSprites() {
    return this.rulerSprites || [];
  }

  setVisible(visible) {
    this.group.visible = visible;
    this.labelGroup.visible = visible;
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.scene.remove(this.group);

    this.labelGroup.traverse((obj) => {
      if (obj.material?.map) obj.material.map.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.scene.remove(this.labelGroup);
    this.rulerSprites = [];
  }
}
