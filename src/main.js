import * as THREE from 'three';
import { OceanScene } from './scene/OceanScene.js';
import { VolumeRenderer } from './scene/VolumeRenderer.js';
import { CoastlineLayer } from './scene/CoastlineLayer.js';
import { WaterColumnCage } from './scene/WaterColumnCage.js';
import { ArgoMarkers } from './instruments/ArgoMarkers.js';
import { ControlPanel } from './controls/ControlPanel.js';
import { ColormapEditor } from './controls/ColormapEditor.js';
import { TimeAnimator } from './controls/TimeAnimator.js';
import { Legend } from './controls/Legend.js';
import { ProfileChart } from './charts/ProfileChart.js';
import { PipelineManager } from './controls/PipelineManager.js';

import { PLAY_INTERVAL_MS, DEPTH_DEBOUNCE_MS, RAYCAST_THROTTLE_MS } from './utils/constants.js';
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
  timestep: 0,
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
  const coastline = new CoastlineLayer(oceanScene.scene);
  const argoMarkers = new ArgoMarkers(oceanScene.scene);

  const controlPanel = new ControlPanel();
  const colorbar = new ColormapEditor();
  const legend = new Legend('#legend-container');
  const timeAnimator = new TimeAnimator({ totalSteps: 3, intervalMs: PLAY_INTERVAL_MS });



  const profileChart = new ProfileChart({
    fetchProfile: async (floatId) => {
      const data = await loadArgoProfile(floatId);
      if (data) return data;
      const marker = argoMarkers.getMarkers().find((m) => m.userData.float_id === floatId || m.userData.id === floatId);
      const lat = marker?.userData.lat ?? 10;
      const lon = marker?.userData.lon ?? 75;
      return generateSyntheticProfile(floatId, lat, lon);
    },
  });

  // --- Raycasting for Argo float clicks & hover ---
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.5 };
  const pointer = new THREE.Vector2();
  const tooltip = document.getElementById('argo-tooltip');
  const coordsEl = document.getElementById('status-coords');
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const intersectPoint = new THREE.Vector3();

  function getPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  canvas.addEventListener('click', (e) => {
    getPointer(e);
    raycaster.setFromCamera(pointer, oceanScene.camera);
    const hits = raycaster.intersectObjects(argoMarkers.getMarkers());
    if (hits.length > 0) {
      const floatId = hits[0].object.userData.float_id || hits[0].object.userData.id;
      document.dispatchEvent(new CustomEvent('argo-click', { detail: { float_id: floatId } }));
    }
  });

  // Throttle mousemove raycasting — only run every RAYCAST_THROTTLE_MS, not every pixel
  let lastRaycastTime = 0;
  canvas.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastRaycastTime < RAYCAST_THROTTLE_MS) return;
    lastRaycastTime = now;

    getPointer(e);
    raycaster.setFromCamera(pointer, oceanScene.camera);
    const hits = raycaster.intersectObjects(argoMarkers.getMarkers());
    if (hits.length > 0) {
      const data = hits[0].object.userData;
      canvas.classList.add('hovering-marker');
      if (tooltip) {
        tooltip.classList.remove('hidden');
        tooltip.style.left = `${e.clientX}px`;
        tooltip.style.top = `${e.clientY}px`;
        tooltip.innerHTML = `<div><strong>${data.platform_type === 'glider' ? '🌊 Glider' : '🛰️ Argo Float'} ${data.float_id || data.id}</strong></div><div style="font-size:10px;opacity:0.75;margin-top:2px;">${Number(data.lat).toFixed(2)}°N, ${Number(data.lon).toFixed(2)}°E · ${data.date || ''}</div>`;
      }
      if (coordsEl) coordsEl.textContent = `Target: ${Number(data.lat).toFixed(2)}°N · ${Number(data.lon).toFixed(2)}°E`;
    } else {
      canvas.classList.remove('hovering-marker');
      if (tooltip) tooltip.classList.add('hidden');
      if (coordsEl && raycaster.ray.intersectPlane(groundPlane, intersectPoint)) {
        const lon = intersectPoint.x / 1.6 + 77.5;
        const lat = intersectPoint.y / 1.6 + 12.5;
        if (lat >= -2 && lat <= 28 && lon >= 58 && lon <= 96) {
          coordsEl.textContent = `Lat: ${lat.toFixed(2)}°N · Lon: ${lon.toFixed(2)}°E`;
        }
      }
    }
  });

  // --- Metadata ---
  let metadata = await loadMetadata();
  if (!metadata) {
    state.usingSyntheticData = true;
    metadata = {
      variables: ['temperature', 'salinity', 'chlorophyll'],
      depth_levels: [0, 10, 20, 50, 100, 200, 500, 1000, 1500, 2000],
      timesteps: [0],
      extent: { lat_min: 0, lat_max: 25, lon_min: 60, lon_max: 95 },
    };
  }
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
  async function fetchTile(variable, depth, timestep) {
    const tile = await loadModelData(variable, depth, timestep);
    return tile || generateSyntheticTile(variable, depth);
  }

  const busyIndicator = document.getElementById('tile-busy-indicator');
  let busyTimer = null;

  function drawColorbarWithTile(tile) {
    if (!tile) return;
    const min = tile.global_min !== undefined ? tile.global_min : (tile.min !== undefined ? tile.min : (tile.slice_min !== undefined ? tile.slice_min : 0));
    const max = tile.global_max !== undefined ? tile.global_max : (tile.max !== undefined ? tile.max : (tile.slice_max !== undefined ? tile.slice_max : 100));
    colorbar.draw(min, max, tile.units);
    legend.update({ variable: state.variable, units: tile.units || '°C', min, max, colormap: state.colormap });
  }

  async function refreshVolume() {
    clearTimeout(busyTimer);
    if (busyIndicator) busyTimer = setTimeout(() => busyIndicator.classList.add('visible'), 120);

    const tile = await fetchTile(state.variable, state.depth, state.timestep);

    clearTimeout(busyTimer);
    if (busyIndicator) busyIndicator.classList.remove('visible');

    volumeRenderer.loadDepthSlice(tile);
    colorbar.setColormap(state.colormap);
    drawColorbarWithTile(tile);
  }

  const initialTile = await fetchTile(state.variable, state.depth, state.timestep);
  volumeRenderer.loadDepthSlice(initialTile);
  colorbar.setColormap(state.colormap);
  drawColorbarWithTile(initialTile);

  const positions = (await loadArgoPositions(state.timestep)) || generateSyntheticArgoPositions();
  await argoMarkers.load(positions);

  // Guards against overlapping requests if the user drags the timestep slider
  // quickly — only the most recently requested load is allowed to apply.
  let argoLoadToken = 0;
  async function refreshArgoMarkers() {
    const token = ++argoLoadToken;
    const nextPositions = (await loadArgoPositions(state.timestep)) || generateSyntheticArgoPositions();
    if (token !== argoLoadToken) return; // superseded by a newer timestep change
    await argoMarkers.load(nextPositions);
    if (token !== argoLoadToken) return;
    argoMarkers.setVisible(controlPanel.els.toggleArgo?.checked ?? true);
  }

  const geojson = await loadCoastline();
  if (geojson) await coastline.load(geojson);

  // -- Pipeline Manager (v2): on-demand HYCOM date navigation ----------------
  const pipelineManager = new PipelineManager({
    onDateReady: async (dateStr) => {
      console.info('[Pipeline] Selected date: ' + dateStr);
      const tsMap = { '2024-09-05': 0, '2024-09-06': 1, '2024-09-07': 2 };
      if (tsMap[dateStr] !== undefined) {
        // Use timeAnimator.jumpTo() which properly triggers the UI sync AND dispatches 'time-change'
        timeAnimator.jumpTo(tsMap[dateStr]);
      } else {
        await Promise.all([refreshVolume(), refreshArgoMarkers()]);
      }
    },
    onError: (msg) => {
      console.error('[Pipeline] Error:', msg);
    }
  });
  pipelineManager.init();

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
  document.addEventListener('variable-change', async (e) => {
    state.variable = e.detail.variable;
    // Auto-select specialized colormap for field if standard palette matches default
    if (state.variable === 'salinity' && (state.colormap === 'thermal' || state.colormap === 'viridis')) {
      state.colormap = 'haline';
      if (controlPanel.els.colormap) controlPanel.els.colormap.value = 'haline';
    } else if (state.variable === 'temperature' && (state.colormap === 'haline' || state.colormap === 'viridis')) {
      state.colormap = 'thermal';
      if (controlPanel.els.colormap) controlPanel.els.colormap.value = 'thermal';
    }
    volumeRenderer.setColormap(state.colormap);
    colorbar.setColormap(state.colormap);
    await refreshVolume();
  });

  // Debounce depth changes — wait DEPTH_DEBOUNCE_MS after user stops dragging before fetching tile
  const debouncedRefreshVolume = debounce(async () => await refreshVolume(), DEPTH_DEBOUNCE_MS);
  document.addEventListener('depth-change', (e) => {
    state.depth = e.detail.depth;
    debouncedRefreshVolume();
  });

  document.addEventListener('time-change', async (e) => {
    state.timestep = e.detail.timestep;
    await Promise.all([refreshVolume(), refreshArgoMarkers()]);
  });

  document.addEventListener('colormap-change', (e) => {
    state.colormap = e.detail.colormap;
    volumeRenderer.setColormap(state.colormap);
    colorbar.setColormap(state.colormap);
    legend.setColormap(state.colormap);
    const tile = volumeRenderer.lastTile;
    if (tile) drawColorbarWithTile(tile);
  });

  document.addEventListener('opacity-change', (e) => volumeRenderer.setOpacity(e.detail.opacity));
  document.addEventListener('exag-change', (e) => {
    volumeRenderer.setExaggeration(e.detail.exaggeration);
    waterColumnCage.setExaggeration(e.detail.exaggeration);
  });

  document.addEventListener('layer-toggle', (e) => {
    const { layer, visible } = e.detail;
    if (layer === 'coastline') coastline.setVisible(visible);
    if (layer === 'argo') argoMarkers.setVisible(visible);
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
    document.getElementById('sidebar')?.classList.toggle('outreach-simplified', e.detail.simplified);
  });

  // FPS ticker
  let fpsFrames = 0;
  let fpsLast = performance.now();
  oceanScene.onUpdate(() => {
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
