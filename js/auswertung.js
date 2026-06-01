/**
 * auswertung.js — Application logic for auswertung.html
 *
 * Supports three modes:
 *   phqd     — single PHQ-D PDF
 *   opdsf    — single OPD-SF PDF
 *   combined — one PDF (PHQ-D pages first, then OPD-SF pages)
 *
 * Depends on (must be loaded first):
 *   libs/pdf.min.js, libs/opencv.js
 *   js/auswertung-ui.js
 *   js/template-manager.js, js/pdf-handler.js, js/image-preprocessing.js
 *   js/marker-detector.js, js/perspective-normalizer.js, js/checkbox-detector.js
 *   js/question-processor.js, js/score-processor.js
 *   templates/phqd.js   (PHQD_TEMPLATE global)
 *   templates/opdsf.js  (OPDSF_TEMPLATE global)
 */
(function () {
  'use strict';

  // ── Templates ─────────────────────────────────────────────────────────────
  var _phqdTemplate  = typeof PHQD_TEMPLATE  !== 'undefined' ? PHQD_TEMPLATE  : null;
  var _opdsfTemplate = typeof OPDSF_TEMPLATE !== 'undefined' ? OPDSF_TEMPLATE : null;

  // ── Zustand ──────────────────────────────────────────────────────────────
  var _cvReady = false;
  var _mode    = 'phqd'; // 'phqd' | 'opdsf' | 'combined'
  var _files   = { phqd: null, opdsf: null, combined: null };

  // Verarbeitungs-Ergebnisse
  var _phqdPageCanvases  = {}; // templatePage → canvas
  var _opdsfPageCanvases = {};
  var _phqdQResults      = [];
  var _phqdSResults      = [];
  var _opdsfQResults     = [];
  var _opdsfSResults     = [];

  // Review-Zustand
  var _reviewOverrides = {};
  var _reviewPhase     = null; // null | 'phqd' | 'opdsf'

  // ── DOM-Referenzen ───────────────────────────────────────────────────────
  var _btnAuswerten = document.getElementById('btn-auswerten');
  var _errEl        = document.getElementById('err-msg');

  // ── Fortschrittssteuerung ─────────────────────────────────────────────────
  var _progressTotal = 1;
  var _progressDone  = 0;

  function _initProgress(totalSteps) {
    _progressTotal = totalSteps || 1;
    _progressDone  = 0;
    _setProgressBtn(0);
  }

  function _step() {
    _progressDone = Math.min(_progressDone + 1, _progressTotal);
    _setProgressBtn(Math.round(_progressDone / _progressTotal * 100));
  }

  function _setProgressBtn(pct) {
    _btnAuswerten.textContent = pct < 100
      ? 'Auswertung läuft (' + pct + ' %)'
      : 'Auswertung läuft (100 %)';
  }

  // ── Hilfsfunktionen ──────────────────────────────────────────────────────
  function _showError(msg) {
    _errEl.textContent   = msg;
    _errEl.style.display = 'block';
  }

  function _currentFile() {
    return _files[_mode] || null;
  }

  function _updateButton() {
    _btnAuswerten.disabled = !(_cvReady && !!_currentFile());
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _fmtDate(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : iso;
  }

  function _isUncertain(qr) {
    return qr.status === 'uncertain' || qr.multipleChecked;
  }

  // ── Datum vorausfüllen ───────────────────────────────────────────────────
  (function () {
    var today = new Date();
    var yyyy  = today.getFullYear();
    var mm    = String(today.getMonth() + 1).padStart(2, '0');
    var dd    = String(today.getDate()).padStart(2, '0');
    document.getElementById('inp-date').value = yyyy + '-' + mm + '-' + dd;
  })();

  // ── OpenCV-Bereitschaft ──────────────────────────────────────────────────
  window.onOpenCvReady = function () {
    _cvReady = true;
    console.log('[OMR] OpenCV bereit');
    _updateButton();
  };

  function _waitForOpenCV() {
    if (typeof cv !== 'undefined' && cv.Mat) {
      _cvReady = true;
      _updateButton();
    } else {
      setTimeout(_waitForOpenCV, 200);
    }
  }

  // ── Modus-Umschalter ─────────────────────────────────────────────────────
  document.querySelectorAll('input[name="auswahl-mode"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      _mode = this.value;
      document.getElementById('file-input-phqd').style.display     = _mode === 'phqd'     ? '' : 'none';
      document.getElementById('file-input-opdsf').style.display    = _mode === 'opdsf'    ? '' : 'none';
      document.getElementById('file-input-combined').style.display = _mode === 'combined' ? '' : 'none';
      _errEl.style.display = 'none';
      _updateButton();
    });
  });

  // ── Datei-Events ─────────────────────────────────────────────────────────
  ['phqd', 'opdsf', 'combined'].forEach(function (key) {
    document.getElementById('inp-pdf-' + key).addEventListener('change', function (e) {
      _files[key]          = e.target.files && e.target.files[0];
      _errEl.style.display = 'none';
      _updateButton();
    });
  });

  // ── Ereignis: Auswerten ──────────────────────────────────────────────────
  _btnAuswerten.addEventListener('click', function () {
    _btnAuswerten.disabled = true;
    _errEl.style.display   = 'none';
    _phqdPageCanvases      = {};
    _opdsfPageCanvases     = {};
    _phqdQResults          = [];
    _phqdSResults          = [];
    _opdsfQResults         = [];
    _opdsfSResults         = [];
    _reviewOverrides       = {};
    _reviewPhase           = null;

    _runPipeline()
      .then(function () {
        _startReview();
      })
      .catch(function (err) {
        _btnAuswerten.disabled    = false;
        _btnAuswerten.textContent = 'Auswerten';
        _showError('Fehler bei der Auswertung: ' + err.message);
        console.error(err);
      });
  });

  // ── Ereignis: Neue Auswertung ────────────────────────────────────────────
  document.getElementById('btn-new').addEventListener('click', function () {
    document.getElementById('a4-wrap').style.display        = 'none';
    document.getElementById('report-toolbar').style.display = 'none';
    document.getElementById('review-card').style.display    = 'none';
    document.getElementById('form-card').style.display      = '';
    _btnAuswerten.textContent = 'Auswerten';
    _btnAuswerten.disabled    = !(_cvReady && !!_currentFile());
    _phqdPageCanvases  = {};
    _opdsfPageCanvases = {};
    _phqdQResults      = [];
    _phqdSResults      = [];
    _opdsfQResults     = [];
    _opdsfSResults     = [];
    _reviewOverrides   = {};
    _reviewPhase       = null;
    TemplateManager.clear();
  });

  // ── Verarbeitungspipeline ────────────────────────────────────────────────

  /**
   * Process pages of a loaded PDF using the currently active TemplateManager template.
   * @param {Object}  pdfDoc        - pdf.js document
   * @param {number}  templatePages - how many template pages to process
   * @param {number}  pdfPageOffset - add this to templatePage to get the PDF page number
   * @param {Object}  pageCanvasMap - canvas storage map (mutated)
   * @param {Array}   rawResults    - checkbox results accumulator (mutated)
   */
  function _processPagesInternal(pdfDoc, templatePages, pdfPageOffset, pageCanvasMap, rawResults) {
    var chain = Promise.resolve();
    for (var p = 1; p <= templatePages; p++) {
      (function (tPage) {
        chain = chain.then(function () {
          return _processPage(pdfDoc, tPage, tPage + pdfPageOffset, pageCanvasMap, rawResults);
        });
      })(p);
    }
    return chain;
  }

  function _processPage(pdfDoc, templatePage, pdfPage, pageCanvasMap, allResults) {
    var fields = TemplateManager.getFieldsForPage(templatePage);
    if (!fields.length) { _step(); _step(); _step(); _step(); _step(); return Promise.resolve(); }

    var preprocessMats = null;
    var normResult     = null;
    var tmpl           = TemplateManager.getTemplate();

    return PDFHandler.renderPage(pdfDoc, pdfPage)
      .then(function (canvas) {
        _step(); // Seite gerendert

        preprocessMats = ImagePreprocessor.preprocess(canvas);
        _step(); // Vorverarbeitung

        var markers = MarkerDetector.findMarkers(
          preprocessMats.binary,
          preprocessMats.binary.cols,
          preprocessMats.binary.rows
        );
        _step(); // Marker erkannt

        normResult = PerspectiveNormalizer.normalizeToCanvas(
          preprocessMats.gray,
          markers,
          tmpl.pageWidth,
          tmpl.pageHeight
        );
        _step(); // Perspektive korrigiert

        pageCanvasMap[templatePage] = normResult.canvas;

        var pageResults = CheckboxDetector.analyzeAll(normResult.normalized, fields, 0);
        pageResults.forEach(function (r) { allResults.push(r); });
        _step(); // Checkboxen analysiert
      })
      .finally(function () {
        if (preprocessMats) ImagePreprocessor.cleanup(preprocessMats);
        if (normResult) {
          if (normResult.normalized && !normResult.normalized.isDeleted()) normResult.normalized.delete();
          if (normResult.transform  && !normResult.transform.isDeleted())  normResult.transform.delete();
        }
      });
  }

  function _runPipeline() {
    var mode = _mode;

    if (mode === 'phqd') {
      TemplateManager.loadFromObject(_phqdTemplate);
      var phqdPages = TemplateManager.getPageCount();
      _initProgress(1 + phqdPages * 5 + 2);
      var raw = [];
      return PDFHandler.loadPDF(_files.phqd)
        .then(function (pdfDoc) { _step(); return _processPagesInternal(pdfDoc, phqdPages, 0, _phqdPageCanvases, raw); })
        .then(function () {
          _phqdQResults = QuestionProcessor.processQuestions(raw, _phqdTemplate.questions); _step();
          _phqdSResults = ScoreProcessor.processScores(_phqdQResults, _phqdTemplate.scores); _step();
        });

    } else if (mode === 'opdsf') {
      TemplateManager.loadFromObject(_opdsfTemplate);
      var opdsfPages = TemplateManager.getPageCount();
      _initProgress(1 + opdsfPages * 5 + 2);
      var raw = [];
      return PDFHandler.loadPDF(_files.opdsf)
        .then(function (pdfDoc) { _step(); return _processPagesInternal(pdfDoc, opdsfPages, 0, _opdsfPageCanvases, raw); })
        .then(function () {
          _opdsfQResults = QuestionProcessor.processQuestions(raw, _opdsfTemplate.questions); _step();
          _opdsfSResults = ScoreProcessor.processScores(_opdsfQResults, _opdsfTemplate.scores); _step();
        });

    } else { // combined
      TemplateManager.loadFromObject(_phqdTemplate);
      var phqdP = TemplateManager.getPageCount();
      TemplateManager.loadFromObject(_opdsfTemplate);
      var opdsfP = TemplateManager.getPageCount();
      _initProgress(1 + phqdP * 5 + 2 + opdsfP * 5 + 2);

      var rawPhqd  = [];
      var rawOpdsf = [];
      var _pdfDoc;

      return PDFHandler.loadPDF(_files.combined)
        .then(function (pdfDoc) {
          _pdfDoc = pdfDoc;
          _step(); // PDF geladen
          TemplateManager.loadFromObject(_phqdTemplate);
          return _processPagesInternal(pdfDoc, phqdP, 0, _phqdPageCanvases, rawPhqd);
        })
        .then(function () {
          _phqdQResults = QuestionProcessor.processQuestions(rawPhqd, _phqdTemplate.questions); _step();
          _phqdSResults = ScoreProcessor.processScores(_phqdQResults, _phqdTemplate.scores);    _step();
          TemplateManager.loadFromObject(_opdsfTemplate);
          return _processPagesInternal(_pdfDoc, opdsfP, phqdP, _opdsfPageCanvases, rawOpdsf);
        })
        .then(function () {
          _opdsfQResults = QuestionProcessor.processQuestions(rawOpdsf, _opdsfTemplate.questions); _step();
          _opdsfSResults = ScoreProcessor.processScores(_opdsfQResults, _opdsfTemplate.scores);    _step();
        });
    }
  }

  // ── Review-Steuerung ─────────────────────────────────────────────────────

  function _startReview() {
    // PHQ-D uncertain?
    var phqdUncertain = (_mode !== 'opdsf')  ? _phqdQResults.filter(_isUncertain)  : [];
    // OPDSF uncertain?
    var opdsfUncertain = (_mode !== 'phqd')  ? _opdsfQResults.filter(_isUncertain) : [];

    if (phqdUncertain.length > 0) {
      _reviewPhase     = 'phqd';
      _reviewOverrides = {};
      _showReview(phqdUncertain, _phqdTemplate, _phqdPageCanvases, 'PHQ-D');
    } else if (opdsfUncertain.length > 0) {
      _reviewPhase     = 'opdsf';
      _reviewOverrides = {};
      _showReview(opdsfUncertain, _opdsfTemplate, _opdsfPageCanvases, 'OPD-SF');
    } else {
      _finishAndDisplay();
    }
  }

  function _applyOverrides(qResults) {
    return qResults.map(function (qr) {
      if (_reviewOverrides.hasOwnProperty(qr.id)) {
        var ov = _reviewOverrides[qr.id];
        return {
          id:              qr.id,
          value:           ov,
          status:          ov !== null ? 'answered' : 'not_answered',
          field:           qr.field,
          ratio:           qr.ratio,
          confidence:      qr.confidence,
          multipleChecked: false
        };
      }
      return qr;
    });
  }

  // ── Ereignis: Überprüfung abschließen ────────────────────────────────────
  document.getElementById('btn-review-done').addEventListener('click', function () {
    if (_reviewPhase === 'phqd') {
      _phqdQResults = _applyOverrides(_phqdQResults);
      _phqdSResults = ScoreProcessor.processScores(_phqdQResults, _phqdTemplate.scores);

      var opdsfUncertain = (_mode === 'combined') ? _opdsfQResults.filter(_isUncertain) : [];
      if (opdsfUncertain.length > 0) {
        _reviewPhase     = 'opdsf';
        _reviewOverrides = {};
        document.getElementById('review-card').style.display = 'none';
        _showReview(opdsfUncertain, _opdsfTemplate, _opdsfPageCanvases, 'OPD-SF');
      } else {
        document.getElementById('review-card').style.display = 'none';
        _finishAndDisplay();
      }
    } else if (_reviewPhase === 'opdsf') {
      _opdsfQResults = _applyOverrides(_opdsfQResults);
      _opdsfSResults = ScoreProcessor.processScores(_opdsfQResults, _opdsfTemplate.scores);
      document.getElementById('review-card').style.display = 'none';
      _finishAndDisplay();
    }
  });

  // ── Report-Renderer ──────────────────────────────────────────────────────

  /** Build a lookup: score id → score result object */
  function _buildScoreLookup(scoreResults) {
    var map = {};
    scoreResults.forEach(function (s) { map[s.id] = s; });
    return map;
  }

  /**
   * Highlight the matching range segment in a semicolon-separated legend string.
   * Returns an HTML string with the active segment wrapped in <strong>.
   */
  function _highlightLegendRange(legend, sum) {
    return legend.split(';').map(function (part) {
      var p    = part.trim();
      var nums = p.match(/\d+/g);
      var active = false;
      if (nums && nums.length >= 2) {
        var lo = parseInt(nums[nums.length - 2], 10);
        var hi = parseInt(nums[nums.length - 1], 10);
        active = sum >= lo && sum <= hi;
      } else if (nums && nums.length === 1) {
        active = /unter\s*\d+/i.test(p)
          ? sum < parseInt(nums[0], 10)
          : sum >= parseInt(nums[0], 10);
      }
      return active ? '<strong>' + _esc(p) + '</strong>' : _esc(p);
    }).join('; ');
  }

  /** Render a Bootstrap progress bar element for a numeric score */
  function _buildProgressBar(barVal, barMax) {
    var pct  = Math.round(Math.min(100, Math.max(0, barVal / barMax * 100)));
    var prog = document.createElement('div');
    prog.className = 'progress';
    var bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.style.width = pct + '%';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(barVal));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(barMax));
    prog.appendChild(bar);
    return prog;
  }

  /** Render a diagnostic (positive/negative/value_label) table row */
  function _renderDiagnosticRow(item, score) {
    var tr = document.createElement('tr');

    var tdLabel = document.createElement('td');
    tdLabel.className   = 'label-cell';
    tdLabel.textContent = item.label;
    tr.appendChild(tdLabel);

    var tdResult = document.createElement('td');
    tdResult.className = 'value-cell';
    if (score && score.type === 'value_label') {
      tdResult.textContent = score.valueLabel || '—';
    } else if (!score || score.positive === null) {
      tdResult.textContent = 'unbekannt';
    } else if (score.positive) {
      tdResult.textContent = item.positive_text || 'vorhanden';
      tdResult.classList.add('rpt-cell-positive');
    } else {
      tdResult.textContent = 'nicht vorhanden';
    }
    tr.appendChild(tdResult);

    return tr;
  }

  /** Render a numeric (sum + progress bar + legend) row pair */
  function _renderNumericRows(item, score, colCount) {
    var rows = [];

    var tr = document.createElement('tr');

    var tdL = document.createElement('td');
    tdL.className   = 'label-cell';
    tdL.textContent = item.label;
    tr.appendChild(tdL);

    var tdS = document.createElement('td');
    tdS.className   = 'value-cell';
    tdS.textContent = (score && score.sum !== undefined && score.range)
      ? score.sum + ' / ' + score.range[1]
      : (score ? String(score.sum !== undefined ? score.sum : '—') : '—');
    tr.appendChild(tdS);

    var tdB = document.createElement('td');
    tdB.className = 'value-cell';
    if (score && score.sum !== undefined && score.range) {
      tdB.appendChild(_buildProgressBar(score.sum || 0, score.range[1]));
    } else {
      tdB.textContent = '—';
    }
    tr.appendChild(tdB);

    rows.push(tr);

    if (item.legend) {
      var legRow = document.createElement('tr');
      legRow.className = 'legend-row';
      var legTd = document.createElement('td');
      legTd.setAttribute('colspan', String(colCount));
      if (item.display === 'severity' && score && score.sum !== undefined) {
        legTd.innerHTML = _highlightLegendRange(item.legend, score.sum);
      } else {
        legTd.textContent = item.legend;
      }
      legRow.appendChild(legTd);
      rows.push(legRow);
    }

    return rows;
  }

  /** Render grouped subscores table (OPD-SF style) */
  function _renderGroupedSubscoresSection(section, lookup) {
    var frag = document.createDocumentFragment();

    var sh = document.createElement('div');
    sh.className   = 'rpt-section-title';
    sh.textContent = section.title || 'Strukturelle Auswertung';
    frag.appendChild(sh);

    var table  = document.createElement('table');
    table.className = 'rpt-table rpt-subscores-table';

    // Header
    var thead = document.createElement('thead');
    var hrow  = document.createElement('tr');
    [['Strukturbereich', '17%'], ['Strukturaspekt', '28%'], ['Summe', '8%'], ['Max', '7%'], ['Profil', '40%']]
      .forEach(function (col) {
        var th = document.createElement('th');
        th.textContent = col[0];
        th.style.width = col[1];
        hrow.appendChild(th);
      });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');

    (section.groups || []).forEach(function (group, gi) {
      var rows     = group.subscores || [];
      var rowCount = rows.length + 1; // +1 for GESAMT
      var evenGroup = gi % 2 === 1;

      rows.forEach(function (item, i) {
        var score = lookup[item.score];
        var tr    = document.createElement('tr');
        if (evenGroup) tr.classList.add('rpt-group-even');

        // Strukturbereich — rowspan on first sub-row only
        if (i === 0) {
          var tdArea = document.createElement('td');
          tdArea.className = 'rpt-area-cell';
          tdArea.setAttribute('rowspan', String(rowCount));
          tdArea.textContent = group.label;
          tr.appendChild(tdArea);
        }

        var tdName = document.createElement('td');
        tdName.className   = 'label-cell';
        tdName.textContent = item.label;
        tr.appendChild(tdName);

        var tdSum = document.createElement('td');
        tdSum.className   = 'value-cell';
        tdSum.textContent = score ? String(score.sum) : '—';
        tr.appendChild(tdSum);

        var tdMax = document.createElement('td');
        tdMax.className   = 'value-cell';
        tdMax.textContent = score ? String(score.max) : '—';
        tr.appendChild(tdMax);

        var tdBar = document.createElement('td');
        tdBar.className = 'bar-cell';
        if (score && score.max > 0) {
          tdBar.appendChild(_buildProgressBar(score.sum || 0, score.max));
        } else {
          tdBar.textContent = '—';
        }
        tr.appendChild(tdBar);

        tbody.appendChild(tr);
      });

      // GESAMT row
      var total = group.total ? lookup[group.total] : null;
      var gRow  = document.createElement('tr');
      gRow.className = 'rpt-gesamt-row' + (evenGroup ? ' rpt-group-even' : '');

      var tdGL = document.createElement('td');
      tdGL.className   = 'label-cell rpt-gesamt-label';
      tdGL.textContent = 'GESAMT';
      gRow.appendChild(tdGL);

      var tdGS = document.createElement('td');
      tdGS.className   = 'value-cell';
      tdGS.textContent = total ? String(total.sum) : '—';
      gRow.appendChild(tdGS);

      var tdGM = document.createElement('td');
      tdGM.className   = 'value-cell';
      tdGM.textContent = total ? String(total.max) : '—';
      gRow.appendChild(tdGM);

      var tdGB = document.createElement('td');
      tdGB.className = 'bar-cell';
      if (total && total.max > 0) {
        tdGB.appendChild(_buildProgressBar(total.sum || 0, total.max));
      }
      gRow.appendChild(tdGB);

      tbody.appendChild(gRow);
    });

    // GESAMTWERT row — appended to the SAME table so columns align
    if (section.global) {
      var gScore = lookup[section.global];
      var gTr    = document.createElement('tr');
      gTr.className = 'rpt-gesamtwert-row';

      var gTdL = document.createElement('td');
      gTdL.className = 'label-cell rpt-gesamtwert-label';
      gTdL.setAttribute('colspan', '2');
      gTdL.textContent = 'GESAMTWERT';
      gTr.appendChild(gTdL);

      var gTdS = document.createElement('td');
      gTdS.className   = 'value-cell';
      gTdS.textContent = gScore ? String(gScore.sum) : '—';
      gTr.appendChild(gTdS);

      var gTdM = document.createElement('td');
      gTdM.className   = 'value-cell';
      gTdM.textContent = gScore ? String(gScore.max) : '—';
      gTr.appendChild(gTdM);

      var gTdB = document.createElement('td');
      gTdB.className = 'bar-cell';
      if (gScore && gScore.max > 0) {
        gTdB.appendChild(_buildProgressBar(gScore.sum || 0, gScore.max));
      }
      gTr.appendChild(gTdB);

      tbody.appendChild(gTr);
    }

    table.appendChild(tbody);
    frag.appendChild(table);

    return frag;
  }

  /** Render a sorted deficit list (lowest scoring subscores first) */
  function _renderDeficitListSection(section, lookup) {
    var frag = document.createDocumentFragment();

    var sh = document.createElement('div');
    sh.className   = 'rpt-section-title';
    sh.textContent = section.title || 'Ausgeprägteste strukturelle Defizite';
    frag.appendChild(sh);

    // Resolve, filter, and sort by ratio ascending (most deficit first)
    var scored = (section.subscores || []).map(function (item) {
      var scoreId = item.score || item;
      var s       = lookup[scoreId];
      if (!s || s.sum === undefined || !s.max) return null;
      return { label: item.label || s.label || scoreId, score: s };
    }).filter(Boolean);

    // Sort descending: highest value first
    scored.sort(function (a, b) { return (b.score.sum / b.score.max) - (a.score.sum / a.score.max); });

    var deficits = section.top_n ? scored.slice(0, section.top_n) : scored;

    var table = document.createElement('table');
    table.className = 'rpt-table rpt-deficit-table';

    var thead = document.createElement('thead');
    var hrow  = document.createElement('tr');
    [['Strukturaspekt', '40%'], ['Summe / Max', '15%'], ['Profil', '45%']].forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col[0];
      th.style.width = col[1];
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    deficits.forEach(function (d) {
      var tr = document.createElement('tr');

      var tdN = document.createElement('td');
      tdN.className   = 'label-cell';
      tdN.textContent = d.label;
      tr.appendChild(tdN);

      var tdV = document.createElement('td');
      tdV.className   = 'value-cell';
      tdV.textContent = d.score.sum + ' / ' + d.score.max;
      tr.appendChild(tdV);

      var tdB = document.createElement('td');
      tdB.className = 'bar-cell';
      tdB.appendChild(_buildProgressBar(d.score.sum || 0, d.score.max));
      tr.appendChild(tdB);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    frag.appendChild(table);

    return frag;
  }

  /** Render a complete report section (heading + table + footnotes) */
  function _renderSection(section, lookup) {
    if (section.type === 'grouped_subscores') return _renderGroupedSubscoresSection(section, lookup);
    if (section.type === 'deficit_list')      return _renderDeficitListSection(section, lookup);

    var frag = document.createDocumentFragment();

    var sh = document.createElement('div');
    sh.className   = 'rpt-section-title';
    sh.textContent = section.title;
    frag.appendChild(sh);

    var table = document.createElement('table');
    table.className = 'rpt-table';

    // Header
    var thead = document.createElement('thead');
    var hrow  = document.createElement('tr');
    var colWidths = section.type === 'diagnostic'
      ? ['65%', '35%']
      : ['45%', '12%', '43%'];
    (section.columns || []).forEach(function (col, i) {
      var th = document.createElement('th');
      th.textContent = col;
      th.style.width = colWidths[i] || '';
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    // Body
    var tbody = document.createElement('tbody');
    (section.items || []).forEach(function (item) {
      var score = lookup[item.score];
      if (section.type === 'diagnostic') {
        tbody.appendChild(_renderDiagnosticRow(item, score));
      } else if (section.type === 'numeric') {
        _renderNumericRows(item, score, (section.columns || []).length).forEach(function (row) {
          tbody.appendChild(row);
        });
      }
    });
    table.appendChild(tbody);
    frag.appendChild(table);

    // Footnotes
    (section.footnotes || []).forEach(function (fn) {
      var p = document.createElement('p');
      p.className   = 'rpt-footnote';
      p.textContent = fn;
      frag.appendChild(p);
    });

    return frag;
  }

  /** Main entry point: render the A4 report pages and switch views */
  function _finishAndDisplay() {
    var name = document.getElementById('inp-name').value.trim() || '—';
    var dob  = document.getElementById('inp-dob').value;
    var date = document.getElementById('inp-date').value;

    var phqdPage  = document.getElementById('a4-page-phqd');
    var opdsfPage = document.getElementById('a4-page-opdsf');
    phqdPage.innerHTML  = '';
    opdsfPage.innerHTML = '';

    if (_phqdSResults.length) {
      phqdPage.style.display = '';
      _renderReportPage(phqdPage, _phqdTemplate, _phqdSResults, _phqdQResults, name, dob, date);
    } else {
      phqdPage.style.display = 'none';
    }
    if (_opdsfSResults.length) {
      opdsfPage.style.display = '';
      _renderReportPage(opdsfPage, _opdsfTemplate, _opdsfSResults, _opdsfQResults, name, dob, date);
    } else {
      opdsfPage.style.display = 'none';
    }

    document.getElementById('form-card').style.display      = 'none';
    document.getElementById('a4-wrap').style.display        = 'block';
    document.getElementById('report-toolbar').style.display = 'flex';
  }

  function _renderReportPage(pageEl, tmpl, sResults, qResults, name, dob, date) {
    var report = tmpl.report;
    var lookup = _buildScoreLookup(sResults);

    // Header
    var hdr = document.createElement('div');
    hdr.className = 'rpt-header';
    hdr.innerHTML =
      '<h1>' + _esc(report.title) + '</h1>' +
      '<p class="subtitle">' + _esc(report.subtitle) + '</p>';
    pageEl.appendChild(hdr);

    // Patientenzeile
    var pat = document.createElement('div');
    pat.className = 'rpt-patient';
    pat.innerHTML =
      '<span><span class="label">Name&nbsp;</span>'         + _esc(name)     + '</span>' +
      '<span><span class="label">Geburtsdatum&nbsp;</span>' + _fmtDate(dob)  + '</span>' +
      '<span><span class="label">Datum&nbsp;</span>'        + _fmtDate(date) + '</span>';
    pageEl.appendChild(pat);

    // Sections
    (report.sections || []).forEach(function (section) {
      pageEl.appendChild(_renderSection(section, lookup));
    });

    // Unanswered questions summary (opt-in per template)
    if (report.show_unanswered && qResults && qResults.length) {
      pageEl.appendChild(_renderUnansweredSummary(qResults, tmpl.questions ? tmpl.questions.length : qResults.length));
    }
  }

  /** Render unanswered-questions row at the bottom of a report page */
  function _renderUnansweredSummary(qResults, totalQuestions) {
    var unanswered = qResults.filter(function (q) {
      return q.value === null || q.value === undefined || q.status === 'not_answered';
    }).length;
    var pct    = totalQuestions > 0 ? Math.round(unanswered / totalQuestions * 100) : 0;
    var flagged = pct > 10;

    var wrap = document.createElement('div');
    wrap.className = 'rpt-unanswered-wrap';

    var table = document.createElement('table');
    table.className = 'rpt-table rpt-unanswered-table';

    var tbody = document.createElement('tbody');
    var tr    = document.createElement('tr');
    if (flagged) tr.classList.add('rpt-unanswered-flagged');

    var tdL = document.createElement('td');
    tdL.className   = 'label-cell';
    tdL.textContent = 'Nicht beantwortete Fragen';
    tr.appendChild(tdL);

    var tdV = document.createElement('td');
    tdV.className   = 'value-cell rpt-unanswered-value';
    if (flagged) tdV.classList.add('rpt-cell-positive');
    tdV.textContent = unanswered + ' von ' + totalQuestions + ' (' + pct + ' %)';
    tr.appendChild(tdV);

    tbody.appendChild(tr);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }


  // ── Überprüfungsansicht ──────────────────────────────────────────────────

  /**
   * Build and display the review UI for questions that need manual verification.
   * @param {Array}  reviewQuestions - subset of qResults that need review
   * @param {Object} tmpl            - template for field/question definitions
   * @param {Object} pageCanvasMap   - templatePage → canvas map
   * @param {string} sourceLabel     - displayed in header ('PHQ-D' or 'OPD-SF')
   */
  function _showReview(reviewQuestions, tmpl, pageCanvasMap, sourceLabel) {
    var pageW     = tmpl.pageWidth;
    var pageH     = tmpl.pageHeight;
    var DISPLAY_W   = 760;
    var STRIP_H     = 400;
    var FIELD_OFS_X = -5;
    var FIELD_OFS_Y = -5;
    var scale       = DISPLAY_W / pageW;

    // Build lookups
    var fieldDef = {};
    tmpl.fields.forEach(function (f) { fieldDef[f.id] = f; });

    var qDefMap = {};
    (tmpl.questions || []).forEach(function (q) { qDefMap[q.id] = q; });

    // Source label in card header
    var labelEl = document.getElementById('review-source-label');
    if (labelEl) labelEl.textContent = sourceLabel ? '(' + sourceLabel + ')' : '';

    var container = document.getElementById('review-questions');
    container.innerHTML = '';

    reviewQuestions.forEach(function (qr) {
      var def = qDefMap[qr.id];
      if (!def || !def.fields || !def.fields.length) return;

      var fDefs = def.fields.map(function (fid) { return fieldDef[fid]; }).filter(Boolean);
      if (!fDefs.length) return;

      var page = fDefs[0].page || 1;
      var yCen = fDefs.reduce(function (s, f) { return s + f.y + f.height / 2; }, 0) / fDefs.length;

      var cropY = Math.max(0, Math.min(Math.round(yCen - STRIP_H / 2), pageH - STRIP_H));
      var cropH = Math.min(STRIP_H, pageH - cropY);
      var dispH = Math.round(cropH * scale);

      _reviewOverrides[qr.id] = (qr.value !== null && qr.value !== undefined) ? qr.value : null;

      // ── Block ────────────────────────────────────────────────────────────
      var block = document.createElement('div');
      block.className = 'review-question';

      var reason = qr.multipleChecked ? 'mehrere Markierungen' : 'unsicher erkannt';
      var lbl = document.createElement('div');
      lbl.className = 'review-question-label';
      lbl.textContent = 'Frage\u00a0' + qr.id + '\u2003\u2013\u2003' + reason;
      block.appendChild(lbl);

      // ── Scan-Ausschnitt ───────────────────────────────────────────────────
      var wrap = document.createElement('div');
      wrap.className = 'review-canvas-wrap';
      wrap.style.width  = DISPLAY_W + 'px';
      wrap.style.height = dispH + 'px';

      var cvs = document.createElement('canvas');
      cvs.className = 'review-canvas';
      cvs.width  = DISPLAY_W;
      cvs.height = dispH;

      var srcCanvas = pageCanvasMap[page];
      if (srcCanvas) {
        var ctx = cvs.getContext('2d');
        ctx.drawImage(srcCanvas, 0, cropY, pageW, cropH, 0, 0, DISPLAY_W, dispH);
      }
      wrap.appendChild(cvs);

      // ── Klickbare Feld-Overlays ───────────────────────────────────────────
      var boxes = {}; // value → div element

      fDefs.forEach(function (fd) {
        var val = parseInt(fd.id.split('_').pop(), 10);

        var box = document.createElement('div');
        box.className = 'review-field-box';
        box.setAttribute('title', 'Antwort\u00a0' + val);

        if (val === _reviewOverrides[qr.id]) {
          box.classList.add('selected');
          if (qr.status === 'uncertain') box.classList.add('auto-uncertain');
        }

        var bLeft = Math.round(fd.x * scale) + FIELD_OFS_X;
        var bTop  = Math.round((fd.y - cropY) * scale) + FIELD_OFS_Y;
        var bW    = Math.max(20, Math.round(fd.width  * scale));
        var bH    = Math.max(20, Math.round(fd.height * scale));

        box.style.left   = bLeft + 'px';
        box.style.top    = bTop  + 'px';
        box.style.width  = bW    + 'px';
        box.style.height = bH    + 'px';

        boxes[val] = box;
        wrap.appendChild(box);
      });

      // Attach click handlers after all boxes are built
      fDefs.forEach(function (fd) {
        var val = parseInt(fd.id.split('_').pop(), 10);
        boxes[val].addEventListener('click', (function (qid, clickedVal) {
          return function () {
            // First user interaction: clear auto-uncertain styling on all boxes
            Object.keys(boxes).forEach(function (k) {
              boxes[k].classList.remove('auto-uncertain');
            });

            if (_reviewOverrides[qid] === clickedVal) {
              // Toggle off → keine Antwort
              _reviewOverrides[qid] = null;
              Object.keys(boxes).forEach(function (k) { boxes[k].classList.remove('selected'); });
            } else {
              _reviewOverrides[qid] = clickedVal;
              Object.keys(boxes).forEach(function (k) { boxes[k].classList.remove('selected'); });
              boxes[clickedVal].classList.add('selected');
            }
          };
        })(qr.id, val));
      });

      block.appendChild(wrap);
      container.appendChild(block);
    });

    document.getElementById('form-card').style.display   = 'none';
    document.getElementById('review-card').style.display = '';
  }

  // ── Ereignis: Überprüfung abschließen ────────────────────────────────────
  // (handler is defined above near _applyOverrides)

  // ── Start ─────────────────────────────────────────────────────────────────
  if (typeof cv === 'undefined' || !cv.Mat) {
    _waitForOpenCV();
  } else {
    _cvReady = true;
    _updateButton();
  }

})();
