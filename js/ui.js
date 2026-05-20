/**
 * UI
 * ===
 * Manages all DOM interactions, visual updates, and event wiring.
 *
 * Responsibilities:
 *   - Bind user-initiated events and invoke provided callbacks
 *   - Update status badges, page navigation, count badges
 *   - Show/hide the loading overlay
 *   - Render checkbox overlays on the overlay canvas
 *   - Display JSON results and debug details
 *   - Trigger file download for JSON and CSV exports
 *   - Show Bootstrap toast notifications
 *
 * All DOM element references are resolved once in the constructor.
 * No business logic lives here — only display and event delegation.
 */
class UI {

    constructor() {
        // ---- Canvas ----
        this.pdfCanvas      = this._el('pdfCanvas');
        this.overlayCanvas  = this._el('overlayCanvas');
        this.canvasContainer = this._el('canvasContainer');
        this.emptyState     = this._el('emptyState');

        // ---- File inputs ----
        this.pdfInput       = this._el('pdfInput');
        this.templateInput  = this._el('templateInput');

        // ---- Buttons ----
        this.loadExampleBtn = this._el('loadExampleTemplate');
        this.analyzeBtn     = this._el('analyzeBtn');
        this.exportJsonBtn  = this._el('exportJsonBtn');
        this.exportCsvBtn   = this._el('exportCsvBtn');
        this.prevPageBtn    = this._el('prevPage');
        this.nextPageBtn    = this._el('nextPage');

        // ---- Sliders ----
        this.renderScaleSlider = this._el('renderScale');
        this.thresholdSlider   = this._el('thresholdSlider');
        this.ratioSlider       = this._el('ratioSlider');

        // ---- Checkboxes / Selects ----
        this.morphOpsCheck    = this._el('morphOps');
        this.morphTypeWrapper = this._el('morphTypeWrapper');
        this.morphTypeSelect  = this._el('morphType');
        this.showOverlayCheck = this._el('showOverlay');
        this.showDebugCheck   = this._el('showDebugInfo');

        // ---- Display spans ----
        this.statusBadge       = this._el('statusBadge');
        this.scaleValueSpan    = this._el('scaleValue');
        this.thresholdValueSpan = this._el('thresholdValue');
        this.ratioValueSpan    = this._el('ratioValue');
        this.pageInfo          = this._el('pageInfo');
        this.pageNav           = this._el('pageNav');
        this.checkedCount      = this._el('checkedCount');
        this.uncheckedCount    = this._el('uncheckedCount');
        this.pdfInfo           = this._el('pdfInfo');
        this.templateInfo      = this._el('templateInfo');

        // ---- Output areas ----
        this.jsonOutput  = this._el('jsonOutput');
        this.debugOutput = this._el('debugOutput');
        this.debugCard   = this._el('debugCard');

        // ---- Overlay ----
        this.loadingOverlay  = this._el('loadingOverlay');
        this.loadingMessage  = this._el('loadingMessage');
        this.toastContainer  = this._el('toastContainer');

        // Wire up live slider label updates and toggle controls
        this._initInternalListeners();
    }

    // ================================================================
    // Internal helpers
    // ================================================================

    /**
     * Shorthand for getElementById with a dev-friendly error.
     * @param {string} id
     * @returns {HTMLElement}
     * @private
     */
    _el(id) {
        const el = document.getElementById(id);
        if (!el) console.warn(`[UI] Element nicht gefunden: #${id}`);
        return el;
    }

    /**
     * Set up slider value labels and morphological ops toggle.
     * @private
     */
    _initInternalListeners() {
        // Live update of slider value labels while dragging
        this.renderScaleSlider.addEventListener('input', () => {
            this.scaleValueSpan.textContent =
                parseFloat(this.renderScaleSlider.value).toFixed(1);
        });
        this.thresholdSlider.addEventListener('input', () => {
            this.thresholdValueSpan.textContent = this.thresholdSlider.value;
        });
        this.ratioSlider.addEventListener('input', () => {
            this.ratioValueSpan.textContent =
                parseFloat(this.ratioSlider.value).toFixed(2);
        });

        // Show/hide morph type selector when morph ops are toggled
        this.morphOpsCheck.addEventListener('change', () => {
            this.morphTypeWrapper.style.display =
                this.morphOpsCheck.checked ? '' : 'none';
        });

        // Show/hide debug card
        this.showDebugCheck.addEventListener('change', () => {
            this.debugCard.style.display =
                this.showDebugCheck.checked ? '' : 'none';
        });
    }

    // ================================================================
    // Event Binding (called by App)
    // ================================================================

    /** @param {function(File):void} callback */
    onPDFUpload(callback) {
        this.pdfInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) callback(file);
        });
    }

    /** @param {function(File):void} callback */
    onTemplateUpload(callback) {
        this.templateInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) callback(file);
        });
    }

    /** @param {function():void} callback */
    onLoadExampleTemplate(callback) {
        this.loadExampleBtn.addEventListener('click', callback);
    }

    /** @param {function():void} callback */
    onAnalyze(callback) {
        this.analyzeBtn.addEventListener('click', callback);
    }

    /** @param {function():void} callback */
    onExportJSON(callback) {
        this.exportJsonBtn.addEventListener('click', callback);
    }

    /** @param {function():void} callback */
    onExportCSV(callback) {
        this.exportCsvBtn.addEventListener('click', callback);
    }

    /** @param {function():void} callback */
    onPrevPage(callback) {
        this.prevPageBtn.addEventListener('click', callback);
    }

    /** @param {function():void} callback */
    onNextPage(callback) {
        this.nextPageBtn.addEventListener('click', callback);
    }

    /**
     * Fires when the render scale slider is released (change, not input).
     * @param {function(number):void} callback
     */
    onScaleChange(callback) {
        this.renderScaleSlider.addEventListener('change', () => {
            callback(parseFloat(this.renderScaleSlider.value));
        });
    }

    /** @param {function(number):void} callback */
    onThresholdChange(callback) {
        this.thresholdSlider.addEventListener('change', () => {
            callback(parseInt(this.thresholdSlider.value, 10));
        });
    }

    /** @param {function(number):void} callback */
    onRatioChange(callback) {
        this.ratioSlider.addEventListener('change', () => {
            callback(parseFloat(this.ratioSlider.value));
        });
    }

    /** @param {function(boolean):void} callback */
    onMorphOpsChange(callback) {
        this.morphOpsCheck.addEventListener('change', () => {
            callback(this.morphOpsCheck.checked);
        });
    }

    /** @param {function(boolean):void} callback */
    onShowOverlayChange(callback) {
        this.showOverlayCheck.addEventListener('change', () => {
            callback(this.showOverlayCheck.checked);
        });
    }

    // ================================================================
    // State / Display Updates
    // ================================================================

    /**
     * Update the top-right status badge.
     *
     * @param {string} text
     * @param {'primary'|'success'|'danger'|'warning'|'secondary'|'info'} [type='secondary']
     */
    setStatus(text, type = 'secondary') {
        this.statusBadge.textContent = text;
        this.statusBadge.className   = `badge bg-${type}`;
    }

    /**
     * Show a short info line below the PDF file input.
     * @param {string} text
     */
    setPdfInfo(text) {
        this.pdfInfo.textContent = text;
    }

    /**
     * Show/hide the analyze button.
     * @param {boolean} enabled
     */
    setAnalyzeEnabled(enabled) {
        this.analyzeBtn.disabled = !enabled;
    }

    /**
     * Show/hide the export buttons.
     * @param {boolean} enabled
     */
    setExportEnabled(enabled) {
        this.exportJsonBtn.disabled = !enabled;
        this.exportCsvBtn.disabled  = !enabled;
    }

    /**
     * Update page navigation visibility and labels.
     *
     * @param {boolean} visible
     * @param {number}  current  - 1-based current page
     * @param {number}  total    - Total page count
     */
    updatePageNav(visible, current, total) {
        this.pageNav.style.display      = visible ? '' : 'none';
        this.pageInfo.textContent       = `Seite ${current} / ${total}`;
        this.prevPageBtn.disabled       = current <= 1;
        this.nextPageBtn.disabled       = current >= total;
    }

    /**
     * Display template metadata below the template input.
     * @param {Object} template
     */
    showTemplateInfo(template) {
        this.templateInfo.textContent =
            `✓ "${template.name}" – ${template.fields.length} Feld(er)`;
    }

    /**
     * Transition from the empty-state placeholder to the canvas view.
     */
    showCanvas() {
        this.emptyState.style.display      = 'none';
        this.canvasContainer.style.display = 'inline-block';
    }

    /**
     * Display the loading overlay with a message.
     * @param {string} [message='Lädt...']
     */
    showLoading(message = 'Lädt...') {
        this.loadingMessage.textContent  = message;
        this.loadingOverlay.style.display = 'flex';
    }

    /** Hide the loading overlay. */
    hideLoading() {
        this.loadingOverlay.style.display = 'none';
    }

    /**
     * Render detection results: JSON output, debug table, count badges.
     *
     * @param {Object}              json          - Flat {id: boolean} result
     * @param {Array<DetectionResult>} detailResults - Full result objects
     */
    showResults(json, detailResults) {
        // Pretty-print JSON
        this.jsonOutput.textContent = JSON.stringify(json, null, 2);

        // Update count badges
        const checked   = detailResults.filter(r => r.checked).length;
        const unchecked = detailResults.filter(r => !r.checked).length;
        this.checkedCount.textContent   = `${checked} angekreuzt`;
        this.uncheckedCount.textContent = `${unchecked} leer`;

        // Render debug rows
        this._renderDebugTable(detailResults);

        this.setExportEnabled(true);
    }

    /**
     * Render a compact debug table showing per-field ratios.
     * @param {Array<DetectionResult>} results
     * @private
     */
    _renderDebugTable(results) {
        this.debugOutput.innerHTML = '';

        for (const r of results) {
            const pct     = Math.round(r.ratio * 100);
            const color   = r.checked ? '#198754' : '#dc3545';
            const bgColor = r.checked ? '#d1e7dd' : '#f8d7da';

            const row = document.createElement('div');
            row.className = 'debug-row';
            row.style.background = r.checked ? '#f0fff4' : '#fff5f5';

            row.innerHTML = `
                <span class="field-id" title="${r.id}">${r.id}</span>
                <div class="ratio-bar-wrap">
                    <div class="ratio-bar"
                         style="width:${Math.min(100, pct * 2)}%; background:${color};">
                    </div>
                </div>
                <span class="ratio-value" style="color:${color};">${pct}%</span>
                <span class="badge" style="background:${color}; font-size:0.65rem;">
                    ${r.checked ? 'JA' : 'NEIN'}
                </span>
            `;

            this.debugOutput.appendChild(row);
        }
    }

    // ================================================================
    // Overlay Drawing
    // ================================================================

    /**
     * Draw coloured rectangles over checkbox regions on the overlay canvas.
     *
     * Green  = checkbox detected as CHECKED
     * Red    = checkbox detected as EMPTY
     *
     * @param {Array} enrichedResults - DetectionResult objects extended with
     *                                  a `scaledField` property containing
     *                                  {x, y, width, height} in canvas coords
     * @param {boolean} show          - Whether to render the overlay at all
     */
    drawOverlay(enrichedResults, show) {
        const overlay = this.overlayCanvas;
        const pdf     = this.pdfCanvas;

        // Match overlay canvas size to PDF canvas size
        overlay.width  = pdf.width;
        overlay.height = pdf.height;

        // Hide overlay if not requested
        overlay.style.display = show && enrichedResults.length > 0 ? 'block' : 'none';
        if (!show || enrichedResults.length === 0) return;

        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);

        for (const result of enrichedResults) {
            if (!result.scaledField) continue;

            const { x, y, width, height } = result.scaledField;
            const isChecked = result.checked;

            // Choose colors
            const strokeColor = isChecked ? '#00b300' : '#cc0000';
            const fillColor   = isChecked
                ? 'rgba(0, 179, 0, 0.12)'
                : 'rgba(204, 0, 0, 0.08)';

            // Fill
            ctx.fillStyle = fillColor;
            ctx.fillRect(x, y, width, height);

            // Border (2px)
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth   = 2;
            ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);

            // Small ratio label below the box
            const fontSize  = Math.max(9, Math.min(13, height * 0.45));
            const labelText = `${(result.ratio * 100).toFixed(1)}%`;

            ctx.font         = `bold ${fontSize}px monospace`;
            ctx.fillStyle    = strokeColor;
            ctx.fillText(labelText, x + 2, y + height + fontSize + 1);
        }
    }

    // ================================================================
    // File Download
    // ================================================================

    /**
     * Trigger a browser file download.
     *
     * @param {string} content   - File content as a string
     * @param {string} filename  - Suggested file name
     * @param {string} mimeType  - MIME type string
     */
    triggerDownload(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url  = URL.createObjectURL(blob);

        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Revoke after a short delay to let the download start
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ================================================================
    // Toast Notifications
    // ================================================================

    /**
     * Show a self-dismissing Bootstrap toast.
     *
     * @param {string} message
     * @param {'success'|'danger'|'warning'|'info'} [type='info']
     * @param {number}  [delay=3500]  - Auto-hide delay in ms
     */
    showToast(message, type = 'info', delay = 3500) {
        const toastEl = document.createElement('div');
        toastEl.className = `toast align-items-center text-bg-${type} border-0`;
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto"
                        data-bs-dismiss="toast" aria-label="Schließen"></button>
            </div>
        `;

        this.toastContainer.appendChild(toastEl);

        const bsToast = new bootstrap.Toast(toastEl, { delay });
        bsToast.show();

        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    }

    // ================================================================
    // Configuration Snapshot
    // ================================================================

    /**
     * Read current UI control values and return them as a config object.
     * Used by App to pass settings into processing modules.
     *
     * @returns {{
     *   renderScale:      number,
     *   thresholdValue:   number,
     *   blackPixelRatio:  number,
     *   morphologicalOps: boolean,
     *   morphType:        string,
     *   showOverlay:      boolean,
     *   showDebug:        boolean,
     * }}
     */
    getConfig() {
        return {
            renderScale:      parseFloat(this.renderScaleSlider.value),
            thresholdValue:   parseInt(this.thresholdSlider.value, 10),
            blackPixelRatio:  parseFloat(this.ratioSlider.value),
            morphologicalOps: this.morphOpsCheck.checked,
            morphType:        this.morphTypeSelect.value,
            showOverlay:      this.showOverlayCheck.checked,
            showDebug:        this.showDebugCheck.checked,
        };
    }
}
