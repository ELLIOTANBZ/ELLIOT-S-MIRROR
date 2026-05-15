import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

/* ── icons ───────────────────────────────────────────────────── */
const Svg = ({ children, size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color ?? 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)
const WarnCircle = ({ color }) => <Svg color={color}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></Svg>
const CheckCircle= ({ color }) => <Svg color={color}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></Svg>
const WarnTriangle=({ color })=> <Svg color={color}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Svg>

/* ── stat card ───────────────────────────────────────────────── */
function StatCard({ label, count, subtitle, borderColor, countColor, Icon }) {
  const hasAlerts = count > 0
  return (
    <div style={{
      background: 'white', borderRadius: '14px', flex: 1,
      border: `1.5px solid ${hasAlerts ? borderColor : '#e5e7eb'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        <Icon color={hasAlerts ? countColor : '#d1d5db'} />
      </div>
      <div style={{ fontSize: '36px', fontWeight: '800', color: hasAlerts ? countColor : '#9ca3af', lineHeight: 1 }}>
        {count}
      </div>
      <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '6px' }}>{subtitle}</div>
    </div>
  )
}

/* ── alert card ──────────────────────────────────────────────── */
function AlertCard({ title, message, bg, border, textColor, Icon }) {
  return (
    <div style={{
      background: bg, borderRadius: '10px', padding: '14px 18px',
      borderLeft: `3px solid ${border}`,
      display: 'flex', gap: '12px', alignItems: 'flex-start',
    }}>
      <span style={{ flexShrink: 0, marginTop: '1px' }}>
        <Icon color={border} />
      </span>
      <div>
        <div style={{ fontSize: '13px', fontWeight: '700', color: textColor, marginBottom: '3px' }}>{title}</div>
        <div style={{ fontSize: '12px', color: textColor, opacity: 0.85, lineHeight: '1.55' }}>{message}</div>
      </div>
    </div>
  )
}

/* ── section card ────────────────────────────────────────────── */
function SectionCard({ title, titleColor, Icon, children, emptyMsg }) {
  return (
    <div style={{
      background: 'white', borderRadius: '14px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Icon color={titleColor} />
        <div style={{ fontSize: '14px', fontWeight: '700', color: titleColor }}>{title}</div>
      </div>
      {children ?? (
        <div style={{
          textAlign: 'center', padding: '24px 0', color: '#9ca3af',
          fontSize: '13px', background: '#f9fafb', borderRadius: '8px',
        }}>
          {emptyMsg}
        </div>
      )}
    </div>
  )
}

/* ── analysis summary ────────────────────────────────────────── */
function AnalysisSummary() {
  return (
    <div style={{
      background: 'white', borderRadius: '14px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '24px',
    }}>
      <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', marginBottom: '14px' }}>
        Analysis Summary
      </div>
      <p style={{ fontSize: '13px', color: '#374151', lineHeight: '1.75', margin: 0 }}>
        Performance flags are computed from the officer's uploaded Auditmate and ESS data using 200 Monte Carlo simulation iterations for trend projection.{' '}
        <span style={{ color: '#cc0000', fontWeight: '600' }}>Red flags</span> indicate critical skill gaps requiring immediate intervention.{' '}
        <span style={{ color: '#d97706', fontWeight: '600' }}>Amber warnings</span> highlight development opportunities and potential plateaus.{' '}
        <span style={{ color: '#2d8a50', fontWeight: '600' }}>Green flags</span> recognise strong progression and readiness signals for career advancement.{' '}
        The system evaluates all{' '}
        <span style={{ fontWeight: '600', color: '#111827' }}>6 core competencies</span>,{' '}
        <span style={{ fontWeight: '600', color: '#111827' }}>10 quality indicators</span>, and operational performance metrics
        to provide a comprehensive picture of officer development.
      </p>
    </div>
  )
}

/* ── main page ───────────────────────────────────────────────── */
export default function FlagsAlerts() {
  const { viewingAs, user } = useAuth()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const officerId = viewingAs?.id ?? user?.id

  useEffect(() => {
    setLoading(true); setError(null)
    const url = `/api/flags-alerts${officerId ? `?officerId=${officerId}` : ''}`
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load flags data.'); setLoading(false) })
  }, [officerId])

  const counts = data?.counts ?? { critical: 0, development: 0, positive: 0 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <Topbar title="Competency Development Alerts" subtitle="Critical insights and development flags" />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: '#f0fdf8' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>Analysing performance data…</div>
          </div>
        )}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '16px', color: '#dc2626', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* ── Stat cards ── */}
            <div style={{ display: 'flex', gap: '16px' }}>
              <StatCard
                label="Critical Alerts"
                count={counts.critical}
                subtitle="Require immediate action"
                borderColor="#ffb3b3"
                countColor="#cc0000"
                Icon={WarnCircle}
              />
              <StatCard
                label="Development Opportunities"
                count={counts.development}
                subtitle="Areas for improvement"
                borderColor="#ffd580"
                countColor="#d97706"
                Icon={WarnTriangle}
              />
              <StatCard
                label="Positive Signals"
                count={counts.positive}
                subtitle="Strengths identified"
                borderColor="#b3f0c8"
                countColor="#2d8a50"
                Icon={CheckCircle}
              />
            </div>

            {/* ── No data state ── */}
            {data && !data.hasData && (
              <div style={{
                background: 'white', borderRadius: '14px', padding: '48px',
                textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
              }}>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  No data available yet
                </div>
                <div style={{ fontSize: '13px', color: '#9ca3af' }}>
                  Upload Auditmate and ESS CSVs on the Data Upload page to generate alerts.
                </div>
              </div>
            )}

            {data?.hasData && (
              <>
                {/* ── Critical Alerts ── */}
                <SectionCard
                  title="Critical Alerts"
                  titleColor="#cc0000"
                  Icon={WarnCircle}
                  emptyMsg="No critical alerts at this time."
                >
                  {data.critical.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {data.critical.map((a, i) => (
                        <AlertCard
                          key={i}
                          title={a.title}
                          message={a.message}
                          bg="#fff0f0"
                          border="#cc0000"
                          textColor="#7a2020"
                          Icon={WarnCircle}
                        />
                      ))}
                    </div>
                  ) : null}
                </SectionCard>

                {/* ── Development Opportunities ── */}
                <SectionCard
                  title="Development Opportunities"
                  titleColor="#d97706"
                  Icon={WarnTriangle}
                  emptyMsg="No development opportunities flagged."
                >
                  {data.development.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {data.development.map((a, i) => (
                        <AlertCard
                          key={i}
                          title={a.title}
                          message={a.message}
                          bg="#fffbf0"
                          border="#e6a817"
                          textColor="#7a5500"
                          Icon={WarnTriangle}
                        />
                      ))}
                    </div>
                  ) : null}
                </SectionCard>

                {/* ── Positive Signals ── */}
                <SectionCard
                  title="Positive Signals"
                  titleColor="#2d8a50"
                  Icon={CheckCircle}
                  emptyMsg="No strengths identified yet."
                >
                  {data.positive.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {data.positive.map((a, i) => (
                        <AlertCard
                          key={i}
                          title={a.title}
                          message={a.message}
                          bg="#f0fff5"
                          border="#2d8a50"
                          textColor="#1a5c38"
                          Icon={CheckCircle}
                        />
                      ))}
                    </div>
                  ) : null}
                </SectionCard>
              </>
            )}

            {/* ── Analysis Summary ── */}
            <AnalysisSummary />

          </div>
        )}
      </div>
    </div>
  )
}
