import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

/* ── Core competency AI index map (matches backend COMPETENCIES array) ── */
const CORE_AI_INDEX = {
  'Thinking Clearly and Making Sound Judgements': 0,
  'Working as a team': 1,
  'Working effectively with citizens and stakeholders': 2,
  'Keep learning and putting skills into action': 3,
  'Improving and innovating continuously': 4,
  'Serving with heart, commitment and purpose': 5,
}

/* ── colour maps ────────────────────────────────────────────────── */
const LEVEL_BG    = { 1: '#ffd5d5', 2: '#fff3cc', 3: '#d4f5e2' }
const LEVEL_BORDER= { 1: '#ffb3b3', 2: '#ffe680', 3: '#9de8c0' }
const LEVEL_TEXT  = { 1: '#7a2020', 2: '#7a5500', 3: '#1a5c38' }
const LEVEL_LABEL = { 1: 'Basic', 2: 'Intermediate', 3: 'Advanced' }

const BOX_STYLE = {
  1: { bg: '#fde8e8', border: '#f5b8b8', text: '#c0504d' },
  2: { bg: '#fde8c8', border: '#f5c888', text: '#c07830' },
  3: { bg: '#d4f0e4', border: '#90cba8', text: '#2d7a4f' },
  4: { bg: '#d8f0e0', border: '#88c8a0', text: '#2d7a4f' },
  5: { bg: '#5aab8a', border: '#3d8a6e', text: '#ffffff' },
  6: { bg: '#2d7a58', border: '#1a5a3e', text: '#ffffff' },
  7: { bg: '#0f4d33', border: '#072b1c', text: '#ffffff' },
}
const BOX_ACTIVE = {
  1: { bg: '#c0504d', border: '#8b2020' },
  2: { bg: '#c87820', border: '#8b5000' },
  3: { bg: '#4a9a6a', border: '#2d6b47' },
  4: { bg: '#2a8a5a', border: '#1a5a3a' },
  5: { bg: '#1a6b44', border: '#0f4a2e' },
  6: { bg: '#0f4a2e', border: '#072b1c' },
  7: { bg: '#072b1c', border: '#030f08' },
}
const BOX_GREYED = { bg: '#f5f5f5', border: '#d0d0d0', text: '#c0c0c0' }

function roleMaxLevel(role) {
  if (role === 'Supervisor') return 7
  if (role === 'TL') return 5
  return 3
}

function scoreToAbsoluteLevel(score, role) {
  if (score == null) return null
  if (role === 'TL') {
    if (score >= 75) return 5
    if (score >= 60) return 4
    return 3
  }
  if (role === 'Supervisor') {
    if (score >= 80) return 7
    if (score >= 60) return 6
    return 5
  }
  if (score >= 80) return 3
  if (score >= 60) return 2
  return 1
}

function internalToAbsoluteLevel(internalLevel, role) {
  if (internalLevel == null) return null
  if (role === 'Supervisor') return internalLevel + 4
  if (role === 'TL') return internalLevel + 2
  return internalLevel
}

function statusConfig(status) {
  if (status === 'Mastery')   return { color: '#1a3a6b', bg: '#d6eaff', icon: <TrophyIcon />,  label: 'Mastery'   }
  if (status === 'Advancing') return { color: '#1a6b3a', bg: '#d6f5e3', icon: <TrendUpIcon />, label: 'Advancing' }
  return                             { color: '#b85c00', bg: '#fff0cc', icon: <WarnIcon />,    label: 'Stagnant'  }
}

/* ── tiny SVG icons ─────────────────────────────────────────────── */
const SvgIcon = ({ children, size = 14, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color ?? 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)
const ChevRight = () => <SvgIcon size={16}><polyline points="9 18 15 12 9 6"/></SvgIcon>
const ChevDown  = () => <SvgIcon size={16}><polyline points="6 9 12 15 18 9"/></SvgIcon>
const TrophyIcon= () => <SvgIcon size={13}><polyline points="8 21 12 17 16 21"/><path d="M17 4h3v3a3 3 0 0 1-3 3h-.16"/><path d="M7 4H4v3a3 3 0 0 0 3 3h.16"/><path d="M12 17V7"/></SvgIcon>
const TrendUpIcon=() => <SvgIcon size={13}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></SvgIcon>
const WarnIcon  = () => <SvgIcon size={13}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></SvgIcon>
const SpinnerIcon=()=> (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ animation: 'spin 0.8s linear infinite' }}>
    <path d="M21 12a9 9 0 11-6.219-8.56"/>
  </svg>
)

/* ── Level boxes ─────────────────────────────────────────────────── */
function LevelBoxes({ absoluteLevel, role }) {
  const maxLevel = roleMaxLevel(role ?? 'CSO')
  return (
    <div style={{ display: 'flex', gap: '3px' }}>
      {[1, 2, 3, 4, 5, 6, 7].map(n => {
        const isActive   = n === absoluteLevel
        const isColoured = absoluteLevel != null && n <= absoluteLevel
        const s   = isColoured ? BOX_STYLE[n] : BOX_GREYED
        const act = BOX_ACTIVE[n]
        return (
          <div key={n} style={{
            width: '22px', height: '22px', borderRadius: '5px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px',
            background: isActive ? act.bg : s.bg,
            border: `1.5px solid ${isActive ? act.border : isColoured ? '#999999' : '#d0d0d0'}`,
            color: isActive ? '#ffffff' : s.text,
            fontWeight: '700',
            transform: isActive ? 'scale(1.15)' : n > maxLevel ? 'scale(0.92)' : 'none',
            boxShadow: isActive ? '0 2px 6px rgba(0,0,0,0.2)' : 'none',
          }}>
            {n}
          </div>
        )
      })}
    </div>
  )
}

/* ── AI content panel ────────────────────────────────────────────── */
function DevelopmentPanel({ data, loading, error }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 0', color: '#6b7280', fontSize: '13px' }}>
      <SpinnerIcon /> Generating AI insights…
    </div>
  )
  if (error) return (
    <div style={{ background: '#fef2f2', borderRadius: '8px', padding: '12px', color: '#dc2626', fontSize: '13px' }}>{error}</div>
  )
  if (!data) return null

  if (data.mastery) return (
    <div style={{
      background: '#f0fdf4', borderRadius: '10px', padding: '16px 20px',
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2"><polyline points="8 21 12 17 16 21"/><path d="M17 4h3v3a3 3 0 0 1-3 3h-.16"/><path d="M7 4H4v3a3 3 0 0 0 3 3h.16"/><path d="M12 17V7"/></svg>
      <span style={{ fontSize: '13px', color: '#166534', fontWeight: '500' }}>{data.mastery}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {data.wellDone?.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#059669', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            What Went Well
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.wellDone.map((b, i) => (
              <li key={i} style={{ fontSize: '13px', color: '#374151', lineHeight: '1.55' }}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {data.toProgress?.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#2563eb', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
            To Progress to Next Level
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.toProgress.map((b, i) => (
              <li key={i} style={{ fontSize: '13px', color: '#374151', lineHeight: '1.55' }}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function EvidencePanel({ data, loading, error }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 0', color: '#6b7280', fontSize: '13px' }}>
      <SpinnerIcon /> Analysing interaction records…
    </div>
  )
  if (error) return (
    <div style={{ background: '#fef2f2', borderRadius: '8px', padding: '12px', color: '#dc2626', fontSize: '13px' }}>{error}</div>
  )
  if (!data) return null
  if (data.noData) return (
    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '14px', color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>
      No interaction data available for this period.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {data.strengths?.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#059669', marginBottom: '8px' }}>What Went Well</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.strengths.map((s, i) => (
              <div key={i} style={{ background: '#f0fdf4', borderRadius: '8px', padding: '10px 14px', borderLeft: '3px solid #86efac' }}>
                <div style={{ fontSize: '13px', fontStyle: 'italic', color: '#166534', marginBottom: '4px' }}>"{s.quote}"</div>
                <div style={{ fontSize: '12px', color: '#374151' }}>{s.why}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.gaps?.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#dc2626', marginBottom: '8px' }}>What Was Missing or Could Improve</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.gaps.map((g, i) => (
              <div key={i} style={{ background: '#fef2f2', borderRadius: '8px', padding: '10px 14px', borderLeft: '3px solid #fca5a5' }}>
                <div style={{ fontSize: '13px', fontStyle: 'italic', color: '#991b1b', marginBottom: '4px' }}>"{g.quote}"</div>
                <div style={{ fontSize: '12px', color: '#374151' }}>{g.why}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.suggestions?.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#7c3aed', marginBottom: '8px' }}>Improvement Suggestions</div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.suggestions.map((s, i) => (
              <li key={i} style={{ fontSize: '13px', color: '#374151', lineHeight: '1.55' }}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── competency card ─────────────────────────────────────────────── */
function CompetencyCard({ index, comp, level, status, compData, viewingAsId, role }) {
  const [open, setOpen]           = useState(false)
  const [aiDev, setAiDev]         = useState(null)
  const [aiDevLoading, setDevLoad]= useState(false)
  const [aiDevError, setDevErr]   = useState(null)
  const [showEvidence, setShowEv] = useState(false)
  const [aiEv, setAiEv]           = useState(null)
  const [aiEvLoading, setEvLoad]  = useState(false)
  const [aiEvError, setEvErr]     = useState(null)

  async function handleOpen() {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && !aiDev && !aiDevLoading) {
      setDevLoad(true); setDevErr(null)
      try {
        const res = await fetch('/api/ai/development', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({
            officerId:       viewingAsId,
            competencyIndex: index,
            currentLevel:    level,
            currentScore:    compData?.currentScore,
            latestDate:      compData?.latestDate,
            indicators:      compData?.indicators ?? [],
          }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'AI request failed')
        setAiDev(d)
      } catch (e) {
        setDevErr(e.message)
      } finally {
        setDevLoad(false)
      }
    }
  }

  async function handleShowEvidence() {
    const willShow = !showEvidence
    setShowEv(willShow)
    if (willShow && !aiEv && !aiEvLoading) {
      setEvLoad(true); setEvErr(null)
      try {
        const res = await fetch('/api/ai/evidence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({
            officerId:       viewingAsId,
            competencyIndex: index,
            latestDate:      compData?.latestDate,
          }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'AI request failed')
        setAiEv(d)
      } catch (e) {
        setEvErr(e.message)
      } finally {
        setEvLoad(false)
      }
    }
  }

  const st  = statusConfig(status)
  const bg  = level !== null ? LEVEL_BG[level]    : '#f9fafb'
  const bdr = level !== null ? LEVEL_BORDER[level] : '#e5e7eb'

  return (
    <div style={{
      borderRadius: '14px', overflow: 'hidden',
      border: `1px solid ${bdr}`, background: bg,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Header row */}
      <button
        onClick={handleOpen}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
          padding: '16px 20px', background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        {/* Chevron */}
        <span style={{ color: '#6b7280', flexShrink: 0 }}>
          {open ? <ChevDown /> : <ChevRight />}
        </span>

        {/* Name + short desc */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', lineHeight: '1.3' }}>
            {comp.name}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px', lineHeight: '1.4' }}>
            {comp.short}
          </div>
        </div>

        {/* Level + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <LevelBoxes absoluteLevel={internalToAbsoluteLevel(level, role)} role={role} />
          <span style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '11px', fontWeight: '600',
            color: st.color, background: st.bg,
            padding: '4px 10px', borderRadius: '20px',
          }}>
            {st.icon} {st.label}
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div style={{
          margin: '0 16px 16px',
          background: 'white', borderRadius: '10px',
          padding: '20px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          {/* Score context bar */}
          {compData?.currentScore != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '16px',
              background: '#f9fafb', borderRadius: '8px', padding: '10px 14px',
              marginBottom: '20px',
            }}>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>Latest Score</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: level ? LEVEL_TEXT[level] : '#9ca3af' }}>
                {compData.currentScore}%
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                {compData.recordCount} record{compData.recordCount !== 1 ? 's' : ''} ·{' '}
                {compData.latestDate ?? '—'}
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <span style={{
                  fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px',
                  background: st.bg, color: st.color,
                }}>
                  {st.label}
                </span>
              </div>
            </div>
          )}

          {/* Section 1: AI Development Summary */}
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', marginBottom: '12px' }}>
            Development Summary
          </div>
          <DevelopmentPanel data={aiDev} loading={aiDevLoading} error={aiDevError} />

          {/* Section 2: Supporting Evidence toggle */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #f3f4f6', paddingTop: '16px' }}>
            <button
              onClick={handleShowEvidence}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '8px',
                border: '1px solid #d1d5db',
                background: showEvidence ? '#1e3a35' : 'white',
                color:      showEvidence ? 'white'   : '#374151',
                fontSize: '12px', fontWeight: '600',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              {showEvidence ? 'Hide' : 'Show'} Supporting Evidence
            </button>

            {showEvidence && (
              <div style={{ marginTop: '16px' }}>
                <EvidencePanel data={aiEv} loading={aiEvLoading} error={aiEvError} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


/* ── 3-source evidence panel (Functional / Leadership) ──────────── */
function TriSourceEvidencePanel({ data, loading, error }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 0', color: '#6b7280', fontSize: '13px' }}>
      <SpinnerIcon /> Generating evidence…
    </div>
  )
  if (error) return (
    <div style={{ background: '#fef2f2', borderRadius: '8px', padding: '12px', color: '#dc2626', fontSize: '13px' }}>{error}</div>
  )
  if (!data) return null
  if (data.noData) return (
    <div style={{ fontSize: '13px', color: '#9ca3af', padding: '12px 0' }}>No data available to generate evidence.</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Section 1: Interactions */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: '700', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          From Officer Interactions
        </div>
        {data.interactions?.strengths?.length > 0 && (
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#059669', marginBottom: '6px' }}>Strengths</div>
            {data.interactions.strengths.map((s, i) => (
              <div key={i} style={{ background: '#f0fdf4', borderRadius: '8px', padding: '10px 12px', marginBottom: '6px' }}>
                <div style={{ fontSize: '12px', color: '#166534', fontStyle: 'italic', marginBottom: '4px' }}>"{s.quote}"</div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>{s.why}</div>
              </div>
            ))}
          </div>
        )}
        {data.interactions?.gaps?.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#dc2626', marginBottom: '6px' }}>Gaps</div>
            {data.interactions.gaps.map((g, i) => (
              <div key={i} style={{ background: '#fef2f2', borderRadius: '8px', padding: '10px 12px', marginBottom: '6px' }}>
                <div style={{ fontSize: '12px', color: '#7f1d1d', fontStyle: 'italic', marginBottom: '4px' }}>"{g.quote}"</div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>{g.why}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: ESS */}
      {data.ess?.quotes?.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Member Feedback Signal (ESS)
          </div>
          {data.ess.quotes.map((q, i) => (
            <div key={i} style={{ background: q.type === 'positive' ? '#eff6ff' : '#fef2f2', borderRadius: '8px', padding: '10px 12px', marginBottom: '6px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '4px', background: q.type === 'positive' ? '#2563eb' : '#dc2626' }} />
              <div style={{ fontSize: '12px', color: '#374151', fontStyle: 'italic' }}>"{q.text}"</div>
            </div>
          ))}
        </div>
      )}

      {/* Section 3: Audit */}
      {data.audit?.summary && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#1e6b4a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Audit Scores
          </div>
          <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#166534', lineHeight: '1.6' }}>
            {data.audit.summary}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Functional / Leadership competency card ─────────────────────── */
function FunctionalCard({ comp, viewingAsId, isLeadership, role }) {
  const { index, name, bulletPoints, score, level, status, rationale } = comp

  const [open, setOpen]           = useState(false)
  const [aiDev, setAiDev]         = useState(null)
  const [aiDevLoading, setDevLoad]= useState(false)
  const [aiDevError, setDevErr]   = useState(null)
  const [showEvidence, setShowEv] = useState(false)
  const [aiEv, setAiEv]           = useState(null)
  const [aiEvLoading, setEvLoad]  = useState(false)
  const [aiEvError, setEvErr]     = useState(null)

  const devEndpoint = isLeadership ? '/api/ai/leadership-development' : '/api/ai/functional-development'
  const evEndpoint  = isLeadership ? '/api/ai/leadership-evidence'    : '/api/ai/functional-evidence'

  async function handleOpen() {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && !aiDev && !aiDevLoading) {
      setDevLoad(true); setDevErr(null)
      try {
        const res = await fetch(devEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ officerId: viewingAsId, competencyIndex: index, compName: name, bulletPoints, currentLevel: level, currentScore: score }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'AI request failed')
        setAiDev(d)
      } catch (e) { setDevErr(e.message) }
      finally { setDevLoad(false) }
    }
  }

  async function handleShowEvidence() {
    const willShow = !showEvidence
    setShowEv(willShow)
    if (willShow && !aiEv && !aiEvLoading) {
      setEvLoad(true); setEvErr(null)
      try {
        const res = await fetch(evEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ officerId: viewingAsId, competencyIndex: index, compName: name, bulletPoints, currentScore: score }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'AI request failed')
        setAiEv(d)
      } catch (e) { setEvErr(e.message) }
      finally { setEvLoad(false) }
    }
  }

  const st  = statusConfig(status)
  const bg  = level !== null ? LEVEL_BG[level]    : '#f9fafb'
  const bdr = level !== null ? LEVEL_BORDER[level] : '#e5e7eb'

  return (
    <div style={{
      borderRadius: '14px', overflow: 'hidden',
      border: `1px solid ${bdr}`, background: bg,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Header row — identical structure to CompetencyCard */}
      <button
        onClick={handleOpen}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
          padding: '16px 20px', background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ color: '#6b7280', flexShrink: 0 }}>
          {open ? <ChevDown /> : <ChevRight />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', lineHeight: '1.3' }}>
            {name}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px', lineHeight: '1.4' }}>
            {score != null
              ? `${score}% AI score (3 sources)`
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#9ca3af', fontStyle: 'italic' }}>
                  <SpinnerIcon /> Generating AI score…
                </span>
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <LevelBoxes absoluteLevel={scoreToAbsoluteLevel(score, role)} role={role} />
          <span style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '11px', fontWeight: '600',
            color: st.color, background: st.bg,
            padding: '4px 10px', borderRadius: '20px',
          }}>
            {st.icon} {st.label}
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div style={{
          margin: '0 16px 16px',
          background: 'white', borderRadius: '10px',
          padding: '20px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          {/* Score context bar */}
          {score != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '16px',
              background: '#f9fafb', borderRadius: '8px', padding: '10px 14px',
              marginBottom: '20px',
            }}>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>AI Score (3 sources)</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: level ? LEVEL_TEXT[level] : '#9ca3af' }}>
                {score}%
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <span style={{
                  fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px',
                  background: st.bg, color: st.color,
                }}>
                  {st.label}
                </span>
              </div>
            </div>
          )}

          {/* Score Rationale */}
          {rationale && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Score Rationale
              </div>
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px 16px', borderLeft: '3px solid #94a3b8' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#475569', fontStyle: 'italic', lineHeight: '1.6' }}>
                  {rationale}
                </p>
              </div>
            </div>
          )}

          {/* Section 2: AI Development Summary */}
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', marginBottom: '12px' }}>
            Development Summary
          </div>
          <DevelopmentPanel data={aiDev} loading={aiDevLoading} error={aiDevError} />

          {/* Section 3: Supporting Evidence toggle */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #f3f4f6', paddingTop: '16px' }}>
            <button
              onClick={handleShowEvidence}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '8px',
                border: '1px solid #d1d5db',
                background: showEvidence ? '#1e3a35' : 'white',
                color:      showEvidence ? 'white'   : '#374151',
                fontSize: '12px', fontWeight: '600',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              {showEvidence ? 'Hide' : 'Show'} Supporting Evidence
            </button>
            {showEvidence && (
              <div style={{ marginTop: '16px' }}>
                <TriSourceEvidencePanel data={aiEv} loading={aiEvLoading} error={aiEvError} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Correspondence competency card ─────────────────────────────── */
function CorrespondenceCard({ corrComp, compData, viewingAsId, role }) {
  const { index, name, score, level, status, indicatorScores, essSupport, essAvg, essCount } = corrComp

  const [open, setOpen]           = useState(false)
  const [aiDev, setAiDev]         = useState(null)
  const [aiDevLoading, setDevLoad]= useState(false)
  const [aiDevError, setDevErr]   = useState(null)
  const [showEvidence, setShowEv] = useState(false)
  const [aiEv, setAiEv]           = useState(null)
  const [aiEvLoading, setEvLoad]  = useState(false)
  const [aiEvError, setEvErr]     = useState(null)

  async function handleOpen() {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && !aiDev && !aiDevLoading) {
      setDevLoad(true); setDevErr(null)
      try {
        const res = await fetch('/api/ai/correspondence-development', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({
            officerId: viewingAsId,
            correspondenceIndex: index,
            currentLevel: level,
            currentScore: score,
            indicatorScores,
            essAvg,
            essCount,
          }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'AI request failed')
        setAiDev(d)
      } catch (e) {
        setDevErr(e.message)
      } finally {
        setDevLoad(false)
      }
    }
  }

  async function handleShowEvidence() {
    const willShow = !showEvidence
    setShowEv(willShow)
    if (willShow && !aiEv && !aiEvLoading) {
      setEvLoad(true); setEvErr(null)
      try {
        const res = await fetch('/api/ai/correspondence-evidence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({
            officerId: viewingAsId,
            correspondenceIndex: index,
            latestDate: compData?.latestDate,
          }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'AI request failed')
        setAiEv(d)
      } catch (e) {
        setEvErr(e.message)
      } finally {
        setEvLoad(false)
      }
    }
  }

  const st  = statusConfig(status)
  const bg  = level !== null ? LEVEL_BG[level]    : '#f9fafb'
  const bdr = level !== null ? LEVEL_BORDER[level] : '#e5e7eb'

  return (
    <div style={{
      borderRadius: '14px', overflow: 'hidden',
      border: `1px solid ${bdr}`, background: bg,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Header row */}
      <button
        onClick={handleOpen}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
          padding: '16px 20px', background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ color: '#6b7280', flexShrink: 0 }}>
          {open ? <ChevDown /> : <ChevRight />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', lineHeight: '1.3' }}>
            {name}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            {score != null ? `${score}% pass rate (30-day avg)` : 'No data available'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <LevelBoxes absoluteLevel={scoreToAbsoluteLevel(score, role)} role={role} />
          <span style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '11px', fontWeight: '600',
            color: st.color, background: st.bg,
            padding: '4px 10px', borderRadius: '20px',
          }}>
            {st.icon} {st.label}
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div style={{
          margin: '0 16px 16px',
          background: 'white', borderRadius: '10px',
          padding: '20px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          {/* Contributing Indicators table */}
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', marginBottom: '10px' }}>
            Contributing Indicators
          </div>
          <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>Indicator</th>
                  <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>Pass Rate</th>
                  <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>Level</th>
                </tr>
              </thead>
              <tbody>
                {indicatorScores.map((ind, i) => {
                  const indLevel = ind.avg != null
                    ? (ind.avg >= 80 ? 3 : ind.avg >= 60 ? 2 : 1)
                    : null
                  return (
                    <tr key={i} style={{ borderBottom: i < indicatorScores.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                      <td style={{ padding: '9px 14px', color: '#374151' }}>{ind.label}</td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: '600', color: indLevel ? LEVEL_TEXT[indLevel] : '#9ca3af' }}>
                        {ind.avg != null ? `${ind.avg}%` : '—'}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                        {indLevel ? (
                          <span style={{
                            fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '12px',
                            background: LEVEL_BG[indLevel], color: LEVEL_TEXT[indLevel],
                          }}>
                            {LEVEL_LABEL[indLevel]}
                          </span>
                        ) : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ESS signal (only for essSupport comps) */}
          {essSupport && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              background: '#f0fdf4', borderRadius: '8px', padding: '12px 16px',
              marginBottom: '20px', border: '1px solid #bbf7d0',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#059669', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ESS Supporting Signal
                </div>
                <div style={{ fontSize: '13px', color: '#166534', marginTop: '2px' }}>
                  {essAvg != null
                    ? `Avg satisfaction rating: ${essAvg}/5 (${essCount} response${essCount !== 1 ? 's' : ''} in 30 days)`
                    : 'No ESS responses in 30-day window'}
                </div>
              </div>
            </div>
          )}

          {/* AI Development Summary */}
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', marginBottom: '12px' }}>
            Development Summary
          </div>
          <DevelopmentPanel data={aiDev} loading={aiDevLoading} error={aiDevError} />

          {/* Supporting Evidence toggle */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #f3f4f6', paddingTop: '16px' }}>
            <button
              onClick={handleShowEvidence}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '8px',
                border: '1px solid #d1d5db',
                background: showEvidence ? '#1e3a35' : 'white',
                color:      showEvidence ? 'white'   : '#374151',
                fontSize: '12px', fontWeight: '600',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              {showEvidence ? 'Hide' : 'Show'} Supporting Evidence
            </button>
            {showEvidence && (
              <div style={{ marginTop: '16px' }}>
                <EvidencePanel data={aiEv} loading={aiEvLoading} error={aiEvError} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── main page ───────────────────────────────────────────────────── */
export default function CompetencyBreakdown() {
  const { viewingAs, user } = useAuth()
  const [compData, setCompData]         = useState(null)
  const [framework, setFramework]       = useState([])
  const [hasFramework, setHasFramework] = useState(true)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [activeTab, setActiveTab]       = useState('Core')

  const officerId   = viewingAs?.id ?? user?.id
  const officerRole = viewingAs?.role ?? user?.role ?? 'CSO'
  const isSupervisor = officerRole === 'Supervisor'

  const TABS = [
    { key: 'Correspondence', label: 'Correspondence Competencies' },
    { key: 'Core',           label: 'Core Competencies' },
    { key: 'Functional',     label: 'Functional Competencies' },
    ...(isSupervisor ? [{ key: 'Leadership', label: 'Leadership Competencies' }] : []),
  ]

  useEffect(() => {
    setLoading(true); setError(null)
    const breakdownUrl = `/api/competency-breakdown${officerId ? `?officerId=${officerId}` : ''}`
    const frameworkUrl = `/api/competencies?role=${officerRole}`
    const headers = { Authorization: `Bearer ${getToken()}` }

    Promise.all([
      fetch(breakdownUrl, { headers }).then(r => r.json()),
      fetch(frameworkUrl, { headers }).then(r => r.json()),
    ])
      .then(([breakdown, fw]) => {
        setCompData(breakdown)
        setFramework(fw.competencies ?? [])
        setHasFramework(fw.hasFramework ?? false)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load competency data.'); setLoading(false) })
  }, [officerId, officerRole])

  // Cards for the active tab
  function renderTabCards(type) {
    if (type === 'Correspondence') {
      const corrComps = compData?.correspondenceCompetencies
      if (!corrComps?.length) return (
        <div style={{ background: 'white', borderRadius: '12px', padding: '32px', textAlign: 'center', fontSize: '13px', color: '#9ca3af' }}>
          No correspondence data available in the last 30 days.
        </div>
      )
      return corrComps.map(corrComp => (
        <CorrespondenceCard
          key={corrComp.index}
          corrComp={corrComp}
          compData={compData}
          viewingAsId={officerId}
          role={officerRole}
        />
      ))
    }

    if (!hasFramework && type === 'Core') {
      // Fallback hardcoded core cards if not seeded
      return [
        { name: 'Thinking Clearly and Making Sound Judgements', short: 'Problem-solving, evaluation, and strategic decision-making' },
        { name: 'Working as a Team (within the Board and Public Service)', short: 'Collaboration, communication, and shared accountability' },
        { name: 'Working Effectively with Citizens and Stakeholders', short: 'Citizen engagement, stakeholder management, and service quality' },
        { name: 'Keep Learning and Putting Skills into Action', short: 'Continuous development, knowledge application, and growth mindset' },
        { name: 'Improving and Innovating Continuously (Agile, Bold and Data-Smart)', short: 'Process improvement, innovation, and data-driven decision-making' },
        { name: 'Serving with Heart, Commitment and Purpose (Customer-obsessed)', short: 'Citizen-first service, empathy, and commitment to excellence' },
      ].map((comp, i) => (
        <CompetencyCard
          key={i} index={i} comp={comp}
          level={compData?.competencyLevels?.[i] ?? compData?.currentLevel ?? null}
          status={compData?.competencyStatuses?.[i] ?? compData?.status ?? 'Stagnant'}
          compData={compData} viewingAsId={officerId} role={officerRole}
        />
      ))
    }

    // Functional — always render FunctionalCard; fall back to framework entries with null scores
    if (type === 'Functional') {
      const funcComps = compData?.functionalCompetencies
      const fwGroup   = framework.filter(c => c.competency_type === 'Functional')
      const cards = funcComps?.length
        ? funcComps
        : fwGroup.map((comp, i) => ({
            index: 200 + i, name: comp.name,
            shortDescription: comp.short_description ?? '',
            bulletPoints: comp.bullet_points ?? [],
            score: null, level: null, status: 'Stagnant', rationale: null,
          }))
      if (!cards.length) return (
        <div style={{ background: 'white', borderRadius: '12px', padding: '32px', textAlign: 'center', fontSize: '13px', color: '#9ca3af' }}>
          No functional competencies found.
        </div>
      )
      return cards.map(comp => (
        <FunctionalCard key={comp.index} comp={comp} viewingAsId={officerId} isLeadership={false} role={officerRole} />
      ))
    }

    // Leadership — always render FunctionalCard; fall back to framework entries with null scores
    if (type === 'Leadership') {
      const leadComps = compData?.leadershipCompetencies
      const fwGroup   = framework.filter(c => c.competency_type === 'Leadership')
      const cards = leadComps?.length
        ? leadComps
        : fwGroup.map((comp, i) => ({
            index: 300 + i, name: comp.name,
            shortDescription: comp.short_description ?? '',
            bulletPoints: comp.bullet_points ?? [],
            score: null, level: null, status: 'Stagnant', rationale: null,
          }))
      if (!cards.length) return (
        <div style={{ background: 'white', borderRadius: '12px', padding: '32px', textAlign: 'center', fontSize: '13px', color: '#9ca3af' }}>
          No leadership competencies found.
        </div>
      )
      return cards.map(comp => (
        <FunctionalCard key={comp.index} comp={comp} viewingAsId={officerId} isLeadership={true} role={officerRole} />
      ))
    }

    const group = framework.filter(c => c.competency_type === type)
    if (!group.length) return (
      <div style={{ background: 'white', borderRadius: '12px', padding: '32px', textAlign: 'center', fontSize: '13px', color: '#9ca3af' }}>
        No {type.toLowerCase()} competencies found.
      </div>
    )

    return group.map(comp => {
      const coreIdx = CORE_AI_INDEX[comp.name]

      if (type === 'Core' && coreIdx !== undefined) {
        return (
          <CompetencyCard
            key={comp.name}
            index={coreIdx}
            comp={{ name: comp.name, short: comp.short_description || comp.bullet_points?.[0] || '' }}
            level={compData?.competencyLevels?.[coreIdx] ?? compData?.currentLevel ?? null}
            status={compData?.competencyStatuses?.[coreIdx] ?? compData?.status ?? 'Stagnant'}
            compData={compData}
            viewingAsId={officerId}
            role={officerRole}
          />
        )
      }

      return null
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      <Topbar
        title="Competency Development Breakdown"
        subtitle="Click on competencies to view development details and supporting evidence"
      />

      {/* Tab bar */}
      <div style={{
        background: 'white', borderBottom: '1px solid #e5e7eb',
        padding: '0 24px', display: 'flex', alignItems: 'center', gap: '6px',
        flexShrink: 0,
      }}>
        {TABS.map(tab => {
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '12px 16px', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '13px', fontWeight: active ? '700' : '500',
                background: 'transparent',
                color: active ? '#1e6b4a' : '#6b7280',
                borderBottom: active ? '2.5px solid #1e6b4a' : '2.5px solid transparent',
                marginBottom: '-1px',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: '#f0fdf8' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>Loading competency data…</div>
          </div>
        )}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '16px', color: '#dc2626', fontSize: '13px', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {!loading && (
          <>
            {/* Summary header */}
            {compData && (() => {
              const isCorr = activeTab === 'Correspondence'
              const isFunc = activeTab === 'Functional'
              const isLead = activeTab === 'Leadership'
              const displayLevel  = isCorr ? compData.correspondenceLevel  : isFunc ? compData.functionalLevel  : isLead ? compData.leadershipLevel  : compData.currentLevel
              const displayScore  = isCorr ? compData.correspondenceOverall : isFunc ? compData.functionalOverall : isLead ? compData.leadershipOverall : compData.currentScore
              const displayStatus = isCorr ? compData.correspondenceStatus  : isFunc ? compData.functionalStatus : isLead ? compData.leadershipStatus  : compData.status
              const st = statusConfig(displayStatus ?? 'Stagnant')
              return (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '20px',
                  background: 'white', borderRadius: '14px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                  padding: '18px 24px', marginBottom: '20px',
                }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {isCorr ? 'Correspondence Level' : isLead ? 'Leadership Level' : isFunc ? 'Functional Level' : 'Current Level'}
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: '800', color: displayLevel ? LEVEL_TEXT[displayLevel] : '#9ca3af' }}>
                      {scoreToAbsoluteLevel(displayScore, officerRole) != null ? `Level ${scoreToAbsoluteLevel(displayScore, officerRole)}` : '—'}
                    </div>
                  </div>
                  <div style={{ width: '1px', height: '40px', background: '#f3f4f6' }} />
                  <div>
                    <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {isCorr ? 'Avg Score (5 comps)' : (isFunc || isLead) ? 'AI Avg Score' : 'Latest Score'}
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: '800', color: '#111827' }}>
                      {displayScore != null ? `${displayScore}%` : '—'}
                    </div>
                  </div>
                  <div style={{ width: '1px', height: '40px', background: '#f3f4f6' }} />
                  <div>
                    <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trend</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: st.color, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {st.icon} {st.label}
                      </span>
                    </div>
                  </div>
                  {isCorr && (
                    <>
                      <div style={{ width: '1px', height: '40px', background: '#f3f4f6' }} />
                      <div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Competencies Tracked</div>
                        <div style={{ fontSize: '26px', fontWeight: '800', color: '#111827' }}>
                          {compData.correspondenceCompetencies?.length ?? 0}
                        </div>
                      </div>
                    </>
                  )}
                  <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ca3af' }}>
                    {compData.history?.length ?? 0} upload{compData.history?.length !== 1 ? 's' : ''} on record ·{' '}
                    Latest: {compData.latestDate ?? '—'}
                  </div>
                </div>
              )
            })()}

            {/* No data state */}
            {compData && compData.currentLevel === null && (
              <div style={{
                background: 'white', borderRadius: '14px', padding: '40px',
                textAlign: 'center', marginBottom: '20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
              }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  No Auditmate data uploaded yet
                </div>
                <div style={{ fontSize: '13px', color: '#9ca3af' }}>
                  Upload an Auditmate CSV on the Data Upload page to see competency levels.
                </div>
              </div>
            )}

            {/* Framework not seeded warning */}
            {!hasFramework && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: '10px', padding: '12px 16px', marginBottom: '16px',
                display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#92400e',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Competency framework not loaded. Please run: <code style={{ background: '#fef3c7', padding: '1px 6px', borderRadius: '4px' }}>npm run seed:competencies</code>
              </div>
            )}

            {/* Active tab cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {renderTabCards(activeTab)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
