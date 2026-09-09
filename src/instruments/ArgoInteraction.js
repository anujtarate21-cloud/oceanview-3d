import * as THREE from 'three';
import { RAYCAST_THROTTLE_MS } from '../utils/constants.js';

// Reusable Vector3 for screen projections to avoid GC allocations in render loops
const _projVec = new THREE.Vector3();

export class ArgoInteraction {
  /**
   * Initializes raycasting and pointer interactions for Argo markers and Depth Ruler badges.
   * @param {HTMLCanvasElement} canvas Target canvas element
   * @param {THREE.Camera} camera Scene perspective camera
   * @param {ArgoMarkers} argoMarkers ArgoMarkers instance
   * @param {Object} [options] Optional UI elements (tooltip, coordsEl, waterColumnCage, controlPanel)
   */
  constructor(canvas, camera, argoMarkers, options = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.argoMarkers = argoMarkers;
    this.waterColumnCage = options.waterColumnCage || null;
    this.controlPanel = options.controlPanel || null;
    this.tooltip = options.tooltip || document.getElementById('argo-tooltip');
    this.coordsEl = options.coordsEl || document.getElementById('status-coords');
    this.throttleMs = options.throttleMs || 20;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points = { threshold: 0.5 };
    this.mouse = new THREE.Vector2();
    this.hoveredMarker = null;
    this._hoveredRulerSprite = null;
    this._hoveredInstanceId = null;
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.intersectPoint = new THREE.Vector3();
    this.lastRaycastTime = 0;
    this._lastClickHandledTime = 0;

    // Track pointer movement for drag-tolerant click detection
    this._pointerDownPos = { x: 0, y: 0, time: 0 };

    this._onPointerDown = (e) => {
      this._pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
    };

    this._onPointerUp = (e) => {
      const dx = e.clientX - this._pointerDownPos.x;
      const dy = e.clientY - this._pointerDownPos.y;
      // If movement is under 8px, user performed a deliberate click
      if (Math.hypot(dx, dy) < 8) {
        this._handleBadgeOrMarkerClick(e);
      }
    };

    this._onClick = (e) => {
      this._handleBadgeOrMarkerClick(e);
    };

    this._onPointerMove = this._onPointerMove.bind(this);

    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('click', this._onClick);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
  }

  /**
   * Screen-space hit test for 3D depth ruler badges.
   * Calculates dynamic projected bounding box based on camera distance and FOV.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {THREE.Sprite|null}
   */
  _findHoveredRulerSprite(clientX, clientY) {
    if (!this.waterColumnCage || typeof this.waterColumnCage.getRulerSprites !== 'function') {
      return null;
    }
    const sprites = this.waterColumnCage.getRulerSprites();
    if (!sprites || sprites.length === 0) return null;

    // 1. Exact 3D Raycasting against camera-facing sprite billboard quads
    this._updateMouseCoords({ clientX, clientY });
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const rayHits = this.raycaster.intersectObjects(sprites, false);
    if (rayHits.length > 0) {
      return rayHits[0].object;
    }

    // 2. High-tolerance Screen-Space Projection (generous padding for comfortable hovering/clicking)
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    let bestSprite = null;
    let minDistance = Infinity;

    const fov = this.camera.fov ? THREE.MathUtils.degToRad(this.camera.fov / 2) : THREE.MathUtils.degToRad(25);
    const aspect = this.camera.aspect || (rect.width / (rect.height || 1));

    for (const sprite of sprites) {
      sprite.getWorldPosition(_projVec);
      const camDist = this.camera.position.distanceTo(_projVec);

      _projVec.project(this.camera);

      // Skip if behind camera
      if (_projVec.z < -1 || _projVec.z > 1) continue;

      const screenX = (_projVec.x * 0.5 + 0.5) * rect.width;
      const screenY = (-_projVec.y * 0.5 + 0.5) * rect.height;

      const dx = mouseX - screenX;
      const dy = mouseY - screenY;

      // Calculate projected size on screen with generous padding
      const visH = 2 * Math.tan(fov) * Math.max(1, camDist);
      const visW = visH * aspect;
      const projW = (4.8 / visW) * rect.width;
      const projH = (0.75 / visH) * rect.height;

      const halfHitW = Math.max(120, (projW / 2) * 1.55);
      const halfHitH = Math.max(30, (projH / 2) * 1.6);

      if (Math.abs(dx) <= halfHitW && Math.abs(dy) <= halfHitH) {
        const dist = Math.hypot(dx, dy);
        if (dist < minDistance) {
          minDistance = dist;
          bestSprite = sprite;
        }
      }
    }

    return bestSprite;
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
   * Handles click/selection on depth badges and Argo markers.
   * @param {MouseEvent|PointerEvent} event
   */
  _handleBadgeOrMarkerClick(event) {
    const now = performance.now();
    if (now - this._lastClickHandledTime < 80) return;
    this._lastClickHandledTime = now;

    // 1. Direct 3D Depth Selection via Depth Ruler Badges (Screen-space prioritized)
    const rulerSprite = this._findHoveredRulerSprite(event.clientX, event.clientY);
    if (rulerSprite) {
      const depth = rulerSprite.userData?.depth;
      if (depth !== undefined) {
        if (this.waterColumnCage && typeof this.waterColumnCage.setSelectedDepth === 'function') {
          this.waterColumnCage.setSelectedDepth(depth);
        }
        if (this.controlPanel && typeof this.controlPanel.setDepth === 'function') {
          this.controlPanel.setDepth(depth);
        }
        document.dispatchEvent(new CustomEvent('ruler-depth-click', { detail: { depth } }));
        return;
      }
    }

    // 2. Argo Float Marker Selection (Raycast)
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
      const float_id = data?.float_id || data?.id;
      if (float_id) {
        document.dispatchEvent(new CustomEvent('argo-click', { detail: { float_id } }));
      }
    }
  }

  /**
   * Handles hover/pointermove feedback on markers, depth badges, and ocean plane.
   * @param {PointerEvent} event
   */
  _onPointerMove(event) {
    const now = performance.now();
    if (now - this.lastRaycastTime < this.throttleMs) return;
    this.lastRaycastTime = now;

    // 1. Immediate Screen-Space Hover on 3D Depth Ruler Badges
    const rulerSprite = this._findHoveredRulerSprite(event.clientX, event.clientY);
    if (rulerSprite) {
      if (this._hoveredRulerSprite !== rulerSprite) {
        this._resetRulerHover();
        this._hoveredRulerSprite = rulerSprite;
        rulerSprite.scale.set(5.9, 1.05, 1); // Noticeable hover pop
      }
      this.canvas.style.cursor = 'pointer';
      this.canvas.classList.add('hovering-marker');
      if (this.coordsEl) {
        const depth = rulerSprite.userData?.depth;
        const label = rulerSprite.userData?.label || (depth + 'm');
        this.coordsEl.textContent = 'Click to select depth: ' + label;
      }
      return;
    } else {
      this._resetRulerHover();
    }

    // 2. Hover feedback on Argo Float Markers
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

      if (this._hoveredInstanceId !== instanceId && instanceId !== undefined) {
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
        this.tooltip.style.left = event.clientX + 'px';
        this.tooltip.style.top = event.clientY + 'px';
        const name = data.platform_type === 'glider' ? 'Glider' : 'Argo Float';
        const id = data.float_id || data.id || '';
        const lat = Number(data.lat || 0).toFixed(2);
        const lon = Number(data.lon || 0).toFixed(2);
        const date = data.date || '';
        this.tooltip.innerHTML = '<div><strong>' + name + ' ' + id + '</strong></div><div style="font-size:10px;opacity:0.75;margin-top:2px;">' + lat + '°N, ' + lon + '°E • ' + date + '</div>';
      }

      if (this.coordsEl) {
        this.coordsEl.textContent = 'Target: ' + Number(data.lat || 0).toFixed(2) + '°N • ' + Number(data.lon || 0).toFixed(2) + '°E';
      }
    } else {
      this._clearHover();

      if (this.coordsEl && this.raycaster.ray.intersectPlane(this.groundPlane, this.intersectPoint)) {
        const lon = this.intersectPoint.x / 1.6 + 77.5;
        const lat = this.intersectPoint.y / 1.6 + 12.5;
        if (lat >= -2 && lat <= 28 && lon >= 58 && lon <= 96) {
          this.coordsEl.textContent = 'Lat: ' + lat.toFixed(2) + '°N • Lon: ' + lon.toFixed(2) + '°E';
        }
      }
    }
  }

  _resetRulerHover() {
    if (this._hoveredRulerSprite) {
      const isSelected = !!this._hoveredRulerSprite.userData?.isSelected;
      this._hoveredRulerSprite.scale.set(
        isSelected ? 5.6 : 4.8,
        isSelected ? 0.92 : 0.75,
        1
      );
      this._hoveredRulerSprite = null;
    }
  }

  _clearHover() {
    this._resetRulerHover();
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
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this._clearHover();
  }
}
