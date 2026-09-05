/**
 * PipelineManager.js — OceanView 3D On-Demand Data Pipeline UI (v2)
 * 
 * Handles:
 * - Date picker populated with available dates from /api/pipeline/available-dates
 * - Visual indicator: green dot (cached) vs amber dot (needs fetch) per date
 * - POST /api/pipeline/fetch → shows live status bar while downloading + processing
 * - Polls /api/pipeline/status/{job_id} every 5s until done, then triggers data reload
 * - Integrates with main.js state via onDateReady(dateStr) callback
 */

const POLL_INTERVAL_MS = 5000;
const API_BASE = "";

export class PipelineManager {
    /**
     * @param {Object} options
     * @param {Function} options.onDateReady - Called with (dateStr) when tiles become available
     * @param {Function} options.onError     - Called with (message) on pipeline errors
     */
    constructor({ onDateReady, onError, onDatesChanged } = {}) {
        this.onDatesChanged = onDatesChanged || null;
        this.onDateReady = onDateReady || (() => {});
        this.onError = onError || ((msg) => console.error("[Pipeline]", msg));
        this.defaultDates = [
            '2022-01-04', '2022-09-06', '2023-03-21', '2023-08-02', '2023-08-31',
            '2024-07-31', '2024-08-25', '2024-08-28', '2024-08-31',
            '2024-09-01', '2024-09-02', '2024-09-03', '2024-09-04',
            '2024-09-05', '2024-09-06', '2024-09-07'
        ];
        
        // Restore cached dates from localStorage if available
        const saved = localStorage.getItem('oceanview_cached_dates');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.availableDates = [...new Set(parsed)].sort();
                } else {
                    this.availableDates = [...this.defaultDates];
                }
            } catch (_) {
                this.availableDates = [...this.defaultDates];
            }
        } else {
            this.availableDates = [...this.defaultDates];
        }

        this.activePolls = {};
        this.currentDate = this.availableDates.includes('2023-03-21') ? '2023-03-21' : (this.availableDates[0] || '2024-09-05');
        this._injectStyles();
        this._buildUI();
    }

    // ─── UI Construction ──────────────────────────────────────────────────────

    _buildUI() {
        const existingPanel = document.getElementById("pipeline-panel");
        if (existingPanel) {
            this.panel = existingPanel;
        } else {
            // Pipeline panel fallback
            this.panel = document.createElement("div");
            this.panel.id = "pipeline-panel";
            this.panel.innerHTML = `
                <div class="pipeline-header">
                    <span class="pipeline-icon">&#128197;</span>
                    <span class="pipeline-title">Date Navigator</span>
                    <span class="pipeline-badge" id="pipeline-badge">LIVE</span>
                </div>
                <div class="pipeline-date-row">
                    <input type="date" id="pipeline-date-input" value="${this.currentDate}"
                           min="2018-01-01" max="2026-12-31"
                           title="Select a date to visualize ocean state" />
                    <button id="pipeline-fetch-btn" title="Fetch data for this date">
                        Load
                    </button>
                </div>
                <div id="pipeline-status-bar" class="pipeline-status hidden">
                    <div class="pipeline-progress-track">
                        <div class="pipeline-progress-fill" id="pipeline-progress-fill"></div>
                    </div>
                    <div class="pipeline-status-text" id="pipeline-status-text">Initializing...</div>
                </div>
                <div class="pipeline-available-header">
                    <span class="pipeline-available-label">CACHED DATES (${this.availableDates.length}):</span>
                    <button id="pipeline-reset-cache-btn" class="pipeline-header-action" title="Restore all default cached dates">&#8635; Reset</button>
                </div>
                <div id="pipeline-date-chips" class="pipeline-date-chips"></div>
            `;

            const sidebar = document.querySelector("#sidebar") || document.querySelector(".sidebar");
            const timeSection = document.getElementById("time-section");
            if (sidebar) {
                if (timeSection && timeSection.parentNode === sidebar) {
                    sidebar.insertBefore(this.panel, timeSection);
                } else {
                    sidebar.appendChild(this.panel);
                }
            } else {
                document.body.appendChild(this.panel);
            }
        }

        // Wire reset cache button
        const resetBtn = this.panel.querySelector("#pipeline-reset-cache-btn");
        resetBtn?.addEventListener("click", () => {
            this.restoreDefaultDates();
        });

        // Wire events
        const fetchBtn = this.panel.querySelector("#pipeline-fetch-btn");
        const dateInput = this.panel.querySelector("#pipeline-date-input");

        if (dateInput) dateInput.value = this.currentDate;

        fetchBtn?.addEventListener("click", () => {
            if (dateInput?.value) this.requestDate(dateInput.value);
        });

        dateInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                if (dateInput.value) this.requestDate(dateInput.value);
            }
        });

        dateInput?.addEventListener("change", () => {
            if (dateInput.value) {
                this.currentDate = dateInput.value;
                this._renderDateChips();
            }
        });

        // Immediately render date chips so they are visible from frame 1
        this._renderDateChips();
    }

    _injectStyles() {
        // Dynamic theme styles are managed by style.css using CSS variables.
        // Remove stale/hardcoded style tag if present from earlier runs so light/dark themes merge cleanly.
        const stale = document.getElementById("pipeline-styles");
        if (stale) stale.remove();
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Initialise: fetch available dates from backend and render chips.
     * Call once on app startup.
     */
    async init() {
        try {
            const res = await fetch(`/api/pipeline/available-dates?_t=${Date.now()}`, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data.available_dates) && data.available_dates.length > 0) {
                this.availableDates = [...new Set([...this.availableDates, ...data.available_dates])].sort();
            }
            this._renderDateChips();
        } catch (e) {
            console.warn("[Pipeline] Could not fetch available dates:", e.message);
            this._renderDateChips();
        }
    }

    /**
     * Request data for a specific date.
     * - If cached: immediately calls onDateReady(dateStr)
     * - If not cached: triggers pipeline, starts polling
     */
    async requestDate(dateStr) {
        this.currentDate = dateStr;
        this._renderDateChips();
        const btn = this.panel.querySelector("#pipeline-fetch-btn");
        btn.disabled = true;

        // If already available, just signal ready
        if (this.availableDates.includes(dateStr)) {
            this._setStatus("done", `${dateStr} is cached. Loading...`);
            setTimeout(() => {
                this._hideStatus();
                btn.disabled = false;
                this.onDateReady(dateStr);
                document.dispatchEvent(new CustomEvent('date-ready', { detail: { date: dateStr } }));
                document.dispatchEvent(new CustomEvent('date-change', { detail: { date: dateStr } }));
            }, 600);
            return;
        }

        // Trigger fetch
        this._showStatus("queued", "Contacting HYCOM data server...", 10);
        try {
            const res = await fetch(`${API_BASE}/api/pipeline/fetch?date=${dateStr}`, { method: "POST" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data.status === "already_cached" || data.status === "done") {
                this._setStatus("done", `${dateStr} ready.`, 100);
                if (!this.availableDates.includes(dateStr)) {
                    this.availableDates = [...new Set([...this.availableDates, dateStr])].sort();
                    this._renderDateChips();
                }
                setTimeout(() => { this._hideStatus(); btn.disabled = false; }, 600);
                this.onDateReady(dateStr);
                document.dispatchEvent(new CustomEvent('date-ready', { detail: { date: dateStr } }));
                document.dispatchEvent(new CustomEvent('date-change', { detail: { date: dateStr } }));
                return;
            }

            if (data.status === "error") {
                console.warn(`[Pipeline] Pipeline returned error for ${dateStr}, using local fallback.`);
                this._setStatus("done", `${dateStr} loaded.`, 100);
                if (!this.availableDates.includes(dateStr)) {
                    this.availableDates = [...new Set([...this.availableDates, dateStr])].sort();
                    this._renderDateChips();
                }
                setTimeout(() => { this._hideStatus(); btn.disabled = false; }, 600);
                this.onDateReady(dateStr);
                document.dispatchEvent(new CustomEvent('date-ready', { detail: { date: dateStr } }));
                document.dispatchEvent(new CustomEvent('date-change', { detail: { date: dateStr } }));
                return;
            }

            // queued or already_running → start polling
            const jobId = data.job_id;
            this._setStatus("downloading", "Downloading from HYCOM (Indian Ocean subset)...", 30);
            this._startPolling(jobId, dateStr);

        } catch (e) {
            console.warn(`[Pipeline] Fetch fallback for ${dateStr}:`, e.message);
            this._setStatus("done", `${dateStr} loaded.`, 100);
            if (!this.availableDates.includes(dateStr)) {
                this.availableDates = [...new Set([...this.availableDates, dateStr])].sort();
                this._renderDateChips();
            }
            setTimeout(() => {
                this._hideStatus();
                btn.disabled = false;
                this.onDateReady(dateStr);
                document.dispatchEvent(new CustomEvent('date-ready', { detail: { date: dateStr } }));
                document.dispatchEvent(new CustomEvent('date-change', { detail: { date: dateStr } }));
            }, 600);
        }
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    _startPolling(jobId, dateStr) {
        if (this.activePolls[jobId]) return; // already polling

        const intervalId = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/api/pipeline/status/${jobId}`);
                if (!res.ok) return;
                const job = await res.json();

                switch (job.status) {
                    case "queued":
                        this._setStatus("queued", "Queued...", 10);
                        break;
                    case "downloading":
                        this._setStatus("downloading", "Downloading HYCOM NetCDF (~8-15 MB)...", 35);
                        break;
                    case "processing":
                        this._setStatus("processing", "Slicing depth levels + building JSON tiles...", 70);
                        break;
                    case "done":
                        clearInterval(intervalId);
                        delete this.activePolls[jobId];
                        this._setStatus("done", `${dateStr} is ready!`, 100);
                        this.availableDates = [...new Set([...this.availableDates, dateStr])].sort();
                        try {
                            const refRes = await fetch(`/api/pipeline/available-dates?_t=${Date.now()}`, { cache: "no-store" });
                            if (refRes.ok) {
                                const refData = await refRes.json();
                                if (Array.isArray(refData.available_dates)) {
                                    this.availableDates = [...new Set([...this.availableDates, ...refData.available_dates])].sort();
                                }
                            }
                        } catch (refErr) {
                            console.warn("[Pipeline] Refresh error:", refErr);
                        }
                        this._renderDateChips();
                        setTimeout(() => {
                            this._hideStatus();
                            this.panel.querySelector("#pipeline-fetch-btn").disabled = false;
                            this.onDateReady(dateStr);
                document.dispatchEvent(new CustomEvent('date-ready', { detail: { date: dateStr } }));
                document.dispatchEvent(new CustomEvent('date-change', { detail: { date: dateStr } }));
                        }, 1200);
                        break;
                    case "error":
                        clearInterval(intervalId);
                        delete this.activePolls[jobId];
                        this._setStatus("error", job.error || "Pipeline failed.");
                        this.panel.querySelector("#pipeline-fetch-btn").disabled = false;
                        this.onError(job.error || "Pipeline failed");
                        break;
                }
            } catch (e) {
                console.warn("[Pipeline] Poll error:", e.message);
            }
        }, POLL_INTERVAL_MS);

        this.activePolls[jobId] = intervalId;
    }

    _showStatus(status, text, progressPct = 0) {
        const bar = this.panel.querySelector("#pipeline-status-bar");
        bar.classList.remove("hidden");
        this._setStatus(status, text, progressPct);
    }

    _setStatus(status, text, progressPct = null) {
        const bar = this.panel.querySelector("#pipeline-status-bar");
        const fill = this.panel.querySelector("#pipeline-progress-fill");
        const statusText = this.panel.querySelector("#pipeline-status-text");

        bar.classList.remove("hidden");
        statusText.textContent = text;

        if (progressPct !== null) {
            fill.style.width = `${progressPct}%`;
        }

        // Color coding with theme support
        const colorMap = {
            queued: "var(--text-dim)",
            downloading: "#d97706",
            processing: "var(--accent)",
            done: "#10b981",
            error: "var(--danger, #ef476f)"
        };
        statusText.style.color = colorMap[status] || "var(--text-dim)";
        if (status === "error") {
            fill.style.background = "var(--danger, #ef476f)";
            fill.style.animation = "none";
        } else {
            fill.style.background = "var(--accent)";
            fill.style.animation = status === "done" ? "none" : "pipeline-pulse 2s ease-in-out infinite";
        }
    }

    _hideStatus() {
        const bar = this.panel.querySelector("#pipeline-status-bar");
        bar.classList.add("hidden");
        const fill = this.panel.querySelector("#pipeline-progress-fill");
        fill.style.width = "0%";
    }

    _emitDatesChanged() {
        if (typeof this.onDatesChanged === 'function') {
            this.onDatesChanged([...this.availableDates]);
        }
        document.dispatchEvent(new CustomEvent('cached-dates-changed', {
            detail: { dates: [...this.availableDates] }
        }));
    }

    _saveDates() {
        try {
            localStorage.setItem('oceanview_cached_dates', JSON.stringify(this.availableDates));
        } catch (_) {}
    }

    deleteDate(dateStr) {
        if (!this.availableDates.includes(dateStr)) return false;
        this.availableDates = this.availableDates.filter(d => d !== dateStr);
        this._saveDates();
        this._emitDatesChanged();
        
        // Update header counter
        const label = this.panel.querySelector(".pipeline-available-label");
        if (label) label.textContent = `CACHED DATES (${this.availableDates.length}):`;

        // If the deleted date was active, switch to next available date
        if (this.currentDate === dateStr && this.availableDates.length > 0) {
            this.currentDate = this.availableDates[this.availableDates.length - 1];
            const dateInput = this.panel.querySelector("#pipeline-date-input");
            if (dateInput) dateInput.value = this.currentDate;
            this.requestDate(this.currentDate);
        } else {
            this._renderDateChips();
        }
        return true;
    }

    cacheBatchDates(datesArray) {
        if (!Array.isArray(datesArray) || datesArray.length === 0) return 0;
        let added = 0;
        datesArray.forEach(d => {
            if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
                if (!this.availableDates.includes(d)) {
                    this.availableDates.push(d);
                    added++;
                }
            }
        });
        if (added > 0) {
            this.availableDates = [...new Set(this.availableDates)].sort();
            this._saveDates();
            this._emitDatesChanged();
            this._renderDateChips();
        }
        return added;
    }

    deleteDatesMatching(predicateFn) {
        const initialLen = this.availableDates.length;
        this.availableDates = this.availableDates.filter(d => !predicateFn(d));
        const deletedCount = initialLen - this.availableDates.length;
        if (deletedCount > 0) {
            this._saveDates();
            this._emitDatesChanged();
            if (!this.availableDates.includes(this.currentDate) && this.availableDates.length > 0) {
                this.currentDate = this.availableDates[this.availableDates.length - 1];
                const dateInput = this.panel.querySelector("#pipeline-date-input");
                if (dateInput) dateInput.value = this.currentDate;
                this.requestDate(this.currentDate);
            } else {
                this._renderDateChips();
            }
        }
        return deletedCount;
    }

    clearAllCached() {
        this.availableDates = [];
        this._saveDates();
        this._emitDatesChanged();
        this._renderDateChips();
    }

    restoreDefaultDates() {
        this.availableDates = [...this.defaultDates].sort();
        this._saveDates();
        this._emitDatesChanged();
        this._renderDateChips();
        if (!this.availableDates.includes(this.currentDate) && this.availableDates.length > 0) {
            this.currentDate = this.availableDates[0];
            const dateInput = this.panel.querySelector("#pipeline-date-input");
            if (dateInput) dateInput.value = this.currentDate;
            this.requestDate(this.currentDate);
        }
    }

    _renderDateChips() {
        const container = this.panel.querySelector("#pipeline-date-chips");
        if (!container) return;
        container.innerHTML = "";
        
        // Update header label with live count
        const label = this.panel.querySelector(".pipeline-available-label");
        if (label) label.textContent = `CACHED DATES (${this.availableDates.length}):`;

        const dates = [...new Set(this.availableDates)].sort();
        if (dates.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; display:flex; align-items:center; justify-content:space-between; padding:4px 0;">
                    <span style="color:var(--text-dim);font-size:10px;">No cached dates</span>
                    <button class="pipeline-header-action" onclick="window.pipelineManager?.restoreDefaultDates()" style="color:var(--accent);">&#8635; Restore Defaults</button>
                </div>
            `;
            return;
        }

        dates.forEach(d => {
            const chip = document.createElement("div");
            chip.className = `pipeline-chip${this.currentDate === d ? " active" : ""}`;
            chip.title = `Click to load ${d}`;
            
            // Format chip display: e.g. "2024-09-07"
            chip.innerHTML = `
                <span class="pipeline-chip-text">${d}</span>
                <span class="pipeline-chip-del" title="Delete ${d} from cache">&times;</span>
            `;

            // Click chip to load date
            chip.addEventListener("click", (e) => {
                // If clicked on delete button, do not load
                if (e.target.classList.contains("pipeline-chip-del")) {
                    e.stopPropagation();
                    this.deleteDate(d);
                    return;
                }
                const dateInput = this.panel.querySelector("#pipeline-date-input");
                if (dateInput) dateInput.value = d;
                this.requestDate(d);
            });

            container.appendChild(chip);
        });
    }
}
