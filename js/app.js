/**
 * App
 * ====
 * Main application controller — orchestrates all modules.
 *
 * v2 Pipeline (requireMarkers = true, default):
 *
 *   PDF render  →  pdfCanvas
 *   MarkerDetector.detect(pdfCanvas)            → markerResult
 *   PerspectiveCorrector.correct(...)            → normalizedCanvas
 *   ImageProcessor.processCanvas(normalized)     → binaryMat  (adaptive threshold)
 *   template fields (no scaling — already in normalized coords)
 *   CheckboxDetector.detectAll(binaryMat, fields) → results  (with confidence)
 *   UI.showResults() + UI.drawOverlay()
 *
 * Fallback Pipeline (requireMarkers = false):
 *
 *   PDF render  →  pdfCanvas
 *   ImageProcessor.processCanvas(pdfCanvas)      → binaryMat
 *   template fields (scaled from template space to canvas space)
 *   CheckboxDetector.detectAll(binaryMat, fields) → results
 *
 * All processing is local — no backend, no network calls.
 * OpenCV.js initialises its WASM module asynchronously.
 */
class App {

    constructor() {
        // ---- Modules ----
        this.pdfHandler           = new PDFHandler();
        this.templateManager      = new TemplateManager();
        this.imageProcessor       = new ImageProcessor();
        this.checkboxDetector     = new CheckboxDetector();
        this.markerDetector       = new MarkerDetector();
        this.perspectiveCorrector = new PerspectiveCorrector();
        this.ui                   = new UI();

        // Expose detector ref for debug overlay rendering (search region visualization)
        window._markerDetectorRef = this.markerDetector;

        // ---- State flags ----
        /** @type {boolean} OpenCV WASM has finished loading */
        this.cvReady = false;

        /** @type {boolean} A PDF is loaded and rendered */
        this.pdfLoaded = false;

        /** @type {boolean} A template is loaded */
        this.templateLoaded = false;

        // ---- Last analysis results (for re-draw, export) ----
        /** @type {Array|null} Enriched DetectionResult array */
        this.lastResults = null;

        /** @type {Object|null} Flat JSON output from the last analysis */
        this.lastJSON = null;

        /** @type {HTMLCanvasElement|null} Last normalised canvas (markers pipeline) */
        this.lastNormalizedCanvas = null;

        // Initialise
        this._bindEvents();
        this._waitForOpenCV();
    }

    // ================================================================
    // Initialisation
    // ================================================================

    /**
     * Wait for OpenCV's WASM runtime to finish loading.
     *
     * Two mechanisms:
     *   1. Custom 'opencv-ready' event dispatched by Module.onRuntimeInitialized
     *      (defined in index.html before opencv.js is loaded).
     *   2. Polling fallback — some builds of opencv.js do not fire the event
     *      correctly; the poll catches those cases.
     */
    _waitForOpenCV() {
        this.ui.setStatus('OpenCV lädt…', 'warning');

        const onReady = () => {
            if (this.cvReady) return; // Prevent double-init
            this.cvReady = true;
            this.ui.setStatus('Bereit', 'success');
            this.ui.showToast('OpenCV.js geladen – System bereit', 'success');
            this._updateAnalyzeButton();
        };

        // Primary mechanism: custom event
        document.addEventListener('opencv-ready', onReady, { once: true });

        // Fallback: poll every 500 ms until cv.Mat is accessible
        const pollId = setInterval(() => {
            if (typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined') {
                clearInterval(pollId);
                onReady();
            }
        }, 500);
    }

    /**
     * Register all UI event handlers.
     * @private
     */
    _bindEvents() {
        // File uploads
        this.ui.onPDFUpload(      (file) => this._handlePDFUpload(file));
        this.ui.onTemplateUpload( (file) => this._handleTemplateUpload(file));
        this.ui.onLoadExampleTemplate(()  => this._loadExampleTemplate());

        // Actions
        this.ui.onAnalyze(    () => this._analyze());
        this.ui.onExportJSON( () => this._exportJSON());
        this.ui.onExportCSV(  () => this._exportCSV());

        // Page navigation
        this.ui.onPrevPage(() => this._navigatePage(-1));
        this.ui.onNextPage(() => this._navigatePage(+1));

        // Settings that require a re-render or re-draw
        this.ui.onScaleChange((scale) => {
            this.pdfHandler.setScale(scale);
            if (this.pdfLoaded) this._rerender();
        });

        this.ui.onThresholdChange((value) => {
            this.imageProcessor.updateConfig({ thresholdValue: value });
        });

        this.ui.onRatioChange((value) => {
            this.checkboxDetector.updateConfig({ blackPixelRatio: value });
        });

        this.ui.onMorphOpsChange((enabled) => {
            this.imageProcessor.updateConfig({ morphologicalOps: enabled });
        });

        this.ui.onShowOverlayChange((show) => {
            if (this.lastResults) {
                this.ui.drawOverlay(this.lastResults, show);
            }
        });

        // v2: new controls (guard with ?. — only wired up if index.html has the elements)
        if (typeof this.ui.onRequireMarkersChange === 'function') {
            this.ui.onRequireMarkersChange(() => this._clearResults());
        }
        if (typeof this.ui.onInnerPaddingChange === 'function') {
            this.ui.onInnerPaddingChange((v) =>
                this.checkboxDetector.updateConfig({ innerPadding: v }));
        }
        if (typeof this.ui.onUncertainThresholdChange === 'function') {
            this.ui.onUncertainThresholdChange((v) =>
                this.checkboxDetector.updateConfig({ uncertainThreshold: v }));
        }
        if (typeof this.ui.onAdaptiveBlockSizeChange === 'function') {
            this.ui.onAdaptiveBlockSizeChange((v) =>
                this.imageProcessor.updateConfig({ adaptiveBlockSize: v }));
        }
    }

    // ================================================================
    // PDF Handling
    // ================================================================

    /**
     * Load a PDF file selected by the user and render its first page.
     * @param {File} file
     * @private
     */
    async _handlePDFUpload(file) {
        this.ui.showLoading('PDF wird geladen…');

        try {
            const pageCount = await this.pdfHandler.loadFile(file);
            this.pdfLoaded  = true;

            // Render page 1
            await this._renderCurrentPage();

            // Show page nav only for multi-page PDFs
            this.ui.updatePageNav(pageCount > 1, 1, pageCount);

            this.ui.setPdfInfo(
                `${file.name} · ${pageCount} Seite${pageCount !== 1 ? 'n' : ''}`
            );
            this.ui.setStatus(
                `PDF geladen (${pageCount} Seite${pageCount !== 1 ? 'n' : ''})`,
                'primary'
            );
            this.ui.showToast(`PDF geladen: ${file.name}`, 'success');

            // Clear previous results when a new PDF is loaded
            this._clearResults();
            this._updateAnalyzeButton();

        } catch (err) {
            this.ui.showToast(`PDF-Fehler: ${err.message}`, 'danger');
            console.error('[App] PDF load error:', err);
        } finally {
            this.ui.hideLoading();
        }
    }

    // ================================================================
    // Template Handling
    // ================================================================

    /**
     * Load a user-supplied JSON template file.
     * @param {File} file
     * @private
     */
    async _handleTemplateUpload(file) {
        try {
            const template     = await this.templateManager.loadFromFile(file);
            this.templateLoaded = true;
            this.ui.showTemplateInfo(template);
            this.ui.showToast(`Template geladen: ${template.name}`, 'success');
            this._clearResults();
            this._updateAnalyzeButton();
        } catch (err) {
            this.ui.showToast(`Template-Fehler: ${err.message}`, 'danger');
            console.error('[App] Template load error:', err);
        }
    }

    /**
     * Load the built-in example template.
     * The template is embedded directly as a JS object to avoid any
     * file:// CORS restrictions that may affect fetch()/XHR.
     * @private
     */
    _loadExampleTemplate() {
        const exampleTemplate = {
            name:        'Beispiel-Formular A4',
            description: 'Beispiel-Template für ein DIN A4 Formular bei 300 DPI (2480×3508 px). ' +
                         'Passen Sie die Koordinaten mit dem Template-Editor an Ihr Formular an.',
            pageWidth:   2480,
            pageHeight:  3508,
            fields: [
                // Page 1 — three yes/no question pairs
                { id: 'frage_1_ja',    label: 'Frage 1: Ja',    type: 'checkbox', page: 1, x: 320, y: 540, width: 55, height: 55 },
                { id: 'frage_1_nein',  label: 'Frage 1: Nein',  type: 'checkbox', page: 1, x: 460, y: 540, width: 55, height: 55 },
                { id: 'frage_2_ja',    label: 'Frage 2: Ja',    type: 'checkbox', page: 1, x: 320, y: 680, width: 55, height: 55 },
                { id: 'frage_2_nein',  label: 'Frage 2: Nein',  type: 'checkbox', page: 1, x: 460, y: 680, width: 55, height: 55 },
                { id: 'frage_3_ja',    label: 'Frage 3: Ja',    type: 'checkbox', page: 1, x: 320, y: 820, width: 55, height: 55 },
                { id: 'frage_3_nein',  label: 'Frage 3: Nein',  type: 'checkbox', page: 1, x: 460, y: 820, width: 55, height: 55 },
                { id: 'frage_4_ja',    label: 'Frage 4: Ja',    type: 'checkbox', page: 1, x: 320, y: 960, width: 55, height: 55 },
                { id: 'frage_4_nein',  label: 'Frage 4: Nein',  type: 'checkbox', page: 1, x: 460, y: 960, width: 55, height: 55 },
                { id: 'frage_5_ja',    label: 'Frage 5: Ja',    type: 'checkbox', page: 1, x: 320, y: 1100, width: 55, height: 55 },
                { id: 'frage_5_nein',  label: 'Frage 5: Nein',  type: 'checkbox', page: 1, x: 460, y: 1100, width: 55, height: 55 },
            ],
        };

        try {
            const template      = this.templateManager.loadFromObject(exampleTemplate);
            this.templateLoaded = true;
            this.ui.showTemplateInfo(template);
            this.ui.showToast(
                'Beispiel-Template geladen. Koordinaten ggf. an Ihr Formular anpassen.',
                'info',
                5000
            );
            this._clearResults();
            this._updateAnalyzeButton();
        } catch (err) {
            this.ui.showToast(`Fehler: ${err.message}`, 'danger');
            console.error('[App] Example template error:', err);
        }
    }

    // ================================================================
    // Rendering
    // ================================================================

    /**
     * Render the current page onto the PDF canvas and sync the overlay canvas.
     * @private
     */
    async _renderCurrentPage() {
        await this.pdfHandler.renderCurrentPage(this.ui.pdfCanvas);
        this.ui.showCanvas();
    }

    /**
     * Re-render the current page (e.g. after a scale change) and
     * optionally redraw the last overlay.
     * @private
     */
    async _rerender() {
        this.ui.showLoading('Re-Render…');
        try {
            await this._renderCurrentPage();
            if (this.lastResults) {
                const config = this.ui.getConfig();
                this.ui.drawOverlay(this.lastResults, config.showOverlay);
            }
        } catch (err) {
            this.ui.showToast(`Render-Fehler: ${err.message}`, 'danger');
            console.error('[App] Re-render error:', err);
        } finally {
            this.ui.hideLoading();
        }
    }

    /**
     * Navigate to the previous or next page.
     * @param {number} delta - -1 or +1
     * @private
     */
    async _navigatePage(delta) {
        const target = this.pdfHandler.currentPage + delta;
        if (target < 1 || target > this.pdfHandler.pageCount) return;

        this.ui.showLoading(`Lade Seite ${target}…`);
        try {
            await this.pdfHandler.renderPage(this.ui.pdfCanvas, target);
            this.ui.updatePageNav(
                this.pdfHandler.pageCount > 1,
                target,
                this.pdfHandler.pageCount
            );
            // Clear stale overlay when navigating to a new page
            this._clearResults();
        } catch (err) {
            this.ui.showToast(`Seitenfehler: ${err.message}`, 'danger');
            console.error('[App] Page navigation error:', err);
        } finally {
            this.ui.hideLoading();
        }
    }

    // ================================================================
    // Analysis
    // ================================================================

    /**
     * Run the full checkbox detection pipeline on the currently visible page.
     *
     * v2 (requireMarkers=true):
     *   pdfCanvas → MarkerDetector → PerspectiveCorrector → normalizedCanvas
     *   → ImageProcessor (adaptive) → binaryMat
     *   → CheckboxDetector (with inner padding + confidence)
     *
     * Fallback (requireMarkers=false):
     *   pdfCanvas → ImageProcessor → binaryMat
     *   → CheckboxDetector (with scaled fields)
     *
     * @private
     */
    async _analyze() {
        if (!this.cvReady) {
            this.ui.showToast('OpenCV noch nicht bereit. Bitte warten.', 'warning');
            return;
        }
        if (!this.pdfLoaded) {
            this.ui.showToast('Bitte zuerst eine PDF laden.', 'warning');
            return;
        }
        if (!this.templateLoaded) {
            this.ui.showToast('Bitte zuerst ein Template laden.', 'warning');
            return;
        }

        this.ui.showLoading('Analyse läuft…');

        // Yield so the loading overlay renders before CPU-intensive work begins
        await new Promise(resolve => setTimeout(resolve, 30));

        let binaryMat = null;

        try {
            const originalCanvas = this.ui.pdfCanvas;
            const currentPage    = this.pdfHandler.currentPage;
            const config         = this.ui.getConfig();

            const requireMarkers = config.requireMarkers ?? true;

            // Sync all module configs from UI
            this.imageProcessor.updateConfig({
                useAdaptive:       config.useAdaptive       ?? true,
                adaptiveBlockSize: config.adaptiveBlockSize ?? 31,
                adaptiveC:         config.adaptiveC         ?? 10,
                thresholdValue:    config.thresholdValue    ?? 128,
                morphologicalOps:  config.morphologicalOps  ?? false,
                morphType:         config.morphType         ?? 'opening',
            });
            this.checkboxDetector.updateConfig({
                blackPixelRatio:    config.blackPixelRatio    ?? 0.12,
                innerPadding:       config.innerPadding       ?? 5,
                emptyBaseline:      config.emptyBaseline      ?? 0.03,
                filledBaseline:     config.filledBaseline     ?? 0.25,
                uncertainThreshold: config.uncertainThreshold ?? 0.75,
            });

            let rawResults;

            // ----------------------------------------------------------------
            // v2 Pipeline: Marker detection + perspective correction
            // ----------------------------------------------------------------
            if (requireMarkers) {
                // 1. Detect corner alignment markers
                this.ui.showLoading('Eckmarker werden erkannt…');
                const markerResult = this.markerDetector.detect(originalCanvas);

                // 2. Update marker status indicator in UI
                if (typeof this.ui.updateMarkerStatus === 'function') {
                    this.ui.updateMarkerStatus(markerResult);
                }

                // Draw marker debug overlay on the overlayCanvas so it stays
                // visible even after showNormalizedCanvas replaces pdfCanvas content.
                // Pass the original canvas only for dimension reference.
                if (typeof this.ui.drawMarkerOverlay === 'function') {
                    this.ui.drawMarkerOverlay(markerResult, originalCanvas);
                }

                if (!markerResult.allFound) {
                    const missing = [];
                    if (!markerResult.topLeft)     missing.push('Oben-Links');
                    if (!markerResult.topRight)    missing.push('Oben-Rechts');
                    if (!markerResult.bottomLeft)  missing.push('Unten-Links');
                    if (!markerResult.bottomRight) missing.push('Unten-Rechts');

                    const reason = !markerResult.sizeConsistent
                        ? 'Marker haben sehr unterschiedliche Größen (Fehlpositiv?)'
                        : `Ecken ohne Marker: ${missing.join(', ')}`;

                    this.ui.showToast(
                        `${markerResult.foundCount}/4 Marker gefunden. ${reason}. ` +
                        'Render-Skalierung erhöhen oder Marker-Erkennung deaktivieren.',
                        'danger',
                        7000
                    );
                    return;
                }

                // 3. Perspective correction → normalised canvas
                this.ui.showLoading('Perspektive wird korrigiert…');
                const { width: normW, height: normH } =
                    this.templateManager.getNormalizedDimensions();

                this.lastNormalizedCanvas = this.perspectiveCorrector.correct(
                    originalCanvas,
                    markerResult,
                    normW,
                    normH
                );

                // 4. Show normalised image
                if (typeof this.ui.showNormalizedCanvas === 'function') {
                    this.ui.showNormalizedCanvas(this.lastNormalizedCanvas);
                }

                // 5. Process normalised canvas → binary Mat (adaptive threshold)
                this.ui.showLoading('Analyse läuft…');
                binaryMat = this.imageProcessor.processCanvas(this.lastNormalizedCanvas);

                // 6. Template fields already in normalised coords — no scaling
                const fields = this.templateManager.getFieldsForPage(currentPage);

                if (fields.length === 0) {
                    this.ui.showToast(
                        `Keine Felder für Seite ${currentPage} im Template.`,
                        'warning'
                    );
                    return;
                }

                rawResults = this.checkboxDetector.detectAll(binaryMat, fields);

                this.lastResults = rawResults.map((result, i) => ({
                    ...result,
                    scaledField: fields[i] ? { ...fields[i] } : null,
                }));

            } else {
                // ----------------------------------------------------------------
                // Fallback Pipeline: no markers, scale fields to canvas
                // ----------------------------------------------------------------

                if (typeof this.ui.updateMarkerStatus === 'function') {
                    this.ui.updateMarkerStatus(null);
                }

                const scaledFields = this.templateManager.scaleFieldsForPage(
                    currentPage,
                    originalCanvas.width,
                    originalCanvas.height
                );

                if (scaledFields.length === 0) {
                    this.ui.showToast(
                        `Keine Felder für Seite ${currentPage} im Template.`,
                        'warning'
                    );
                    return;
                }

                binaryMat  = this.imageProcessor.processCanvas(originalCanvas);
                rawResults = this.checkboxDetector.detectAll(binaryMat, scaledFields);

                this.lastResults = rawResults.map((result, i) => ({
                    ...result,
                    scaledField: scaledFields[i] ?? null,
                }));
            }

            // ----------------------------------------------------------------
            // Common: generate output and update UI
            // ----------------------------------------------------------------
            this.lastJSON = this.checkboxDetector.resultsToJSON(rawResults);

            this.ui.showResults(this.lastJSON, rawResults);
            this.ui.drawOverlay(this.lastResults, config.showOverlay);
            this.ui.setExportEnabled(true);

            const checkedCount   = rawResults.filter(r => r.checked).length;
            const uncertainCount = rawResults.filter(r => r.uncertain).length;

            let toastMsg = `Analyse: ${checkedCount}/${rawResults.length} angekreuzt`;
            if (uncertainCount > 0) toastMsg += ` · ${uncertainCount} unsicher`;

            this.ui.showToast(toastMsg, uncertainCount > 0 ? 'warning' : 'success');

        } catch (err) {
            this.ui.showToast(`Analyse-Fehler: ${err.message}`, 'danger');
            console.error('[App] Analysis error:', err);
        } finally {
            if (binaryMat) {
                try { binaryMat.delete(); } catch (_) { /* already deleted */ }
            }
            this.ui.hideLoading();
        }
    }

    // ================================================================
    // Export
    // ================================================================

    /**
     * Trigger a JSON file download with the last analysis results.
     * @private
     */
    _exportJSON() {
        if (!this.lastJSON) {
            this.ui.showToast('Keine Ergebnisse zum Exportieren.', 'warning');
            return;
        }

        const content  = JSON.stringify(this.lastJSON, null, 2);
        const filename = this._timestampedFilename('ergebnis', 'json');
        this.ui.triggerDownload(content, filename, 'application/json');
        this.ui.showToast('JSON exportiert.', 'success');
    }

    /**
     * Trigger a CSV file download with the last analysis results.
     * Includes a UTF-8 BOM so Excel opens the file correctly on Windows.
     * @private
     */
    _exportCSV() {
        if (!this.lastResults) {
            this.ui.showToast('Keine Ergebnisse zum Exportieren.', 'warning');
            return;
        }

        const csvRows = this.checkboxDetector.resultsToCSVRows(this.lastResults);

        const header = Object.keys(csvRows[0]).join(';');
        const body   = csvRows.map(row =>
            Object.values(row)
                  .map(v => `"${String(v).replace(/"/g, '""')}"`)
                  .join(';')
        ).join('\r\n');

        // UTF-8 BOM (\uFEFF) ensures correct encoding in Excel
        const content  = '\uFEFF' + header + '\r\n' + body;
        const filename = this._timestampedFilename('ergebnis', 'csv');
        this.ui.triggerDownload(content, filename, 'text/csv;charset=utf-8');
        this.ui.showToast('CSV exportiert.', 'success');
    }

    // ================================================================
    // Helpers
    // ================================================================

    /**
     * Enable or disable the Analyse button based on readiness of all
     * required components (OpenCV + PDF + Template).
     * @private
     */
    _updateAnalyzeButton() {
        const ready = this.cvReady && this.pdfLoaded && this.templateLoaded;
        this.ui.setAnalyzeEnabled(ready);
    }

    /**
     * Clear analysis results and hide the overlay.
     * Called when a new PDF or template is loaded.
     * @private
     */
    _clearResults() {
        this.lastResults          = null;
        this.lastJSON             = null;
        this.lastNormalizedCanvas = null;
        this.ui.setExportEnabled(false);
        this.ui.drawOverlay([], false);
        if (this.ui.jsonOutput)          this.ui.jsonOutput.textContent        = '';
        if (this.ui.checkedCount)        this.ui.checkedCount.textContent      = '0 angekreuzt';
        if (this.ui.uncheckedCount)      this.ui.uncheckedCount.textContent    = '0 leer';
        if (typeof this.ui.updateMarkerStatus === 'function') this.ui.updateMarkerStatus(null);
    }

    /**
     * Generate a filename with an ISO-ish timestamp suffix.
     *
     * @param {string} base   - Base name without extension
     * @param {string} ext    - Extension without leading dot
     * @returns {string}
     * @private
     */
    _timestampedFilename(base, ext) {
        const ts = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[T:]/g, '-');
        return `${base}_${ts}.${ext}`;
    }
}

// ================================================================
// Bootstrap
// ================================================================

// Instantiate the application once the DOM is fully parsed.
// All <script> tags in index.html are at the end of <body>, so
// DOMContentLoaded fires after they have executed.
document.addEventListener('DOMContentLoaded', () => {
    // Expose instance globally for easy browser-console debugging
    window.app = new App();
});
