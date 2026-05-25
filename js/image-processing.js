/**
 * ImageProcessor
 * ==============
 * Converts a rendered (or perspective-corrected) PDF canvas into a binary
 * OpenCV Mat that the CheckboxDetector can analyse.
 *
 * Two thresholding modes are available:
 *
 *   ADAPTIVE (default, recommended)
 *     cv.adaptiveThreshold() with ADAPTIVE_THRESH_GAUSSIAN_C + THRESH_BINARY_INV
 *     — adapts to local brightness variations caused by scanner shadows,
 *       uneven illumination, or paper colour differences.
 *     — requires a light Gaussian blur beforehand to suppress noise.
 *
 *   GLOBAL (legacy / fallback)
 *     cv.threshold() with THRESH_BINARY_INV and a fixed intensity value.
 *     — fast but sensitive to brightness differences across the page.
 *
 * Why THRESH_BINARY_INV?
 *   After thresholding, dark regions (pen marks, X-crosses, ticks) become
 *   WHITE (value 255) and the light background becomes BLACK (0).
 *   cv.countNonZero() then directly counts the dark/marked pixels.
 *
 * IMPORTANT: The caller is responsible for calling .delete() on the
 * returned Mat to release OpenCV/WASM memory.
 */
class ImageProcessor {

    /**
     * @param {Object}  [config]
     * @param {boolean} [config.useAdaptive=true]         - Use adaptive threshold (recommended)
     * @param {number}  [config.adaptiveBlockSize=31]     - Adaptive: local neighbourhood size (odd ≥ 3)
     * @param {number}  [config.adaptiveC=10]             - Adaptive: constant subtracted from local mean
     * @param {number}  [config.thresholdValue=128]       - Global: fixed intensity threshold (0–255)
     * @param {boolean} [config.morphologicalOps=false]   - Apply morphological noise reduction
     * @param {string}  [config.morphType='opening']      - 'opening'|'closing'|'erosion'|'dilation'
     */
    constructor(config = {}) {
        this.useAdaptive       = config.useAdaptive       ?? true;
        this.adaptiveBlockSize = config.adaptiveBlockSize ?? 31;
        this.adaptiveC         = config.adaptiveC         ?? 10;
        this.thresholdValue    = config.thresholdValue    ?? 128;
        this.morphologicalOps  = config.morphologicalOps  ?? false;
        this.morphType         = config.morphType         ?? 'opening';
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
     * In adaptive mode (default), the threshold is computed locally per
     * neighbourhood, making it robust against uneven lighting and shadows.
     *
     * @param {HTMLCanvasElement} canvas - The rendered/normalized PDF page canvas
     * @returns {cv.Mat} Binary Mat — caller must call .delete() when done!
     */
    processCanvas(canvas) {
        // Step 1: Read canvas pixel data into an OpenCV Mat (RGBA, 4 channels)
        const src = cv.imread(canvas);

        // Step 2: Convert RGBA → Grayscale (single channel)
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        src.delete();

        let binary;

        if (this.useAdaptive) {
            binary = this._adaptiveThreshold(gray);
        } else {
            binary = new cv.Mat();
            cv.threshold(gray, binary, this.thresholdValue, 255, cv.THRESH_BINARY_INV);
        }
        gray.delete();

        // Step 4 (optional): Morphological operations for noise reduction
        if (this.morphologicalOps) {
            const cleaned = this._applyMorphology(binary);
            binary.delete();
            return cleaned;
        }

        return binary;
    }

    /**
     * Apply adaptive Gaussian thresholding.
     * A 3×3 Gaussian blur is applied first to suppress high-frequency noise
     * that would otherwise create many false-positive non-zero pixels.
     *
     * @param {cv.Mat} gray - Single-channel grayscale Mat
     * @returns {cv.Mat} Binary Mat (THRESH_BINARY_INV)
     * @private
     */
    _adaptiveThreshold(gray) {
        // Ensure block size is odd and at least 3
        let blockSize = this.adaptiveBlockSize;
        if (blockSize < 3) blockSize = 3;
        if (blockSize % 2 === 0) blockSize += 1;

        // Light pre-blur reduces salt-and-pepper noise before adaptive threshold
        const blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);

        const binary = new cv.Mat();
        cv.adaptiveThreshold(
            blurred, binary, 255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY_INV,
            blockSize,
            this.adaptiveC
        );
        blurred.delete();

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
        if ('useAdaptive'       in config) this.useAdaptive       = config.useAdaptive;
        if ('adaptiveBlockSize' in config) this.adaptiveBlockSize = config.adaptiveBlockSize;
        if ('adaptiveC'         in config) this.adaptiveC         = config.adaptiveC;
        if ('thresholdValue'    in config) this.thresholdValue    = config.thresholdValue;
        if ('morphologicalOps'  in config) this.morphologicalOps  = config.morphologicalOps;
        if ('morphType'         in config) this.morphType         = config.morphType;
    }

    /**
     * Return a copy of the current configuration.
     * @returns {Object}
     */
    getConfig() {
        return {
            useAdaptive:       this.useAdaptive,
            adaptiveBlockSize: this.adaptiveBlockSize,
            adaptiveC:         this.adaptiveC,
            thresholdValue:    this.thresholdValue,
            morphologicalOps:  this.morphologicalOps,
            morphType:         this.morphType,
        };
    }
}
