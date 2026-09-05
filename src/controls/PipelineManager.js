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
    constructor({ onDateReady, onError } = {}) {
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
                    <span class="pipeline-icon">🌊</span>
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
                    <button id="pipeline-reset-cache-btn" class="pipeline-header-action" title="Restore all default cached dates">↺ Reset</button>
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
        if (document.getElementById("pipeline-styles")) return;
        const style = document.createElement("style");
        style.id = "pipeline-styles";
        style.textContent = `
            #pipeline-panel {
                background: rgba(10, 10, 46, 0.9);
                border: 1px solid rgba(0, 212, 170, 0.25);
                border-radius: 10px;
                padding: 14px 16px 12px;
                margin-top: 16px;
                font-family: 'Inter', 'Segoe UI', sans-serif;
                font-size: 12px;
                color: #e0e0e0;
                backdrop-filter: blur(12px);
            }
            .pipeline-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 10px;
            }
            .pipeline-icon { font-size: 16px; }
            .pipeline-title {
                font-size: 13px;
                font-weight: 600;
                color: #00d4aa;
                flex: 1;
            }
            .pipeline-badge {
                font-size: 9px;
                font-weight: 700;
                background: rgba(0, 212, 170, 0.15);
                border: 1px solid rgba(0, 212, 170, 0.4);
                color: #00d4aa;
                border-radius: 4px;
                padding: 2px 6px;
                letter-spacing: 0.5px;
            }
            .pipeline-date-row {
                display: flex;
                gap: 6px;
                margin-bottom: 10px;
            }
            #pipeline-date-input {
                flex: 1;
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(0, 212, 170, 0.3);
                border-radius: 6px;
                color: #e0e0e0;
                padding: 6px 10px;
                font-size: 12px;
                outline: none;
                transition: border-color 0.2s;
            }
            #pipeline-date-input:focus {
                border-color: #00d4aa;
            }
            #pipeline-date-input::-webkit-calendar-picker-indicator {
                filter: invert(1) opacity(0.6);
                cursor: pointer;
            }
            #pipeline-fetch-btn {
                background: linear-gradient(135deg, #00d4aa, #0099cc);
                border: none;
                border-radius: 6px;
                color: #0a0a2e;
                font-weight: 700;
                font-size: 12px;
                padding: 6px 14px;
                cursor: pointer;
                transition: transform 0.15s, opacity 0.2s;
                white-space: nowrap;
            }
            #pipeline-fetch-btn:hover { transform: scale(1.04); }
            #pipeline-fetch-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

            .pipeline-status { margin-bottom: 10px; }
            .pipeline-status.hidden { display: none; }
            .pipeline-progress-track {
                background: rgba(255,255,255,0.08);
                border-radius: 4px;
                height: 5px;
                overflow: hidden;
                margin-bottom: 5px;
            }
            .pipeline-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #00d4aa, #0099cc);
                border-radius: 4px;
                width: 0%;
                transition: width 0.5s ease;
                animation: pipeline-pulse 2s ease-in-out infinite;
            }
            @keyframes pipeline-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }
            .pipeline-status-text {
                font-size: 11px;
                color: #a0c4ff;
                font-style: italic;
            }
            .pipeline-available-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 6px;
            }
            .pipeline-available-label {
                font-size: 10px;
                color: rgba(255,255,255,0.5);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .pipeline-header-action {
                background: transparent;
                border: none;
                color: rgba(0, 212, 170, 0.7);
                font-size: 9.5px;
                cursor: pointer;
                padding: 1px 4px;
                border-radius: 3px;
                transition: color 0.15s, background 0.15s;
            }
            .pipeline-header-action:hover {
                color: #00d4aa;
                background: rgba(0, 212, 170, 0.15);
            }
            .pipeline-date-chips {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 6px;
                max-height: 90px;
                overflow-y: auto;
                padding-right: 4px;
                scrollbar-width: thin;
                scrollbar-color: rgba(0, 212, 170, 0.4) transparent;
            }
            .pipeline-date-chips::-webkit-scrollbar {
                width: 4px;
            }
            .pipeline-date-chips::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.03);
                border-radius: 2px;
            }
            .pipeline-date-chips::-webkit-scrollbar-thumb {
                background: rgba(0, 212, 170, 0.4);
                border-radius: 2px;
            }
            .pipeline-date-chips::-webkit-scrollbar-thumb:hover {
                background: rgba(0, 212, 170, 0.7);
            }
            .pipeline-chip {
                background: rgba(0, 212, 170, 0.09);
                border: 1px solid rgba(0, 212, 170, 0.25);
                border-radius: 5px;
                padding: 4px 6px 4px 8px;
                font-size: 11px;
                font-family: 'Inter', 'Segoe UI', sans-serif;
                color: #00d4aa;
                cursor: pointer;
                transition: all 0.15s ease;
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-width: 0;
                user-select: none;
            }
            .pipeline-chip:hover {
                background: rgba(0, 212, 170, 0.22);
                border-color: rgba(0, 212, 170, 0.5);
            }
            .pipeline-chip.active {
                background: rgba(0, 212, 170, 0.32);
                border-color: #00d4aa;
                font-weight: 600;
                box-shadow: 0 0 6px rgba(0, 212, 170, 0.25);
            }
            .pipeline-chip-text {
                font-size: 10.5px;
                font-weight: 500;
                letter-spacing: 0.2px;
                white-space: nowrap;
                flex: 1;
                text-align: left;
            }
            .pipeline-chip-del {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                color: rgba(255, 255, 255, 0.4);
                font-size: 12px;
                line-height: 1;
                margin-left: 4px;
                transition: color 0.15s, background 0.15s;
                flex-shrink: 0;
            }
            .pipeline-chip-del:hover {
                color: #ef476f;
                background: rgba(239, 71, 111, 0.25);
            }
        `;
        document.head.appendChild(style);
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

        // Color coding
        const colorMap = {
            queued: "#a0c4ff",
            downloading: "#ffd166",
            processing: "#00d4aa",
            done: "#06d6a0",
            error: "#ef476f"
        };
        statusText.style.color = colorMap[status] || "#a0c4ff";
        if (status === "error") {
            fill.style.background = "#ef476f";
            fill.style.animation = "none";
        } else {
            fill.style.background = "linear-gradient(90deg, #00d4aa, #0099cc)";
            fill.style.animation = status === "done" ? "none" : "pipeline-pulse 2s ease-in-out infinite";
        }
    }

    _hideStatus() {
        const bar = this.panel.querySelector("#pipeline-status-bar");
        bar.classList.add("hidden");
        const fill = this.panel.querySelector("#pipeline-progress-fill");
        fill.style.width = "0%";
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
        this._renderDateChips();
    }

    restoreDefaultDates() {
        this.availableDates = [...this.defaultDates].sort();
        this._saveDates();
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
                    <span style="color:rgba(255,255,255,0.4);font-size:10px;">No cached dates</span>
                    <button class="pipeline-header-action" onclick="window.pipelineManager?.restoreDefaultDates()" style="color:#00d4aa;">↺ Restore Defaults</button>
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
