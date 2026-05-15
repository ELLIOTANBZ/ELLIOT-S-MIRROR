import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

/* ── date helpers ────────────────────────────────────────────── */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtLabel(iso) {
  const [, m, d] = iso.split('-')
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`
}

function fmtPeriod(start, end) {
  if (!start || !end) return '—'
  return `${fmtLabel(start)} – ${fmtLabel(end)}`
}

/* ── custom tooltip ──────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px',
      padding: '12px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      fontFamily: "'Inter', -apple-system, sans-serif", minWidth: '150px',
    }}>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
        {label}
      </div>
      {payload.map((entry, i) => (
        entry.value !== null && entry.value !== undefined &&
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: i < payload.length - 1 ? '4px' : 0 }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: '#6b7280', flex: 1 }}>{entry.name}</span>
          <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>
            {entry.value.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ── stat card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, iconBg, icon, badge, badgeColor }) {
  return (
    <div style={{
      background: 'white', borderRadius: '14px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      padding: '22px 24px', flex: 1, minWidth: 0,
      display: 'flex', flexDirection: 'column', gap: '14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        <div style={{
          width: '36px', height: '36px', borderRadius: '10px',
          background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
      </div>
      <div>
        <div style={{ fontSize: '28px', fontWeight: '800', color: '#111827', lineHeight: '1', letterSpacing: '-0.02em' }}>
          {value ?? '—'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
          {sub && <div style={{ fontSize: '12px', color: '#9ca3af' }}>{sub}</div>}
          {badge && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              background: badgeColor.bg, color: badgeColor.text,
              borderRadius: '20px', padding: '2px 8px', fontSize: '11px', fontWeight: '600',
            }}>
              {badge}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Competency Level Distribution card ─────────────────────── */
function LevelDistributionCard({ levels, loading }) {
  const rows = [
    { label: 'Advanced Level',     key: 'advanced',     color: '#16a34a', bg: '#dcfce7', track: '#f0fdf4' },
    { label: 'Intermediate Level', key: 'intermediate', color: '#d97706', bg: '#fef3c7', track: '#fffbeb' },
    { label: 'Basic Level',        key: 'basic',        color: '#dc2626', bg: '#fee2e2', track: '#fef2f2' },
  ]

  const total = levels?.total ?? 0

  return (
    <div style={{
      background: 'white', borderRadius: '14px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      padding: '22px 24px', flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: '15px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
        Competency Level Distribution
      </div>
      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '20px' }}>
        Based on 30-day indicator performance
      </div>

      {loading ? (
        <div style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Loading…</div>
      ) : !total ? (
        <div style={{ color: '#c4c9d4', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
          No data — upload Auditmate CSV
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {rows.map(({ label, key, color, bg, track }) => {
            const count = levels?.[key] ?? 0
            const pct   = total > 0 ? (count / total) * 100 : 0
            return (
              <div key={key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', fontWeight: '500' }}>{label}</span>
                  <span style={{
                    fontSize: '13px', fontWeight: '700', color,
                    background: bg, borderRadius: '20px', padding: '2px 10px',
                  }}>
                    {count}/{total}
                  </span>
                </div>
                <div style={{ background: track, borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                  <div style={{
                    background: color, height: '100%', borderRadius: '6px',
                    width: `${pct}%`, transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Quality Indicators Status card ─────────────────────────── */
function IndicatorsCard({ indicators, loading }) {
  function indicatorColor(passRate) {
    if (passRate === null) return '#9ca3af'
    if (passRate >= 0.9) return '#16a34a'
    if (passRate >= 0.7) return '#d97706'
    return '#dc2626'
  }
  function indicatorTrack(passRate) {
    if (passRate === null) return '#f3f4f6'
    if (passRate >= 0.9) return '#f0fdf4'
    if (passRate >= 0.7) return '#fffbeb'
    return '#fef2f2'
  }
  function indicatorLabel(passRate) {
    if (passRate === null) return '—'
    const pct = passRate * 100
    if (pct === 100) return 'Pass'
    if (pct === 0)   return 'Fail'
    return `${pct.toFixed(0)}%`
  }

  return (
    <div style={{
      background: 'white', borderRadius: '14px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      padding: '22px 24px', flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: '15px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
        Quality Indicators Status
      </div>
      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '20px' }}>
        Average pass rate over past 30 days
      </div>

      {loading ? (
        <div style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Loading…</div>
      ) : !indicators?.length ? (
        <div style={{ color: '#c4c9d4', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
          No data — upload Auditmate CSV
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {indicators.map(({ name, passRate }) => {
            const color = indicatorColor(passRate)
            const track = indicatorTrack(passRate)
            const pct   = passRate !== null ? passRate * 100 : 0
            return (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                  <span style={{ fontSize: '12.5px', color: '#374151' }}>{name}</span>
                  <span style={{ fontSize: '12.5px', fontWeight: '700', color }}>{indicatorLabel(passRate)}</span>
                </div>
                <div style={{ background: track, borderRadius: '4px', height: '5px', overflow: 'hidden' }}>
                  <div style={{
                    background: color, height: '100%', borderRadius: '4px',
                    width: `${pct}%`, transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── empty / loading states ──────────────────────────────────── */
function EmptyChart() {
  return (
    <div style={{
      height: '280px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '10px',
    }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
      </svg>
      <div style={{ fontSize: '14px', color: '#9ca3af', fontWeight: '500' }}>No data available</div>
      <div style={{ fontSize: '13px', color: '#c4c9d4' }}>Upload Auditmate CSV to see your trend</div>
    </div>
  )
}

/* ── main page ───────────────────────────────────────────────── */
export default function DashboardPage() {
  const { user, viewingAs } = useAuth()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null)
      try {
        const officerId = viewingAs?.id ?? user?.id
        const url = `/api/dashboard${officerId ? `?officerId=${officerId}` : ''}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${getToken()}` },
        })
        if (!res.ok) throw new Error('Failed to load data')
        setData(await res.json())
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [viewingAs?.id])

  const stats            = data?.stats ?? {}
  const currentData      = data?.currentData ?? []
  const prevData         = data?.prevData ?? []
  const periods          = stats.periods ?? {}
  const indicators       = data?.indicators ?? []
  const competencyLevels = data?.competencyLevels ?? null

  /* merge into chart-ready array */
  const chartData = currentData.map((item, i) => ({
    label: fmtLabel(item.date),
    current:  item.score,
    previous: prevData[i]?.score ?? null,
  }))

  const hasChart = chartData.some(d => d.current !== null || d.previous !== null)

  /* stat card helpers */
  const score    = stats.competencyScore  ?? null
  const avg      = stats.monthAverage     ?? null
  const delta    = stats.delta            ?? null
  const target   = stats.targetStatus     ?? null

  const deltaPositive = delta !== null && delta >= 0
  const deltaLabel = delta !== null
    ? `${deltaPositive ? '+' : ''}${delta.toFixed(1)}% vs last period`
    : null

  const targetColor = target === 'Exceeds'
    ? { bg: '#dcfce7', text: '#166534' }
    : target === 'On Track'
    ? { bg: '#dcfce7', text: '#166534' }
    : { bg: '#fff7ed', text: '#c2410c' }

  /* title node for topbar */
  const titleNode = (
    <div style={{ fontWeight: '600', fontSize: '15px', lineHeight: '1.2', color: 'white' }}>
      Welcome back,{' '}
      <span style={{ fontWeight: '800', color: 'white' }}>{user?.name ?? 'Officer'}</span>!
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <Topbar
        variant="light"
        titleNode={titleNode}
        subtitle="Here's your performance overview for the past month"
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ── Stat cards ── */}
        <div style={{ display: 'flex', gap: '16px' }}>
          <StatCard
            label="Competency Score"
            value={score != null ? `${score.toFixed(1)}%` : null}
            sub="Latest available"
            iconBg="#e8f5f0"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e3a35" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            }
            badge={deltaLabel}
            badgeColor={deltaPositive
              ? { bg: '#dcfce7', text: '#166534' }
              : { bg: '#fef2f2', text: '#dc2626' }
            }
          />
          <StatCard
            label="Month Average"
            value={avg != null ? `${avg.toFixed(1)}%` : null}
            sub="Past 28 days"
            iconBg="#eff6ff"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8"  y1="2" x2="8"  y2="6"/>
                <line x1="3"  y1="10" x2="21" y2="10"/>
              </svg>
            }
          />
          <StatCard
            label="Target Status"
            value={target}
            sub="75% benchmark"
            iconBg="#f5f3ff"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
              </svg>
            }
            badge={target ? `${target === 'Needs to Develop' ? '< 75%' : target === 'Exceeds' ? '≥ 90%' : '75–89%'}` : null}
            badgeColor={targetColor}
          />
        </div>

        {/* ── Chart card ── */}
        <div style={{
          background: 'white', borderRadius: '14px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
          padding: '24px',
          flex: 1, minHeight: '340px',
        }}>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>
              Past Month Performance Trend
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '3px' }}>
              Auditmate scores per day
            </div>
          </div>

          {loading ? (
            <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px' }}>
              Loading…
            </div>
          ) : error ? (
            <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: '13px' }}>
              {error}
            </div>
          ) : !hasChart ? (
            <EmptyChart />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tealFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1e3a35" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#1e3a35" stopOpacity={0}    />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="4 4" stroke="#f0f0f0" vertical={false} />

                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    axisLine={false} tickLine={false}
                    interval={Math.floor(chartData.length / 8)}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => `${v}`}
                    label={{ value: 'Performance Score', angle: -90, position: 'insideLeft', offset: 16, style: { fontSize: 10, fill: '#c4c9d4' } }}
                  />

                  <Tooltip content={<ChartTooltip />} />

                  {/* Previous period — purple dashed, no fill */}
                  <Area
                    type="monotone" dataKey="previous"
                    name={`Previous (${fmtPeriod(periods.previous?.start, periods.previous?.end)})`}
                    stroke="#7c3aed" strokeWidth={1.5}
                    strokeDasharray="5 3"
                    fill="none" dot={false} connectNulls
                  />

                  {/* Current period — dark teal with fill */}
                  <Area
                    type="monotone" dataKey="current"
                    name={`Current (${fmtPeriod(periods.current?.start, periods.current?.end)})`}
                    stroke="#1e3a35" strokeWidth={2.5}
                    fill="url(#tealFill)" dot={false} connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>

              {/* Legend */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '16px' }}>
                {[
                  { color: '#1e3a35', label: `Current  (${fmtPeriod(periods.current?.start,  periods.current?.end)})` },
                  { color: '#7c3aed', label: `Previous (${fmtPeriod(periods.previous?.start, periods.previous?.end)})`, dashed: true },
                ].map(({ color, label, dashed }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: '#6b7280' }}>
                    <svg width="20" height="10" viewBox="0 0 20 10">
                      {dashed
                        ? <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2" strokeDasharray="5 3"/>
                        : <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2.5"/>
                      }
                    </svg>
                    {label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Bottom two cards ── */}
        <div style={{ display: 'flex', gap: '16px', paddingBottom: '4px' }}>
          <LevelDistributionCard levels={competencyLevels} loading={loading} />
          <IndicatorsCard        indicators={indicators}   loading={loading} />
        </div>

      </div>
    </div>
  )
}
