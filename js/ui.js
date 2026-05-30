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

  // ─── Page Navigation ─────────────────────────────────────────────────────
  function setPageNavigation(currentPage, totalPages) {
    var info    = document.getElementById('canvas-page-info');
    var prevBtn = document.getElementById('page-prev-btn');
    var nextBtn = document.getElementById('page-next-btn');

    if (info) info.textContent = 'Page ' + currentPage + ' / ' + totalPages;

    var showNav = totalPages > 1;
    if (prevBtn) {
      prevBtn.style.display = showNav ? '' : 'none';
      prevBtn.disabled = currentPage <= 1;
    }
    if (nextBtn) {
      nextBtn.style.display = showNav ? '' : 'none';
      nextBtn.disabled = currentPage >= totalPages;
    }
  }

  // ─── Results Table (field-level, kept for fallback) ───────────────────────
  function renderResults(results) {
    var section = document.getElementById('results-section');
    var thead   = document.querySelector('#results-table thead tr');
    var tbody   = document.getElementById('results-tbody');
    var summary = document.getElementById('results-summary');
    if (!section || !tbody) return;

    // Restore field-level column headers
    if (thead) {
      thead.innerHTML =
        '<th style="font-size:0.78rem; width:35%;">Field ID</th>' +
        '<th style="font-size:0.78rem; width:10%;">Page</th>' +
        '<th style="font-size:0.78rem; width:15%;">State</th>' +
        '<th style="font-size:0.78rem; width:20%;">Confidence</th>' +
        '<th style="font-size:0.78rem; width:20%;">Ratio</th>';
    }

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

  // ─── Question Results Table ────────────────────────────────────────────────
  function renderQuestionResults(questionResults) {
    var section = document.getElementById('results-section');
    var thead   = document.querySelector('#results-table thead tr');
    var tbody   = document.getElementById('results-tbody');
    var summary = document.getElementById('results-summary');
    if (!section || !tbody) return;

    // Update column headers for question view
    if (thead) {
      thead.innerHTML =
        '<th style="font-size:0.78rem; width:20%;">Question</th>' +
        '<th style="font-size:0.78rem; width:12%;">Value</th>' +
        '<th style="font-size:0.78rem; width:18%;">Status</th>' +
        '<th style="font-size:0.78rem; width:30%;">Field / Note</th>' +
        '<th style="font-size:0.78rem; width:20%;">Ratio</th>';
    }

    tbody.innerHTML = '';

    var answeredCount    = 0;
    var uncertainCount   = 0;
    var unansweredCount  = 0;

    questionResults.forEach(function (q) {
      var tr = document.createElement('tr');

      var state, badgeClass, rowClass, note;

      if (q.status === 'not_answered') {
        state      = 'Not Answered';
        badgeClass = 'badge-empty';
        rowClass   = 'result-row-empty';
        note       = '—';
        unansweredCount++;
      } else if (q.status === 'uncertain') {
        state      = 'Uncertain';
        badgeClass = 'badge-uncertain';
        rowClass   = 'result-row-uncertain';
        note       = escapeHtml(q.field || '');
        if (q.multipleChecked) note += ' <span class="text-warning" title="Multiple fields were checked">(multi)</span>';
        uncertainCount++;
      } else {
        state      = 'Answered';
        badgeClass = 'badge-checked';
        rowClass   = 'result-row-checked';
        note       = escapeHtml(q.field || '');
        if (q.multipleChecked) note += ' <span class="text-warning" title="Multiple fields were checked">(multi)</span>';
        answeredCount++;
      }

      tr.className = rowClass;

      var ratioStr = (q.ratio !== null && q.ratio !== undefined)
        ? (q.ratio * 100).toFixed(1) + '%'
        : '—';

      tr.innerHTML =
        '<td style="font-size:0.78rem; font-family:monospace;">' + escapeHtml(q.id) + '</td>' +
        '<td style="font-size:0.78rem; font-weight:600;">' +
          (q.value !== null && q.value !== undefined ? q.value : '—') +
        '</td>' +
        '<td><span class="badge ' + badgeClass + '" style="font-size:0.72rem;">' + state + '</span></td>' +
        '<td style="font-size:0.75rem; font-family:monospace;">' + note + '</td>' +
        '<td style="font-size:0.78rem;">' + ratioStr + '</td>';

      tbody.appendChild(tr);
    });

    section.style.display = 'block';

    if (summary) {
      summary.textContent =
        questionResults.length + ' questions — ' +
        answeredCount + ' answered, ' +
        uncertainCount + ' uncertain, ' +
        unansweredCount + ' not answered';
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

    var prevBtn = document.getElementById('page-prev-btn');
    var nextBtn = document.getElementById('page-next-btn');
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
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
    setPageNavigation: setPageNavigation,
    renderResults: renderResults,
    renderQuestionResults: renderQuestionResults,
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
