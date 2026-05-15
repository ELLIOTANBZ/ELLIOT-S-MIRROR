import { useState, useRef, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'

/* ── CSV parser ──────────────────────────────────────────────── */
function splitCSVLine(line) {
  const result = []
  let inQuotes = false, current = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = ''
    } else { current += ch }
  }
  result.push(current)
  return result
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = splitCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const vals = splitCSVLine(line)
      return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim().replace(/^"|"$/g, '')]))
    })
}

/* ── Toast ───────────────────────────────────────────────────── */
function Toast({ message, type = 'success', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div style={{
      position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
      background: type === 'success' ? '#1e3a35' : '#dc2626',
      color: 'white', borderRadius: '10px',
      padding: '14px 20px', fontSize: '14px', fontWeight: '500',
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      display: 'flex', alignItems: 'center', gap: '10px',
      animation: 'slideIn 0.25s ease',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {type === 'success'
        ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      }
      {message}
    </div>
  )
}

/* ── Upload card ─────────────────────────────────────────────── */
function UploadCard({ label, icon, file, onFile, dragKey, dragOver, onDragOver, onDragLeave, disabled }) {
  const inputRef = useRef()
  const isOver = dragOver === dragKey

  function handleDrop(e) {
    if (disabled) return
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.csv') || f.type === 'text/csv')) onFile(f)
    onDragLeave()
  }

  function handleBrowse(e) {
    if (disabled) return
    e.stopPropagation()
    inputRef.current.click()
  }

  function handleChange(e) {
    const f = e.target.files[0]
    if (f) onFile(f)
    e.target.value = ''
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div style={{
      flex: 1, background: disabled ? '#f9fafb' : 'white',
      border: '1px solid #e5e7eb', borderRadius: '12px',
      padding: '24px 20px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
      minWidth: 0, opacity: disabled ? 0.5 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
      transition: 'opacity 0.2s',
    }}>
      <div style={{
        width: '48px', height: '48px',
        background: disabled ? '#f3f4f6' : '#f0f7f5', borderRadius: '12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: disabled ? '#9ca3af' : '#1e3a35',
      }}>
        {icon}
      </div>

      <div style={{ fontSize: '14px', fontWeight: '700', color: disabled ? '#9ca3af' : '#111827' }}>{label}</div>

      {file ? (
        <div style={{
          width: '100%', background: '#f0f7f5',
          border: '1.5px solid #2d6a4f', borderRadius: '10px',
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1e3a35', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.name}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
              {formatSize(file.size)}
            </div>
          </div>
          <button
            onClick={() => onFile(null)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#6b7280', flexShrink: 0, padding: '2px',
              borderRadius: '4px', display: 'flex',
            }}
            title="Remove file"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); onDragOver(dragKey) }}
          onDragLeave={onDragLeave}
          onDrop={handleDrop}
          style={{
            width: '100%',
            border: `2px dashed ${isOver ? '#1e3a35' : '#d1d5db'}`,
            borderRadius: '10px',
            padding: '20px 16px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
            background: isOver ? '#f0f7f5' : '#fafafa',
            transition: 'all 0.15s', cursor: 'default',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div style={{ fontSize: '12px', color: '#6b7280', textAlign: 'center', lineHeight: '1.4' }}>
            Drop CSV here or
          </div>
          <button
            onClick={handleBrowse}
            style={{
              background: '#1e3a35', color: 'white',
              border: 'none', borderRadius: '6px',
              padding: '6px 14px', fontSize: '12px', fontWeight: '600',
              cursor: 'pointer', transition: 'background 0.15s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#2d6a4f'}
            onMouseLeave={e => e.currentTarget.style.background = '#1e3a35'}
          >
            Browse
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  )
}

/* ── Icons ───────────────────────────────────────────────────── */
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

/* ── Summary cards (past date) ───────────────────────────────── */
function SummaryCard({ title, icon, iconBg, iconColor, children, hasData }) {
  return (
    <div style={{
      flex: 1, background: 'white', border: '1px solid #e5e7eb',
      borderRadius: '12px', padding: '20px', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '9px',
          background: hasData ? iconBg : '#f3f4f6',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: hasData ? iconColor : '#9ca3af',
        }}>
          {icon}
        </div>
        <div style={{ fontSize: '13px', fontWeight: '700', color: hasData ? '#111827' : '#9ca3af' }}>{title}</div>
      </div>
      {hasData ? children : (
        <div style={{ fontSize: '13px', color: '#9ca3af', fontStyle: 'italic' }}>
          No data uploaded for this date
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
      <span style={{ fontSize: '12px', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: '700', color: valueColor ?? '#111827' }}>{value}</span>
    </div>
  )
}

function ClassificationPills({ cls }) {
  const items = [
    { label: 'No Issue',    count: cls.noIssue,    color: '#059669', bg: '#ecfdf5' },
    { label: 'Minor Issue', count: cls.minorIssue,  color: '#d97706', bg: '#fffbeb' },
    { label: 'Major Issue', count: cls.majorIssue,  color: '#dc2626', bg: '#fef2f2' },
  ].filter(i => i.count > 0)

  if (!items.length) return <div style={{ fontSize: '12px', color: '#9ca3af' }}>No classification data</div>

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
      {items.map(({ label, count, color, bg }) => (
        <span key={label} style={{
          fontSize: '12px', fontWeight: '600', padding: '3px 10px',
          borderRadius: '20px', background: bg, color,
        }}>
          {label}: {count}
        </span>
      ))}
    </div>
  )
}

/* ── Competency labels (matches server COMPETENCIES order) ───── */
const COMPETENCY_LABELS = [
  'Thinking Clearly & Sound Judgements',
  'Working as a Team',
  'Working with Citizens & Stakeholders',
  'Keep Learning & Skills into Action',
  'Improving & Innovating Continuously',
  'Serving with Heart & Purpose',
]

const INITIAL_STEPS = [
  { label: 'Loading performance data', status: 'pending' },
  ...COMPETENCY_LABELS.map(n => ({ label: n, status: 'pending' })),
  { label: 'Radar chart insights', status: 'pending' },
]

/* ── AI pre-warm progress panel ──────────────────────────────── */
function PrewarmPanel({ steps, done }) {
  const total    = steps.length
  const doneCount = steps.filter(s => s.status === 'done' || s.status === 'error').length
  const pct       = Math.round((doneCount / total) * 100)

  return (
    <div style={{
      background: 'white', borderRadius: '14px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      padding: '24px 28px', marginTop: '24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>
            {done ? 'Analysis Ready' : 'Generating AI Analysis…'}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            {done
              ? 'All tabs are pre-loaded. Navigate freely.'
              : 'Pre-warming all tabs so they load instantly.'}
          </div>
        </div>
        {done && (
          <div style={{
            background: '#d4f5e2', color: '#1a5c38',
            borderRadius: '20px', padding: '4px 14px',
            fontSize: '12px', fontWeight: '700',
          }}>
            Done
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div style={{
        height: '6px', background: '#f0f0f0', borderRadius: '3px', marginBottom: '20px', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: '3px',
          background: done ? '#2d8a50' : '#1e3a35',
          width: `${pct}%`,
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            opacity: step.status === 'pending' ? 0.4 : 1,
            transition: 'opacity 0.2s',
          }}>
            {/* Status icon */}
            <div style={{ flexShrink: 0, width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {step.status === 'done' && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2d8a50" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
              )}
              {step.status === 'loading' && (
                <div style={{
                  width: '16px', height: '16px', borderRadius: '50%',
                  border: '2px solid #d1fae5', borderTopColor: '#1e3a35',
                  animation: 'prewarmSpin 0.7s linear infinite',
                }} />
              )}
              {step.status === 'error' && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              )}
              {step.status === 'pending' && (
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#d1d5db' }} />
              )}
            </div>

            {/* Label */}
            <div style={{ fontSize: '13px', fontWeight: step.status === 'loading' ? '600' : '400', color: '#374151' }}>
              {i === 0 ? step.label : i <= 6 ? `Competency ${i}: ${step.label}` : step.label}
            </div>
          </div>
        ))}
      </div>

      {done && (
        <div style={{
          marginTop: '18px', padding: '12px 16px',
          background: '#f0fff5', border: '1px solid #a7f3d0',
          borderRadius: '9px', fontSize: '13px', color: '#1a5c38', fontWeight: '500',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2d8a50" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          All analysis generated and cached. Competency Breakdown, Radar, Flags &amp; Alerts, and Team Overview are ready.
        </div>
      )}
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────── */
export default function DataUpload() {
  const { user, markUploaded } = useAuth()

  const today = new Date().toISOString().slice(0, 10)

  const [date, setDate]                         = useState(today)
  const [interactionsFile, setInteractionsFile] = useState(null)
  const [auditmateFile, setAuditmateFile]       = useState(null)
  const [essFile, setEssFile]                   = useState(null)
  const [dragOver, setDragOver]                 = useState(null)
  const [loading, setLoading]                   = useState(false)
  const [toast, setToast]                       = useState(null)
  const [prewarm, setPrewarm]                   = useState(null)

  // Past-date summary
  const [summary, setSummary]           = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const isPastDate  = date < today
  const hasAnyFile  = !!(interactionsFile || auditmateFile || essFile)
  const hasExisting = !!(summary && (summary.interactions?.count > 0 || summary.auditmate?.count > 0 || summary.ess?.count > 0))

  // Always fetch summary from DB when date changes (includes today on mount/return)
  useEffect(() => {
    setSummaryLoading(true)
    setSummary(null)
    fetch(`/api/upload/summary?date=${date}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => r.json())
      .then(d => {
        // Only show summary section if at least one data source has records
        const hasData = d.interactions?.count > 0 || d.auditmate?.count > 0 || d.ess?.count > 0
        setSummary(hasData ? d : null)
        setSummaryLoading(false)
      })
      .catch(() => setSummaryLoading(false))
  }, [date])  // eslint-disable-line

  function fetchSummaryForDate(d) {
    setSummaryLoading(true)
    setSummary(null)
    fetch(`/api/upload/summary?date=${d}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => r.json())
      .then(data => { setSummary(data); setSummaryLoading(false) })
      .catch(() => setSummaryLoading(false))
  }

  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!window.confirm(`Delete all data for ${fmtDate(date)}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/upload?date=${date}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) throw new Error('Delete failed')
      setSummary(null)
      setToast({ message: `Data for ${fmtDate(date)} deleted.`, type: 'success' })
    } catch {
      setToast({ message: 'Failed to delete data.', type: 'error' })
    } finally {
      setDeleting(false)
    }
  }

  function updatePrewarmStep(idx, status) {
    setPrewarm(prev => {
      if (!prev) return prev
      const steps = prev.steps.map((s, i) => i === idx ? { ...s, status } : s)
      return { ...prev, steps }
    })
  }

  async function prewarmAI() {
    const token = getToken()
    const authHeader = { Authorization: `Bearer ${token}` }
    const jsonHeaders = { 'Content-Type': 'application/json', ...authHeader }

    // Step 0: fetch competency breakdown data
    updatePrewarmStep(0, 'loading')
    let compData = null
    try {
      const r = await fetch('/api/competency-breakdown', { headers: authHeader })
      compData = await r.json()
      updatePrewarmStep(0, 'done')
    } catch {
      updatePrewarmStep(0, 'error')
    }

    // Steps 1–6: generate AI development summary for each competency
    for (let idx = 0; idx < 6; idx++) {
      updatePrewarmStep(idx + 1, 'loading')
      try {
        await fetch('/api/ai/development', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            competencyIndex: idx,
            currentLevel:    compData?.currentLevel  ?? 1,
            currentScore:    compData?.currentScore  ?? null,
            latestDate:      compData?.latestDate    ?? null,
            indicators:      compData?.indicators    ?? [],
          }),
        })
        updatePrewarmStep(idx + 1, 'done')
      } catch {
        updatePrewarmStep(idx + 1, 'error')
      }
    }

    // Step 7: radar insights
    updatePrewarmStep(7, 'loading')
    try {
      await fetch('/api/radar', { headers: authHeader })
      updatePrewarmStep(7, 'done')
    } catch {
      updatePrewarmStep(7, 'error')
    }

    setPrewarm(prev => prev ? { ...prev, done: true } : prev)
  }

  async function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = e => resolve(parseCSV(e.target.result))
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  async function handleSubmit() {
    if (!hasAnyFile || loading) return
    setLoading(true)
    try {
      const [interactions, auditmate, ess] = await Promise.all([
        interactionsFile ? readFile(interactionsFile) : null,
        auditmateFile    ? readFile(auditmateFile)    : null,
        essFile          ? readFile(essFile)          : null,
      ])

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ date, interactions, auditmate, ess }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setInteractionsFile(null)
      setAuditmateFile(null)
      setEssFile(null)
      markUploaded()
      setToast({ message: 'Data uploaded! Generating analysis…', type: 'success' })

      // Fetch summary for the uploaded date
      fetchSummaryForDate(date)

      // Only pre-warm AI for today's upload
      if (date === today) {
        setPrewarm({ steps: INITIAL_STEPS.map(s => ({ ...s })), done: false })
        prewarmAI()
      }
    } catch (err) {
      setToast({ message: err.message || 'Upload failed.', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Format date nicely for section heading
  function fmtDate(iso) {
    const [y, m, d] = iso.split('-')
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <Topbar title="Data Upload" subtitle="Upload CSV files from your data sources" />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDone={() => setToast(null)}
        />
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '28px' }}>
        <div style={{
          background: 'white', borderRadius: '14px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
          padding: '28px',
        }}>

          {/* Date row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            paddingBottom: '24px', borderBottom: '1px solid #f0f0f0', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Data Date</div>
            <input
              type="date"
              value={date}
              max={today}
              onChange={e => setDate(e.target.value)}
              style={{
                border: '1.5px solid #d1d5db', borderRadius: '8px',
                padding: '7px 12px', fontSize: '13px', color: '#111827',
                outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
              }}
              onFocus={e => e.target.style.borderColor = '#1e3a35'}
              onBlur={e  => e.target.style.borderColor = '#d1d5db'}
            />
            {isPastDate && (
              <span style={{
                fontSize: '12px', fontWeight: '500', color: '#6b7280',
                background: '#f3f4f6', border: '1px solid #e5e7eb',
                borderRadius: '20px', padding: '3px 10px',
              }}>
                Past date
              </span>
            )}
          </div>

          {/* Upload cards */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '28px' }}>
            <UploadCard
              label="Interactions"
              icon={<PersonIcon />}
              file={interactionsFile}
              onFile={setInteractionsFile}
              dragKey="interactions"
              dragOver={dragOver}
              onDragOver={setDragOver}
              onDragLeave={() => setDragOver(null)}
              disabled={false}
            />
            <UploadCard
              label="Auditmate"
              icon={<ClipboardIcon />}
              file={auditmateFile}
              onFile={setAuditmateFile}
              dragKey="auditmate"
              dragOver={dragOver}
              onDragOver={setDragOver}
              onDragLeave={() => setDragOver(null)}
              disabled={false}
            />
            <UploadCard
              label="ESS"
              icon={<ChatIcon />}
              file={essFile}
              onFile={setEssFile}
              dragKey="ess"
              dragOver={dragOver}
              onDragOver={setDragOver}
              onDragLeave={() => setDragOver(null)}
              disabled={false}
            />
          </div>

          {/* Submit button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
            <button
              onClick={handleSubmit}
              disabled={!hasAnyFile || loading || hasExisting}
              style={{
                background: hasAnyFile && !loading && !hasExisting ? '#1e3a35' : '#e5e7eb',
                color: hasAnyFile && !loading && !hasExisting ? 'white' : '#9ca3af',
                border: 'none', borderRadius: '9px',
                padding: '11px 40px', fontSize: '14px', fontWeight: '600',
                cursor: hasAnyFile && !loading && !hasExisting ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s', fontFamily: 'inherit',
                minWidth: '160px',
              }}
              onMouseEnter={e => { if (hasAnyFile && !loading && !hasExisting) e.currentTarget.style.background = '#2d6a4f' }}
              onMouseLeave={e => { if (hasAnyFile && !loading && !hasExisting) e.currentTarget.style.background = '#1e3a35' }}
            >
              {loading ? 'Uploading…' : 'Submit Data'}
            </button>
            {hasExisting && (
              <div style={{ fontSize: '12px', color: '#d97706', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Data already uploaded for this date. Delete it below before re-uploading.
              </div>
            )}
          </div>

          {/* Info banner */}
          <div style={{
            background: '#eff6ff', border: '1px solid #bfdbfe',
            borderRadius: '10px', padding: '12px 16px',
            display: 'flex', alignItems: 'flex-start', gap: '10px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div style={{ fontSize: '13px', color: '#1d4ed8', lineHeight: '1.5' }}>
              <strong>Note:</strong> At least one data source must be uploaded. All files must be in CSV format.
            </div>
          </div>
        </div>

        {/* ── AI pre-warm panel ── */}
        {prewarm && !isPastDate && (
          <PrewarmPanel steps={prewarm.steps} done={prewarm.done} />
        )}

        {/* ── Data summary — shown whenever there is data for the selected date ── */}
        {(summary || summaryLoading) && (
          <div style={{ marginTop: '24px' }}>
            <div style={{
              fontSize: '14px', fontWeight: '700', color: '#111827',
              marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Data Summary for {fmtDate(date)}
              <button
                onClick={handleDelete}
                disabled={deleting || summaryLoading}
                style={{
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: '1px solid #fca5a5', borderRadius: '6px',
                  color: '#dc2626', fontSize: '12px', fontWeight: '600',
                  padding: '4px 10px', cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.6 : 1, fontFamily: 'inherit',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
                {deleting ? 'Deleting…' : 'Delete data'}
              </button>
            </div>

            {summaryLoading ? (
              <div style={{
                background: 'white', borderRadius: '12px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                padding: '32px', textAlign: 'center',
                fontSize: '13px', color: '#9ca3af',
              }}>
                Loading summary…
              </div>
            ) : summary ? (
              <div style={{ display: 'flex', gap: '16px' }}>

                {/* Interactions */}
                <SummaryCard
                  title="Interactions"
                  icon={<PersonIcon />}
                  iconBg="#e8f5f0" iconColor="#1e3a35"
                  hasData={summary.interactions.count > 0}
                >
                  <StatRow label="Total interactions" value={summary.interactions.count} />
                  <div style={{ marginTop: '8px', fontSize: '22px', fontWeight: '800', color: '#1e3a35' }}>
                    {summary.interactions.count}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>interactions logged</div>
                </SummaryCard>

                {/* Auditmate */}
                <SummaryCard
                  title="Auditmate"
                  icon={<ClipboardIcon />}
                  iconBg="#eff6ff" iconColor="#3b82f6"
                  hasData={summary.auditmate.count > 0}
                >
                  <StatRow label="Cases audited"  value={summary.auditmate.count} />
                  <StatRow
                    label="Avg Score"
                    value={summary.auditmate.avgScore !== null ? `${summary.auditmate.avgScore}%` : '—'}
                    valueColor={
                      summary.auditmate.avgScore !== null
                        ? (summary.auditmate.avgScore >= 90 ? '#059669' : summary.auditmate.avgScore >= 70 ? '#d97706' : '#dc2626')
                        : '#9ca3af'
                    }
                  />
                  <ClassificationPills cls={summary.auditmate.classifications} />
                </SummaryCard>

                {/* ESS */}
                <SummaryCard
                  title="ESS"
                  icon={<ChatIcon />}
                  iconBg="#f5f3ff" iconColor="#7c3aed"
                  hasData={summary.ess.count > 0}
                >
                  <StatRow label="Responses" value={summary.ess.count} />
                  <StatRow
                    label="Avg Rating"
                    value={summary.ess.avgRating !== null ? `${summary.ess.avgRating} / 5` : '—'}
                    valueColor={
                      summary.ess.avgRating !== null
                        ? (summary.ess.avgRating >= 4 ? '#059669' : summary.ess.avgRating >= 3 ? '#d97706' : '#dc2626')
                        : '#9ca3af'
                    }
                  />
                  {summary.ess.count > 0 && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', background: '#ecfdf5', color: '#059669' }}>
                        Positive: {summary.ess.positive}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', background: '#fef2f2', color: '#dc2626' }}>
                        Negative: {summary.ess.negative}
                      </span>
                    </div>
                  )}
                </SummaryCard>

              </div>
            ) : (
              <div style={{
                background: 'white', borderRadius: '12px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                padding: '32px', textAlign: 'center',
                fontSize: '13px', color: '#9ca3af',
              }}>
                Could not load summary. Please try again.
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes prewarmSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
