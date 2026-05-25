/**
 * debug-overlay.js — Visual debug drawing on canvas elements
 * Exposes global: DebugOverlay
 *
 * All drawing uses the HTML5 Canvas 2D API.
 * Colors:
 *   Green  (#22c55e) — checked confidently
 *   Yellow (#facc15) — uncertain
 *   Red    (#ef4444) — empty
 *   Cyan   (#06b6d4) — markers
 *   Orange (#f97316) — contour candidates
 */
var DebugOverlay = (function () {
  'use strict';

  var COLOR_CHECKED   = '#22c55e';
  var COLOR_UNCERTAIN = '#facc15';
  var COLOR_EMPTY     = '#ef4444';
  var COLOR_MARKER    = '#06b6d4';
  var COLOR_CANDIDATE = '#f97316';

  // ─── Scale factor — keeps drawing proportional at any canvas resolution ──
  // Reference width 800 px → at 2480 px canvas, scale ≈ 3.1
  function _getScale(canvas) {
    return Math.max(1, canvas.width / 800);
  }

  // ─── Draw a single rectangle outline ─────────────────────────────────────
  function _rect(ctx, x, y, w, h, color, lineWidth) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth || 2;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // ─── Draw a filled semi-transparent rectangle ─────────────────────────────
  function _fillRect(ctx, x, y, w, h, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha !== undefined ? alpha : 0.15;
    ctx.fillStyle   = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // ─── Draw a filled circle ─────────────────────────────────────────────────
  function _circle(ctx, x, y, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── Draw text label with background pill ─────────────────────────────────
  function _label(ctx, text, x, y, color, scale) {
    var s   = scale || 1;
    var fs  = Math.round(11 * s);
    var pad = Math.round(3 * s);
    ctx.save();
    ctx.font = 'bold ' + fs + 'px monospace';
    var tw = ctx.measureText(text).width;
    // Dark background pill
    ctx.globalAlpha = 0.72;
    ctx.fillStyle   = '#000';
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(x - pad, y - fs, tw + pad * 2, fs + pad, 3)
      : ctx.rect(x - pad, y - fs, tw + pad * 2, fs + pad);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle   = color || '#fff';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ─── Draw multi-line text block inside a field box ────────────────────────
  function _infoBlock(ctx, lines, boxX, boxY, boxW, boxH, scale) {
    var s       = scale || 1;
    var fs      = Math.round(10 * s);
    var lineH   = Math.round(fs * 1.4);
    var pad     = Math.round(4 * s);
    var blockH  = lines.length * lineH + pad * 2;
    var blockW  = 0;

    ctx.save();
    ctx.font = 'bold ' + fs + 'px monospace';
    lines.forEach(function (l) {
      var w = ctx.measureText(l.text).width;
      if (w > blockW) blockW = w;
    });
    blockW += pad * 2;

    var bx = boxX + (boxW  - blockW) / 2;
    var by = boxY + (boxH  - blockH) / 2;

    // Background
    ctx.globalAlpha = 0.80;
    ctx.fillStyle   = '#000';
    ctx.fillRect(bx, by, blockW, blockH);
    ctx.globalAlpha = 1;

    lines.forEach(function (l, i) {
      ctx.fillStyle = l.color || '#fff';
      ctx.fillText(l.text, bx + pad, by + pad + (i + 1) * lineH - Math.round(lineH * 0.2));
    });
    ctx.restore();
  }

  // ─── Draw detected corner markers on the original scan canvas ─────────────
  /**
   * @param {HTMLCanvasElement} canvas — original scan (pre-normalization)
   * @param {{ tl, tr, bl, br }} markers — each { x, y, rect: {x,y,width,height} }
   */
  function drawMarkers(canvas, markers) {
    if (!canvas || !markers) return;
    var ctx = canvas.getContext('2d');
    var s   = _getScale(canvas);

    ['tl', 'tr', 'bl', 'br'].forEach(function (key) {
      var m = markers[key];
      if (!m) return;
      _rect(ctx, m.rect.x, m.rect.y, m.rect.width, m.rect.height, COLOR_MARKER, Math.round(3 * s));
      _circle(ctx, m.x, m.y, Math.round(6 * s), COLOR_MARKER);
      _label(ctx, key.toUpperCase(), m.rect.x + Math.round(2 * s), m.rect.y - Math.round(4 * s), COLOR_MARKER, s);
    });
  }

  // ─── Draw contour candidates on a canvas ──────────────────────────────────
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object[]} candidates — array of { rect, corner }
   */
  function drawCandidates(canvas, candidates) {
    if (!canvas || !candidates) return;
    var ctx = canvas.getContext('2d');
    var s   = _getScale(canvas);

    candidates.forEach(function (c) {
      _rect(ctx, c.rect.x, c.rect.y, c.rect.width, c.rect.height, COLOR_CANDIDATE, Math.max(1, Math.round(s)));
    });
  }

  // ─── Draw checkbox ROIs on the normalized canvas ──────────────────────────
  /**
   * Draws each field box with:
   *   - Semi-transparent colored fill (green/yellow/red)
   *   - Thick colored outer border
   *   - Dashed inner border showing the analysis region (after padding)
   *   - Info block inside the box: field ID, state, ratio %, confidence %
   *
   * @param {HTMLCanvasElement} canvas   — normalized canvas
   * @param {object[]}          fields   — template field definitions
   * @param {object[]}          results  — analysis results
   */
  function drawCheckboxROIs(canvas, fields, results) {
    if (!canvas || !fields) return;
    var ctx = canvas.getContext('2d');
    var s   = _getScale(canvas);

    // Build lookup: result by field id
    var resultMap = {};
    if (results) {
      results.forEach(function (r) { resultMap[r.id] = r; });
    }

    fields.forEach(function (f) {
      var r = resultMap[f.id];
      var color, stateText;
      if (!r) {
        color = '#aaaaaa'; stateText = '?';
      } else if (r.uncertain) {
        color = COLOR_UNCERTAIN; stateText = 'UNCERTAIN';
      } else if (r.checked) {
        color = COLOR_CHECKED;   stateText = 'CHECKED';
      } else {
        color = COLOR_EMPTY;     stateText = 'EMPTY';
      }

      // Semi-transparent fill
      _fillRect(ctx, f.x, f.y, f.width, f.height, color, 0.18);

      // Outer border
      _rect(ctx, f.x, f.y, f.width, f.height, color, Math.max(2, Math.round(3 * s)));

      // Inner analysis region (after INNER_PADDING stripping)
      var p  = CheckboxDetector.INNER_PADDING;
      var ix = f.x + p, iy = f.y + p;
      var iw = f.width - p * 2, ih = f.height - p * 2;
      if (iw > 2 && ih > 2) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth   = Math.max(1, Math.round(1.5 * s));
        ctx.setLineDash([Math.round(4 * s), Math.round(3 * s)]);
        ctx.strokeRect(ix, iy, iw, ih);
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Info block inside the box
      if (r) {
        var ratioText = 'fill: ' + (r.ratio * 100).toFixed(1) + '%';
        var confText  = 'conf: ' + (r.confidence * 100).toFixed(0) + '%';
        var lines = [
          { text: f.id,       color: '#fff' },
          { text: stateText,  color: color  },
          { text: ratioText,  color: '#ddd' },
          { text: confText,   color: '#ddd' }
        ];
        // Only draw the block if the box is tall enough to contain it
        var minBoxH = lines.length * Math.round(10 * s * 1.4) + Math.round(8 * s);
        if (f.height >= minBoxH) {
          _infoBlock(ctx, lines, f.x, f.y, f.width, f.height, s);
        } else {
          // Box too small — draw a compact label above it
          var shortText = stateText + ' ' + (r.ratio * 100).toFixed(1) + '%';
          _label(ctx, shortText, f.x, f.y - Math.round(4 * s), color, s);
        }
      } else {
        _label(ctx, f.id, f.x, f.y - Math.round(4 * s), color, s);
      }
    });
  }

  // ─── Draw confidence values as fallback labels beside each field ──────────
  /**
   * Used when info blocks don't fit inside the box.
   * Draws ratio label to the right of each field.
   */
  function drawConfidenceLabels(canvas, results) {
    if (!canvas || !results) return;
    var ctx = canvas.getContext('2d');
    var s   = _getScale(canvas);

    results.forEach(function (r) {
      // Skip if no position data
      if (r.x === undefined) return;
      var color = r.uncertain ? COLOR_UNCERTAIN : (r.checked ? COLOR_CHECKED : COLOR_EMPTY);
      var text  = 'r=' + (r.ratio * 100).toFixed(1) + '%';
      var lx    = r.x + r.width + Math.round(5 * s);
      var ly    = r.y + r.height / 2;
      _label(ctx, text, lx, ly, color, s);
    });
  }

  // ─── Compose full debug canvas ────────────────────────────────────────────
  /**
   * Produce a fully-annotated debug canvas from the normalized image.
   *
   * @param {HTMLCanvasElement} normalizedCanvas
   * @param {object[]}          fields
   * @param {object[]}          results
   * @returns {HTMLCanvasElement} — new canvas with overlays
   */
  function buildDebugCanvas(normalizedCanvas, fields, results) {
    var out    = document.createElement('canvas');
    out.width  = normalizedCanvas.width;
    out.height = normalizedCanvas.height;
    var ctx = out.getContext('2d');
    ctx.drawImage(normalizedCanvas, 0, 0);

    drawCheckboxROIs(out, fields, results);
    drawConfidenceLabels(out, results);

    return out;
  }

  /**
   * Annotate the original scan canvas in-place with markers and candidates.
   * Returns the same canvas (mutated).
   *
   * @param {HTMLCanvasElement} originalCanvas
   * @param {{ tl, tr, bl, br }} markers
   * @param {object[]} candidates
   * @returns {HTMLCanvasElement}
   */
  function buildOriginalDebugCanvas(originalCanvas, markers, candidates) {
    var out   = document.createElement('canvas');
    out.width  = originalCanvas.width;
    out.height = originalCanvas.height;
    var ctx = out.getContext('2d');
    ctx.drawImage(originalCanvas, 0, 0);

    drawCandidates(out, candidates);
    drawMarkers(out, markers);

    return out;
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    drawMarkers: drawMarkers,
    drawCandidates: drawCandidates,
    drawCheckboxROIs: drawCheckboxROIs,
    drawConfidenceLabels: drawConfidenceLabels,
    buildDebugCanvas: buildDebugCanvas,
    buildOriginalDebugCanvas: buildOriginalDebugCanvas,
    COLOR_CHECKED: COLOR_CHECKED,
    COLOR_UNCERTAIN: COLOR_UNCERTAIN,
    COLOR_EMPTY: COLOR_EMPTY,
    COLOR_MARKER: COLOR_MARKER
  };
})();
