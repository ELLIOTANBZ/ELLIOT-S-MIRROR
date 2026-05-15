import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import AuditRecord from '../models/AuditRecord.js';
import AiCache from '../models/AiCache.js';
import User from '../models/User.js';
import { fetchParsedContext } from '../utils/fetchParsedContext.js';
import { buildCompetencySystemPrompt } from '../utils/getCompetencyContext.js';
import findNearestRecord from '../utils/findNearestRecord.js';

const router = Router();
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SKIP = new Set(['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt']);

const RADAR_INDICATORS = [
  { name: 'Courtesy',   keys: ['courtesy'] },
  { name: 'Comprehend', keys: ['comprehend'] },
  { name: 'Correct',    keys: ['correct'] },
  { name: 'Complete',   keys: ['complete'] },
  { name: 'Clear',      keys: ['clear'] },
  { name: 'Meaningful', keys: ['meaningful', 'conversation'] },
];

/* ── helpers ──────────────────────────────────────────────────── */
function parsePassFail(val) {
  const s = String(val ?? '').toLowerCase().trim();
  if (['pass', 'yes', 'p', '1', 'true', 'passed', 'y'].includes(s)) return 1;
  if (['fail', 'no', 'f', '0', 'false', 'failed', 'n'].includes(s)) return 0;
  const n = parseFloat(s.replace('%', ''));
  if (!isNaN(n)) return n > 1 ? n / 100 : n;
  return null;
}

function findIndicatorValue(record, keywords) {
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (keywords.some(kw => low.includes(kw))) {
      const p = parsePassFail(v);
      if (p !== null) return p;
    }
  }
  return null;
}

function avgForIndicator(records, keywords) {
  const vals = records.map(r => findIndicatorValue(r, keywords)).filter(v => v !== null);
  if (!vals.length) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
}

/** Add n days (positive or negative) to a YYYY-MM-DD string. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(dateStr) {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Trend projection: extrapolates 90 days forward.
 * Returns { predicted, rawDailyChange }
 * - Fix 2: per-level daily change caps + maxGap cap
 * - Fix 3: rawDailyChange used by caller for trend direction
 * - Soft ceiling 88%; declining indicators damped ×0.75
 */
function projectIndicator(history, currentAvg) {
  if (!history.length || currentAvg === null) return { predicted: null, rawDailyChange: 0 };

  const SOFT_CEILING    = 88;
  const MIN_DAILY_DRIFT = 0.025;

  // Fix 2: per-level caps
  let maxDailyChange, maxGap;
  if (currentAvg < 40)       { maxDailyChange = 0.08; maxGap = 25; }
  else if (currentAvg < 60)  { maxDailyChange = 0.15; maxGap = 25; }
  else if (currentAvg < 75)  { maxDailyChange = 0.20; maxGap = 35; }
  else                       { maxDailyChange = 0.25; maxGap = 35; }

  if (history.length === 1) {
    const raw = currentAvg + (SOFT_CEILING - currentAvg) * 0.08;
    const predicted = Math.min(SOFT_CEILING, Math.min(currentAvg + maxGap, Math.round(raw * 10) / 10));
    return { predicted, rawDailyChange: 0 };
  }

  const first = history[0];
  const last  = history[history.length - 1];
  const daysDiff = Math.max(1,
    (new Date(last.date + 'T00:00:00Z') - new Date(first.date + 'T00:00:00Z')) / (1000 * 60 * 60 * 24));
  const rawDailyChange = (last.avg - first.avg) / daysDiff;

  const effectiveDailyChange = rawDailyChange >= 0
    ? Math.max(MIN_DAILY_DRIFT, Math.min(maxDailyChange, rawDailyChange * 0.75))
    : rawDailyChange * 0.75;

  const projected = currentAvg + effectiveDailyChange * 90;
  const capped    = Math.min(currentAvg + maxGap, projected);
  const predicted = Math.min(SOFT_CEILING, Math.max(0, Math.round(capped * 10) / 10));
  return { predicted, rawDailyChange };
}

/**
 * Fix 5: If period has no records, return all records from the upload date
 * nearest to targetDateStr (excluding dates on/after excludeAfter).
 */
function gapFillPeriod(periodRecs, targetDateStr, allRecords, excludeAfter, tolerance = 14) {
  if (periodRecs.length > 0) return periodRecs;
  const candidates = allRecords.filter(r => r.uploadDate < excludeAfter);
  const nearest = findNearestRecord(targetDateStr, candidates, tolerance);
  if (!nearest) return [];
  return allRecords.filter(r => r.uploadDate === nearest.uploadDate);
}

async function resolveOfficerId(req) {
  const requestedId = req.query.officerId;
  if (!requestedId || requestedId === String(req.user.id)) return String(req.user.id);
  if (req.user.role === 'Admin') return requestedId;
  if (req.user.role === 'CSO') return null;
  if (req.user.role === 'TL') {
    const target = await User.findById(requestedId).lean();
    if (!target || target.role !== 'CSO') return null;
  }
  return requestedId;
}

async function fetchInsights(indicatorData, wKey, officerId, refDateStr) {
  const cacheKey = { officerId, uploadDate: wKey, competencyIndex: 99, type: 'radar-insights' };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) return cached.content;

  const lines = indicatorData.map(i =>
    `${i.name}: current=${i.current != null ? i.current.toFixed(1) : 'N/A'}%, predicted=${i.predicted != null ? i.predicted.toFixed(1) : 'N/A'}%, trend=${i.trend}`
  ).join('\n');

  const cutoffStr = addDays(refDateStr, -30);
  const officerUser = await User.findById(officerId).lean().catch(() => null);
  const officerRole = officerUser?.role ?? 'CSO';
  const [{ contextBlock }, sysPrompt] = await Promise.all([
    fetchParsedContext(officerId, cutoffStr, refDateStr).catch(() => ({ contextBlock: '' })),
    buildCompetencySystemPrompt(officerRole),
  ]);

  const contextSection = contextBlock
    ? `\nHere is the officer's recent performance data for additional context:\n\n${contextBlock}\n\n`
    : '';

  const prompt = `For each of the 6 CPF Auditmate performance indicators below, write ONE concise sentence (max 20 words) describing what the trend means for the officer's development.
${contextSection}
Indicator statistics:
${lines}

Return ONLY a JSON array of 6 objects in the same order:
[{"name":"Courtesy","text":"...","improving":true},...]`;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [
          { role: 'system', content: sysPrompt + ' Respond with valid JSON only — no markdown, no extra text.' },
          { role: 'user',   content: prompt },
        ],
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const raw  = data.choices[0].message.content.trim();
    const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    await AiCache.create({ ...cacheKey, content: parsed }).catch(() => {});
    return parsed;
  } catch (err) {
    console.error('Radar insights error:', err);
    return null;
  }
}

/* ── GET /api/radar ──────────────────────────────────────────── */
router.get('/', requireAuth, async (req, res) => {
  try {
    const officerId = await resolveOfficerId(req);
    if (!officerId) return res.status(403).json({ error: 'Access denied.' });

    const allRecords = await AuditRecord.find({ officerId }).sort({ uploadDate: 1 }).lean();

    if (!allRecords.length) {
      return res.json({
        hasData: false,
        radarData:        RADAR_INDICATORS.map(i => ({ subject: i.name, current: 0, predicted: 0 })),
        indicatorDetails: RADAR_INDICATORS.map(i => ({ name: i.name, current: null, weekChange: null, monthChange: null, trend: 'flat' })),
        insights: null,
      });
    }

    // Fix 4: use latest upload date as reference, not calendar today
    const refDateStr = allRecords[allRecords.length - 1].uploadDate;
    console.log(`[radarData] Reference date: ${refDateStr} | Officer: ${officerId}`);

    // Fix 1: rolling windows anchored to referenceDate
    const thirtyAgoStr   = addDays(refDateStr, -29);  // current 30-day window start
    const thisWeekStart  = addDays(refDateStr, -6);   // last 7 days (inclusive)
    const lastWeekEnd    = addDays(refDateStr, -7);   // day before thisWeekStart
    const lastWeekStart  = addDays(refDateStr, -13);  // 7 days before lastWeekEnd (inclusive)
    const thisMonthStart = addDays(refDateStr, -29);  // last 30 days (same as thirtyAgoStr)
    const lastMonthEnd   = addDays(refDateStr, -30);  // day before thisMonthStart
    const lastMonthStart = addDays(refDateStr, -59);  // 30 days before lastMonthEnd

    const last30Recs    = allRecords.filter(r => r.uploadDate >= thirtyAgoStr  && r.uploadDate <= refDateStr);
    const thisWeekRecs  = allRecords.filter(r => r.uploadDate >= thisWeekStart  && r.uploadDate <= refDateStr);
    const lastWeekRecs  = allRecords.filter(r => r.uploadDate >= lastWeekStart  && r.uploadDate <= lastWeekEnd);
    const thisMonthRecs = allRecords.filter(r => r.uploadDate >= thisMonthStart && r.uploadDate <= refDateStr);
    const lastMonthRecs = allRecords.filter(r => r.uploadDate >= lastMonthStart && r.uploadDate <= lastMonthEnd);

    // Fix 5: gap-fill comparison periods when empty
    const lastWeekRecsF  = gapFillPeriod(lastWeekRecs,  lastWeekEnd,   allRecords, thisWeekStart,  14);
    const lastMonthRecsF = gapFillPeriod(lastMonthRecs, lastMonthEnd,  allRecords, thisMonthStart, 30);

    // Build date-grouped history for trend projection
    const byDate = {};
    for (const r of allRecords) {
      if (!byDate[r.uploadDate]) byDate[r.uploadDate] = [];
      byDate[r.uploadDate].push(r);
    }

    const indicatorData = RADAR_INDICATORS.map(({ name, keys }) => {
      const current    = avgForIndicator(last30Recs, keys);
      const weekCur    = avgForIndicator(thisWeekRecs, keys);
      const weekPrev   = avgForIndicator(lastWeekRecsF, keys);
      const monthCur   = avgForIndicator(thisMonthRecs, keys);
      const monthPrev  = avgForIndicator(lastMonthRecsF, keys);

      const history = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, recs]) => ({ date, avg: avgForIndicator(recs, keys) }))
        .filter(h => h.avg !== null);

      // Fix 2+3: projectIndicator returns { predicted, rawDailyChange }
      const { predicted, rawDailyChange } = projectIndicator(history, current);
      const weekChange  = weekCur != null && weekPrev != null ? +(weekCur - weekPrev).toFixed(1) : null;
      const monthChange = monthCur != null && monthPrev != null ? +(monthCur - monthPrev).toFixed(1) : null;

      // Fix 3: trend from rawDailyChange threshold, not predicted-vs-current
      const trend = rawDailyChange > 0.05 ? 'up' : rawDailyChange < -0.05 ? 'down' : 'flat';

      return { name, current, predicted, weekChange, monthChange, trend };
    });

    const radarData = indicatorData.map(i => ({
      subject:   i.name,
      current:   i.current   != null ? Math.round(i.current)   : 0,
      predicted: i.predicted != null ? Math.round(i.predicted) : 0,
    }));

    const indicatorDetails = indicatorData.map(i => ({
      name: i.name, current: i.current,
      weekChange: i.weekChange, monthChange: i.monthChange, trend: i.trend,
    }));

    const insights = await fetchInsights(indicatorData, isoWeekKey(refDateStr), officerId, refDateStr);

    res.json({ hasData: true, radarData, indicatorDetails, insights, referenceDate: refDateStr });
  } catch (err) {
    console.error('Radar error:', err);
    res.status(500).json({ error: 'Failed to load radar data.' });
  }
});

export default router;
