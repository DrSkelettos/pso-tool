/**
 * checkbox-detector.js — ROI extraction and checkbox state analysis
 * Exposes global: CheckboxDetector
 *
 * Algorithm:
 *   1. Extract field ROI from normalized Mat
 *   2. Shrink by padding to exclude printed checkbox border
 *   3. Adaptive threshold on inner ROI
 *   4. Count non-zero (black = marked) pixels
 *   5. Compute fill ratio and confidence score
 */
var CheckboxDetector = (function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  var INNER_PADDING    = 5;    // px to strip from each edge (removes printed border)
  var THRESHOLD_EMPTY  = 0.10; // ratio below this → definitely empty
  var THRESHOLD_FILLED = 0.15; // ratio above this → definitely checked
  var CONFIDENCE_MIN   = 0.75; // below this → mark as uncertain

  // Adaptive threshold parameters for small ROIs
  var AT_BLOCK_SIZE = 7;  // must be odd; small because ROIs are small
  var AT_C          = 2;

  // ─── Analyze a single field ────────────────────────────────────────────────
  /**
   * @param {cv.Mat} normalizedMat  — full normalized grayscale page Mat
   * @param {object} field          — { id, page, x, y, width, height }
   * @param {number} [baselineRatio=0] — average noise ratio from calibration
   * @returns {{ id, page, x, y, width, height, checked, confidence, ratio, uncertain }}
   */
  function analyzeField(normalizedMat, field, baselineRatio) {
    var baseline = baselineRatio || 0;

    // Guard: ROI must be inside the Mat
    var clampedX = Math.max(0, field.x);
    var clampedY = Math.max(0, field.y);
    var clampedW = Math.min(field.width,  normalizedMat.cols - clampedX);
    var clampedH = Math.min(field.height, normalizedMat.rows - clampedY);

    if (clampedW <= 0 || clampedH <= 0) {
      UI.log('Field "' + field.id + '" is outside the normalized image bounds — skipped.', 'warn');
      return {
        id: field.id, page: field.page || 1,
        x: field.x, y: field.y, width: field.width, height: field.height,
        checked: false, confidence: 0, ratio: 0, uncertain: true, outOfBounds: true
      };
    }

    // ── Extract outer ROI ──
    var outerRect = new cv.Rect(clampedX, clampedY, clampedW, clampedH);
    var outerROI  = normalizedMat.roi(outerRect);

    // ── Compute inner region (strip printed border) ──
    var px = INNER_PADDING;
    var innerW = clampedW - px * 2;
    var innerH = clampedH - px * 2;

    var ratio, checked, confidence, uncertain;

    if (innerW <= 2 || innerH <= 2) {
      // ROI too small for padding — analyze full region
      ratio = _analyzeRegion(outerROI);
      UI.log('Field "' + field.id + '" too small for padding; analyzing full ROI.', 'warn');
    } else {
      var innerRect = new cv.Rect(px, px, innerW, innerH);
      var innerROI  = outerROI.roi(innerRect);
      ratio = _analyzeRegion(innerROI);
      innerROI.delete();
    }

    outerROI.delete();

    // ── Adjust ratio by baseline noise ──
    var adjustedRatio = Math.max(0, ratio - baseline);

    // ── Confidence scoring ──
    if (adjustedRatio < THRESHOLD_EMPTY) {
      checked    = false;
      confidence = 1;// - (adjustedRatio / THRESHOLD_EMPTY);
    } else if (adjustedRatio > THRESHOLD_FILLED) {
      checked    = true;
      confidence = 1;//Math.min(1, adjustedRatio / 0.4); // more ratio above FILLED → higher confidence, capped at 1
    } else {
      // Ambiguous zone — linear interpolation gives 0 confidence at midpoint
      var mid   = (THRESHOLD_EMPTY + THRESHOLD_FILLED) / 2;
      var range = (THRESHOLD_FILLED - THRESHOLD_EMPTY) / 2;
      checked    = adjustedRatio >= mid;
      confidence = 1 - Math.abs(adjustedRatio - mid) / range * 0.5; // 0.5–1 in uncertain zone
      confidence = Math.max(0, Math.min(0.74, confidence)); // cap below CONFIDENCE_MIN
    }

    uncertain = confidence < CONFIDENCE_MIN;

    return {
      id: field.id,
      page: field.page || 1,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      checked: checked,
      confidence: parseFloat(confidence.toFixed(4)),
      ratio: parseFloat(ratio.toFixed(4)),
      adjustedRatio: parseFloat(adjustedRatio.toFixed(4)),
      uncertain: uncertain
    };
  }

  // ─── Region analysis: threshold + count ───────────────────────────────────
  function _analyzeRegion(roi) {
    var totalPixels = roi.rows * roi.cols;
    if (totalPixels === 0) return 0;

    // Use adaptiveThreshold on the small inner region
    // blockSize must be <= min(rows,cols) and odd
    var minDim = Math.min(roi.rows, roi.cols);
    var bs = Math.min(AT_BLOCK_SIZE, minDim % 2 === 0 ? minDim - 1 : minDim);
    if (bs < 3) bs = 3;

    var binary = new cv.Mat();
    cv.adaptiveThreshold(
      roi,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      bs,
      AT_C
    );

    var blackPixels = cv.countNonZero(binary);
    binary.delete();

    return blackPixels / totalPixels;
  }

  // ─── Analyze all fields on a page ─────────────────────────────────────────
  /**
   * @param {cv.Mat}   normalizedMat
   * @param {object[]} fields — array of field definitions
   * @param {number}   [baselineRatio=0]
   * @returns {object[]} array of result objects
   */
  function analyzeAll(normalizedMat, fields, baselineRatio) {
    var baseline = baselineRatio || 0;
    UI.log('Analyzing ' + fields.length + ' field(s) (baseline=' + (baseline * 100).toFixed(1) + '%)', 'info');

    var results = fields.map(function (field) {
      return analyzeField(normalizedMat, field, baseline);
    });

    var checked   = results.filter(function (r) { return r.checked && !r.uncertain; }).length;
    var uncertain = results.filter(function (r) { return r.uncertain; }).length;
    var empty     = results.filter(function (r) { return !r.checked && !r.uncertain; }).length;
    UI.log('Analysis done: ' + checked + ' checked, ' + uncertain + ' uncertain, ' + empty + ' empty', 'ok');

    return results;
  }

  // ─── Baseline Calibration ─────────────────────────────────────────────────
  /**
   * Analyze a set of fields known to be empty and compute the average noise ratio.
   * Used to subtract scanner/paper noise from all subsequent analyses.
   *
   * @param {cv.Mat}   normalizedMat
   * @param {object[]} knownEmptyFields — field definitions for fields that should be empty
   * @returns {number} baseline ratio (0–1)
   */
  function calibrateBaseline(normalizedMat, knownEmptyFields) {
    if (!knownEmptyFields || knownEmptyFields.length === 0) return 0;

    var total = 0;
    knownEmptyFields.forEach(function (field) {
      var result = analyzeField(normalizedMat, field, 0);
      total += result.ratio;
    });

    var baseline = total / knownEmptyFields.length;
    UI.log('Baseline calibration: avg noise ratio = ' + (baseline * 100).toFixed(2) + '%', 'ok');
    return baseline;
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    analyzeField: analyzeField,
    analyzeAll: analyzeAll,
    calibrateBaseline: calibrateBaseline,
    INNER_PADDING: INNER_PADDING,
    THRESHOLD_EMPTY: THRESHOLD_EMPTY,
    THRESHOLD_FILLED: THRESHOLD_FILLED,
    CONFIDENCE_MIN: CONFIDENCE_MIN
  };
})();
