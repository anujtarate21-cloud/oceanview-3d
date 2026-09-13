/**
 * ControlPanel.js — Central UI Controls & Keyboard Interactions
 * Emits custom events to document for DEV-A's 3D engine:
 *   depth-change     { depth, index }
 *   variable-change   { variable }
 *   colormap-change   { colormap }
 *   opacity-change    { opacity }        // 0-1
 *   exag-change       { exaggeration }
 *   layer-toggle      { layer, visible }
 *   time-change       { timestep }
 *   time-play-toggle  { playing }
 *   outreach-toggle   { simplified }
 */
export class ControlPanel {
  constructor() {
    this.depthLevels = [0, 10, 25, 50, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000, 5000];
    this.timesteps = [0, 1, 2];
    this.timestamps = ["2024-09-05", "2024-09-06", "2024-09-07"];
    this.units = { temperature: '°C', salinity: 'PSU' };
    this.isPlaying = false;

    this.els = {
      variable: document.getElementById('variable-select'),
      varUnitBadge: document.getElementById('var-unit-badge'),
      depthSlider: document.getElementById('depth-slider'),
      depthReadout: document.getElementById('depth-readout'),
      depthTicks: document.getElementById('depth-slider-ticks'),
      presetChips: document.querySelectorAll('.preset-chip'),
      colormap: document.getElementById('colormap-select'),
      opacity: document.getElementById('opacity-slider'),
      opacityReadout: document.getElementById('opacity-readout'),
      exag: document.getElementById('exag-slider'),
      exagReadout: document.getElementById('exag-readout'),
      timeSlider: document.getElementById('time-slider'),
      timeReadout: document.getElementById('time-readout'),
      playBtn: document.getElementById('play-btn'),
      currentsMode: document.getElementById('currents-mode-select'),
      toggleCoastline: document.getElementById('toggle-coastline'),
      toggleArgo: document.getElementById('toggle-argo'),
      sidebar: document.getElementById('sidebar'),
      toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),
      outreachBtn: document.getElementById('outreach-toggle-btn'),
      outreachBanner: document.getElementById('outreach-banner'),
      shortcutsBtn: document.getElementById('shortcuts-btn'),
      shortcutsModal: document.getElementById('shortcuts-modal'),
      closeShortcutsBtn: document.getElementById('close-shortcuts-btn'),
      tourBtns: document.querySelectorAll('.tour-btn'),
      factorOceanPill: document.getElementById('factor-ocean-pill'),
      factorOpticsPill: document.getElementById('factor-optics-pill'),
      factorDatePill: document.getElementById('factor-date-pill'),
    };

    this._bindEvents();
  }

  /** Call once metadata.json is loaded so sliders reflect real depth levels & timesteps */
  applyMetadata({ depth_levels = [0], timesteps = [0], timestamps = [], variables, units = {} } = {}) {
    this.depthLevels = depth_levels;
    this.timesteps = timesteps;
    this.timestamps = timestamps.length ? timestamps : timesteps.map((t) => `t${t}`);
    this.units = units;

    if (this.els.depthSlider) {
      this.els.depthSlider.min = 0;
      this.els.depthSlider.max = Math.max(0, depth_levels.length - 1);
      this.els.depthSlider.value = 0;
    }
    this._renderDepthTicks();
    this._updateDepthReadout();

    if (this.els.timeSlider) {
      this.els.timeSlider.min = 0;
      this.els.timeSlider.max = Math.max(0, timesteps.length - 1);
      this.els.timeSlider.value = 0;
    }
    document.getElementById('time-section')?.classList.toggle('hidden', timesteps.length <= 1);
    this._updateTimeReadout();

    if (this.els.variable) {
      const defaultVars = ['temperature', 'salinity', 'chlorophyll', 'currents'];
      const combinedVars = Array.isArray(variables) && variables.length
        ? Array.from(new Set([...variables, ...defaultVars]))
        : defaultVars;
      const previous = this.els.variable.value || 'temperature';
      const selected = combinedVars.includes(previous) ? previous : 'temperature';
      const labels = {
        temperature: 'Temperature (°C)',
        salinity: 'Salinity (PSU)',
        chlorophyll: 'Chlorophyll-a (mg/m³)',
        currents: 'Current Velocity (m/s)'
      };
      this.els.variable.innerHTML = combinedVars
        .map((v) => {
          const label = labels[v] || `${v.charAt(0).toUpperCase() + v.slice(1)} (${this._unitFor(v)})`;
          return `<option value="${v}">${label}</option>`;
        })
        .join('');
      this.els.variable.value = selected;
      this._syncVariableBadge(selected);
    }
  }

  _unitFor(variable) {
    const key = String(variable || '').toLowerCase();
    if (this.units && this.units[key]) return this.units[key];
    if (key === 'salinity') return 'PSU';
    if (key === 'chlorophyll') return 'mg/m³';
    if (key === 'currents') return 'm/s';
    return '°C';
  }

  _syncVariableBadge(variable) {
    if (this.els.varUnitBadge) {
      this.els.varUnitBadge.textContent = this._unitFor(variable);
    }
    this._syncOceanPill();
  }

  _syncOceanPill() {
    if (this.els.factorOceanPill && this.els.depthSlider) {
      const idx = Number(this.els.depthSlider.value);
      const depth = Math.round(this.depthLevels[idx] ?? 0);
      const raw = this.els.variable?.value || 'temperature';
      const labels = { temperature: 'Temp', salinity: 'Sal', chlorophyll: 'Chl-a', currents: 'Currents' };
      const shortVar = labels[raw] || raw;
      this.els.factorOceanPill.textContent = `${depth}m · ${shortVar}`;
    }
  }

  _syncOverlaysPill() {
    const pill = document.getElementById('factor-overlays-pill');
    if (!pill) return;
    const chks = document.querySelectorAll('.overlay-checkbox');
    if (!chks.length) return;
    const checked = Array.from(chks).filter((c) => c.checked).length;
    pill.textContent = `${checked}/${chks.length} Active`;
  }

  _setVariable(variable) {
    if (!this.els.variable) return;
    this.els.variable.value = variable;
    this.els.variable.dispatchEvent(new Event('change'));
  }

  _renderDepthTicks() {
    const first = Math.round(this.depthLevels[0]);
    const last = Math.round(this.depthLevels[this.depthLevels.length - 1]);
    if (this.els.depthTicks) {
      this.els.depthTicks.innerHTML = `<span>${first}m</span><span>${last}m</span>`;
    }
  }

  _updateDepthReadout() {
    const idx = Number(this.els.depthSlider.value);
    const depth = Math.round(this.depthLevels[idx] ?? 0);
    if (this.els.depthReadout) {
      this.els.depthReadout.textContent = `${depth} m`;
    }
    this._syncOceanPill();
    const activeSlice = document.getElementById('status-active-slice');
    if (activeSlice) {
      const raw = this.els.variable?.value || 'temperature';
      const labels = { temperature: 'Temp', salinity: 'Salinity', chlorophyll: 'Chl-a' };
      const varName = labels[raw] || raw.charAt(0).toUpperCase() + raw.slice(1);
      activeSlice.textContent = `Slice: ${varName} @ ${depth}m`;
    }
    // Update active preset chip
    this.els.presetChips.forEach((chip) => {
      const pDepth = Number(chip.dataset.depth);
      chip.classList.toggle('active', Math.abs(pDepth - depth) < 20);
    });
    return depth;
  }

  _updateTimeReadout() {
    const t = Number(this.els.timeSlider.value);
    let dateStr = this.timestamps[t] || `t${t}`;
    if (dateStr.includes('T')) {
      dateStr = dateStr.split('T')[0];
    }
    if (this.els.timeReadout) {
      this.els.timeReadout.textContent = `${dateStr} (t${t})`;
    }
    if (this.els.factorDatePill) {
      this.els.factorDatePill.textContent = `${dateStr}`;
    }
    return t;
  }

  setDepth(depthMeters) {
    const target = Number(depthMeters);
    let closestIdx = 0;
    let minDiff = Infinity;
    this.depthLevels.forEach((d, i) => {
      const diff = Math.abs(d - target);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    });
    this.els.depthSlider.value = closestIdx;
    const depth = this._updateDepthReadout();
    this._emit('depth-change', { depth, index: closestIdx });
  }

  _emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  _bindEvents() {
    // Scale toggle buttons (Linear vs Logarithmic)
    const btnLinear = document.getElementById('scale-linear-btn');
    const btnLog = document.getElementById('scale-log-btn');
    const scaleToggleRow = document.getElementById('scale-toggle-row');

    const setScaleUI = (scale) => {
      const isLog = scale === 'log';
      if (btnLinear) btnLinear.classList.toggle('active', !isLog);
      if (btnLog) btnLog.classList.toggle('active', isLog);
      this._emit('scale-change', { scale: isLog ? 'log' : 'linear', isLogScale: isLog });
    };

    btnLinear?.addEventListener('click', () => setScaleUI('linear'));
    btnLog?.addEventListener('click', () => setScaleUI('log'));

    // Variable change
    this.els.variable?.addEventListener('change', (e) => {
      const val = e.target.value;
      const isChlorophyll = val === 'chlorophyll';

      // Show scale toggle exclusively for chlorophyll — auto-hide and reset for all others
      if (scaleToggleRow) scaleToggleRow.style.display = isChlorophyll ? 'flex' : 'none';

      if (isChlorophyll) {
        setScaleUI('log');   // chlorophyll → default log scale
      } else {
        setScaleUI('linear'); // all others → reset to linear before hiding
      }

      this._syncVariableBadge(val);
      this._updateDepthReadout();
      this._emit('variable-change', { variable: val });
    });

    // Depth slider
    this.els.depthSlider.addEventListener('input', (e) => {
      const depth = this._updateDepthReadout();
      this._emit('depth-change', { depth, index: Number(e.target.value) });
    });

    // Preset depth chips
    this.els.presetChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        this.setDepth(Number(chip.dataset.depth));
      });
    });

    // Colormap
    this.els.colormap.addEventListener('change', (e) => {
      if (this.els.factorOpticsPill) {
        const name = e.target.value.charAt(0).toUpperCase() + e.target.value.slice(1);
        this.els.factorOpticsPill.textContent = name;
      }
      this._emit('colormap-change', { colormap: e.target.value });
    });

    // Opacity
    this.els.opacity.addEventListener('input', (e) => {
      const pct = Number(e.target.value);
      this.els.opacityReadout.textContent = `${pct}%`;
      this._emit('opacity-change', { opacity: pct / 100 });
    });

    // Exaggeration
    this.els.exag.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.els.exagReadout.textContent = `${val}×`;
      this._emit('exag-change', { exaggeration: val });
    });

    // Time slider
    this.els.timeSlider.addEventListener('input', () => {
      const t = this._updateTimeReadout();
      this._emit('time-change', { timestep: t });
    });

    // Play/pause
    this.els.playBtn.addEventListener('click', () => this._togglePlay());

    // 3D Currents mode dropdown (Animated Flow Lines / Off)
    if (this.els.currentsMode) {
      this.els.currentsMode.addEventListener('change', (e) => {
        const mode = e.target.value; // 'flow' | 'off'
        this._emit('currents-mode-change', { mode });
      });
    }

    // Layer toggles with space-optimized row active feedback
    const overlayToggles = [
      { id: 'toggle-coastline', layer: 'coastline' },
      { id: 'toggle-argo', layer: 'argo' },
      { id: 'toggle-currents', layer: 'currents' },
      { id: 'toggle-isosurface', layer: 'isosurface' },
      { id: 'toggle-gliders', layer: 'gliders' },
    ];

    overlayToggles.forEach(({ id, layer }) => {
      const chk = document.getElementById(id);
      if (chk) {
        chk.addEventListener('change', (e) => {
          const row = chk.closest('.overlay-row');
          if (row) row.classList.toggle('active', chk.checked);
          this._syncOverlaysPill();
          this._emit('layer-toggle', { layer, visible: e.target.checked });
        });
      }
    });
    this._syncOverlaysPill();

    document.getElementById('start-outreach-btn')?.addEventListener('click', () => {
      this._emit('start-outreach-tour', {});
    });

    // Sidebar toggle
    this.els.toggleSidebarBtn?.addEventListener('click', () => {
      this.els.sidebar.classList.toggle('collapsed');
    });

    // Accordion Expand / Collapse All Toggle
    const accordionToggleBtn = document.getElementById('sidebar-accordion-toggle-btn');
    const getFactors = () => Array.from(this.els.sidebar?.querySelectorAll('.factor-group:not([hidden])') || []);

    const updateAccordionToggleIcon = () => {
      if (!accordionToggleBtn) return;
      const factors = getFactors();
      const anyOpen = factors.some((f) => f.open);
      accordionToggleBtn.textContent = anyOpen ? '⊟' : '⊞';
      accordionToggleBtn.title = anyOpen ? 'Collapse All Sections (Shift + A)' : 'Expand All Sections (Shift + A)';
    };

    accordionToggleBtn?.addEventListener('click', () => {
      const factors = getFactors();
      const anyOpen = factors.some((f) => f.open);
      factors.forEach((f) => { f.open = !anyOpen; });
      updateAccordionToggleIcon();
    });

    this.els.sidebar?.querySelectorAll('.factor-group').forEach((f) => {
      f.addEventListener('toggle', () => updateAccordionToggleIcon());
    });

    // Outreach toggle — outreach-banner is now a <details> element so use hidden attribute
    this.els.outreachBtn?.addEventListener('click', () => {
      document.body.classList.toggle('outreach-mode');
      const simplified = document.body.classList.contains('outreach-mode');
      this.els.sidebar.classList.toggle('outreach-simplified', simplified);
      if (this.els.outreachBanner) {
        this.els.outreachBanner.hidden = !simplified;
        if (simplified) {
          this.els.outreachBanner.open = true;
        }
      }
      updateAccordionToggleIcon();
      this._emit('outreach-toggle', { simplified });
    });

    // Outreach tours
    this.els.tourBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tour = btn.dataset.tour;
        if (tour === 'surface') {
          this._setVariable('temperature');
          this.setDepth(0);
        } else if (tour === 'thermocline') {
          this._setVariable('temperature');
          this.setDepth(150);
        } else if (tour === 'abyssal') {
          this._setVariable('salinity');
          this.setDepth(3000);
        }
      });
    });

    // Shortcuts Modal
    this.els.shortcutsBtn?.addEventListener('click', () => {
      this.els.shortcutsModal?.classList.remove('hidden');
    });
    this.els.closeShortcutsBtn?.addEventListener('click', () => {
      this.els.shortcutsModal?.classList.add('hidden');
    });
    this.els.shortcutsModal?.addEventListener('click', (e) => {
      if (e.target === this.els.shortcutsModal) {
        this.els.shortcutsModal.classList.add('hidden');
      }
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (this._isTyping(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this._togglePlay();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this._stepDepth(-1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this._stepDepth(1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.stepTime();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this._stepTimePrev();
      } else if (e.key === 't' || e.key === 'T') {
        this._setVariable('temperature');
      } else if (e.key === 's' || e.key === 'S') {
        this._setVariable('salinity');
      } else if (e.key === 'o' || e.key === 'O') {
        this.els.outreachBtn?.click();
      } else if (e.key === 'h' || e.key === 'H') {
        this.els.toggleSidebarBtn?.click();
      } else if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        document.getElementById('sidebar-accordion-toggle-btn')?.click();
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        this.els.shortcutsModal?.classList.toggle('hidden');
      } else if (e.key === 'Escape') {
        this.els.shortcutsModal?.classList.add('hidden');
      }
    });
  }

  _stepDepth(delta) {
    const max = Number(this.els.depthSlider.max);
    let next = Number(this.els.depthSlider.value) + delta;
    if (next < 0) next = 0;
    if (next > max) next = max;
    this.els.depthSlider.value = next;
    const depth = this._updateDepthReadout();
    this._emit('depth-change', { depth, index: next });
  }

  _stepTimePrev() {
    const max = Number(this.els.timeSlider.max);
    let next = Number(this.els.timeSlider.value) - 1;
    if (next < 0) next = max;
    this.els.timeSlider.value = next;
    const t = this._updateTimeReadout();
    this._emit('time-change', { timestep: t });
  }

  _togglePlay() {
    this.isPlaying = !this.isPlaying;
    this.els.playBtn.textContent = this.isPlaying ? '⏸' : '▶';
    this._emit('time-play-toggle', { playing: this.isPlaying });
  }

  _isTyping(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
  }

  stepTime() {
    const max = Number(this.els.timeSlider.max);
    let next = Number(this.els.timeSlider.value) + 1;
    if (next > max) next = 0;
    this.els.timeSlider.value = next;
    const t = this._updateTimeReadout();
    this._emit('time-change', { timestep: t });
  }
}

