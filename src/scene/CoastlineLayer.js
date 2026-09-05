import * as THREE from 'three';
import { latLonDepthToXYZ } from '../utils/coordTransform.js';

export class CoastlineLayer {
  /**
   * Initializes CoastlineLayer instance.
   * @param {THREE.Scene} scene Three.js Scene instance
   * @param {Object} [coordTransformConfig] Coordinate transform configuration
   */
  constructor(scene, coordTransformConfig = {}) {
    this.scene = scene;
    this.coordTransformConfig = coordTransformConfig;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.lines = [];
  }

  /**
   * Loads GeoJSON coastline data and renders 3D lines.
   * @param {string|Object} [urlOrGeojson] URL or GeoJSON object
   */
  async load(urlOrGeojson = '/data/coastline.geojson') {
    this.dispose();

    let geojson;
    if (typeof urlOrGeojson === 'string') {
      const response = await fetch(urlOrGeojson);
      geojson = await response.json();
    } else {
      geojson = urlOrGeojson;
    }

    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
      transparent: true,
      opacity: 0.85
    });

    const parseLineString = (coords) => {
      const points = [];
      for (const [lon, lat] of coords) {
        const xyz = latLonDepthToXYZ(lat, lon, 0, this.coordTransformConfig);
        // Depth lives on Z, so lift slightly above surface
        points.push(new THREE.Vector3(xyz.x, xyz.y, xyz.z + 0.1));
      }
      if (points.length < 2) return;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, this.material);
      this.group.add(line);
      this.lines.push({ line, geometry });
    };

    if (geojson && geojson.features) {
      for (const feature of geojson.features) {
        const geom = feature.geometry;
        if (!geom) continue;
        if (geom.type === 'LineString') {
          parseLineString(geom.coordinates);
        } else if (geom.type === 'MultiLineString' || geom.type === 'Polygon') {
          for (const lineCoords of geom.coordinates) {
            parseLineString(lineCoords);
          }
        } else if (geom.type === 'MultiPolygon') {
          for (const polygonCoords of geom.coordinates) {
            for (const lineCoords of polygonCoords) {
              parseLineString(lineCoords);
            }
          }
        }
      }
    }
  }

  /**
   * Updates coastline color and opacity to match active theme.
   * @param {number|string} colorHex Hex color
   * @param {number} [opacity]
   */
  updateThemeColor(colorHex = 0xffffff, opacity = 0.85) {
    if (this.material) {
      this.material.color.set(colorHex);
      this.material.opacity = opacity;
      this.material.needsUpdate = true;
    }
  }

  /**
   * Toggles visibility of the coastline.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.group.visible = visible;
  }

  /**
   * Disposes geometries and materials.
   */
  dispose() {
    for (const item of this.lines) {
      this.group.remove(item.line);
      if (item.geometry) item.geometry.dispose();
    }
    this.lines = [];
    this.group.clear();
  }
}
