import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import AuditRecord from '../models/AuditRecord.js';
import EssRecord from '../models/EssRecord.js';
import AiCache from '../models/AiCache.js';
import CompetencyOverride from '../models/CompetencyOverride.js';
import { fetchParsedContext } from '../utils/fetchParsedContext.js';
import { buildCompetencySystemPrompt } from '../utils/getCompetencyContext.js';

const router = Router();
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SKIP = new Set(['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt']);

/* ── 6 CPF competency names ───────────────────────────────────── */
const COMPETENCY_NAMES = [
  'Thinking Clearly & Sound Judgements',
  'Working as a Team',
  'Working with Citizens & Stakeholders',
  'Keep Learning & Skills into Action',
  'Improving & Innovating Continuously',
  'Serving with Heart & Purpose',
];

/* ── 10 auditmate indicators ─────────────────────────────────── */
const INDICATORS = [
  { name: 'Courtesy',               keys: ['courtesy'] },
  { name: 'Confidentiality',        keys: ['confidential'] },
  { name: 'Comprehend Intent',      keys: ['comprehend'] },
  { name: 'Email SOG Compliance',   keys: ['comply', 'sog', 'email'] },
  { name: 'Correct Information',    keys: ['correct'] },
  { name: 'Complete Information',   keys: ['complete'] },
  { name: 'Clear and Easy',         keys: ['clear'] },
  { name: 'Meaningful Conversations',keys: ['meaningful', 'conversation'] },
  { name: 'Cultivate Digital',      keys: ['cultivate', 'digital'] },
  { name: 'Verified Mistake',       keys: ['verified', 'mistake'] },
];

/* ── field helpers ────────────────────────────────────────────── */
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
    if (keywords.some(kw => k.toLowerCase().includes(kw))) {
      const p = parsePassFail(v); if (p !== null) return p;
    }
  }
  return null;
}

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

function extractEssRating(record) {
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('rating') || low.includes('satisfaction') || low.includes('ess') || low.includes('score')) {
      const n = parseFloat(String(v ?? ''));
      if (!isNaN(n) && n >= 1 && n <= 5) return n;
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const n = parseFloat(String(v ?? ''));
    if (!isNaN(n) && n >= 1 && n <= 5) return n;
  }
  return null;
}

function scoreToLevel(s) {
  if (s == null) return null;
  if (s >= 80) return 3; if (s >= 60) return 2; return 1;
}

function levelToPercent(l) {
  if (l === 3) return 100; if (l === 2) return 66; if (l === 1) return 33; return 0;
}

function fmt(d) { return d.toISOString().slice(0, 10); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

/** Add n days (positive or negative) to a YYYY-MM-DD string. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ── compute basic stats for one officer ─────────────────────── */
async function computeBasicStats(officerId) {
  // Fix 4: anchor windows to latest upload date
  const latestRec = await AuditRecord.findOne({ officerId }).sort({ uploadDate: -1 }).lean();
  if (!latestRec) return { score: null, monthChange: null, level: null, compScore: 0 };

  const refDateStr = latestRec.uploadDate;
  const d30agoStr  = addDays(refDateStr, -30);
  const d60agoStr  = addDays(refDateStr, -60);

  const [cur, prev] = await Promise.all([
    AuditRecord.find({ officerId, uploadDate: { $gte: d30agoStr, $lte: refDateStr  } }).lean(),
    AuditRecord.find({ officerId, uploadDate: { $gte: d60agoStr, $lt:  d30agoStr   } }).lean(),
  ]);

  const curScores  = cur.map(extractTotal).filter(s => s !== null);
  const prevScores = prev.map(extractTotal).filter(s => s !== null);
  const score      = avg(curScores);
  const prevScore  = avg(prevScores);
  const monthChange = score !== null && prevScore !== null ? +(score - prevScore).toFixed(1) : null;
  const level      = scoreToLevel(score);
  const compScore  = levelToPercent(level);

  return { score: score !== null ? +score.toFixed(1) : null, monthChange, level, compScore };
}

/* ── compute full officer detail ─────────────────────────────── */
async function computeOfficerDetail(officerId, officerName, officerRole) {
  // Fix 4: anchor windows to latest upload date
  const allAudit = await AuditRecord.find({ officerId }).sort({ uploadDate: 1 }).lean();
  const refDateStr = allAudit.length ? allAudit[allAudit.length - 1].uploadDate : null;
  const d30agoStr  = refDateStr ? addDays(refDateStr, -30) : null;
  const d60agoStr  = refDateStr ? addDays(refDateStr, -60) : null;

  const [essRecs, overrideDoc] = await Promise.all([
    refDateStr
      ? EssRecord.find({ officerId, uploadDate: { $gte: d30agoStr, $lte: refDateStr } }).lean()
      : Promise.resolve([]),
    CompetencyOverride.findOne({ officerId }).lean(),
  ]);

  const last30Audit = refDateStr ? allAudit.filter(r => r.uploadDate >= d30agoStr && r.uploadDate <= refDateStr) : [];
  const prev30Audit = refDateStr ? allAudit.filter(r => r.uploadDate >= d60agoStr && r.uploadDate < d30agoStr)  : [];

  const curScores  = last30Audit.map(extractTotal).filter(s => s !== null);
  const prevScores = prev30Audit.map(extractTotal).filter(s => s !== null);
  const score      = avg(curScores);
  const prevScore  = avg(prevScores);
  const monthChange = score !== null && prevScore !== null ? +(score - prevScore).toFixed(1) : null;
  const level      = scoreToLevel(score);

  // Group by upload date for alert computation
  const byDate = {};
  for (const r of allAudit) {
    if (!byDate[r.uploadDate]) byDate[r.uploadDate] = [];
    byDate[r.uploadDate].push(r);
  }
  const uploadDates = Object.keys(byDate).sort();
  const perDate = uploadDates.map(date => {
    const recs = byDate[date];
    const scores = recs.map(extractTotal).filter(s => s !== null);
    const ov = avg(scores);
    return { date, overall: ov, level: scoreToLevel(ov) };
  });
  const last3 = perDate.slice(-3);
  const latestDate = uploadDates[uploadDates.length - 1] ?? null;

  // ESS
  const essRatings = essRecs.map(extractEssRating).filter(r => r !== null);
  const essAvg = essRatings.length ? +(avg(essRatings).toFixed(1)) : null;

  // Competency levels (with overrides)
  const overrideLevels = overrideDoc?.levels ?? {};
  const competencies = COMPETENCY_NAMES.map((name, i) => {
    const overridden = overrideLevels[String(i)] != null;
    const lvl = overridden ? Number(overrideLevels[String(i)]) : (level ?? null);
    return { name, level: lvl, overridden };
  });
  const compLevels = competencies.map(c => c.level).filter(l => l !== null);
  const compScore  = compLevels.length
    ? Math.round(compLevels.reduce((a, l) => a + levelToPercent(l), 0) / compLevels.length)
    : null;

  // Quality indicators (last 30 days) with fractions
  const indicators = INDICATORS.map(({ name, keys }) => {
    let passed = 0, total = 0;
    for (const r of last30Audit) {
      const v = findIndicatorValue(r, keys);
      if (v === null) continue;
      total++;
      if (v >= 0.5) passed++;
    }
    return { name, passed, total, avg: total > 0 ? Math.round((passed / total) * 100) : null };
  });

  // Alerts (critical + development only)
  const critical = [], development = [];

  if (last3.length >= 3) {
    const allLow = last3.every(d => d.overall !== null && d.overall < 60);
    if (allLow) critical.push({ title: 'Persistent Low Score', message: `Performance below 60% for ${last3.length} consecutive uploads. Urgent coaching needed.` });

    const stalledCount = COMPETENCY_NAMES.filter(() => {
      const lvls = last3.map(d => d.level).filter(l => l !== null);
      return lvls.length >= 3 && lvls[0] === lvls[lvls.length - 1] && lvls[0] !== 3;
    }).length;
    if (stalledCount >= 3) critical.push({ title: 'Competency Development Stalled', message: `${stalledCount} competencies showing no progression over ${last3.length} uploads.` });
  }
  if (latestDate) {
    const latestRecs = byDate[latestDate] ?? [];
    const zeroCompliance = [INDICATORS[3], INDICATORS[9]].filter(ind => {
      const vals = latestRecs.map(r => findIndicatorValue(r, ind.keys)).filter(v => v !== null);
      return vals.length > 0 && avg(vals) === 0;
    });
    if (zeroCompliance.length) critical.push({ title: 'Critical Compliance Gap', message: `${zeroCompliance.map(i => i.name).join(', ')} at 0% in latest upload.` });
  }
  if (essAvg !== null && essAvg < 2.0) critical.push({ title: 'ESS Critical', message: `Member satisfaction at ${essAvg}/5. Immediate review required.` });

  if (last3.length >= 3) {
    INDICATORS.forEach(ind => {
      const vals = last3.map(d => {
        const recs = byDate[d.date] ?? [];
        const v = avg(recs.map(r => findIndicatorValue(r, ind.keys)).filter(v => v !== null));
        return v;
      }).filter(v => v !== null);
      if (vals.length >= 3 && vals[2] < vals[1] && vals[1] < vals[0]) {
        development.push({ title: 'Declining Indicator', message: `${ind.name} consistently declining over last ${vals.length} uploads.` });
      }
    });
    const stalledInt = COMPETENCY_NAMES.filter(() => {
      const lvls = last3.map(d => d.level).filter(l => l !== null);
      return lvls.length >= 3 && lvls.every(l => l === 2);
    }).length;
    if (stalledInt >= 2) development.push({ title: 'Intermediate Plateau', message: `${stalledInt} competencies stuck at Intermediate level.` });
  }
  if (essAvg !== null && essAvg >= 2.0 && essAvg < 3.0) {
    development.push({ title: 'Low ESS Warning', message: `Member satisfaction at ${essAvg}/5. Review response quality.` });
  }

  // AI Summary (cached per officer + latestDate)
  let summary = null;
  const cacheKey = { officerId, uploadDate: latestDate ?? 'none', competencyIndex: 98, type: 'officer-summary' };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) {
    summary = cached.content;
  } else if (process.env.OPENROUTER_API_KEY) {
    // Fetch parsed context for richer summary
    const { contextBlock } = await fetchParsedContext(officerId, d30agoStr ?? '', refDateStr ?? '').catch(() => ({ contextBlock: '' }));

    const levelNames = ['', 'Basic', 'Intermediate', 'Advanced'];
    const statsSummary = [
      `Overall score: ${score != null ? score.toFixed(1) + '%' : 'No data'}`,
      `Competency levels: ${competencies.map(c => `${c.name}: ${levelNames[c.level ?? 0] ?? 'N/A'}`).join(', ')}`,
      `Active alerts: ${critical.length} critical, ${development.length} development`,
      `ESS average: ${essAvg != null ? essAvg + '/5' : 'No data'}`,
      `Month change: ${monthChange != null ? (monthChange >= 0 ? '+' : '') + monthChange + '%' : 'N/A'}`,
    ].join('\n');

    const contextSection = contextBlock
      ? `\nHere is the officer's recent performance data:\n\n${contextBlock}\n\n`
      : '';

    const prompt = `Write a concise 3-4 sentence performance summary for a CPF officer named ${officerName} (${officerRole}).

Key statistics:
${statsSummary}
${contextSection}
Write naturally, referring to the officer by first name. Be specific about strengths and gaps, citing examples from the performance data where available. End with a note about trajectory.`;

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-4o',
          messages: [
            { role: 'system', content: await buildCompetencySystemPrompt(officerRole) + ' Write a concise, data-driven officer summary in plain prose.' },
            { role: 'user',   content: prompt },
          ],
          max_tokens: 250,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        summary = data.choices[0].message.content.trim();
        await AiCache.create({ ...cacheKey, content: summary }).catch(() => {});
      }
    } catch (e) { console.error('Summary AI error:', e); }
  }

  return {
    id: officerId, name: officerName, role: officerRole,
    score: score !== null ? +score.toFixed(1) : null,
    monthChange, level, compScore,
    competencies, indicators, essAvg,
    alerts: { critical, development },
    alertCount: critical.length + development.length,
    summary, latestDate,
    hasData: allAudit.length > 0,
  };
}

/* ── permission helpers ───────────────────────────────────────── */
function requireTLOrSupervisor(req, res, next) {
  if (!['TL', 'Supervisor'].includes(req.user.role))
    return res.status(403).json({ error: 'Access restricted to TL and Supervisor.' });
  next();
}

async function canViewOfficer(requester, targetId) {
  if (requester.role === 'Supervisor') return true;
  if (requester.role === 'TL') {
    const t = await User.findById(targetId).lean();
    return t?.role === 'CSO';
  }
  return false;
}

/* ── GET /api/team-overview/members ─────────────────────────── */
router.get('/members', requireAuth, requireTLOrSupervisor, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'TL') filter = { role: 'CSO' };
    else filter = { role: { $in: ['CSO', 'TL'] } };

    const users = await User.find(filter, '_id name role').lean();
    const withStats = await Promise.all(users.map(async u => {
      const stats = await computeBasicStats(String(u._id));
      return { id: String(u._id), name: u.name, role: u.role, ...stats };
    }));

    res.json(withStats);
  } catch (err) {
    console.error('Team members error:', err);
    res.status(500).json({ error: 'Failed to load team members.' });
  }
});

/* ── GET /api/team-overview/officer/:id ─────────────────────── */
router.get('/officer/:id', requireAuth, requireTLOrSupervisor, async (req, res) => {
  try {
    const { id } = req.params;
    if (!await canViewOfficer(req.user, id))
      return res.status(403).json({ error: 'Access denied.' });

    const officer = await User.findById(id, '_id name role').lean();
    if (!officer) return res.status(404).json({ error: 'Officer not found.' });

    const detail = await computeOfficerDetail(String(officer._id), officer.name, officer.role);
    res.json(detail);
  } catch (err) {
    console.error('Officer detail error:', err);
    res.status(500).json({ error: 'Failed to load officer data.' });
  }
});

/* ── POST /api/team-overview/override ───────────────────────── */
router.post('/override', requireAuth, async (req, res) => {
  if (req.user.role !== 'Supervisor')
    return res.status(403).json({ error: 'Only Supervisors can override competency levels.' });

  const { officerId, levels } = req.body;
  if (!officerId || !levels || typeof levels !== 'object')
    return res.status(400).json({ error: 'officerId and levels object required.' });

  try {
    await CompetencyOverride.findOneAndUpdate(
      { officerId },
      { officerId, levels, overriddenBy: req.user.id, overriddenByName: req.user.name },
      { upsert: true, new: true }
    );
    // Invalidate cached summary for this officer
    await AiCache.deleteMany({ officerId, competencyIndex: 98, type: 'officer-summary' });
    res.json({ success: true });
  } catch (err) {
    console.error('Override error:', err);
    res.status(500).json({ error: 'Failed to save override.' });
  }
});

export default router;
