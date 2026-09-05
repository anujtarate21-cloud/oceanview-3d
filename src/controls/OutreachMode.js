import * as THREE from 'three';

/**
 * Public Outreach & Educational Story Mode (Stretch Feature)
 * Provides an interactive, step-by-step guided story tour of the Indian Ocean
 * for exhibitions, students, and non-specialist visitors with camera fly-throughs.
 */
export class OutreachMode {
  constructor(oceanScene, callbacks = {}) {
    this.oceanScene = oceanScene;
    this.callbacks = callbacks; // onStepChange, onStart, onExit
    this.active = false;
    this.currentStep = 0;
    this.autoPlayTimer = null;

    this.steps = [
      {
        title: '1. Welcome to the Indian Ocean 3D Basin',
        badge: 'Surface & Monsoons',
        text: 'The North Indian Ocean is a uniquely dynamic tropical basin driven by reversing monsoon winds (Southwest and Northeast Monsoons), fueling intense coastal currents and maritime weather patterns.',
        cameraPos: { x: 0, y: -55, z: 45 },
        targetPos: { x: 0, y: 0, z: -4 },
        state: { variable: 'temperature', depth: 0, date: '2023-08-31', colormap: 'thermal', currents: true, isosurface: false, gliders: false },
        chips: ['Surface 0m', 'Temp ~29.5°C', 'Air-Sea Heat Flux']
      },
      {
        title: '2. The Thermocline Barrier (150m)',
        badge: 'Vertical Stratification',
        text: 'Just 100 to 200 meters below the warm surface lies the Thermocline — a sharp temperature drop from 29°C down to 15°C. This barrier layer regulates heat exchange and prevents deep cyclone mixing.',
        cameraPos: { x: -25, y: -30, z: 20 },
        targetPos: { x: 0, y: 0, z: -6 },
        state: { variable: 'temperature', depth: 150, date: '2023-03-21', colormap: 'thermal', isosurface: true, currents: false, gliders: false },
        chips: ['Depth 150m', 'Gradient 4.8°C/100m', '20°C Isotherm']
      },
      {
        title: '3. 4,000+ Autonomous Argo Robotic Floats',
        badge: 'Robotic In-Situ Network',
        text: 'INCOIS and the global Argo program deploy thousands of robotic profiling floats. Each float sinks to 1,000m, drifts for 9 days, dives to 2,000m, and ascends while recording temperature and salinity soundings.',
        cameraPos: { x: 15, y: -25, z: 22 },
        targetPos: { x: 5, y: 5, z: -8 },
        state: { variable: 'salinity', depth: 200, date: '2024-09-05', colormap: 'haline', argo: true, isosurface: false, currents: false, gliders: false },
        chips: ['Argo Soundings', '0–2000m CTD', 'Satellite Uplink']
      },
      {
        title: '4. High-Resolution Autonomous Gliders',
        badge: 'Subsurface Glider Missions',
        text: 'Autonomous underwater gliders navigate continuously in 3D sawtooth undulating profiles from surface down to 1000m across the Arabian Sea and Bay of Bengal to monitor marine heatwaves and salinity fronts.',
        cameraPos: { x: 28, y: -15, z: 15 },
        targetPos: { x: 10, y: 10, z: -10 },
        state: { variable: 'temperature', depth: 500, date: '2024-08-28', colormap: 'viridis', gliders: true, isosurface: false, currents: false },
        chips: ['Glider Tracks', 'Sawtooth Dives', 'Real-Time Telemetry']
      },
      {
        title: '5. Dynamic Ocean Current Vectors',
        badge: 'Hydrodynamic Flow',
        text: 'Massive volume transport occurs along the Somali Current, West India Coastal Current, and the equatorial Wyrtki Jet, advecting heat and nutrients across the entire basin.',
        cameraPos: { x: 0, y: -45, z: 35 },
        targetPos: { x: 0, y: 0, z: -5 },
        state: { variable: 'temperature', depth: 0, date: '2024-07-31', colormap: 'thermal', currents: true, gliders: true, isosurface: false },
        chips: ['Current Vectors', 'Somali Jet', 'Wyrtki Jet']
      }
    ];

    this._createOutreachHUD();
  }

  _createOutreachHUD() {
    let hud = document.getElementById('outreach-story-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'outreach-story-hud';
      hud.className = 'outreach-hud hidden glass-panel';
      document.body.appendChild(hud);
    }
    this.hud = hud;
  }

  start() {
    this.active = true;
    this.currentStep = 0;
    document.body.classList.add('outreach-mode-active');

    // Close chatbox and collapse control panel for clean 3D viewing
    document.getElementById('ai-chat-window')?.classList.add('hidden');
    document.getElementById('sidebar')?.classList.add('collapsed');

    this.hud.classList.remove('hidden');
    if (this.callbacks.onStart) this.callbacks.onStart();
    this.showStep(0);
  }

  stop() {
    this.active = false;
    clearTimeout(this.autoPlayTimer);
    document.body.classList.remove('outreach-mode-active');
    this.hud.classList.add('hidden');

    // Uncollapse sidebar
    document.getElementById('sidebar')?.classList.remove('collapsed');

    if (this.callbacks.onExit) this.callbacks.onExit();
  }

  showStep(idx) {
    if (idx < 0 || idx >= this.steps.length) return;
    this.currentStep = idx;
    const step = this.steps[idx];

    // Update HUD Content
    const chipsHtml = step.chips.map(c => `<span class="outreach-chip">${c}</span>`).join('');
    this.hud.innerHTML = `
      <div class="outreach-hud-header">
        <div class="outreach-badge">🎓 Educational Story Tour &middot; Step ${idx + 1}/${this.steps.length}</div>
        <button id="outreach-close-btn" class="icon-btn small" title="Exit Tour">✕</button>
      </div>
      <div class="outreach-title">${step.title}</div>
      <div class="outreach-text">${step.text}</div>
      <div class="outreach-chips-row">${chipsHtml}</div>
      <div class="outreach-nav-row">
        <button id="outreach-prev-btn" class="outreach-btn" ${idx === 0 ? 'disabled' : ''}>⬅ Prev</button>
        <button id="outreach-auto-btn" class="outreach-btn play-btn">${this.autoPlayTimer ? '⏸ Pause' : '▶ Auto-Play'}</button>
        <button id="outreach-next-btn" class="outreach-btn primary">${idx === this.steps.length - 1 ? 'Finish ✔' : 'Next ➡'}</button>
      </div>
    `;

    // Wire buttons
    document.getElementById('outreach-close-btn')?.addEventListener('click', () => this.stop());
    document.getElementById('outreach-prev-btn')?.addEventListener('click', () => this.showStep(this.currentStep - 1));
    document.getElementById('outreach-next-btn')?.addEventListener('click', () => {
      if (this.currentStep < this.steps.length - 1) {
        this.showStep(this.currentStep + 1);
      } else {
        this.stop();
      }
    });
    document.getElementById('outreach-auto-btn')?.addEventListener('click', () => this.toggleAutoPlay());

    // Fly camera smoothly
    this._flyCameraTo(step.cameraPos, step.targetPos);

    // Trigger state changes
    if (this.callbacks.onStepChange) {
      this.callbacks.onStepChange(step.state);
    }
  }

  toggleAutoPlay() {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
      const btn = document.getElementById('outreach-auto-btn');
      if (btn) btn.textContent = '▶ Auto-Play';
    } else {
      const btn = document.getElementById('outreach-auto-btn');
      if (btn) btn.textContent = '⏸ Pause';
      this._scheduleNextStep();
    }
  }

  _scheduleNextStep() {
    clearTimeout(this.autoPlayTimer);
    this.autoPlayTimer = setTimeout(() => {
      if (!this.active) return;
      if (this.currentStep < this.steps.length - 1) {
        this.showStep(this.currentStep + 1);
        this._scheduleNextStep();
      } else {
        this.stop();
      }
    }, 8000);
  }

  _flyCameraTo(camPos, targetPos) {
    if (!this.oceanScene || !this.oceanScene.camera || !this.oceanScene.controls) return;
    const camera = this.oceanScene.camera;
    const controls = this.oceanScene.controls;

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPos = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
    const endTarget = new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);

    const duration = 1200;
    const startTime = performance.now();

    function animateCam() {
      const now = performance.now();
      const progress = Math.min(1.0, (now - startTime) / duration);
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      camera.position.lerpVectors(startPos, endPos, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      controls.update();

      if (progress < 1.0) {
        requestAnimationFrame(animateCam);
      }
    }

    requestAnimationFrame(animateCam);
  }
}
