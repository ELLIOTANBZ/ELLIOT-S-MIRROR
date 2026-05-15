import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

/* Icons — same as AdminPanel */
const PersonIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
)
const ClipboardIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
  </svg>
)
const ChatIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)

/* Exact same DataSummaryCard used in AdminPanel */
function DataSummaryCard({ title, data, icon, color }) {
  if (!data) return null
  return (
    <div style={{
      background: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      padding: '20px',
      minWidth: '0',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '9px',
          background: color.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: color.text,
        }}>
          {icon}
        </div>
        <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>{title}</div>
      </div>
      <div style={{ fontSize: '24px', fontWeight: '800', color: '#1e3a35', marginBottom: '4px' }}>
        {data.count}
      </div>
      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
        {data.type === 'interactions' ? 'interactions logged' :
         data.type === 'auditmate' ? 'cases audited' : 'responses'}
      </div>
      {data.avgScore !== undefined && data.avgScore !== null && (
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
          Avg Score: <span style={{ fontWeight: '700', color: data.avgScore < 50 ? '#dc2626' : '#111827' }}>{data.avgScore}%</span>
        </div>
      )}
      {data.majorIssues !== undefined && data.majorIssues > 0 && (
        <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: '600', marginBottom: '4px' }}>
          Major Issues: {data.majorIssues}
        </div>
      )}
      {data.avgRating !== undefined && data.avgRating !== null && (
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
          Avg Rating: <span style={{ fontWeight: '700', color: '#111827' }}>{data.avgRating} / 5</span>
        </div>
      )}
      {data.positive !== undefined && (
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
          Positive: <span style={{ fontWeight: '600', color: '#16a34a' }}>{data.positive}</span>
          {' / '}Negative: <span style={{ fontWeight: '600', color: '#dc2626' }}>{data.negative}</span>
        </div>
      )}
    </div>
  )
}

export default function DataSummaryPage() {
  const { user, viewingAs } = useAuth()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)

  const officerId = viewingAs?.id ?? user?.id

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ date })
    if (officerId) params.set('officerId', officerId)
    fetch(`/api/upload/user-summary?${params}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => r.json())
      .then(data => { setCards(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setCards([]); setLoading(false) })
  }, [date, officerId])

  const CARD_META = {
    interactions: { title: 'Interactions', icon: <PersonIcon />,    color: { bg: '#e8f5f0', text: '#1e3a35' } },
    auditmate:    { title: 'Auditmate',    icon: <ClipboardIcon />, color: { bg: '#eff6ff', text: '#3b82f6' } },
    ess:          { title: 'ESS',          icon: <ChatIcon />,      color: { bg: '#f5f3ff', text: '#7c3aed' } },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <Topbar title="Data Summary" subtitle="View your uploaded data by date" />

      <div style={{ flex: 1, overflow: 'auto', padding: '28px' }}>
        {/* Date picker */}
        <div style={{
          background: 'white', borderRadius: '14px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
          padding: '20px', marginBottom: '24px',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Date</div>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setDate(e.target.value)}
            style={{
              border: '1.5px solid #d1d5db', borderRadius: '8px',
              padding: '7px 12px', fontSize: '13px', color: '#111827',
              outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
            }}
            onFocus={e => e.target.style.borderColor = '#1e3a35'}
            onBlur={e => e.target.style.borderColor = '#d1d5db'}
          />
        </div>

        {/* Cards */}
        {loading ? (
          <div style={{
            background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px',
            padding: '40px', textAlign: 'center', fontSize: '13px', color: '#9ca3af',
          }}>
            Loading...
          </div>
        ) : cards.length > 0 ? (
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {cards.map((item, i) => {
              const meta = CARD_META[item.type] || { title: item.type, icon: null, color: { bg: '#f3f4f6', text: '#6b7280' } }
              return (
                <DataSummaryCard
                  key={i}
                  title={meta.title}
                  data={item}
                  icon={meta.icon}
                  color={meta.color}
                />
              )
            })}
          </div>
        ) : (
          <div style={{
            background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px',
            padding: '40px', textAlign: 'center', fontSize: '13px', color: '#9ca3af',
          }}>
            No data uploaded for this date
          </div>
        )}
      </div>
    </div>
  )
}
