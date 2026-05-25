/**
 * PerspectiveCorrector
 * ====================
 * Applies a perspective (homography) transformation using the four detected
 * corner markers to produce a geometrically normalized version of the scanned
 * form page.
 *
 * What this corrects:
 *   - Rotation / skew (tilted scans)
 *   - Trapezoidal distortion (perspective / lens distortion)
 *   - Scale differences between scans
 *   - Translation / misalignment
 *
 * After correction, the output canvas has exactly (targetWidth × targetHeight)
 * pixels, and the form content is mapped to a predictable coordinate space
 * matching the template's normalizedWidth × normalizedHeight.
 *
 * OpenCV.js functions used:
 *   cv.getPerspectiveTransform()  — compute 3×3 homography matrix from 4 point pairs
 *   cv.warpPerspective()          — apply the transform to the full image
 *
 * Memory contract:
 *   All internal OpenCV Mats are created and deleted within correct().
 *   The caller receives a plain HTMLCanvasElement — no Mat cleanup needed.
 */
class PerspectiveCorrector {

    /**
     * Correct the perspective of a canvas using four marker positions.
     *
     * The source points are taken as the centroid of each marker's bounding
     * box. Centroids are robust against minor contour-detection noise.
     *
     * Source → Destination point mapping:
     *   topLeft     center  →  (0,          0         )
     *   topRight    center  →  (targetWidth, 0         )
     *   bottomLeft  center  →  (0,          targetHeight)
     *   bottomRight center  →  (targetWidth, targetHeight)
     *
     * @param {HTMLCanvasElement} sourceCanvas  - Original rendered PDF canvas
     * @param {MarkerResult}      markers       - Detected markers from MarkerDetector
     * @param {number}            targetWidth   - Output pixel width
     * @param {number}            targetHeight  - Output pixel height
     * @returns {HTMLCanvasElement} New canvas containing the normalized image
     * @throws {Error} If OpenCV operations fail
     */
    correct(sourceCanvas, markers, targetWidth, targetHeight) {
        if (!markers.allFound) {
            throw new Error(
                `PerspectiveCorrector: Nicht alle 4 Marker vorhanden ` +
                `(${markers.foundCount}/4 gefunden). Korrektur nicht möglich.`
            );
        }

        const { topLeft, topRight, bottomLeft, bottomRight } = markers;

        // Build source point array: [x0,y0, x1,y1, x2,y2, x3,y3]
        // Order must match destination order exactly
        const srcData = [
            topLeft.center.x,     topLeft.center.y,
            topRight.center.x,    topRight.center.y,
            bottomLeft.center.x,  bottomLeft.center.y,
            bottomRight.center.x, bottomRight.center.y,
        ];

        // Build destination point array matching the corners of the target canvas
        const dstData = [
            0,            0,
            targetWidth,  0,
            0,            targetHeight,
            targetWidth,  targetHeight,
        ];

        // Allocate OpenCV Mats
        const srcMat     = cv.imread(sourceCanvas);
        const srcPoints  = cv.matFromArray(4, 1, cv.CV_32FC2, srcData);
        const dstPoints  = cv.matFromArray(4, 1, cv.CV_32FC2, dstData);
        const M          = new cv.Mat();
        const normalized = new cv.Mat();

        try {
            // Compute the 3×3 perspective transform matrix
            const H = cv.getPerspectiveTransform(srcPoints, dstPoints);

            // Apply transform — warpPerspective fills the output to exactly dsize
            const dsize = new cv.Size(targetWidth, targetHeight);
            cv.warpPerspective(srcMat, normalized, H, dsize);
            H.delete();

            // Render the normalized Mat onto a new detached canvas
            const outputCanvas    = document.createElement('canvas');
            outputCanvas.width    = targetWidth;
            outputCanvas.height   = targetHeight;
            cv.imshow(outputCanvas, normalized);

            return outputCanvas;

        } finally {
            // Clean up all OpenCV Mats — even if an exception was thrown above
            srcMat.delete();
            srcPoints.delete();
            dstPoints.delete();
            // M was never used directly (we used H inside try); safe to check
            if (!M.isDeleted()) M.delete();
            if (!normalized.isDeleted()) normalized.delete();
        }
    }

    /**
     * Estimate the quality of a perspective correction by measuring how close
     * the detected markers are to the true corners of the image.
     *
     * Returns a value in [0, 1]:
     *   1.0 = markers are perfectly placed at image corners
     *   0.0 = markers are far from image corners (e.g. large skew)
     *
     * Useful for warning users about extreme distortions.
     *
     * @param {MarkerResult} markers
     * @param {number}       canvasWidth
     * @param {number}       canvasHeight
     * @returns {number}
     */
    estimateDistortionScore(markers, canvasWidth, canvasHeight) {
        if (!markers.allFound) return 0;

        const W = canvasWidth;
        const H = canvasHeight;

        // Ideal corner positions
        const ideal = [
            { x: 0, y: 0 },
            { x: W, y: 0 },
            { x: 0, y: H },
            { x: W, y: H },
        ];

        const found = [
            markers.topLeft.center,
            markers.topRight.center,
            markers.bottomLeft.center,
            markers.bottomRight.center,
        ];

        // Normalised max deviation across all 4 corners
        const diagonal = Math.sqrt(W * W + H * H);
        let maxDeviation = 0;

        for (let i = 0; i < 4; i++) {
            const dx = found[i].x - ideal[i].x;
            const dy = found[i].y - ideal[i].y;
            const d  = Math.sqrt(dx * dx + dy * dy) / diagonal;
            if (d > maxDeviation) maxDeviation = d;
        }

        return Math.max(0, 1 - maxDeviation * 4);
    }
}
