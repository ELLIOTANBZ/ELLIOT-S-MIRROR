import { createContext, useContext, useState, Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './components/Login.jsx'
import Layout from './components/Layout.jsx'
import DataUpload from './pages/DataUpload.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import DataSummaryPage from './pages/DataSummaryPage.jsx'
import ForecastPage from './pages/ForecastPage.jsx'
import CompetencyBreakdown from './pages/CompetencyBreakdown.jsx'
import CompetencyRadar from './pages/CompetencyRadar.jsx'
import FlagsAlerts from './pages/FlagsAlerts.jsx'
import TeamOverview from './pages/TeamOverview.jsx'
import AdminPanel from './pages/AdminPanel.jsx'
import { getUser, clearAuth, saveAuth } from './utils/auth.js'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, fontFamily: 'monospace', background: '#fef2f2', minHeight: '100vh' }}>
        <h2 style={{ color: '#dc2626' }}>Render Error</h2>
        <pre style={{ color: '#7f1d1d', whiteSpace: 'pre-wrap' }}>{this.state.error?.message}{'\n\n'}{this.state.error?.stack}</pre>
      </div>
    )
    return this.props.children
  }
}

export const AuthContext = createContext(null)
export function useAuth() { return useContext(AuthContext) }

function PrivateRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const [user, setUser]               = useState(() => getUser())
  const [hasUploaded, setHasUploaded] = useState(() => localStorage.getItem('cpf_uploaded') === 'true')
  const [viewingAs, setViewingAs]     = useState(() => getUser()) // officer whose data is displayed

  function handleLogin(token, userData) {
    saveAuth(token, userData)
    setUser(userData)
    setViewingAs(userData) // reset viewingAs to self on login
  }

  function handleLogout() {
    clearAuth()
    localStorage.removeItem('cpf_uploaded')
    setUser(null)
    setViewingAs(null)
    setHasUploaded(false)
  }

  function markUploaded() {
    localStorage.setItem('cpf_uploaded', 'true')
    setHasUploaded(true)
  }

  return (
    <ErrorBoundary>
    <AuthContext.Provider value={{ user, handleLogin, handleLogout, hasUploaded, markUploaded, viewingAs, setViewingAs }}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to={user.role === 'Admin' ? '/admin' : '/dashboard'} replace /> : <Login />}
          />
          {/* Pathless layout route — wraps all protected pages without fighting the redirect */}
          <Route
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route path="/dashboard"            element={<DashboardPage />} />
            <Route path="/data-summary"         element={<DataSummaryPage />} />
            <Route path="/forecast"             element={<ForecastPage />} />
            <Route path="/competency-breakdown" element={<CompetencyBreakdown />} />
            <Route path="/competency-radar"     element={<CompetencyRadar />} />
            <Route path="/flags-alerts"         element={<FlagsAlerts />} />
            <Route path="/team-overview"        element={<TeamOverview />} />
            <Route path="/admin"                element={<AdminPanel />} />
          </Route>
          <Route path="/" element={<Navigate to={user ? (user.role === 'Admin' ? '/admin' : '/dashboard') : '/login'} replace />} />
          <Route path="*" element={<Navigate to={user ? (user.role === 'Admin' ? '/admin' : '/dashboard') : '/login'} replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
    </ErrorBoundary>
  )
}
