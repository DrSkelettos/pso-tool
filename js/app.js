/**
 * App
 * ====
 * Main application controller — orchestrates all modules.
 *
 * Data flow:
 *
 *   User picks PDF  →  PDFHandler.loadFile()
 *                  →  PDFHandler.renderCurrentPage(canvas)
 *
 *   User picks Template → TemplateManager.loadFromFile()
 *
 *   User clicks Analyse →
 *       TemplateManager.scaleFieldsForPage()
 *     → ImageProcessor.processCanvas()          ← canvas
 *     → CheckboxDetector.detectAll()            ← binaryMat + scaledFields
 *     → CheckboxDetector.resultsToJSON()
 *     → UI.showResults() + UI.drawOverlay()
 *
 * All processing is synchronous from the browser's perspective
 * (no network calls, no server, no uploads).
 *
 * OpenCV.js initialises its WASM module asynchronously. Analysis is
 * gated behind a readiness flag that is set when the 'opencv-ready'
 * custom event fires from index.html's Module.onRuntimeInitialized hook.
 */
class App {

    constructor() {
        // ---- Modules ----
        this.pdfHandler       = new PDFHandler();
        this.templateManager  = new TemplateManager();
        this.imageProcessor   = new ImageProcessor();
        this.checkboxDetector = new CheckboxDetector();
        this.ui               = new UI();

        // ---- State flags ----
        /** @type {boolean} OpenCV WASM has finished loading */
        this.cvReady = false;

        /** @type {boolean} A PDF is loaded and rendered */
        this.pdfLoaded = false;

        /** @type {boolean} A template is loaded */
        this.templateLoaded = false;

        // ---- Last analysis results (for re-draw, export) ----
        /** @type {Array|null} Enriched DetectionResult array (includes scaledField) */
        this.lastResults = null;

        /** @type {Object|null} Flat JSON output from the last analysis */
        this.lastJSON = null;

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
     * Pipeline:
     *   canvas → ImageProcessor → binary Mat
     *   template fields (scaled) → CheckboxDetector → results
     *   results → UI (JSON panel, overlay)
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

        // Yield to the browser event loop so the overlay renders
        // before the CPU-intensive OpenCV work begins.
        await new Promise(resolve => setTimeout(resolve, 30));

        let binaryMat = null;

        try {
            const canvas      = this.ui.pdfCanvas;
            const currentPage = this.pdfHandler.currentPage;
            const config      = this.ui.getConfig();

            // Push UI config into processing modules
            this.imageProcessor.updateConfig({
                thresholdValue:   config.thresholdValue,
                morphologicalOps: config.morphologicalOps,
                morphType:        config.morphType,
            });
            this.checkboxDetector.updateConfig({
                blackPixelRatio: config.blackPixelRatio,
            });

            // Scale template fields to match the rendered canvas dimensions
            const scaledFields = this.templateManager.scaleFieldsForPage(
                currentPage,
                canvas.width,
                canvas.height
            );

            if (scaledFields.length === 0) {
                this.ui.showToast(
                    `Keine Felder für Seite ${currentPage} im Template definiert.`,
                    'warning'
                );
                return;
            }

            // Process canvas → binary Mat
            binaryMat = this.imageProcessor.processCanvas(canvas);

            // Detect checkboxes
            const rawResults = this.checkboxDetector.detectAll(binaryMat, scaledFields);

            // Enrich results with their scaled field coordinates (needed for overlay)
            this.lastResults = rawResults.map((result, i) => ({
                ...result,
                scaledField: scaledFields[i] ?? null,
            }));

            // Generate flat JSON
            this.lastJSON = this.checkboxDetector.resultsToJSON(rawResults);

            // Update UI
            this.ui.showResults(this.lastJSON, rawResults);
            this.ui.drawOverlay(this.lastResults, config.showOverlay);

            const checkedCount = rawResults.filter(r => r.checked).length;
            this.ui.showToast(
                `Analyse abgeschlossen: ${checkedCount} von ${rawResults.length} Feldern angekreuzt.`,
                'success'
            );

        } catch (err) {
            this.ui.showToast(`Analyse-Fehler: ${err.message}`, 'danger');
            console.error('[App] Analysis error:', err);
        } finally {
            // ALWAYS free OpenCV memory to prevent WASM heap exhaustion
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
        this.lastResults = null;
        this.lastJSON    = null;
        this.ui.setExportEnabled(false);
        this.ui.drawOverlay([], false);
        this.ui.jsonOutput.textContent = '';
        this.ui.checkedCount.textContent   = '0 angekreuzt';
        this.ui.uncheckedCount.textContent = '0 leer';
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
