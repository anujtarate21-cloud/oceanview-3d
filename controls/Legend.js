/**
 * Legend.js — Dynamic colourbar legend with variable name + units
 *
 * Renders a horizontal gradient canvas strip showing:
 *   [min label] ████████████████████ [max label]
 *              Variable Name (Units)
 *
 * Usage:
 *   import { Legend } from './controls/Legend.js';
 *   const legend = new Legend('legend-container');
 *   legend.update({ variable: 'temperature', units: '°C', min: 4.2, max: 31.5, colormap: 'thermal' });
 */

import { COLORMAPS } from '../utils/colormaps.js';
import { COLORBAR_CANVAS_WIDTH, COLORBAR_CANVAS_HEIGHT } from '../utils/constants.js';

export class Legend {
  /**
   * @param {string|HTMLElement} container - CSS selector or DOM element that holds the legend
   */
  constructor(container) {
    this._root = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this._root) return;

    // Build inner DOM
    this._root.innerHTML = `
      <div class="legend-inner">
        <div class="legend-bar-row">
          <span class="legend-min" id="legend-min-val">—</span>
          <canvas class="legend-canvas" width="${COLORBAR_CANVAS_WIDTH}" height="${COLORBAR_CANVAS_HEIGHT}"></canvas>
          <span class="legend-max" id="legend-max-val">—</span>
        </div>
        <div class="legend-label" id="legend-label">—</div>
      </div>`;

    this._canvas  = this._root.querySelector('.legend-canvas');
    this._ctx     = this._canvas?.getContext('2d');
    this._minEl   = this._root.querySelector('#legend-min-val');
    this._maxEl   = this._root.querySelector('#legend-max-val');
    this._labelEl = this._root.querySelector('#legend-label');

    this._state = { variable: 'temperature', units: '°C', min: 0, max: 100, colormap: 'viridis' };
  }

  /**
   * Refresh the legend with new data.
   * @param {object} opts
   * @param {string} opts.variable  - e.g. 'temperature'
   * @param {string} opts.units     - e.g. '°C'
   * @param {number} opts.min
   * @param {number} opts.max
   * @param {string} opts.colormap  - one of the keys in colormaps.js
   */
  update({ variable, units, min, max, colormap } = {}) {
    if (variable !== undefined) this._state.variable  = variable;
    if (units    !== undefined) this._state.units      = units;
    if (min      !== undefined) this._state.min        = min;
    if (max      !== undefined) this._state.max        = max;
    if (colormap !== undefined) this._state.colormap   = colormap;

    this._redraw();
  }

  /** Convenience: update just the colormap */
  setColormap(name) {
    this._state.colormap = name;
    this._redraw();
  }

  /** Convenience: update just the value range */
  setRange(min, max, units) {
    this._state.min = min;
    this._state.max = max;
    if (units !== undefined) this._state.units = units;
    this._redraw();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _redraw() {
    const { variable, units, min, max, colormap } = this._state;

    // Text labels
    if (this._minEl)   this._minEl.textContent   = this._fmt(min) + ' ' + units;
    if (this._maxEl)   this._maxEl.textContent   = this._fmt(max) + ' ' + units;
    if (this._labelEl) {
      const name = variable.charAt(0).toUpperCase() + variable.slice(1);
      this._labelEl.textContent = `${name} (${units})`;
    }

    // Gradient canvas
    if (!this._ctx || !this._canvas) return;
    const w = this._canvas.width;
    const h = this._canvas.height;
    const palette = COLORMAPS[colormap] || COLORMAPS['viridis'];

    const imgData = this._ctx.createImageData(w, h);
    for (let x = 0; x < w; x++) {
      const t     = x / (w - 1);
      const idx   = Math.round(t * (palette.length - 1));
      const [r, g, b] = palette[idx];
      for (let y = 0; y < h; y++) {
        const pos = (y * w + x) * 4;
        imgData.data[pos]     = r;
        imgData.data[pos + 1] = g;
        imgData.data[pos + 2] = b;
        imgData.data[pos + 3] = 255;
      }
    }
    this._ctx.putImageData(imgData, 0, 0);
  }

  _fmt(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  }
}
