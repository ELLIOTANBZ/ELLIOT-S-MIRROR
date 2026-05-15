import { useState, useEffect } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

/* ── custom tooltip ──────────────────────────────────────────── */
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px',
      padding: '12px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      fontFamily: "'Inter', -apple-system, sans-serif", minWidth: '180px',
    }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
        {d.subject}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6aab8a' }} />
            <span style={{ fontSize: '12px', color: '#6b7280' }}>Current</span>
          </div>
          <span style={{ fontSize: '13px', fontWeight: '700', color: '#1a5c38' }}>{d.current}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#4a9fb5' }} />
            <span style={{ fontSize: '12px', color: '#6b7280' }}>3-Month</span>
          </div>
          <span style={{ fontSize: '13px', fontWeight: '700', color: '#1a3a6b' }}>{d.predicted}%</span>
        </div>
      </div>
    </div>
  )
}

/* ── custom legend ───────────────────────────────────────────── */
function ChartLegend() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '28px', marginTop: '12px' }}>
      {[
        { fill: '#b8d8c8', stroke: '#6aab8a', label: 'Current Performance' },
        { fill: '#a8d5e2', stroke: '#4a9fb5', label: '3-Month Predicted' },
      ].map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="20" height="14">
            <rect x="0" y="2" width="20" height="10" rx="3"
              fill={item.fill} stroke={item.stroke} strokeWidth="1.5" opacity="0.85" />
          </svg>
          <span style={{ fontSize: '12px', color: '#374151', fontWeight: '500' }}>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ── indicator details row ───────────────────────────────────── */
function IndicatorRow({ name, current, change }) {
  const pos = change !== null && change > 0
  const neg = change !== null && change < 0
  const neutral = change === null || change === 0

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '12px 0', borderBottom: '1px solid #f3f4f6',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}>{name}</div>
        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
          Current: {current != null ? `${Math.round(current)}%` : '—'}
        </div>
      </div>
      <div style={{
        fontSize: '12px', fontWeight: '700', padding: '4px 10px', borderRadius: '20px',
        background: pos ? '#d4f5e2' : neg ? '#ffd5d5' : '#f3f4f6',
        color: pos ? '#1a6b3a' : neg ? '#7a2020' : '#6b7280',
        minWidth: '56px', textAlign: 'center', flexShrink: 0,
      }}>
        {neutral
          ? '—'
          : `${pos ? '+' : ''}${change.toFixed(1)}%`
        }
      </div>
    </div>
  )
}

/* ── key insight row ─────────────────────────────────────────── */
function InsightRow({ name, text, trend, loading }) {
  // Fix 3: grey dot for flat trend
  const dotColor = trend === 'up' ? '#72d4a0' : trend === 'down' ? '#ff9999' : '#d1d5db'
  return (
    <div style={{ display: 'flex', gap: '12px', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{
        width: '10px', height: '10px', borderRadius: '50%',
        background: dotColor, flexShrink: 0, marginTop: '5px',
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827', marginBottom: '3px' }}>{name}</div>
        {loading ? (
          <div style={{ fontSize: '12px', color: '#9ca3af' }}>Generating insight…</div>
        ) : text ? (
          <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.5' }}>{text}</div>
        ) : (
          <div style={{ fontSize: '12px', color: '#d1d5db' }}>No insight available</div>
        )}
      </div>
    </div>
  )
}

/* ── empty state ─────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '60px 24px' }}>
      <div style={{
        background: 'white', borderRadius: '16px', padding: '48px',
        textAlign: 'center', maxWidth: '360px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ marginBottom: '16px' }}>
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        <div style={{ fontSize: '15px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
          No Auditmate data yet
        </div>
        <div style={{ fontSize: '13px', color: '#9ca3af', lineHeight: '1.6' }}>
          Upload an Auditmate CSV on the Data Upload page to generate the radar chart.
        </div>
      </div>
    </div>
  )
}

/* ── main page ───────────────────────────────────────────────── */
export default function CompetencyRadar() {
  const { viewingAs, user } = useAuth()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [toggle, setToggle]   = useState('weekly') // 'weekly' | 'monthly'

  const officerId = viewingAs?.id ?? user?.id

  useEffect(() => {
    setLoading(true); setError(null)
    const url = `/api/radar${officerId ? `?officerId=${officerId}` : ''}`
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load radar data.'); setLoading(false) })
  }, [officerId])

  const insightMap = {}
  if (data?.insights) {
    for (const ins of data.insights) insightMap[ins.name] = ins
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <Topbar title="Competency Radar Analysis" subtitle="Visual comparison of current vs predicted competencies" />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: '#f0fdf8' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>Loading radar data…</div>
          </div>
        )}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '16px', color: '#dc2626', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {!loading && !error && data && !data.hasData && <EmptyState />}

        {!loading && !error && data?.hasData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* ── Radar Chart Card ── */}
            <div style={{
              background: 'white', borderRadius: '14px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '24px',
            }}>
              <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
                Quality Indicators Comparison
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '20px' }}>
                Radar view of all 6 indicators · hover an axis point for values
              </div>

              <ResponsiveContainer width="100%" height={360}>
                <RadarChart data={data.radarData} margin={{ top: 8, right: 32, bottom: 8, left: 32 }}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fontSize: 12, fill: '#374151', fontFamily: "'Inter', sans-serif", fontWeight: 600 }}
                  />
                  <PolarRadiusAxis
                    angle={90} domain={[0, 100]} tickCount={6}
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    stroke="transparent"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {/* 3-Month Predicted — lighter, behind */}
                  <Radar
                    name="3-Month Predicted"
                    dataKey="predicted"
                    stroke="#4a9fb5"
                    strokeWidth={1.5}
                    fill="#a8d5e2"
                    fillOpacity={0.4}
                    strokeDasharray="5 3"
                  />
                  {/* Current — solid, on top */}
                  <Radar
                    name="Current Performance"
                    dataKey="current"
                    stroke="#6aab8a"
                    strokeWidth={2}
                    fill="#b8d8c8"
                    fillOpacity={0.6}
                  />
                </RadarChart>
              </ResponsiveContainer>

              <ChartLegend />
            </div>

            {/* ── Bottom two cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

              {/* Indicator Details */}
              <div style={{
                background: 'white', borderRadius: '14px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '24px',
              }}>
                {/* Header + toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>Indicator Details</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                      {toggle === 'weekly' ? 'vs previous 7 days' : 'vs previous 30 days'}
                    </div>
                  </div>
                  {/* Pill toggle */}
                  <div style={{
                    display: 'flex', background: '#f3f4f6', borderRadius: '20px', padding: '3px', gap: '2px',
                  }}>
                    {['weekly', 'monthly'].map(opt => (
                      <button
                        key={opt}
                        onClick={() => setToggle(opt)}
                        style={{
                          padding: '5px 14px', borderRadius: '16px', border: 'none',
                          fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          fontFamily: 'inherit',
                          background: toggle === opt ? '#1e6b4a' : 'transparent',
                          color:      toggle === opt ? 'white'   : '#6b7280',
                          transition: 'all 0.15s',
                        }}
                      >
                        {opt.charAt(0).toUpperCase() + opt.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  {data.indicatorDetails.map(ind => (
                    <IndicatorRow
                      key={ind.name}
                      name={ind.name}
                      current={ind.current}
                      change={toggle === 'weekly' ? ind.weekChange : ind.monthChange}
                    />
                  ))}
                </div>
              </div>

              {/* Key Insights */}
              <div style={{
                background: 'white', borderRadius: '14px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '24px',
              }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
                  Key Insights
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '16px' }}>
                  AI-generated trend analysis per indicator
                </div>

                <div>
                  {data.indicatorDetails.map(ind => {
                    const ins = insightMap[ind.name]
                    // Fix 3: derive trend from AI improving flag when available, else use server trend
                    const trendVal = ins?.improving === true ? 'up' : ins?.improving === false ? 'down' : ind.trend
                    return (
                      <InsightRow
                        key={ind.name}
                        name={ind.name}
                        text={ins?.text ?? null}
                        trend={trendVal}
                        loading={!data.insights && !error}
                      />
                    )
                  })}
                </div>

                {!data.insights && (
                  <div style={{ marginTop: '12px', fontSize: '12px', color: '#9ca3af', textAlign: 'center' }}>
                    AI insights require a valid OpenRouter API key.
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  )
}
