import { useState } from 'react'
import {
  loadAllResults, loadAllOverrides, loadAllInjections,
  saveOverride, saveInjection,
} from '../utils/storage'
import { UNQUANTIFIABLE } from './Dashboard'

const LEVEL_COLORS = {
  Advanced:     { bg: '#e8f5f0', text: '#0f6e56', dot: '#1d9e75' },
  Intermediate: { bg: '#e6f1fb', text: '#185FA5', dot: '#3b82f6' },
  Basic:        { bg: '#faeeda', text: '#854F0B', dot: '#f59e0b' },
  Pending:      { bg: '#f0f5f2', text: '#6b8c7d', dot: '#a9c4b8' },
}

function LevelBadge({ level, tag }) {
  const c = LEVEL_COLORS[level] || LEVEL_COLORS.Pending
  return (
    <span style={{
      background: c.bg, color: c.text,
      padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {tag ? `${tag}: ` : ''}{level || 'Pending'}
    </span>
  )
}

// ─── Override inline form ─────────────────────────────────────────────────────
function OverrideForm({ competencyName, originalLevel, existing, onSave, onCancel }) {
  const [level, setLevel]             = useState(existing?.overrideLevel || originalLevel)
  const [justification, setJust]      = useState(existing?.justification || '')

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: '#fffbf0', borderRadius: 8, border: '1px solid #f59e0b', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Manual Override</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#6b8c7d' }}>Original (LLM):</span>
        <LevelBadge level={originalLevel} />
        <span style={{ fontSize: 12, color: '#6b8c7d' }}>→ Override:</span>
        <select value={level} onChange={e => setLevel(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #f59e0b', fontSize: 12, color: '#1a2e26' }}>
          {['Basic', 'Intermediate', 'Advanced'].map(l => <option key={l}>{l}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#374a3f', display: 'block', marginBottom: 4 }}>Justification *</label>
        <textarea value={justification} onChange={e => setJust(e.target.value)}
          placeholder="Reason for overriding the LLM score…"
          rows={2} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: '1px solid #f59e0b', fontSize: 12, resize: 'vertical', color: '#1a2e26' }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => justification.trim() && onSave(level, justification)} disabled={!justification.trim()}
          style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', cursor: justification.trim() ? 'pointer' : 'not-allowed', background: justification.trim() ? '#92400e' : '#f5e0c0', color: '#fff', fontSize: 12, fontWeight: 600 }}>
          Save Override
        </button>
        <button onClick={onCancel}
          style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #cde5d8', background: '#fff', color: '#374a3f', fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Inject inline form ───────────────────────────────────────────────────────
function InjectForm({ competencyName, existing, onSave, onCancel }) {
  const [level, setLevel]        = useState(existing?.level || 'Basic')
  const [justification, setJust] = useState(existing?.justification || '')

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: '#f0faf5', borderRadius: 8, border: '1px solid #cde5d8', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#0f6e56', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Supervisor Assessment</div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#374a3f', display: 'block', marginBottom: 4 }}>Level</label>
        <select value={level} onChange={e => setLevel(e.target.value)}
          style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #cde5d8', fontSize: 12, color: '#1a2e26' }}>
          {['Basic', 'Intermediate', 'Advanced'].map(l => <option key={l}>{l}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#374a3f', display: 'block', marginBottom: 4 }}>Justification *</label>
        <textarea value={justification} onChange={e => setJust(e.target.value)}
          placeholder="Describe observed behaviour that supports this level…"
          rows={2} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: '1px solid #cde5d8', fontSize: 12, resize: 'vertical', color: '#1a2e26' }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => justification.trim() && onSave(level, justification)} disabled={!justification.trim()}
          style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', cursor: justification.trim() ? 'pointer' : 'not-allowed', background: justification.trim() ? '#0f6e56' : '#cde5d8', color: '#fff', fontSize: 12, fontWeight: 600 }}>
          Save
        </button>
        <button onClick={onCancel}
          style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #cde5d8', background: '#fff', color: '#374a3f', fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Single competency row in team view ───────────────────────────────────────
function CompetencyRow({ comp, officerId, officerRole, canOverride, override, onOverrideSaved }) {
  const [editing, setEditing] = useState(false)

  function handleSave(level, justification) {
    saveOverride(officerId, comp.name, { overrideLevel: level, justification, supervisorName: 'Supervisor' })
    onOverrideSaved()
    setEditing(false)
  }

  const displayLevel = override ? override.overrideLevel : comp.current_level

  return (
    <div style={{ borderBottom: '1px solid #f0f5f2', paddingBottom: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#374a3f', flex: 1 }}>{comp.name}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {override && (
            <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Override
            </span>
          )}
          <LevelBadge level={displayLevel} />
          {canOverride && (
            <button onClick={() => setEditing(e => !e)} style={{
              fontSize: 11, color: '#185FA5', background: 'none', border: '1px solid #185FA5',
              borderRadius: 5, padding: '2px 7px', cursor: 'pointer',
            }}>
              {editing ? 'Cancel' : 'Override'}
            </button>
          )}
        </div>
      </div>

      {override && !editing && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#6b8c7d' }}>
          <span style={{ color: '#92400e' }}>LLM: {comp.current_level}</span>
          {' · '}"{override.justification}" · {new Date(override.timestamp).toLocaleDateString()}
        </div>
      )}

      {editing && (
        <OverrideForm
          competencyName={comp.name}
          originalLevel={comp.current_level}
          existing={override}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  )
}

// ─── Pending/unquantifiable competency row ────────────────────────────────────
function PendingRow({ name, officerId, canInject, injection, onInjectionSaved }) {
  const [editing, setEditing] = useState(false)

  function handleSave(level, justification) {
    saveInjection(officerId, name, { level, justification, supervisorName: 'Supervisor' })
    onInjectionSaved()
    setEditing(false)
  }

  return (
    <div style={{ borderBottom: '1px solid #f0f5f2', paddingBottom: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#374a3f', flex: 1 }}>{name}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {injection
            ? <>
                <span style={{ fontSize: 9, fontWeight: 700, background: '#e8f5f0', color: '#0f6e56', padding: '2px 6px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assessed</span>
                <LevelBadge level={injection.level} />
              </>
            : <LevelBadge level="Pending" />
          }
          {canInject && (
            <button onClick={() => setEditing(e => !e)} style={{
              fontSize: 11, color: '#0f6e56', background: 'none', border: '1px solid #0f6e56',
              borderRadius: 5, padding: '2px 7px', cursor: 'pointer',
            }}>
              {editing ? 'Cancel' : injection ? 'Edit' : 'Set Score'}
            </button>
          )}
        </div>
      </div>

      {injection && !editing && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#6b8c7d' }}>
          "{injection.justification}" · {new Date(injection.timestamp).toLocaleDateString()}
        </div>
      )}

      {editing && (
        <InjectForm
          competencyName={name}
          existing={injection}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  )
}

// ─── Officer card in team overview ────────────────────────────────────────────
function OfficerCard({ officer, canOverride, canInject }) {
  const [allResults,   setAllResults]   = useState(() => loadAllResults())
  const [allOverrides, setAllOverrides] = useState(() => loadAllOverrides())
  const [allInjections, setAllInjections] = useState(() => loadAllInjections())

  const results   = allResults[officer.id]
  const overrides = allOverrides[officer.id] || {}
  const injections = allInjections[officer.id] || {}
  const unquantifiable = UNQUANTIFIABLE[officer.role] || []

  function refresh() {
    setAllResults(loadAllResults())
    setAllOverrides(loadAllOverrides())
    setAllInjections(loadAllInjections())
  }

  return (
    <div style={{
      background: '#fff', border: '0.5px solid #cde5d8', borderRadius: 12,
      padding: '18px 20px', boxShadow: '0 1px 3px rgba(10,74,58,0.05)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2e26' }}>{officer.name}</div>
          <div style={{ fontSize: 11, color: '#6b8c7d', marginTop: 1 }}>{officer.role}</div>
        </div>
        {results
          ? <span style={{ fontSize: 10, color: '#6b8c7d' }}>Last analysed: {new Date(results.savedAt).toLocaleDateString()}</span>
          : <span style={{ fontSize: 11, color: '#a9c4b8', fontStyle: 'italic' }}>No analysis yet</span>
        }
      </div>

      {results ? (
        <>
          {/* Overall level + score */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, background: '#f0faf5', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6b8c7d', marginBottom: 2 }}>Overall Level</div>
              <LevelBadge level={results.overall_level} />
            </div>
            <div style={{ flex: 1, background: '#f0faf5', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6b8c7d', marginBottom: 2 }}>Auditmate</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1a2e26' }}>{results.indicators_passed}/10</div>
            </div>
          </div>

          {/* Competency rows */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b8c7d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Competencies
          </div>
          {results.competencies.map(comp => (
            <CompetencyRow
              key={comp.name}
              comp={comp}
              officerId={officer.id}
              officerRole={officer.role}
              canOverride={canOverride}
              override={overrides[comp.name]}
              onOverrideSaved={refresh}
            />
          ))}

          {/* Unquantifiable / pending rows */}
          {unquantifiable.map(name => (
            <PendingRow
              key={name}
              name={name}
              officerId={officer.id}
              canInject={canInject}
              injection={injections[name]}
              onInjectionSaved={refresh}
            />
          ))}
        </>
      ) : (
        <div style={{ fontSize: 12, color: '#a9c4b8', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
          Run an analysis from the My Analysis tab to populate this view.
        </div>
      )}
    </div>
  )
}

// ─── Team Overview ────────────────────────────────────────────────────────────
export default function TeamOverview({ officers, canOverride = false, canInject = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a2e26', marginBottom: 3 }}>Team Overview</h2>
        <p style={{ color: '#6b8c7d', fontSize: 13 }}>
          {canOverride
            ? 'View officer results. You can override LLM scores and inject assessments for competencies requiring direct observation.'
            : 'View-only summary of your team\'s latest analysis results.'}
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
        {officers.map(officer => (
          <OfficerCard key={officer.id} officer={officer} canOverride={canOverride} canInject={canInject} />
        ))}
      </div>
    </div>
  )
}
