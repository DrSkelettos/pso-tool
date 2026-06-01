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

  // ── Review-Zustand ───────────────────────────────────────────────────────
  var _pageCanvases    = {}; // pageNum → HTMLCanvasElement (normalized scan)
  var _lastQResults    = []; // letztes QuestionProcessor-Ergebnis
  var _lastSResults    = []; // letztes ScoreProcessor-Ergebnis
  var _reviewOverrides = {}; // qId → value|null (Benutzerkorrekturen)

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
      .then(function (results) {
        _lastQResults = results.qResults;
        _lastSResults = results.sResults;

        var toReview = _lastQResults.filter(function (q) {
          return q.status === 'uncertain' || q.multipleChecked;
        });

        if (toReview.length > 0) {
          _showReview(toReview);
        } else {
          _displayResults(_lastSResults);
        }
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
    document.getElementById('inp-pdf').value                = '';
    _btnAuswerten.textContent = 'Auswerten';
    _btnAuswerten.disabled    = true;
    _pdfFile         = null;
    _pageCanvases    = {};
    _lastQResults    = [];
    _lastSResults    = [];
    _reviewOverrides = {};
    TemplateManager.clear();
    _loadTemplate();
    _updateButton();
  });

  // ── Verarbeitungspipeline ────────────────────────────────────────────────
  function _runPipeline() {
    var allResults = [];
    _pageCanvases = {}; // Reset für neue Auswertung

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

        return { qResults: qResults, sResults: sResults };
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

        _pageCanvases[pageNum] = normResult.canvas; // Für Review-Anzeige sichern

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

  // ── Überprüfungsansicht ──────────────────────────────────────────────────

  /**
   * Build and display the review UI for questions that need manual verification.
   * Each question shows a cropped strip of the normalized scan (±200 px around
   * the field row) with transparent, clickable field overlays.
   *
   * @param {Array} reviewQuestions - subset of _lastQResults that need review
   */
  function _showReview(reviewQuestions) {
    var tmpl      = TemplateManager.getTemplate();
    var pageW     = tmpl.pageWidth;
    var pageH     = tmpl.pageHeight;
    var DISPLAY_W   = 760;  // px displayed width
    var STRIP_H     = 400;  // px in template space (±200 around center)
    var FIELD_OFS_X = -5;   // px correction for field overlay horizontal offset
    var FIELD_OFS_Y = -5;   // px correction for field overlay vertical offset
    var scale       = DISPLAY_W / pageW;

    // Build O(1) lookups
    var fieldDef = {};
    tmpl.fields.forEach(function (f) { fieldDef[f.id] = f; });

    var qDefMap = {};
    (tmpl.questions || []).forEach(function (q) { qDefMap[q.id] = q; });

    var container = document.getElementById('review-questions');
    container.innerHTML = '';
    _reviewOverrides = {};

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

      // Init override from auto-detected value
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

      var srcCanvas = _pageCanvases[page];
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

    document.getElementById('form-card').style.display  = 'none';
    document.getElementById('review-card').style.display = '';
  }

  // ── Ereignis: Überprüfung abschließen ────────────────────────────────────
  document.getElementById('btn-review-done').addEventListener('click', function () {
    // Merge user overrides into last question results, re-score
    var updated = _lastQResults.map(function (qr) {
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

    var newScores = ScoreProcessor.processScores(updated, TemplateManager.getTemplate().scores);
    document.getElementById('review-card').style.display = 'none';
    _displayResults(newScores);
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  _loadTemplate();

  if (typeof cv === 'undefined' || !cv.Mat) {
    _waitForOpenCV();
  } else {
    _cvReady = true;
    _updateButton();
  }

})();
