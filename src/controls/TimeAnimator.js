/**
 * TimeAnimator.js — Play / pause / step time-lapse animation
 *
 * Responsibilities:
 *  - Owns the play / pause loop (setInterval-free — uses requestAnimationFrame scheduling)
 *  - Emits  `time-change`      { timestep: number }   on every step
 *  - Emits  `time-play-toggle` { playing: boolean }   on play/pause toggle
 *  - Exposes step(), stepBack(), play(), pause(), toggle() for imperative callers
 *
 * Usage (inside main.js):
 *   import { TimeAnimator } from './controls/TimeAnimator.js';
 *   const animator = new TimeAnimator({ totalSteps: 3, intervalMs: 1200 });
 *   animator.attach(timeSliderEl, playBtnEl, timeReadoutEl, timestamps);
 */

import { PLAY_INTERVAL_MS } from '../utils/constants.js';

export class TimeAnimator {
  /**
   * @param {object} opts
   * @param {number}   [opts.totalSteps=3]       - Number of timestep indices (0-based)
   * @param {number}   [opts.intervalMs]         - Milliseconds per auto-step (default: PLAY_INTERVAL_MS)
   * @param {string[]} [opts.timestamps=[]]      - Human-readable date labels per step
   */
  constructor({ totalSteps = 3, intervalMs = PLAY_INTERVAL_MS, timestamps = [] } = {}) {
    this.totalSteps  = totalSteps;
    this.intervalMs  = intervalMs;
    this.timestamps  = timestamps;
    this.current     = 0;
    this.isPlaying   = false;

    /** @private rAF-based timer handle */
    this._rafId      = null;
    this._lastTick   = 0;

    /** DOM references — set via attach() */
    this._slider     = null;
    this._playBtn    = null;
    this._readout    = null;
  }

  /**
   * Wire up DOM elements. Call this once the DOM is ready.
   * @param {HTMLInputElement}  slider   - range input#time-slider
   * @param {HTMLButtonElement} playBtn  - button#play-btn
   * @param {HTMLElement}       readout  - span#time-readout
   * @param {string[]}          [timestamps] - optional override of date labels
   */
  attach(slider, playBtn, readout, timestamps) {
    this._slider  = slider;
    this._playBtn = playBtn;
    this._readout = readout;
    if (timestamps?.length) this.timestamps = timestamps;

    // Sync slider range
    if (slider) {
      slider.min   = 0;
      slider.max   = Math.max(0, this.totalSteps - 1);
      slider.value = this.current;
      slider.addEventListener('input', () => {
        this.current = Number(slider.value);
        this._syncUI();
        this._emit('time-change', { timestep: this.current });
      });
    }

    if (playBtn) {
      playBtn.addEventListener('click', () => this.toggle());
    }

    this._syncUI();
  }

  /** Update totalSteps + timestamps after metadata is loaded */
  applyMetadata(totalSteps, timestamps = []) {
    this.totalSteps = totalSteps;
    this.timestamps = timestamps;
    if (this._slider) {
      this._slider.max   = Math.max(0, totalSteps - 1);
      this._slider.value = Math.min(this.current, totalSteps - 1);
      this.current       = Number(this._slider.value);
    }
    this._syncUI();
  }

  /** Advance one step forward (wraps around) */
  step() {
    this.current = (this.current + 1) % this.totalSteps;
    this._apply();
  }

  /** Step one step backward (wraps around) */
  stepBack() {
    this.current = (this.current - 1 + this.totalSteps) % this.totalSteps;
    this._apply();
  }

  /** Jump to a specific timestep index */
  jumpTo(t) {
    this.current = Math.max(0, Math.min(t, this.totalSteps - 1));
    this._apply();
  }

  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this._lastTick = performance.now();
    this._emit('time-play-toggle', { playing: true });
    this._syncUI();
    this._tick();
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._emit('time-play-toggle', { playing: false });
    this._syncUI();
  }

  toggle() {
    this.isPlaying ? '⏸' : '▶';
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** rAF loop — steps time every intervalMs without setInterval */
  _tick() {
    if (!this.isPlaying) return;
    this._rafId = requestAnimationFrame((now) => {
      if (now - this._lastTick >= this.intervalMs) {
        this._lastTick = now;
        this.step();
      }
      this._tick();
    });
  }

  _apply() {
    this._syncUI();
    this._emit('time-change', { timestep: this.current });
  }

  _syncUI() {
    if (this._slider)  this._slider.value   = this.current;
    if (this._playBtn) this._playBtn.textContent = this.isPlaying ? '⏸' : '▶';
    if (this._readout) {
      if (this.timestamps && this.timestamps.length > 0) {
        let label = this.timestamps[this.current] || `T${this.current}`;
        if (label.includes('T') && label.length > 10) label = label.split('T')[0];
        this._readout.textContent = `${label} (T${this.current + 1}/${this.timestamps.length})`;
      } else {
        this._readout.textContent = 'No Cached Timesteps';
      }
    }
  }

  _emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
