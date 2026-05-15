import { useState } from 'react'
import Dashboard from './Dashboard'
import TeamOverview from './TeamOverview'
import { saveOfficerResults } from '../utils/storage'

function Tab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      background: active ? '#fff' : 'transparent',
      color: active ? '#0f6e56' : '#6b8c7d',
      border: 'none',
      borderBottom: active ? '2px solid #0f6e56' : '2px solid transparent',
      borderRadius: 0, transition: 'color 0.15s',
    }}>
      {label}
    </button>
  )
}

export default function SupervisorShell({ officer, teamOfficers }) {
  const [tab, setTab] = useState('analysis')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #cde5d8', background: '#f8fdfa', paddingLeft: 8, flexShrink: 0 }}>
        <Tab label="My Analysis"    active={tab === 'analysis'} onClick={() => setTab('analysis')} />
        <Tab label="Team Overview"  active={tab === 'team'}     onClick={() => setTab('team')} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {tab === 'analysis' && (
          <Dashboard
            officer={officer}
            onAnalysisDone={results => saveOfficerResults(officer.id, results)}
          />
        )}
        {tab === 'team' && (
          <TeamOverview officers={teamOfficers} canOverride={true} canInject={true} />
        )}
      </div>
    </div>
  )
}
