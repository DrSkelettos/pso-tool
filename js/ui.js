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

        // ---- v2: Marker detection controls (optional — may not exist in older index.html) ----
        this.requireMarkersCheck     = document.getElementById('requireMarkers');
        this.markerStatusBadge       = document.getElementById('markerStatusBadge');
        this.innerPaddingSlider      = document.getElementById('innerPaddingSlider');
        this.innerPaddingValueSpan   = document.getElementById('innerPaddingValue');
        this.uncertainSlider         = document.getElementById('uncertainSlider');
        this.uncertainValueSpan      = document.getElementById('uncertainValue');
        this.adaptiveBlockSizeSlider = document.getElementById('adaptiveBlockSizeSlider');
        this.adaptiveBlockSizeSpan   = document.getElementById('adaptiveBlockSizeValue');
        this.normalizedViewLabel     = document.getElementById('normalizedViewLabel');

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

        // v2 sliders (optional — only wire up if present in DOM)
        if (this.innerPaddingSlider && this.innerPaddingValueSpan) {
            this.innerPaddingSlider.addEventListener('input', () => {
                this.innerPaddingValueSpan.textContent = this.innerPaddingSlider.value;
            });
        }
        if (this.uncertainSlider && this.uncertainValueSpan) {
            this.uncertainSlider.addEventListener('input', () => {
                this.uncertainValueSpan.textContent =
                    parseFloat(this.uncertainSlider.value).toFixed(2);
            });
        }
        if (this.adaptiveBlockSizeSlider && this.adaptiveBlockSizeSpan) {
            this.adaptiveBlockSizeSlider.addEventListener('input', () => {
                this.adaptiveBlockSizeSpan.textContent = this.adaptiveBlockSizeSlider.value;
            });
        }
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

    // v2 event bindings — only wired if the element exists in the DOM

    /** @param {function():void} callback */
    onRequireMarkersChange(callback) {
        if (!this.requireMarkersCheck) return;
        this.requireMarkersCheck.addEventListener('change', callback);
    }

    /** @param {function(number):void} callback */
    onInnerPaddingChange(callback) {
        if (!this.innerPaddingSlider) return;
        this.innerPaddingSlider.addEventListener('change', () => {
            callback(parseInt(this.innerPaddingSlider.value, 10));
        });
    }

    /** @param {function(number):void} callback */
    onUncertainThresholdChange(callback) {
        if (!this.uncertainSlider) return;
        this.uncertainSlider.addEventListener('change', () => {
            callback(parseFloat(this.uncertainSlider.value));
        });
    }

    /** @param {function(number):void} callback */
    onAdaptiveBlockSizeChange(callback) {
        if (!this.adaptiveBlockSizeSlider) return;
        this.adaptiveBlockSizeSlider.addEventListener('change', () => {
            callback(parseInt(this.adaptiveBlockSizeSlider.value, 10));
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
     * @param {Object}               json          - {id: {checked, confidence, ratio, uncertain}} map
     * @param {Array<CheckboxResult>} detailResults - Full result objects
     */
    showResults(json, detailResults) {
        // Pretty-print JSON
        this.jsonOutput.textContent = JSON.stringify(json, null, 2);

        // Update count badges
        const checked   = detailResults.filter(r => r.checked).length;
        const unchecked = detailResults.filter(r => !r.checked).length;
        const uncertain = detailResults.filter(r => r.uncertain).length;
        this.checkedCount.textContent   = `${checked} angekreuzt`;
        this.uncheckedCount.textContent = `${unchecked} leer`;

        // Render debug rows
        this._renderDebugTable(detailResults);

        this.setExportEnabled(true);
    }

    /**
     * Render a compact debug table showing per-field ratios, confidence, and uncertain flag.
     * @param {Array<CheckboxResult>} results
     * @private
     */
    _renderDebugTable(results) {
        this.debugOutput.innerHTML = '';

        for (const r of results) {
            const pct  = Math.round((r.ratio ?? 0) * 100);
            const conf = Math.round((r.confidence ?? 0) * 100);

            let strokeColor, bgColor;
            if (r.uncertain) {
                strokeColor = '#b8860b';  // dark goldenrod
                bgColor     = '#fff8e1';
            } else if (r.checked) {
                strokeColor = '#198754';
                bgColor     = '#f0fff4';
            } else {
                strokeColor = '#dc3545';
                bgColor     = '#fff5f5';
            }

            const row = document.createElement('div');
            row.className = 'debug-row';
            row.style.background = bgColor;

            const uncertainBadge = r.uncertain
                ? `<span class="badge" style="background:#b8860b; font-size:0.6rem;">?</span>`
                : '';

            row.innerHTML = `
                <span class="field-id" title="${r.id}">${r.id}</span>
                <div class="ratio-bar-wrap">
                    <div class="ratio-bar"
                         style="width:${Math.min(100, pct * 2)}%; background:${strokeColor};">
                    </div>
                </div>
                <span class="ratio-value" style="color:${strokeColor};" title="Schwarz-Verhältnis">${pct}%</span>
                <span class="ratio-value" style="color:#555; font-size:0.8em;" title="Konfidenz">${conf}%</span>
                ${uncertainBadge}
                <span class="badge" style="background:${strokeColor}; font-size:0.65rem;">
                    ${r.checked ? 'JA' : 'NEIN'}
                </span>
                ${r.error ? `<span class="text-danger" style="font-size:0.7rem;" title="${r.error}">⚠</span>` : ''}
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
     * Color key:
     *   Green  = checked AND confident (confidence ≥ uncertainThreshold)
     *   Yellow = uncertain (confidence in the grey zone)
     *   Red    = empty AND confident
     *
     * @param {Array} enrichedResults - Results extended with `scaledField`
     * @param {boolean} show
     */
    drawOverlay(enrichedResults, show) {
        const overlay = this.overlayCanvas;
        const pdf     = this.pdfCanvas;

        // Match overlay canvas size to PDF canvas size
        overlay.width  = pdf.width;
        overlay.height = pdf.height;

        overlay.style.display = show && enrichedResults.length > 0 ? 'block' : 'none';
        if (!show || enrichedResults.length === 0) return;

        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);

        for (const result of enrichedResults) {
            if (!result.scaledField) continue;

            const { x, y, width, height } = result.scaledField;

            // Choose color based on checked + uncertain combination
            let strokeColor, fillColor;
            if (result.uncertain) {
                strokeColor = '#c87800';              // amber
                fillColor   = 'rgba(200, 120, 0, 0.12)';
            } else if (result.checked) {
                strokeColor = '#00b300';              // green
                fillColor   = 'rgba(0, 179, 0, 0.12)';
            } else {
                strokeColor = '#cc0000';              // red
                fillColor   = 'rgba(204, 0, 0, 0.08)';
            }

            // Fill
            ctx.fillStyle = fillColor;
            ctx.fillRect(x, y, width, height);

            // Border
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth   = 2;
            ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);

            // Small ratio label
            const fontSize  = Math.max(9, Math.min(13, height * 0.45));
            const label     = `${((result.ratio ?? 0) * 100).toFixed(1)}%`;
            ctx.font        = `bold ${fontSize}px monospace`;
            ctx.fillStyle   = strokeColor;
            ctx.fillText(label, x + 2, y + height + fontSize + 1);
        }
    }

    /**
     * Draw blue bounding boxes on the main PDF canvas for detected markers.
     * Called immediately after marker detection so the user can see which
     * corners were found.
     *
     * @param {MarkerResult} markerResult
     * @param {HTMLCanvasElement} canvas - canvas to draw on (pdfCanvas)
     */
    drawMarkerOverlay(markerResult, canvas) {
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const W   = canvas.width;
        const H   = canvas.height;

        // Draw the searched corner regions so the user can see if the search
        // area is appropriate. Inner region = dashed orange, outer = dashed red.
        const detector = window._markerDetectorRef;
        if (detector) {
            const fractions = [
                { f: detector.innerFraction, color: 'rgba(255, 165, 0, 0.35)' },
                { f: detector.outerFraction, color: 'rgba(220, 50, 50, 0.20)' },
            ];
            for (const { f, color } of fractions) {
                const rW = Math.round(W * f);
                const rH = Math.round(H * f);
                ctx.strokeStyle = color;
                ctx.lineWidth   = 1;
                ctx.setLineDash([4, 4]);
                // top-left
                ctx.strokeRect(0, 0, rW, rH);
                // top-right
                ctx.strokeRect(W - rW, 0, rW, rH);
                // bottom-left
                ctx.strokeRect(0, H - rH, rW, rH);
                // bottom-right
                ctx.strokeRect(W - rW, H - rH, rW, rH);
                ctx.setLineDash([]);
            }
        }

        const markers = [
            { marker: markerResult.topLeft,     label: 'TL' },
            { marker: markerResult.topRight,    label: 'TR' },
            { marker: markerResult.bottomLeft,  label: 'BL' },
            { marker: markerResult.bottomRight, label: 'BR' },
        ];

        for (const { marker, label } of markers) {
            if (!marker) continue;

            const { x, y, width, height } = marker.bounds;

            ctx.strokeStyle = 'rgba(0, 200, 80, 0.9)';
            ctx.lineWidth   = 2;
            ctx.strokeRect(x, y, width, height);

            // Draw centroid cross
            const cx = marker.center.x;
            const cy = marker.center.y;
            ctx.strokeStyle = 'rgba(0, 220, 100, 0.9)';
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx - 8, cy);
            ctx.lineTo(cx + 8, cy);
            ctx.moveTo(cx, cy - 8);
            ctx.lineTo(cx, cy + 8);
            ctx.stroke();

            // Label with threshold info
            const thrLabel = marker.threshold === 0 ? 'Otsu' : `t${marker.threshold}`;
            ctx.fillStyle = 'rgba(0, 160, 60, 0.95)';
            ctx.font      = 'bold 11px monospace';
            ctx.fillText(`${label} (${thrLabel})`, x + 2, y - 3);
        }

        // Mark missing corners with an X
        const cornerPixels = {
            topLeft:     { x: 20,     y: 20      },
            topRight:    { x: W - 20, y: 20      },
            bottomLeft:  { x: 20,     y: H - 20  },
            bottomRight: { x: W - 20, y: H - 20  },
        };
        for (const [key, pos] of Object.entries(cornerPixels)) {
            if (markerResult[key]) continue;
            ctx.strokeStyle = 'rgba(220, 0, 0, 0.9)';
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.moveTo(pos.x - 8, pos.y - 8);
            ctx.lineTo(pos.x + 8, pos.y + 8);
            ctx.moveTo(pos.x + 8, pos.y - 8);
            ctx.lineTo(pos.x - 8, pos.y + 8);
            ctx.stroke();
        }
    }

    /**
     * Show the perspective-corrected (normalised) canvas on the main canvas.
     * Resizes pdfCanvas to match the normalised canvas dimensions and copies
     * the image, so subsequent overlay drawing aligns correctly.
     *
     * @param {HTMLCanvasElement} normalizedCanvas
     */
    showNormalizedCanvas(normalizedCanvas) {
        if (!normalizedCanvas) return;

        this.pdfCanvas.width  = normalizedCanvas.width;
        this.pdfCanvas.height = normalizedCanvas.height;

        const ctx = this.pdfCanvas.getContext('2d');
        ctx.drawImage(normalizedCanvas, 0, 0);

        // Show a label so the user knows they are viewing the corrected image
        if (this.normalizedViewLabel) {
            this.normalizedViewLabel.style.display = '';
        }
    }

    /**
     * Update the marker status badge / indicator in the UI.
     *
     * @param {MarkerResult|null} markerResult - null to reset/hide
     */
    updateMarkerStatus(markerResult) {
        if (!this.markerStatusBadge) return;

        if (!markerResult) {
            this.markerStatusBadge.textContent = '–';
            this.markerStatusBadge.className   = 'badge bg-secondary';
            return;
        }

        const count = markerResult.foundCount;
        const all   = markerResult.allFound;

        // Build a descriptive label listing which corners are missing
        if (all) {
            this.markerStatusBadge.textContent = '4/4 Marker ✓';
            this.markerStatusBadge.className   = 'badge bg-success';
        } else {
            const missing = [];
            if (!markerResult.topLeft)     missing.push('OL');
            if (!markerResult.topRight)    missing.push('OR');
            if (!markerResult.bottomLeft)  missing.push('UL');
            if (!markerResult.bottomRight) missing.push('UR');
            const detail = missing.length > 0 ? ` (fehlt: ${missing.join(',')})` : ' (Größe inkonsistent)';
            this.markerStatusBadge.textContent = `${count}/4 Marker${detail}`;
            this.markerStatusBadge.className   = `badge bg-${count > 0 ? 'warning' : 'danger'} text-dark`;
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
     * @returns {Object}
     */
    getConfig() {
        return {
            // Legacy / core
            renderScale:      parseFloat(this.renderScaleSlider.value),
            thresholdValue:   parseInt(this.thresholdSlider.value, 10),
            blackPixelRatio:  parseFloat(this.ratioSlider.value),
            morphologicalOps: this.morphOpsCheck.checked,
            morphType:        this.morphTypeSelect?.value ?? 'opening',
            showOverlay:      this.showOverlayCheck.checked,
            showDebug:        this.showDebugCheck?.checked ?? false,

            // v2: marker pipeline
            requireMarkers:     this.requireMarkersCheck?.checked ?? true,

            // v2: adaptive threshold
            useAdaptive:        true,  // always on; no toggle in current UI
            adaptiveBlockSize:  this.adaptiveBlockSizeSlider
                ? parseInt(this.adaptiveBlockSizeSlider.value, 10)
                : 31,
            adaptiveC:          10,   // fixed default; expose slider later if needed

            // v2: confidence
            innerPadding:       this.innerPaddingSlider
                ? parseInt(this.innerPaddingSlider.value, 10)
                : 2,
            uncertainThreshold: this.uncertainSlider
                ? parseFloat(this.uncertainSlider.value)
                : 0.75,
            emptyBaseline:  0.03,
            filledBaseline: 0.25,
        };
    }
}
