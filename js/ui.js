/**
 * ui.js — DOM interaction layer
 * Exposes global: UI
 */
var UI = (function () {
  'use strict';

  // ─── Internal state ────────────────────────────────────────────────────────
  var _activeTab = 'original';
  var _debugEnabled = false;
  var _logEl = null;

  // ─── Log helper ────────────────────────────────────────────────────────────
  function log(msg, level) {
    if (!_logEl) _logEl = document.getElementById('debug-log');
    if (!_logEl) return;
    var cls = 'log-' + (level || 'info');
    var ts  = new Date().toLocaleTimeString('de-DE', { hour12: false });
    var line = document.createElement('div');
    line.className = cls;
    line.textContent = '[' + ts + '] ' + msg;
    _logEl.appendChild(line);
    _logEl.scrollTop = _logEl.scrollHeight;
  }

  // ─── Progress ──────────────────────────────────────────────────────────────
  function showProgress(label, pct) {
    var wrap = document.getElementById('progress-bar-wrap');
    var bar  = document.getElementById('progress-bar');
    var lbl  = document.getElementById('progress-label');
    var pctEl = document.getElementById('progress-pct');
    if (!wrap) return;
    wrap.style.display = 'block';
    lbl.textContent  = label || 'Processing…';
    var p = Math.min(100, Math.max(0, pct || 0));
    bar.style.width  = p + '%';
    pctEl.textContent = p + '%';
  }

  function hideProgress() {
    var wrap = document.getElementById('progress-bar-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────
  function showError(msg) {
    var el = document.getElementById('error-alert');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    log('ERROR: ' + msg, 'error');
  }

  function hideError() {
    var el = document.getElementById('error-alert');
    if (el) el.style.display = 'none';
  }

  function showWarning(msg) {
    var el = document.getElementById('warning-alert');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    log('WARN: ' + msg, 'warn');
  }

  function hideWarning() {
    var el = document.getElementById('warning-alert');
    if (el) el.style.display = 'none';
  }

  function clearAlerts() {
    hideError();
    hideWarning();
  }

  // ─── Canvas Tab Management ─────────────────────────────────────────────────
  function _showCanvasTab(tab) {
    var ids = ['canvas-original', 'canvas-normalized', 'canvas-debug'];
    var tabMap = { original: 'canvas-original', normalized: 'canvas-normalized', debug: 'canvas-debug' };
    var placeholder = document.getElementById('canvas-placeholder');

    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    var target = document.getElementById(tabMap[tab]);
    if (target && target._hasContent) {
      if (placeholder) placeholder.style.display = 'none';
      target.style.display = 'block';
    } else {
      if (placeholder) placeholder.style.display = 'flex';
    }

    document.querySelectorAll('#canvas-tabs .nav-link').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });

    _activeTab = tab;
  }

  function setCanvasContent(tab, canvas) {
    var idMap = { original: 'canvas-original', normalized: 'canvas-normalized', debug: 'canvas-debug' };
    var target = document.getElementById(idMap[tab]);
    if (!target || !canvas) return;

    // Copy pixel data from source canvas into the permanent canvas element
    target.width  = canvas.width;
    target.height = canvas.height;
    var ctx = target.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    target._hasContent = true;

    if (_activeTab === tab) _showCanvasTab(tab);
  }

  function setCanvasPageInfo(text) {
    var el = document.getElementById('canvas-page-info');
    if (el) el.textContent = text || '';
  }

  // ─── Results Table ─────────────────────────────────────────────────────────
  function renderResults(results) {
    var section = document.getElementById('results-section');
    var tbody   = document.getElementById('results-tbody');
    var summary = document.getElementById('results-summary');
    if (!section || !tbody) return;

    tbody.innerHTML = '';

    var checkedCount   = 0;
    var uncertainCount = 0;
    var emptyCount     = 0;

    results.forEach(function (r) {
      var tr = document.createElement('tr');

      var state, badgeClass, rowClass;
      if (r.uncertain) {
        state = 'Uncertain';
        badgeClass = 'badge-uncertain';
        rowClass   = 'result-row-uncertain';
        uncertainCount++;
      } else if (r.checked) {
        state = 'Checked';
        badgeClass = 'badge-checked';
        rowClass   = 'result-row-checked';
        checkedCount++;
      } else {
        state = 'Empty';
        badgeClass = 'badge-empty';
        rowClass   = 'result-row-empty';
        emptyCount++;
      }

      tr.className = rowClass;

      var confPct  = Math.round((r.confidence || 0) * 100);
      var fillColor = r.uncertain ? '#ffc107' : (r.checked ? '#198754' : '#dc3545');

      tr.innerHTML =
        '<td style="font-size:0.78rem; font-family:monospace;">' + escapeHtml(r.id) + '</td>' +
        '<td style="font-size:0.78rem;">' + (r.page || 1) + '</td>' +
        '<td><span class="badge ' + badgeClass + '" style="font-size:0.72rem;">' + state + '</span></td>' +
        '<td>' +
          '<div class="d-flex align-items-center gap-1">' +
            '<div class="confidence-bar flex-grow-1">' +
              '<div class="confidence-fill" style="width:' + confPct + '%;background:' + fillColor + ';"></div>' +
            '</div>' +
            '<span style="font-size:0.72rem;min-width:28px;text-align:right;">' + confPct + '%</span>' +
          '</div>' +
        '</td>' +
        '<td style="font-size:0.78rem;">' + (r.ratio !== undefined ? (r.ratio * 100).toFixed(1) + '%' : '—') + '</td>';

      tbody.appendChild(tr);
    });

    section.style.display = 'block';

    if (summary) {
      summary.textContent =
        results.length + ' fields — ' +
        checkedCount + ' checked, ' +
        uncertainCount + ' uncertain, ' +
        emptyCount + ' empty';
    }
  }

  // ─── Debug Section ─────────────────────────────────────────────────────────
  function setDebugVisible(visible) {
    var el = document.getElementById('debug-section');
    if (el) el.style.display = visible ? 'block' : 'none';
    _debugEnabled = visible;
  }

  function isDebugEnabled() {
    var toggle = document.getElementById('debug-toggle');
    return toggle ? toggle.checked : false;
  }

  function isCalibrationEnabled() {
    var toggle = document.getElementById('calibrate-toggle');
    return toggle ? toggle.checked : false;
  }

  // ─── Process Button ────────────────────────────────────────────────────────
  function setProcessing(active) {
    var btn  = document.getElementById('process-btn');
    var text = document.getElementById('process-btn-text');
    if (!btn) return;
    btn.disabled = active;
    if (text) text.textContent = active ? 'Processing…' : 'Process PDF';
  }

  function setExportEnabled(enabled) {
    var btn = document.getElementById('export-btn');
    if (btn) btn.disabled = !enabled;
  }

  function setProcessEnabled(enabled) {
    var btn = document.getElementById('process-btn');
    if (btn) btn.disabled = !enabled;
  }

  // ─── Reset ─────────────────────────────────────────────────────────────────
  function resetUI() {
    clearAlerts();
    hideProgress();
    setExportEnabled(false);

    ['canvas-original', 'canvas-normalized', 'canvas-debug'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        el._hasContent   = false;
      }
    });

    var placeholder = document.getElementById('canvas-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    var section = document.getElementById('results-section');
    if (section) section.style.display = 'none';

    var tbody = document.getElementById('results-tbody');
    if (tbody) tbody.innerHTML = '';

    if (_logEl) _logEl.innerHTML = '';
    setCanvasPageInfo('');
  }

  // ─── Utility ───────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _logEl = document.getElementById('debug-log');

    // Canvas tab switching
    document.querySelectorAll('#canvas-tabs .nav-link').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _showCanvasTab(btn.getAttribute('data-tab'));
      });
    });

    // Debug toggle
    var debugToggle = document.getElementById('debug-toggle');
    if (debugToggle) {
      debugToggle.addEventListener('change', function () {
        setDebugVisible(debugToggle.checked);
      });
    }

    // Clear log button
    var clearBtn = document.getElementById('clear-log-btn');
    if (clearBtn && _logEl) {
      clearBtn.addEventListener('click', function () { _logEl.innerHTML = ''; });
    }

    // Drag-and-drop on upload zone
    var dropZone = document.getElementById('upload-drop');
    if (dropZone) {
      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', function () {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
          var input = document.getElementById('pdf-input');
          // Assign via DataTransfer trick
          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change'));
        }
      });
    }

    log('UI initialized.', 'ok');
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    init: init,
    log: log,
    showProgress: showProgress,
    hideProgress: hideProgress,
    showError: showError,
    hideError: hideError,
    showWarning: showWarning,
    hideWarning: hideWarning,
    clearAlerts: clearAlerts,
    setCanvasContent: setCanvasContent,
    setCanvasPageInfo: setCanvasPageInfo,
    renderResults: renderResults,
    setDebugVisible: setDebugVisible,
    isDebugEnabled: isDebugEnabled,
    isCalibrationEnabled: isCalibrationEnabled,
    setProcessing: setProcessing,
    setExportEnabled: setExportEnabled,
    setProcessEnabled: setProcessEnabled,
    resetUI: resetUI,
    escapeHtml: escapeHtml,
    showCanvasTab: _showCanvasTab
  };
})();
