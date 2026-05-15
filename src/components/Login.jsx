import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App.jsx'
import cpfLogo from '../assets/cpf.jpeg'

export default function Login() {
  const { handleLogin } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed.'); return }
      handleLogin(data.token, data.user)
      navigate('/data-upload')
    } catch {
      setError('Unable to connect to server.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px',
    border: '1.5px solid #d1d5db', borderRadius: '8px',
    fontSize: '14px', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit', transition: 'border-color 0.15s',
    color: '#111827',
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f3f4f6',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      padding: '40px 20px',
    }}>
      <div style={{
        width: '100%', maxWidth: '420px',
        background: 'white', borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.11)',
        display: 'flex', flexDirection: 'column',
        minHeight: '580px',
      }}>

        {/* Logo + branding */}
        <div style={{ textAlign: 'center', padding: '0px 40px 20px' }}>
          <img
            src={cpfLogo}
            alt="CPF Logo"
            style={{ height: '200px', objectFit: 'contain', marginBottom: '0px' }}
          />
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
            CPF Simulator
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            Officer Performance Dashboard
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid #f0f0f0' }} />

        {/* Sign in — vertically centered in remaining space */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '28px 40px 40px' }}>

        {/* Sign in heading */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
            Sign in
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            Enter your credentials to access the dashboard
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              placeholder="Enter your username"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = '#1e6b4a'}
              onBlur={e  => e.target.style.borderColor = '#d1d5db'}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = '#1e6b4a'}
              onBlur={e  => e.target.style.borderColor = '#d1d5db'}
            />
          </div>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '8px', padding: '10px 14px',
              fontSize: '13px', color: '#dc2626',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? '#9ca3af' : '#1e6b4a',
              color: 'white', border: 'none', borderRadius: '8px',
              padding: '11px', fontSize: '14px', fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: '4px', transition: 'background 0.15s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#165a3c' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#1e6b4a' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        </div>
      </div>
    </div>
  )
}
