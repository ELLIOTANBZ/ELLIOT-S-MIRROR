import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { loadInjections, saveInjection } from '../utils/storage'

// ─── Rank-based competency configuration ─────────────────────────────────────

const CORE_COMPETENCIES = `CPF 6 Core Competencies:
1. Thinking Clearly & Making Sound Judgements — Basic: gathers info, practical solutions / Intermediate: balances stakeholder interests, anticipates concerns / Advanced: weighs ethics, strategic oversight
2. Working as a Team — Basic: collaborates within team / Intermediate: coordinates across teams / Advanced: drives cross-functional cohesion
3. Working Effectively with Citizens & Stakeholders — Basic: responds accurately, professional tone / Intermediate: anticipates needs, personalises responses / Advanced: builds trust, handles sensitive cases
4. Keep Learning & Putting Skills into Action — Basic: applies existing knowledge / Intermediate: seeks new knowledge, applies to novel situations / Advanced: mentors others
5. Improving & Innovating Continuously — Basic: follows processes / Intermediate: proactively identifies gaps / Advanced: drives systemic change
6. Serving with Heart, Commitment & Purpose — Basic: meets service standards / Intermediate: genuine care for member outcomes / Advanced: embodies service excellence`

const CORRESPONDENCE_CLUSTERS = `4 Correspondence Competency Clusters:
1. Tone & Professional Standards — Courtesy, Confidentiality, Email Writing SOG compliance. Basic: compliant / Intermediate: consistently warm and professional / Advanced: models exemplary correspondence standards
2. Clarity & Member Understanding — Clear and Easy, Comprehend Customer's Intent, Create Meaningful Conversations. Basic: understandable / Intermediate: tailored to member context / Advanced: anticipates and preempts confusion
3. Accuracy & Completeness — Correct Information, Complete Information, Verified Mistake. Basic: no critical errors / Intermediate: proactively verifies and fills gaps / Advanced: quality-checks own work systematically
4. Digital Awareness & Advocacy — Cultivate Awareness of Digital Resources. Basic: mentions digital options / Intermediate: contextually recommends appropriate channels / Advanced: champions digital self-service adoption`

const TL_COMPETENCIES = `Team Leader Additional Competencies:
7. Coaching & Feedback Quality — Basic: provides feedback when asked / Intermediate: proactively coaches for improvement / Advanced: develops tailored coaching plans per officer
8. Escalation Decision-Making — Basic: escalates appropriately / Intermediate: escalates with context and recommended action / Advanced: minimises unnecessary escalations through proactive resolution
9. Workload Delegation — Basic: assigns tasks / Intermediate: delegates based on officer strengths / Advanced: builds officer capability through stretch assignments
10. Communication Clarity (Upward/Downward) — Basic: communicates key information / Intermediate: frames messages appropriately for audience / Advanced: drives alignment across levels`

const SUPERVISOR_COMPETENCIES = `Supervisor Additional Competency:
11. Strategic Oversight & Team Performance Management — Basic: monitors team KPIs / Intermediate: identifies systemic issues and drives corrective action / Advanced: shapes team strategy and builds sustainable performance culture`

const RANK_EVAL_INSTRUCTION = {
  CSO:        'Evaluate all 6 Core Competencies, 4 Correspondence Competency Clusters, and 10 Auditmate indicators.',
  TL:         'Evaluate all 6 Core Competencies, 4 Correspondence Competency Clusters, 4 Team Leader Competencies, and 10 Auditmate indicators.',
  Supervisor: 'Evaluate all 6 Core Competencies, 4 Correspondence Competency Clusters, 4 Team Leader Competencies, 1 Supervisor Competency, and 10 Auditmate indicators.',
}

function buildSystemPrompt(role) {
  const domains = [CORE_COMPETENCIES, CORRESPONDENCE_CLUSTERS]
  if (role === 'TL' || role === 'Supervisor') domains.push(TL_COMPETENCIES)
  if (role === 'Supervisor') domains.push(SUPERVISOR_COMPETENCIES)

  return `You are a CPF (Central Provident Fund) correspondence quality evaluator. You evaluate officer performance using two sources: Auditmate (internal audit) and ESS (Email Satisfaction Survey from the member).

${domains.join('\n\n')}

Auditmate 10 Indicators (Pass/Fail): Courtesy, Confidentiality, Comprehend Customer's Intent, Comply to Email Writing SOG, Correct Information, Complete Information, Clear and Easy, Create Meaningful Conversations, Cultivate Awareness of Digital Resources, Verified Mistake

Level calibration rules (apply these to determine competency levels):
- Passing indicators confirms process compliance but alone only evidences Basic. Read the indicator EXPLANATIONS and SUGGESTIONS for quality signals beyond pass/fail.
- If Auditmate score ≥ 80% AND no critical failures (Correct Information, Complete Information) AND ESS is neutral-to-positive → default to Intermediate for most competencies unless explanations reveal clear gaps.
- If Auditmate score = 100% AND ESS is positive/very positive → consider Advanced for competencies directly evidenced by the data.
- If Auditmate score < 60% OR critical indicators failed → Basic is appropriate.
- ESS positive verbatim (e.g. "helpful", "clear", "went above and beyond") is strong evidence of Intermediate or Advanced for citizen-facing competencies.
- ESS negative verbatim overrides a high indicator score for citizen-facing competencies.
- Do NOT default every competency to Basic when evidence is limited — use the score and ESS sentiment as calibration anchors. Absence of negative evidence + strong score = Intermediate.
- For TL/Supervisor-only competencies where direct evidence is limited, infer from communication style, decision patterns, and any team-related signals in the data.
- IMPORTANT: Do NOT evaluate or include "Workload Delegation" or "Strategic Oversight & Team Performance Management" in the competencies array. These require direct observation and will be assessed separately by a supervisor. Omit them entirely.

Return ONLY valid JSON:
{
  "competencies": [
    {
      "name": "competency name",
      "current_level": "Basic"|"Intermediate"|"Advanced",
      "target_level": "Intermediate"|"Advanced"|"Sustained",
      "level_rationale": "One sentence citing the specific evidence (score, indicator result, or ESS comment) that determined this level.",
      "strengths": [
        { "point": "specific positive behaviour demonstrated, cited from evidence", "source": "auditmate"|"ess" }
      ],
      "gap_actions": [
        { "action": "specific gap observed from evidence", "source": "auditmate"|"ess" }
      ],
      "next_level_steps": [
        "Concrete, specific action the officer can actively do to reach the next level. 2–4 steps. If already Advanced, steps to sustain it."
      ]
    }
  ],
  "indicators": [
    { "name": "indicator name", "pass": true|false, "reason": "one line" }
  ],
  "indicators_passed": number,
  "overall_level": "Basic"|"Intermediate"|"Advanced",
  "ess_signals": [
    { "signal": "what ESS reveals about officer behaviour", "positive": true|false }
  ],
  "ess_rating_interpretation": "one sentence on what this rating means"
}`
}

const RATING_LABELS = {
  1: 'Very Dissatisfied',
  2: 'Dissatisfied',
  3: 'Neutral',
  4: 'Satisfied',
  5: 'Very Satisfied',
}

// ─── ESS multi-survey helpers ─────────────────────────────────────────────────

const EMPTY_SURVEYS = () => Array(4).fill(null).map(() => ({ rating: 0, verbatim: '' }))

/** Survey N+1 becomes visible once survey N has both a rating AND non-blank verbatim. */
function getVisibleEssCount(surveys) {
  let visible = 1
  for (let i = 0; i < surveys.length - 1; i++) {
    if (surveys[i].rating > 0 && surveys[i].verbatim.trim() !== '') {
      visible = i + 2
    } else {
      break
    }
  }
  return Math.min(visible, surveys.length)
}

// ─── Excel parsing ────────────────────────────────────────────────────────────

// Each indicator spans 4 columns: [col]=pass/fail, [+1]=score, [+2]=explanation, [+3]=suggestions
const INDICATOR_COLS = [
  { name: 'Courtesy',                        col: 0  },
  { name: 'Confidentiality',                 col: 4  },
  { name: "Comprehend Customer's Intent",    col: 8  },
  { name: 'Comply to Email Writing SOG',     col: 12 },
  { name: 'Correct Information',             col: 16 },
  { name: 'Complete Information',            col: 20 },
  { name: 'Clear and Easy',                  col: 24 },
  { name: 'Create Meaningful Conversations', col: 28 },
  { name: 'Cultivate Digital Awareness',     col: 32 },
  { name: 'Verified Mistake',                col: 36 },
]

function parseAuditSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (rows.length < 2) return null
  const d = rows[1]
  return {
    indicators: INDICATOR_COLS.map(({ name, col }) => ({
      name,
      pass:        String(d[col]).toLowerCase() === 'yes',
      score:       String(d[col + 1] || ''),
      explanation: String(d[col + 2] || ''),
      suggestions: String(d[col + 3] || ''),
    })),
    totalScore:         String(d[40] || ''),
    caseClassification: String(d[41] || ''),
    auditorComments:    String(d[42] || ''),
  }
}

/** Format parsed Excel case as structured text context for the LLM */
function formatExcelContext(caseData) {
  const lines = [`[Auditmate Pre-Assessment — Total Score: ${caseData.totalScore}]`]
  if (caseData.auditorComments) lines.push(`Auditor Comments: ${caseData.auditorComments}`)
  lines.push('')
  caseData.indicators.forEach((ind, i) => {
    lines.push(`Indicator ${i + 1} (${ind.name}): ${ind.pass ? 'PASS' : 'FAIL'} (${ind.score})`)
    if (ind.explanation) lines.push(`  Assessment: ${ind.explanation}`)
    if (ind.suggestions) lines.push(`  Suggestions: ${ind.suggestions}`)
    lines.push('')
  })
  return lines.join('\n').trim()
}

/** Convert parsed Excel indicators to the panel-display format */
function excelIndicatorsToResultFormat(caseData) {
  return caseData.indicators.map(ind => ({
    name:   ind.name,
    pass:   ind.pass,
    // Use first sentence of explanation for passed; first sentence of suggestions for failed
    reason: ind.pass
      ? (ind.explanation || '').split('.')[0].trim() || 'Passed'
      : (ind.suggestions || '').split('.')[0].trim() || 'Failed',
  }))
}

// ─── Design helpers ───────────────────────────────────────────────────────────

function levelColors(level) {
  if (level === 'Advanced')     return { bg: '#e8f5f0', text: '#0f6e56', dot: '#1d9e75' }
  if (level === 'Intermediate') return { bg: '#e6f1fb', text: '#185FA5', dot: '#3b82f6' }
  return                               { bg: '#faeeda', text: '#854F0B', dot: '#f59e0b' }
}

function levelPipCount(level) {
  if (level === 'Advanced')     return 3
  if (level === 'Intermediate') return 2
  return 1
}

// ─── Shared components ────────────────────────────────────────────────────────

function LevelBadge({ level }) {
  const c = levelColors(level)
  return (
    <span style={{
      background: c.bg, color: c.text,
      padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {level}
    </span>
  )
}

function ProgressPips({ level }) {
  const filled = levelPipCount(level)
  const c = levelColors(level)
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          flex: 1, height: 5, borderRadius: 3,
          background: i <= filled ? c.dot : '#e2ede7',
        }} />
      ))}
    </div>
  )
}

function SourceBadge({ source }) {
  const isAudit = source === 'auditmate'
  return (
    <span style={{
      background: isAudit ? '#dbeafe' : '#fef3c7',
      color: isAudit ? '#1d4ed8' : '#92400e',
      padding: '1px 7px', borderRadius: 10,
      fontSize: 10, fontWeight: 700, flexShrink: 0,
    }}>
      {isAudit ? 'Auditmate' : 'ESS'}
    </span>
  )
}

function StarDisplay({ rating, size = 18, interactive = false, onRate }) {
  const [hover, setHover] = useState(0)
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          onClick={interactive ? () => onRate(i) : undefined}
          onMouseEnter={interactive ? () => setHover(i) : undefined}
          onMouseLeave={interactive ? () => setHover(0) : undefined}
          style={{
            background: 'none', border: 'none', padding: 1,
            fontSize: size, lineHeight: 1,
            color: i <= (hover || rating) ? '#f59e0b' : '#d1d5db',
            cursor: interactive ? 'pointer' : 'default',
            transition: 'color 0.1s',
          }}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
      <path d="M8 2 A6 6 0 0 1 14 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

// ─── Excel upload sub-component ───────────────────────────────────────────────

/** Mini pass/fail grid shown after a file is loaded */
function IndicatorMiniGrid({ caseData }) {
  const passed = caseData.indicators.filter(i => i.pass).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Score row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          background: passed >= 8 ? '#e8f5f0' : passed >= 5 ? '#fef3c7' : '#fef2f2',
          color:      passed >= 8 ? '#0f6e56' : passed >= 5 ? '#92400e' : '#dc2626',
          padding: '2px 10px', borderRadius: 20,
          fontSize: 12, fontWeight: 800,
        }}>
          {passed}/10 passed
        </span>
        {caseData.totalScore && (
          <span style={{ fontSize: 12, color: '#6b8c7d' }}>
            Total score: <strong>{caseData.totalScore}</strong>
          </span>
        )}
      </div>

      {/* Indicator dots grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px' }}>
        {caseData.indicators.map((ind, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: ind.pass ? '#1d9e75' : '#ef4444',
            }} />
            <span style={{ fontSize: 11, color: '#374a3f' }}>{ind.name}</span>
          </div>
        ))}
      </div>

      {caseData.auditorComments && (
        <div style={{
          background: '#f8fdfb', border: '1px solid #d5e8df',
          borderRadius: 7, padding: '7px 10px',
          fontSize: 11, color: '#374a3f', lineHeight: 1.5,
        }}>
          <span style={{ fontWeight: 600, color: '#1a2e26' }}>Auditor: </span>
          {caseData.auditorComments}
        </div>
      )}
    </div>
  )
}

function AuditExcelUpload({ excelCases, selectedCaseIdx, setSelectedCaseIdx, onExcelLoad, onClear }) {
  const fileRef = useRef()

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' })
        const cases = wb.SheetNames
          .map(name => ({ sheetName: name, caseData: parseAuditSheet(wb.Sheets[name]) }))
          .filter(c => c.caseData !== null)
        if (cases.length === 0) {
          alert('No readable Case Report sheets found in this file.')
          return
        }
        onExcelLoad(cases)
      } catch {
        alert('Could not parse Excel file. Make sure it matches the Auditmate export format.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleInputChange(e) { handleFile(e.target.files[0]) }

  function handleDrop(e) {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  if (excelCases.length === 0) {
    // Drop zone
    return (
      <div
        onClick={() => fileRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        style={{
          minHeight: 220,
          border: '2px dashed #b2d8c8',
          borderRadius: 10,
          background: '#f8fdfb',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#1d9e75'; e.currentTarget.style.background = '#f0faf5' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#b2d8c8'; e.currentTarget.style.background = '#f8fdfb' }}
      >
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <rect width="36" height="36" rx="10" fill="#e8f5f0"/>
          <path d="M18 10 L18 22 M13 17 L18 22 L23 17" stroke="#1d9e75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M11 26 L25 26" stroke="#1d9e75" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2e26' }}>Drop Auditmate Excel here</div>
          <div style={{ fontSize: 12, color: '#6b8c7d', marginTop: 2 }}>or click to browse — .xlsx</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
      </div>
    )
  }

  // File loaded — show case selector + indicator preview
  const currentCase = excelCases[selectedCaseIdx]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* File info row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          background: '#e8f5f0', borderRadius: 7,
          padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#0f6e56',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect width="12" height="12" rx="3" fill="#1d9e75"/>
            <path d="M3 6 L5 8 L9 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Excel loaded · {excelCases.length} case{excelCases.length > 1 ? 's' : ''}
        </div>

        {/* Case selector — only if multiple sheets */}
        {excelCases.length > 1 && (
          <select
            value={selectedCaseIdx}
            onChange={e => setSelectedCaseIdx(+e.target.value)}
            style={{
              border: '1px solid #d5e8df', borderRadius: 7,
              padding: '4px 10px', fontSize: 12, color: '#1a2e26',
              background: '#fff', outline: 'none',
            }}
          >
            {excelCases.map((c, i) => (
              <option key={i} value={i}>{c.sheetName}</option>
            ))}
          </select>
        )}

        <button
          onClick={() => { onClear(); if (fileRef.current) fileRef.current.value = '' }}
          style={{
            marginLeft: 'auto',
            background: 'none', border: '1px solid #fecaca',
            borderRadius: 6, padding: '3px 8px',
            fontSize: 11, color: '#dc2626', cursor: 'pointer',
          }}
        >
          Remove
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* Indicator mini-grid */}
      <div style={{
        background: '#f8fdfb', border: '1px solid #d5e8df',
        borderRadius: 10, padding: '12px 14px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b8c7d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          {excelCases.length > 1 ? `Case: ${currentCase.sheetName}` : 'Auditmate Results'}
        </div>
        <IndicatorMiniGrid caseData={currentCase.caseData} />
      </div>
    </div>
  )
}

// ─── Input Section ────────────────────────────────────────────────────────────

function InputSection({
  auditMode, setAuditMode,
  emailText, setEmailText,
  excelCases, selectedCaseIdx, setSelectedCaseIdx, onExcelLoad, onExcelClear,
  essSurveys, updateEssSurvey,
  onAnalyse, isLoading, error,
}) {
  const tabStyle = active => ({
    padding: '5px 14px', fontSize: 12, fontWeight: 600,
    border: 'none', borderRadius: 6, cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? '#1a2e26' : '#6b8c7d',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
    transition: 'all 0.15s',
  })

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2e26', marginBottom: 4 }}>
          Officer Performance Analysis
        </h1>
        <p style={{ color: '#6b8c7d', fontSize: 14 }}>
          Load the Auditmate case report and ESS feedback, then run the analysis.
        </p>
      </div>

      <div style={{
        background: '#fff', border: '0.5px solid #cde5d8',
        borderRadius: 14, padding: 24,
        boxShadow: '0 1px 4px rgba(10,74,58,0.06)',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Left — Auditmate */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Header + mode toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: '#dbeafe', color: '#1d4ed8',
                padding: '2px 9px', borderRadius: 10,
                fontSize: 11, fontWeight: 700,
              }}>Auditmate</span>
              <span style={{ color: '#374a3f', fontSize: 13, fontWeight: 600, flex: 1 }}>
                Case Report
              </span>
              {/* Tab toggle */}
              <div style={{ display: 'flex', background: '#f0faf5', borderRadius: 8, padding: 3, gap: 2 }}>
                <button style={tabStyle(auditMode === 'excel')} onClick={() => setAuditMode('excel')}>
                  Upload Excel
                </button>
                <button style={tabStyle(auditMode === 'text')} onClick={() => setAuditMode('text')}>
                  Paste Text
                </button>
              </div>
            </div>

            {auditMode === 'excel' ? (
              <AuditExcelUpload
                excelCases={excelCases}
                selectedCaseIdx={selectedCaseIdx}
                setSelectedCaseIdx={setSelectedCaseIdx}
                onExcelLoad={onExcelLoad}
                onClear={onExcelClear}
              />
            ) : (
              <textarea
                value={emailText}
                onChange={e => setEmailText(e.target.value)}
                placeholder="Paste the officer's full email response here…"
                style={{
                  flex: 1, minHeight: 220, padding: '12px 14px',
                  border: '1px solid #d5e8df', borderRadius: 10,
                  fontSize: 13, lineHeight: 1.6, color: '#1a2e26',
                  background: '#f8fdfb', resize: 'vertical', outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = '#1d9e75'}
                onBlur={e => e.target.style.borderColor = '#d5e8df'}
              />
            )}
          </div>

          {/* Right — ESS (multi-survey, up to 4) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: '#fef3c7', color: '#92400e',
                padding: '2px 9px', borderRadius: 10,
                fontSize: 11, fontWeight: 700,
              }}>ESS</span>
              <span style={{ color: '#374a3f', fontSize: 13, fontWeight: 600, flex: 1 }}>
                Member Satisfaction Feedback
              </span>
              {getVisibleEssCount(essSurveys) > 1 && (
                <span style={{
                  background: '#fef3c7', color: '#92400e',
                  padding: '1px 8px', borderRadius: 10,
                  fontSize: 10, fontWeight: 700,
                }}>
                  {getVisibleEssCount(essSurveys)} surveys
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 440, overflowY: 'auto' }}>
              {Array.from({ length: getVisibleEssCount(essSurveys) }, (_, i) => (
                <div key={i} style={{
                  background: '#f8fdfb', border: '1px solid #d5e8df',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  {/* Survey label */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{
                      background: '#fef3c7', color: '#92400e',
                      padding: '1px 7px', borderRadius: 10,
                      fontSize: 10, fontWeight: 700,
                    }}>
                      Survey {i + 1}
                    </span>
                    {i > 0 && (
                      <span style={{ fontSize: 11, color: '#a9c4b8', fontStyle: 'italic' }}>optional</span>
                    )}
                  </div>

                  {/* Stars */}
                  <StarDisplay
                    rating={essSurveys[i].rating}
                    size={24}
                    interactive
                    onRate={val => updateEssSurvey(i, 'rating', val)}
                  />
                  {essSurveys[i].rating > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#374a3f', fontWeight: 500 }}>
                      {essSurveys[i].rating}/5 — {RATING_LABELS[essSurveys[i].rating]}
                    </div>
                  )}

                  {/* Verbatim */}
                  <textarea
                    value={essSurveys[i].verbatim}
                    onChange={e => updateEssSurvey(i, 'verbatim', e.target.value)}
                    placeholder={i === 0 ? "Member's verbatim feedback…" : "Member's verbatim feedback (optional)…"}
                    style={{
                      width: '100%', marginTop: 8, padding: '8px 10px',
                      border: '1px solid #d5e8df', borderRadius: 8,
                      fontSize: 12, lineHeight: 1.5, color: '#1a2e26',
                      background: '#fff', resize: 'vertical',
                      minHeight: 60, outline: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={e => e.target.style.borderColor = '#1d9e75'}
                    onBlur={e => e.target.style.borderColor = '#d5e8df'}
                  />
                </div>
              ))}

              {/* Hint text when more surveys could appear */}
              {getVisibleEssCount(essSurveys) < 4 && getVisibleEssCount(essSurveys) >= 1 && (
                <div style={{ fontSize: 11, color: '#a9c4b8', textAlign: 'center', paddingTop: 2 }}>
                  Complete Survey {getVisibleEssCount(essSurveys)} to add another ↑
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, color: '#dc2626', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={onAnalyse}
            disabled={isLoading}
            style={{
              background: isLoading ? '#a8d5c3' : 'linear-gradient(135deg, #1d9e75, #0f6e56)',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '12px 36px', fontSize: 15, fontWeight: 700,
              boxShadow: isLoading ? 'none' : '0 3px 10px rgba(29,158,117,0.35)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            {isLoading ? (
              <><Spinner /> Analysing both sources…</>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="white" strokeWidth="1.5"/>
                  <path d="M5.5 8 L7 9.5 L10.5 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Analyse both sources
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Metric Cards ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: '#fff', border: '0.5px solid #cde5d8', borderRadius: 12,
      padding: '16px 20px', flex: 1, minWidth: 0,
      boxShadow: '0 1px 3px rgba(10,74,58,0.05)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b8c7d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent || '#1a2e26', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ color: '#6b8c7d', fontSize: 12, marginTop: 5, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

// ─── Competency Gap Card ──────────────────────────────────────────────────────

function CompetencyCard({ comp }) {
  const c = levelColors(comp.current_level)
  const nextLevel = comp.current_level === 'Basic'
    ? 'Intermediate'
    : comp.current_level === 'Intermediate'
      ? 'Advanced'
      : null

  return (
    <div style={{
      background: '#fff', border: '0.5px solid #cde5d8', borderRadius: 12,
      padding: '16px 18px', display: 'flex', flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(10,74,58,0.05)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2e26', lineHeight: 1.3 }}>{comp.name}</div>
        <LevelBadge level={comp.current_level} />
      </div>
      <ProgressPips level={comp.current_level} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, marginBottom: 10 }}>
        {['Basic', 'Intermediate', 'Advanced'].map((lbl, i) => (
          <span key={lbl} style={{
            fontSize: 9, fontWeight: 500,
            color: i + 1 <= levelPipCount(comp.current_level) ? c.text : '#a9c4b8',
            textAlign: i === 1 ? 'center' : i === 2 ? 'right' : 'left',
            flex: 1,
          }}>{lbl}</span>
        ))}
      </div>
      {/* Why this level */}
      {comp.level_rationale && (
        <div style={{
          fontSize: 11, color: '#4a6e5e', lineHeight: 1.5,
          background: c.bg, borderRadius: 6, padding: '6px 10px', marginBottom: 10,
          borderLeft: `3px solid ${c.dot}`,
        }}>
          {comp.level_rationale}
        </div>
      )}

      <div style={{ height: 1, background: '#f0f5f2', marginBottom: 10 }} />

      {/* Strengths / commendable points */}
      {comp.strengths && comp.strengths.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#0f6e56', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Commendable
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {comp.strengths.map((item, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <SourceBadge source={item.source} />
                <span style={{ fontSize: 12, color: '#374a3f', lineHeight: 1.5 }}>{item.point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gap observations from evidence */}
      {comp.gap_actions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b8c7d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Gaps observed
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {comp.gap_actions.map((item, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <SourceBadge source={item.source} />
                <span style={{ fontSize: 12, color: '#374a3f', lineHeight: 1.5 }}>{item.action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actionable development steps */}
      {comp.next_level_steps && comp.next_level_steps.length > 0 && (
        <div>
          <div style={{ height: 1, background: '#f0f5f2', marginBottom: 10 }} />
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, color: c.text }}>
            {comp.current_level === 'Advanced' ? 'To sustain Advanced:' : `Steps to reach ${nextLevel}:`}
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {comp.next_level_steps.map((step, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{
                  flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
                  background: c.bg, border: `1.5px solid ${c.dot}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, color: c.text, marginTop: 1,
                }}>{i + 1}</div>
                <span style={{ fontSize: 12, color: '#1a2e26', lineHeight: 1.5 }}>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!comp.gap_actions.length && (!comp.next_level_steps || !comp.next_level_steps.length) && (
        <div style={{ fontSize: 12, color: '#6b8c7d', fontStyle: 'italic' }}>No specific gaps identified.</div>
      )}
    </div>
  )
}

// ─── Auditmate Indicators Panel ───────────────────────────────────────────────

function IndicatorsPanel({ indicators, passed }) {
  return (
    <div style={{
      background: '#fff', border: '0.5px solid #cde5d8', borderRadius: 12,
      padding: '18px 20px', flex: 1, minWidth: 0,
      boxShadow: '0 1px 3px rgba(10,74,58,0.05)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2e26' }}>Auditmate Indicators</div>
          <div style={{ fontSize: 11, color: '#6b8c7d', marginTop: 1 }}>10-point quality checklist</div>
        </div>
        <span style={{
          background: passed >= 8 ? '#e8f5f0' : passed >= 5 ? '#fef3c7' : '#fef2f2',
          color:      passed >= 8 ? '#0f6e56' : passed >= 5 ? '#92400e' : '#dc2626',
          padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 800,
        }}>
          {passed}/10
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {indicators.map((ind, i) => (
          <div key={i} style={{ borderBottom: i < indicators.length - 1 ? '1px solid #f0f5f2' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: ind.pass ? '#1d9e75' : '#ef4444' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a2e26' }}>{ind.name}</div>
                {ind.reason && (
                  <div style={{ fontSize: 11, color: '#6b8c7d', marginTop: 1, lineHeight: 1.4 }}>{ind.reason}</div>
                )}
              </div>
              <span style={{
                padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, flexShrink: 0,
                background: ind.pass ? '#e8f5f0' : '#fef2f2',
                color:      ind.pass ? '#0f6e56' : '#dc2626',
              }}>
                {ind.pass ? 'Pass' : 'Fail'}
              </span>
            </div>
            <div style={{ height: 3, borderRadius: 2, margin: '0 0 4px 18px', background: ind.pass ? '#1d9e75' : '#fca5a5', opacity: 0.6 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ESS Panel ────────────────────────────────────────────────────────────────

function ESSPanel({ essSurveys, signals, interpretation }) {
  const positives = signals.filter(s => s.positive)
  const negatives = signals.filter(s => !s.positive)
  const avgRating = essSurveys.reduce((sum, s) => sum + (s.rating || 0), 0) / essSurveys.length

  return (
    <div style={{
      background: '#fff', border: '0.5px solid #cde5d8', borderRadius: 12,
      padding: '18px 20px', flex: 1, minWidth: 0,
      boxShadow: '0 1px 3px rgba(10,74,58,0.05)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2e26', marginBottom: 1 }}>ESS Member Feedback</div>
          <div style={{ fontSize: 11, color: '#6b8c7d' }}>
            {essSurveys.length} survey{essSurveys.length > 1 ? 's' : ''} · avg {avgRating.toFixed(1)}/5
          </div>
        </div>
        {essSurveys.length > 1 && (
          <span style={{
            background: '#fef3c7', color: '#92400e',
            padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
          }}>
            avg ★ {avgRating.toFixed(1)}
          </span>
        )}
      </div>

      {/* One block per survey */}
      {essSurveys.map((s, i) => (
        <div key={i}>
          {essSurveys.length > 1 && (
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b8c7d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
              Survey {i + 1}
            </div>
          )}
          <div style={{
            background: '#f8fdfb', border: '1px solid #d5e8df', borderRadius: 10,
            padding: '10px 12px', marginBottom: s.verbatim ? 6 : 0,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <StarDisplay rating={s.rating} size={18} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2e26' }}>
              {s.rating}/5 — {RATING_LABELS[s.rating]}
            </div>
          </div>
          {s.verbatim && (
            <blockquote style={{
              background: '#f8fdfb', border: '1px solid #d5e8df', borderLeft: '3px solid #1d9e75',
              borderRadius: '0 8px 8px 0', padding: '8px 12px',
              fontSize: 12, color: '#374a3f', lineHeight: 1.5, fontStyle: 'italic', margin: 0,
            }}>
              "{s.verbatim}"
            </blockquote>
          )}
        </div>
      ))}

      {/* Aggregated interpretation */}
      {interpretation && (
        <div style={{
          background: '#f0faf5', border: '1px solid #cde5d8', borderRadius: 8,
          padding: '8px 12px', fontSize: 12, color: '#374a3f', lineHeight: 1.5,
        }}>
          {interpretation}
        </div>
      )}

      {/* Behavioural signals */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b8c7d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 9 }}>
          Behavioural Signals
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {positives.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: '#1d9e75', fontWeight: 700, fontSize: 13, flexShrink: 0, lineHeight: 1.5 }}>✓</span>
              <span style={{ fontSize: 12, color: '#374a3f', lineHeight: 1.5 }}>{s.signal}</span>
            </div>
          ))}
          {negatives.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 13, flexShrink: 0, lineHeight: 1.5 }}>✗</span>
              <span style={{ fontSize: 12, color: '#374a3f', lineHeight: 1.5 }}>{s.signal}</span>
            </div>
          ))}
          {signals.length === 0 && (
            <div style={{ fontSize: 12, color: '#6b8c7d', fontStyle: 'italic' }}>No behavioural signals extracted.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pending Competency Card (unquantifiable — supervisor injection only) ──────

function PendingCompetencyCard({ name, officerId, officerRole }) {
  const [injections, setInjections] = useState(() => loadInjections(officerId))
  const [open, setOpen]             = useState(false)
  const [form, setForm]             = useState({ level: 'Basic', justification: '' })
  const existing = injections[name]
  const canInject = officerRole === 'Supervisor'

  function handleSave() {
    if (!form.justification.trim()) return
    saveInjection(officerId, name, { ...form, supervisorName: 'Supervisor' })
    setInjections(loadInjections(officerId))
    setOpen(false)
  }

  return (
    <div style={{
      background: existing ? '#fff' : '#fafafa',
      border: `0.5px solid ${existing ? '#cde5d8' : '#d4e2d9'}`,
      borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(10,74,58,0.05)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2e26', lineHeight: 1.3 }}>{name}</div>
        {existing
          ? <span style={{ background: '#e6f1fb', color: '#185FA5', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {existing.level}
            </span>
          : <span style={{ background: '#f0f5f2', color: '#6b8c7d', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
              Pending
            </span>
        }
      </div>

      {existing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Supervisor Assessment
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#374a3f', lineHeight: 1.5, fontStyle: 'italic' }}>"{existing.justification}"</div>
          <div style={{ fontSize: 10, color: '#6b8c7d' }}>{existing.supervisorName} · {new Date(existing.timestamp).toLocaleString()}</div>
          {canInject && (
            <button onClick={() => { setForm({ level: existing.level, justification: existing.justification }); setOpen(true) }}
              style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: 11, color: '#185FA5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              Edit
            </button>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#6b8c7d', fontStyle: 'italic', marginBottom: canInject ? 10 : 0 }}>
          {canInject ? 'This competency requires direct observation. Set a score below.' : 'Pending supervisor assessment — cannot be evaluated from correspondence alone.'}
        </div>
      )}

      {canInject && !open && !existing && (
        <button onClick={() => setOpen(true)} style={{
          alignSelf: 'flex-start', marginTop: 4, fontSize: 12, fontWeight: 600,
          color: '#fff', background: '#0f6e56', border: 'none', borderRadius: 7,
          padding: '5px 12px', cursor: 'pointer',
        }}>
          Set Score
        </button>
      )}

      {canInject && open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, padding: '10px 12px', background: '#f0faf5', borderRadius: 8, border: '1px solid #cde5d8' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#374a3f', display: 'block', marginBottom: 4 }}>Level</label>
            <select value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #cde5d8', fontSize: 12, color: '#1a2e26' }}>
              {['Basic', 'Intermediate', 'Advanced'].map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#374a3f', display: 'block', marginBottom: 4 }}>Justification *</label>
            <textarea value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))}
              placeholder="Describe the observed behaviour that supports this level…"
              rows={3} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: '1px solid #cde5d8', fontSize: 12, resize: 'vertical', color: '#1a2e26' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave} disabled={!form.justification.trim()} style={{
              flex: 1, padding: '6px', borderRadius: 6, border: 'none', cursor: form.justification.trim() ? 'pointer' : 'not-allowed',
              background: form.justification.trim() ? '#0f6e56' : '#cde5d8', color: '#fff', fontSize: 12, fontWeight: 600,
            }}>Save</button>
            <button onClick={() => setOpen(false)} style={{
              flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #cde5d8', background: '#fff', color: '#374a3f', fontSize: 12, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Results View ─────────────────────────────────────────────────────────────

function ResultsView({ results, onReset, officerRole, officerId }) {
  const competenciesAtBasic = results.competencies.filter(c => c.current_level === 'Basic').length
  const overallColors = levelColors(results.overall_level)
  const avgRating = results.essSurveys.reduce((sum, s) => sum + (s.rating || 0), 0) / results.essSurveys.length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a2e26', marginBottom: 3 }}>Analysis Results</h2>
          <p style={{ color: '#6b8c7d', fontSize: 13 }}>Based on Auditmate case report and ESS member feedback</p>
        </div>
        <button
          onClick={onReset}
          style={{
            background: '#f0faf5', border: '1px solid #cde5d8', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#1a6b55',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7 C2 4.2 4.2 2 7 2 C8.6 2 10 2.8 10.8 4" stroke="#1a6b55" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M9 1.5 L11 4 L8.5 5" stroke="#1a6b55" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 7 C12 9.8 9.8 12 7 12 C5.4 12 4 11.2 3.2 10" stroke="#1a6b55" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          New Analysis
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <MetricCard label="Overall Level" value={results.overall_level} sub="Across all 6 competencies" accent={overallColors.text} />
        <MetricCard
          label="Auditmate Score" value={`${results.indicators_passed}/10`} sub="indicators passed"
          accent={results.indicators_passed >= 8 ? '#0f6e56' : results.indicators_passed >= 5 ? '#92400e' : '#dc2626'}
        />
        <MetricCard
          label="Member Satisfaction"
          value={`${avgRating.toFixed(1)}/5`}
          sub={results.essSurveys.length > 1
            ? `avg across ${results.essSurveys.length} surveys`
            : RATING_LABELS[results.essSurveys[0].rating]}
          accent={avgRating >= 4 ? '#0f6e56' : avgRating >= 3 ? '#92400e' : '#dc2626'}
        />
        <MetricCard
          label="Competencies at Basic" value={competenciesAtBasic}
          sub={competenciesAtBasic === 0 ? 'All above Basic' : `${competenciesAtBasic} need${competenciesAtBasic > 1 ? '' : 's'} development`}
          accent={competenciesAtBasic === 0 ? '#0f6e56' : '#854F0B'}
        />
      </div>

      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2e26', marginBottom: 12 }}>Competency Gap Analysis</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {results.competencies.map((comp, i) => <CompetencyCard key={i} comp={comp} />)}
          {(UNQUANTIFIABLE[officerRole] || []).map(name => (
            <PendingCompetencyCard key={name} name={name} officerId={officerId} officerRole={officerRole} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <IndicatorsPanel indicators={results.indicators} passed={results.indicators_passed} />
        <ESSPanel
          essSurveys={results.essSurveys}
          signals={results.ess_signals || []}
          interpretation={results.ess_rating_interpretation}
        />
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

// Competencies the LLM cannot assess — require supervisor injection
export const UNQUANTIFIABLE = {
  TL:         ['Workload Delegation'],
  Supervisor: ['Workload Delegation', 'Strategic Oversight & Team Performance Management'],
}

export default function Dashboard({ officer, onAnalysisDone }) {
  const [auditMode, setAuditMode]             = useState('excel')
  const [emailText, setEmailText]             = useState('')
  const [excelCases, setExcelCases]           = useState([])
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0)
  const [essSurveys, setEssSurveys]           = useState(EMPTY_SURVEYS)
  const [isLoading, setIsLoading]             = useState(false)
  const [results, setResults]                 = useState(null)
  const [error, setError]                     = useState(null)

  function updateEssSurvey(idx, field, value) {
    setEssSurveys(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  async function handleAnalyse() {
    // Validate Auditmate source
    if (auditMode === 'excel' && excelCases.length === 0) {
      setError('Please upload an Auditmate Excel file.'); return
    }
    if (auditMode === 'text' && !emailText.trim()) {
      setError("Please paste the officer's email response."); return
    }
    const visibleCount  = getVisibleEssCount(essSurveys)
    const filledSurveys = essSurveys
      .slice(0, visibleCount)
      .filter(s => s.rating > 0 || s.verbatim.trim() !== '')
    if (filledSurveys.length === 0) {
      setError('Please fill in at least one ESS survey (rating or feedback).'); return
    }

    const apiKey   = import.meta.env.VITE_API_KEY
    const provider = (import.meta.env.VITE_API_PROVIDER || 'anthropic').toLowerCase()
    const model    = import.meta.env.VITE_API_MODEL
    if (!apiKey) { setError('VITE_API_KEY is not set in your .env file.'); return }

    setIsLoading(true)
    setError(null)

    // Build Auditmate context string
    let auditContext
    let excelCaseData = null
    if (auditMode === 'excel') {
      excelCaseData = excelCases[selectedCaseIdx].caseData
      auditContext = formatExcelContext(excelCaseData)
    } else {
      auditContext = emailText
    }

    const auditSourceLabel = auditMode === 'excel'
      ? 'AUDITMATE SOURCE — Pre-processed indicator results from Auditmate Excel export'
      : 'AUDITMATE SOURCE — Officer\'s email response'

    const excelInstruction = auditMode === 'excel'
      ? '\n\nThe Auditmate indicator results above are pre-evaluated and authoritative. Use them as evidence to assess the 6 competencies. In your JSON response, reproduce the exact indicator pass/fail status from the data above.'
      : ''

    const essContext = filledSurveys.length === 1
      ? `Rating: ${filledSurveys[0].rating}/5 (${RATING_LABELS[filledSurveys[0].rating] || 'N/A'})\nVerbatim: ${filledSurveys[0].verbatim || '(no verbatim provided)'}`
      : filledSurveys.map((s, i) =>
          `Survey ${i + 1}:\nRating: ${s.rating}/5 (${RATING_LABELS[s.rating] || 'N/A'})\nVerbatim: ${s.verbatim || '(no verbatim provided)'}`
        ).join('\n\n')

    const essLabel = filledSurveys.length > 1
      ? `ESS SOURCE — Member feedback (${filledSurveys.length} surveys)`
      : 'ESS SOURCE — Member feedback'

    const userMessage = `Officer rank: ${officer.role}

${auditSourceLabel}:
${auditContext}

${essLabel}:
${essContext}

${RANK_EVAL_INSTRUCTION[officer.role] || RANK_EVAL_INSTRUCTION.CSO} Tag each gap action and strength with its source. Be specific to what is written above.${excelInstruction}`

    try {
      let text

      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: model || 'claude-opus-4-6',
            max_tokens: 4096,
            system: buildSystemPrompt(officer.role),
            messages: [{ role: 'user', content: userMessage }],
          }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e?.error?.message || `Anthropic API returned ${res.status}`)
        }
        text = (await res.json()).content[0].text
      } else {
        const baseUrl      = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'
        const defaultModel = provider === 'openrouter' ? 'anthropic/claude-opus-4' : 'gpt-4o'
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: model || defaultModel,
            max_tokens: 4096,
            messages: [
              { role: 'system', content: buildSystemPrompt(officer.role) },
              { role: 'user',   content: userMessage },
            ],
          }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e?.error?.message || `${provider} API returned ${res.status}`)
        }
        text = (await res.json()).choices[0].message.content
      }

      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('The model returned incomplete JSON — response was likely cut off. Try again.')
      }

      // When Excel mode: override indicators with pre-computed Excel values (authoritative)
      if (excelCaseData) {
        const excelIndicators   = excelIndicatorsToResultFormat(excelCaseData)
        const excelPassed       = excelIndicators.filter(i => i.pass).length
        parsed.indicators       = excelIndicators
        parsed.indicators_passed = excelPassed
      }

      const finalResults = { ...parsed, essSurveys: filledSurveys }
      setResults(finalResults)
      onAnalysisDone?.(finalResults)
    } catch (err) {
      setError(`Analysis failed: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  function handleReset() {
    setResults(null)
    setError(null)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {results ? (
        <ResultsView results={results} onReset={handleReset} officerRole={officer.role} officerId={officer.id} />
      ) : (
        <InputSection
          auditMode={auditMode}
          setAuditMode={setAuditMode}
          emailText={emailText}
          setEmailText={setEmailText}
          excelCases={excelCases}
          selectedCaseIdx={selectedCaseIdx}
          setSelectedCaseIdx={setSelectedCaseIdx}
          onExcelLoad={setExcelCases}
          onExcelClear={() => { setExcelCases([]); setSelectedCaseIdx(0) }}
          essSurveys={essSurveys}
          updateEssSurvey={updateEssSurvey}
          onAnalyse={handleAnalyse}
          isLoading={isLoading}
          error={error}
        />
      )}
    </div>
  )
}
