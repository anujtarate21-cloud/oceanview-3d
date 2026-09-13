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

    // Depth & atmosphere — oceanic fog with physically motivated falloff
    this.scene.fog = new THREE.Fog(0x0a0a2e, 90, 420);

    // 2. Camera setup — Lower oblique side angle to dramatically showcase vertical depth layers
    this.camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    // Z is the vertical water-column axis (+Z sky, -Z ocean depths)
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-42, -88, 32);

    // 3. Renderer setup — high-performance WebGL 2.0
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      precision: 'mediump',
    });

    // Always maintain crisp, razor-sharp 1.0 pixel ratio
    this.pixelRatio = Math.min(window.devicePixelRatio, 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0a0a2e, 1.0);

    // Disable per-frame transparent object sort — manual renderOrder management
    this.renderer.sortObjects = false;

    // 4. OrbitControls setup with smooth idle auto-rotation
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 500;
    this.controls.target.set(0, 0, -10);

    // Cinematic Idle Auto-Rotate setup (speed 1.0: faster than 0.5, smoother than 1.6)
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 1.0;

    this._idleTimer = null;
    this._isIdleRotating = false;
    this.savedCameraPos = this.camera.position.clone();
    this.savedTarget = this.controls.target.clone();

    // Fast camera revert animation state (350ms smooth transition back to pre-idle view)
    this._isReverting = false;
    this._revertStartTime = 0;
    this._revertDuration = 350;
    this._revertStartPos = new THREE.Vector3();
    this._revertStartTarget = new THREE.Vector3();

    const triggerRevertToSavedView = () => {
      if (this._isIdleRotating && this.savedCameraPos && this.savedTarget) {
        this._isReverting = true;
        this._revertStartTime = performance.now();
        this._revertStartPos.copy(this.camera.position);
        this._revertStartTarget.copy(this.controls.target);
      }
      this._isIdleRotating = false;
      this.controls.autoRotate = false;
    };

    const resetIdleTimer = () => {
      // If user interacts while idle auto-rotating, fast-revert back to pre-idle position!
      if (this._isIdleRotating) {
        triggerRevertToSavedView();
      } else if (!this._isReverting) {
        // Continuously update saved pre-idle view while user is actively inspecting
        this.savedCameraPos.copy(this.camera.position);
        this.savedTarget.copy(this.controls.target);
      }

      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        // 8 seconds of inactivity threshold -> Save snapshot and start idle auto-rotation
        if (!this._isReverting) {
          this.savedCameraPos.copy(this.camera.position);
          this.savedTarget.copy(this.controls.target);
        }
        this._isIdleRotating = true;
        this.controls.autoRotate = true;
      }, 8000); // 8 seconds inactivity threshold
    };

    // Listen to user interactions across canvas and window
    this.controls.addEventListener('start', resetIdleTimer);
    this.controls.addEventListener('change', () => {
      if (!this.controls.autoRotate && !this._isReverting) {
        this.savedCameraPos.copy(this.camera.position);
        this.savedTarget.copy(this.controls.target);
      }
    });

    window.addEventListener('pointermove', resetIdleTimer, { passive: true });
    window.addEventListener('pointerdown', resetIdleTimer, { passive: true });
    window.addEventListener('keydown', resetIdleTimer, { passive: true });
    window.addEventListener('wheel', resetIdleTimer, { passive: true });
    window.addEventListener('touchstart', resetIdleTimer, { passive: true });

    // Initial 8s countdown before first idle auto-rotation
    this._idleTimer = setTimeout(() => {
      this.savedCameraPos.copy(this.camera.position);
      this.savedTarget.copy(this.controls.target);
      this._isIdleRotating = true;
      this.controls.autoRotate = true;
    }, 8000);

    // Navigation state flag
    this.isNavigating = false;
    this._navTimer    = null;

    const setNavigating = () => {
      this.isNavigating = true;
      clearTimeout(this._navTimer);
      this._navTimer = setTimeout(() => {
        this.isNavigating = false;
      }, 150);
    };

    this.controls.addEventListener('start',  setNavigating);
    this.controls.addEventListener('change', setNavigating);
    this.controls.addEventListener('end', () => {
      clearTimeout(this._navTimer);
      this._navTimer = setTimeout(() => {
        this.isNavigating = false;
      }, 120);
    });

    // 5. Lighting setup
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.65);
    this.directionalLight.position.set(25, 45, 35);
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
   * @param {Function} callback Callback receiving (time)
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
      this.renderer.setPixelRatio(this.pixelRatio);
    }, 100);
  }

  /**
   * Animation render loop — fluid native frame rendering with smooth controls damping & auto-rotate.
   */
  animate(time = 0) {
    requestAnimationFrame(this.animate);

    // Smooth fast revert animation back to pre-idle camera view on interaction
    if (this._isReverting) {
      const now = performance.now();
      const elapsed = now - this._revertStartTime;
      const t = Math.min(1.0, elapsed / this._revertDuration);
      const easeT = 1 - Math.pow(1 - t, 3); // Cubic ease-out

      this.camera.position.lerpVectors(this._revertStartPos, this.savedCameraPos, easeT);
      this.controls.target.lerpVectors(this._revertStartTarget, this.savedTarget, easeT);

      if (t >= 1.0) {
        this._isReverting = false;
      }
    }

    this.controls.update();

    for (const callback of this.updateCallbacks) {
      callback(time);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Updates 3D scene background and atmospheric fog color to match active theme & mode.
   * In light mode, fog fades toward sunlit haze rather than black.
   * @param {number} bgColorHex Hex color number (e.g. 0x061426)
   * @param {number} [fogColorHex] Hex color number for atmospheric fog
   * @param {boolean} [isLightMode=false] Whether light mode is active
   */
  updateThemeColors(bgColorHex = 0x061426, fogColorHex = 0x061426, isLightMode = false) {
    const col = new THREE.Color(bgColorHex);
    this.scene.background = col;
    if (this.scene.fog) {
      this.scene.fog.color = new THREE.Color(fogColorHex);
      if (isLightMode) {
        // Sunlit ocean haze: slightly softer near/far range
        this.scene.fog.near = 100;
        this.scene.fog.far  = 460;
      } else {
        // Abyss attenuation
        this.scene.fog.near = 90;
        this.scene.fog.far  = 420;
      }
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
