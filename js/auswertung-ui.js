/**
 * auswertung-ui.js — Minimal UI stub for auswertung.html
 *
 * The OMR processing modules (pdf-handler, checkbox-detector, etc.) call
 * UI.log() and a handful of other methods at import time. This stub satisfies
 * those calls without importing the full index.html UI module.
 */
var UI = (function () {
  'use strict';

  return {
    log:                   function (msg, lvl) {
      if (lvl === 'error') { console.error('[OMR]', msg); }
      else                 { console.log('[OMR]', msg);   }
    },
    showProgress:          function () {},
    hideProgress:          function () {},
    showError:             function (m) { console.error('[OMR]', m); },
    showWarning:           function (m) { console.warn('[OMR]', m);  },
    clearAlerts:           function () {},
    isDebugEnabled:        function () { return false; },
    isCalibrationEnabled:  function () { return false; },
    setCanvasContent:      function () {},
    setCanvasPageInfo:     function () {},
    showCanvasTab:         function () {},
    setDebugVisible:       function () {},
    setProcessing:         function () {},
    setExportEnabled:      function () {},
    setProcessEnabled:     function () {},
    renderResults:         function () {},
    renderQuestionResults: function () {},
    renderScoreResults:    function () {},
    resetUI:               function () {},
    escapeHtml: function (s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  };
})();
