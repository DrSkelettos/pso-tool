/**
 * template-manager.js — Load and validate OMR field templates
 * Exposes global: TemplateManager
 */
var TemplateManager = (function () {
  'use strict';

  var _template = null;

  // ─── Validation ────────────────────────────────────────────────────────────
  function validate(json) {
    if (!json || typeof json !== 'object') {
      throw new Error('Template is not a valid JSON object.');
    }
    if (!json.pageWidth || !json.pageHeight) {
      throw new Error('Template must have pageWidth and pageHeight.');
    }
    if (!Array.isArray(json.fields) || json.fields.length === 0) {
      throw new Error('Template must have a non-empty fields array.');
    }
    json.fields.forEach(function (f, i) {
      if (!f.id)     throw new Error('Field #' + i + ' missing id.');
      if (f.x === undefined || f.y === undefined) throw new Error('Field "' + f.id + '" missing x or y.');
      if (!f.width || !f.height) throw new Error('Field "' + f.id + '" missing width or height.');
    });
    return true;
  }

  // ─── Load from File object ─────────────────────────────────────────────────
  function loadFromFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file provided.'));
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var json = JSON.parse(e.target.result);
          validate(json);
          _template = json;
          UI.log('Template loaded from file: ' + file.name + ' (' + json.fields.length + ' fields)' +
            (json.offsetX || json.offsetY ? ' offset=(' + (json.offsetX||0) + ',' + (json.offsetY||0) + ')' : ''), 'ok');
          resolve(json);
        } catch (err) {
          reject(new Error('Template parse error: ' + err.message));
        }
      };
      reader.onerror = function () {
        reject(new Error('Failed to read template file.'));
      };
      reader.readAsText(file);
    });
  }

  // ─── Load from built-in path (fetch) ───────────────────────────────────────
  function loadFromPath(name) {
    return new Promise(function (resolve, reject) {
      // Use XMLHttpRequest for file:// compatibility (fetch may be blocked)
      var xhr = new XMLHttpRequest();
      // Cache-buster: prevents browser from serving a stale file when the JSON
      // is edited on disk and then re-selected in the dropdown.
      xhr.open('GET', 'templates/' + name + '.json?_=' + Date.now(), true);
      xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 0) { // status 0 on file://
          try {
            var json = JSON.parse(xhr.responseText);
            validate(json);
            _template = json;
            UI.log('Template loaded: ' + name + '.json (' + json.fields.length + ' fields)' +
              (json.offsetX || json.offsetY ? ' offset=(' + (json.offsetX||0) + ',' + (json.offsetY||0) + ')' : ''), 'ok');
            resolve(json);
          } catch (err) {
            reject(new Error('Template parse error: ' + err.message));
          }
        } else {
          reject(new Error('Failed to load template "' + name + '": HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Network error loading template "' + name + '". If using file://, upload the template manually.'));
      };
      xhr.send();
    });
  }

  // ─── Field access ──────────────────────────────────────────────────────────
  function getTemplate() {
    return _template;
  }

  function getFieldsForPage(pageNum) {
    if (!_template) return [];
    var ox = _template.offsetX || 0;
    var oy = _template.offsetY || 0;
    return _template.fields
      .filter(function (f) { return (f.page || 1) === pageNum; })
      .map(function (f) {
        if (ox === 0 && oy === 0) return f;
        // Return a shallow copy with the offset applied — original template data unchanged
        return {
          id: f.id, page: f.page,
          x: f.x + ox, y: f.y + oy,
          width: f.width, height: f.height
        };
      });
  }

  function getPageCount() {
    if (!_template) return 0;
    var maxPage = 1;
    _template.fields.forEach(function (f) {
      if ((f.page || 1) > maxPage) maxPage = f.page;
    });
    return maxPage;
  }

  function hasTemplate() {
    return _template !== null;
  }

  function clear() {
    _template = null;
  }

  // ─── Load from plain object (e.g. embedded JS template) ───────────────────
  function loadFromObject(obj) {
    try {
      validate(obj);
      _template = obj;
      UI.log('Template loaded from object (' + obj.fields.length + ' fields)', 'ok');
    } catch (err) {
      throw new Error('Template validation error: ' + err.message);
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    loadFromFile: loadFromFile,
    loadFromPath: loadFromPath,
    loadFromObject: loadFromObject,
    getTemplate: getTemplate,
    getFieldsForPage: getFieldsForPage,
    getPageCount: getPageCount,
    hasTemplate: hasTemplate,
    validate: validate,
    clear: clear
  };
})();
