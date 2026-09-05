import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class OceanScene {
  /**
   * Initializes the 3D Ocean Visualizer scene container.
   * @param {HTMLCanvasElement} canvas Target canvas element
   */
  constructor(canvas) {
    this.canvas = canvas;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a2e);

    // Depth & atmosphere — fade far edges cleanly
    this.scene.fog = new THREE.Fog(0x0a0a2e, 80, 400);

    // 2. Camera setup - Positioned looking at Indian Ocean data grid
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    // Z is the vertical water-column axis (+Z sky, -Z ocean depths)
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0, -50, 45);

    // 3. Renderer setup — no antialias (huge perf gain), cap pixelRatio at 1
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0a0a2e, 1.0);

    // 4. OrbitControls setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 500;
    this.controls.target.set(0, 0, -4);

    // 5. Lighting setup
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.directionalLight.position.set(20, 40, 20);
    this.scene.add(this.directionalLight);

    // Render loop callbacks
    this.updateCallbacks = [];

    // Resize listener — debounced to avoid layout thrash during drag-resize
    this._resizeTimer = null;
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    // Start animation loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  /**
   * Registers a callback function to run on every frame update.
   * @param {Function} callback Callback receiving (time, deltaTime)
   */
  onUpdate(callback) {
    if (typeof callback === 'function') {
      this.updateCallbacks.push(callback);
    }
  }

  /**
   * Internal resize handler.
   */
  _onResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      // Keep consistent cap at 1 — matches constructor for max perf on retina
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    }, 100);
  }

  /**
   * Animation render loop.
   */
  animate(time = 0) {
    requestAnimationFrame(this.animate);

    this.controls.update();

    for (const callback of this.updateCallbacks) {
      callback(time);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Updates 3D scene background and atmospheric fog color to match active theme & mode.
   * @param {number} bgColorHex Hex color number (e.g. 0x061426)
   * @param {number} [fogColorHex] Hex color number for atmospheric fog
   */
  updateThemeColors(bgColorHex = 0x061426, fogColorHex = 0x061426) {
    const col = new THREE.Color(bgColorHex);
    this.scene.background = col;
    if (this.scene.fog) {
      this.scene.fog.color = new THREE.Color(fogColorHex);
    }
    this.renderer.setClearColor(col, 1.0);
  }

  /**
   * Clean up WebGL resources and event listeners.
   */
  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
