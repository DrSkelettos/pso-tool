/**
 * app.js — Main orchestrator for the PSO OMR Tool
 * Wires together: UI, TemplateManager, PDFHandler, ImagePreprocessor,
 *                 MarkerDetector, PerspectiveNormalizer, CheckboxDetector, DebugOverlay
 *
 * Global variable: App
 */
var App = (function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────────
  var _pdfFile      = null;
  var _pdfDoc       = null;
  var _allResults   = [];   // flat array of all field results across all pages
  var _cvReady      = false;

  // ─── OpenCV readiness ─────────────────────────────────────────────────────
  // opencv.js calls this global when it has finished loading
  window.onOpenCvReady = function () {
    _cvReady = true;
    UI.log('OpenCV.js ready (version ' + (cv.getBuildInformation ? cv.getBuildInformation().split('\n')[0] : 'unknown') + ')', 'ok');
    _updateProcessButton();
  };

  // Fallback: poll in case onOpenCvReady was already fired before this script ran
  function _waitForOpenCV() {
    if (typeof cv !== 'undefined' && cv.Mat) {
      _cvReady = true;
      UI.log('OpenCV.js ready (detected via poll)', 'ok');
      _updateProcessButton();
    } else {
      setTimeout(_waitForOpenCV, 200);
    }
  }

  // ─── Button state ─────────────────────────────────────────────────────────
  function _updateProcessButton() {
    var ready = _pdfFile !== null && TemplateManager.hasTemplate() && _cvReady;
    UI.setProcessEnabled(ready);
  }

  // ─── PDF File Selection ───────────────────────────────────────────────────
  function _onPdfSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    _pdfFile = file;
    _pdfDoc  = null;

    var fnEl = document.getElementById('pdf-filename');
    if (fnEl) {
      fnEl.textContent = file.name;
      fnEl.style.display = 'block';
    }
    UI.log('PDF selected: ' + file.name, 'info');
    _updateProcessButton();
  }

  // ─── Template Selection ───────────────────────────────────────────────────
  function _onBuiltinTemplateChange(e) {
    var val = e.target.value;
    if (!val) return;

    // Clear any custom template input
    var customInput = document.getElementById('template-input');
    if (customInput) customInput.value = '';
    var fnEl = document.getElementById('template-filename');
    if (fnEl) fnEl.style.display = 'none';

    TemplateManager.loadFromPath(val)
      .then(function () { _updateProcessButton(); })
      .catch(function (err) { UI.showError(err.message); });
  }

  function _onCustomTemplateSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    // Clear built-in select
    var sel = document.getElementById('template-select');
    if (sel) sel.value = '';

    TemplateManager.loadFromFile(file)
      .then(function () {
        var fnEl = document.getElementById('template-filename');
        if (fnEl) {
          fnEl.textContent = file.name;
          fnEl.style.display = 'block';
        }
        _updateProcessButton();
      })
      .catch(function (err) { UI.showError(err.message); });
  }

  // ─── Reset ────────────────────────────────────────────────────────────────
  function _onReset() {
    _pdfFile    = null;
    _pdfDoc     = null;
    _allResults = [];

    var pdfInput      = document.getElementById('pdf-input');
    var templateInput = document.getElementById('template-input');
    var sel           = document.getElementById('template-select');
    var fnEl          = document.getElementById('pdf-filename');
    var tfnEl         = document.getElementById('template-filename');

    if (pdfInput)      pdfInput.value      = '';
    if (templateInput) templateInput.value = '';
    if (sel)           sel.value           = '';
    if (fnEl)          fnEl.style.display  = 'none';
    if (tfnEl)         tfnEl.style.display = 'none';

    TemplateManager.clear();
    UI.resetUI();
    _updateProcessButton();
    UI.log('Reset.', 'info');
  }

  // ─── Export ───────────────────────────────────────────────────────────────
  function _onExport() {
    if (!_allResults || _allResults.length === 0) return;

    var output = {
      exportedAt: new Date().toISOString(),
      template: TemplateManager.getTemplate()
        ? { pageWidth: TemplateManager.getTemplate().pageWidth, pageHeight: TemplateManager.getTemplate().pageHeight }
        : null,
      results: _allResults
    };

    var blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'omr-results-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.log('Results exported as JSON.', 'ok');
  }

  // ─── Main Processing Pipeline ─────────────────────────────────────────────
  function _onProcess() {
    if (!_pdfFile || !TemplateManager.hasTemplate() || !_cvReady) return;

    UI.clearAlerts();
    UI.setProcessing(true);
    UI.setExportEnabled(false);
    _allResults = [];

    UI.log('═══ Starting OMR processing ═══', 'info');

    // Load PDF, then process each page
    PDFHandler.loadPDF(_pdfFile)
      .then(function (pdfDoc) {
        _pdfDoc = pdfDoc;
        var totalPages = pdfDoc.numPages;
        var templateMaxPage = TemplateManager.getPageCount();
        var pagesToProcess  = Math.min(totalPages, templateMaxPage);

        UI.log('Pages to process: ' + pagesToProcess + ' (PDF has ' + totalPages + ', template covers ' + templateMaxPage + ')', 'info');
        UI.showProgress('Loading…', 5);

        // Chain page processing sequentially
        var chain = Promise.resolve();
        for (var p = 1; p <= pagesToProcess; p++) {
          (function (pageNum) {
            chain = chain.then(function () {
              return _processPage(pdfDoc, pageNum, pagesToProcess);
            });
          })(p);
        }

        return chain;
      })
      .then(function () {
        UI.hideProgress();
        UI.setProcessing(false);
        UI.setExportEnabled(true);
        UI.renderResults(_allResults);
        UI.log('═══ Processing complete — ' + _allResults.length + ' field(s) analyzed ═══', 'ok');
      })
      .catch(function (err) {
        UI.hideProgress();
        UI.setProcessing(false);
        UI.showError(err.message);
        UI.log('Pipeline error: ' + err.message, 'error');
        if (err.stack) UI.log(err.stack, 'error');
      });
  }

  // ─── Single Page Pipeline ─────────────────────────────────────────────────
  function _processPage(pdfDoc, pageNum, totalPages) {
    var progressBase = ((pageNum - 1) / totalPages) * 100;
    var progressStep = 100 / totalPages;

    UI.showProgress('Page ' + pageNum + '/' + totalPages + ': rendering…', progressBase + progressStep * 0.1);
    UI.log('── Page ' + pageNum + ' ──', 'info');

    var fields = TemplateManager.getFieldsForPage(pageNum);
    if (fields.length === 0) {
      UI.log('No fields defined for page ' + pageNum + ' — skipping.', 'warn');
      return Promise.resolve();
    }

    var preprocessMats  = null;
    var normResult      = null;
    var markers         = null;
    var originalCanvas  = null;

    return PDFHandler.renderPage(pdfDoc, pageNum)
      .then(function (canvas) {
        originalCanvas = canvas;

        // Show original scan
        UI.setCanvasContent('original', canvas);
        UI.setCanvasPageInfo('Page ' + pageNum + '/' + totalPages);
        UI.showCanvasTab('original');

        UI.showProgress('Page ' + pageNum + ': preprocessing…', progressBase + progressStep * 0.25);

        // Preprocess
        preprocessMats = ImagePreprocessor.preprocess(canvas);

        UI.showProgress('Page ' + pageNum + ': detecting markers…', progressBase + progressStep * 0.45);

        // Detect corner markers on the binary image
        markers = MarkerDetector.findMarkers(
          preprocessMats.binary,
          preprocessMats.binary.cols,
          preprocessMats.binary.rows
        );

        UI.showProgress('Page ' + pageNum + ': normalizing…', progressBase + progressStep * 0.60);

        // Perspective correction using grayscale image
        normResult = PerspectiveNormalizer.normalizeToCanvas(
          preprocessMats.gray,
          markers,
          TemplateManager.getTemplate().pageWidth,
          TemplateManager.getTemplate().pageHeight
        );

        // Show normalized canvas
        UI.setCanvasContent('normalized', normResult.canvas);

        UI.showProgress('Page ' + pageNum + ': analyzing checkboxes…', progressBase + progressStep * 0.75);

        // Baseline calibration (if enabled)
        var baseline = 0;
        if (UI.isCalibrationEnabled()) {
          baseline = CheckboxDetector.calibrateBaseline(normResult.normalized, fields);
        }

        // Analyze all fields
        var pageResults = CheckboxDetector.analyzeAll(normResult.normalized, fields, baseline);
        _allResults = _allResults.concat(pageResults);

        // Debug overlay
        if (UI.isDebugEnabled()) {
          var debugNormCanvas = DebugOverlay.buildDebugCanvas(normResult.canvas, fields, pageResults);
          var debugOrigCanvas = DebugOverlay.buildOriginalDebugCanvas(
            originalCanvas,
            markers,
            markers.allCandidates || []
          );

          UI.setCanvasContent('debug', debugNormCanvas);
          UI.setDebugVisible(true);
          UI.showCanvasTab('debug');

          // Also annotate original scan tab
          UI.setCanvasContent('original', debugOrigCanvas);
        }

        UI.showProgress('Page ' + pageNum + ': done', progressBase + progressStep);
      })
      .finally(function () {
        // Memory cleanup — always release OpenCV Mats
        if (preprocessMats)    ImagePreprocessor.cleanup(preprocessMats);
        if (normResult) {
          if (normResult.normalized && !normResult.normalized.isDeleted()) normResult.normalized.delete();
          if (normResult.transform  && !normResult.transform.isDeleted())  normResult.transform.delete();
        }
      });
  }

  // ─── Bind DOM Events ──────────────────────────────────────────────────────
  function init() {
    UI.init();

    // Wait for OpenCV if not ready yet
    if (typeof cv === 'undefined' || !cv.Mat) {
      _waitForOpenCV();
    } else {
      _cvReady = true;
      UI.log('OpenCV.js already loaded.', 'ok');
    }

    // PDF input
    var pdfInput = document.getElementById('pdf-input');
    if (pdfInput) pdfInput.addEventListener('change', _onPdfSelected);

    // Template inputs
    var templateSelect = document.getElementById('template-select');
    if (templateSelect) templateSelect.addEventListener('change', _onBuiltinTemplateChange);

    var templateInput = document.getElementById('template-input');
    if (templateInput) templateInput.addEventListener('change', _onCustomTemplateSelected);

    // Action buttons
    var processBtn = document.getElementById('process-btn');
    if (processBtn) processBtn.addEventListener('click', _onProcess);

    var exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', _onExport);

    var resetBtn = document.getElementById('reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', _onReset);

    UI.log('App initialized. Select a PDF and a template to begin.', 'ok');
    _updateProcessButton();
  }

  // ─── Auto-init on DOMContentLoaded ───────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    init: init,
    getResults: function () { return _allResults; }
  };
})();
