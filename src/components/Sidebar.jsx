import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../App.jsx'
import { getToken } from '../utils/auth.js'
import cpfLogo from '../assets/cpf.jpeg'

/* ── colour tokens ───────────────────────────────────────────── */
const PANEL_BG      = '#dceee6'
const PANEL_HOVER   = '#c9e3d8'
const PANEL_ACTIVE  = '#b8d9cc'
const ACTIVE_BORDER = '#1e3a35'
const TEXT          = '#1a2e25'
const TEXT_DIM      = 'rgba(26,46,37,0.55)'
const PANEL_BORDER  = 'rgba(26,46,37,0.1)'

/* ── icons ───────────────────────────────────────────────────── */
const SvgIcon = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const UploadIcon  = () => <SvgIcon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></SvgIcon>
const DashIcon    = () => <SvgIcon><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></SvgIcon>
const TrendIcon   = () => <SvgIcon><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></SvgIcon>
const BarIcon     = () => <SvgIcon><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></SvgIcon>
const TargetIcon  = () => <SvgIcon><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></SvgIcon>
const FlagIcon    = () => <SvgIcon><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></SvgIcon>
const PeopleIcon  = () => <SvgIcon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></SvgIcon>
const SignOutIcon = () => <SvgIcon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></SvgIcon>
const ChevronIcon = () => <SvgIcon size={13}><polyline points="6 9 12 15 18 9"/></SvgIcon>

/* nav items per role */
const ALL_NAV = [
  { label: 'Dashboard',            path: '/dashboard',            Icon: DashIcon,   roles: ['CSO','TL','Supervisor'] },
  { label: 'Data Summary',         path: '/data-summary',         Icon: UploadIcon, roles: ['CSO','TL','Supervisor'] },
  //{ label: '3-Month Forecast',     path: '/forecast',             Icon: TrendIcon,  roles: ['CSO','TL','Supervisor'] },
  { label: 'Competency Breakdown', path: '/competency-breakdown', Icon: BarIcon,    roles: ['CSO','TL','Supervisor'] },
  { label: 'Competency Radar',     path: '/competency-radar',     Icon: TargetIcon, roles: ['CSO','TL','Supervisor'] },
  { label: 'Flags & Alerts',       path: '/flags-alerts',         Icon: FlagIcon,   roles: ['CSO','TL','Supervisor'] },
  { label: 'Team Overview',        path: '/team-overview',        Icon: PeopleIcon, roles: ['TL','Supervisor'] },
  { label: 'Admin Panel',          path: '/admin',                Icon: UploadIcon, roles: ['Admin'] },
]

const SECTION_LABEL = {
  fontSize: '10px', fontWeight: '600', color: TEXT_DIM,
  letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px',
}

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('')
}

function roleLabel(role) {
  if (role === 'TL') return 'Team Leader'
  if (role === 'Supervisor') return 'Supervisor'
  return role ?? '—'
}

export default function Sidebar() {
  const { user, handleLogout, viewingAs, setViewingAs } = useAuth()
  const navigate  = useNavigate()
  const [teamMembers, setTeamMembers] = useState([])
  const [dropOpen, setDropOpen]       = useState(false)
  const dropRef = useRef(null)

  /* fetch team members for TL/Supervisor */
  useEffect(() => {
    if (!user || user.role === 'CSO') return
    fetch('/api/users/team', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(list => setTeamMembers(Array.isArray(list) ? list : []))
      .catch(() => {})
  }, [user])

  /* close dropdown on outside click */
  useEffect(() => {
    function handleClick(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function signOut() {
    handleLogout()
    navigate('/login')
  }

  /* dropdown options: own account + team only */
  const viewingOptions = [
    { id: user?.id, name: user?.name, role: user?.role },
    ...teamMembers,
  ]

  const selectedViewing = viewingAs ?? { id: user?.id, name: user?.name, role: user?.role }
  const canSwitch = user?.role !== 'CSO' && teamMembers.length > 0

  // When Admin is viewing another user, show that user's nav; otherwise show own role's nav
  const isAdminViewingOther = user?.role === 'Admin' && selectedViewing.role !== 'Admin'
  const navItems = isAdminViewingOther
    ? ALL_NAV.filter(item => item.roles.includes(selectedViewing.role))
    : ALL_NAV.filter(item => item.roles.includes(user?.role))

  return (
    <aside style={{
      width: '248px', minWidth: '248px', height: '100vh',
      background: '#ffffff',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      borderRight: '1px solid #e8e8e8',
    }}>

      {/* ── TOP: white logo area ── */}
      <div style={{ padding: '20px 20px 16px', background: '#ffffff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src={cpfLogo}
            alt="CPF"
            style={{ width: '38px', height: '38px', borderRadius: '9px', objectFit: 'cover', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: '700', fontSize: '14px', color: '#111827', lineHeight: '1.2' }}>
              CPF Simulator
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>
              Performance Dashboard
            </div>
          </div>
        </div>
      </div>

      {/* ── MIDDLE: coloured panel (Viewing As + Nav) ── */}
      <div style={{
        flex: 1, margin: '0 12px', borderRadius: '14px',
        background: PANEL_BG, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Viewing As — only shown for roles that can switch */}
        {canSwitch && (
        <div style={{ padding: '14px 14px 10px' }}>
          <div style={{ ...SECTION_LABEL }}>Viewing As</div>

          <div ref={dropRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setDropOpen(o => !o)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(255,255,255,0.45)', border: `1px solid ${PANEL_BORDER}`,
                borderRadius: '8px', padding: '9px 12px', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: TEXT }}>
                  {selectedViewing.name || '—'}
                </div>
                <div style={{ fontSize: '11px', color: TEXT_DIM, marginTop: '1px' }}>
                  {selectedViewing.role || '—'}
                </div>
              </div>
              <span style={{ color: TEXT_DIM, flexShrink: 0 }}><ChevronIcon /></span>
            </button>

            {dropOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
                background: '#fff', border: `1px solid ${PANEL_BORDER}`, borderRadius: '8px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden',
              }}>
                {viewingOptions.map(opt => {
                  const isSelected = String(opt.id) === String(selectedViewing.id)
                  return (
                    <button
                      key={opt.id}
                      onClick={() => { 
                        setViewingAs(opt)
                        setDropOpen(false)
                        // Admin selecting self → go to admin panel; selecting other → go to their dashboard
                        if (user?.role === 'Admin') {
                          if (String(opt.id) === String(user?.id)) {
                            navigate('/admin')
                          } else {
                            navigate('/dashboard')
                          }
                        }
                      }}
                      style={{
                        width: '100%', padding: '10px 12px', textAlign: 'left',
                        background: isSelected ? '#eef5f3' : 'transparent',
                        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        borderBottom: `1px solid ${PANEL_BORDER}`,
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: isSelected ? '600' : '400', color: TEXT }}>
                        {opt.name}
                        {String(opt.id) === String(user?.id) && (
                          <span style={{ marginLeft: '6px', fontSize: '10px', color: TEXT_DIM }}>(you)</span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: TEXT_DIM }}>{opt.role}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Nav */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 14px' }}>
          <div style={{ ...SECTION_LABEL }}>Platform</div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {navItems.map(({ label, path, Icon: NavIcon }) => (
              <NavLink
                key={path}
                to={path}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 12px', borderRadius: '8px',
                  textDecoration: 'none', fontSize: '13.5px',
                  fontWeight: isActive ? '600' : '400',
                  color: TEXT,
                  background: isActive ? PANEL_ACTIVE : 'transparent',
                  borderLeft: isActive ? `3px solid ${ACTIVE_BORDER}` : '3px solid transparent',
                  transition: 'background 0.12s',
                })}
                onMouseEnter={e => { if (!e.currentTarget.getAttribute('aria-current')) e.currentTarget.style.background = PANEL_HOVER }}
                onMouseLeave={e => { if (!e.currentTarget.getAttribute('aria-current')) e.currentTarget.style.background = 'transparent' }}
              >
                {({ isActive }) => (
                  <>
                    <span style={{ color: isActive ? ACTIVE_BORDER : TEXT_DIM, flexShrink: 0 }}>
                      <NavIcon />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {/* ── BOTTOM: profile row + sign out ── */}
      <div style={{ padding: '10px 12px 6px', background: '#ffffff' }}>
        {/* Profile row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 8px', borderRadius: '10px',
          background: '#f9fafb', marginBottom: '4px',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
            background: '#1e3a35', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: '700', color: '#ffffff',
          }}>
            {getInitials(user?.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name ?? '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>
              {roleLabel(user?.role)}
            </div>
          </div>
        </div>

        {/* Sign Out */}
        <button
          onClick={signOut}
          onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.color = '#111827' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b7280' }}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            width: '100%', padding: '9px 8px', marginBottom: '6px',
            background: 'transparent', border: 'none', borderRadius: '8px',
            cursor: 'pointer', fontSize: '13.5px', color: '#6b7280',
            textAlign: 'left', transition: 'all 0.12s', fontFamily: 'inherit',
          }}
        >
          <SignOutIcon />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
