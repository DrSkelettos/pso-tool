/**
 * pdf-handler.js — PDF.js integration for rendering PDF pages to canvas
 * Exposes global: PDFHandler
 *
 * Renders at 300 DPI equivalent:
 *   PDF.js native DPI = 72 → scale factor = 300 / 72 ≈ 4.167
 */
var PDFHandler = (function () {
  'use strict';

  var RENDER_SCALE = 300 / 72; // ≈ 4.167 — 300 DPI from 72 DPI base

  // ─── Configure PDF.js worker ───────────────────────────────────────────────
  (function () {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
    }
  })();

  // ─── Load PDF from File object ─────────────────────────────────────────────
  /**
   * @param {File} file — PDF file from <input type="file">
   * @returns {Promise<PDFDocumentProxy>}
   */
  function loadPDF(file) {
    return new Promise(function (resolve, reject) {
      if (!file || file.type !== 'application/pdf') {
        return reject(new Error('Invalid file. Please upload a PDF.'));
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        var typedArray = new Uint8Array(e.target.result);
        UI.log('PDF loaded into memory (' + (typedArray.byteLength / 1024).toFixed(1) + ' KB)', 'info');

        pdfjsLib.getDocument({ data: typedArray }).promise.then(function (pdfDoc) {
          UI.log('PDF parsed: ' + pdfDoc.numPages + ' page(s)', 'ok');
          resolve(pdfDoc);
        }).catch(function (err) {
          reject(new Error('PDF.js failed to open document: ' + err.message));
        });
      };
      reader.onerror = function () {
        reject(new Error('Failed to read PDF file from disk.'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ─── Render a single page to a canvas ─────────────────────────────────────
  /**
   * @param {PDFDocumentProxy} pdfDoc
   * @param {number} pageNum — 1-based page number
   * @returns {Promise<HTMLCanvasElement>} — canvas at ~300 DPI resolution
   */
  function renderPage(pdfDoc, pageNum) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: RENDER_SCALE });

      var canvas = document.createElement('canvas');
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      var ctx = canvas.getContext('2d');

      var renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };

      UI.log(
        'Rendering page ' + pageNum + ' at ' +
        canvas.width + 'x' + canvas.height + ' px (scale=' + RENDER_SCALE.toFixed(3) + ')',
        'info'
      );

      return page.render(renderContext).promise.then(function () {
        UI.log('Page ' + pageNum + ' rendered.', 'ok');
        return canvas;
      });
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    loadPDF: loadPDF,
    renderPage: renderPage,
    RENDER_SCALE: RENDER_SCALE
  };
})();
