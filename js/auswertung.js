/**
 * auswertung.js — Application logic for auswertung.html
 *
 * Depends on (must be loaded first):
 *   libs/pdf.min.js, libs/opencv.js
 *   js/auswertung-ui.js  (UI stub)
 *   js/template-manager.js, js/pdf-handler.js, js/image-preprocessing.js
 *   js/marker-detector.js, js/perspective-normalizer.js, js/checkbox-detector.js
 *   js/question-processor.js, js/score-processor.js
 *   templates/phqd.js    (PHQD_TEMPLATE global)
 */
(function () {
  'use strict';

  // ── Zustand ──────────────────────────────────────────────────────────────
  var _cvReady   = false;
  var _tmplReady = false;
  var _pdfFile   = null;

  // ── DOM-Referenzen ───────────────────────────────────────────────────────
  var _btnAuswerten = document.getElementById('btn-auswerten');
  var _errEl        = document.getElementById('err-msg');

  // ── Fortschrittssteuerung ─────────────────────────────────────────────────
  // _progress: tracks cumulative steps. Call _initProgress(totalSteps) before
  // the pipeline, then _step() after each completed sub-step.
  //
  // Schritt-Gewichtungen:
  //   PDF laden        →  1 Schritt
  //   Pro Seite        →  5 Schritte (render, preprocess, marker, normalize, analyze)
  //   Fragen + Scores  →  2 Schritte
  //
  // Gesamtschritte für N Seiten: 1 + 5·N + 2

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

  function _updateButton() {
    _btnAuswerten.disabled = !(_cvReady && _tmplReady && _pdfFile);
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

  // ── Vorlage laden ────────────────────────────────────────────────────────
  function _loadTemplate() {
    _tmplReady = false;
    try {
      TemplateManager.loadFromObject(PHQD_TEMPLATE);
      _tmplReady = true;
      _updateButton();
    } catch (err) {
      _showError('Vorlage konnte nicht geladen werden: ' + err.message);
    }
  }

  // ── Ereignis: PDF ausgewählt ─────────────────────────────────────────────
  document.getElementById('inp-pdf').addEventListener('change', function (e) {
    _pdfFile             = e.target.files && e.target.files[0];
    _errEl.style.display = 'none';
    _updateButton();
  });

  // ── Ereignis: Auswerten ──────────────────────────────────────────────────
  _btnAuswerten.addEventListener('click', function () {
    _btnAuswerten.disabled = true;
    _errEl.style.display   = 'none';

    _runPipeline()
      .then(function (scoreResults) {
        _displayResults(scoreResults);
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
    document.getElementById('form-card').style.display      = '';
    document.getElementById('inp-pdf').value                = '';
    _btnAuswerten.textContent = 'Auswerten';
    _btnAuswerten.disabled    = true;
    _pdfFile = null;
    TemplateManager.clear();
    _loadTemplate();
    _updateButton();
  });

  // ── Verarbeitungspipeline ────────────────────────────────────────────────
  function _runPipeline() {
    var allResults = [];

    _initProgress(1); // Platzhalter — wird nach PDF-Load neu gesetzt

    return PDFHandler.loadPDF(_pdfFile)
      .then(function (pdfDoc) {
        var totalPages  = pdfDoc.numPages;
        var tmplPages   = TemplateManager.getPageCount();
        var pagesToProc = Math.min(totalPages, tmplPages);

        _initProgress(1 + pagesToProc * 5 + 2);
        _step(); // PDF geladen

        var chain = Promise.resolve();
        for (var p = 1; p <= pagesToProc; p++) {
          (function (pageNum) {
            chain = chain.then(function () {
              return _processPage(pdfDoc, pageNum, allResults);
            });
          })(p);
        }
        return chain;
      })
      .then(function () {
        var tmpl     = TemplateManager.getTemplate();
        var qResults = QuestionProcessor.processQuestions(allResults, tmpl.questions);
        _step(); // Fragen ausgewertet

        var sResults = ScoreProcessor.processScores(qResults, tmpl.scores);
        _step(); // Scores berechnet

        return sResults;
      });
  }

  function _processPage(pdfDoc, pageNum, allResults) {
    var fields = TemplateManager.getFieldsForPage(pageNum);
    if (!fields.length) return Promise.resolve();

    var preprocessMats = null;
    var normResult     = null;

    return PDFHandler.renderPage(pdfDoc, pageNum)
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
          TemplateManager.getTemplate().pageWidth,
          TemplateManager.getTemplate().pageHeight
        );
        _step(); // Perspektive korrigiert

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

  /** Render a complete report section (heading + table + footnotes) */
  function _renderSection(section, lookup) {
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

  /** Main entry point: render the A4 report and switch views */
  function _displayResults(scoreResults) {
    var name   = document.getElementById('inp-name').value.trim() || '—';
    var dob    = document.getElementById('inp-dob').value;
    var date   = document.getElementById('inp-date').value;
    var report = TemplateManager.getTemplate().report;
    var lookup = _buildScoreLookup(scoreResults);
    var page   = document.getElementById('a4-page');
    page.innerHTML = '';

    // Header
    var hdr = document.createElement('div');
    hdr.className = 'rpt-header';
    hdr.innerHTML =
      '<h1>' + _esc(report.title) + '</h1>' +
      '<p class="subtitle">' + _esc(report.subtitle) + '</p>';
    page.appendChild(hdr);

    // Patientenzeile
    var pat = document.createElement('div');
    pat.className = 'rpt-patient';
    pat.innerHTML =
      '<span><span class="label">Name&nbsp;</span>'          + _esc(name)      + '</span>' +
      '<span><span class="label">Geburtsdatum&nbsp;</span>'  + _fmtDate(dob)   + '</span>' +
      '<span><span class="label">Datum&nbsp;</span>'         + _fmtDate(date)  + '</span>';
    page.appendChild(pat);

    // Sections
    (report.sections || []).forEach(function (section) {
      page.appendChild(_renderSection(section, lookup));
    });

    // Ansicht wechseln
    document.getElementById('form-card').style.display      = 'none';
    document.getElementById('a4-wrap').style.display        = 'block';
    document.getElementById('report-toolbar').style.display = 'flex';
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  _loadTemplate();

  if (typeof cv === 'undefined' || !cv.Mat) {
    _waitForOpenCV();
  } else {
    _cvReady = true;
    _updateButton();
  }

})();
