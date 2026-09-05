import { OceanScene } from './scene/OceanScene.js';
import { VolumeRenderer } from './scene/VolumeRenderer.js';
import { CoastlineLayer } from './scene/CoastlineLayer.js';
import { WaterColumnCage } from './scene/WaterColumnCage.js';
import { DepthSlicer } from './scene/DepthSlicer.js';
import { CurrentVectors } from './scene/CurrentVectors.js';
import { ThermoclineIsosurface } from './scene/ThermoclineIsosurface.js';
import { GliderTracks } from './instruments/GliderTracks.js';
import { ArgoMarkers } from './instruments/ArgoMarkers.js';
import { ArgoInteraction } from './instruments/ArgoInteraction.js';
import { ControlPanel } from './controls/ControlPanel.js';
import { ColormapEditor } from './controls/ColormapEditor.js';
import { TimeAnimator } from './controls/TimeAnimator.js';
import { Legend } from './controls/Legend.js';
import { AIChatAssistant } from './controls/AIChatAssistant.js';
import { ThemeManager } from './controls/ThemeManager.js';
import { OutreachMode } from './controls/OutreachMode.js';
import { PipelineManager } from './controls/PipelineManager.js';
import { ProfileChart } from './charts/ProfileChart.js';
import { PLAY_INTERVAL_MS, DEPTH_DEBOUNCE_MS } from './utils/constants.js';
import {
  loadMetadata,
  loadModelData,
  loadArgoPositions,
  loadArgoProfile,
  loadCoastline,
  detectBackend,
  generateSyntheticTile,
  generateSyntheticArgoPositions,
  generateSyntheticProfile,
} from './utils/dataLoader.js';

const state = {
  variable: 'temperature',
  depthIndex: 0,
  depth: 0,
  timestep: 2,
  date: '2023-03-21',
  colormap: 'viridis',
  usingSyntheticData: false,
};

async function bootstrap() {
  const canvas = document.getElementById('ocean-canvas');

  // Ping FastAPI backend with 800ms timeout — if it's down, all loads go directly to static /public/data/
  const backendUp = await detectBackend();

  const oceanScene = new OceanScene(canvas);
  const waterColumnCage = new WaterColumnCage(oceanScene.scene);
  const volumeRenderer = new VolumeRenderer(oceanScene.scene, state.colormap);
  const depthSlicer = new DepthSlicer(volumeRenderer);
  const coastline = new CoastlineLayer(oceanScene.scene);
  const currentVectors = new CurrentVectors(oceanScene.scene);
  const thermoclineIsosurface = new ThermoclineIsosurface(oceanScene.scene);
  const gliderTracks = new GliderTracks(oceanScene.scene);
  const argoMarkers = new ArgoMarkers(oceanScene.scene);
  const argoInteraction = new ArgoInteraction(canvas, oceanScene.camera, argoMarkers, {
    tooltip: document.getElementById('argo-tooltip'),
    coordsEl: document.getElementById('status-coords'),
  });

  const controlPanel = new ControlPanel();
  const colorbar = new ColormapEditor();
  const legend = new Legend('#top-left-legend #legend-container');
  const themeManager = new ThemeManager({ oceanScene });
  const aiAssistant = new AIChatAssistant({
    getState: () => ({ variable: state.variable, depth: state.depth, timestep: state.timestep, date: state.date }),
    themeManager,
  });
  const timeAnimator = new TimeAnimator({ totalSteps: 3, intervalMs: PLAY_INTERVAL_MS });

  const outreachMode = new OutreachMode(oceanScene, {
    onStepChange: (stepState) => {
      if (stepState.date && window.pipelineManager) {
        window.pipelineManager.requestDate(stepState.date);
      }
      if (stepState.variable) {
        state.variable = stepState.variable;
        document.dispatchEvent(new CustomEvent('variable-change', { detail: { variable: stepState.variable } }));
      }
      if (stepState.depth !== undefined) {
        controlPanel.setDepth(stepState.depth);
      }
      if (stepState.currents !== undefined) {
        currentVectors.setVisible(stepState.currents);
        const chk = document.getElementById('toggle-currents');
        if (chk) chk.checked = stepState.currents;
      }
      if (stepState.isosurface !== undefined) {
        thermoclineIsosurface.setVisible(stepState.isosurface);
        const chk = document.getElementById('toggle-isosurface');
        if (chk) chk.checked = stepState.isosurface;
      }
      if (stepState.gliders !== undefined) {
        gliderTracks.setVisible(stepState.gliders);
        const chk = document.getElementById('toggle-gliders');
        if (chk) chk.checked = stepState.gliders;
      }
      if (stepState.argo !== undefined) {
        argoMarkers.setVisible(stepState.argo);
        const chk = document.getElementById('toggle-argo');
        if (chk) chk.checked = stepState.argo;
      }
    }
  });

  const profileChart = new ProfileChart({
    fetchProfile: async (floatId) => {
      const data = await loadArgoProfile(floatId);
      if (data) return data;
      // Look up position from proxy markers array
      const proxy = argoMarkers.markers.find((m) => m.userData.float_id === floatId || m.userData.id === floatId);
      const lat = proxy?.userData.lat ?? 10;
      const lon = proxy?.userData.lon ?? 75;
      return generateSyntheticProfile(floatId, lat, lon);
    },
  });

  // --- Metadata ---
  let metadata = await loadMetadata();
  if (!metadata) {
    state.usingSyntheticData = true;
    metadata = {
      variables: ['temperature', 'salinity', 'chlorophyll', 'currents'],
      depth_levels: [0, 10, 20, 50, 100, 200, 500, 1000, 1500, 2000],
      timesteps: [0, 1, 2],
      timestamps: ['2024-09-05', '2024-09-06', '2024-09-07'],
      extent: { lat_min: 0, lat_max: 25, lon_min: 60, lon_max: 95 },
    };
  }
  depthSlicer.setAvailableDepths(metadata.depth_levels);
  controlPanel.applyMetadata(metadata);
  if (controlPanel.els.variable?.value) {
    state.variable = controlPanel.els.variable.value;
  }
  state.depth = metadata.depth_levels[0];

  // Wire TimeAnimator to its DOM elements and sync timestep metadata
  timeAnimator.applyMetadata(metadata.timesteps?.length ?? 1, metadata.timestamps ?? []);
  timeAnimator.attach(
    document.getElementById('time-slider'),
    document.getElementById('play-btn'),
    document.getElementById('time-readout'),
    metadata.timestamps ?? [],
  );

  // --- Data Load ---
  async function fetchTile(variable, depth, timestep, date = state.date) {
    const tile = await loadModelData(variable, depth, timestep, date);
    return tile || generateSyntheticTile(variable, depth);
  }

  const busyIndicator = document.getElementById('tile-busy-indicator');
  let busyTimer = null;

  function drawColorbarWithTile(tile) {
    if (!tile) return;
    const varName = String(tile.variable || state.variable).toLowerCase();
    let min, max;
    if (varName === 'salinity') {
      const sliceMin = tile.slice_min !== undefined ? tile.slice_min : (tile.min !== undefined ? tile.min : 33.0);
      const sliceMax = tile.slice_max !== undefined ? tile.slice_max : (tile.max !== undefined ? tile.max : 36.5);
      min = Math.max(32.5, Math.min(sliceMin, 34.0));
      max = Math.min(36.8, Math.max(sliceMax, 35.8));
    } else if (varName === 'chlorophyll') {
      min = tile.slice_min !== undefined ? tile.slice_min : (tile.min !== undefined ? tile.min : 0.02);
      max = tile.slice_max !== undefined ? Math.min(tile.slice_max, 4.0) : (tile.max !== undefined ? Math.min(tile.max, 4.0) : 2.5);
    } else if (varName === 'currents') {
      min = 0.0;
      max = tile.slice_max !== undefined ? Math.max(tile.slice_max, 0.6) : (tile.max !== undefined ? Math.max(tile.max, 0.6) : 1.2);
    } else {
      min = tile.global_min !== undefined ? tile.global_min : (tile.min !== undefined ? tile.min : (tile.slice_min !== undefined ? tile.slice_min : 2.0));
      max = tile.global_max !== undefined ? tile.global_max : (tile.max !== undefined ? tile.max : (tile.slice_max !== undefined ? tile.slice_max : 31.5));
    }
    colorbar.draw(min, max, tile.units);
    legend.update({ variable: state.variable, units: tile.units || '°C', min, max, colormap: state.colormap });
    const badge = document.getElementById('legend-active-var-badge');
    if (badge) badge.textContent = `${state.variable.toUpperCase()} (${tile.units || '°C'})`;
  }

  async function refreshVolume() {
    clearTimeout(busyTimer);
    if (busyIndicator) busyTimer = setTimeout(() => busyIndicator.classList.add('visible'), 120);

    const tile = await fetchTile(state.variable, state.depth, state.timestep, state.date);

    clearTimeout(busyTimer);
    if (busyIndicator) busyIndicator.classList.remove('visible');

    volumeRenderer.loadDepthSlice(tile);
    colorbar.setColormap(state.colormap);
    drawColorbarWithTile(tile);
  }

  const initialTile = await fetchTile(state.variable, state.depth, state.timestep, state.date);
  volumeRenderer.loadDepthSlice(initialTile);
  colorbar.setColormap(state.colormap);
  drawColorbarWithTile(initialTile);

  const positions = (await loadArgoPositions(state.timestep, state.date)) || generateSyntheticArgoPositions();
  await argoMarkers.load(positions);

  // Guards against overlapping requests if the user drags the timestep slider
  // quickly — only the most recently requested load is allowed to apply.
  let argoLoadToken = 0;
  async function refreshArgoMarkers() {
    const token = ++argoLoadToken;
    const nextPositions = (await loadArgoPositions(state.timestep, state.date)) || generateSyntheticArgoPositions();
    if (token !== argoLoadToken) return; // superseded by a newer timestep change
    await argoMarkers.load(nextPositions);
    if (token !== argoLoadToken) return;
    argoMarkers.setVisible(controlPanel.els.toggleArgo?.checked ?? true);
  }

  const geojson = await loadCoastline();
  if (geojson) await coastline.load(geojson);

  // -- Pipeline Manager (v2): on-demand HYCOM date navigation ----------------
  // Dynamic date-to-slider mapping: updated whenever available dates change
  let allDates = metadata.timestamps?.map(ts => ts.slice(0, 10)) || ['2024-09-05', '2024-09-06', '2024-09-07'];

  function syncSliderWithDates(dates) {
    if (!dates || dates.length === 0) {
      allDates = [];
      timeAnimator.applyMetadata(0, []);
      const slider = document.getElementById('time-slider');
      if (slider) {
        slider.min = 0;
        slider.max = 0;
        slider.value = 0;
      }
      const readout = document.getElementById('time-readout');
      if (readout) {
        readout.textContent = state.date ? `${state.date} (Active)` : 'No Cached Timesteps';
      }
      return;
    }
    allDates = [...new Set(dates)].sort();
    timeAnimator.applyMetadata(allDates.length, allDates);
    const idx = allDates.indexOf(state.date);
    if (idx >= 0) {
      state.timestep = idx;
      // Update slider UI directly without dispatching time-change event
      const slider = document.getElementById('time-slider');
      if (slider) slider.value = idx;
      const readout = document.getElementById('time-readout');
      if (readout) {
        const label = allDates[idx] || `T${idx}`;
        readout.textContent = `${label} (T${idx + 1}/${allDates.length})`;
      }
    } else {
      const slider = document.getElementById('time-slider');
      if (slider) slider.value = 0;
      const readout = document.getElementById('time-readout');
      if (readout) {
        readout.textContent = state.date ? `${state.date} (Active)` : `${allDates[0]} (T1/${allDates.length})`;
      }
    }
  }

  function updateSliceStatus() {
    const sliceEl = document.getElementById('status-active-slice');
    if (sliceEl) {
      const varPretty = state.variable.charAt(0).toUpperCase() + state.variable.slice(1);
      sliceEl.textContent = `Slice: ${varPretty} @ ${state.depth}m · Date: ${state.date || 'Active'}`;
    }
    const badge = document.getElementById('legend-active-var-badge');
    if (badge) {
      badge.textContent = `${state.variable.toUpperCase()} · ${state.date || 'Active'}`;
    }
  }

  let _applyingDate = false;

  async function applyDate(dateStr) {
    if (!dateStr) return;
    if (_applyingDate) return;          // re-entry guard
    _applyingDate = true;

    try {
      state.date = dateStr;

      // 1. Sync the date-input field (chips are already rendered by PipelineManager)
      const dateInput = document.getElementById('pipeline-date-input');
      if (dateInput) dateInput.value = dateStr;

      // 2. Sync timeline slider WITHOUT triggering time-change event
      const idx = allDates.indexOf(dateStr);
      if (idx >= 0) {
        state.timestep = idx;
        // Update slider and readout UI directly — do NOT call jumpTo
        // because jumpTo dispatches time-change which loops back here
        const slider = document.getElementById('time-slider');
        if (slider) slider.value = idx;
        const readout = document.getElementById('time-readout');
        if (readout) {
          let label = allDates[idx] || `T${idx}`;
          readout.textContent = `${label} (T${idx + 1}/${allDates.length})`;
        }
      }

      // 3. Update 3D Volume slice & In-situ Argo profiling floats
      await Promise.all([refreshVolume(), refreshArgoMarkers()]);

      // 4. Connect 3D Current Vectors to active date & depth
      if (currentVectors && currentVectors.updateForDate) {
        currentVectors.updateForDate(dateStr, state.depth);
      }

      // 5. Connect 3D Thermocline Isosurface to active date
      if (thermoclineIsosurface && thermoclineIsosurface.updateForDate) {
        thermoclineIsosurface.updateForDate(dateStr);
      }

      // 6. Connect 3D Glider Tracks to active date
      if (gliderTracks && gliderTracks.updateForDate) {
        gliderTracks.updateForDate(dateStr);
      }

      // 7. Connect AI Assistant to active date
      if (aiAssistant && aiAssistant.setDate) {
        aiAssistant.setDate(dateStr);
      }

      // 8. Update status strip and active slice readout
      updateSliceStatus();

    } finally {
      _applyingDate = false;
    }
  }

  const pipelineManager = new PipelineManager({
    onDateReady: async (dateStr) => {
      // Sync slider dates if the list grew (new date was fetched)
      if (pipelineManager.availableDates.length > 0) {
        syncSliderWithDates(pipelineManager.availableDates);
      }
      await applyDate(dateStr);
    },
    onDatesChanged: (dates) => {
      syncSliderWithDates(dates);
    },
    onError: (msg) => {
      console.error('[Pipeline] Error:', msg);
    }
  });
  window.pipelineManager = pipelineManager;
  document.addEventListener('cached-dates-changed', (e) => {
    if (e.detail && Array.isArray(e.detail.dates)) {
      syncSliderWithDates(e.detail.dates);
    }
  });

  window.timeAnimator = timeAnimator;
  await pipelineManager.init();
  // After init, sync slider to all available dates from backend
  if (pipelineManager.availableDates.length > 0) {
    syncSliderWithDates(pipelineManager.availableDates);
  }
  // Initialize all connected layers with initial date
  if (currentVectors.updateForDate) currentVectors.updateForDate(state.date, state.depth);
  if (thermoclineIsosurface.updateForDate) thermoclineIsosurface.updateForDate(state.date);
  if (gliderTracks.updateForDate) gliderTracks.updateForDate(state.date);
  if (aiAssistant.setDate) aiAssistant.setDate(state.date);
  updateSliceStatus();

  // Hide loading screen once ready
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.classList.add('hidden');

  if (window.innerWidth <= 480) {
    document.getElementById('sidebar')?.classList.add('collapsed');
  }

  if (state.usingSyntheticData) {
    const hint = document.getElementById('status-hint');
    if (hint) hint.textContent = "Demo mode — synthetic data only. Real HYCOM/Argo tiles not found.";
  }

  // Show data source mode in status strip
  const hint = document.getElementById('status-hint');
  if (hint) {
    if (backendUp) {
      hint.textContent = '🟢 FastAPI connected — serving live HYCOM tiles · Click any Argo float for profile';
    } else {
      hint.textContent = '🟡 Static mode — reading pre-processed JSON tiles · Click any Argo float for profile';
    }
  }

  // Debounce helper — prevents tile fetch spam while dragging sliders
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // --- Controls Event Listeners ---
  // Track whether the user has manually selected a colormap
  let userManualColormap = false;

  document.addEventListener('variable-change', async (e) => {
    state.variable = e.detail.variable;
    // Auto-suggest a specialized colormap ONLY if user hasn't manually picked one
    if (!userManualColormap) {
      const autoMap = { temperature: 'thermal', salinity: 'haline', chlorophyll: 'viridis', currents: 'jet' };
      const suggested = autoMap[state.variable] || 'viridis';
      state.colormap = suggested;
      if (controlPanel.els.colormap) controlPanel.els.colormap.value = suggested;
    }
    volumeRenderer.setColormap(state.colormap);
    colorbar.setColormap(state.colormap);
    updateSliceStatus();
    await refreshVolume();
  });

  // Debounce depth changes — wait DEPTH_DEBOUNCE_MS after user stops dragging before fetching tile
  const debouncedRefreshVolume = debounce(async () => await refreshVolume(), DEPTH_DEBOUNCE_MS);
  document.addEventListener('depth-change', (e) => {
    state.depth = e.detail.depth;
    if (currentVectors && currentVectors.updateForDate) {
      currentVectors.updateForDate(state.date, state.depth);
    }
    updateSliceStatus();
    debouncedRefreshVolume();
  });

  document.addEventListener('time-change', async (e) => {
    state.timestep = e.detail.timestep;
    if (allDates[state.timestep]) {
      const targetDate = allDates[state.timestep];
      // Avoid re-entry: applyDate already has a guard, safe to call
      state.date = targetDate;
      const dateInput = document.getElementById('pipeline-date-input');
      if (dateInput) dateInput.value = targetDate;
      if (pipelineManager) {
        pipelineManager.currentDate = targetDate;
        pipelineManager._renderDateChips();
      }
      await applyDate(targetDate);
    } else {
      await Promise.all([refreshVolume(), refreshArgoMarkers()]);
      updateSliceStatus();
    }
  });

  document.addEventListener('colormap-change', (e) => {
    userManualColormap = true;
    state.colormap = e.detail.colormap;
    volumeRenderer.setColormap(state.colormap);
    colorbar.setColormap(state.colormap);
    legend.setColormap(state.colormap);
    // Fast color-only update — reuses existing geometry, just recomputes vertex colors
    if (volumeRenderer.lastTile) {
      volumeRenderer.updateColors();
      drawColorbarWithTile(volumeRenderer.lastTile);
    }
  });

  document.addEventListener('opacity-change', (e) => volumeRenderer.setOpacity(e.detail.opacity));
  document.addEventListener('exag-change', (e) => {
    const ex = e.detail.exaggeration;
    volumeRenderer.setExaggeration(ex);
    waterColumnCage.setExaggeration(ex);
    currentVectors.setExaggeration(ex);
    thermoclineIsosurface.setExaggeration(ex);
    gliderTracks.setExaggeration(ex);
    argoMarkers.setExaggeration(ex);
  });

  document.addEventListener('layer-toggle', (e) => {
    const { layer, visible } = e.detail;
    if (layer === 'coastline') coastline.setVisible(visible);
    if (layer === 'argo') argoMarkers.setVisible(visible);
    if (layer === 'currents') currentVectors.setVisible(visible);
    if (layer === 'isosurface') thermoclineIsosurface.setVisible(visible);
    if (layer === 'gliders') gliderTracks.setVisible(visible);
  });

  document.addEventListener('start-outreach-tour', () => {
    outreachMode.start();
  });

  // Play/pause is now delegated fully to TimeAnimator
  document.addEventListener('time-play-toggle', (e) => {
    if (e.detail.playing) {
      timeAnimator.play();
    } else {
      timeAnimator.pause();
    }
  });

  document.addEventListener('outreach-toggle', (e) => {
    const simplified = e.detail.simplified;
    document.getElementById('sidebar')?.classList.toggle('outreach-simplified', simplified);
    if (simplified) {
      outreachMode.start();
    } else {
      outreachMode.stop();
    }
  });

  // 3D Scene Layer Theme Synchronization (Coastlines, Cage & Grid)
  const apply3DTheme = (themeId, mode) => {
    const isLight = mode === 'light';
    let coastColor = 0xffffff;
    let cagePrimary = 0x00d4aa;
    let cageGuide = 0x4a5584;
    let cageGrid = 0x1e295d;

    switch (themeId) {
      case 'standard-marine-light':
        coastColor = isLight ? 0x0a2540 : 0x00a3a3;
        cagePrimary = isLight ? 0x008080 : 0x00a3a3;
        cageGuide = isLight ? 0x0a2540 : 0x3a506b;
        cageGrid = isLight ? 0x1e3a5f : 0x008080;
        break;
      case 'coastal-chart':
        coastColor = isLight ? 0x1e3a8a : 0x06b6d4;
        cagePrimary = isLight ? 0x0284c7 : 0x06b6d4;
        cageGuide = isLight ? 0x1e3a8a : 0x334155;
        cageGrid = isLight ? 0x0f2942 : 0x06b6d4;
        break;
      case 'journal-paper':
        coastColor = isLight ? 0x334155 : 0x818cf8;
        cagePrimary = isLight ? 0x4338ca : 0x818cf8;
        cageGuide = isLight ? 0x334155 : 0x64748b;
        cageGrid = isLight ? 0x475569 : 0x4338ca;
        break;
      case 'bright-horizon':
        coastColor = isLight ? 0x0284c7 : 0x38bdf8;
        cagePrimary = isLight ? 0x0ea5e9 : 0x38bdf8;
        cageGuide = isLight ? 0x0284c7 : 0x7dd3fc;
        cageGrid = isLight ? 0x00897b : 0x0ea5e9;
        break;
      case 'enterprise-hydro':
        coastColor = isLight ? 0x0f172a : 0x38bdf8;
        cagePrimary = isLight ? 0x0284c7 : 0x38bdf8;
        cageGuide = isLight ? 0x1e293b : 0x64748b;
        cageGrid = isLight ? 0x334155 : 0x0284c7;
        break;
      default: // default-dark
        coastColor = isLight ? 0x0a0a2e : 0xffffff;
        cagePrimary = isLight ? 0x008f75 : 0x00d4aa;
        cageGuide = isLight ? 0x0a0a2e : 0x4a5584;
        cageGrid = isLight ? 0x1e295d : 0x1e295d;
        break;
    }

    coastline.updateThemeColor(coastColor, isLight ? 0.95 : 0.85);
    waterColumnCage.updateThemeColor(cagePrimary, cageGuide, cageGrid, isLight);
  };

  document.addEventListener('theme-changed', (e) => {
    apply3DTheme(e.detail.theme, e.detail.mode);
  });

  // Apply initial theme to 3D elements
  const initThemeInfo = themeManager.getThemeInfo();
  apply3DTheme(initThemeInfo.theme, initThemeInfo.mode);

  // FPS ticker & stretch component animation update loop
  let fpsFrames = 0;
  let fpsLast = performance.now();
  oceanScene.onUpdate((time) => {
    currentVectors.update(time);
    thermoclineIsosurface.update(time);
    gliderTracks.update(time);
    argoMarkers.update(time);

    fpsFrames++;
    const now = performance.now();
    if (now - fpsLast >= 500) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
      fpsFrames = 0;
      fpsLast = now;
      const fpsEl = document.getElementById('status-fps');
      if (fpsEl) fpsEl.textContent = `${fps} FPS`;
    }
  });
}

bootstrap().catch((err) => {
  console.error(err);
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.innerHTML = `
      <div class="loading-inner">
        <div class="loading-text" style="color:#ff6b6b;">Failed to start OceanView 3D — ${err.message}</div>
      </div>`;
  }
});
