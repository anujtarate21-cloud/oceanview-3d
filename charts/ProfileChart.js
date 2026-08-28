import Plotly from 'plotly.js-dist-min';

const DARK = '#0e0e38';
const TEXT = '#e0e0e0';
const GRID = 'rgba(255,255,255,0.08)';
const TEMP_COLOR = '#ff9f43';
const SAL_COLOR = '#00d4aa';

/**
 * Depth-vs-variable profile modal.
 * Listens for `argo-click` ({ detail: { float_id } }) dispatched by DEV-A's
 * raycasting code, fetches the float's profile, and renders a dual-axis
 * Plotly chart (temperature + salinity vs. depth, depth inverted) with
 * thermocline estimation and real-time sounding statistics.
 */
export class ProfileChart {
  constructor({ fetchProfile } = {}) {
    this.fetchProfile = fetchProfile || this._defaultFetch;

    this.modal = document.getElementById('profile-modal');
    this.chartEl = document.getElementById('profile-chart');
    this.loadingEl = document.getElementById('profile-loading');
    this.idEl = document.getElementById('profile-float-id');
    this.metaEl = document.getElementById('profile-float-meta');
    this.typeBadge = document.getElementById('profile-type-badge');
    this.closeBtn = document.getElementById('close-modal');
    this.downloadBtn = document.getElementById('download-chart-btn');

    this.statSurfTemp = document.getElementById('stat-surf-temp');
    this.statSurfSal = document.getElementById('stat-surf-sal');
    this.statThermocline = document.getElementById('stat-thermocline');
    this.statDeepTemp = document.getElementById('stat-deep-temp');

    this.currentProfile = null;

    this.closeBtn?.addEventListener('click', () => this.close());
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal && !this.modal.classList.contains('hidden')) this.close();
    });

    this.downloadBtn?.addEventListener('click', () => this.exportChart());

    document.addEventListener('argo-click', (e) => this.open(e.detail.float_id));
  }

  async _defaultFetch(floatId) {
    const res = await fetch(`/api/argo/profile/${floatId}`);
    const contentType = res.headers.get('content-type') || '';
    // Guard against dev-server SPA fallback (200 OK + text/html for missing
    // routes) the same way dataLoader.js's tryFetch does — otherwise res.json()
    // throws a confusing "Unexpected token '<'" instead of a clear error.
    if (!res.ok || !/json/i.test(contentType)) {
      throw new Error(`Profile fetch failed: ${res.status}`);
    }
    return res.json();
  }

  async open(floatId) {
    this.modal.classList.remove('hidden');
    this.idEl.textContent = `Float ${floatId}`;
    this.metaEl.textContent = 'Loading hydrographic sounding profile…';
    if (this.chartEl) {
      Plotly.purge(this.chartEl);
      this.chartEl.innerHTML = '';
    }
    this.loadingEl?.classList.remove('hidden');

    try {
      const profile = await this.fetchProfile(floatId);
      this.currentProfile = profile;
      this.loadingEl.classList.add('hidden');

      const isGlider = profile.platform_type === 'glider';
      if (this.typeBadge) {
        this.typeBadge.textContent = isGlider ? 'Glider' : 'Argo Float';
        this.typeBadge.className = `badge ${isGlider ? 'glider-badge' : 'argo-badge'}`;
      }

      const maxDepth = profile.depths && profile.depths.length ? Math.round(profile.depths[profile.depths.length - 1]) : 2000;
      this.metaEl.textContent = `${Number(profile.lat).toFixed(2)}°N, ${Number(profile.lon).toFixed(2)}°E · ${profile.date ?? '2024-09-05'} · Sounding: 0 - ${maxDepth}m`;

      this._updateStats(profile);
      this._render(profile);
    } catch (err) {
      this.loadingEl.classList.add('hidden');
      this.metaEl.textContent = 'Could not load in-situ sounding data';
      this.chartEl.innerHTML = `<div style="color:#ff6b6b;padding:24px;font-size:13px;">Error: ${err.message}</div>`;
    }
  }

  _updateStats(profile) {
    const temps = (profile.temperature || []).filter((v) => v !== null && !isNaN(v));
    const sals = (profile.salinity || []).filter((v) => v !== null && !isNaN(v));
    const depths = profile.depths || [];

    if (this.statSurfTemp) {
      this.statSurfTemp.textContent = temps.length ? `${temps[0].toFixed(1)} °C` : '--';
    }
    if (this.statSurfSal) {
      this.statSurfSal.textContent = sals.length ? `${sals[0].toFixed(2)} PSU` : '--';
    }

    // Thermocline estimation: depth where temperature gradient (dT/dz) is steepest
    let thermoclineDepth = null;
    let maxGrad = 0;
    if (profile.temperature && depths.length >= 2) {
      for (let i = 0; i < depths.length - 1; i++) {
        const t1 = profile.temperature[i];
        const t2 = profile.temperature[i + 1];
        const d1 = depths[i];
        const d2 = depths[i + 1];
        if (t1 !== null && t2 !== null && d2 > d1 && d1 < 400) {
          const grad = Math.abs((t1 - t2) / (d2 - d1));
          if (grad > maxGrad) {
            maxGrad = grad;
            thermoclineDepth = Math.round((d1 + d2) / 2);
          }
        }
      }
    }
    if (this.statThermocline) {
      this.statThermocline.textContent = thermoclineDepth !== null ? `~${thermoclineDepth} m` : '--';
    }

    // Deep water temperature around 1500m
    let deepTemp = null;
    let minDepthDiff = Infinity;
    if (profile.temperature) {
      profile.temperature.forEach((t, i) => {
        if (t !== null) {
          const diff = Math.abs(depths[i] - 1500);
          if (diff < minDepthDiff && depths[i] >= 800) {
            minDepthDiff = diff;
            deepTemp = t;
          }
        }
      });
    }
    if (this.statDeepTemp) {
      this.statDeepTemp.textContent = deepTemp !== null ? `${deepTemp.toFixed(1)} °C` : (temps.length ? `${temps[temps.length - 1].toFixed(1)} °C` : '--');
    }
  }

  _render(profile) {
    const traces = [];

    if (profile.temperature) {
      traces.push({
        x: profile.temperature,
        y: profile.depths,
        name: 'Temperature (°C)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: TEMP_COLOR, width: 2.5 },
        marker: { size: 4.5, color: TEMP_COLOR },
        xaxis: 'x',
        hovertemplate: 'Depth: %{y:.1f} m<br>Temp: %{x:.2f} °C<extra></extra>',
      });
    }

    if (profile.salinity) {
      traces.push({
        x: profile.salinity,
        y: profile.depths,
        name: 'Salinity (PSU)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: SAL_COLOR, width: 2.5 },
        marker: { size: 4.5, color: SAL_COLOR },
        xaxis: 'x2',
        hovertemplate: 'Depth: %{y:.1f} m<br>Salinity: %{x:.2f} PSU<extra></extra>',
      });
    }

    const layout = {
      paper_bgcolor: DARK,
      plot_bgcolor: DARK,
      font: { color: TEXT, family: 'Inter, sans-serif', size: 11 },
      margin: { l: 55, r: 45, t: 30, b: 35 },
      showlegend: true,
      legend: { orientation: 'h', y: -0.15, font: { size: 10.5 } },
      yaxis: {
        title: 'Depth (meters)',
        autorange: 'reversed',
        gridcolor: GRID,
        zerolinecolor: GRID,
        tickfont: { family: 'JetBrains Mono, monospace', size: 10 },
      },
      xaxis: {
        title: 'Temperature (°C)',
        titlefont: { color: TEMP_COLOR, size: 11 },
        tickfont: { color: TEMP_COLOR, family: 'JetBrains Mono, monospace', size: 10 },
        gridcolor: GRID,
        side: 'top',
        anchor: 'y',
      },
      xaxis2: {
        title: 'Salinity (PSU)',
        titlefont: { color: SAL_COLOR, size: 11 },
        tickfont: { color: SAL_COLOR, family: 'JetBrains Mono, monospace', size: 10 },
        overlaying: 'x',
        side: 'bottom',
        showgrid: false,
      },
    };

    Plotly.newPlot(this.chartEl, traces, layout, {
      displayModeBar: false,
      responsive: true,
    }).then(() => {
      Plotly.Plots.resize(this.chartEl);
    });
  }

  exportChart() {
    if (!this.chartEl || !this.currentProfile) return;
    Plotly.downloadImage(this.chartEl, {
      format: 'png',
      width: 800,
      height: 600,
      filename: `argo_profile_${this.currentProfile.float_id || 'sounding'}`,
    });
  }

  close() {
    this.modal.classList.add('hidden');
    Plotly.purge(this.chartEl);
  }
}

