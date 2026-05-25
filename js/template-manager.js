/**
 * TemplateManager
 * ================
 * Manages form templates that define the positions of checkboxes
 * on scanned PDF forms.
 *
 * Template format (v2 — with perspective correction):
 *
 * {
 *   "name": "my-form",
 *   "normalizedWidth":  2480,   // Output width of perspective-corrected canvas
 *   "normalizedHeight": 3508,   // Output height of perspective-corrected canvas
 *   "fields": [
 *     {
 *       "id": "question_1_yes",
 *       "type": "checkbox",
 *       "page": 1,
 *       "x": 420,    // Position in normalised coordinate space (pixels)
 *       "y": 820,
 *       "width": 28,
 *       "height": 28
 *     }
 *   ]
 * }
 *
 * Backward compatibility (v1 — without perspective correction):
 *   Templates that use "pageWidth"/"pageHeight" instead of
 *   "normalizedWidth"/"normalizedHeight" are still accepted.
 *   In the legacy pipeline they are scaled to match the rendered canvas.
 *   In the new pipeline they define the normalised output dimensions.
 *
 * All field IDs within a template must be unique.
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
     * Accepts both v1 (pageWidth/pageHeight) and v2 (normalizedWidth/normalizedHeight).
     *
     * @param {Object} template
     * @throws {Error}
     * @private
     */
    _validate(template) {
        if (!template.name) {
            throw new Error('Pflichtfeld fehlt im Template: "name"');
        }

        // Accept either naming convention
        const hasNormalized = 'normalizedWidth' in template && 'normalizedHeight' in template;
        const hasPage       = 'pageWidth'       in template && 'pageHeight'       in template;

        if (!hasNormalized && !hasPage) {
            throw new Error(
                'Template muss entweder "normalizedWidth"/"normalizedHeight" ' +
                'oder "pageWidth"/"pageHeight" enthalten.'
            );
        }

        const w = this._getTemplateWidth(template);
        const h = this._getTemplateHeight(template);
        if (typeof w !== 'number' || w <= 0) throw new Error('"normalizedWidth" / "pageWidth" muss eine positive Zahl sein.');
        if (typeof h !== 'number' || h <= 0) throw new Error('"normalizedHeight" / "pageHeight" muss eine positive Zahl sein.');

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

            // Default type to "checkbox" if omitted for backward compat
            if (!field.type) field.type = 'checkbox';

            if (typeof field.page !== 'number' || field.page < 1) {
                throw new Error(`Feld "${field.id}": "page" muss eine positive Ganzzahl sein.`);
            }
        }
    }

    // ================================================================
    // Dimension helpers
    // ================================================================

    /** @private */
    _getTemplateWidth(t) {
        return t.normalizedWidth ?? t.pageWidth;
    }

    /** @private */
    _getTemplateHeight(t) {
        return t.normalizedHeight ?? t.pageHeight;
    }

    /**
     * Return the normalised (target) page dimensions from the current template.
     * These are the dimensions of the perspective-corrected output canvas.
     *
     * @returns {{width: number, height: number}}
     */
    getNormalizedDimensions() {
        if (!this.currentTemplate) return { width: 2480, height: 3508 };
        return {
            width:  this._getTemplateWidth(this.currentTemplate),
            height: this._getTemplateHeight(this.currentTemplate),
        };
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
     * Template coordinates are defined relative to (normalizedWidth × normalizedHeight)
     * or (pageWidth × pageHeight) in legacy templates.
     * When the PDF is rendered at a different size (due to scale factor),
     * the canvas dimensions differ. This method converts a field's
     * {x, y, width, height} from template-pixel space to canvas-pixel space.
     *
     * In the v2 marker-corrected pipeline, fields are in the normalised
     * coordinate space and no scaling is needed. Only use scaleField() in
     * the legacy (no-marker) fallback pipeline.
     *
     * @param {Object} field         - Original template field
     * @param {number} canvasWidth   - Actual rendered canvas width in pixels
     * @param {number} canvasHeight  - Actual rendered canvas height in pixels
     * @returns {Object} New field object with scaled coordinates
     */
    scaleField(field, canvasWidth, canvasHeight) {
        const tmplW  = this._getTemplateWidth(this.currentTemplate);
        const tmplH  = this._getTemplateHeight(this.currentTemplate);
        const scaleX = canvasWidth  / tmplW;
        const scaleY = canvasHeight / tmplH;

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
