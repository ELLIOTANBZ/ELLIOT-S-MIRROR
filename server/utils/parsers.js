/**
 * CSV parsing utilities — convert raw CSV row objects into human-readable sentences
 * that can be fed directly to AI prompts.
 *
 * Called once at upload time; results are stored in ParsedUpload documents.
 */

const SKIP = new Set(['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt']);

/** Return a string value from the first field whose name contains ALL given keywords. */
function findField(record, ...keywords) {
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (keywords.every(kw => low.includes(kw))) {
      const s = String(v ?? '').trim();
      if (s && s !== 'undefined' && s !== 'null' && s !== '-') return s;
    }
  }
  return null;
}

/** Normalise a pass/fail raw value to a human label. */
function passFailLabel(val) {
  const s = String(val ?? '').toLowerCase().trim();
  if (['pass', 'yes', 'p', '1', 'true', 'passed', 'y'].includes(s)) return 'Yes';
  if (['fail', 'no', 'f', '0', 'false', 'failed', 'n'].includes(s)) return 'No';
  const cleaned = String(val ?? '').trim();
  return cleaned || 'N/A';
}

/* ════════════════════════════════════════════════════════════════
   INTERACTIONS PARSER
   Format: "On [date], a member enquired: '…'. The officer responded: '…'."
════════════════════════════════════════════════════════════════ */
export function parseInteractionRow(row, uploadDate) {
  const enquiry =
    findField(row, 'enquir')   ??
    findField(row, 'query')    ??
    findField(row, 'question') ??
    findField(row, 'issue')    ??
    findField(row, 'request')  ??
    findField(row, 'member');   // broad fallback

  const reply =
    findField(row, 'reply')    ??
    findField(row, 'response') ??
    findField(row, 'answer')   ??
    findField(row, 'officer')  ??
    findField(row, 'resolve');  // broad fallback

  if (!enquiry && !reply) return null;

  const eq = enquiry ?? '(not recorded)';
  const rp = reply   ?? '(not recorded)';
  return `On ${uploadDate}, a member enquired: '${eq}'. The officer responded: '${rp}'.`;
}

/* ════════════════════════════════════════════════════════════════
   AUDITMATE PARSER
   Format: multi-line block per case with all 10 indicators.
════════════════════════════════════════════════════════════════ */

const AUDIT_INDICATORS = [
  { num: 1,  label: 'Courtesy',                  keyword: 'courtesy'     },
  { num: 2,  label: 'Confidentiality',            keyword: 'confidential' },
  { num: 3,  label: 'Comprehend Intent',          keyword: 'comprehend'   },
  { num: 4,  label: 'Email SOG Compliance',       keyword: 'sog'          },
  { num: 5,  label: 'Correct Information',        keyword: 'correct'      },
  { num: 6,  label: 'Complete Information',       keyword: 'complete'     },
  { num: 7,  label: 'Clear and Easy',             keyword: 'clear'        },
  { num: 8,  label: 'Meaningful Conversations',   keyword: 'meaningful'   },
  { num: 9,  label: 'Cultivate Digital',          keyword: 'cultivat'     },
  { num: 10, label: 'Verified Mistake',           keyword: 'verif'        },
];

export function parseAuditRow(row, uploadDate) {
  // --- total score ---
  let totalScore = null;
  for (const [k, v] of Object.entries(row)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('total') || low.includes('score') || low.includes('percentage') || low === '%') {
      const n = parseFloat(String(v ?? '').replace('%', ''));
      if (!isNaN(n) && n >= 0 && n <= 100) { totalScore = n; break; }
    }
  }

  // --- indicator lines ---
  const indicatorLines = AUDIT_INDICATORS.map(({ num, label, keyword }) => {
    let passVal = 'N/A';
    let explanation = null;
    let suggestion  = null;

    for (const [k, v] of Object.entries(row)) {
      if (SKIP.has(k)) continue;
      const low = k.toLowerCase();
      if (!low.includes(keyword)) continue;

      const val = String(v ?? '').trim();
      if (!val || val === 'undefined' || val === 'null') continue;

      if (low.includes('explain') || low.includes('elaborat') || low.includes('remark')) {
        if (!explanation) explanation = val;
      } else if (low.includes('suggest') || low.includes('recommend') || low.includes('action') || low.includes('improve')) {
        if (!suggestion) suggestion = val;
      } else {
        passVal = passFailLabel(v);
      }
    }

    let line = `Indicator ${num} - ${label}: ${passVal}`;
    if (explanation) line += `. ${explanation}`;
    if (suggestion)  line += ` Suggestion: ${suggestion}`;
    return line + '.';
  });

  // --- classification ---
  let classification = null;
  for (const [k, v] of Object.entries(row)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('classif') || low.includes('category') || low.includes('issue type') || low.includes('outcome')) {
      const s = String(v ?? '').trim();
      if (s && s !== 'undefined' && s !== 'null') { classification = s; break; }
    }
  }

  // --- auditor comments ---
  let comments = null;
  for (const [k, v] of Object.entries(row)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('auditor') || (low.includes('comment') && !low.includes('suggest'))) {
      const s = String(v ?? '').trim();
      if (s && s !== 'undefined' && s !== 'null') { comments = s; break; }
    }
  }

  const scoreText = totalScore !== null ? `${totalScore.toFixed(1)}%` : 'N/A';
  const lines = [
    `For the case on ${uploadDate}, the officer scored ${scoreText} overall.`,
    ...indicatorLines,
  ];
  if (classification) lines.push(`Case classification: ${classification}.`);
  if (comments)       lines.push(`Auditor comments: ${comments}.`);

  return lines.join('\n');
}

/* ════════════════════════════════════════════════════════════════
   ESS PARSER
   Format: "Member satisfaction rating on [date]: [X]/5. Feedback: '…'."
════════════════════════════════════════════════════════════════ */
export function parseEssRow(row, uploadDate) {
  // --- rating ---
  let rating = null;
  for (const [k, v] of Object.entries(row)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('rating') || low.includes('satisfaction') || low.includes('ess') || low.includes('score')) {
      const n = parseFloat(String(v ?? ''));
      if (!isNaN(n) && n >= 1 && n <= 5) { rating = n; break; }
    }
  }
  if (rating === null) {
    for (const [k, v] of Object.entries(row)) {
      if (SKIP.has(k)) continue;
      const n = parseFloat(String(v ?? ''));
      if (!isNaN(n) && n >= 1 && n <= 5) { rating = n; break; }
    }
  }

  // --- feedback text ---
  let feedback = null;
  for (const [k, v] of Object.entries(row)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('feedback') || low.includes('comment') || low.includes('remark') ||
        low.includes('reason')   || low.includes('text')    || low.includes('verbatim')) {
      const s = String(v ?? '').trim();
      if (s && s !== 'undefined' && s !== 'null' && s !== '-') { feedback = s; break; }
    }
  }

  if (rating === null && !feedback) return null;

  const ratingText  = rating   !== null ? `${rating}/5`      : 'N/A';
  const feedbackText = feedback ? `'${feedback}'` : '(no feedback provided)';
  return `Member satisfaction rating on ${uploadDate}: ${ratingText}. Feedback: ${feedbackText}.`;
}
