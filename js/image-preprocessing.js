/**
 * image-preprocessing.js — OpenCV.js preprocessing pipeline
 * Exposes global: ImagePreprocessor
 *
 * Pipeline:
 *   canvas → RGBA Mat → Grayscale → Gaussian Blur → Adaptive Threshold → binary Mat
 */
var ImagePreprocessor = (function () {
  'use strict';

  // ─── Canvas → OpenCV Mat ───────────────────────────────────────────────────
  /**
   * Read a canvas element into an RGBA OpenCV Mat.
   * @param {HTMLCanvasElement} canvas
   * @returns {cv.Mat} RGBA Mat — caller must delete
   */
  function canvasToMat(canvas) {
    return cv.imread(canvas);
  }

  // ─── RGBA → Grayscale ──────────────────────────────────────────────────────
  /**
   * @param {cv.Mat} src — RGBA or BGR Mat
   * @returns {cv.Mat} Gray Mat — caller must delete
   */
  function toGrayscale(src) {
    var gray = new cv.Mat();
    // CV_8UC4 (RGBA from canvas) → GRAY
    if (src.channels() === 4) {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    } else if (src.channels() === 3) {
      cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
    } else {
      src.copyTo(gray); // already gray
    }
    return gray;
  }

  // ─── Gaussian Blur ─────────────────────────────────────────────────────────
  /**
   * @param {cv.Mat} gray
   * @param {number} kernelSize — must be odd, default 5
   * @returns {cv.Mat} blurred Mat — caller must delete
   */
  function gaussianBlur(gray, kernelSize) {
    var k = kernelSize || 5;
    if (k % 2 === 0) k += 1; // must be odd
    var blurred = new cv.Mat();
    var ksize = new cv.Size(k, k);
    cv.GaussianBlur(gray, blurred, ksize, 0);
    return blurred;
  }

  // ─── Adaptive Threshold ────────────────────────────────────────────────────
  /**
   * Binarize image using adaptive (local) thresholding.
   * Uses ADAPTIVE_THRESH_GAUSSIAN_C + THRESH_BINARY_INV:
   *   → dark marks on white paper become white pixels (non-zero)
   *
   * @param {cv.Mat} gray — single-channel 8-bit Mat
   * @param {number} blockSize — neighborhood size (odd), default 11
   * @param {number} C — constant subtracted from mean, default 2
   * @returns {cv.Mat} binary Mat — caller must delete
   */
  function adaptiveThreshold(gray, blockSize, C) {
    var bs = blockSize || 11;
    if (bs % 2 === 0) bs += 1;
    var c  = (C !== undefined) ? C : 2;
    var binary = new cv.Mat();
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      bs,
      c
    );
    return binary;
  }

  // ─── Full Preprocessing Pipeline ───────────────────────────────────────────
  /**
   * Run the full preprocessing pipeline on a canvas element.
   *
   * @param {HTMLCanvasElement} canvas
   * @returns {{ src: cv.Mat, gray: cv.Mat, binary: cv.Mat }}
   *   Caller is responsible for deleting all returned Mats via cleanup().
   */
  function preprocess(canvas) {
    UI.log('Preprocessing: ' + canvas.width + 'x' + canvas.height + ' px', 'info');

    var src     = canvasToMat(canvas);
    var gray    = toGrayscale(src);
    var blurred = gaussianBlur(gray, 5);
    var binary  = adaptiveThreshold(blurred, 11, 2);

    // Free intermediate Mat
    blurred.delete();

    UI.log('Preprocessing complete (gray + binary Mats ready)', 'ok');

    return { src: src, gray: gray, binary: binary };
  }

  // ─── Mat → Canvas (for display) ───────────────────────────────────────────
  /**
   * Copy an OpenCV Mat into an HTMLCanvasElement.
   * @param {cv.Mat} mat
   * @param {HTMLCanvasElement} canvas — will be resized
   */
  function matToCanvas(mat, canvas) {
    canvas.width  = mat.cols;
    canvas.height = mat.rows;
    cv.imshow(canvas, mat);
  }

  /**
   * Create a new canvas from a Mat.
   * @param {cv.Mat} mat
   * @returns {HTMLCanvasElement}
   */
  function matToNewCanvas(mat) {
    var canvas = document.createElement('canvas');
    matToCanvas(mat, canvas);
    return canvas;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  /**
   * Delete an object returned by preprocess().
   * @param {{ src, gray, binary }} mats
   */
  function cleanup(mats) {
    if (!mats) return;
    if (mats.src    && !mats.src.isDeleted())    mats.src.delete();
    if (mats.gray   && !mats.gray.isDeleted())   mats.gray.delete();
    if (mats.binary && !mats.binary.isDeleted()) mats.binary.delete();
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    canvasToMat: canvasToMat,
    toGrayscale: toGrayscale,
    gaussianBlur: gaussianBlur,
    adaptiveThreshold: adaptiveThreshold,
    preprocess: preprocess,
    matToCanvas: matToCanvas,
    matToNewCanvas: matToNewCanvas,
    cleanup: cleanup
  };
})();
