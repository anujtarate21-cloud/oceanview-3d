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
const API_BASE = "http://localhost:8000";

export class PipelineManager {
    /**
     * @param {Object} options
     * @param {Function} options.onDateReady - Called with (dateStr) when tiles become available
     * @param {Function} options.onError     - Called with (message) on pipeline errors
     */
    constructor({ onDateReady, onError } = {}) {
        this.onDateReady = onDateReady || (() => {});
        this.onError = onError || ((msg) => console.error("[Pipeline]", msg));
        this.availableDates = [];
        this.activePolls = {}; // { job_id: intervalId }
        this._injectStyles();
        this._buildUI();
    }

    // ─── UI Construction ──────────────────────────────────────────────────────

    _buildUI() {
        // Pipeline panel (injected into sidebar)
        this.panel = document.createElement("div");
        this.panel.id = "pipeline-panel";
        this.panel.innerHTML = `
            <div class="pipeline-header">
                <span class="pipeline-icon">🌊</span>
                <span class="pipeline-title">Date Navigator</span>
                <span class="pipeline-badge" id="pipeline-badge">LIVE</span>
            </div>
            <div class="pipeline-date-row">
                <input type="date" id="pipeline-date-input" 
                       min="2018-01-01" max="${new Date().toISOString().slice(0, 10)}"
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
            <div class="pipeline-available-label">Cached dates:</div>
            <div id="pipeline-date-chips" class="pipeline-date-chips"></div>
        `;

        // Wire events
        this.panel.querySelector("#pipeline-fetch-btn").addEventListener("click", () => {
            const dateInput = this.panel.querySelector("#pipeline-date-input");
            if (dateInput.value) this.requestDate(dateInput.value);
        });

        // Allow Enter key in date input
        this.panel.querySelector("#pipeline-date-input").addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const dateInput = this.panel.querySelector("#pipeline-date-input");
                if (dateInput.value) this.requestDate(dateInput.value);
            }
        });

        // Attach cleanly right before time-section or legend-section inside sidebar
        const sidebar = document.querySelector("#sidebar") || document.querySelector(".sidebar");
        const timeSection = document.getElementById("time-section");
        if (sidebar) {
            if (timeSection && timeSection.parentNode === sidebar) {
                sidebar.insertBefore(this.panel, timeSection);
            } else {
                sidebar.appendChild(this.panel);
            }
        } else {
            // Floating fallback
            this.panel.style.cssText = `
                position: fixed; bottom: 20px; left: 20px; z-index: 9999;
                width: 280px;
            `;
            document.body.appendChild(this.panel);
        }
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
            .pipeline-available-label {
                font-size: 10px;
                color: rgba(255,255,255,0.4);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 6px;
            }
            .pipeline-date-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
            }
            .pipeline-chip {
                background: rgba(0, 212, 170, 0.12);
                border: 1px solid rgba(0, 212, 170, 0.3);
                border-radius: 4px;
                padding: 3px 8px;
                font-size: 10px;
                color: #00d4aa;
                cursor: pointer;
                transition: background 0.15s;
                white-space: nowrap;
            }
            .pipeline-chip:hover {
                background: rgba(0, 212, 170, 0.25);
            }
            .pipeline-chip.active {
                background: rgba(0, 212, 170, 0.3);
                border-color: #00d4aa;
                font-weight: 600;
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
            const res = await fetch(`${API_BASE}/api/pipeline/available-dates`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.availableDates = data.available_dates || [];
            this._renderDateChips();
        } catch (e) {
            console.warn("[Pipeline] Could not fetch available dates:", e.message);
        }
    }

    /**
     * Request data for a specific date.
     * - If cached: immediately calls onDateReady(dateStr)
     * - If not cached: triggers pipeline, starts polling
     */
    async requestDate(dateStr) {
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
        this._showStatus("queued", "Contacting HYCOM data server...", 5);
        try {
            const res = await fetch(`${API_BASE}/api/pipeline/fetch?date=${dateStr}`, { method: "POST" });
            const data = await res.json();

            if (data.status === "already_cached") {
                this._setStatus("done", `${dateStr} ready.`);
                setTimeout(() => { this._hideStatus(); btn.disabled = false; }, 800);
                this.onDateReady(dateStr);
                return;
            }

            if (data.status === "error") {
                this._setStatus("error", data.message || "Pipeline error.");
                btn.disabled = false;
                return;
            }

            // queued or already_running → start polling
            const jobId = data.job_id;
            this._setStatus("downloading", "Downloading from HYCOM (Indian Ocean subset)...", 20);
            this._startPolling(jobId, dateStr);

        } catch (e) {
            this._setStatus("error", `Network error: ${e.message}`);
            btn.disabled = false;
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
                        this.availableDates.push(dateStr);
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

    _renderDateChips() {
        const container = this.panel.querySelector("#pipeline-date-chips");
        container.innerHTML = "";
        if (this.availableDates.length === 0) {
            container.innerHTML = `<span style="color:rgba(255,255,255,0.3);font-size:10px;">None cached yet</span>`;
            return;
        }
        this.availableDates.slice().reverse().forEach(d => {
            const chip = document.createElement("button");
            chip.className = "pipeline-chip";
            chip.textContent = d;
            chip.title = `Load data for ${d}`;
            chip.addEventListener("click", () => {
                this.panel.querySelector("#pipeline-date-input").value = d;
                this.requestDate(d);
            });
            container.appendChild(chip);
        });
    }
}
