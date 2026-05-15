import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import AuditRecord from '../models/AuditRecord.js';
import EssRecord from '../models/EssRecord.js';
import User from '../models/User.js';

const router = Router();
const SKIP = new Set(['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt']);

/* ── field extraction helpers ─────────────────────────────────── */
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

function avgIndicator(records, keywords) {
  const vals = records.map(r => findIndicatorValue(r, keywords)).filter(v => v !== null);
  if (!vals.length) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
}

/** Extract overall 0-100 total score from a record. */
function extractTotal(record) {
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if ((low.includes('total') || low.includes('score') || low.includes('percentage') || low === '%') && !low.includes('indicator')) {
      const n = parseFloat(String(v ?? '').replace('%', ''));
      if (!isNaN(n) && n >= 0 && n <= 100) return n;
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    if (k.toLowerCase().includes('indicator')) continue;
    const n = parseFloat(String(v ?? ''));
    if (!isNaN(n) && n >= 0 && n <= 100) return n;
  }
  return null;
}

/** Extract ESS rating (1–5) from a record. */
function extractEssRating(record) {
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('rating') || low.includes('satisfaction') || low.includes('score') || low.includes('ess')) {
      const n = parseFloat(String(v ?? ''));
      if (!isNaN(n) && n >= 1 && n <= 5) return n;
    }
  }
  // fallback: any numeric 1–5 field
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const n = parseFloat(String(v ?? ''));
    if (!isNaN(n) && n >= 1 && n <= 5) return n;
  }
  return null;
}

function scoreToLevel(score) {
  if (score == null) return null;
  if (score >= 80) return 3;
  if (score >= 60) return 2;
  return 1;
}

function fmt(d) { return d.toISOString().slice(0, 10); }

/** Add n days (positive or negative) to a YYYY-MM-DD string. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Permission check mirror from other routes. */
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

/* ── 10 Auditmate indicators ──────────────────────────────────── */
const INDICATORS = [
  { name: 'Courtesy',                    keys: ['courtesy'] },
  { name: 'Confidentiality',             keys: ['confidential'] },
  { name: 'Comprehend Intent',           keys: ['comprehend'] },           // indicator 3
  { name: 'Email SOG Compliance',        keys: ['comply', 'sog', 'email'] }, // indicator 4
  { name: 'Correct Information',         keys: ['correct'] },
  { name: 'Complete Information',        keys: ['complete'] },
  { name: 'Clear and Easy',              keys: ['clear'] },
  { name: 'Meaningful Conversations',    keys: ['meaningful', 'conversation'] },
  { name: 'Cultivate Digital Awareness', keys: ['cultivate', 'digital'] },
  { name: 'Verified Mistake',            keys: ['verified', 'mistake'] },  // indicator 10
];

/* ── 6 CPF competency names (for messaging) ───────────────────── */
const COMPETENCY_NAMES = [
  'Thinking Clearly and Making Sound Judgements',
  'Working as a Team',
  'Working Effectively with Citizens and Stakeholders',
  'Keep Learning and Putting Skills into Action',
  'Improving and Innovating Continuously',
  'Serving with Heart, Commitment and Purpose',
];

/* ── main route ───────────────────────────────────────────────── */
router.get('/', requireAuth, async (req, res) => {
  try {
    const officerId = await resolveOfficerId(req);
    if (!officerId) return res.status(403).json({ error: 'Access denied.' });

    // Fix 4: fetch audit first to determine reference date, then fetch ESS in correct window
    const allAudit = await AuditRecord.find({ officerId }).sort({ uploadDate: 1 }).lean();
    const refDateStr = allAudit.length ? allAudit[allAudit.length - 1].uploadDate : null;

    if (!refDateStr) {
      return res.json({
        critical: [], development: [], positive: [],
        counts: { critical: 0, development: 0, positive: 0 },
        hasData: false, uploadCount: 0, essAvg: null,
      });
    }

    const thirtyAgoStr = addDays(refDateStr, -30);
    const essRecords = await EssRecord.find({
      officerId, uploadDate: { $gte: thirtyAgoStr, $lte: refDateStr },
    }).lean();

    /* ── group auditmate by upload date (sorted oldest→newest) ── */
    const byDate = {};
    for (const r of allAudit) {
      if (!byDate[r.uploadDate]) byDate[r.uploadDate] = [];
      byDate[r.uploadDate].push(r);
    }
    const uploadDates = Object.keys(byDate).sort(); // oldest → newest

    /* per-date aggregate: overall avg and per-indicator avgs */
    const perDate = uploadDates.map(date => {
      const recs = byDate[date];
      const scores = recs.map(extractTotal).filter(s => s !== null);
      const overall = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const level   = scoreToLevel(overall);
      const indicators = INDICATORS.map(ind => ({
        name: ind.name,
        avg:  avgIndicator(recs, ind.keys),
      }));
      return { date, overall, level, indicators };
    });

    const last3 = perDate.slice(-3);           // last 3 uploads
    const latestUpload = perDate[perDate.length - 1] ?? null;

    /* ── ESS average ── */
    const essRatings = essRecords.map(extractEssRating).filter(r => r !== null);
    const essAvg = essRatings.length
      ? Math.round((essRatings.reduce((a, b) => a + b, 0) / essRatings.length) * 10) / 10
      : null;

    const critical    = [];
    const development = [];
    const positive    = [];

    /* ═══════════════════════════════════════════
       CRITICAL ALERTS
    ═══════════════════════════════════════════ */

    // 1. Competency Development Stalled: 3+ competencies with no level progression in last 3+ uploads
    if (perDate.length >= 3) {
      // Use overall level (same score → level mapping applied per-upload)
      // "No progression" = level at last upload === level at first of last 3 uploads
      const stalled = COMPETENCY_NAMES.filter((_, ci) => {
        // For competencies we use overall level (all competencies share the same total score)
        // so "stalled" means level hasn't changed across last 3 uploads
        const levels = last3.map(d => d.level).filter(l => l !== null);
        return levels.length >= 3 && levels[0] === levels[levels.length - 1] && levels[0] !== 3;
      });
      if (stalled.length >= 3) {
        critical.push({
          type: 'stalled',
          title: 'Competency Development Stalled',
          message: `${stalled.length} competencies showing no progression over ${last3.length} uploads. Review learning opportunities and coaching effectiveness.`,
        });
      }
    }

    // 2. Critical Compliance Gaps: Indicator 4 (Email SOG) or 10 (Verified Mistake) at 0% in latest upload
    if (latestUpload) {
      const complianceIndicators = [INDICATORS[3], INDICATORS[9]]; // indices 3 and 9
      const zeroed = complianceIndicators
        .filter(ind => {
          const val = latestUpload.indicators.find(i => i.name === ind.name)?.avg;
          return val !== null && val === 0;
        })
        .map(ind => ind.name);
      if (zeroed.length) {
        critical.push({
          type: 'compliance',
          title: 'Critical Compliance Gaps',
          message: `Mandatory compliance indicators not met: ${zeroed.join(', ')}. Immediate remediation needed.`,
        });
      }
    }

    // 3. Persistent Low Score: overall < 60% for 3+ consecutive uploads
    if (last3.length >= 3) {
      const allLow = last3.every(d => d.overall !== null && d.overall < 60);
      if (allLow) {
        critical.push({
          type: 'persistent_low',
          title: 'Persistent Low Score',
          message: `Overall performance below 60% threshold for ${last3.length} consecutive uploads. Urgent coaching intervention required.`,
        });
      }
    }

    // 4. ESS Critical: avg < 2.0
    if (essAvg !== null && essAvg < 2.0) {
      critical.push({
        type: 'ess_critical',
        title: 'ESS Critical',
        message: `Member satisfaction critically low at ${essAvg}/5. Immediate review of correspondence quality required.`,
      });
    }

    /* ═══════════════════════════════════════════
       DEVELOPMENT OPPORTUNITIES
    ═══════════════════════════════════════════ */

    // 1. Intermediate Plateau: 2+ competencies stuck at level 2 for 3+ uploads
    if (perDate.length >= 3) {
      const stalledIntermediate = COMPETENCY_NAMES.filter(() => {
        const levels = last3.map(d => d.level).filter(l => l !== null);
        return levels.length >= 3 && levels.every(l => l === 2);
      });
      if (stalledIntermediate.length >= 2) {
        development.push({
          type: 'intermediate_plateau',
          title: 'Intermediate Plateau',
          message: `${stalledIntermediate.length} competencies stuck at Intermediate level. Advanced training or stretch assignments recommended.`,
        });
      }
    }

    // 2. Declining Indicator: any indicator showing consistent downward trend over last 3 uploads
    if (last3.length >= 3) {
      INDICATORS.forEach(ind => {
        const vals = last3.map(d => d.indicators.find(i => i.name === ind.name)?.avg).filter(v => v !== null);
        if (vals.length >= 3 && vals[2] < vals[1] && vals[1] < vals[0]) {
          development.push({
            type: `declining_${ind.name}`,
            title: 'Declining Indicator',
            message: `${ind.name} score declining over last ${vals.length} uploads. Targeted practice recommended.`,
          });
        }
      });
    }

    // 3. Low ESS Warning: avg between 2.0 and 3.0
    if (essAvg !== null && essAvg >= 2.0 && essAvg < 3.0) {
      development.push({
        type: 'low_ess',
        title: 'Low ESS Warning',
        message: `Member satisfaction below benchmark at ${essAvg}/5. Review tone and completeness of responses.`,
      });
    }

    // 4. Stagnant Comprehension: Indicator 3 (Comprehend) below 50% consistently in last 3
    if (last3.length >= 3) {
      const comprehendVals = last3
        .map(d => d.indicators.find(i => i.name === 'Comprehend Intent')?.avg)
        .filter(v => v !== null);
      if (comprehendVals.length >= 3 && comprehendVals.every(v => v < 50)) {
        development.push({
          type: 'stagnant_comprehension',
          title: 'Stagnant Comprehension',
          message: `Customer intent comprehension consistently below 50%. Consider reviewing case studies and member query patterns.`,
        });
      }
    }

    /* ═══════════════════════════════════════════
       POSITIVE SIGNALS
    ═══════════════════════════════════════════ */

    // 1. Consistent High Performance: overall > 80% for last 3+ uploads
    if (last3.length >= 3) {
      const allHigh = last3.every(d => d.overall !== null && d.overall > 80);
      if (allHigh) {
        positive.push({
          type: 'consistent_high',
          title: 'Consistent High Performance',
          message: `Consistently strong performance above 80% benchmark. Officer on track for Advanced progression.`,
        });
      }
    }

    // 2. Advancing Competency: level moved up in last 3 uploads
    if (last3.length >= 3) {
      const firstLevel = last3[0].level;
      const lastLevel  = last3[last3.length - 1].level;
      if (firstLevel !== null && lastLevel !== null && lastLevel > firstLevel) {
        const levelNames = ['', 'Basic', 'Intermediate', 'Advanced'];
        positive.push({
          type: 'advancing',
          title: 'Advancing Competency',
          message: `Overall competency progressed from ${levelNames[firstLevel]} to ${levelNames[lastLevel]}. Strong development momentum.`,
        });
      }
    }

    // 3. High ESS Rating: avg >= 4.0
    if (essAvg !== null && essAvg >= 4.0) {
      positive.push({
        type: 'high_ess',
        title: 'High ESS Rating',
        message: `Member satisfaction strong at ${essAvg}/5. Correspondence quality well-received.`,
      });
    }

    // 4. Indicator Mastery: any indicator at 100% across last 3 uploads
    if (last3.length >= 3) {
      INDICATORS.forEach(ind => {
        const vals = last3.map(d => d.indicators.find(i => i.name === ind.name)?.avg).filter(v => v !== null);
        if (vals.length >= 3 && vals.every(v => v >= 99.9)) {
          positive.push({
            type: `mastery_${ind.name}`,
            title: 'Indicator Mastery',
            message: `${ind.name} at full marks consistently. Exemplary performance in this area.`,
          });
        }
      });
    }

    res.json({
      critical,
      development,
      positive,
      counts: { critical: critical.length, development: development.length, positive: positive.length },
      hasData: allAudit.length > 0,
      uploadCount: uploadDates.length,
      essAvg,
    });
  } catch (err) {
    console.error('FlagsAlerts error:', err);
    res.status(500).json({ error: 'Failed to load flags data.' });
  }
});

export default router;
