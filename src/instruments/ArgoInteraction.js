import * as THREE from 'three';
import { RAYCAST_THROTTLE_MS } from '../utils/constants.js';

export class ArgoInteraction {
  /**
   * Initializes raycasting and pointer interactions for Argo markers.
   * @param {HTMLCanvasElement} canvas Target canvas element
   * @param {THREE.Camera} camera Scene perspective camera
   * @param {ArgoMarkers} argoMarkers ArgoMarkers instance
   * @param {Object} [options] Optional UI elements (tooltip, coordsEl)
   */
  constructor(canvas, camera, argoMarkers, options = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.argoMarkers = argoMarkers;
    this.tooltip = options.tooltip || document.getElementById('argo-tooltip');
    this.coordsEl = options.coordsEl || document.getElementById('status-coords');
    this.throttleMs = options.throttleMs || RAYCAST_THROTTLE_MS || 60;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points = { threshold: 0.5 };
    this.mouse = new THREE.Vector2();
    this.hoveredMarker = null;
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.intersectPoint = new THREE.Vector3();
    this.lastRaycastTime = 0;

    this._onClick = this._onClick.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);

    this.canvas.addEventListener('click', this._onClick);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
  }

  /**
   * Updates normalized device coordinates (-1 to +1) from pointer event.
   * @param {MouseEvent|PointerEvent} event
   */
  _updateMouseCoords(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Handles click events on 3D canvas.
   * @param {MouseEvent} event
   */
  _onClick(event) {
    this._updateMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const markers = this.argoMarkers.getMarkers();
    const hits = this.raycaster.intersectObjects(markers);

    if (hits.length > 0) {
      const hit = hits[0];
      // InstancedMesh: use instanceId to look up proxy data
      const instanceId = hit.instanceId;
      const data = instanceId !== undefined
        ? this.argoMarkers.getMarkerData(instanceId)
        : (hit.object.userData);
      const float_id = data?.float_id || data?.id;
      if (float_id) {
        document.dispatchEvent(new CustomEvent('argo-click', { detail: { float_id } }));
      }
    }
  }

  /**
   * Handles hover/pointermove feedback on markers and ocean plane.
   * @param {PointerEvent} event
   */
  _onPointerMove(event) {
    const now = performance.now();
    if (now - this.lastRaycastTime < this.throttleMs) return;
    this.lastRaycastTime = now;

    this._updateMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const markers = this.argoMarkers.getMarkers();
    const hits = this.raycaster.intersectObjects(markers);

    if (hits.length > 0) {
      const hit = hits[0];
      const instanceId = hit.instanceId;
      const data = instanceId !== undefined
        ? this.argoMarkers.getMarkerData(instanceId)
        : (hit.object.userData);

      if (!data) {
        this._clearHover();
        return;
      }

      // Track hovered instance for scale feedback
      if (this._hoveredInstanceId !== instanceId && instanceId !== undefined) {
        // Reset previous hover
        if (this._hoveredInstanceId !== undefined && this._hoveredInstanceId !== null) {
          const prev = this.argoMarkers.markers[this._hoveredInstanceId];
          if (prev?.scale) prev.scale.set(1, 1, 1);
        }
        this._hoveredInstanceId = instanceId;
        const current = this.argoMarkers.markers[instanceId];
        if (current?.scale) current.scale.set(1.3, 1.3, 1.3);
      }

      this.canvas.style.cursor = 'pointer';
      this.canvas.classList.add('hovering-marker');

      if (this.tooltip) {
        this.tooltip.classList.remove('hidden');
        this.tooltip.style.left = `${event.clientX}px`;
        this.tooltip.style.top = `${event.clientY}px`;
        const name = data.platform_type === 'glider' ? '🌊 Glider' : '🛰️ Argo Float';
        const id = data.float_id || data.id || '';
        const lat = Number(data.lat || 0).toFixed(2);
        const lon = Number(data.lon || 0).toFixed(2);
        const date = data.date || '';
        this.tooltip.innerHTML = `<div><strong>${name} ${id}</strong></div><div style="font-size:10px;opacity:0.75;margin-top:2px;">${lat}°N, ${lon}°E · ${date}</div>`;
      }

      if (this.coordsEl) {
        this.coordsEl.textContent = `Target: ${Number(data.lat || 0).toFixed(2)}°N · ${Number(data.lon || 0).toFixed(2)}°E`;
      }
    } else {
      this._clearHover();

      if (this.coordsEl && this.raycaster.ray.intersectPlane(this.groundPlane, this.intersectPoint)) {
        const lon = this.intersectPoint.x / 1.6 + 77.5;
        const lat = this.intersectPoint.y / 1.6 + 12.5;
        if (lat >= -2 && lat <= 28 && lon >= 58 && lon <= 96) {
          this.coordsEl.textContent = `Lat: ${lat.toFixed(2)}°N · Lon: ${lon.toFixed(2)}°E`;
        }
      }
    }
  }

  _clearHover() {
    if (this._hoveredInstanceId !== undefined && this._hoveredInstanceId !== null) {
      const prev = this.argoMarkers.markers[this._hoveredInstanceId];
      if (prev?.scale) prev.scale.set(1, 1, 1);
      this._hoveredInstanceId = null;
    }
    this.canvas.style.cursor = 'default';
    this.canvas.classList.remove('hovering-marker');
    if (this.tooltip) {
      this.tooltip.classList.add('hidden');
    }
  }

  /**
   * Cleans up event listeners.
   */
  dispose() {
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this._clearHover();
  }
}
