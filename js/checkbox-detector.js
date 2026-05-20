/**
 * CheckboxDetector
 * ================
 * Detects which checkboxes are marked on a processed binary image.
 *
 * Core principle — NO OCR, NO machine learning:
 *   For each template field (a predefined rectangular region):
 *     1. Extract the Region of Interest (ROI) from the binary Mat
 *     2. Count non-zero pixels (= dark/marked pixels after THRESH_BINARY_INV)
 *     3. Calculate ratio = nonZeroPixels / totalPixels
 *     4. If ratio > threshold → checkbox is CHECKED
 *
 * This approach is:
 *   - Deterministic (same input always produces the same output)
 *   - Fast (no network, no model inference)
 *   - Robust against various mark styles:
 *       ✓ checks/ticks, ✗ X-crosses, ■ filled boxes, ○ circles, strokes
 *   - Works with ballpoint pens, felt-tip pens, pencils
 *
 * The recommended starting threshold is 0.12 (12% of pixels must be dark).
 * This value is intentionally low to catch light/faint marks.
 * Adjust upward if blank fields are falsely detected as checked.
 */
class CheckboxDetector {

    /**
     * @param {Object} [config]
     * @param {number} [config.blackPixelRatio=0.12] - Minimum ratio of dark pixels
     *   required to consider a checkbox "checked". Range: 0.0–1.0.
     */
    constructor(config = {}) {
        this.blackPixelRatio = config.blackPixelRatio ?? 0.12;
    }

    // ================================================================
    // Detection
    // ================================================================

    /**
     * Analyse all checkbox fields in a given set of template fields.
     *
     * @param {cv.Mat}        binaryMat    - Pre-processed binary Mat from ImageProcessor
     *                                        (THRESH_BINARY_INV: dark pixels = 255)
     * @param {Array<Object>} scaledFields - Template fields already scaled to canvas
     *                                        coordinates via TemplateManager.scaleField()
     * @returns {Array<DetectionResult>} One result per checkbox field
     */
    detectAll(binaryMat, scaledFields) {
        const results = [];

        for (const field of scaledFields) {
            if (field.type !== 'checkbox') {
                // Extensibility hook: non-checkbox fields are skipped but could
                // be handled by subclasses or additional detectors later.
                continue;
            }

            try {
                const result = this._detectOne(binaryMat, field);
                results.push(result);
            } catch (err) {
                // Log and continue — a bad field should not abort the entire analysis
                console.warn(`[CheckboxDetector] Fehler bei Feld "${field.id}":`, err);
                results.push({
                    id:           field.id,
                    checked:      false,
                    ratio:        0,
                    blackPixels:  0,
                    totalPixels:  0,
                    error:        err.message,
                });
            }
        }

        return results;
    }

    /**
     * Analyse a single checkbox region.
     *
     * @param {cv.Mat}   binaryMat  - Full-page binary Mat
     * @param {Object}   field      - Scaled field {id, x, y, width, height}
     * @returns {DetectionResult}
     * @private
     */
    _detectOne(binaryMat, field) {
        const { id, x, y, width, height } = field;

        const imgW = binaryMat.cols;
        const imgH = binaryMat.rows;

        // Clamp coordinates to the image boundaries.
        // This protects against templates defined for a slightly different
        // page size than the actual PDF page (e.g. off-by-a-few pixels).
        const roiX = Math.max(0, Math.min(Math.round(x),      imgW - 1));
        const roiY = Math.max(0, Math.min(Math.round(y),      imgH - 1));
        const roiW = Math.min(Math.round(width),  imgW - roiX);
        const roiH = Math.min(Math.round(height), imgH - roiY);

        if (roiW <= 0 || roiH <= 0) {
            throw new Error(
                `ROI außerhalb der Bildgrenzen: ` +
                `Feld "${id}" → x=${roiX}, y=${roiY}, w=${roiW}, h=${roiH} ` +
                `(Bildgröße: ${imgW}×${imgH})`
            );
        }

        // Extract the Region of Interest — this does NOT copy pixel data,
        // it creates a header pointing into the existing Mat.
        const rect = new cv.Rect(roiX, roiY, roiW, roiH);
        const roi  = binaryMat.roi(rect);

        // Count non-zero pixels (= bright white = originally dark marks)
        const blackPixels = cv.countNonZero(roi);
        roi.delete(); // Release the ROI header

        const totalPixels = roiW * roiH;
        const ratio       = blackPixels / totalPixels;
        const checked     = ratio > this.blackPixelRatio;

        return {
            id,
            checked,
            ratio:       Math.round(ratio * 100000) / 100000, // 5 decimal places
            blackPixels,
            totalPixels,
        };
    }

    // ================================================================
    // Output Formatting
    // ================================================================

    /**
     * Convert a detection result array into a flat JSON-serialisable object.
     *
     * Example output:
     *   { "question_1_yes": true, "question_1_no": false, "question_2": true }
     *
     * @param {Array<DetectionResult>} results
     * @returns {Object<string, boolean>}
     */
    resultsToJSON(results) {
        const output = {};
        for (const result of results) {
            output[result.id] = result.checked;
        }
        return output;
    }

    /**
     * Convert results to an array of CSV-ready row objects.
     *
     * @param {Array<DetectionResult>} results
     * @returns {Array<Object>}
     */
    resultsToCSVRows(results) {
        return results.map(r => ({
            Feld:           r.id,
            Angekreuzt:     r.checked ? 'Ja' : 'Nein',
            Verhaeltnis:    r.ratio,
            SchwarzePx:     r.blackPixels,
            GesamtPx:       r.totalPixels,
            Fehler:         r.error ?? '',
        }));
    }

    // ================================================================
    // Configuration
    // ================================================================

    /**
     * Update detection parameters.
     * @param {Object} config
     */
    updateConfig(config) {
        if ('blackPixelRatio' in config) {
            this.blackPixelRatio = Math.max(0, Math.min(1, config.blackPixelRatio));
        }
    }

    /** @returns {Object} */
    getConfig() {
        return { blackPixelRatio: this.blackPixelRatio };
    }
}

/**
 * @typedef {Object} DetectionResult
 * @property {string}  id           - Field ID from template
 * @property {boolean} checked      - Whether the checkbox is marked
 * @property {number}  ratio        - Dark-pixel ratio (0.0 – 1.0)
 * @property {number}  blackPixels  - Count of dark pixels in ROI
 * @property {number}  totalPixels  - Total pixels in ROI
 * @property {string}  [error]      - Error message if detection failed
 */
