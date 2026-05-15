import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */
const TEAL       = '#1e6b4a'
const LEVEL_NAME = ['', 'Basic', 'Intermediate', 'Advanced']
const LEVEL_COLOR= { 1: '#6b7280', 2: '#2563eb', 3: '#059669' }
const LEVEL_BG   = { 1: '#f3f4f6', 2: '#eff6ff', 3: '#ecfdf5' }

/* ═══════════════════════════════════════════════════════════════
   TINY HELPERS & ICONS
═══════════════════════════════════════════════════════════════ */
const Svg = ({ children, size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)
const TrendUp   = ({ color }) => <Svg color={color} size={13}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></Svg>
const TrendDown = ({ color }) => <Svg color={color} size={13}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></Svg>
const WarnIcon  = ({ color }) => <Svg color={color} size={14}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Svg>
const PencilIcon= () => <Svg size={11} color="#9ca3af"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></Svg>
const SaveIcon  = () => <Svg size={14} color="white"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></Svg>

function getInitials(name) {
  return (name ?? '?').split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('')
}

function scoreColor(s) {
  if (s == null) return '#9ca3af'
  if (s >= 80) return '#059669'; if (s >= 60) return '#d97706'; return '#dc2626'
}

function ProgressBar({ pct, color, height = 5 }) {
  return (
    <div style={{ height, background: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, pct ?? 0)}%`, background: color, borderRadius: '3px', transition: 'width 0.3s' }} />
    </div>
  )
}

function StatusPill({ level, score }) {
  if (score == null) return <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', background: '#f3f4f6', color: '#9ca3af' }}>No data</span>
  const lv = level ?? 1
  return (
    <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', background: LEVEL_BG[lv], color: LEVEL_COLOR[lv] }}>
      {LEVEL_NAME[lv]}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════
   OFFICER DRILL-DOWN (shared TL + Supervisor)
═══════════════════════════════════════════════════════════════ */
function OfficerDrillDown({ officerId, isSupervisor, onOverrideSaved }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [overrideMode, setOvMode] = useState(false)
  const [ovLevels, setOvLevels]   = useState({})
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(null)

  const load = useCallback(() => {
    if (!officerId) return
    setLoading(true); setError(null)
    fetch(`/api/team-overview/officer/${officerId}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load officer data.'); setLoading(false) })
  }, [officerId])

  useEffect(() => { load() }, [load])

  function enterOverride() {
    const init = {}
    data.competencies.forEach((c, i) => { init[i] = c.level ?? 1 })
    setOvLevels(init); setOvMode(true)
  }
  function cancelOverride() { setOvMode(false) }

  async function saveOverride() {
    setSaving(true)
    try {
      const res = await fetch('/api/team-overview/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ officerId, levels: ovLevels }),
      })
      if (!res.ok) throw new Error('Failed')
      setOvMode(false); setSaving(false)
      setToast('Override saved successfully.')
      setTimeout(() => setToast(null), 3000)
      load(); if (onOverrideSaved) onOverrideSaved()
    } catch {
      setSaving(false)
      setToast('Error saving override.')
      setTimeout(() => setToast(null), 3000)
    }
  }

  if (!officerId) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '13px' }}>
      Select an officer to view details
    </div>
  )
  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '14px' }}>
      Loading officer data…
    </div>
  )
  if (error || !data) return (
    <div style={{ padding: '24px', color: '#dc2626', fontSize: '13px' }}>{error ?? 'Unknown error'}</div>
  )

  const levelNames = ['', 'Basic', 'Intermediate', 'Advanced']
  const compScore = data.compScore

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 999,
          background: '#1e3a35', color: 'white', borderRadius: '10px',
          padding: '12px 20px', fontSize: '13px', fontWeight: '600',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>{toast}</div>
      )}

      {/* ── Section 1: Header card ── */}
      <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '700', color: 'white', flexShrink: 0 }}>
              {getInitials(data.name)}
            </div>
            <div>
              <div style={{ fontSize: '17px', fontWeight: '800', color: '#111827' }}>{data.name}</div>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                {data.role} · Overall {data.score != null ? `${data.score}%` : 'No data'}
              </div>
            </div>
          </div>
          {data.monthChange !== null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700',
              background: data.monthChange >= 0 ? '#d4f5e2' : '#ffd5d5',
              color: data.monthChange >= 0 ? '#1a5c38' : '#7a2020',
            }}>
              {data.monthChange >= 0 ? <TrendUp color="#1a5c38" /> : <TrendDown color="#7a2020" />}
              {data.monthChange >= 0 ? '+' : ''}{data.monthChange}% this month
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Core Competencies ── */}
      <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>Core Competencies</div>
          {isSupervisor && !overrideMode && (
            <button onClick={enterOverride} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 14px', borderRadius: '8px', border: '1px solid #fbbf24',
              background: '#fffbeb', color: '#92400e', fontSize: '12px', fontWeight: '600',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <PencilIcon /> Override Scores
            </button>
          )}
          {isSupervisor && overrideMode && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={cancelOverride} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid #d1d5db', background: 'white', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={saveOverride} disabled={saving} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                background: saving ? '#9ca3af' : TEAL, color: 'white',
                fontSize: '12px', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}>
                <SaveIcon /> {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {data.competencies.map((c, i) => {
            const lv = overrideMode ? (ovLevels[i] ?? c.level ?? 1) : (c.level ?? null)
            const pct = lv ? [0, 33, 66, 100][lv] : 0
            const col = lv ? LEVEL_COLOR[lv] : '#e5e7eb'
            return (
              <div key={i} style={{ background: '#f9fafb', borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', gap: '6px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: '600', color: '#374151', lineHeight: '1.3', flex: 1 }}>{c.name}</div>
                  {overrideMode ? (
                    <select
                      value={ovLevels[i] ?? 1}
                      onChange={e => setOvLevels(prev => ({ ...prev, [i]: Number(e.target.value) }))}
                      style={{ fontSize: '11px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '2px 4px', cursor: 'pointer', background: 'white', fontFamily: 'inherit' }}
                    >
                      <option value={1}>Basic</option>
                      <option value={2}>Intermediate</option>
                      <option value={3}>Advanced</option>
                    </select>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {c.overridden && <PencilIcon />}
                      <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px', background: lv ? LEVEL_BG[lv] : '#f3f4f6', color: lv ? LEVEL_COLOR[lv] : '#9ca3af', whiteSpace: 'nowrap' }}>
                        {lv ? levelNames[lv] : 'N/A'}
                      </span>
                    </div>
                  )}
                </div>
                <ProgressBar pct={pct} color={col} height={4} />
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>Overall Competency Score</span>
          <span style={{ fontSize: '16px', fontWeight: '800', color: compScore != null ? scoreColor(compScore) : '#9ca3af' }}>
            {compScore != null ? `${compScore}%` : '—'}
          </span>
        </div>
      </div>

      {/* ── Section 3: Active Alerts ── */}
      <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '14px' }}>
          <WarnIcon color={data.alertCount > 0 ? '#d97706' : '#9ca3af'} />
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>Active Alerts ({data.alertCount})</div>
        </div>
        {data.alertCount === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '13px', padding: '16px 0', background: '#f9fafb', borderRadius: '8px' }}>
            No active alerts for this officer
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.alerts.critical.map((a, i) => (
              <div key={`c${i}`} style={{ display: 'flex', gap: '10px', background: '#fff0f0', borderRadius: '8px', padding: '10px 14px', borderLeft: '3px solid #cc0000' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#cc0000', flexShrink: 0, marginTop: '4px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#7a2020' }}>{a.title}</div>
                  <div style={{ fontSize: '12px', color: '#7a2020', opacity: 0.85, marginTop: '2px', lineHeight: '1.5' }}>{a.message}</div>
                </div>
              </div>
            ))}
            {data.alerts.development.map((a, i) => (
              <div key={`d${i}`} style={{ display: 'flex', gap: '10px', background: '#fffbf0', borderRadius: '8px', padding: '10px 14px', borderLeft: '3px solid #e6a817' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e6a817', flexShrink: 0, marginTop: '4px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#7a5500' }}>{a.title}</div>
                  <div style={{ fontSize: '12px', color: '#7a5500', opacity: 0.85, marginTop: '2px', lineHeight: '1.5' }}>{a.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 4: Quality Indicators ── */}
      <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '20px 24px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', marginBottom: '14px' }}>Quality Indicators</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {data.indicators.map(ind => {
            const barColor = ind.avg == null ? '#e5e7eb' : ind.avg >= 75 ? '#22c55e' : ind.avg >= 50 ? '#3b82f6' : '#ef4444'
            return (
              <div key={ind.name} style={{ background: '#f9fafb', borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: '600', color: '#374151', lineHeight: '1.3' }}>{ind.name}</span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#111827', flexShrink: 0, marginLeft: '8px' }}>
                    {ind.total > 0 ? `${ind.passed}/${ind.total}` : '—'}
                  </span>
                </div>
                <ProgressBar pct={ind.avg ?? 0} color={barColor} height={4} />
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 5: Performance Summary ── */}
      <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '20px 24px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', marginBottom: '10px' }}>Performance Summary</div>
        {data.summary ? (
          <p style={{ fontSize: '13px', color: '#374151', lineHeight: '1.75', margin: 0 }}>{data.summary}</p>
        ) : (
          <div style={{ fontSize: '13px', color: '#9ca3af', background: '#f9fafb', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
            {data.hasData ? 'AI summary requires OPENROUTER_API_KEY.' : 'No data uploaded yet — upload Auditmate CSV to generate summary.'}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TL VIEW — two-column layout
═══════════════════════════════════════════════════════════════ */
function TLView({ user, members, membersLoading }) {
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (members.length && !selectedId) setSelectedId(members[0].id)
  }, [members])

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Topbar title="Team Overview" subtitle={`Manage and monitor ${members.length} team member${members.length !== 1 ? 's' : ''}`} />
      <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: '300px 1fr', background: '#f0fdf8' }}>

        {/* Left: member list */}
        <div style={{ overflow: 'auto', padding: '20px 12px 20px 20px', borderRight: '1px solid #e5e7eb', background: '#f0fdf8' }}>
          <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>Team Members</div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{members.length} officer{members.length !== 1 ? 's' : ''}</div>
            </div>
            {membersLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>Loading…</div>
            ) : members.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>No team members assigned.</div>
            ) : (
              members.map(m => {
                const isActive = m.id === selectedId
                const scoreCol = m.score != null ? (m.score >= 75 ? '#059669' : '#d97706') : '#9ca3af'
                const scoreBg  = m.score != null ? (m.score >= 75 ? '#ecfdf5' : '#fffbeb') : '#f3f4f6'
                return (
                  <button key={m.id} onClick={() => setSelectedId(m.id)} style={{
                    width: '100%', textAlign: 'left', padding: '14px 16px',
                    background: isActive ? '#eef9f4' : 'transparent',
                    border: 'none', borderLeft: `3px solid ${isActive ? TEAL : 'transparent'}`,
                    borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>{m.name}</div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>{m.role}</div>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '10px', background: scoreBg, color: scoreCol, flexShrink: 0 }}>
                        {m.score != null ? `${m.score}%` : '—'}
                      </span>
                    </div>
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#9ca3af', marginBottom: '3px' }}>
                        <span>Performance</span><span>{m.score != null ? `${m.score}%` : '—'}</span>
                      </div>
                      <ProgressBar pct={m.score ?? 0} color={scoreCol} height={4} />
                    </div>
                    <div style={{ marginTop: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#9ca3af', marginBottom: '3px' }}>
                        <span>Competency</span><span>{m.compScore != null ? `${m.compScore}%` : '—'}</span>
                      </div>
                      <ProgressBar pct={m.compScore ?? 0} color="#3b82f6" height={4} />
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: drill-down */}
        <div style={{ overflow: 'auto', padding: '20px' }}>
          <OfficerDrillDown officerId={selectedId} isSupervisor={false} />
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SUPERVISOR VIEW — table + expandable drill-down
═══════════════════════════════════════════════════════════════ */
function SupervisorView({ user, members, membersLoading }) {
  const [expandedId, setExpandedId] = useState(null)

  const advanced     = members.filter(m => (m.level ?? 0) >= 3).length
  const intermediate = members.filter(m => m.level === 2).length
  const basicNoData  = members.filter(m => !m.level || m.level === 1).length

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Topbar title="Team Overview" subtitle={`CSOs & Team Leaders · ${members.length} member${members.length !== 1 ? 's' : ''}`} />
      <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: '#f0fdf8' }}>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
          {[
            { label: 'Total Officers',  value: members.length, color: TEAL },
            { label: 'Advanced',        value: advanced,       color: '#059669' },
            { label: 'Intermediate',    value: intermediate,   color: '#d97706' },
            { label: 'Basic / No Data', value: basicNoData,    color: '#dc2626' },
          ].map(card => (
            <div key={card.label} style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '20px 24px' }}>
              <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{card.label}</div>
              <div style={{ fontSize: '30px', fontWeight: '800', color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px 110px 100px', gap: '0', padding: '12px 24px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
            {['Officer', 'Score', '28-Day Avg', 'Status', 'Action'].map(h => (
              <div key={h} style={{ fontSize: '10px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
            ))}
          </div>

          {membersLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>Loading team data…</div>
          ) : (
            members.map(m => (
              <div key={m.id}>
                <div
                  onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 90px 110px 110px 100px',
                    alignItems: 'center', padding: '14px 24px',
                    borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                    background: expandedId === m.id ? '#f0fdf8' : 'white',
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Officer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: 'white', flexShrink: 0 }}>
                      {getInitials(m.name)}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>{m.name}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>{m.role}</div>
                    </div>
                  </div>
                  {/* Score */}
                  <div style={{ fontSize: '16px', fontWeight: '800', color: scoreColor(m.score) }}>
                    {m.score != null ? `${m.score}%` : <span style={{ fontSize: '12px', color: '#9ca3af' }}>No data</span>}
                  </div>
                  {/* 28-day avg */}
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    {m.score != null ? `${m.score}%` : <span style={{ fontSize: '12px', color: '#9ca3af' }}>—</span>}
                  </div>
                  {/* Status */}
                  <div><StatusPill level={m.level} score={m.score} /></div>
                  {/* Action */}
                  <div onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                      style={{
                        padding: '5px 14px', borderRadius: '20px', border: '1px solid #fbbf24',
                        background: '#fffbeb', color: '#92400e', fontSize: '12px', fontWeight: '600',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      Override
                    </button>
                  </div>
                </div>

                {/* Expanded drill-down */}
                {expandedId === m.id && (
                  <div style={{ padding: '20px 24px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                    <OfficerDrillDown officerId={m.id} isSupervisor={true} onOverrideSaved={() => {}} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════════════════════════════ */
export default function TeamOverview() {
  const { user } = useAuth()
  const [members, setMembers]           = useState([])
  const [membersLoading, setMembersLoading] = useState(true)

  // Redirect CSO
  if (user?.role === 'CSO') return <Navigate to="/dashboard" replace />

  useEffect(() => {
    fetch('/api/team-overview/members', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(d => { setMembers(Array.isArray(d) ? d : []); setMembersLoading(false) })
      .catch(() => setMembersLoading(false))
  }, [user])

  const props = { user, members, membersLoading }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {user?.role === 'TL'
        ? <TLView {...props} />
        : <SupervisorView {...props} />
      }
    </div>
  )
}
