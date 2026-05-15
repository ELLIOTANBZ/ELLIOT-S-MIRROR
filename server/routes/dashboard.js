import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import AuditRecord from '../models/AuditRecord.js';
import findNearestRecord from '../utils/findNearestRecord.js';

const router = Router();

/** Add n days (positive or negative) to a YYYY-MM-DD string. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const SKIP = new Set(['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt']);

/* ── 10 Auditmate indicators with flexible keyword matching ───── */
const INDICATORS = [
  { name: 'Courtesy',                   keys: ['courtesy'] },
  { name: 'Confidentiality',            keys: ['confidential'] },
  { name: 'Comprehend Intent',          keys: ['comprehend'] },
  { name: 'Comply – Email Writing SOG', keys: ['comply', 'sog', 'email writing'] },
  { name: 'Correct Information',        keys: ['correct'] },
  { name: 'Complete Information',       keys: ['complete'] },
  { name: 'Clear and Easy',             keys: ['clear'] },
  { name: 'Meaningful Conversations',   keys: ['meaningful', 'conversation'] },
  { name: 'Cultivate Digital Awareness',keys: ['cultivate', 'digital'] },
  { name: 'Verified Mistake',           keys: ['verified', 'mistake'] },
];

/** Parse any pass/fail or 0–100 value to a 0–1 score. Returns null if unrecognisable. */
function parsePassFail(val) {
  const s = String(val ?? '').toLowerCase().trim();
  if (['pass', 'yes', 'p', '1', 'true', 'passed', 'y'].includes(s)) return 1;
  if (['fail', 'no', 'f', '0', 'false', 'failed', 'n'].includes(s)) return 0;
  const n = parseFloat(s.replace('%', ''));
  if (!isNaN(n)) return n > 1 ? n / 100 : n;   // handles both 0–1 and 0–100
  return null;
}

/** For one indicator, find the first matching field in a record and return its parsed value. */
function findIndicatorValue(record, keywords) {
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (keywords.some(kw => low.includes(kw))) {
      const parsed = parsePassFail(v);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

/** Try to extract a 0–100 numeric score from a raw Mongo record. */
function extractScore(record) {
  const tryParse = v => {
    const n = parseFloat(String(v ?? '').replace('%', ''));
    return !isNaN(n) && n >= 0 && n <= 100 ? n : null;
  };
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if ((low.includes('score') || low.includes('total') || low.includes('percentage') || low === '%') && !low.includes('indicator')) {
      const n = tryParse(v); if (n !== null) return n;
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    if (k.toLowerCase().includes('indicator')) continue;
    const n = tryParse(v); if (n !== null) return n;
  }
  return null;
}

/**
 * Fix 5: Build a time-series from records over [startStr, endStr].
 * Days with no upload are gap-filled from the nearest record within 3 days.
 */
function groupByDate(records, startStr, endStr) {
  const result = [];
  const d   = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr   + 'T00:00:00Z');
  while (d <= end) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayRecs = records.filter(r => r.uploadDate === dateStr);
    let scores;
    if (dayRecs.length > 0) {
      scores = dayRecs.map(extractScore).filter(s => s !== null);
    } else {
      // Fix 5: gap-fill with nearest record within 3 days
      const nearest = findNearestRecord(dateStr, records, 3);
      scores = nearest ? [extractScore(nearest)].filter(s => s !== null) : [];
    }
    result.push({ date: dateStr, score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

/**
 * For each of the 10 indicators: compute average pass rate across all records.
 * Also classify each into Advanced/Intermediate/Basic for the level distribution.
 */
function computeIndicators(records) {
  return INDICATORS.map(({ name, keys }) => {
    const values = records
      .map(r => findIndicatorValue(r, keys))
      .filter(v => v !== null);

    const passRate = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;

    // level: ≥80% → Advanced, 60–79% → Intermediate, <60% → Basic
    let level = null;
    if (passRate !== null) {
      level = passRate >= 0.8 ? 'Advanced' : passRate >= 0.6 ? 'Intermediate' : 'Basic';
    }

    return { name, passRate, level, sampleSize: values.length };
  });
}

/**
 * Aggregate per-indicator levels into a distribution.
 * Falls back to explicit level-value fields in the CSV if no indicators matched.
 */
function computeLevelDistribution(indicatorResults, records) {
  // Primary: derive from indicator pass rates
  const withData = indicatorResults.filter(i => i.level !== null);
  if (withData.length > 0) {
    const advanced     = withData.filter(i => i.level === 'Advanced').length;
    const intermediate = withData.filter(i => i.level === 'Intermediate').length;
    const basic        = withData.filter(i => i.level === 'Basic').length;
    return { advanced, intermediate, basic, total: withData.length, source: 'indicators' };
  }

  // Fallback: look for explicit "Level" columns in the records (AI-generated fields)
  let advanced = 0, intermediate = 0, basic = 0;
  for (const record of records) {
    for (const [k, v] of Object.entries(record)) {
      if (SKIP.has(k)) continue;
      const key = k.toLowerCase();
      const val = String(v).toLowerCase().trim();
      if (!key.includes('level') && !key.includes('competency')) continue;
      if (val.includes('advanced'))     advanced++;
      else if (val.includes('intermediate')) intermediate++;
      else if (val.includes('basic'))   basic++;
    }
  }
  const total = advanced + intermediate + basic;
  return { advanced, intermediate, basic, total, source: 'fields' };
}

/* ── permission check: can requester view this officer? ──────── */
function canView(requester, targetId) {
  if (requester.role === 'Admin') return true;
  if (requester.role === 'Supervisor') return true;
  if (String(requester.id) === String(targetId)) return true;
  // TL can view any officer (CSO) — we verify role server-side via User lookup
  if (requester.role === 'TL') return true;
  return false;
}

/* ── main route ──────────────────────────────────────────────── */
router.get('/', requireAuth, async (req, res) => {
  try {
    // officerId param lets TL/Supervisor view another officer's data
    const requestedId = req.query.officerId;
    let officerId = req.user.id;

    if (requestedId && requestedId !== String(req.user.id)) {
      if (!canView(req.user, requestedId)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      // TL: only allowed to view CSOs
      if (req.user.role === 'TL') {
        const { default: User } = await import('../models/User.js');
        const target = await User.findById(requestedId).lean();
        if (!target || target.role !== 'CSO') {
          return res.status(403).json({ error: 'TL can only view CSO data.' });
        }
      }
      officerId = requestedId;
    }

    // Fix 4: anchor all windows to the latest upload date, not calendar today
    const latestRec = await AuditRecord.findOne({ officerId }).sort({ uploadDate: -1 }).lean();
    if (!latestRec) {
      return res.json({
        stats: {
          competencyScore: null, monthAverage: null, delta: null,
          targetStatus: null, referenceDate: null, periods: null,
        },
        currentData: [], prevData: [], indicators: [],
        competencyLevels: { advanced: 0, intermediate: 0, basic: 0, total: 0 },
      });
    }

    const refDateStr   = latestRec.uploadDate;
    const curEndStr    = refDateStr;
    const curStartStr  = addDays(refDateStr, -29);
    const prevEndStr   = addDays(refDateStr, -30);
    const prevStartStr = addDays(refDateStr, -59);

    const [curRecs, prevRecs] = await Promise.all([
      AuditRecord.find({ officerId, uploadDate: { $gte: curStartStr,  $lte: curEndStr  } }).lean(),
      AuditRecord.find({ officerId, uploadDate: { $gte: prevStartStr, $lte: prevEndStr } }).lean(),
    ]);

    const currentData = groupByDate(curRecs,  curStartStr,  curEndStr);
    const prevData    = groupByDate(prevRecs, prevStartStr, prevEndStr);

    const curScores  = currentData.map(d => d.score).filter(s => s !== null);
    const prevScores = prevData.map(d => d.score).filter(s => s !== null);

    const latestScore = curScores.length ? curScores[curScores.length - 1] : null;
    const monthAvg    = curScores.length ? curScores.reduce((a, b) => a + b, 0) / curScores.length : null;
    const last28      = currentData.slice(-28).map(d => d.score).filter(s => s !== null);
    const avg28       = last28.length ? last28.reduce((a, b) => a + b, 0) / last28.length : null;
    const prevAvg     = prevScores.length ? prevScores.reduce((a, b) => a + b, 0) / prevScores.length : null;
    const delta       = monthAvg !== null && prevAvg !== null ? monthAvg - prevAvg : null;
    const targetStatus = monthAvg !== null
      ? (monthAvg < 60 ? 'Needs to Develop' : monthAvg < 80 ? 'On Track' : 'Exceeds')
      : null;

    // Cards data
    const indicatorResults = computeIndicators(curRecs);
    const competencyLevels = computeLevelDistribution(indicatorResults, curRecs);

    res.json({
      stats: {
        competencyScore: latestScore,
        monthAverage: avg28,
        delta,
        targetStatus,
        referenceDate: refDateStr,
        periods: {
          current:  { start: curStartStr,  end: curEndStr  },
          previous: { start: prevStartStr, end: prevEndStr },
        },
      },
      currentData,
      prevData,
      indicators:        indicatorResults,
      competencyLevels,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

export default router;
