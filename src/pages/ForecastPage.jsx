import { useState, useMemo, useEffect } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

// ═══════════════════════════════════════════════════════════════════════
// DES ENGINE — ported from simpyv2.py
// ═══════════════════════════════════════════════════════════════════════

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function safeMean(arr, def = 0) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : def }

// Seeded PRNG (mulberry32) for reproducible runs
function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weightedChoice(weights, rng) {
  const entries = Object.entries(weights)
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let threshold = rng() * total
  for (const [key, w] of entries) {
    threshold -= w
    if (threshold <= 0) return key
  }
  return entries[entries.length - 1][0]
}

function normaliseWeights(weights) {
  const total = Object.values(weights).reduce((s, v) => s + v, 0)
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]))
}

function scoreToLevel(score) { return 1.0 + (clamp(score, 0, 100) / 100) * 6.0 }

function trendStatusFromWindow(scores) {
  if (scores.length < 5) return 'Stagnant'
  const slope = (scores[scores.length - 1] - scores[0]) / Math.max(1, scores.length - 1)
  const volatility = safeMean(scores.slice(1).map((v, i) => Math.abs(v - scores[i])))
  if (scores[scores.length - 1] >= 88 && Math.abs(slope) < 0.08 && volatility < 0.4) return 'Mastery'
  if (slope > 0.08) return 'Advancing'
  return 'Stagnant'
}

const ROLE_CSO = 'CSO'
const ROLE_TL  = 'Team Leader'
const ROLE_SUP = 'Supervisor'

const COMMON_CORRESPONDENCE = ['Empathetic Writing','Direct Reply','Active Listening','Customer Obsessed','Problem Solving']
const COMMON_CORE           = ['Thinking Clearly and Making Sound Judgements','Working as a team','Working effectively with citizens and stakeholders','Keep learning and putting skills into action','Improving and innovating continuously','Serving with heart, commitment and purpose']
const FUNCTIONAL            = ['Case Management','Tech Application','Data Management','Digital Design and Management','Service Operations Planning']
const LEADERSHIP            = ['Personal Development','Team Development','Stakeholder Development']

const ROLE_TARGET_LEVELS = { [ROLE_CSO]: 3.0, [ROLE_TL]: 5.0, [ROLE_SUP]: 7.0 }

const ROLE_BASE_EVENT_WEIGHTS = {
  [ROLE_CSO]: { ROUTINE:0.58, HIGH_WORKLOAD:0.12, COMPLEX_CASE:0.10, ESCALATION:0.07, COACHING:0.05, TRAINING:0.03, COLLABORATION:0.02, RECOVERY:0.03 },
  [ROLE_TL]:  { ROUTINE:0.42, HIGH_WORKLOAD:0.10, COMPLEX_CASE:0.09, ESCALATION:0.06, COACHING:0.10, TRAINING:0.05, COLLABORATION:0.08, RECOVERY:0.05, LEADERSHIP_RESPONSIBILITY:0.05 },
  [ROLE_SUP]: { ROUTINE:0.28, HIGH_WORKLOAD:0.11, COMPLEX_CASE:0.09, ESCALATION:0.07, COACHING:0.10, TRAINING:0.06, COLLABORATION:0.08, RECOVERY:0.04, LEADERSHIP_RESPONSIBILITY:0.12, POLICY_CHANGE:0.05 },
}

const EVENT_METADATA = {
  ROUTINE:                  { label:'Routine Work Day',             explanation:'Routine frontline work reinforced service and communication competencies.' },
  HIGH_WORKLOAD:            { label:'High Workload Day',            explanation:'High volume increased delivery pressure, boosting some operational exposure but adding fatigue.' },
  COMPLEX_CASE:             { label:'Complex Case Day',             explanation:'Complex cases strengthened judgement and case handling, but also raised cognitive strain.' },
  ESCALATION:               { label:'Escalation Day',               explanation:'Escalations increased stress and caused short-term volatility in projected performance.' },
  COACHING:                 { label:'Coaching Session',             explanation:'Coaching supported improvement in weaker areas and increased learning momentum.' },
  TRAINING:                 { label:'Training / Course Day',        explanation:'Training introduced new learning, improving development potential beyond routine exposure.' },
  COLLABORATION:            { label:'Collaboration Day',            explanation:'Cross-team support and peer interaction improved coordination and role-relevant judgement.' },
  RECOVERY:                 { label:'Recovery / Admin Day',         explanation:'A lighter day allowed fatigue to recover and helped stabilise recent gains.' },
  LEADERSHIP_RESPONSIBILITY:{ label:'Leadership Responsibility Day',explanation:'Leadership tasks increased ownership, team guidance, and supervisory capability exposure.' },
  POLICY_CHANGE:            { label:'Policy / Process Change Day',  explanation:'Change-related work temporarily increased uncertainty while creating learning opportunities.' },
}

const EVENT_COMPETENCY_EFFECTS = {
  ROUTINE:                  { 'Empathetic Writing':0.18,'Direct Reply':0.20,'Active Listening':0.14,'Customer Obsessed':0.16,'Case Management':0.12,'Service Operations Planning':0.06,'Serving with heart, commitment and purpose':0.10 },
  HIGH_WORKLOAD:            { 'Direct Reply':0.10,'Case Management':0.08,'Service Operations Planning':0.10,'Customer Obsessed':-0.08,'Empathetic Writing':-0.06,'Serving with heart, commitment and purpose':-0.05 },
  COMPLEX_CASE:             { 'Problem Solving':0.24,'Thinking Clearly and Making Sound Judgements':0.26,'Case Management':0.22,'Working effectively with citizens and stakeholders':0.12,'Active Listening':0.08 },
  ESCALATION:               { 'Problem Solving':0.08,'Case Management':0.05,'Empathetic Writing':-0.10,'Customer Obsessed':-0.10,'Serving with heart, commitment and purpose':-0.08,'Working effectively with citizens and stakeholders':-0.04 },
  COACHING:                 { 'Keep learning and putting skills into action':0.28,'Working as a team':0.14,'Thinking Clearly and Making Sound Judgements':0.12,'Case Management':0.10,'Team Development':0.16,'Personal Development':0.14 },
  TRAINING:                 { 'Keep learning and putting skills into action':0.30,'Tech Application':0.18,'Data Management':0.16,'Digital Design and Management':0.16,'Improving and innovating continuously':0.14,'Personal Development':0.10 },
  COLLABORATION:            { 'Working as a team':0.24,'Working effectively with citizens and stakeholders':0.18,'Stakeholder Development':0.18,'Team Development':0.12,'Customer Obsessed':0.06 },
  RECOVERY:                 { 'Serving with heart, commitment and purpose':0.08,'Keep learning and putting skills into action':0.06 },
  LEADERSHIP_RESPONSIBILITY:{ 'Team Development':0.28,'Stakeholder Development':0.22,'Personal Development':0.18,'Thinking Clearly and Making Sound Judgements':0.12,'Service Operations Planning':0.14,'Working as a team':0.10 },
  POLICY_CHANGE:            { 'Thinking Clearly and Making Sound Judgements':0.16,'Keep learning and putting skills into action':0.16,'Improving and innovating continuously':0.14,'Tech Application':0.08,'Service Operations Planning':0.10,'Customer Obsessed':-0.04 },
}

const EVENT_HIDDEN_EFFECTS = {
  ROUTINE:                  { fatigue:0.03,  momentum:0.02,  stability:0.01,  trainingBoost:0.0,  coachingBoost:0.0  },
  HIGH_WORKLOAD:            { fatigue:0.10,  momentum:0.00,  stability:-0.03, trainingBoost:0.0,  coachingBoost:0.0  },
  COMPLEX_CASE:             { fatigue:0.08,  momentum:0.03,  stability:-0.01, trainingBoost:0.0,  coachingBoost:0.0  },
  ESCALATION:               { fatigue:0.12,  momentum:-0.03, stability:-0.05, trainingBoost:0.0,  coachingBoost:0.0  },
  COACHING:                 { fatigue:-0.02, momentum:0.09,  stability:0.03,  trainingBoost:0.0,  coachingBoost:0.20 },
  TRAINING:                 { fatigue:0.02,  momentum:0.07,  stability:0.02,  trainingBoost:0.24, coachingBoost:0.0  },
  COLLABORATION:            { fatigue:-0.01, momentum:0.04,  stability:0.04,  trainingBoost:0.0,  coachingBoost:0.0  },
  RECOVERY:                 { fatigue:-0.14, momentum:0.01,  stability:0.05,  trainingBoost:0.0,  coachingBoost:0.0  },
  LEADERSHIP_RESPONSIBILITY:{ fatigue:0.07,  momentum:0.05,  stability:0.00,  trainingBoost:0.0,  coachingBoost:0.0  },
  POLICY_CHANGE:            { fatigue:0.05,  momentum:0.02,  stability:-0.02, trainingBoost:0.0,  coachingBoost:0.0  },
}

const SCENARIOS = {
  baseline:  { name:'baseline',  weightMult:{},                                                                                               fatigueMult:1.00, growthMult:1.00, recoveryMult:1.00, volatilityMult:1.00 },
  best_case: { name:'best_case', weightMult:{ COACHING:1.35, TRAINING:1.35, RECOVERY:1.20, ESCALATION:0.80, HIGH_WORKLOAD:0.90 },            fatigueMult:0.88, growthMult:1.15, recoveryMult:1.20, volatilityMult:0.90 },
  worst_case:{ name:'worst_case',weightMult:{ COACHING:0.80, TRAINING:0.80, RECOVERY:0.85, ESCALATION:1.30, HIGH_WORKLOAD:1.20, COMPLEX_CASE:1.10 }, fatigueMult:1.18, growthMult:0.88, recoveryMult:0.85, volatilityMult:1.15 },
}

function toDesRole(authRole) {
  if (authRole === 'Supervisor') return ROLE_SUP
  if (authRole === 'TL') return ROLE_TL
  return ROLE_CSO
}

function deriveHiddenState(raw) {
  const history = (raw.history || []).map(r => parseFloat(r.score)).filter(v => !isNaN(v))
  if (history.length < 2) return { fatigue:0.18, momentum:0.20, stability:0.55 }
  const slope = (history[history.length-1] - history[0]) / Math.max(1, history.length-1)
  const changes = history.slice(1).map((v,i) => Math.abs(v - history[i]))
  const volatility = safeMean(changes, 0.5)
  return {
    fatigue:  clamp(0.18 + volatility*0.03, 0.05, 0.45),
    momentum: clamp(0.20 + slope*0.05,      0.05, 0.75),
    stability:clamp(0.80 - volatility*0.05, 0.20, 0.90),
  }
}

function roleDefaultLevel(role) {
  return ROLE_TARGET_LEVELS[role] * 0.60
}

function buildCompetencies(raw, role) {
  const comps = {}
  const defLevel = roleDefaultLevel(role)
  const addFamily = (items, family) => {
    for (const item of (items || [])) {
      if (!item.name) continue
      const score = parseFloat(item.score ?? 50)
      const level = item.level != null ? parseFloat(item.level) : defLevel
      comps[item.name] = { name:item.name, score, level, status:item.status||'Stagnant', family, recentHistory:[score], momentum:0, fatigueSensitivity:1.0, plateauFactor:0 }
    }
  }
  addFamily(raw.correspondenceCompetencies, 'correspondence')
  addFamily(raw.functionalCompetencies,     'functional')
  addFamily(raw.leadershipCompetencies,     'leadership')

  const def = parseFloat(raw.currentScore ?? 50)
  for (const name of COMMON_CORE) {
    if (!comps[name]) comps[name] = { name, score:def, level:defLevel, status:'Stagnant', family:'core', recentHistory:[def], momentum:0, fatigueSensitivity:1.0, plateauFactor:0 }
  }
  for (const name of COMMON_CORRESPONDENCE) {
    if (!comps[name]) { const s = parseFloat(raw.correspondenceOverall ?? def); comps[name] = { name, score:s, level:defLevel, status:'Stagnant', family:'correspondence', recentHistory:[s], momentum:0, fatigueSensitivity:1.0, plateauFactor:0 } }
  }
  const fd = parseFloat(raw.functionalOverall ?? def)
  for (const name of FUNCTIONAL) {
    if (!comps[name]) comps[name] = { name, score:fd, level:defLevel, status:'Stagnant', family:'functional', recentHistory:[fd], momentum:0, fatigueSensitivity:1.0, plateauFactor:0 }
  }
  if (role === ROLE_SUP) {
    const ld = parseFloat(raw.leadershipOverall ?? def)
    for (const name of LEADERSHIP) {
      if (!comps[name]) comps[name] = { name, score:ld, level:defLevel, status:'Stagnant', family:'leadership', recentHistory:[ld], momentum:0, fatigueSensitivity:1.0, plateauFactor:0 }
    }
  }
  const target = ROLE_TARGET_LEVELS[role]
  for (const c of Object.values(comps)) {
    c.plateauFactor = target <= 1 ? 0 : clamp(1 - clamp(Math.max(0, target - c.level) / (target - 1), 0, 1), 0, 0.95)
  }
  return comps
}

function buildState(raw, role) {
  const hidden = deriveHiddenState(raw)
  const history = (raw.history || []).map(r => parseFloat(r.score)).filter(v => !isNaN(v))
  return {
    officerId: raw.officerId || 'UNKNOWN',
    role,
    latestDate: raw.latestDate || new Date().toISOString().slice(0,10),
    overallScore: parseFloat(raw.currentScore ?? 50),
    overallLevel: parseFloat(raw.currentLevel ?? scoreToLevel(50)),
    overallStatus: raw.status || 'Stagnant',
    correspondenceOverall: parseFloat(raw.correspondenceOverall ?? raw.currentScore ?? 50),
    functionalOverall: parseFloat(raw.functionalOverall ?? raw.currentScore ?? 50),
    leadershipOverall: raw.leadershipOverall != null ? parseFloat(raw.leadershipOverall) : null,
    competencies: buildCompetencies(raw, role),
    ...hidden,
    recentTrainingBoost: 0,
    recentCoachingBoost: 0,
    overallHistory: history.length ? history : [parseFloat(raw.currentScore ?? 50)],
  }
}

function roleRelevance(role, name) {
  if (COMMON_CORRESPONDENCE.includes(name)) return role===ROLE_CSO ? 1.0 : role===ROLE_TL ? 0.92 : 0.80
  if (COMMON_CORE.includes(name)) return 1.0
  if (FUNCTIONAL.includes(name)) return role===ROLE_SUP ? 1.05 : 1.0
  if (LEADERSHIP.includes(name)) return role===ROLE_SUP ? 1.0 : 0.35
  return 1.0
}

function runProjection(raw, role, scenarioName, seed = 42, days = 90) {
  const sc = SCENARIOS[scenarioName]
  const rng = makeRng(seed)

  // Build scenario-adjusted weights
  const base = { ...ROLE_BASE_EVENT_WEIGHTS[role] }
  for (const [ev, mult] of Object.entries(sc.weightMult)) { if (base[ev] != null) base[ev] *= mult }
  const weights = normaliseWeights(base)

  const state = buildState(raw, role)
  const target = ROLE_TARGET_LEVELS[role]
  const daily = []
  let curDate = new Date(state.latestDate + 'T00:00:00')

  for (let d = 0; d < days; d++) {
    curDate = new Date(curDate.getTime() + 86400000)
    const dateStr = curDate.toISOString().slice(0,10)
    const eventCode = weightedChoice(weights, rng)
    const eventMeta = EVENT_METADATA[eventCode]

    const beforeScore   = state.overallScore
    const beforeFatigue = state.fatigue
    const beforeMomentum = state.momentum
    const beforeStatus  = state.overallStatus

    // Apply hidden effects
    const heff = EVENT_HIDDEN_EFFECTS[eventCode]
    state.fatigue              = clamp(state.fatigue              + heff.fatigue       * sc.fatigueMult,   0, 1)
    state.momentum             = clamp(state.momentum             + heff.momentum      * sc.growthMult,    0, 1)
    state.stability            = clamp(state.stability            + heff.stability     / Math.max(0.5, sc.volatilityMult), 0, 1)
    state.recentTrainingBoost  = clamp(state.recentTrainingBoost  + heff.trainingBoost * sc.growthMult,    0, 1)
    state.recentCoachingBoost  = clamp(state.recentCoachingBoost  + heff.coachingBoost * sc.growthMult,    0, 1)

    // Apply competency effects
    const effects = EVENT_COMPETENCY_EFFECTS[eventCode] || {}
    const compChanges = []

    for (const [compName, baseEffect] of Object.entries(effects)) {
      const comp = state.competencies[compName]
      if (!comp) continue
      // Update plateau
      const dist = Math.max(0, target - comp.level)
      comp.plateauFactor = target <= 1 ? 0 : clamp(1 - clamp(dist / (target - 1), 0, 1), 0, 0.95)

      const delta = baseEffect
        * (rng() * 0.5 + 0.65)
        * (1.0 - state.fatigue * 0.55 * comp.fatigueSensitivity)
        * (1.0 + state.momentum * 0.30)
        * (1.0 + state.recentTrainingBoost * 0.18)
        * (1.0 + state.recentCoachingBoost * 0.16)
        * (1.0 - comp.plateauFactor * 0.55)
        * roleRelevance(role, compName)
        * (rng() * 0.16 + 0.92) * sc.volatilityMult
        * sc.growthMult

      const before = comp.score
      comp.score = clamp(comp.score + delta, 0, 100)
      comp.level = scoreToLevel(comp.score)
      comp.recentHistory = [...comp.recentHistory, comp.score].slice(-14)
      comp.status = trendStatusFromWindow(comp.recentHistory)
      comp.momentum = clamp(comp.momentum * 0.95 + Math.max(0, delta) * 0.02, 0, 1)
      compChanges.push({ name:compName, family:comp.family, deltaScore:+(comp.score-before).toFixed(3), afterScore:+comp.score.toFixed(3) })
    }

    // Drift unaffected competencies
    for (const comp of Object.values(state.competencies)) {
      if (effects[comp.name] != null) continue
      let drift = 0
      if      (eventCode === 'ROUTINE')    drift =  0.015
      else if (eventCode === 'RECOVERY')   drift =  0.005
      else if (eventCode === 'ESCALATION') drift = -0.01 * (1 + state.fatigue * 0.3)
      if (Math.abs(drift) < 1e-9) continue
      const before = comp.score
      comp.score = clamp(comp.score + drift, 0, 100)
      comp.level = scoreToLevel(comp.score)
      comp.recentHistory = [...comp.recentHistory, comp.score].slice(-14)
      comp.status = trendStatusFromWindow(comp.recentHistory)
      compChanges.push({ name:comp.name, family:comp.family, deltaScore:+(comp.score-before).toFixed(3), afterScore:+comp.score.toFixed(3) })
    }

    // Decay hidden state
    state.recentTrainingBoost = clamp(state.recentTrainingBoost * 0.94, 0, 1)
    state.recentCoachingBoost = clamp(state.recentCoachingBoost * 0.90, 0, 1)
    state.momentum            = clamp(state.momentum            * 0.995, 0, 1)
    state.fatigue             = clamp(state.fatigue - 0.015 * sc.recoveryMult, 0, 1)

    // Recompute overall score
    const cS = Object.values(state.competencies).filter(c=>c.family==='correspondence').map(c=>c.score)
    const fS = Object.values(state.competencies).filter(c=>c.family==='functional').map(c=>c.score)
    const lS = Object.values(state.competencies).filter(c=>c.family==='leadership').map(c=>c.score)
    const kS = Object.values(state.competencies).filter(c=>c.family==='core').map(c=>c.score)
    state.correspondenceOverall = safeMean(cS, state.overallScore)
    state.functionalOverall     = safeMean(fS, state.overallScore)
    state.leadershipOverall     = lS.length ? safeMean(lS, state.overallScore) : null
    let overall
    if (role === ROLE_SUP) {
      overall = 0.22*state.correspondenceOverall + 0.28*state.functionalOverall + 0.25*safeMean(kS,state.overallScore) + 0.25*(state.leadershipOverall||0)
    } else {
      overall = 0.30*state.correspondenceOverall + 0.35*state.functionalOverall + 0.35*safeMean(kS,state.overallScore)
    }
    state.overallScore  = clamp(overall, 0, 100)
    state.overallLevel  = scoreToLevel(state.overallScore)
    state.overallHistory= [...state.overallHistory, state.overallScore].slice(-14)
    state.overallStatus = trendStatusFromWindow(state.overallHistory)

    // Driver tags
    const tags = [eventCode.toLowerCase()]
    if (state.fatigue   >= 0.60) tags.push('high_fatigue')
    if (state.momentum  >= 0.55) tags.push('strong_momentum')
    if (state.recentTrainingBoost >= 0.15) tags.push('recent_training_effect')
    if (state.recentCoachingBoost >= 0.15) tags.push('recent_coaching_effect')

    compChanges.sort((a,b) => Math.abs(b.deltaScore) - Math.abs(a.deltaScore))

    daily.push({
      date: dateStr,
      day: d + 1,
      projectedOverallScore: +state.overallScore.toFixed(2),
      projectedOverallStatus: state.overallStatus,
      overallScoreDelta: +(state.overallScore - beforeScore).toFixed(3),
      event: { eventCode, eventLabel:eventMeta.label, driverTags:tags, explanation:eventMeta.explanation },
      stateDiagnostics: { fatigueBefore:+beforeFatigue.toFixed(3), fatigueAfter:+state.fatigue.toFixed(3), momentumBefore:+beforeMomentum.toFixed(3), momentumAfter:+state.momentum.toFixed(3) },
      statusBefore: beforeStatus,
      statusAfter: state.overallStatus,
      topCompetencyChanges: compChanges.slice(0,5),
    })
  }

  return {
    officerId: state.officerId,
    role,
    scenario: scenarioName,
    projectedFinal: {
      overallScore:           +state.overallScore.toFixed(2),
      overallStatus:          state.overallStatus,
      correspondenceOverall:  +state.correspondenceOverall.toFixed(2),
      functionalOverall:      +state.functionalOverall.toFixed(2),
      leadershipOverall:      state.leadershipOverall != null ? +state.leadershipOverall.toFixed(2) : null,
    },
    dailyProjection: daily,
  }
}

function runAllScenarios(raw, role) {
  return {
    baseline:  runProjection(raw, role, 'baseline',  42),
    best_case: runProjection(raw, role, 'best_case',  42),
    worst_case:runProjection(raw, role, 'worst_case', 42),
  }
}

// Sample every 3 days for chart performance
function buildChartData(allScenarios, baseScore) {
  const bl = allScenarios.baseline.dailyProjection
  const bc = allScenarios.best_case.dailyProjection
  const wc = allScenarios.worst_case.dailyProjection
  const result = [{ day:0, baseline:+baseScore.toFixed(1), best_case:+baseScore.toFixed(1), worst_case:+baseScore.toFixed(1) }]
  for (let i = 0; i < bl.length; i += 3) {
    result.push({ day:bl[i].day, date:bl[i].date, baseline:bl[i].projectedOverallScore, best_case:bc[i].projectedOverallScore, worst_case:wc[i].projectedOverallScore, eventCode:bl[i].event.eventCode, eventLabel:bl[i].event.eventLabel })
  }
  const last = bl[bl.length-1]
  if (result[result.length-1].day !== last.day) {
    result.push({ day:last.day, date:last.date, baseline:last.projectedOverallScore, best_case:bc[bc.length-1].projectedOverallScore, worst_case:wc[wc.length-1].projectedOverallScore })
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function StatCard({ label, value, sub, badge, badgeColor, iconBg, iconColor, iconPath }) {
  return (
    <div style={{ background:'white', borderRadius:'14px', boxShadow:'0 1px 4px rgba(0,0,0,0.07)', padding:'22px 24px', flex:1, minWidth:0 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'14px' }}>
        <div style={{ fontSize:'12px', fontWeight:'600', color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
        <div style={{ width:'36px', height:'36px', borderRadius:'10px', background:iconBg, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{iconPath}</svg>
        </div>
      </div>
      <div style={{ fontSize:'28px', fontWeight:'800', color:'#111827', lineHeight:'1', letterSpacing:'-0.02em' }}>{value}</div>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'6px', flexWrap:'wrap' }}>
        {sub   && <div style={{ fontSize:'12px', color:'#9ca3af' }}>{sub}</div>}
        {badge && <div style={{ background:badgeColor.bg, color:badgeColor.text, borderRadius:'20px', padding:'2px 8px', fontSize:'11px', fontWeight:'600' }}>{badge}</div>}
      </div>
    </div>
  )
}

function ForecastTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  return (
    <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'12px 16px', boxShadow:'0 4px 16px rgba(0,0,0,0.1)', minWidth:'190px', fontFamily:"'Inter',sans-serif" }}>
      <div style={{ fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'4px' }}>{p?.day === 0 ? 'Now' : `Day ${p?.day}`}</div>
      {p?.eventLabel && <div style={{ fontSize:'11px', color:'#9ca3af', marginBottom:'8px', fontStyle:'italic' }}>{p.eventLabel}</div>}
      {payload.map((e,i) => e.value != null && (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'3px' }}>
          <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:e.stroke||e.color, flexShrink:0 }}/>
          <span style={{ fontSize:'12px', color:'#6b7280', flex:1 }}>{e.name}</span>
          <span style={{ fontSize:'13px', fontWeight:'600', color:'#111827' }}>{e.value.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════

export default function ForecastPage() {
  const { viewingAs, user } = useAuth()
  const [rawData, setRawData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(null)

  const officerRole = viewingAs?.role || user?.role || 'CSO'

  useEffect(() => {
    const id = viewingAs?.id || ''
    const url = `/api/competency-breakdown${id ? `?officerId=${id}` : ''}`
    setLoading(true)
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(d => { setRawData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [viewingAs?.id])

  const role = useMemo(() => toDesRole(officerRole), [officerRole])

  const allScenarios = useMemo(() => {
    if (!rawData) return null
    return runAllScenarios(rawData, role)
  }, [rawData, role])

  const baseScore = rawData?.currentScore ?? 50
  const chartData = useMemo(() => allScenarios ? buildChartData(allScenarios, baseScore) : [], [allScenarios, baseScore])

  if (loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', fontFamily:"'Inter',-apple-system,sans-serif" }}>
        <Topbar title="3-Month Performance Forecast" subtitle="Loading officer data..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ fontSize:'14px', color:'#9ca3af' }}>Running simulation...</div>
        </div>
      </div>
    )
  }

  if (!allScenarios) return null

  const baseline  = allScenarios.baseline
  const bestCase  = allScenarios.best_case
  const worstCase = allScenarios.worst_case

  const baselineFinal = baseline.projectedFinal.overallScore
  const delta    = baselineFinal - baseScore
  const deltaPos = delta >= 0

  const selectedEvent = selectedDay != null
    ? baseline.dailyProjection.find(d => d.day === selectedDay) || null
    : null

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', fontFamily:"'Inter',-apple-system,sans-serif" }}>
      <Topbar
        title="3-Month Performance Forecast"
        subtitle={`Discrete Event Simulation · 3 scenarios · Data as of ${rawData?.latestDate || '—'}`}
      />

      <div style={{ flex:1, overflow:'auto', padding:'24px', display:'flex', flexDirection:'column', gap:'20px' }}>

        {/* Stat cards */}
        <div style={{ display:'flex', gap:'16px' }}>
          <StatCard
            label="Baseline Forecast"
            value={`${baselineFinal.toFixed(1)}%`}
            sub="At day 90 (baseline)"
            badge={`${deltaPos?'+':''}${delta.toFixed(1)}% from now`}
            badgeColor={deltaPos ? { bg:'#dcfce7', text:'#166534' } : { bg:'#fef2f2', text:'#dc2626' }}
            iconBg="#e8f5f0" iconColor="#1e3a35"
            iconPath={<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>}
          />
          <StatCard
            label="Best Case"
            value={`${bestCase.projectedFinal.overallScore.toFixed(1)}%`}
            sub="Optimistic scenario at day 90"
            badge={bestCase.projectedFinal.overallStatus}
            badgeColor={{ bg:'#dcfce7', text:'#166534' }}
            iconBg="#f0fdf4" iconColor="#16a34a"
            iconPath={<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>}
          />
          <StatCard
            label="Worst Case"
            value={`${worstCase.projectedFinal.overallScore.toFixed(1)}%`}
            sub="Pessimistic scenario at day 90"
            badge={worstCase.projectedFinal.overallStatus}
            badgeColor={{ bg:'#fef2f2', text:'#dc2626' }}
            iconBg="#fff7ed" iconColor="#f97316"
            iconPath={<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>}
          />
        </div>

        {/* Scenario comparison chart */}
        <div style={{ background:'white', borderRadius:'14px', boxShadow:'0 1px 4px rgba(0,0,0,0.07)', padding:'24px' }}>
          <div style={{ marginBottom:'20px' }}>
            <div style={{ fontSize:'15px', fontWeight:'700', color:'#111827' }}>Scenario Comparison — 90-Day Projection</div>
            <div style={{ fontSize:'12px', color:'#9ca3af', marginTop:'3px' }}>
              Starting at {(+baseScore).toFixed(1)}% — click any point to see that day's event details
            </div>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top:10, right:24, left:-10, bottom:0 }}
              onClick={e => { if (e?.activePayload?.[0]?.payload?.day > 0) setSelectedDay(e.activePayload[0].payload.day) }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#f0f0f0" vertical={false}/>
              <XAxis dataKey="day" type="number" domain={[0,90]} ticks={[0,30,60,90]}
                tickFormatter={d => d===0?'Now':`M${d/30}`}
                tick={{ fontSize:11, fill:'#9ca3af' }} axisLine={false} tickLine={false}/>
              <YAxis domain={[dataMin => Math.max(0, Math.floor(dataMin - 3)), dataMax => Math.min(100, Math.ceil(dataMax + 3))]}
                tick={{ fontSize:11, fill:'#9ca3af' }} axisLine={false} tickLine={false}
                tickFormatter={v=>`${v}%`}/>
              <Tooltip content={<ForecastTooltip/>}/>
              <ReferenceLine y={60} stroke="#f97316" strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value:'Coaching (60%)', position:'insideTopRight', fontSize:10, fill:'#f97316', fontFamily:'Inter,sans-serif' }}/>
              <ReferenceLine y={80} stroke="#16a34a" strokeWidth={2}
                label={{ value:'Pass (80%)', position:'insideTopRight', fontSize:10, fill:'#16a34a', fontFamily:'Inter,sans-serif' }}/>
              <Line type="monotone" dataKey="worst_case" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Worst Case"/>
              <Line type="monotone" dataKey="best_case"  stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Best Case"/>
              <Line type="monotone" dataKey="baseline"   stroke="#1e3a35" strokeWidth={2.5} dot={false} name="Baseline"/>
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{ display:'flex', justifyContent:'center', gap:'20px', marginTop:'14px' }}>
            {[['#1e3a35','Baseline',null],['#22c55e','Best Case','4 2'],['#ef4444','Worst Case','4 2']].map(([color,label,dash]) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'#6b7280' }}>
                <svg width="20" height="10" viewBox="0 0 20 10">
                  <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth={dash?'1.5':'2.5'} strokeDasharray={dash??'none'}/>
                </svg>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Selected day event detail */}
        {selectedEvent && (
          <div style={{ background:'white', borderRadius:'14px', boxShadow:'0 1px 4px rgba(0,0,0,0.07)', padding:'20px 24px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'10px' }}>
              <div style={{ fontSize:'14px', fontWeight:'700', color:'#111827' }}>
                Day {selectedEvent.day} — {selectedEvent.event.eventLabel}
              </div>
              <div style={{ fontSize:'12px', color:'#9ca3af', marginLeft:'auto' }}>{selectedEvent.date}</div>
              <button onClick={() => setSelectedDay(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:'16px', lineHeight:1 }}>✕</button>
            </div>
            <div style={{ fontSize:'13px', color:'#6b7280', marginBottom:'12px' }}>{selectedEvent.event.explanation}</div>
            <div style={{ display:'flex', gap:'24px', fontSize:'12px', flexWrap:'wrap' }}>
              <span style={{ color:'#9ca3af' }}>Score: <strong style={{ color:'#111827' }}>{selectedEvent.projectedOverallScore.toFixed(1)}%</strong></span>
              <span style={{ color:'#9ca3af' }}>Delta: <strong style={{ color:selectedEvent.overallScoreDelta>=0?'#16a34a':'#dc2626' }}>{selectedEvent.overallScoreDelta>=0?'+':''}{selectedEvent.overallScoreDelta.toFixed(2)}</strong></span>
              <span style={{ color:'#9ca3af' }}>Fatigue: <strong style={{ color:'#111827' }}>{(selectedEvent.stateDiagnostics.fatigueAfter*100).toFixed(0)}%</strong></span>
              <span style={{ color:'#9ca3af' }}>Momentum: <strong style={{ color:'#111827' }}>{(selectedEvent.stateDiagnostics.momentumAfter*100).toFixed(0)}%</strong></span>
              <span style={{ color:'#9ca3af' }}>Status: <strong style={{ color:'#111827' }}>{selectedEvent.statusAfter}</strong></span>
            </div>
            {selectedEvent.topCompetencyChanges.length > 0 && (
              <div style={{ marginTop:'12px' }}>
                <div style={{ fontSize:'11px', fontWeight:'600', color:'#9ca3af', textTransform:'uppercase', marginBottom:'6px' }}>Top Competency Changes</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                  {selectedEvent.topCompetencyChanges.map(c => (
                    <div key={c.name} style={{ background:c.deltaScore>=0?'#f0fdf4':'#fef2f2', border:`1px solid ${c.deltaScore>=0?'#bbf7d0':'#fecaca'}`, borderRadius:'6px', padding:'4px 10px', fontSize:'11px', color:c.deltaScore>=0?'#166534':'#dc2626' }}>
                      {c.name}: {c.deltaScore>=0?'+':''}{c.deltaScore.toFixed(2)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Day 90 final state comparison */}
        <div style={{ background:'white', borderRadius:'14px', boxShadow:'0 1px 4px rgba(0,0,0,0.07)', padding:'24px' }}>
          <div style={{ fontSize:'15px', fontWeight:'700', color:'#111827', marginBottom:'16px' }}>Day 90 Projected Final State</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'16px' }}>
            {[
              { label:'Baseline',   color:'#1e3a35', bg:'#f9fafb', result:baseline.projectedFinal },
              { label:'Best Case',  color:'#16a34a', bg:'#f0fdf4', result:bestCase.projectedFinal },
              { label:'Worst Case', color:'#dc2626', bg:'#fef2f2', result:worstCase.projectedFinal },
            ].map(({ label, color, bg, result }) => (
              <div key={label} style={{ background:bg, borderRadius:'10px', padding:'16px' }}>
                <div style={{ fontSize:'12px', fontWeight:'700', color, marginBottom:'10px' }}>{label}</div>
                {[
                  ['Overall',        `${result.overallScore.toFixed(1)}%`],
                  ['Correspondence', `${result.correspondenceOverall.toFixed(1)}%`],
                  ['Functional',     `${result.functionalOverall.toFixed(1)}%`],
                  ...(result.leadershipOverall != null ? [['Leadership', `${result.leadershipOverall.toFixed(1)}%`]] : []),
                  ['Status',         result.overallStatus],
                ].map(([k,v]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', marginBottom:'4px' }}>
                    <span style={{ color:'#6b7280' }}>{k}</span>
                    <span style={{ fontWeight:'600', color:'#111827' }}>{v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
