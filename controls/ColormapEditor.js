import { COLORMAPS, viridis } from '../utils/colormaps.js';

/**
 * Draws a vertical gradient colorbar and keeps the min/mid/max labels in sync.
 * Owns: #colorbar canvas, #colorbar-min / #colorbar-mid / #colorbar-max
 */
export class ColormapEditor {
  constructor({ canvasId = 'colorbar', minLabelId = 'colorbar-min', midLabelId = 'colorbar-mid', maxLabelId = 'colorbar-max' } = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.minLabel = document.getElementById(minLabelId);
    this.midLabel = document.getElementById(midLabelId);
    this.maxLabel = document.getElementById(maxLabelId);
    this.currentColormap = 'viridis';
    this.currentUnits = '°C';
    this.lastMin = 0;
    this.lastMax = 30;
  }

  setColormap(name) {
    if (typeof name === 'string' && COLORMAPS[name]) {
      this.currentColormap = name;
    } else {
      this.currentColormap = 'viridis';
    }
    // Redraw with last known range if available
    if (this.ctx) {
      this.draw(this.lastMin, this.lastMax, this.currentUnits);
    }
  }

  /** Redraw the gradient and update numeric labels for the given data range. */
  draw(min, max, units) {
    if (min !== undefined && !isNaN(min)) this.lastMin = min;
    if (max !== undefined && !isNaN(max)) this.lastMax = max;
    if (units !== undefined) this.currentUnits = units;

    const colormap = COLORMAPS[this.currentColormap] || viridis;
    if (!this.canvas || !this.ctx) return;

    const width = this.canvas.width || 24;
    const height = this.canvas.height || 160;
    const imageData = this.ctx.createImageData(width, height);

    // Row 0 = top = max value, so we paint the ramp reversed top-to-bottom.
    for (let y = 0; y < height; y++) {
      const t = 1 - y / (height - 1);
      const idx = Math.floor(t * (colormap.length - 1));
      const [r, g, b] = colormap[idx] || [128, 128, 128];
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        imageData.data[p] = r;
        imageData.data[p + 1] = g;
        imageData.data[p + 2] = b;
        imageData.data[p + 3] = 255;
      }
    }
    this.ctx.putImageData(imageData, 0, 0);

    const fmt = (v) => (v !== undefined && v !== null && !isNaN(v)) ? `${Number(v).toFixed(1)}${this.currentUnits}` : '--';
    if (this.maxLabel) this.maxLabel.textContent = fmt(this.lastMax);
    if (this.minLabel) this.minLabel.textContent = fmt(this.lastMin);
    if (this.midLabel) this.midLabel.textContent = fmt((this.lastMin + this.lastMax) / 2);
  }
}
