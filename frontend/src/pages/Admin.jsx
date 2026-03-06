import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPerfil, getSistema, cambiarPassword, editarServicio } from '../api/admin'
import { getServicios } from '../api/servicios'

export default function Admin() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab]               = useState('sistema')
  const [sistema, setSistema]       = useState(null)
  const [perfil, setPerfil]         = useState(null)
  const [servicio, setServicio]     = useState(null)
  const [cargando, setCargando]     = useState(true)
  const [guardando, setGuardando]   = useState(false)
  const [mensaje, setMensaje]       = useState(null)  // {tipo:'ok'|'error', texto}

  // Formulario contraseña
  const [pwActual, setPwActual]     = useState('')
  const [pwNuevo, setPwNuevo]       = useState('')
  const [pwConfirm, setPwConfirm]   = useState('')

  // Formulario servicio
  const [formServicio, setFormServicio] = useState({})

  useEffect(() => {
    if (usuario?.rol !== 'admin') { navigate('/'); return }
    cargarTodo()
  }, [])

  const cargarTodo = async () => {
    setCargando(true)
    try {
      const [s, p, svcs] = await Promise.all([getSistema(), getPerfil(), getServicios()])
      setSistema(s)
      setPerfil(p)
      if (svcs[0]) {
        setServicio(svcs[0])
        setFormServicio({
          alias:           svcs[0].alias,
          numero_servicio: svcs[0].numero_servicio,
          numero_medidor:  svcs[0].numero_medidor  || '',
          tarifa_tipo:     svcs[0].tarifa_tipo     || '1',
          ciudad:          svcs[0].ciudad          || '',
          estado_rep:      svcs[0].estado_rep      || '',
          notas:           svcs[0].notas           || '',
        })
      }
    } catch (e) {
      mostrarMensaje('error', 'Error al cargar datos')
    } finally {
      setCargando(false)
    }
  }

  const mostrarMensaje = (tipo, texto) => {
    setMensaje({ tipo, texto })
    setTimeout(() => setMensaje(null), 4000)
  }

  const handleCambiarPassword = async (e) => {
    e.preventDefault()
    if (pwNuevo !== pwConfirm)
      return mostrarMensaje('error', 'Las contraseñas nuevas no coinciden')
    if (pwNuevo.length < 8)
      return mostrarMensaje('error', 'La contraseña debe tener al menos 8 caracteres')

    setGuardando(true)
    try {
      await cambiarPassword({ password_actual: pwActual, password_nuevo: pwNuevo })
      mostrarMensaje('ok', 'Contraseña actualizada correctamente')
      setPwActual(''); setPwNuevo(''); setPwConfirm('')
    } catch (e) {
      mostrarMensaje('error', e.response?.data?.error || 'Error al cambiar contraseña')
    } finally {
      setGuardando(false)
    }
  }

  const handleEditarServicio = async (e) => {
    e.preventDefault()
    if (!servicio) return
    setGuardando(true)
    try {
      const actualizado = await editarServicio(servicio.id, formServicio)
      setServicio(actualizado)
      mostrarMensaje('ok', 'Servicio actualizado correctamente')
    } catch (e) {
      mostrarMensaje('error', e.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return (
    <div style={{ minHeight:'100vh', background:'#0a0f14', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <span style={{ color:'#3d5070' }}>⏳ Cargando...</span>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#0a0f14', color:'#e2e8f0' }}>

      {/* Header */}
      <div style={{ background:'#0f1923', borderBottom:'1px solid #1d2430', padding:'12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
          <button onClick={() => navigate('/')} style={{ ...btnSecundario, fontSize:'12px' }}>
            ← Volver
          </button>
          <span style={{ color:'#1aff70', fontWeight:'bold' }}>⚙️ Configuración</span>
        </div>
        <span style={{ color:'#3d5070', fontSize:'12px' }}>{perfil?.nombre} · {perfil?.email}</span>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #1d2430', background:'#0f1923' }}>
        {[
          { id:'sistema',  label:'📊 Sistema'  },
          { id:'servicio', label:'🏠 Servicio Eléctrico' },
          { id:'cuenta',   label:'🔒 Cuenta'   },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'12px 20px', background:'none', border:'none',
            borderBottom: tab===t.id ? '2px solid #1aff70' : '2px solid transparent',
            color: tab===t.id ? '#1aff70' : '#3d5070',
            fontSize:'13px', cursor:'pointer',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth:'600px', margin:'0 auto', padding:'24px 20px' }}>

        {/* Mensaje global */}
        {mensaje && (
          <div style={{
            background: mensaje.tipo === 'ok' ? '#052e16' : '#450a0a',
            border: `1px solid ${mensaje.tipo === 'ok' ? '#166534' : '#dc2626'}`,
            borderRadius:'8px', padding:'12px 16px', marginBottom:'20px',
            color: mensaje.tipo === 'ok' ? '#86efac' : '#fca5a5',
            fontSize:'13px',
          }}>
            {mensaje.tipo === 'ok' ? '✅' : '❌'} {mensaje.texto}
          </div>
        )}

        {/* ── TAB SISTEMA ── */}
        {tab === 'sistema' && sistema && (
          <div>
            <Seccion titulo="Estado del sistema">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                <Stat label="Ciclos abiertos"    valor={sistema.ciclos_abiertos}    color="#1aff70" />
                <Stat label="Total de lecturas"  valor={sistema.total_eventos}      color="#38bdf8" />
                <Stat label="Recibos importados" valor={sistema.total_recibos}      color="#a78bfa" />
                <Stat label="Lecturas pendientes" valor={sistema.pendientes_activos} color={sistema.pendientes_activos > 0 ? '#fb923c' : '#3d5070'} />
              </div>
            </Seccion>

            {sistema.ultima_lectura && (
              <Seccion titulo="Última actividad">
                <Fila label="Fecha"   valor={sistema.ultima_lectura.fecha} />
                <Fila label="Lectura" valor={`${parseInt(sistema.ultima_lectura.lectura_valor).toLocaleString()} kWh`} />
                <Fila label="Fuente"  valor={sistema.ultima_lectura.fuente} />
              </Seccion>
            )}

            <Seccion titulo="Acciones">
              <button onClick={cargarTodo} style={{ ...btnSecundario, marginRight:'10px' }}>
                🔄 Actualizar
              </button>
              <button onClick={() => { logout(); navigate('/login') }} style={btnPeligro}>
                Cerrar sesión
              </button>
            </Seccion>
          </div>
        )}

        {/* ── TAB SERVICIO ── */}
        {tab === 'servicio' && (
          <div>
            <Seccion titulo="Datos del contrato eléctrico">
              <p style={{ color:'#3d5070', fontSize:'12px', margin:'0 0 16px' }}>
                Estos datos se usan para identificar tu contrato y calcular tarifas correctamente.
              </p>
              <form onSubmit={handleEditarServicio}>
                <Campo label="Alias (nombre interno)"
                  value={formServicio.alias || ''}
                  onChange={v => setFormServicio(p => ({...p, alias: v}))}
                  placeholder="ej: Casa"
                />
                <Campo label="Número de servicio"
                  value={formServicio.numero_servicio || ''}
                  onChange={v => setFormServicio(p => ({...p, numero_servicio: v}))}
                  placeholder="ej: 076200457478"
                />
                <Campo label="Número de medidor"
                  value={formServicio.numero_medidor || ''}
                  onChange={v => setFormServicio(p => ({...p, numero_medidor: v}))}
                  placeholder="ej: Y613KR"
                />
                <div style={{ marginBottom:'14px' }}>
                  <label style={labelStyle}>TIPO DE TARIFA</label>
                  <select
                    value={formServicio.tarifa_tipo || '1'}
                    onChange={e => setFormServicio(p => ({...p, tarifa_tipo: e.target.value}))}
                    style={inputStyle}
                  >
                    {['1','1A','1B','1C','1D','1E','1F','DAC'].map(t =>
                      <option key={t} value={t}>{t}</option>
                    )}
                  </select>
                </div>
                <Campo label="Ciudad"
                  value={formServicio.ciudad || ''}
                  onChange={v => setFormServicio(p => ({...p, ciudad: v}))}
                  placeholder="ej: Querétaro"
                />
                <Campo label="Estado"
                  value={formServicio.estado_rep || ''}
                  onChange={v => setFormServicio(p => ({...p, estado_rep: v}))}
                  placeholder="ej: Querétaro"
                />
                <Campo label="Notas"
                  value={formServicio.notas || ''}
                  onChange={v => setFormServicio(p => ({...p, notas: v}))}
                  placeholder="Notas adicionales..."
                />
                <button type="submit" disabled={guardando} style={btnPrimario}>
                  {guardando ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </form>
            </Seccion>
          </div>
        )}

        {/* ── TAB CUENTA ── */}
        {tab === 'cuenta' && (
          <div>
            <Seccion titulo="Cambiar contraseña">
              <p style={{ color:'#3d5070', fontSize:'12px', margin:'0 0 16px' }}>
                Si es la primera vez, la contraseña por defecto es <code style={{ color:'#1aff70' }}>energy2026</code>.
                Cámbiala ahora.
              </p>
              <form onSubmit={handleCambiarPassword}>
                <Campo label="Contraseña actual"    value={pwActual}  onChange={setPwActual}  tipo="password" placeholder="••••••••" />
                <Campo label="Contraseña nueva"     value={pwNuevo}   onChange={setPwNuevo}   tipo="password" placeholder="mínimo 8 caracteres" />
                <Campo label="Confirmar contraseña" value={pwConfirm} onChange={setPwConfirm} tipo="password" placeholder="repetir contraseña nueva" />
                <button type="submit" disabled={guardando} style={btnPrimario}>
                  {guardando ? 'Guardando...' : 'Cambiar contraseña'}
                </button>
              </form>
            </Seccion>

            <Seccion titulo="Información de la cuenta">
              <Fila label="Nombre" valor={perfil?.nombre} />
              <Fila label="Email"  valor={perfil?.email} />
              <Fila label="Rol"    valor={perfil?.rol} />
              <Fila label="Registro" valor={perfil?.fecha_registro?.split('T')[0]} />
              <Fila label="Último acceso" valor={perfil?.ultimo_acceso?.split('T')[0]} />
            </Seccion>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Componentes internos ──────────────────────────────────────────────────

function Seccion({ titulo, children }) {
  return (
    <div style={{ background:'#0f1923', border:'1px solid #1d2430', borderRadius:'10px', padding:'20px', marginBottom:'16px' }}>
      <p style={{ color:'#3d5070', fontSize:'11px', letterSpacing:'1px', margin:'0 0 16px' }}>{titulo.toUpperCase()}</p>
      {children}
    </div>
  )
}

function Stat({ label, valor, color }) {
  return (
    <div style={{ background:'#0a0f14', borderRadius:'8px', padding:'14px' }}>
      <p style={{ color:'#3d5070', fontSize:'11px', margin:'0 0 4px', letterSpacing:'1px' }}>{label.toUpperCase()}</p>
      <p style={{ color, fontSize:'22px', fontWeight:'bold', margin:0 }}>{valor}</p>
    </div>
  )
}

function Fila({ label, valor }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #0a0f14' }}>
      <span style={{ color:'#3d5070', fontSize:'13px' }}>{label}</span>
      <span style={{ color:'#94a3b8', fontSize:'13px' }}>{valor || '—'}</span>
    </div>
  )
}

function Campo({ label, value, onChange, tipo='text', placeholder='' }) {
  return (
    <div style={{ marginBottom:'14px' }}>
      <label style={labelStyle}>{label.toUpperCase()}</label>
      <input
        type={tipo} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  )
}

const labelStyle = { display:'block', color:'#3d5070', fontSize:'11px', letterSpacing:'1px', marginBottom:'6px' }
const inputStyle  = { display:'block', width:'100%', background:'#1d2430', border:'1px solid #2d3748', borderRadius:'6px', padding:'9px 12px', color:'#e2e8f0', fontSize:'13px', boxSizing:'border-box', outline:'none' }
const btnPrimario = { background:'#1aff70', color:'#0a0f14', border:'none', borderRadius:'6px', padding:'10px 20px', fontSize:'13px', fontWeight:'bold', cursor:'pointer', marginTop:'4px' }
const btnSecundario = { background:'#1d2430', color:'#94a3b8', border:'1px solid #2d3748', borderRadius:'6px', padding:'8px 14px', fontSize:'12px', cursor:'pointer' }
const btnPeligro  = { background:'#450a0a', color:'#fca5a5', border:'1px solid #dc2626', borderRadius:'6px', padding:'8px 14px', fontSize:'12px', cursor:'pointer' }
