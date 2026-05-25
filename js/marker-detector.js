/**
 * marker-detector.js — Detect the four black corner square markers
 * Exposes global: MarkerDetector
 *
 * Corner markers are 4×4 mm solid black squares placed near each page corner.
 * At 300 DPI: 4 mm ≈ 47 px → area ≈ 2209 px².
 * Filter thresholds use generous tolerances for real-world scan variation.
 */
var MarkerDetector = (function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  var MIN_AREA        = 800;   // px²  — smaller scans or slight shrinkage
  var MAX_AREA        = 12000; // px²  — generous upper bound for thick markers
  var MIN_ASPECT      = 0.65;  // w/h ratio min  (square = 1.0)
  var MAX_ASPECT      = 1.80;  // w/h ratio max
  var MIN_FILL        = 0.85;  // contour area / bounding rect area
  // Corner zone: fraction of page used to define TL/TR/BL/BR quadrants.
  // First pass uses PRIMARY_ZONE; if any corner is missing a fallback pass
  // uses FALLBACK_ZONE to handle scans with extra dead-space margin.
  var PRIMARY_ZONE    = 0.15;
  var FALLBACK_ZONE   = 0.50;
  var CORNER_ZONE     = PRIMARY_ZONE; // kept for external consumers

  // ─── Compute centroid from moments ────────────────────────────────────────
  function centroid(contour) {
    var m = cv.moments(contour, false);
    if (m.m00 === 0) return null;
    return { x: m.m10 / m.m00, y: m.m01 / m.m00 };
  }

  // ─── Assign candidate to corner zones ────────────────────────────────────
  function assignCorner(cx, cy, pageW, pageH, zoneThresh) {
    var zx = pageW * zoneThresh;
    var zy = pageH * zoneThresh;

    var inLeft   = cx < zx;
    var inRight  = cx > pageW - zx;
    var inTop    = cy < zy;
    var inBottom = cy > pageH - zy;

    if (inLeft  && inTop)    return 'tl';
    if (inRight && inTop)    return 'tr';
    if (inLeft  && inBottom) return 'bl';
    if (inRight && inBottom) return 'br';
    return null;
  }

  // ─── Morphological closing ────────────────────────────────────────────────
  /**
   * Apply morphological closing to fill small gaps in marker boundaries caused
   * by scanner noise or JPEG compression artifacts.
   * Returns a new Mat — caller must delete it.
   */
  function _closeBinary(binaryMat) {
    var kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    var closed = new cv.Mat();
    cv.morphologyEx(binaryMat, closed, cv.MORPH_CLOSE, kernel);
    kernel.delete();
    return closed;
  }

  // ─── Single-pass contour scan ─────────────────────────────────────────────
  /**
   * Run one pass of contour filtering and corner assignment.
   * Returns { corners, allCandidates, rejectedLog }.
   */
  function _scanContours(binaryMat, pageW, pageH, zoneThresh) {
    var contours  = new cv.MatVector();
    var hierarchy = new cv.Mat();
    cv.findContours(binaryMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    var total = contours.size();
    UI.log('findContours (zone=' + (zoneThresh * 100).toFixed(0) + '%): ' + total + ' raw contours', 'info');

    var corners       = { tl: null, tr: null, bl: null, br: null };
    var allCandidates = [];
    var rejectedLog   = { area: 0, aspect: 0, fill: 0, zone: 0 };

    for (var i = 0; i < total; i++) {
      var contour = contours.get(i);
      var area    = cv.contourArea(contour);

      if (area < MIN_AREA || area > MAX_AREA) {
        rejectedLog.area++;
        contour.delete();
        continue;
      }

      var rect      = cv.boundingRect(contour);
      var rectArea  = rect.width * rect.height;
      var aspect    = rect.width / rect.height;
      var fillRatio = area / rectArea;

      if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
        rejectedLog.aspect++;
        contour.delete();
        continue;
      }
      if (fillRatio < MIN_FILL) {
        rejectedLog.fill++;
        contour.delete();
        continue;
      }

      var cen = centroid(contour);
      if (!cen) { contour.delete(); continue; }

      var cornerLabel = assignCorner(cen.x, cen.y, pageW, pageH, zoneThresh);
      if (!cornerLabel) {
        rejectedLog.zone++;
        contour.delete();
        continue;
      }

      var candidate = {
        x: cen.x, y: cen.y,
        rect: rect, area: area,
        aspect: aspect, fillRatio: fillRatio,
        corner: cornerLabel
      };

      allCandidates.push(candidate);

      // Keep the candidate whose area is closest to the ideal marker size
      var existing = corners[cornerLabel];
      if (!existing) {
        corners[cornerLabel] = candidate;
      } else {
        var ideal = 2200;
        if (Math.abs(area - ideal) < Math.abs(existing.area - ideal)) {
          corners[cornerLabel] = candidate;
        }
      }

      contour.delete();
    }

    contours.delete();
    hierarchy.delete();

    return { corners: corners, allCandidates: allCandidates, rejectedLog: rejectedLog };
  }

  // ─── Main detection ───────────────────────────────────────────────────────
  /**
   * Detect four corner markers in a binary (THRESH_BINARY_INV) Mat.
   *
   * Strategy:
   *   1. Apply morphological closing to repair scanner-fragmented marker edges.
   *   2. First pass with PRIMARY_ZONE (35% of page per axis).
   *   3. If any corner is missing, second pass with FALLBACK_ZONE (50%).
   *      This handles scans with dead space / margins around the document.
   *
   * @param {cv.Mat} binaryMat — white-on-black binary image (THRESH_BINARY_INV)
   * @param {number} pageW     — width of the binaryMat
   * @param {number} pageH     — height of the binaryMat
   * @returns {{ tl, tr, bl, br, allCandidates }}
   *   Each corner: { x, y, rect: {x,y,width,height} }
   * @throws {Error} if fewer than 4 corners found after both passes
   */
  function findMarkers(binaryMat, pageW, pageH) {
    // Step 1: morphological closing — fills gaps caused by scanner noise / JPEG artifacts
    var closed = _closeBinary(binaryMat);

    // Step 2: primary pass
    var pass1 = _scanContours(closed, pageW, pageH, PRIMARY_ZONE);
    var corners       = pass1.corners;
    var allCandidates = pass1.allCandidates;

    UI.log(
      'Pass 1 rejected — area:' + pass1.rejectedLog.area +
      ' aspect:' + pass1.rejectedLog.aspect +
      ' fill:' + pass1.rejectedLog.fill +
      ' zone:' + pass1.rejectedLog.zone,
      'info'
    );

    // Step 3: fallback pass for any missing corner
    var missing1 = ['tl', 'tr', 'bl', 'br'].filter(function (c) { return !corners[c]; });
    if (missing1.length > 0) {
      UI.log('Pass 1 missing: ' + missing1.map(function(c){return c.toUpperCase();}).join(', ') +
             ' — retrying with zone=' + (FALLBACK_ZONE * 100) + '%', 'warn');

      var pass2 = _scanContours(closed, pageW, pageH, FALLBACK_ZONE);

      // Merge: fill in missing corners from fallback pass only
      missing1.forEach(function (c) {
        if (pass2.corners[c]) {
          corners[c] = pass2.corners[c];
          UI.log('Pass 2 recovered: ' + c.toUpperCase() +
                 ' (' + pass2.corners[c].x.toFixed(0) + ',' + pass2.corners[c].y.toFixed(0) + ')', 'warn');
        }
      });

      // Merge candidate list for debug overlay
      pass2.allCandidates.forEach(function (c) {
        if (!allCandidates.some(function (x) { return x.x === c.x && x.y === c.y; })) {
          allCandidates.push(c);
        }
      });
    }

    closed.delete();

    // Step 4: validate
    var missing = ['tl', 'tr', 'bl', 'br'].filter(function (c) { return !corners[c]; });

    if (missing.length > 0) {
      // Build a diagnostic summary to help with calibration
      var diagParts = ['tl', 'tr', 'bl', 'br'].map(function (c) {
        return corners[c]
          ? c.toUpperCase() + '✓'
          : c.toUpperCase() + '✗';
      });
      throw new Error(
        'Corner marker detection failed after two passes. ' +
        diagParts.join(' ') + '. ' +
        allCandidates.length + ' candidate(s) found in total. ' +
        'Enable Debug Overlay to inspect candidates. ' +
        'Ensure the form has four solid black 4×4 mm squares inside the page corners.'
      );
    }

    UI.log(
      'Markers OK — ' +
      'TL(' + corners.tl.x.toFixed(0) + ',' + corners.tl.y.toFixed(0) + ') ' +
      'TR(' + corners.tr.x.toFixed(0) + ',' + corners.tr.y.toFixed(0) + ') ' +
      'BL(' + corners.bl.x.toFixed(0) + ',' + corners.bl.y.toFixed(0) + ') ' +
      'BR(' + corners.br.x.toFixed(0) + ',' + corners.br.y.toFixed(0) + ')',
      'ok'
    );

    return {
      tl: corners.tl,
      tr: corners.tr,
      bl: corners.bl,
      br: corners.br,
      allCandidates: allCandidates
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    findMarkers: findMarkers,
    CORNER_ZONE: CORNER_ZONE,
    PRIMARY_ZONE: PRIMARY_ZONE,
    FALLBACK_ZONE: FALLBACK_ZONE
  };
})();
