import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPerfil, getSistema, cambiarPin } from '../api/admin'

export default function Admin() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab]             = useState('sistema')
  const [sistema, setSistema]     = useState(null)
  const [perfil, setPerfil]       = useState(null)
  const [cargando, setCargando]   = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje]     = useState(null)

  const [pinActual, setPinActual]   = useState('')
  const [pinNuevo, setPinNuevo]     = useState('')
  const [pinConfirm, setPinConfirm] = useState('')

  useEffect(() => {
    if (usuario?.rol !== 'admin') { navigate('/'); return }
    Promise.all([getSistema(), getPerfil()])
      .then(([s, p]) => { setSistema(s); setPerfil(p) })
      .catch(() => mostrarMensaje('error', 'Error al cargar datos'))
      .finally(() => setCargando(false))
  }, [])

  const mostrarMensaje = (tipo, texto) => {
    setMensaje({ tipo, texto })
    setTimeout(() => setMensaje(null), 4000)
  }

  const handleCambiarPin = async (e) => {
    e.preventDefault()
    if (pinNuevo !== pinConfirm)
      return mostrarMensaje('error', 'Los PINs nuevos no coinciden')
    if (!/^\d{4}$/.test(pinNuevo))
      return mostrarMensaje('error', 'El PIN nuevo debe ser exactamente 4 dígitos')

    setGuardando(true)
    try {
      await cambiarPin({ pin_actual: pinActual, pin_nuevo: pinNuevo })
      mostrarMensaje('ok', 'PIN actualizado correctamente')
      setPinActual(''); setPinNuevo(''); setPinConfirm('')
    } catch (err) {
      mostrarMensaje('error', err.response?.data?.error || 'Error al cambiar el PIN')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return (
    <div style={{ minHeight: '100vh', background: '#0a0f14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#3d5070' }}>⏳ Cargando...</span>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f14', color: '#e2e8f0' }}>

      <div style={{ background: '#0f1923', borderBottom: '1px solid #1d2430', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/')} style={btnSecundario}>← Volver</button>
          <span style={{ color: '#1aff70', fontWeight: 'bold' }}>⚙️ Configuración</span>
        </div>
        <span style={{ color: '#3d5070', fontSize: '12px' }}>{perfil?.nombre_usuario}</span>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #1d2430', background: '#0f1923' }}>
        {[
          { id: 'sistema', label: '📊 Sistema' },
          { id: 'cuenta',  label: '🔒 Cuenta'  },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '12px 20px', background: 'none', border: 'none',
            borderBottom: tab === t.id ? '2px solid #1aff70' : '2px solid transparent',
            color: tab === t.id ? '#1aff70' : '#3d5070',
            fontSize: '13px', cursor: 'pointer',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: '560px', margin: '0 auto', padding: '24px 20px' }}>

        {mensaje && (
          <div style={{
            background: mensaje.tipo === 'ok' ? '#052e16' : '#450a0a',
            border: `1px solid ${mensaje.tipo === 'ok' ? '#166534' : '#dc2626'}`,
            borderRadius: '8px', padding: '12px 16px', marginBottom: '20px',
            color: mensaje.tipo === 'ok' ? '#86efac' : '#fca5a5', fontSize: '13px',
          }}>
            {mensaje.tipo === 'ok' ? '✅' : '❌'} {mensaje.texto}
          </div>
        )}

        {tab === 'sistema' && sistema && (
          <div>
            <Seccion titulo="Estado del sistema">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Stat label="Ciclos abiertos"    valor={sistema.ciclos_abiertos}    color="#1aff70" />
                <Stat label="Total de lecturas"  valor={sistema.total_eventos}      color="#38bdf8" />
                <Stat label="Recibos importados" valor={sistema.total_recibos}      color="#a78bfa" />
                <Stat label="Usuarios"           valor={sistema.usuarios}           color="#fb923c" />
              </div>
            </Seccion>

            {sistema.ultima_lectura && (
              <Seccion titulo="Última actividad">
                <Fila label="Fecha"   valor={sistema.ultima_lectura.fecha} />
                <Fila label="Lectura" valor={`${Number(sistema.ultima_lectura.lectura_valor).toLocaleString()} kWh`} />
                <Fila label="Fuente"  valor={sistema.ultima_lectura.fuente} />
              </Seccion>
            )}

            <Seccion titulo="Acciones">
              <button
                onClick={() => { logout(); navigate('/login') }}
                style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #dc2626', borderRadius: '6px', padding: '8px 14px', fontSize: '12px', cursor: 'pointer' }}
              >
                Cerrar sesión
              </button>
            </Seccion>
          </div>
        )}

        {tab === 'cuenta' && (
          <div>
            <Seccion titulo="Cambiar PIN">
              <form onSubmit={handleCambiarPin}>
                <PinCampo label="PIN actual"    value={pinActual}  onChange={setPinActual}  />
                <PinCampo label="PIN nuevo"     value={pinNuevo}   onChange={setPinNuevo}   />
                <PinCampo label="Confirmar PIN" value={pinConfirm} onChange={setPinConfirm} />
                <button type="submit" disabled={guardando} style={btnPrimario}>
                  {guardando ? 'Guardando...' : 'Cambiar PIN'}
                </button>
              </form>
            </Seccion>

            <Seccion titulo="Información de la cuenta">
              <Fila label="Usuario"    valor={perfil?.nombre_usuario} />
              <Fila label="Rol"        valor={perfil?.rol} />
              <Fila label="Registro"   valor={perfil?.fecha_registro?.split('T')[0]} />
              <Fila label="Último acceso" valor={perfil?.ultimo_acceso?.split('T')[0]} />
            </Seccion>
          </div>
        )}
      </div>
    </div>
  )
}

function Seccion({ titulo, children }) {
  return (
    <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
      <p style={{ color: '#3d5070', fontSize: '11px', letterSpacing: '1px', margin: '0 0 16px' }}>{titulo.toUpperCase()}</p>
      {children}
    </div>
  )
}

function Stat({ label, valor, color }) {
  return (
    <div style={{ background: '#0a0f14', borderRadius: '8px', padding: '14px' }}>
      <p style={{ color: '#3d5070', fontSize: '11px', margin: '0 0 4px', letterSpacing: '1px' }}>{label.toUpperCase()}</p>
      <p style={{ color, fontSize: '22px', fontWeight: 'bold', margin: 0 }}>{valor}</p>
    </div>
  )
}

function Fila({ label, valor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0a0f14' }}>
      <span style={{ color: '#3d5070', fontSize: '13px' }}>{label}</span>
      <span style={{ color: '#94a3b8', fontSize: '13px' }}>{valor || '—'}</span>
    </div>
  )
}

function PinCampo({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', color: '#3d5070', fontSize: '11px', letterSpacing: '1px', marginBottom: '6px' }}>
        {label.toUpperCase()}
      </label>
      <input
        type="password"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="••••"
        style={{ display: 'block', width: '100%', background: '#1d2430', border: '1px solid #2d3748', borderRadius: '6px', padding: '9px 12px', color: '#e2e8f0', fontSize: '20px', letterSpacing: '0.5em', textAlign: 'center', boxSizing: 'border-box', outline: 'none' }}
      />
    </div>
  )
}

const btnPrimario  = { background: '#1aff70', color: '#0a0f14', border: 'none', borderRadius: '6px', padding: '10px 20px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginTop: '4px' }
const btnSecundario = { background: '#1d2430', color: '#94a3b8', border: '1px solid #2d3748', borderRadius: '6px', padding: '8px 14px', fontSize: '12px', cursor: 'pointer' }
