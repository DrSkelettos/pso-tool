/**
 * TemplateManager
 * ================
 * Manages form templates that define the positions of checkboxes
 * on scanned PDF forms.
 *
 * A template is a JSON document with the following structure:
 *
 * {
 *   "name": "my-form",
 *   "pageWidth": 2480,      // Expected page width in pixels (e.g. A4 at 300 DPI)
 *   "pageHeight": 3508,     // Expected page height in pixels
 *   "fields": [
 *     {
 *       "id": "question_1_yes",
 *       "label": "Frage 1: Ja",      // optional, human-readable
 *       "type": "checkbox",
 *       "page": 1,                   // 1-based page number
 *       "x": 320,                    // left edge in template pixels
 *       "y": 540,                    // top edge in template pixels
 *       "width": 50,
 *       "height": 50
 *     }
 *   ]
 * }
 *
 * Template coordinates are always given in the coordinate space of the
 * template's declared page size. When the PDF is rendered at a different
 * resolution, coordinates are scaled automatically via scaleField().
 */
class TemplateManager {

    constructor() {
        /** @type {Object|null} Currently loaded template */
        this.currentTemplate = null;
    }

    // ================================================================
    // Loading
    // ================================================================

    /**
     * Load a template from a File object (from <input type="file">).
     * Compatible with both http:// and file:// origins.
     *
     * @param {File} file - JSON file selected by the user
     * @returns {Promise<Object>} Validated, parsed template
     * @throws {Error} On parse or validation failure
     */
    async loadFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const template = JSON.parse(e.target.result);
                    this._validate(template);
                    this.currentTemplate = template;
                    resolve(template);
                } catch (err) {
                    reject(new Error(`Template-Fehler: ${err.message}`));
                }
            };

            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsText(file);
        });
    }

    /**
     * Load a template from a plain JavaScript object or a JSON string.
     * Useful for embedding example templates directly in code.
     *
     * @param {Object|string} json
     * @returns {Object} Validated template
     * @throws {Error} On validation failure
     */
    loadFromObject(json) {
        const template = (typeof json === 'string') ? JSON.parse(json) : json;
        this._validate(template);
        this.currentTemplate = template;
        return template;
    }

    /**
     * Load a template from a URL using XHR.
     * XHR with status === 0 also works under file:// protocol (where
     * fetch() may fail due to CORS restrictions in some browsers).
     *
     * @param {string} url - Relative or absolute URL
     * @returns {Promise<Object>} Validated template
     */
    async loadFromURL(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url);

            xhr.onload = () => {
                // HTTP status 0 occurs when reading from file:// — treat as success
                if (xhr.status === 200 || xhr.status === 0) {
                    try {
                        const template = JSON.parse(xhr.responseText);
                        this._validate(template);
                        this.currentTemplate = template;
                        resolve(template);
                    } catch (err) {
                        reject(new Error(`Template-Fehler: ${err.message}`));
                    }
                } else {
                    reject(new Error(`HTTP-Fehler ${xhr.status} beim Laden von: ${url}`));
                }
            };

            xhr.onerror = () => reject(new Error(`Netzwerkfehler beim Laden von: ${url}`));
            xhr.send();
        });
    }

    // ================================================================
    // Validation
    // ================================================================

    /**
     * Validate template structure.
     * Throws descriptive errors so the user knows exactly what is wrong.
     *
     * @param {Object} template
     * @throws {Error}
     * @private
     */
    _validate(template) {
        const requiredRoot = ['name', 'pageWidth', 'pageHeight', 'fields'];
        for (const key of requiredRoot) {
            if (!(key in template)) {
                throw new Error(`Pflichtfeld fehlt im Template: "${key}"`);
            }
        }

        if (typeof template.pageWidth !== 'number' || template.pageWidth <= 0) {
            throw new Error('"pageWidth" muss eine positive Zahl sein.');
        }
        if (typeof template.pageHeight !== 'number' || template.pageHeight <= 0) {
            throw new Error('"pageHeight" muss eine positive Zahl sein.');
        }
        if (!Array.isArray(template.fields) || template.fields.length === 0) {
            throw new Error('Template muss mindestens ein Feld in "fields" enthalten.');
        }

        const requiredField = ['id', 'page', 'x', 'y', 'width', 'height'];
        const seenIds = new Set();

        for (const field of template.fields) {
            for (const key of requiredField) {
                if (!(key in field)) {
                    throw new Error(
                        `Pflichtfeld fehlt in Feld "${field.id ?? '(unbekannt)'}" : "${key}"`
                    );
                }
            }

            if (seenIds.has(field.id)) {
                throw new Error(`Doppelte Feld-ID: "${field.id}"`);
            }
            seenIds.add(field.id);

            if (typeof field.page !== 'number' || field.page < 1) {
                throw new Error(`Feld "${field.id}": "page" muss eine positive Ganzzahl sein.`);
            }
        }
    }

    // ================================================================
    // Querying
    // ================================================================

    /**
     * Return a copy of the currently loaded template.
     * @returns {Object|null}
     */
    getTemplate() {
        return this.currentTemplate ? { ...this.currentTemplate } : null;
    }

    /**
     * Get all fields that belong to a specific page.
     *
     * @param {number} pageNum - 1-based page number
     * @returns {Array<Object>} Matching fields (original references)
     */
    getFieldsForPage(pageNum) {
        if (!this.currentTemplate) return [];
        return this.currentTemplate.fields.filter(f => f.page === pageNum);
    }

    /**
     * Get a sorted, deduplicated list of page numbers referenced by the template.
     *
     * @returns {number[]}
     */
    getPages() {
        if (!this.currentTemplate) return [];
        const pages = new Set(this.currentTemplate.fields.map(f => f.page));
        return Array.from(pages).sort((a, b) => a - b);
    }

    // ================================================================
    // Coordinate Scaling
    // ================================================================

    /**
     * Scale a single field's coordinates from template-space to
     * canvas-space.
     *
     * Template coordinates are defined relative to (pageWidth × pageHeight).
     * When the PDF is rendered at a different size (due to scale factor),
     * the canvas dimensions differ. This method converts a field's
     * {x, y, width, height} from template-pixel space to canvas-pixel space.
     *
     * @param {Object} field         - Original template field
     * @param {number} canvasWidth   - Actual rendered canvas width in pixels
     * @param {number} canvasHeight  - Actual rendered canvas height in pixels
     * @returns {Object} New field object with scaled coordinates
     */
    scaleField(field, canvasWidth, canvasHeight) {
        const scaleX = canvasWidth  / this.currentTemplate.pageWidth;
        const scaleY = canvasHeight / this.currentTemplate.pageHeight;

        return {
            ...field,
            x:      Math.round(field.x      * scaleX),
            y:      Math.round(field.y      * scaleY),
            width:  Math.max(1, Math.round(field.width  * scaleX)),
            height: Math.max(1, Math.round(field.height * scaleY)),
            // Store scale factors for diagnostics
            _scaleX: scaleX,
            _scaleY: scaleY,
        };
    }

    /**
     * Convenience: scale all fields for a given page.
     *
     * @param {number} pageNum
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     * @returns {Array<Object>}
     */
    scaleFieldsForPage(pageNum, canvasWidth, canvasHeight) {
        return this.getFieldsForPage(pageNum).map(
            f => this.scaleField(f, canvasWidth, canvasHeight)
        );
    }
}
