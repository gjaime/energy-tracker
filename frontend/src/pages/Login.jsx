import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setCargando(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Credenciales incorrectas')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0f14',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0f1923', border: '1px solid #1d2430',
        borderRadius: '12px', padding: '40px', width: '100%', maxWidth: '380px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>⚡</div>
          <h1 style={{ color: '#1aff70', margin: 0, fontSize: '22px' }}>CFE Tracker</h1>
          <p style={{ color: '#3d5070', margin: '6px 0 0', fontSize: '13px' }}>
            Monitoreo de consumo eléctrico
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ color: '#64748b', fontSize: '12px', letterSpacing: '1px' }}>EMAIL</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required
              style={inputStyle}
              placeholder="usuario@correo.com"
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ color: '#64748b', fontSize: '12px', letterSpacing: '1px' }}>CONTRASEÑA</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required style={inputStyle} placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{
              background: '#450a0a', border: '1px solid #dc2626',
              borderRadius: '6px', padding: '10px 12px',
              color: '#fca5a5', fontSize: '13px', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={cargando} style={{
            width: '100%', background: cargando ? '#0f4a26' : '#1aff70',
            color: '#0a0f14', border: 'none', borderRadius: '8px',
            padding: '12px', fontSize: '14px', fontWeight: 'bold',
            cursor: cargando ? 'not-allowed' : 'pointer',
          }}>
            {cargando ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputStyle = {
  display: 'block', width: '100%', marginTop: '6px',
  background: '#1d2430', border: '1px solid #2d3748',
  borderRadius: '6px', padding: '10px 12px',
  color: '#e2e8f0', fontSize: '14px', boxSizing: 'border-box',
  outline: 'none',
}
