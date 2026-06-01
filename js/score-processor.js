/**
 * score-processor.js — Evaluates template score definitions against question results
 * Exposes global: ScoreProcessor
 *
 * Supported score rule types (detected from structure):
 *   count        — count items meeting an answer-value condition; positive if count ≥ threshold
 *   depressive   — complex rule: required_one_of + per-item count_if (object) + min/max count
 *   panik        — all_required items must equal a value + count_items ≥ minimum
 *   angst        — required_item ≥ min + count_items with string count_if ≥ minimum
 *   allrequired  — all_required items must equal required_value
 *   yesno        — required_yes items == 1, required_no items != 1
 *   threshold    — items with value == answer_value counted; positive if ≥ minimum_count
 *   sum          — direct sum of item values with optional severity table
 *   special_sum  — sum with per-item value mapping (range key or multi-item key)
 *   subscore     — sum of item values with optional per-item inversion (value = MAX - v)
 *   subscales    — sum of previously-computed subscores
 */
var ScoreProcessor = (function () {
  'use strict';

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Build questionId → result lookup. Also maps bare number IDs to their _a variant. */
  function _buildLookup(questionResults) {
    var map = {};
    questionResults.forEach(function (q) {
      map[q.id] = q;
    });
    return map;
  }

  /** Resolve a question reference: try exact id, then id+'_a' (handles "8" → "8_a"). */
  function _resolve(lookup, qid) {
    return lookup[qid] || lookup[qid + '_a'] || null;
  }

  /** Return answered numeric value, or null if missing / not_answered. */
  function _val(lookup, qid) {
    var q = _resolve(lookup, qid);
    if (!q || q.status === 'not_answered') return null;
    return q.value;
  }

  /**
   * Test a numeric value against a condition string such as ">=2", ">1", "=1", "==1".
   * Returns false if value is null/undefined.
   */
  function _test(value, condStr) {
    if (value === null || value === undefined) return false;
    var m = String(condStr).match(/^(>=|<=|==?|>|<)(\d+)$/);
    if (!m) return false;
    var op  = m[1];
    var thr = parseInt(m[2], 10);
    if (op === '>=') return value >= thr;
    if (op === '<=') return value <= thr;
    if (op === '>')  return value > thr;
    if (op === '<')  return value < thr;
    return value === thr; // '=' or '=='
  }

  /** Format a score ID as a human-readable label ("major_depressives_syndrom" → "Major Depressives Syndrom"). */
  function _label(id) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // ─── Rule processors ──────────────────────────────────────────────────────

  /**
   * somatoformes_syndrom:
   *   type: "count"
   *   condition: { operator, value (count threshold), answer_value (per-item min) }
   */
  function _processCount(id, def, lookup) {
    var cond    = def.condition;
    var op      = cond.operator || '>=';
    var minAns  = cond.answer_value;
    var minCnt  = cond.value;

    var count   = 0;
    var missing = 0;
    def.items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      if (_test(v, op + minAns)) count++;
    });

    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      count >= minCnt,
      count:         count,
      total:         def.items.length,
      hasUnanswered: missing > 0,
      note:          count + ' / ' + def.items.length + ' items qualify (threshold: ' + minCnt + ')'
    };
  }

  /**
   * major_depressives_syndrom / anderes_depressives_syndrom:
   *   rule.count_if: object { default: ">=2", "2_i": ">=1" }
   *   rule.required_one_of: ["2_a","2_b"]
   *   rule.minimum_count, rule.maximum_count (optional)
   */
  function _processDepressive(id, def, lookup) {
    var rule = def.rule;

    // Required items must be answered
    var requiredAnswered = true;
    if (Array.isArray(def.required_items)) {
      def.required_items.forEach(function (qid) {
        var q = _resolve(lookup, qid);
        if (!q || q.status === 'not_answered') requiredAnswered = false;
      });
    }

    // Count qualifying items using per-item or default condition
    var count   = 0;
    var missing = 0;
    def.count_items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      var condStr = (rule.count_if[qid] !== undefined ? rule.count_if[qid] : rule.count_if['default']) || '>=2';
      if (_test(v, condStr)) count++;
    });

    // At least one required item must itself qualify
    var oneOfOk = true;
    if (Array.isArray(rule.required_one_of)) {
      oneOfOk = rule.required_one_of.some(function (qid) {
        var v = _val(lookup, qid);
        if (v === null) return false;
        var condStr = (rule.count_if[qid] !== undefined ? rule.count_if[qid] : rule.count_if['default']) || '>=2';
        return _test(v, condStr);
      });
    }

    var meetsMin = count >= rule.minimum_count;
    var meetsMax = (rule.maximum_count === undefined) || (count <= rule.maximum_count);
    var positive = requiredAnswered && oneOfOk && meetsMin && meetsMax;

    var notes = [count + ' qualifying items'];
    if (!requiredAnswered) notes.push('required items missing');
    if (!oneOfOk)          notes.push('key symptom (2_a/2_b) absent');
    if (!meetsMin)         notes.push('below minimum ' + rule.minimum_count);
    if (!meetsMax)         notes.push('above maximum ' + rule.maximum_count);

    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      positive,
      count:         count,
      total:         def.count_items.length,
      hasUnanswered: missing > 0 || !requiredAnswered,
      note:          notes.join('; ')
    };
  }

  /**
   * paniksyndrom:
   *   all_required: items that must ALL equal rule.all_required_value
   *   count_items: items counted if value === rule.count_value
   *   rule.minimum_count
   */
  function _processPanik(id, def, lookup) {
    var rule    = def.rule;
    var reqVal  = rule.all_required_value;

    var allOk      = true;
    var missingReq = 0;
    def.all_required.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missingReq++; allOk = false; return; }
      if (v !== reqVal) allOk = false;
    });

    var count   = 0;
    var missing = 0;
    def.count_items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      if (v === rule.count_value) count++;
    });

    var positive = allOk && count >= rule.minimum_count;

    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      positive,
      count:         count,
      total:         def.count_items.length,
      hasUnanswered: missingReq > 0 || missing > 0,
      note:          (allOk ? 'Entry criteria met' : 'Entry criteria NOT met') +
                     '; ' + count + '/' + def.count_items.length + ' panic symptoms (min ' + rule.minimum_count + ')'
    };
  }

  /**
   * anderes_angstsyndrom:
   *   required_item: must have value >= rule.required_item_min
   *   count_items: counted if value matches rule.count_if (string)
   *   rule.minimum_count
   */
  function _processAngst(id, def, lookup) {
    var rule  = def.rule;
    var reqV  = _val(lookup, def.required_item);
    var reqOk = reqV !== null && _test(reqV, '>=' + rule.required_item_min);

    var count   = 0;
    var missing = 0;
    def.count_items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      if (_test(v, rule.count_if)) count++;
    });

    var positive = reqOk && count >= rule.minimum_count;

    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      positive,
      count:         count,
      total:         def.count_items.length,
      hasUnanswered: reqV === null || missing > 0,
      note:          (reqOk ? def.required_item + ' qualifies' : def.required_item + ' does not qualify') +
                     '; ' + count + '/' + def.count_items.length + ' symptoms (min ' + rule.minimum_count + ')'
    };
  }

  /**
   * bulimia_nervosa_verdacht:
   *   all_required: ALL must equal required_value
   */
  function _processBulimia(id, def, lookup) {
    var reqVal  = def.required_value;
    var allOk   = true;
    var missing = 0;
    def.all_required.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; allOk = false; return; }
      if (v !== reqVal) allOk = false;
    });

    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      allOk,
      hasUnanswered: missing > 0,
      note:          allOk ? 'All ' + def.all_required.length + ' criteria met' : 'Not all criteria met'
    };
  }

  /**
   * binge_eating_verdacht:
   *   required_yes: must all == 1
   *   required_no:  must all != 1
   */
  function _processBinge(id, def, lookup) {
    var yesOk   = true;
    var noOk    = true;
    var missing = 0;

    def.required_yes.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; yesOk = false; return; }
      if (v !== 1) yesOk = false;
    });
    def.required_no.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      if (v === 1) noOk = false;
    });

    var notes = [];
    if (!yesOk) notes.push('yes-criteria not met');
    if (!noOk)  notes.push('exclusion not met');

    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      yesOk && noOk,
      hasUnanswered: missing > 0,
      note:          (yesOk && noOk) ? 'All criteria met' : notes.join('; ')
    };
  }

  /**
   * alkoholsyndrom:
   *   items counted if value == condition.answer_value; positive if count >= condition.minimum_count
   */
  function _processThreshold(id, def, lookup) {
    var ansVal  = def.condition.answer_value;
    var minCnt  = def.condition.minimum_count;

    var count   = 0;
    var missing = 0;
    def.items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      if (v === ansVal) count++;
    });

    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      count >= minCnt,
      count:         count,
      total:         def.items.length,
      hasUnanswered: missing > 0,
      note:          count + ' / ' + def.items.length + ' items positive (min ' + minCnt + ')'
    };
  }

  /**
   * depressivitaet, stress: simple sum with optional severity table.
   */
  function _processSum(id, def, lookup) {
    var sum     = 0;
    var missing = 0;
    def.items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      sum += v;
    });

    var severity = null;
    if (Array.isArray(def.severity)) {
      for (var i = 0; i < def.severity.length; i++) {
        var s = def.severity[i];
        if (sum >= s.min && sum <= s.max) { severity = s.label; break; }
      }
    }

    return {
      id:            id,
      label:         _label(id),
      type:          'numeric',
      sum:           sum,
      range:         def.range || null,
      severity:      severity,
      hasUnanswered: missing > 0,
      note:          severity ? severity : null
    };
  }

  /**
   * somatische_symptome: sum with per-item value remapping.
   *   special_scoring keys:
   *     "A-B"  — range of items from A to B in def.items
   *     "X_Y"  — specific items matched by presence in the key
   */
  function _processSpecialSum(id, def, lookup) {
    // Build itemId → scoring-map lookup
    var itemScoring = {}; // qid → { "0": number, "1": number, ... }

    Object.keys(def.special_scoring).forEach(function (key) {
      var mapping = def.special_scoring[key];

      // Detect range key: "1_a-1_m"
      var dashIdx = key.indexOf('-');
      if (dashIdx !== -1) {
        var startId = key.slice(0, dashIdx);
        var endId   = key.slice(dashIdx + 1);
        var inRange = false;
        def.items.forEach(function (qid) {
          if (qid === startId) inRange = true;
          if (inRange) itemScoring[qid] = mapping;
          if (qid === endId)   inRange = false;
        });
      } else {
        // Multi-item key like "2_c_2_d": match any item whose ID appears in the key
        def.items.forEach(function (qid) {
          if (key === qid ||
              key.startsWith(qid + '_') ||
              key.endsWith('_' + qid) ||
              key.indexOf('_' + qid + '_') !== -1) {
            itemScoring[qid] = mapping;
          }
        });
      }
    });

    var sum     = 0;
    var missing = 0;
    def.items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      var scoring = itemScoring[qid];
      if (scoring) {
        var mapped = scoring[String(v)];
        sum += (mapped !== undefined) ? mapped : v;
      } else {
        sum += v;
      }
    });

    return {
      id:            id,
      label:         _label(id),
      type:          'numeric',
      sum:           sum,
      range:         def.range || null,
      severity:      null,
      hasUnanswered: missing > 0,
      note:          null
    };
  }

  /**
   * Single-item threshold check.
   * { item: "2_i", condition: ">=1" }
   */
  function _processSingleItem(id, def, lookup) {
    var v        = _val(lookup, def.item);
    var positive = v !== null && _test(v, def.condition);
    return {
      id:            id,
      label:         _label(id),
      type:          'diagnostic',
      positive:      v !== null ? positive : null,
      hasUnanswered: v === null,
      note:          v !== null ? String(v) : 'not answered'
    };
  }

  /**
   * Single-item value-to-label mapping.
   * { item: "11", value_labels: { "0": "überhaupt nicht", ... } }
   */
  function _processValueLabel(id, def, lookup) {
    var v    = _val(lookup, def.item);
    var text = v !== null ? (def.value_labels[String(v)] || String(v)) : null;
    return {
      id:            id,
      label:         _label(id),
      type:          'value_label',
      positive:      null,
      valueLabel:    text,
      hasUnanswered: v === null,
      note:          text || 'not answered'
    };
  }

  /**
   * OPD-SF subscores: sum of item values, inverting selected items.
   * { items: ["1","67",...], invert: ["62","55"] }
   * Inverted value = MAX_ITEM_VALUE - value  (defaults to 4 for a 0–4 scale)
   */
  function _processSubscore(id, def, lookup) {
    var MAX_VAL  = def.max_item_value !== undefined ? def.max_item_value : 4;
    var invertSet = {};
    (def.invert || []).forEach(function (qid) { invertSet[qid] = true; });

    var sum     = 0;
    var missing = 0;
    def.items.forEach(function (qid) {
      var v = _val(lookup, qid);
      if (v === null) { missing++; return; }
      sum += invertSet[qid] ? (MAX_VAL - v) : v;
    });

    var maxPossible = def.items.length * MAX_VAL;
    return {
      id:            id,
      label:         _label(id),
      type:          'subscore',
      sum:           sum,
      max:           maxPossible,
      itemCount:     def.items.length,
      hasUnanswered: missing > 0,
      note:          sum + ' / ' + maxPossible
    };
  }

  /**
   * Aggregate across already-computed subscores.
   * { subscales: ["selbstreflexion", "affektdifferenzierung", ...] }
   * scoreMap: id → computed result object (from pass 1).
   */
  function _processSubscales(id, def, scoreMap) {
    var sum     = 0;
    var max     = 0;
    var missing = 0;
    def.subscales.forEach(function (sid) {
      var s = scoreMap[sid];
      if (!s || s.sum === undefined || s.sum === null) { missing++; return; }
      sum += s.sum;
      max += (s.max || 0);
    });

    return {
      id:            id,
      label:         _label(id),
      type:          'subscore',
      sum:           sum,
      max:           max,
      itemCount:     def.subscales.length,
      hasUnanswered: missing > 0,
      note:          sum + ' / ' + max
    };
  }

  // ─── Dispatcher ──────────────────────────────────────────────────────────

  function _dispatch(id, def, lookup) {
    // Order matters: most-specific checks first
    if (def.sum === true)                                                return _processSum(id, def, lookup);
    if (def.special_scoring)                                             return _processSpecialSum(id, def, lookup);
    if (def.type === 'count')                                            return _processCount(id, def, lookup);
    if (def.rule && def.rule.count_if && typeof def.rule.count_if === 'object')
                                                                         return _processDepressive(id, def, lookup);
    if (def.all_required && Array.isArray(def.count_items))             return _processPanik(id, def, lookup);
    if (def.required_item && Array.isArray(def.count_items))            return _processAngst(id, def, lookup);
    if (def.all_required && def.required_value !== undefined)           return _processBulimia(id, def, lookup);
    if (def.required_yes && def.required_no)                            return _processBinge(id, def, lookup);
    if (def.items && def.condition && def.condition.minimum_count !== undefined)
                                                                         return _processThreshold(id, def, lookup);
    if (def.items && Array.isArray(def.invert))                         return _processSubscore(id, def, lookup);
    if (def.item && def.value_labels)                                    return _processValueLabel(id, def, lookup);
    if (def.item && def.condition)                                       return _processSingleItem(id, def, lookup);
    return { id: id, label: _label(id), type: 'unknown', positive: null, hasUnanswered: false, note: 'Unrecognized rule structure' };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Process all scores defined in the template.
   * Two-pass: leaf scores first (items/rules), then subscale aggregates.
   * @param {Array}  questionResults  — output of QuestionProcessor.processQuestions
   * @param {Object} scores           — template.scores object
   * @returns {Array} score result objects (in original key order)
   */
  function processScores(questionResults, scores) {
    if (!scores || typeof scores !== 'object') return [];
    var lookup  = _buildLookup(questionResults);
    var scoreMap = {};
    var keys    = Object.keys(scores);

    // Pass 1: everything except subscale aggregates
    keys.forEach(function (id) {
      var def = scores[id];
      if (!def.subscales) {
        scoreMap[id] = _dispatch(id, def, lookup);
      }
    });

    // Pass 2: subscale aggregates (may depend on pass-1 results)
    keys.forEach(function (id) {
      var def = scores[id];
      if (def.subscales) {
        scoreMap[id] = _processSubscales(id, def, scoreMap);
      }
    });

    return keys.map(function (id) { return scoreMap[id]; });
  }

  return { processScores: processScores };
})();
