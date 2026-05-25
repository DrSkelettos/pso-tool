/**
 * MarkerDetector
 * ==============
 * Detects four solid black corner-alignment markers on a rendered PDF canvas.
 *
 * Strategy — tight per-corner region search with proximity selection:
 *
 *   The image is divided into four tight corner patches. Each patch is searched
 *   independently. Within each patch the marker is selected as the blob CLOSEST
 *   TO THE CORNER — not the largest — because:
 *     • The patch is kept small (innerFraction ≈ 12% per side) so most form content
 *       (text, borders, header boxes) falls outside it.
 *     • The markers are explicitly placed at the extreme corners; any form content
 *       that does creep into the patch is farther from the corner than the marker.
 *
 *   Two-pass search: tight region first, then an expanded region if nothing is found.
 *
 * Pipeline per corner:
 *   Full canvas → Grayscale + GaussianBlur  (computed once)
 *   → ROI = tight corner patch  (innerFraction × innerFraction)
 *   → For each threshold in [Otsu, 80, 120]:
 *       threshold BINARY_INV → morphologyEx CLOSE → findContours
 *       filter: area, aspect ratio, solidity
 *       pick the blob whose CENTER is CLOSEST TO THE CORNER PIXEL
 *       stop at first threshold that produces a qualifying blob
 *   → If still nothing: repeat with expanded patch (outerFraction)
 *   → Offset local coordinates back to full-canvas space
 *
 * Size-consistency check: rejects results where one marker's area is more
 * than maxSizeRatio× any other (likely a false positive crept in).
 */
class MarkerDetector {

    /**
     * @param {Object}   [config]
     * @param {number}   [config.innerFraction=0.12]  - First-pass corner region (fraction of W or H)
     * @param {number}   [config.outerFraction=0.22]  - Fallback corner region if inner yields nothing
     * @param {number}   [config.minArea=50]          - Min blob area in px² (scale-independent via area filter)
     * @param {number}   [config.maxAreaFraction=0.30]- Max blob area as fraction of patch area
     * @param {number}   [config.minSolidity=0.65]    - Min area/hull ratio; filled circle ≈ 0.78
     * @param {number}   [config.maxAspectRatio=1.8]  - Max width/height ratio; circles/squares ≈ 1.0
     * @param {number}   [config.maxSizeRatio=5.0]    - Max allowed max/min marker area ratio across 4 corners
     * @param {number}   [config.blurKernelSize=5]    - GaussianBlur kernel size (must be odd)
     * @param {number}   [config.morphKernelSize=5]   - Morphological closing kernel size
     * @param {number[]} [config.thresholdsToTry]     - Threshold values; 0 = Otsu automatic
     */
    constructor(config = {}) {
        this.innerFraction   = config.innerFraction   ?? 0.12;
        this.outerFraction   = config.outerFraction   ?? 0.22;
        this.minArea         = config.minArea         ?? 50;
        this.maxAreaFraction = config.maxAreaFraction ?? 0.30;
        this.minSolidity     = config.minSolidity     ?? 0.65;
        this.maxAspectRatio  = config.maxAspectRatio  ?? 1.8;
        this.maxSizeRatio    = config.maxSizeRatio    ?? 5.0;
        this.blurKernelSize  = config.blurKernelSize  ?? 5;
        this.morphKernelSize = config.morphKernelSize ?? 5;
        this.thresholdsToTry = config.thresholdsToTry ?? [0, 80, 120];
    }

    // ================================================================
    // Public API
    // ================================================================

    /**
     * Detect the four corner markers in the given canvas.
     *
     * @param {HTMLCanvasElement} canvas - Rendered PDF page canvas
     * @returns {MarkerResult} Detection result (check .allFound before using)
     */
    detect(canvas) {
        const W = canvas.width;
        const H = canvas.height;

        // Read the full canvas once; convert to grayscale and blur once.
        // All four corner ROIs are extracted from this single blurred Mat.
        const srcMat  = cv.imread(canvas);
        const gray    = new cv.Mat();
        const blurred = new cv.Mat();

        try {
            cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY);
            const bksize = new cv.Size(this.blurKernelSize, this.blurKernelSize);
            cv.GaussianBlur(gray, blurred, bksize, 0);

            // Each corner definition: (name, full-canvas offset, local corner pixel)
            // localCornerX/Y is the pixel in ROI-space that is the actual page corner —
            // blobs closest to this point are preferred.
            const cornerDefs = [
                { name: 'topLeft',     ox: 0,      oy: 0,      lcx: 0,  lcy: 0  },
                { name: 'topRight',    ox: W,      oy: 0,      lcx: 1,  lcy: 0  },
                { name: 'bottomLeft',  ox: 0,      oy: H,      lcx: 0,  lcy: 1  },
                { name: 'bottomRight', ox: W,      oy: H,      lcx: 1,  lcy: 1  },
            ];

            const markers = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };

            for (const def of cornerDefs) {
                const result = this._searchCorner(blurred, W, H, def);
                if (result) {
                    markers[def.name] = result;
                }
            }

            return this._buildResult(markers);

        } finally {
            srcMat.delete();
            gray.delete();
            blurred.delete();
        }
    }

    // ================================================================
    // Private: per-corner search (two-pass with expanding region)
    // ================================================================

    /**
     * Search for the marker in one corner using a two-pass approach:
     *   Pass 1 — tight patch (innerFraction): catches markers with minimal false positives.
     *   Pass 2 — wider patch (outerFraction): fallback when the marker is further from the edge.
     *
     * Within each patch the blob CLOSEST TO THE CORNER is selected. This is reliable
     * because the patch is kept small, so most form content falls outside it, and any
     * content that does appear in the patch is farther from the corner than the marker.
     *
     * @param {cv.Mat}  blurred  - Full-page blurred grayscale Mat
     * @param {number}  W        - Canvas width
     * @param {number}  H        - Canvas height
     * @param {Object}  def      - Corner definition {name, ox, oy, lcx, lcy}
     * @returns {MarkerCandidate|null}
     * @private
     */
    _searchCorner(blurred, W, H, def) {
        for (const fraction of [this.innerFraction, this.outerFraction]) {
            const rW = Math.max(1, Math.round(W * fraction));
            const rH = Math.max(1, Math.round(H * fraction));

            // Actual canvas-space top-left of this ROI
            const roiX = def.lcx === 0 ? 0 : W - rW;
            const roiY = def.lcy === 0 ? 0 : H - rH;

            // Local corner pixel inside the ROI (the actual page-corner pixel)
            const localCX = def.lcx === 0 ? 0 : rW;
            const localCY = def.lcy === 0 ? 0 : rH;

            const roi = blurred.roi(new cv.Rect(roiX, roiY, rW, rH));
            const candidate = this._findMarkerInRegion(roi, rW, rH, localCX, localCY);
            roi.delete();

            if (candidate) {
                return {
                    center:      { x: candidate.center.x + roiX, y: candidate.center.y + roiY },
                    bounds:      { x: candidate.bounds.x + roiX, y: candidate.bounds.y + roiY,
                                   width: candidate.bounds.width,  height: candidate.bounds.height },
                    area:        candidate.area,
                    solidity:    candidate.solidity,
                    aspectRatio: candidate.aspectRatio,
                    threshold:   candidate.threshold,
                    fraction,
                };
            }
        }
        return null;
    }

    /**
     * Try each threshold value until a qualifying blob is found in the patch.
     * Returns the blob whose CENTER is CLOSEST TO (localCX, localCY) — the
     * corner pixel of the patch in local coordinates.
     *
     * @param {cv.Mat} roi      - Blurred grayscale corner patch (OpenCV ROI)
     * @param {number} rW       - Patch width
     * @param {number} rH       - Patch height
     * @param {number} localCX  - Corner pixel x in local ROI coordinates
     * @param {number} localCY  - Corner pixel y in local ROI coordinates
     * @returns {MarkerCandidate|null}
     * @private
     */
    _findMarkerInRegion(roi, rW, rH, localCX, localCY) {
        const regionArea = rW * rH;

        for (const threshVal of this.thresholdsToTry) {
            const candidate = this._tryThreshold(roi, threshVal, regionArea, localCX, localCY);
            if (candidate) return candidate;
        }
        return null;
    }

    /**
     * Apply one threshold value to the corner patch, morphologically close the
     * result, find all qualifying blobs, and return the one whose CENTER is
     * CLOSEST TO (localCX, localCY) — the corner pixel of the patch.
     *
     * @param {cv.Mat} roi        - Blurred grayscale corner patch (ROI)
     * @param {number} threshVal  - Threshold value (0 = Otsu automatic)
     * @param {number} regionArea - rW × rH (pre-computed for the area cap check)
     * @param {number} localCX    - Corner pixel x inside this ROI
     * @param {number} localCY    - Corner pixel y inside this ROI
     * @returns {MarkerCandidate|null}
     * @private
     */
    _tryThreshold(roi, threshVal, regionArea, localCX, localCY) {
        const binary   = new cv.Mat();
        const closed   = new cv.Mat();
        const contours = new cv.MatVector();
        const hier     = new cv.Mat();

        try {
            // --- Threshold (BINARY_INV: dark pixels → 255, background → 0) ---
            if (threshVal === 0) {
                // Otsu: automatically finds optimal global threshold from histogram
                cv.threshold(roi, binary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
            } else {
                cv.threshold(roi, binary, threshVal, 255, cv.THRESH_BINARY_INV);
            }

            // --- Morphological close: fill holes inside solid printed circles ---
            const mksize = new cv.Size(this.morphKernelSize, this.morphKernelSize);
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, mksize);
            cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
            kernel.delete();

            // --- Find external contours ---
            cv.findContours(closed, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let best     = null;
            let bestDist = Infinity;

            for (let i = 0; i < contours.size(); i++) {
                const c    = contours.get(i);
                const area = cv.contourArea(c);

                // Reject too-small blobs (noise) and too-large ones (page border)
                if (area < this.minArea) continue;
                if (area > regionArea * this.maxAreaFraction) continue;

                const rect = cv.boundingRect(c);
                const ar   = rect.width / Math.max(rect.height, 1);
                if (ar < 1 / this.maxAspectRatio || ar > this.maxAspectRatio) continue;

                // Solidity = blob area / convex hull area
                // Filled circle ≈ 0.78, filled square ≈ 1.0, hollow/text ≪ 0.6
                const hull     = new cv.Mat();
                cv.convexHull(c, hull, false, true);
                const hullArea = cv.contourArea(hull);
                hull.delete();

                const solidity = hullArea > 0 ? area / hullArea : 0;
                if (solidity < this.minSolidity) continue;

                const cx   = rect.x + rect.width  / 2;
                const cy   = rect.y + rect.height / 2;
                const dist = Math.hypot(cx - localCX, cy - localCY);

                // Pick the blob whose CENTER is CLOSEST TO THE CORNER.
                // Within a tight corner patch, markers are at the corner and form
                // content (headers, labels) is farther toward the page interior.
                if (dist < bestDist) {
                    bestDist = dist;
                    best = {
                        center:      { x: cx, y: cy },
                        bounds:      { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                        area,
                        solidity:    Math.round(solidity * 1000) / 1000,
                        aspectRatio: Math.round(ar * 100) / 100,
                        threshold:   threshVal,
                    };
                }
            }

            return best;

        } finally {
            binary.delete();
            closed.delete();
            for (let i = 0; i < contours.size(); i++) contours.get(i).delete();
            contours.delete();
            hier.delete();
        }
    }

    // ================================================================
    // Private: result assembly + size consistency
    // ================================================================

    /**
     * Assemble the final MarkerResult from the four per-corner candidates.
     * Verifies that all four markers have similar sizes (false positives tend
     * to be much larger or smaller than genuine markers).
     *
     * @param {{ topLeft, topRight, bottomLeft, bottomRight }} markers
     * @returns {MarkerResult}
     * @private
     */
    _buildResult(markers) {
        const { topLeft, topRight, bottomLeft, bottomRight } = markers;
        const found      = [topLeft, topRight, bottomLeft, bottomRight].filter(Boolean);
        const foundCount = found.length;

        let sizeConsistent = true;
        if (foundCount === 4) {
            const areas    = found.map(m => m.area);
            const maxArea  = Math.max(...areas);
            const minArea  = Math.min(...areas);
            const ratio    = maxArea / minArea;
            if (ratio > this.maxSizeRatio) {
                sizeConsistent = false;
                console.warn(
                    `[MarkerDetector] Größen-Inkonsistenz: max/min-Flächenverhältnis = ${ratio.toFixed(1)} ` +
                    `(Grenzwert: ${this.maxSizeRatio}). Ein Eckbereich hat möglicherweise ein Fehlpositiv.`
                );
            }
        }

        if (foundCount > 0) {
            const thr = found.map(m => m.threshold === 0 ? 'Otsu' : m.threshold).join(', ');
            console.log(`[MarkerDetector] ${foundCount}/4 Marker gefunden. Schwellwerte: [${thr}]`);
        } else {
            console.warn('[MarkerDetector] Kein Marker in keiner Ecke gefunden.');
        }

        return {
            allFound:      foundCount === 4 && sizeConsistent,
            foundCount,
            sizeConsistent,
            topLeft,
            topRight,
            bottomLeft,
            bottomRight,
            allCandidates: found,
        };
    }

    // ================================================================
    // Configuration
    // ================================================================

    /** @param {Object} config */
    updateConfig(config) {
        if ('innerFraction'   in config) this.innerFraction   = config.innerFraction;
        if ('outerFraction'   in config) this.outerFraction   = config.outerFraction;
        if ('minArea'         in config) this.minArea         = config.minArea;
        if ('maxAreaFraction' in config) this.maxAreaFraction = config.maxAreaFraction;
        if ('minSolidity'     in config) this.minSolidity     = config.minSolidity;
        if ('maxAspectRatio'  in config) this.maxAspectRatio  = config.maxAspectRatio;
        if ('maxSizeRatio'    in config) this.maxSizeRatio    = config.maxSizeRatio;
        if ('blurKernelSize'  in config) this.blurKernelSize  = config.blurKernelSize;
        if ('morphKernelSize' in config) this.morphKernelSize = config.morphKernelSize;
    }
}

/**
 * @typedef {Object} MarkerCandidate
 * @property {{x:number, y:number}}                             center
 * @property {{x:number, y:number, width:number, height:number}} bounds
 * @property {number} area
 * @property {number} solidity
 * @property {number} aspectRatio
 * @property {number} threshold - Threshold value that found this marker (0 = Otsu)
 */

/**
 * @typedef {Object} MarkerResult
 * @property {boolean}              allFound       - True iff all 4 corners were detected and size-consistent
 * @property {number}               foundCount     - How many corners produced a candidate (0–4)
 * @property {boolean}              sizeConsistent - False if marker sizes differ too much
 * @property {MarkerCandidate|null} topLeft
 * @property {MarkerCandidate|null} topRight
 * @property {MarkerCandidate|null} bottomLeft
 * @property {MarkerCandidate|null} bottomRight
 * @property {MarkerCandidate[]}    allCandidates  - The four found candidates (for debug)
 */
