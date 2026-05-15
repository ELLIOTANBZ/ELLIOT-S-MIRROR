/**
 * Topbar — all pages use background #1e6b4a, white text.
 * variant prop kept for API compatibility but both variants now use the same colour.
 * titleNode — optional JSX to replace the plain title string.
 */
export default function Topbar({ title, subtitle, titleNode }) {
  return (
    <header style={{
      background: '#1e6b4a',
      color: 'white',
      padding: '0 28px',
      height: '62px', minHeight: '62px',
      display: 'flex', alignItems: 'center',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      flexShrink: 0,
    }}>
      <div>
        {titleNode ?? (
          <div style={{ fontWeight: '700', fontSize: '15px', lineHeight: '1.2', letterSpacing: '-0.01em' }}>
            {title}
          </div>
        )}
        {subtitle && (
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)', marginTop: '2px' }}>
            {subtitle}
          </div>
        )}
      </div>
    </header>
  )
}
