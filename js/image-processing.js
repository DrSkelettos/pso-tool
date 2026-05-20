/**
 * ImageProcessor
 * ==============
 * Converts a rendered PDF canvas into a binary OpenCV Mat that the
 * CheckboxDetector can analyse.
 *
 * Processing pipeline:
 *   Canvas (RGBA)
 *     → cv.imread()         reads pixel data from the canvas
 *     → cv.cvtColor()       RGBA → Grayscale
 *     → cv.threshold()      Grayscale → Binary (THRESH_BINARY_INV)
 *     → [morphology]        optional noise reduction
 *
 * Why THRESH_BINARY_INV?
 *   After thresholding, dark regions (pen marks, X-crosses, ticks) become
 *   WHITE (value 255) and the light background becomes BLACK (0).
 *   cv.countNonZero() then directly counts the dark/marked pixels, which
 *   is what the CheckboxDetector needs.
 *
 * IMPORTANT: The caller is responsible for calling .delete() on the
 * returned Mat to release OpenCV/WASM memory.
 */
class ImageProcessor {

    /**
     * @param {Object} [config]
     * @param {number}  [config.thresholdValue=128]      - Pixel intensity below which a pixel is
     *                                                     considered "dark". Range: 0–255.
     * @param {boolean} [config.morphologicalOps=false]  - Apply morphological noise reduction.
     * @param {string}  [config.morphType='opening']     - 'opening' | 'closing' | 'erosion' | 'dilation'
     */
    constructor(config = {}) {
        this.thresholdValue   = config.thresholdValue   ?? 128;
        this.morphologicalOps = config.morphologicalOps ?? false;
        this.morphType        = config.morphType        ?? 'opening';
    }

    // ================================================================
    // Main Entry Point
    // ================================================================

    /**
     * Process an HTMLCanvasElement and return a binary OpenCV Mat.
     *
     * The returned Mat uses THRESH_BINARY_INV:
     *   - Dark pixels (checkbox marks) → 255 (white / non-zero)
     *   - Light pixels (background)    →   0 (black / zero)
     *
     * @param {HTMLCanvasElement} canvas - The rendered PDF page canvas
     * @returns {cv.Mat} Binary Mat — caller must call .delete() when done!
     */
    processCanvas(canvas) {
        // Step 1: Read canvas pixel data into an OpenCV Mat (RGBA, 4 channels)
        const src = cv.imread(canvas);

        // Step 2: Convert RGBA → Grayscale (single channel)
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        src.delete(); // Free RGBA source

        // Step 3: Apply adaptive or fixed thresholding
        const binary = new cv.Mat();
        cv.threshold(
            gray,
            binary,
            this.thresholdValue,
            255,
            cv.THRESH_BINARY_INV
        );
        gray.delete(); // Free grayscale intermediate

        // Step 4 (optional): Morphological operations for noise reduction
        if (this.morphologicalOps) {
            const cleaned = this._applyMorphology(binary);
            binary.delete();
            return cleaned;
        }

        return binary;
    }

    // ================================================================
    // Morphological Operations
    // ================================================================

    /**
     * Apply morphological operations to reduce scanner noise or fill gaps.
     *
     * Available operations:
     *
     *   opening  = erosion → dilation
     *     Removes small bright noise specks without significantly affecting
     *     larger checkbox marks. Best for removing scanner dust/artifacts.
     *
     *   closing  = dilation → erosion
     *     Fills small holes and gaps in checkbox marks. Best for faint
     *     or broken pen strokes.
     *
     *   erosion  - Shrinks bright regions. Removes isolated noise pixels.
     *
     *   dilation - Grows bright regions. Connects nearby fragments.
     *
     * @param {cv.Mat} mat - Binary Mat (caller-owned, not deleted here)
     * @returns {cv.Mat} New processed Mat — caller must delete()
     * @private
     */
    _applyMorphology(mat) {
        // 3×3 rectangular structuring element — good general-purpose kernel
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        const result = new cv.Mat();

        switch (this.morphType) {
            case 'erosion':
                cv.erode(mat, result, kernel);
                break;

            case 'dilation':
                cv.dilate(mat, result, kernel);
                break;

            case 'closing':
                cv.morphologyEx(mat, result, cv.MORPH_CLOSE, kernel);
                break;

            case 'opening':
            default:
                cv.morphologyEx(mat, result, cv.MORPH_OPEN, kernel);
                break;
        }

        kernel.delete();
        return result;
    }

    // ================================================================
    // Configuration
    // ================================================================

    /**
     * Update processing parameters at runtime.
     * Only supplied keys are updated; others retain their current values.
     *
     * @param {Object} config - Partial configuration object
     */
    updateConfig(config) {
        if ('thresholdValue'   in config) this.thresholdValue   = config.thresholdValue;
        if ('morphologicalOps' in config) this.morphologicalOps = config.morphologicalOps;
        if ('morphType'        in config) this.morphType        = config.morphType;
    }

    /**
     * Return a copy of the current configuration.
     * @returns {Object}
     */
    getConfig() {
        return {
            thresholdValue:   this.thresholdValue,
            morphologicalOps: this.morphologicalOps,
            morphType:        this.morphType,
        };
    }
}
