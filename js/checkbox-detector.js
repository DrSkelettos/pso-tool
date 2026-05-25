/**
 * CheckboxDetector
 * ================
 * Detects which checkboxes are marked on a perspective-corrected binary image.
 *
 * Key improvements over naive pixel counting:
 *
 *   1. Inner ROI padding
 *      The outer edges of a checkbox box are excluded via configurable padding.
 *      This prevents the printed box border from being counted as a mark.
 *
 *      full field: [x, y, w, h]
 *      inner ROI:  [x+pad, y+pad, w−2*pad, h−2*pad]
 *
 *   2. Confidence scoring
 *      A normalised confidence value [0, 1] is computed based on how far the
 *      pixel ratio deviates from the expected empty and filled baselines.
 *
 *      confidence = clamp((ratio − emptyBaseline) / (filledBaseline − emptyBaseline), 0, 1)
 *
 *      Fields with confidence < uncertainThreshold are flagged as uncertain.
 *
 *   3. Extended result structure
 *      Each field returns: { checked, confidence, ratio, blackPixels, totalPixels, uncertain }
 *
 * Core principle — NO OCR, NO machine learning:
 *   For each template field: extract inner ROI → countNonZero → ratio → decision
 */
class CheckboxDetector {

    /**
     * @param {Object} [config]
     * @param {number}  [config.blackPixelRatio=0.12]    - Ratio threshold for "checked"
     * @param {number}  [config.innerPadding=5]          - Pixels to strip from each ROI edge
     * @param {number}  [config.emptyBaseline=0.03]      - Expected ratio for a clearly empty field
     * @param {number}  [config.filledBaseline=0.25]     - Expected ratio for a clearly filled field
     * @param {number}  [config.uncertainThreshold=0.75] - Confidence below this → flagged uncertain
     */
    constructor(config = {}) {
        this.blackPixelRatio    = config.blackPixelRatio    ?? 0.12;
        this.innerPadding       = config.innerPadding       ?? 5;
        this.emptyBaseline      = config.emptyBaseline      ?? 0.03;
        this.filledBaseline     = config.filledBaseline     ?? 0.25;
        this.uncertainThreshold = config.uncertainThreshold ?? 0.75;
    }

    // ================================================================
    // Detection
    // ================================================================

    /**
     * Analyse all checkbox fields in the given binary image.
     *
     * @param {cv.Mat}        binaryMat    - Binary Mat from ImageProcessor
     *                                        (THRESH_BINARY_INV: dark pixels = 255)
     * @param {Array<Object>} fields       - Template fields. In the new pipeline these
     *                                        are already in normalised pixel coordinates
     *                                        (no scaling needed). In the legacy pipeline
     *                                        they are pre-scaled via TemplateManager.
     * @returns {Array<CheckboxResult>}
     */
    detectAll(binaryMat, fields) {
        const results = [];

        for (const field of fields) {
            // Treat missing type as 'checkbox' for backward compatibility with templates
            // that omit the type field (all fields are assumed to be checkboxes).
            if (field.type && field.type !== 'checkbox') continue;

            try {
                results.push(this._detectOne(binaryMat, field));
            } catch (err) {
                console.warn(`[CheckboxDetector] Feld "${field.id}":`, err.message);
                results.push({
                    id:          field.id,
                    checked:     false,
                    confidence:  0,
                    ratio:       0,
                    blackPixels: 0,
                    totalPixels: 0,
                    uncertain:   true,
                    error:       err.message,
                });
            }
        }

        return results;
    }

    /**
     * Analyse a single checkbox field using inner ROI + confidence scoring.
     *
     * @param {cv.Mat}   binaryMat - Full-page binary Mat
     * @param {Object}   field     - {id, x, y, width, height}
     * @returns {CheckboxResult}
     * @private
     */
    _detectOne(binaryMat, field) {
        const { id, x, y, width, height } = field;
        const pad = this.innerPadding;

        // --- Inner ROI (strip the printed box border) ---
        const innerX = Math.round(x)      + pad;
        const innerY = Math.round(y)      + pad;
        const innerW = Math.round(width)  - pad * 2;
        const innerH = Math.round(height) - pad * 2;

        if (innerW <= 0 || innerH <= 0) {
            throw new Error(
                `ROI nach Padding zu klein: ${innerW}×${innerH}px. ` +
                `Padding (${pad}) reduzieren oder Feldgröße vergrößern.`
            );
        }

        // --- Clamp ROI to image boundaries ---
        const imgW = binaryMat.cols;
        const imgH = binaryMat.rows;

        const roiX = Math.max(0, Math.min(innerX, imgW - 1));
        const roiY = Math.max(0, Math.min(innerY, imgH - 1));
        const roiW = Math.min(innerW, imgW - roiX);
        const roiH = Math.min(innerH, imgH - roiY);

        if (roiW <= 0 || roiH <= 0) {
            throw new Error(
                `ROI "${id}" liegt außerhalb der Bildgrenzen ` +
                `(${imgW}×${imgH}): x=${roiX}, y=${roiY}, w=${roiW}, h=${roiH}`
            );
        }

        // --- Count non-zero pixels in inner ROI ---
        const roi         = binaryMat.roi(new cv.Rect(roiX, roiY, roiW, roiH));
        const blackPixels = cv.countNonZero(roi);
        roi.delete();

        const totalPixels = roiW * roiH;
        const ratio       = blackPixels / totalPixels;

        // --- Confidence score ---
        // Maps ratio linearly from [emptyBaseline → 0] to [filledBaseline → 1]
        const range      = this.filledBaseline - this.emptyBaseline;
        const rawConf    = range > 0
            ? (ratio - this.emptyBaseline) / range
            : (ratio > this.emptyBaseline ? 1 : 0);
        const confidence = Math.max(0, Math.min(1, rawConf));

        const checked   = ratio > this.blackPixelRatio;
        const uncertain = confidence < this.uncertainThreshold;

        return {
            id,
            checked,
            confidence:  Math.round(confidence  * 1000) / 1000,
            ratio:       Math.round(ratio        * 100000) / 100000,
            blackPixels,
            totalPixels,
            uncertain,
            // Inner ROI bounds in image pixel coordinates (for overlay drawing)
            innerBounds: { x: roiX, y: roiY, width: roiW, height: roiH },
            // Original (outer) field bounds
            outerBounds: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) },
        };
    }

    // ================================================================
    // Output Formatting
    // ================================================================

    /**
     * Convert results to the extended JSON output format.
     *
     * Each field becomes:
     *   {
     *     "field_id": {
     *       "checked":    true,
     *       "confidence": 0.96,
     *       "ratio":      0.41,
     *       "uncertain":  false
     *     }
     *   }
     *
     * @param {Array<CheckboxResult>} results
     * @returns {Object}
     */
    resultsToJSON(results) {
        const output = {};
        for (const r of results) {
            output[r.id] = {
                checked:    r.checked,
                confidence: r.confidence,
                ratio:      r.ratio,
                uncertain:  r.uncertain ?? false,
            };
        }
        return output;
    }

    /**
     * Convert results to CSV-ready row objects.
     * @param {Array<CheckboxResult>} results
     * @returns {Array<Object>}
     */
    resultsToCSVRows(results) {
        return results.map(r => ({
            Feld:          r.id,
            Angekreuzt:    r.checked    ? 'Ja'   : 'Nein',
            Unsicher:      r.uncertain  ? 'Ja'   : 'Nein',
            Confidence:    r.confidence,
            Verhaeltnis:   r.ratio,
            SchwarzePx:    r.blackPixels,
            GesamtPx:      r.totalPixels,
            Fehler:        r.error ?? '',
        }));
    }

    // ================================================================
    // Configuration
    // ================================================================

    /** @param {Object} config */
    updateConfig(config) {
        if ('blackPixelRatio'    in config) this.blackPixelRatio    = Math.max(0, Math.min(1, config.blackPixelRatio));
        if ('innerPadding'       in config) this.innerPadding       = Math.max(0, config.innerPadding);
        if ('emptyBaseline'      in config) this.emptyBaseline      = config.emptyBaseline;
        if ('filledBaseline'     in config) this.filledBaseline     = config.filledBaseline;
        if ('uncertainThreshold' in config) this.uncertainThreshold = config.uncertainThreshold;
    }

    /** @returns {Object} */
    getConfig() {
        return {
            blackPixelRatio:    this.blackPixelRatio,
            innerPadding:       this.innerPadding,
            emptyBaseline:      this.emptyBaseline,
            filledBaseline:     this.filledBaseline,
            uncertainThreshold: this.uncertainThreshold,
        };
    }
}

/**
 * @typedef {Object} CheckboxResult
 * @property {string}  id           - Field ID from template
 * @property {boolean} checked      - Whether the checkbox is marked
 * @property {number}  confidence   - Detection confidence [0, 1]
 * @property {number}  ratio        - Dark-pixel ratio in inner ROI [0, 1]
 * @property {number}  blackPixels  - Count of dark pixels in inner ROI
 * @property {number}  totalPixels  - Total pixels in inner ROI
 * @property {boolean} uncertain    - True if confidence < uncertainThreshold
 * @property {Object}  innerBounds  - {x, y, width, height} of analysed inner ROI
 * @property {Object}  outerBounds  - {x, y, width, height} of full field
 * @property {string}  [error]      - Error message if detection failed
 */
