/**
 * PDFHandler
 * ===========
 * Manages PDF loading and page rendering via PDF.js.
 *
 * Responsibilities:
 *   - Load PDF documents from File objects or ArrayBuffers
 *   - Render individual pages onto an HTMLCanvasElement
 *   - Track current page and total page count
 *   - Expose configurable render scale
 *
 * PDF.js is expected to be loaded as a global library (pdfjsLib).
 * The worker source is set to the local libs/pdf.worker.min.js file so
 * the tool works fully offline without a server.
 */
class PDFHandler {

    /**
     * @param {Object} [config]
     * @param {number} [config.scale=2.0] - Initial render scale factor.
     *   A higher value produces a higher-resolution canvas and improves
     *   checkbox detection accuracy on low-res scans.
     */
    constructor(config = {}) {
        /** @type {Object|null} PDF.js PDFDocumentProxy */
        this.pdfDocument = null;

        /** @type {number} Total number of pages in the loaded document */
        this.pageCount = 0;

        /** @type {number} Currently displayed page (1-based) */
        this.currentPage = 1;

        /** @type {number} Canvas render scale factor */
        this.scale = config.scale ?? 2.0;

        // Point PDF.js to the local worker script.
        // When opened via file:// the browser can still load local worker files.
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
        } else {
            console.error(
                'PDFHandler: pdfjsLib is not defined. ' +
                'Make sure libs/pdf.min.js is loaded before pdf-handler.js.'
            );
        }
    }

    // ================================================================
    // Loading
    // ================================================================

    /**
     * Load a PDF from a File object (from <input type="file">).
     *
     * @param {File} file
     * @returns {Promise<number>} Total number of pages
     * @throws {Error} If the file cannot be read or is not a valid PDF
     */
    async loadFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        return this.loadArrayBuffer(arrayBuffer);
    }

    /**
     * Load a PDF from a raw ArrayBuffer.
     * Useful for programmatic loading or testing.
     *
     * @param {ArrayBuffer} arrayBuffer
     * @returns {Promise<number>} Total number of pages
     */
    async loadArrayBuffer(arrayBuffer) {
        // pdfjsLib.getDocument accepts a { data } object
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

        this.pdfDocument = await loadingTask.promise;
        this.pageCount   = this.pdfDocument.numPages;
        this.currentPage = 1;

        return this.pageCount;
    }

    // ================================================================
    // Rendering
    // ================================================================

    /**
     * Render a specific page onto a canvas element.
     *
     * The canvas dimensions are set automatically to match the viewport
     * at the current scale. Any previous content on the canvas is
     * replaced.
     *
     * @param {HTMLCanvasElement} canvas  - Target canvas element
     * @param {number}            pageNum - 1-based page number
     * @param {number}            [scale] - Override scale (defaults to this.scale)
     * @returns {Promise<{width: number, height: number}>} Rendered pixel size
     * @throws {Error} If no PDF is loaded or pageNum is out of range
     */
    async renderPage(canvas, pageNum, scale) {
        if (!this.pdfDocument) {
            throw new Error('Kein PDF geladen. Bitte zuerst loadFile() aufrufen.');
        }
        if (pageNum < 1 || pageNum > this.pageCount) {
            throw new Error(
                `Ungültige Seitenzahl: ${pageNum} (Dokument hat ${this.pageCount} Seiten).`
            );
        }

        const renderScale = scale ?? this.scale;
        const page        = await this.pdfDocument.getPage(pageNum);
        const viewport    = page.getViewport({ scale: renderScale });

        // Resize canvas to match the viewport
        canvas.width  = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d');

        const renderContext = {
            canvasContext: ctx,
            viewport:      viewport,
        };

        await page.render(renderContext).promise;

        this.currentPage = pageNum;

        return { width: viewport.width, height: viewport.height };
    }

    /**
     * Re-render the currently active page.
     * Convenience wrapper around renderPage().
     *
     * @param {HTMLCanvasElement} canvas
     * @returns {Promise<{width: number, height: number}>}
     */
    async renderCurrentPage(canvas) {
        return this.renderPage(canvas, this.currentPage, this.scale);
    }

    // ================================================================
    // Configuration
    // ================================================================

    /**
     * Update the render scale and clamp it to a safe range.
     *
     * @param {number} scale - Desired scale factor (clamped to [0.5, 4.0])
     */
    setScale(scale) {
        this.scale = Math.max(0.5, Math.min(4.0, parseFloat(scale)));
    }

    // ================================================================
    // Navigation Helpers
    // ================================================================

    /** @returns {boolean} True if there is a page before the current one */
    hasPreviousPage() {
        return this.currentPage > 1;
    }

    /** @returns {boolean} True if there is a page after the current one */
    hasNextPage() {
        return this.currentPage < this.pageCount;
    }

    /** @returns {boolean} True if a PDF document is currently loaded */
    isLoaded() {
        return this.pdfDocument !== null;
    }

    /**
     * Release the loaded PDF document to free memory.
     * After calling this, isLoaded() returns false.
     */
    unload() {
        if (this.pdfDocument) {
            this.pdfDocument.destroy();
            this.pdfDocument = null;
            this.pageCount   = 0;
            this.currentPage = 1;
        }
    }
}
