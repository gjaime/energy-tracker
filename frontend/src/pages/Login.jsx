import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [modo, setModo]           = useState('login')
  const [nombreUsuario, setNombre] = useState('')
  const [pin, setPin]             = useState('')
  const [error, setError]         = useState(null)
  const [cargando, setCargando]   = useState(false)
  const { login, register }       = useAuth()
  const navigate                  = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setCargando(true)
    setError(null)
    try {
      const fn = modo === 'login' ? login : register
      await fn(nombreUsuario, pin)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al procesar la solicitud')
    } finally {
      setCargando(false)
    }
  }

  const cambiarModo = (m) => { setModo(m); setError(null); setPin('') }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '12px', padding: '40px', width: '100%', maxWidth: '360px' }}>

        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>⚡</div>
          <h1 style={{ color: '#1aff70', margin: 0, fontSize: '22px' }}>Energy Tracker</h1>
          <p style={{ color: '#3d5070', margin: '6px 0 0', fontSize: '13px' }}>Monitoreo de consumo eléctrico</p>
        </div>

        {/* Toggle login / registro */}
        <div style={{ display: 'flex', background: '#1d2430', borderRadius: '8px', padding: '3px', marginBottom: '24px' }}>
          {[['login', 'Entrar'], ['register', 'Crear cuenta']].map(([m, label]) => (
            <button key={m} onClick={() => cambiarModo(m)} style={{
              flex: 1, padding: '8px 0', border: 'none', borderRadius: '6px',
              background: modo === m ? '#1aff70' : 'transparent',
              color: modo === m ? '#0a0f14' : '#3d5070',
              fontSize: '13px', fontWeight: modo === m ? 'bold' : 'normal',
              cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Campo usuario */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>USUARIO</label>
            <input
              type="text"
              value={nombreUsuario}
              onChange={e => setNombre(
                e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
              )}
              placeholder="hasta 10 caracteres"
              required
              autoComplete="username"
              style={inputStyle}
            />
            {modo === 'register' && nombreUsuario.length > 0 && (
              <p style={{ color: '#3d5070', fontSize: '11px', margin: '4px 0 0' }}>
                {nombreUsuario.length}/10
              </p>
            )}
          </div>

          {/* Campo PIN */}
          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4 dígitos"
              required
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
              style={{ ...inputStyle, letterSpacing: '0.6em', textAlign: 'center', fontSize: '22px' }}
            />
            {/* Indicadores de dígitos */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '10px' }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: pin.length > i ? '#1aff70' : '#1d2430',
                  border: `1px solid ${pin.length > i ? '#1aff70' : '#2d3748'}`,
                  transition: 'all 0.15s',
                }} />
              ))}
            </div>
          </div>

          {error && (
            <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: '6px', padding: '10px 12px', color: '#fca5a5', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={cargando || pin.length !== 4 || !nombreUsuario}
            style={{
              width: '100%',
              background: (cargando || pin.length !== 4 || !nombreUsuario) ? '#0f2a1a' : '#1aff70',
              color: '#0a0f14', border: 'none', borderRadius: '8px',
              padding: '12px', fontSize: '14px', fontWeight: 'bold',
              cursor: (cargando || pin.length !== 4 || !nombreUsuario) ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {cargando ? 'Procesando...' : modo === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', color: '#64748b', fontSize: '12px', letterSpacing: '1px', marginBottom: '6px' }
const inputStyle  = { display: 'block', width: '100%', background: '#1d2430', border: '1px solid #2d3748', borderRadius: '6px', padding: '10px 12px', color: '#e2e8f0', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }
