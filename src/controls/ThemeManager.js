/**
 * ThemeManager.js — 5 Curated Themes & Default Theme System
 *
 * Tailored specifically per SIH 2026 guidelines & evaluator requirements:
 *
 * 0. default-dark            — 🌌 Default OceanView 3D (Dark Abyss & Glowing Cyan)
 * 1. standard-marine-light   — 🏛️ Standard Marine Light (Government & Regulatory Body Theme)
 * 2. coastal-chart           — 🧭 Coastal Chart (Oceanographer & Field Operator Theme)
 * 3. journal-paper           — 📜 Journal Paper / Lab Light (Researcher & Academic Theme)
 * 4. bright-horizon          — 🎓 Bright Horizon (Young Student & Educator Theme)
 * 5. enterprise-hydro        — 💼 Enterprise Clean Hydro (Default / Professional Hybrid Theme)
 *
 * Features:
 * - 1-click theme switching across all themes.
 * - Light Mode ☀️ / Dark Mode 🌙 toggle with instant CSS variable updates.
 * - Dynamic 3D WebGL background & fog synchronization.
 * - LocalStorage persistence (`oceanview_theme` and `oceanview_mode`).
 */

export const THEMES = [
  {
    id: 'default-dark',
    name: 'Dark Abyss',
    icon: '🌌',
    description: 'Deep ocean dark theme with glowing cyan and bioluminescent telemetry',
    dark: {
      bg3d: 0x0a0a2e,
      fog: 0x0a0a2e,
    },
    light: {
      bg3d: 0xdbeafe,
      fog: 0xdbeafe,
    }
  },
  {
    id: 'standard-marine-light',
    name: 'Standard Marine Light',
    icon: '🏛️',
    description: 'Crisp Ocean Navy (#0A2540) on White, Soft Sky Tint panels & Government Teal (#008080)',
    dark: {
      bg3d: 0x061426,
      fog: 0x061426,
    },
    light: {
      bg3d: 0xffffff,
      fog: 0xf0f4f8,
    }
  },
  {
    id: 'coastal-chart',
    name: 'Coastal Chart',
    icon: '🧭',
    description: 'Parchment Light Blue (#EBF3F5), Marine Blue (#1E3A8A) vectors & Safety Amber (#D97706) float markers',
    dark: {
      bg3d: 0x07151e,
      fog: 0x07151e,
    },
    light: {
      bg3d: 0xebf3f5,
      fog: 0xebf3f5,
    }
  },
  {
    id: 'journal-paper',
    name: 'Journal Paper',
    icon: '📜',
    description: 'Off-White Paper (#F8FAF8), Slate Blue (#334155), Academic Indigo (#4338CA) & Laboratory Emerald (#059669)',
    dark: {
      bg3d: 0x0f172a,
      fog: 0x0f172a,
    },
    light: {
      bg3d: 0xf8faf8,
      fog: 0xf8faf8,
    }
  },
  {
    id: 'bright-horizon',
    name: 'Bright Horizon',
    icon: '🎓',
    description: 'Bright Aqua (#0EA5E9), Cloud White (#FFFFFF), Sunlight Yellow (#F59E0B) & friendly rounded cards',
    dark: {
      bg3d: 0x040714,
      fog: 0x040714,
    },
    light: {
      bg3d: 0xf0f9ff,
      fog: 0xf0f9ff,
    }
  },
  {
    id: 'enterprise-hydro',
    name: 'Enterprise Clean Hydro',
    icon: '💼',
    description: 'Cool Slate (#0F172A), Ice White (#F8FAFC), Deep Azure (#0284C7) & Fresh Mint (#10B981) modern analytics look',
    dark: {
      bg3d: 0x0a192f,
      fog: 0x0a192f,
    },
    light: {
      bg3d: 0xf8fafc,
      fog: 0xf8fafc,
    }
  }
];

export class ThemeManager {
  /**
   * @param {Object} options
   * @param {import('../scene/OceanScene.js').OceanScene} [options.oceanScene]
   */
  constructor(options = {}) {
    this.oceanScene = options.oceanScene || null;
    
    // Load persisted settings or default to Standard Marine Light / Default
    const savedTheme = localStorage.getItem('oceanview_theme');
    const savedMode = localStorage.getItem('oceanview_mode');

    this.currentTheme = THEMES.some(t => t.id === savedTheme) ? savedTheme : 'default-dark';
    this.currentMode = savedMode ? (savedMode === 'light' ? 'light' : 'dark') : (this.currentTheme.includes('light') ? 'light' : 'dark');

    this.els = {
      themeSelect: document.getElementById('theme-select'),
      modeToggleBtn: document.getElementById('mode-toggle-btn'),
      modeIcon: document.getElementById('mode-icon'),
      modeLabel: document.getElementById('mode-label'),
    };

    this._applyTheme(this.currentTheme, this.currentMode, false);
    this._initEvents();
  }

  setOceanScene(oceanScene) {
    this.oceanScene = oceanScene;
    this._update3DSceneColors();
  }

  _initEvents() {
    // Theme dropdown change
    this.els.themeSelect?.addEventListener('change', (e) => {
      this.setTheme(e.target.value);
    });

    // Dark/Light Mode toggle button
    this.els.modeToggleBtn?.addEventListener('click', () => {
      this.toggleMode();
    });

    // Keyboard shortcuts: Shift + T (Cycle theme), Shift + M (Toggle Dark/Light)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        this.cycleTheme();
      } else if (e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        this.toggleMode();
      }
    });
  }

  setTheme(themeId) {
    if (!THEMES.some(t => t.id === themeId)) return;
    this.currentTheme = themeId;
    localStorage.setItem('oceanview_theme', this.currentTheme);
    
    // Auto-align mode with light themes if user picked a light theme
    if (themeId.includes('light') || themeId === 'coastal-chart' || themeId === 'journal-paper' || themeId === 'bright-horizon') {
      this.currentMode = 'light';
      localStorage.setItem('oceanview_mode', 'light');
    } else if (themeId === 'default-dark') {
      this.currentMode = 'dark';
      localStorage.setItem('oceanview_mode', 'dark');
    }

    this._applyTheme(this.currentTheme, this.currentMode, true);
  }

  setMode(mode) {
    this.currentMode = mode === 'light' ? 'light' : 'dark';
    localStorage.setItem('oceanview_mode', this.currentMode);
    this._applyTheme(this.currentTheme, this.currentMode, true);
  }

  toggleMode() {
    this.setMode(this.currentMode === 'dark' ? 'light' : 'dark');
  }

  cycleTheme() {
    const idx = THEMES.findIndex(t => t.id === this.currentTheme);
    const nextIdx = (idx + 1) % THEMES.length;
    this.setTheme(THEMES[nextIdx].id);
  }

  _applyTheme(themeId, mode, dispatchEvent = true) {
    const root = document.documentElement;
    root.dataset.theme = themeId;
    root.dataset.mode = mode;

    // Update UI controls
    if (this.els.themeSelect) {
      this.els.themeSelect.value = themeId;
    }
    if (this.els.modeIcon) {
      this.els.modeIcon.textContent = mode === 'dark' ? '🌙' : '☀️';
    }
    if (this.els.modeToggleBtn) {
      this.els.modeToggleBtn.setAttribute('title', `Switch to ${mode === 'dark' ? 'Light' : 'Dark'} Mode (Shift + M)`);
    }

    this._update3DSceneColors();

    if (dispatchEvent) {
      const themeObj = THEMES.find(t => t.id === themeId);
      const colors = themeObj ? themeObj[mode] : { bg3d: 0x061426, fog: 0x061426 };
      document.dispatchEvent(new CustomEvent('theme-changed', {
        detail: {
          theme: themeId,
          mode,
          bg3dHex: colors.bg3d,
          fog3dHex: colors.fog,
        }
      }));
    }
  }

  _update3DSceneColors() {
    if (!this.oceanScene) return;
    const themeObj = THEMES.find(t => t.id === this.currentTheme);
    if (!themeObj) return;
    const colors = themeObj[this.currentMode] || themeObj.dark;
    
    if (typeof this.oceanScene.updateThemeColors === 'function') {
      this.oceanScene.updateThemeColors(colors.bg3d, colors.fog);
    }
  }

  getThemeInfo() {
    return {
      theme: this.currentTheme,
      mode: this.currentMode,
      themeList: THEMES
    };
  }

  /**
   * Resolve a free-text / voice phrase to a { themeId, mode } pair.
   * Returns null if nothing matched.
   * @param {string} text
   * @returns {{ themeId: string, mode: string|null }|null}
   */
  resolveThemeFromText(text) {
    if (!text) return null;
    const p = text.toLowerCase();

    // Mode-only phrases
    const isDarkOnly = !(
      p.includes('government') || p.includes('marine light') ||
      p.includes('coastal') || p.includes('journal') || p.includes('paper') ||
      p.includes('bright') || p.includes('student') || p.includes('educator') ||
      p.includes('enterprise') || p.includes('hydro') || p.includes('pro') ||
      p.includes('oceanograph') || p.includes('researcher') || p.includes('academic') ||
      p.includes('abyss') || p.includes('default') || p.includes('original')
    );
    if (isDarkOnly && (p.includes('dark mode') || p.includes('dark theme') || p.includes('night mode') || p.includes('switch to dark') || p.includes('enable dark'))) {
      return { themeId: null, mode: 'dark' };
    }
    if (isDarkOnly && (p.includes('light mode') || p.includes('light theme') || p.includes('day mode') || p.includes('switch to light') || p.includes('enable light'))) {
      return { themeId: null, mode: 'light' };
    }

    // Theme keyword → ID map (aliases in priority order)
    const THEME_ALIASES = [
      {
        id: 'default-dark',
        keywords: ['default', 'original', 'dark abyss', 'abyss', 'oceanview default', 'original theme', 'default dark', 'reset theme', 'original dark']
      },
      {
        id: 'standard-marine-light',
        keywords: ['government', 'govt', 'moes', 'ministry', 'marine light', 'standard marine', 'judge', 'judges', 'official', 'regulatory', 'administrative', 'gov theme', 'incois official']
      },
      {
        id: 'coastal-chart',
        keywords: ['coastal', 'coastal chart', 'nautical', 'oceanographer', 'field operator', 'oceanographic', 'chart theme', 'marine chart', 'parchment', 'bathymetric']
      },
      {
        id: 'journal-paper',
        keywords: ['journal', 'paper', 'researcher', 'academic', 'lab', 'research', 'scientist', 'lab theme', 'journal paper', 'white paper', 'academic theme', 'research theme']
      },
      {
        id: 'bright-horizon',
        keywords: ['bright', 'student', 'students', 'educator', 'young', 'kids', 'colorful', 'fun', 'bright horizon', 'education', 'learning', 'classroom', 'school']
      },
      {
        id: 'enterprise-hydro',
        keywords: ['enterprise', 'professional', 'pro', 'saas', 'hydro', 'enterprise hydro', 'clean hydro', 'modern', 'business', 'dark professional']
      },
    ];

    let matchedId = null;
    for (const { id, keywords } of THEME_ALIASES) {
      if (keywords.some(k => p.includes(k))) {
        matchedId = id;
        break;
      }
    }

    if (!matchedId) return null;

    // Determine mode override from text
    let mode = null;
    if (p.includes('dark mode') || p.includes('dark') && !p.includes('light')) {
      mode = 'dark';
    } else if (p.includes('light mode') || p.includes('light')) {
      mode = 'light';
    }

    return { themeId: matchedId, mode };
  }
}
