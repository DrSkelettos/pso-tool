/**
 * perspective-normalizer.js — Perspective correction via OpenCV.js
 * Exposes global: PerspectiveNormalizer
 *
 * Maps the four detected marker centroids to the exact corners of a fixed
 * target canvas (2480 × 3508 = A4 at 300 DPI), removing all rotation,
 * skew, and perspective distortion.
 */
var PerspectiveNormalizer = (function () {
  'use strict';

  var TARGET_W = 2480;
  var TARGET_H = 3508;

  // ─── Build flat Float32Array for cv.matFromArray ──────────────────────────
  function buildPointsArray(pts) {
    // pts: [{ x, y }, { x, y }, { x, y }, { x, y }] in order TL,TR,BR,BL
    return new Float32Array([
      pts[0].x, pts[0].y,
      pts[1].x, pts[1].y,
      pts[2].x, pts[2].y,
      pts[3].x, pts[3].y
    ]);
  }

  // ─── Main normalization ───────────────────────────────────────────────────
  /**
   * Perspective-correct srcMat using the four detected marker centroids.
   *
   * @param {cv.Mat}  srcMat  — full-resolution grayscale (or binary) Mat of scanned page
   * @param {{ tl, tr, bl, br }} markers — each with { x, y }
   * @param {number}  targetW — normalized output width  (default 2480)
   * @param {number}  targetH — normalized output height (default 3508)
   * @returns {{ normalized: cv.Mat, transform: cv.Mat }}
   *   Caller must delete both Mats when finished.
   */
  function normalize(srcMat, markers, targetW, targetH) {
    var tw = targetW || TARGET_W;
    var th = targetH || TARGET_H;

    // Source points: TL → TR → BR → BL (clockwise)
    var srcArr = buildPointsArray([
      markers.tl,
      markers.tr,
      markers.br,
      markers.bl
    ]);

    // Destination points: exact corners of target rectangle
    var dstArr = new Float32Array([
      0,  0,
      tw, 0,
      tw, th,
      0,  th
    ]);

    var srcMtx = cv.matFromArray(4, 1, cv.CV_32FC2, srcArr);
    var dstMtx = cv.matFromArray(4, 1, cv.CV_32FC2, dstArr);

    var transform  = cv.getPerspectiveTransform(srcMtx, dstMtx);
    var normalized = new cv.Mat();
    var dsize      = new cv.Size(tw, th);

    cv.warpPerspective(srcMat, normalized, transform, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255));

    srcMtx.delete();
    dstMtx.delete();

    UI.log('Perspective correction done → ' + tw + 'x' + th, 'ok');

    return { normalized: normalized, transform: transform };
  }

  // ─── Normalize from color canvas (for display) ────────────────────────────
  /**
   * Run perspective correction on a gray Mat and return a canvas for display.
   *
   * @param {cv.Mat} grayMat
   * @param {{ tl, tr, bl, br }} markers
   * @returns {{ canvas: HTMLCanvasElement, normalized: cv.Mat, transform: cv.Mat }}
   *   normalized Mat must be deleted by caller; canvas is a plain DOM element.
   */
  function normalizeToCanvas(grayMat, markers, targetW, targetH) {
    var result = normalize(grayMat, markers, targetW, targetH);
    var canvas = document.createElement('canvas');
    cv.imshow(canvas, result.normalized);
    return {
      canvas: canvas,
      normalized: result.normalized,
      transform: result.transform
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    normalize: normalize,
    normalizeToCanvas: normalizeToCanvas,
    TARGET_W: TARGET_W,
    TARGET_H: TARGET_H
  };
})();
