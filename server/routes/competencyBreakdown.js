import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import AuditRecord from '../models/AuditRecord.js';
import EssRecord from '../models/EssRecord.js';
import User from '../models/User.js';
import CompetencyFramework from '../models/CompetencyFramework.js';
import AiCache from '../models/AiCache.js';
import { fetchParsedContext } from '../utils/fetchParsedContext.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = 'openai/gpt-4o';

async function callAI(systemPrompt, userPrompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

const AI_SCORING_SYS_PROMPT = "You are a CPF performance evaluator. You will be given an officer's performance data from three sources and the definition of a specific competency. Score the officer's performance on that competency from 0 to 100 based on the evidence provided.";

const router = Router();

const SKIP = new Set(['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt']);

/** Add n days (positive or negative) to a YYYY-MM-DD string. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const fmt = d => d.toISOString().slice(0, 10);


/* ── Core competency → indicator keyword mapping (index 0-5) ─── */
const CORE_INDICATORS = [
  { label: 'Thinking Clearly and Making Sound Judgements',       keys: ['courtesy'] },
  { label: 'Working as a team',                                  keys: ['comprehend'] },
  { label: 'Working effectively with citizens and stakeholders', keys: ['correct'] },
  { label: 'Keep learning and putting skills into action',       keys: ['complete'] },
  { label: 'Improving and innovating continuously',              keys: ['clear'] },
  { label: 'Serving with heart, commitment and purpose',         keys: ['meaningful', 'conversation'] },
];

/* ── 5 Correspondence competencies with mapped Auditmate indicators ── */
const CORRESPONDENCE_COMPS = [
  {
    name: 'Empathetic Writing',
    indicatorGroups: [
      { label: 'Courtesy',                  keys: ['courtesy'] },
      { label: 'Meaningful Conversations',  keys: ['meaningful', 'conversation'] },
    ],
    essSupport: true,
  },
  {
    name: 'Direct Reply',
    indicatorGroups: [
      { label: 'Clear and Easy',            keys: ['clear'] },
      { label: 'Complete Information',      keys: ['complete'] },
      { label: 'Email SOG Compliance',      keys: ['comply', 'sog'] },
    ],
    essSupport: false,
  },
  {
    name: 'Active Listening',
    indicatorGroups: [
      { label: 'Comprehend Intent',         keys: ['comprehend'] },
      { label: 'Complete Information',      keys: ['complete'] },
    ],
    essSupport: false,
  },
  {
    name: 'Customer Obsessed',
    indicatorGroups: [
      { label: 'Courtesy',                  keys: ['courtesy'] },
      { label: 'Meaningful Conversations',  keys: ['meaningful', 'conversation'] },
      { label: 'Correct Information',       keys: ['correct'] },
    ],
    essSupport: true,
  },
  {
    name: 'Problem Solving',
    indicatorGroups: [
      { label: 'Comprehend Intent',         keys: ['comprehend'] },
      { label: 'Correct Information',       keys: ['correct'] },
      { label: 'Complete Information',      keys: ['complete'] },
      { label: 'Cultivate Digital Awareness', keys: ['cultivate', 'digital'] },
    ],
    essSupport: false,
  },
];

/* ── helpers ────────────────────────────────────────────────────── */
function parsePassFail(val) {
  const s = String(val ?? '').toLowerCase().trim();
  if (['pass', 'yes', 'p', '1', 'true', 'passed', 'y'].includes(s)) return 1;
  if (['fail', 'no', 'f', '0', 'false', 'failed', 'n'].includes(s)) return 0;
  const n = parseFloat(s.replace('%', ''));
  if (!isNaN(n)) return n > 1 ? n / 100 : n;
  return null;
}

function indicatorPassRate(records, keys) {
  const vals = [];
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (SKIP.has(k)) continue;
      const low = k.toLowerCase();
      if (keys.some(kw => low.includes(kw))) {
        const p = parsePassFail(v);
        if (p !== null) { vals.push(p); break; }
      }
    }
  }
  if (!vals.length) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
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
    if (low.includes('rating') || low.includes('satisfaction') || low.includes('score') || low.includes('ess')) {
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

function scoreToLevel(score) {
  if (score == null) return null;
  if (score >= 80) return 3;
  if (score >= 60) return 2;
  return 1;
}

function deriveStatus(history) {
  if (!history.length) return 'Stagnant';
  const latest = history[history.length - 1];
  if (latest.level === 3 && latest.score >= 80) return 'Mastery';
  if (history.length >= 3) {
    const w = history.slice(-3);
    if (w[2].score > w[0].score && w[1].score >= w[0].score) return 'Advancing';
  }
  return 'Stagnant';
}

/** Derive status from an array of raw scores (not history objects). */
function deriveStatusFromScores(scores) {
  if (!scores.length) return 'Stagnant';
  const latest = scores[scores.length - 1];
  if (latest >= 80) {
    if (scores.length >= 2 && scores.every(s => s >= 80)) return 'Mastery';
  }
  if (scores.length >= 3) {
    const w = scores.slice(-3);
    if (w[2] > w[0] && w[1] >= w[0]) return 'Advancing';
  }
  return 'Stagnant';
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

/* ── GET /api/competency-breakdown ──────────────────────────────── */
router.get('/', requireAuth, async (req, res) => {
  try {
    const officerId = await resolveOfficerId(req);
    if (!officerId) return res.status(403).json({ error: 'Access denied.' });

    // Fix 4: anchor 30-day window to latest upload date, not calendar today
    const allRecords = await AuditRecord.find({ officerId }).sort({ uploadDate: 1 }).lean();
    if (!allRecords.length) {
      return res.json({
        officerId, history: [], currentLevel: null, currentScore: null, latestDate: null,
        status: 'Stagnant', recordCount: 0, indicators: [], competencyLevels: [],
        competencyStatuses: [], correspondenceCompetencies: [],
        correspondenceOverall: null, correspondenceLevel: null, correspondenceStatus: 'Stagnant',
        functionalCompetencies: [], functionalOverall: null, functionalLevel: null, functionalStatus: 'Stagnant',
        leadershipCompetencies: [], leadershipOverall: null, leadershipLevel: null, leadershipStatus: 'Stagnant',
      });
    }

    const windowEnd   = allRecords[allRecords.length - 1].uploadDate;
    const windowStart = addDays(windowEnd, -29);

    const essRecords = await EssRecord.find({
      officerId, uploadDate: { $gte: windowStart, $lte: windowEnd },
    }).lean();

    const recentRecords = allRecords.filter(r => r.uploadDate >= windowStart && r.uploadDate <= windowEnd);

    // Group recent records by date for per-date trend analysis
    const recentByDate = {};
    for (const r of recentRecords) {
      if (!recentByDate[r.uploadDate]) recentByDate[r.uploadDate] = [];
      recentByDate[r.uploadDate].push(r);
    }
    const recentSortedDates = Object.keys(recentByDate).sort();

    // ── ESS for supporting signal ──────────────────────────────────
    const essRatings = essRecords.map(extractEssRating).filter(v => v !== null);
    const essAvg30   = essRatings.length
      ? Math.round((essRatings.reduce((a, b) => a + b, 0) / essRatings.length) * 10) / 10
      : null;
    const essCount = essRatings.length;

    // ── Core competency levels ─────────────────────────────────────
    console.log(`\n[CompetencyBreakdown] 30-day window: ${windowStart} → ${windowEnd} (${recentRecords.length} records)`);
    const competencyLevels   = [];
    const competencyStatuses = [];

    for (let i = 0; i < CORE_INDICATORS.length; i++) {
      const { label, keys } = CORE_INDICATORS[i];
      const avg   = indicatorPassRate(recentRecords, keys);
      const level = scoreToLevel(avg);
      console.log(`[CompetencyBreakdown]   [${i}] ${label}: avg=${avg !== null ? avg.toFixed(1) : 'N/A'}% → level=${level ?? 'null'}`);
      competencyLevels.push(level);

      let compStatus = 'Stagnant';
      if (level === 3) {
        compStatus = 'Mastery';
      } else {
        const trendHistory = recentSortedDates
          .map(date => indicatorPassRate(recentByDate[date], keys))
          .filter(v => v !== null);
        if (trendHistory.length >= 3) {
          const w = trendHistory.slice(-3);
          if (w[2] > w[0] && w[1] >= w[0]) compStatus = 'Advancing';
        }
      }
      competencyStatuses.push(compStatus);
    }

    // ── Overall Core level from 30-day average total score ────────
    const totalScores = recentRecords.map(extractTotal).filter(s => s !== null);
    const overallAvg  = totalScores.length ? totalScores.reduce((a, b) => a + b, 0) / totalScores.length : null;
    console.log(`[CompetencyBreakdown] Overall 30-day avg: ${overallAvg !== null ? overallAvg.toFixed(1) : 'N/A'}%`);

    const currentLevel = scoreToLevel(overallAvg);
    const currentScore = overallAvg !== null ? Math.round(overallAvg * 10) / 10 : null;

    // Full history for trend chart
    const byDate = {};
    for (const r of allRecords) {
      const score = extractTotal(r);
      if (score === null) continue;
      if (!byDate[r.uploadDate]) byDate[r.uploadDate] = [];
      byDate[r.uploadDate].push(score);
    }
    const history = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, scores]) => {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        return { date, score: Math.round(avg * 10) / 10, level: scoreToLevel(avg) };
      });

    const recentHistory = history.filter(h => h.date >= windowStart && h.date <= windowEnd);
    const status = deriveStatus(recentHistory.length ? recentHistory : history);

    const latestDate = recentRecords.length
      ? recentRecords.reduce((best, r) => r.uploadDate > best ? r.uploadDate : best, '')
      : (history[history.length - 1]?.date ?? null);

    const indicatorMap = {};
    for (const r of recentRecords) {
      for (const [k, v] of Object.entries(r)) {
        if (SKIP.has(k)) continue;
        const n = parseFloat(String(v ?? '').replace('%', ''));
        if (!isNaN(n) && n >= 0 && n <= 100) {
          if (!indicatorMap[k]) indicatorMap[k] = [];
          indicatorMap[k].push(n);
        }
      }
    }
    const indicators = Object.entries(indicatorMap).map(([name, vals]) => ({
      name,
      avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    }));

    // ── Correspondence competency calculations ─────────────────────
    const correspondenceCompetencies = CORRESPONDENCE_COMPS.map((comp, idx) => {
      const indicatorScores = comp.indicatorGroups.map(ig => {
        const avg = indicatorPassRate(recentRecords, ig.keys);
        return { label: ig.label, avg: avg !== null ? Math.round(avg * 10) / 10 : null };
      });

      const validScores = indicatorScores.map(i => i.avg).filter(v => v !== null);
      const score = validScores.length
        ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10
        : null;
      const level = scoreToLevel(score);

      // Per-date scores for trend (last 3 upload dates)
      const dateScores = recentSortedDates.map(date => {
        const recs = recentByDate[date];
        const dayVals = comp.indicatorGroups
          .map(ig => indicatorPassRate(recs, ig.keys))
          .filter(v => v !== null);
        return dayVals.length ? dayVals.reduce((a, b) => a + b, 0) / dayVals.length : null;
      }).filter(v => v !== null);

      const compStatus = deriveStatusFromScores(dateScores);

      return {
        index: idx,
        name: comp.name,
        score,
        level,
        status: compStatus,
        indicatorScores,
        essSupport: comp.essSupport,
        essAvg:  comp.essSupport ? essAvg30  : null,
        essCount: comp.essSupport ? essCount : 0,
      };
    });

    // Overall correspondence score (avg of 5 competency scores)
    const validCorrScores = correspondenceCompetencies.map(c => c.score).filter(v => v !== null);
    const correspondenceOverall = validCorrScores.length
      ? Math.round((validCorrScores.reduce((a, b) => a + b, 0) / validCorrScores.length) * 10) / 10
      : null;
    const correspondenceLevel = scoreToLevel(correspondenceOverall);
    const corrStatuses = correspondenceCompetencies.map(c => c.status);
    const corrMastery   = corrStatuses.filter(s => s === 'Mastery').length;
    const corrAdvancing = corrStatuses.filter(s => s === 'Advancing').length;
    const correspondenceStatus = corrMastery >= 3 ? 'Mastery' : corrAdvancing >= 2 ? 'Advancing' : 'Stagnant';

    console.log(`[CompetencyBreakdown] Correspondence overall: ${correspondenceOverall ?? 'N/A'}% → level ${correspondenceLevel}\n`);

    // ── Functional & Leadership competency scoring (AI-based, 3 sources) ──
    const officerUser = await User.findById(officerId).lean().catch(() => null);
    const officerRoleStr = officerUser?.role ?? 'CSO';

    const [functionalFramework, leadershipFramework] = await Promise.all([
      CompetencyFramework.find({ role: officerRoleStr, competency_type: 'Functional'  }).sort({ sequence: 1 }).lean(),
      officerRoleStr === 'Supervisor'
        ? CompetencyFramework.find({ role: officerRoleStr, competency_type: 'Leadership' }).sort({ sequence: 1 }).lean()
        : Promise.resolve([]),
    ]);

    // Fetch parsed context once (all 3 sources) for AI scoring.
    // Use no date filter so we get all available data regardless of the audit window.
    const parsedCtx = await fetchParsedContext(officerId, '2000-01-01', new Date().toISOString().slice(0, 10))
      .catch(() => ({ auditmateSentences: [], interactionsSentences: [], essSentences: [] }));

    console.log(`[competencyBreakdown] ParsedContext for ${officerId}: auditmate=${parsedCtx.auditmateSentences.length}, interactions=${parsedCtx.interactionsSentences.length}, ess=${parsedCtx.essSentences.length}`);

    // All distinct upload dates for historical trend lookups
    const allUploadDatesSorted = [...new Set(allRecords.map(r => r.uploadDate))].sort();

    async function scoreOneComp(comp, compIndex, cacheType) {
      const cacheKey = { officerId, uploadDate: windowEnd, competencyIndex: compIndex, type: cacheType };
      const cached = await AiCache.findOne(cacheKey).lean().catch(() => null);
      if (cached) return cached.content;

      const { auditmateSentences, interactionsSentences, essSentences } = parsedCtx;
      if (!auditmateSentences.length && !interactionsSentences.length && !essSentences.length) {
        return { score: null, rationale: null };
      }

      const bulletText = (comp.bullet_points ?? []).map(b => `• ${b}`).join('\n') || '(none)';
      const userPrompt = `Competency: ${comp.name}
Description: ${comp.short_description ?? ''}
Behavioural indicators:
${bulletText}

Officer performance data:

Auditmate audit records (past 30 days):
${auditmateSentences.join('\n') || '(no data)'}

Member satisfaction feedback (past 30 days):
${essSentences.join('\n') || '(no data)'}

Officer interaction responses (past 30 days):
${interactionsSentences.join('\n') || '(no data)'}

Based on all three data sources, give a single overall score from 0 to 100 reflecting how well this officer demonstrates this competency. Consider all evidence holistically.

Return ONLY a JSON object: { "score": number, "rationale": string }
The rationale should be 1-2 sentences explaining the score.`;

      try {
        const raw = await callAI(AI_SCORING_SYS_PROMPT, userPrompt);
        const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        const parsed = JSON.parse(json);
        const content = {
          score: typeof parsed.score === 'number' ? Math.round(Math.min(100, Math.max(0, parsed.score)) * 10) / 10 : null,
          rationale: parsed.rationale ?? null,
        };
        await AiCache.create({ ...cacheKey, content }).catch(() => {});
        return content;
      } catch (err) {
        console.error(`[AI Score] ${comp.name}:`, err.message);
        return { score: null, rationale: null };
      }
    }

    async function getStatusForComp(compIndex, cacheType, currentScore) {
      const prevDates = allUploadDatesSorted.slice(-3, -1); // up to 2 dates before current
      const prevScores = await Promise.all(
        prevDates.map(date =>
          AiCache.findOne({ officerId, uploadDate: date, competencyIndex: compIndex, type: cacheType })
            .lean().catch(() => null)
            .then(doc => doc?.content?.score ?? null)
        )
      );
      const allScores = [...prevScores, currentScore].filter(s => s !== null);
      return deriveStatusFromScores(allScores);
    }

    // Score all functional competencies in parallel
    const functionalCompetencies = await Promise.all(
      functionalFramework.map(async (comp, i) => {
        const compIndex = 200 + (comp.sequence ?? i);
        const aiResult = await scoreOneComp(comp, compIndex, 'func-score');
        const score  = aiResult.score;
        const level  = scoreToLevel(score);
        const status = await getStatusForComp(compIndex, 'func-score', score);
        return {
          index: compIndex, name: comp.name,
          shortDescription: comp.short_description ?? '',
          bulletPoints: comp.bullet_points ?? [],
          score, level, status,
          rationale: aiResult.rationale,
        };
      })
    );

    // Score all leadership competencies in parallel
    const leadershipCompetencies = await Promise.all(
      leadershipFramework.map(async (comp, i) => {
        const compIndex = 300 + (comp.sequence ?? i);
        const aiResult = await scoreOneComp(comp, compIndex, 'lead-score');
        const score  = aiResult.score;
        const level  = scoreToLevel(score);
        const status = await getStatusForComp(compIndex, 'lead-score', score);
        return {
          index: compIndex, name: comp.name,
          shortDescription: comp.short_description ?? '',
          bulletPoints: comp.bullet_points ?? [],
          score, level, status,
          rationale: aiResult.rationale,
        };
      })
    );

    // Overall functional summary
    const validFuncScores = functionalCompetencies.map(c => c.score).filter(v => v !== null);
    const funcOverall = validFuncScores.length
      ? Math.round((validFuncScores.reduce((a, b) => a + b, 0) / validFuncScores.length) * 10) / 10
      : null;
    const funcLevel = scoreToLevel(funcOverall);
    const funcStatuses = functionalCompetencies.map(c => c.status);
    const functionalStatus = funcStatuses.filter(s => s === 'Mastery').length >= 3 ? 'Mastery'
      : funcStatuses.filter(s => s === 'Advancing').length >= 2 ? 'Advancing' : 'Stagnant';

    // Overall leadership summary
    const validLeadScores = leadershipCompetencies.map(c => c.score).filter(v => v !== null);
    const leadershipOverall = validLeadScores.length
      ? Math.round((validLeadScores.reduce((a, b) => a + b, 0) / validLeadScores.length) * 10) / 10
      : null;
    const leadershipLevel = scoreToLevel(leadershipOverall);
    const leadStatuses = leadershipCompetencies.map(c => c.status);
    const leadershipStatus = leadStatuses.filter(s => s === 'Mastery').length >= 2 ? 'Mastery'
      : leadStatuses.filter(s => s === 'Advancing').length >= 1 ? 'Advancing' : 'Stagnant';

    console.log('[competencyBreakdown] Functional competencies response:', JSON.stringify(functionalCompetencies, null, 2));

    res.json({
      officerId,
      history,
      currentLevel,
      currentScore,
      latestDate,
      status,
      recordCount:          recentRecords.length,
      indicators,
      competencyLevels,
      competencyStatuses,
      correspondenceCompetencies,
      correspondenceOverall,
      correspondenceLevel,
      correspondenceStatus,
      functionalCompetencies,
      functionalOverall: funcOverall,
      functionalLevel:   funcLevel,
      functionalStatus,
      leadershipCompetencies,
      leadershipOverall,
      leadershipLevel,
      leadershipStatus,
    });
  } catch (err) {
    console.error('CompetencyBreakdown error:', err);
    res.status(500).json({ error: 'Failed to load competency data.' });
  }
});

export default router;
