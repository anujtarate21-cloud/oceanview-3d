import * as THREE from 'three';

export class ArgoInteraction {
  /**
   * Initializes raycasting and pointer interactions for Argo markers.
   * @param {HTMLCanvasElement} canvas Target canvas element
   * @param {THREE.Camera} camera Scene perspective camera
   * @param {ArgoMarkers} argoMarkers ArgoMarkers instance
   */
  constructor(canvas, camera, argoMarkers) {
    this.canvas = canvas;
    this.camera = camera;
    this.argoMarkers = argoMarkers;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredMarker = null;

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
      const float_id = hits[0].object.userData.float_id || hits[0].object.userData.id;
      document.dispatchEvent(new CustomEvent('argo-click', { detail: { float_id } }));
    }
  }

  /**
   * Handles hover/pointermove feedback on markers.
   * @param {PointerEvent} event
   */
  _onPointerMove(event) {
    this._updateMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const markers = this.argoMarkers.getMarkers();
    const hits = this.raycaster.intersectObjects(markers);

    if (hits.length > 0) {
      const hitMarker = hits[0].object;
      if (this.hoveredMarker !== hitMarker) {
        if (this.hoveredMarker) {
          this.hoveredMarker.scale.set(1, 1, 1);
        }
        this.hoveredMarker = hitMarker;
        this.hoveredMarker.scale.set(1.3, 1.3, 1.3);
      }
      this.canvas.style.cursor = 'pointer';
    } else {
      if (this.hoveredMarker) {
        this.hoveredMarker.scale.set(1, 1, 1);
        this.hoveredMarker = null;
      }
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Cleans up event listeners.
   */
  dispose() {
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    if (this.hoveredMarker) {
      this.hoveredMarker.scale.set(1, 1, 1);
      this.hoveredMarker = null;
    }
    this.canvas.style.cursor = 'default';
  }
}
