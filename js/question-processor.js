/**
 * question-processor.js — Maps checkbox field results to question answers
 * Exposes global: QuestionProcessor
 *
 * Field ID convention: {questionId}_{value}
 *   e.g. "1_a_2"  → question "1_a", answer value 2
 *        "10_b_0" → question "10_b", answer value 0
 *
 * Result status values:
 *   "answered"     — exactly one field checked (or best chosen from multiple)
 *   "not_answered" — no fields checked
 *   "uncertain"    — best field was marked uncertain by the checkbox detector
 */
var QuestionProcessor = (function () {
  'use strict';

  /**
   * Extract the integer answer value encoded in a field ID.
   * The value is the last underscore-separated segment.
   * @param {string} fieldId
   * @returns {number}
   */
  function _fieldValue(fieldId) {
    var parts = fieldId.split('_');
    return parseInt(parts[parts.length - 1], 10);
  }

  /**
   * Process field results into question results using the template's questions map.
   *
   * Logic per question:
   *  1. Collect all field results whose IDs are listed in q.fields.
   *  2. Filter to those that are checked OR uncertain (treat uncertain as possibly checked).
   *  3. If none → status "not_answered", value null.
   *  4. If one or more → pick the one with the LOWEST ratio (genuine marks are
   *     partially filled; accidentally-filled/scribbled boxes tend toward ratio ≈ 1).
   *  5. If the winning field is uncertain → status "uncertain".
   *     Otherwise → status "answered".
   *
   * @param {Array<Object>} fieldResults - flat array of all field results from CheckboxDetector
   * @param {Array<Object>} questions    - template.questions array
   * @returns {Array<Object>} questionResults
   */
  function processQuestions(fieldResults, questions) {
    if (!Array.isArray(questions) || questions.length === 0) return [];

    // Build O(1) lookup: fieldId → result
    var fieldMap = {};
    fieldResults.forEach(function (r) {
      fieldMap[r.id] = r;
    });

    return questions.map(function (q) {
      var fieldIds = Array.isArray(q.fields) ? q.fields : [];

      // Gather results for this question's fields
      var relevant = fieldIds.map(function (fid) {
        return fieldMap[fid] || null;
      }).filter(Boolean);

      // Candidate fields: checked or uncertain
      var candidates = relevant.filter(function (r) {
        return r.checked || r.uncertain;
      });

      if (candidates.length === 0) {
        return {
          id:             q.id,
          value:          null,
          status:         'not_answered',
          field:          null,
          ratio:          null,
          confidence:     null,
          multipleChecked: false
        };
      }

      // Pick the candidate with the lowest ratio (most genuine-looking mark)
      var best = candidates.reduce(function (a, b) {
        var ra = (a.ratio !== undefined && a.ratio !== null) ? a.ratio : 1;
        var rb = (b.ratio !== undefined && b.ratio !== null) ? b.ratio : 1;
        return ra <= rb ? a : b;
      });

      return {
        id:              q.id,
        value:           _fieldValue(best.id),
        status:          best.uncertain ? 'uncertain' : 'answered',
        field:           best.id,
        ratio:           best.ratio,
        confidence:      best.confidence,
        multipleChecked: candidates.length > 1
      };
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return {
    processQuestions: processQuestions
  };
})();
