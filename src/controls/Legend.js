/**
 * Legend.js — Hydrographic Map Symbol Legend & Layer Info HUD
 *
 * Usage:
 *   import { Legend } from './controls/Legend.js';
 *   const legend = new Legend('#top-left-legend');
 *   legend.update({ variable: 'temperature', units: '°C', min: 4.2, max: 31.5, colormap: 'thermal' });
 */

export class Legend {
  /**
   * @param {string|HTMLElement} container - CSS selector or DOM element that holds the legend
   */
  constructor(container) {
    this._root = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    this._canvas  = this._root?.querySelector('.legend-canvas');
    this._ctx     = this._canvas?.getContext('2d');
    this._minEl   = this._root?.querySelector('#legend-min-val');
    this._maxEl   = this._root?.querySelector('#legend-max-val');
    this._labelEl = this._root?.querySelector('#legend-label');
    this._badgeEl = this._root?.querySelector('#legend-active-var-badge') || document.getElementById('legend-active-var-badge');

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
    const { variable, units, min, max } = this._state;
    const name = variable.charAt(0).toUpperCase() + variable.slice(1);

    if (this._badgeEl) {
      this._badgeEl.textContent = `${name} (${units})`;
    }

    // Text labels if present
    if (this._minEl)   this._minEl.textContent   = this._fmt(min) + ' ' + units;
    if (this._maxEl)   this._maxEl.textContent   = this._fmt(max) + ' ' + units;
    if (this._labelEl) this._labelEl.textContent = `${name} (${units})`;
  }

  _fmt(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  }
}

