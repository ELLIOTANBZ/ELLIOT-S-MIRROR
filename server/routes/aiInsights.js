import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import AiCache from '../models/AiCache.js';
import User from '../models/User.js';
import CompetencyFramework from '../models/CompetencyFramework.js';
import { fetchParsedContext } from '../utils/fetchParsedContext.js';
import { buildCompetencySystemPrompt } from '../utils/getCompetencyContext.js';

/** Add n days (positive or negative) to a YYYY-MM-DD string. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const router = Router();
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o';

async function callOpenRouter(systemPrompt, userPrompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/* ── 6 CPF competency descriptors ────────────────────────────── */
const COMPETENCIES = [
  {
    name: 'Thinking Clearly and Making Sound Judgements',
    descriptors: {
      1: 'Demonstrates systematic problem-solving by gathering relevant information from multiple sources and drawing on experience to identify root causes. Develops practical solutions through careful evaluation of options and consideration of different perspectives before recommending the most suitable approach.',
      2: 'Balances stakeholder interests with both immediate and future considerations when developing solutions. Makes well-informed decisions by integrating diverse data sources with practical understanding of operational realities. Proactively anticipates questions and concerns from key parties when implementing recommendations.',
      3: 'Exercises sound judgement by weighing ethical considerations alongside broader socio-economic factors. Synthesises complex information across multiple perspectives to maintain strategic oversight whilst remaining attuned to operational nuances. Prioritises initiatives that align with organisational objectives while thoughtfully considering stakeholder impact and presenting clear, objective recommendations.',
    },
  },
  {
    name: 'Working as a Team (within the Board and Public Service)',
    descriptors: {
      1: 'Participates actively in team activities, shares information openly, and supports colleagues to achieve shared goals.',
      2: 'Facilitates collaboration across teams, mediates conflicts constructively, and aligns team efforts with broader organisational objectives.',
      3: 'Builds high-performing teams across organisational boundaries, fosters a culture of trust and mutual accountability, and drives collective outcomes at a strategic level.',
    },
  },
  {
    name: 'Working Effectively with Citizens and Stakeholders',
    descriptors: {
      1: 'Responds to citizen and stakeholder needs courteously and accurately, demonstrating understanding of their concerns and providing timely assistance.',
      2: 'Proactively manages stakeholder relationships, anticipates needs, and tailors communication to different audiences to build trust and satisfaction.',
      3: 'Leads stakeholder engagement strategies, resolves complex or sensitive issues with diplomacy, and shapes service delivery standards to exceed citizen expectations.',
    },
  },
  {
    name: 'Keep Learning and Putting Skills into Action',
    descriptors: {
      1: 'Seeks feedback and learning opportunities to develop relevant skills and applies new knowledge to improve work quality.',
      2: 'Takes initiative to deepen expertise, shares knowledge with peers, and applies learning to solve increasingly complex challenges.',
      3: 'Champions a learning culture, mentors others, and drives innovation by applying advanced insights to transform team and organisational capability.',
    },
  },
  {
    name: 'Improving and Innovating Continuously (Agile, Bold and Data-Smart)',
    descriptors: {
      1: 'Identifies areas for improvement in own work and suggests practical solutions using available data and tools.',
      2: 'Leads process improvement initiatives, uses data to drive decisions, and pilots new approaches to enhance service quality.',
      3: 'Drives bold, organisation-wide innovation using data intelligence, challenges existing paradigms, and embeds continuous improvement as a strategic capability.',
    },
  },
  {
    name: 'Serving with Heart, Commitment and Purpose (Customer-obsessed)',
    descriptors: {
      1: 'Demonstrates genuine care for citizens, maintains service standards consistently, and goes beyond basic requirements to support members.',
      2: 'Anticipates citizen needs, personalises service delivery, and maintains composure and empathy in challenging interactions.',
      3: 'Inspires a citizen-first culture, models exemplary service in complex situations, and influences policies and practices to better serve the public.',
    },
  },
];

/** Permission check */
async function resolveOfficerId(req) {
  const requestedId = req.body.officerId;
  if (!requestedId || requestedId === String(req.user.id)) return String(req.user.id);
  if (req.user.role === 'Admin') return requestedId;
  if (req.user.role === 'CSO') return null;
  if (req.user.role === 'TL') {
    const target = await User.findById(requestedId).lean();
    if (!target || target.role !== 'CSO') return null;
  }
  return requestedId;
}

/* ─────────────────────────────────────────────────────────────── */
/*  POST /api/ai/development                                       */
/*  Body: { officerId, competencyIndex, currentLevel, currentScore,*/
/*          latestDate, indicators }                               */
/* ─────────────────────────────────────────────────────────────── */
router.post('/development', requireAuth, async (req, res) => {
  const { competencyIndex, currentLevel, currentScore, latestDate, indicators } = req.body;

  const officerId = await resolveOfficerId(req);
  if (!officerId) return res.status(403).json({ error: 'Access denied.' });

  const idx = Number(competencyIndex);
  if (idx < 0 || idx > 5) return res.status(400).json({ error: 'Invalid competencyIndex.' });

  // Check cache
  const cacheKey = { officerId, uploadDate: latestDate ?? 'none', competencyIndex: idx, type: 'development' };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) return res.json(cached.content);

  const comp = COMPETENCIES[idx];
  const levelName = currentLevel === 3 ? 'Advanced' : currentLevel === 2 ? 'Intermediate' : 'Basic';
  const isAdvanced = currentLevel === 3;

  if (isAdvanced) {
    const content = {
      wellDone: null,
      toProgress: null,
      mastery: 'Advanced level achieved. Focus on mentoring others and contributing to process improvements.',
    };
    await AiCache.create({ ...cacheKey, content });
    return res.json(content);
  }

  const nextLevel = currentLevel + 1;
  const indicatorText = indicators?.length
    ? indicators.map(i => `• ${i.name}: ${i.avg}%`).join('\n')
    : 'No indicator data available.';

  // Fetch officer role for competency framework context
  const officerUser = await User.findById(officerId).lean().catch(() => null);
  const officerRole = officerUser?.role ?? 'CSO';

  // Fetch parsed context and competency system prompt in parallel
  const now = new Date();
  const cutoff = new Date(now); cutoff.setDate(now.getDate() - 30);
  const [{ contextBlock }, sysPrompt] = await Promise.all([
    fetchParsedContext(officerId, cutoff.toISOString().slice(0, 10), now.toISOString().slice(0, 10)),
    buildCompetencySystemPrompt(officerRole),
  ]);

  const contextSection = contextBlock
    ? `\nHere is the officer's recent performance data to ground your feedback:\n\n${contextBlock}\n\nBased on the above, `
    : '';

  const prompt = `Competency: ${comp.name}

Current Level: ${levelName} (Level ${currentLevel}) — Score: ${currentScore ?? 'N/A'}%

Current Level Descriptor (Level ${currentLevel}):
${comp.descriptors[currentLevel]}

Next Level Descriptor (Level ${nextLevel}):
${comp.descriptors[nextLevel]}

Officer's recent indicator performance:
${indicatorText}
${contextSection}
Please provide:
1. "What Went Well" — 3 to 4 specific bullet points describing behaviours the officer has demonstrated that are consistent with their current level descriptor. Reference the descriptor language directly and cite specific examples from the performance data where available.
2. "To Progress to Level ${nextLevel}" — 3 to 4 specific, actionable bullet points describing what the officer should do to reach the next level, framed against the next level descriptor.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "wellDone": ["bullet 1", "bullet 2", "bullet 3"],
  "toProgress": ["action 1", "action 2", "action 3"]
}`;

  try {
    const raw  = await callOpenRouter(sysPrompt + ' Always respond with valid JSON only — no markdown, no extra text.', prompt);
    const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const content = { wellDone: parsed.wellDone ?? [], toProgress: parsed.toProgress ?? [], mastery: null };

    await AiCache.create({ ...cacheKey, content }).catch(() => {}); // ignore duplicate
    res.json(content);
  } catch (err) {
    console.error('AI development error:', err);
    res.status(500).json({ error: 'Failed to generate AI summary. Please try again.' });
  }
});

/* ─────────────────────────────────────────────────────────────── */
/*  POST /api/ai/evidence                                          */
/*  Body: { officerId, competencyIndex, latestDate }               */
/* ─────────────────────────────────────────────────────────────── */
router.post('/evidence', requireAuth, async (req, res) => {
  const { competencyIndex, latestDate } = req.body;

  const officerId = await resolveOfficerId(req);
  if (!officerId) return res.status(403).json({ error: 'Access denied.' });

  const idx = Number(competencyIndex);
  if (idx < 0 || idx > 5) return res.status(400).json({ error: 'Invalid competencyIndex.' });

  // Check cache
  const cacheKey = { officerId, uploadDate: latestDate ?? 'none', competencyIndex: idx, type: 'evidence' };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) return res.json(cached.content);

  // Fetch parsed context for this officer (last 30 days)
  const now2 = new Date();
  const cutoff2 = new Date(now2); cutoff2.setDate(now2.getDate() - 30);
  const { interactionsSentences, auditmateSentences, contextBlock } = await fetchParsedContext(
    officerId,
    cutoff2.toISOString().slice(0, 10),
    now2.toISOString().slice(0, 10)
  );

  if (!interactionsSentences.length && !auditmateSentences.length) {
    return res.json({ noData: true });
  }

  const comp = COMPETENCIES[idx];

  // Fetch officer role for competency context
  const officerUser2 = await User.findById(officerId).lean().catch(() => null);
  const officerRole2 = officerUser2?.role ?? 'CSO';
  const sysPrompt2 = await buildCompetencySystemPrompt(officerRole2);

  const prompt = `Competency being assessed: ${comp.name}
Level descriptor (Basic): ${comp.descriptors[1]}
Level descriptor (Intermediate): ${comp.descriptors[2]}
Level descriptor (Advanced): ${comp.descriptors[3]}

${contextBlock}

Based on the above, please analyse the officer's recent interactions and audit data and provide:
1. "strengths" — 2 to 3 specific quotes or paraphrased lines from the interactions that demonstrate strength in this competency. Each entry should be a short excerpt followed by a brief explanation of why it demonstrates competency.
2. "gaps" — 1 to 2 specific quotes or lines that show a gap or area for improvement in this competency.
3. "suggestions" — 2 to 3 brief, specific improvement suggestions tied directly to the identified gaps.

Do NOT include case numbers or full case details. Only include extracted lines and AI commentary.

Respond ONLY in this exact JSON format (no markdown):
{
  "strengths": [{"quote": "...", "why": "..."}, ...],
  "gaps": [{"quote": "...", "why": "..."}],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

  try {
    const raw  = await callOpenRouter(sysPrompt2 + ' Always respond with valid JSON only — no markdown, no extra text.', prompt);
    const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const content = {
      noData: false,
      strengths:   parsed.strengths   ?? [],
      gaps:        parsed.gaps        ?? [],
      suggestions: parsed.suggestions ?? [],
    };

    await AiCache.create({ ...cacheKey, content }).catch(() => {});
    res.json(content);
  } catch (err) {
    console.error('AI evidence error:', err);
    res.status(500).json({ error: 'Failed to generate supporting evidence. Please try again.' });
  }
});

/* ─────────────────────────────────────────────────────────────── */
/*  POST /api/ai/correspondence-development                        */
/*  Body: { officerId, correspondenceIndex, currentLevel,          */
/*          currentScore, indicatorScores, essAvg, essCount }      */
/* ─────────────────────────────────────────────────────────────── */
const CORRESPONDENCE_NAMES = [
  'Empathetic Writing',
  'Direct Reply',
  'Active Listening',
  'Customer Obsessed',
  'Problem Solving',
];

router.post('/correspondence-development', requireAuth, async (req, res) => {
  const { correspondenceIndex, currentLevel, currentScore, indicatorScores, essAvg, essCount } = req.body;

  const officerId = await resolveOfficerId(req);
  if (!officerId) return res.status(403).json({ error: 'Access denied.' });

  const idx = Number(correspondenceIndex);
  if (idx < 0 || idx > 4) return res.status(400).json({ error: 'Invalid correspondenceIndex.' });

  const compName = CORRESPONDENCE_NAMES[idx];
  const cacheKey = { officerId, uploadDate: 'corr', competencyIndex: 100 + idx, type: 'corr-dev' };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) return res.json(cached.content);

  const levelName  = currentLevel === 3 ? 'Advanced' : currentLevel === 2 ? 'Intermediate' : 'Basic';
  const isAdvanced = currentLevel === 3;

  if (isAdvanced) {
    const content = { wellDone: null, toProgress: null, mastery: `Advanced level achieved in ${compName}. Focus on mentoring peers and modelling this behaviour in complex member interactions.` };
    await AiCache.create({ ...cacheKey, content }).catch(() => {});
    return res.json(content);
  }

  // Fetch competency framework bullet points from DB
  const officerUser = await User.findById(officerId).lean().catch(() => null);
  const officerRole = officerUser?.role ?? 'CSO';
  const frameworkDoc = await CompetencyFramework.findOne({ role: officerRole, name: compName }).lean().catch(() => null);
  const bulletPoints = frameworkDoc?.bullet_points?.length
    ? frameworkDoc.bullet_points.map(b => `• ${b}`).join('\n')
    : '(no bullet points available)';

  const now = new Date();
  const cutoff = new Date(now); cutoff.setDate(now.getDate() - 30);
  const [{ contextBlock }, sysPrompt] = await Promise.all([
    fetchParsedContext(officerId, cutoff.toISOString().slice(0, 10), now.toISOString().slice(0, 10)),
    buildCompetencySystemPrompt(officerRole),
  ]);

  const contextSection = contextBlock
    ? `\nHere is the officer's recent performance data:\n\n${contextBlock}\n\nBased on the above, `
    : '';

  const indicatorText = indicatorScores?.length
    ? indicatorScores.map(i => `• ${i.label}: ${i.avg !== null ? i.avg + '%' : 'N/A'}`).join('\n')
    : 'No indicator data available.';

  const essLine = essAvg !== null
    ? `\nMember Satisfaction Signal (supporting context only): ${essAvg}/5 average (${essCount} responses)`
    : '';

  const nextLevel = (currentLevel ?? 1) + 1;
  const prompt = `Correspondence Competency: ${compName}
Current Level: ${levelName} (Level ${currentLevel ?? 1}) — Score: ${currentScore ?? 'N/A'}%

CPF Behavioural Indicators for this competency:
${bulletPoints}

Contributing indicator scores (past 30 days):
${indicatorText}${essLine}
${contextSection}
Please provide:
1. "What Went Well" — 3 to 4 specific bullet points describing behaviours the officer has demonstrated in their correspondence that reflect this competency. Reference specific examples from the performance data where available.
2. "To Progress to Level ${nextLevel}" — 3 to 4 specific, actionable bullet points describing what the officer should do in their written responses to reach the next level.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "wellDone": ["bullet 1", "bullet 2", "bullet 3"],
  "toProgress": ["action 1", "action 2", "action 3"]
}`;

  try {
    const raw    = await callOpenRouter(sysPrompt + ' Always respond with valid JSON only — no markdown, no extra text.', prompt);
    const json   = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const content = { wellDone: parsed.wellDone ?? [], toProgress: parsed.toProgress ?? [], mastery: null };
    await AiCache.create({ ...cacheKey, content }).catch(() => {});
    res.json(content);
  } catch (err) {
    console.error('Correspondence AI development error:', err);
    res.status(500).json({ error: 'Failed to generate AI summary. Please try again.' });
  }
});

/* ─────────────────────────────────────────────────────────────── */
/*  POST /api/ai/correspondence-evidence                           */
/*  Body: { officerId, correspondenceIndex, latestDate }           */
/* ─────────────────────────────────────────────────────────────── */
router.post('/correspondence-evidence', requireAuth, async (req, res) => {
  const { correspondenceIndex, latestDate } = req.body;

  const officerId = await resolveOfficerId(req);
  if (!officerId) return res.status(403).json({ error: 'Access denied.' });

  const idx = Number(correspondenceIndex);
  if (idx < 0 || idx > 4) return res.status(400).json({ error: 'Invalid correspondenceIndex.' });

  const compName = CORRESPONDENCE_NAMES[idx];
  const cacheKey = { officerId, uploadDate: latestDate ?? 'none', competencyIndex: 100 + idx, type: 'corr-ev' };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) return res.json(cached.content);

  const now2 = new Date();
  const cutoff2 = new Date(now2); cutoff2.setDate(now2.getDate() - 30);
  const { interactionsSentences, auditmateSentences, contextBlock } = await fetchParsedContext(
    officerId,
    cutoff2.toISOString().slice(0, 10),
    now2.toISOString().slice(0, 10)
  );

  if (!interactionsSentences.length && !auditmateSentences.length) {
    return res.json({ noData: true });
  }

  const officerUser2 = await User.findById(officerId).lean().catch(() => null);
  const officerRole2 = officerUser2?.role ?? 'CSO';
  const sysPrompt2 = await buildCompetencySystemPrompt(officerRole2);

  const prompt = `Correspondence Competency being assessed: ${compName}

${contextBlock}

Based on the officer's actual written responses and audit data above, please analyse their correspondence for evidence of this competency and provide:
1. "strengths" — 2 to 3 specific quotes or paraphrased lines from the interactions that demonstrate strength in ${compName}. Each entry should be a short excerpt followed by a brief explanation of why it demonstrates this competency.
2. "gaps" — 1 to 2 specific quotes or lines showing a gap or area for improvement in ${compName}.
3. "suggestions" — 2 to 3 brief, specific improvement suggestions tied directly to the identified gaps in correspondence quality.

Respond ONLY in this exact JSON format (no markdown):
{
  "strengths": [{"quote": "...", "why": "..."}, ...],
  "gaps": [{"quote": "...", "why": "..."}],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

  try {
    const raw    = await callOpenRouter(sysPrompt2 + ' Always respond with valid JSON only — no markdown, no extra text.', prompt);
    const json   = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const content = {
      noData:      false,
      strengths:   parsed.strengths   ?? [],
      gaps:        parsed.gaps        ?? [],
      suggestions: parsed.suggestions ?? [],
    };
    await AiCache.create({ ...cacheKey, content }).catch(() => {});
    res.json(content);
  } catch (err) {
    console.error('Correspondence AI evidence error:', err);
    res.status(500).json({ error: 'Failed to generate supporting evidence. Please try again.' });
  }
});

/* ── shared handler: Functional / Leadership development ─────── */
async function handleFuncLeadDev(req, res, cacheType) {
  const { competencyIndex, compName, bulletPoints, currentLevel, currentScore, latestDate, auditScore, essScore, interactionScore } = req.body;
  const officerId = await resolveOfficerId(req);
  if (!officerId) return res.status(403).json({ error: 'Access denied.' });

  const idx = Number(competencyIndex);
  const cacheKey = { officerId, uploadDate: latestDate ?? 'none', competencyIndex: idx, type: cacheType };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) return res.json(cached.content);

  if (currentLevel === 3) {
    const content = { wellDone: null, toProgress: null, mastery: `Advanced level achieved in ${compName}. Continue mentoring others and championing this behaviour across the team.` };
    await AiCache.create({ ...cacheKey, content }).catch(() => {});
    return res.json(content);
  }

  const officerUser = await User.findById(officerId).lean().catch(() => null);
  const officerRole = officerUser?.role ?? 'CSO';
  const cutoffDate  = latestDate ? addDays(latestDate, -30) : undefined;

  const [{ auditmateSentences, interactionsSentences, essSentences }, sysPrompt] = await Promise.all([
    fetchParsedContext(officerId, cutoffDate, latestDate ?? undefined).catch(() => ({ auditmateSentences: [], interactionsSentences: [], essSentences: [] })),
    buildCompetencySystemPrompt(officerRole),
  ]);

  const bulletText = bulletPoints?.length ? bulletPoints.map(b => `• ${b}`).join('\n') : '(no bullet points)';
  const scoreCtx   = [
    auditScore       != null ? `Auditmate score (50%): ${auditScore}%`          : null,
    essScore         != null ? `ESS satisfaction score (25%): ${essScore}%`     : null,
    interactionScore != null ? `Interaction quality score (25%): ${interactionScore}%` : null,
  ].filter(Boolean).join('\n');

  const contextBlock = [
    auditmateSentences.length    ? `Auditmate performance data (past 30 days):\n${auditmateSentences.join('\n')}` : null,
    essSentences.length          ? `Member satisfaction feedback (past 30 days):\n${essSentences.join('\n')}`    : null,
    interactionsSentences.length ? `Officer interaction responses (past 30 days):\n${interactionsSentences.join('\n')}` : null,
  ].filter(Boolean).join('\n\n');

  const nextLevel = (currentLevel ?? 1) + 1;
  const levelName = currentLevel === 2 ? 'Intermediate' : 'Basic';

  const prompt = `Competency: ${compName}
Current Level: ${levelName} (Level ${currentLevel}) — Combined Score: ${currentScore ?? 'N/A'}%

Score breakdown (3 data sources):
${scoreCtx}

CPF Behavioural Indicators:
${bulletText}

${contextBlock ? `Based on all three data sources above:\n\n${contextBlock}\n\n` : ''}Please provide:
1. "What Went Well" — 3 to 4 specific bullet points describing behaviours the officer has demonstrated that reflect this competency. Reference examples from the data where available.
2. "To Progress to Level ${nextLevel}" — 3 to 4 specific, actionable bullet points describing what the officer should do to reach the next level, framed against the competency indicators.

Respond ONLY in this exact JSON format (no markdown):
{
  "wellDone": ["bullet 1", "bullet 2", "bullet 3"],
  "toProgress": ["action 1", "action 2", "action 3"]
}`;

  try {
    const raw    = await callOpenRouter(sysPrompt + ' Always respond with valid JSON only.', prompt);
    const json   = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const content = { wellDone: parsed.wellDone ?? [], toProgress: parsed.toProgress ?? [], mastery: null };
    await AiCache.create({ ...cacheKey, content }).catch(() => {});
    res.json(content);
  } catch (err) {
    console.error(`${cacheType} AI error:`, err);
    res.status(500).json({ error: 'Failed to generate AI summary.' });
  }
}

/* ── shared handler: Functional / Leadership evidence ─────────── */
async function handleFuncLeadEv(req, res, cacheType) {
  const { competencyIndex, compName, bulletPoints, latestDate, auditScore, essScore, interactionScore } = req.body;
  const officerId = await resolveOfficerId(req);
  if (!officerId) return res.status(403).json({ error: 'Access denied.' });

  const idx = Number(competencyIndex);
  const cacheKey = { officerId, uploadDate: latestDate ?? 'none', competencyIndex: idx, type: cacheType };
  const cached = await AiCache.findOne(cacheKey).lean();
  if (cached) return res.json(cached.content);

  const officerUser = await User.findById(officerId).lean().catch(() => null);
  const officerRole = officerUser?.role ?? 'CSO';
  const cutoffDate  = latestDate ? addDays(latestDate, -30) : undefined;

  const [{ auditmateSentences, interactionsSentences, essSentences }, sysPrompt] = await Promise.all([
    fetchParsedContext(officerId, cutoffDate, latestDate ?? undefined).catch(() => ({ auditmateSentences: [], interactionsSentences: [], essSentences: [] })),
    buildCompetencySystemPrompt(officerRole),
  ]);

  if (!interactionsSentences.length && !auditmateSentences.length && !essSentences.length) {
    return res.json({ noData: true });
  }

  const bulletText = bulletPoints?.length ? bulletPoints.map(b => `• ${b}`).join('\n') : '';
  const contextBlock = [
    interactionsSentences.length ? `Officer interaction responses:\n${interactionsSentences.join('\n')}` : null,
    essSentences.length          ? `Member satisfaction feedback:\n${essSentences.join('\n')}`           : null,
    auditmateSentences.length    ? `Auditmate performance data:\n${auditmateSentences.join('\n')}`       : null,
  ].filter(Boolean).join('\n\n');

  const prompt = `Competency being assessed: ${compName}
Behavioural indicators:
${bulletText}

${contextBlock}

Based on all three data sources above, provide supporting evidence for this competency.

Return ONLY this exact JSON format (no markdown):
{
  "interactions": {
    "strengths": [{"quote": "...", "why": "..."}],
    "gaps": [{"quote": "...", "why": "..."}]
  },
  "ess": {
    "quotes": [{"text": "...", "type": "positive"}]
  },
  "audit": {
    "summary": "..."
  }
}

For "interactions.strengths": 2-3 specific quotes or paraphrased lines from interaction responses showing strength in this competency, with brief explanation of why it demonstrates the competency.
For "interactions.gaps": 1-2 specific lines showing where the officer fell short, with explanation of what was missing.
For "ess.quotes": 1-2 member feedback quotes from ESS data related to this competency. Set type to "positive" or "negative".
For "audit.summary": 1-2 sentences summarising what the Auditmate score (${auditScore ?? 'N/A'}%) indicates about this competency.`;

  try {
    const raw    = await callOpenRouter(sysPrompt + ' Always respond with valid JSON only.', prompt);
    const json   = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const content = {
      noData:       false,
      interactions: parsed.interactions ?? { strengths: [], gaps: [] },
      ess:          parsed.ess          ?? { quotes: []            },
      audit:        parsed.audit        ?? { summary: ''           },
    };
    await AiCache.create({ ...cacheKey, content }).catch(() => {});
    res.json(content);
  } catch (err) {
    console.error(`${cacheType} AI evidence error:`, err);
    res.status(500).json({ error: 'Failed to generate supporting evidence.' });
  }
}

/* ─────────────────────────────────────────────────────────────── */
/*  POST /api/ai/functional-development                            */
/*  POST /api/ai/functional-evidence                               */
/*  POST /api/ai/leadership-development                            */
/*  POST /api/ai/leadership-evidence                               */
/* ─────────────────────────────────────────────────────────────── */
router.post('/functional-development',  requireAuth, (req, res) => handleFuncLeadDev(req, res, 'func-dev'));
router.post('/functional-evidence',     requireAuth, (req, res) => handleFuncLeadEv(req,  res, 'func-ev'));
router.post('/leadership-development',  requireAuth, (req, res) => handleFuncLeadDev(req, res, 'lead-dev'));
router.post('/leadership-evidence',     requireAuth, (req, res) => handleFuncLeadEv(req,  res, 'lead-ev'));

export default router;
