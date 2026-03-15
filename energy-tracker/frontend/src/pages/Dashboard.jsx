import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getServicios } from '../api/servicios'
import { getEventos, registrarLectura } from '../api/eventos'
import { getRecibos } from '../api/recibos'
import { AlertaCiclo } from '../components/ui/AlertaCiclo'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'

export default function Dashboard() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()

  const [servicios, setServicios]   = useState([])
  const [servicio, setServicio]     = useState(null)
  const [eventos, setEventos]       = useState([])
  const [recibos, setRecibos]       = useState([])
  const [cargando, setCargando]     = useState(true)
  const [tab, setTab]               = useState('dashboard')

  const [nuevaLectura, setNuevaLectura] = useState('')
  const [fechaLectura, setFechaLectura] = useState(
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  )
  const [guardando, setGuardando]   = useState(false)
  const [errorForm, setErrorForm]   = useState(null)

  // ── Carga inicial ─────────────────────────────────────────────────────
  useEffect(() => {
    getServicios()
      .then(svcs => {
        setServicios(svcs)
        if (svcs[0]) setServicio(svcs[0])
      })
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => {
    if (!servicio) return
    getEventos(servicio.id).then(setEventos).catch(() => {})
    getRecibos(servicio.id).then(setRecibos).catch(() => {})
  }, [servicio])

  // ── Datos para la gráfica ─────────────────────────────────────────────
  const datosGrafica = eventos
    .filter(e => e.tipo === 'lectura_diaria' && e.consumo_dia != null && e.consumo_dia > 0)
    .slice(0, 30)
    .reverse()
    .map(e => ({
      fecha:   format(new Date(e.fecha + 'T12:00:00'), 'd MMM', { locale: es }),
      consumo: e.consumo_dia,
    }))

  const alerta = servicio?.alerta_ciclo || null

  // ── Número de recibos como proxy de historial disponible ──────────────
  const tieneHistorial = recibos.length > 1

  // ── Guardar lectura ───────────────────────────────────────────────────
  const handleRegistrarLectura = async (e) => {
    e.preventDefault()
    if (!nuevaLectura || !servicio) return
    setGuardando(true)
    setErrorForm(null)
    try {
      const result = await registrarLectura({
        servicio_id:   servicio.id,
        lectura_valor: parseInt(nuevaLectura),
        fecha:         fechaLectura,
      })
      setEventos(prev => [result.evento, ...prev])
      setNuevaLectura('')
    } catch (err) {
      setErrorForm(err.response?.data?.error || 'Error al guardar la lectura')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <Spinner />

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f14', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ background: '#0f1923', borderBottom: '1px solid #1d2430', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#1aff70', fontWeight: 'bold', fontSize: '16px' }}>⚡ Energy Tracker</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ color: '#3d5070', fontSize: '12px' }}>{usuario?.nombre_usuario}</span>
          {usuario?.rol === 'admin' && (
            <button onClick={() => navigate('/admin')} style={btnHeader}>⚙️</button>
          )}
          <button onClick={() => { logout(); navigate('/login') }} style={btnHeader}>Salir</button>
        </div>
      </div>

      {/* Selector de servicio (si hay más de uno) */}
      {servicios.length > 1 && (
        <div style={{ background: '#0f1923', borderBottom: '1px solid #1d2430', padding: '8px 20px' }}>
          <select
            value={servicio?.id || ''}
            onChange={e => setServicio(servicios.find(s => s.id === e.target.value))}
            style={{ background: '#1d2430', border: '1px solid #2d3748', color: '#e2e8f0', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
          >
            {servicios.map(s => <option key={s.id} value={s.id}>{s.alias}</option>)}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1d2430', background: '#0f1923' }}>
        {[
          { id: 'dashboard', label: '📊 Dashboard' },
          { id: 'lecturas',  label: '📖 Lecturas'  },
          { id: 'recibos',   label: '🧾 Recibos'   },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '12px 20px', background: 'none', border: 'none',
            borderBottom: tab === t.id ? '2px solid #1aff70' : '2px solid transparent',
            color: tab === t.id ? '#1aff70' : '#3d5070',
            fontSize: '13px', cursor: 'pointer', letterSpacing: '0.5px',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>

        <AlertaCiclo alerta={alerta} />

        {/* Banner de historial insuficiente */}
        {!tieneHistorial && tab === 'dashboard' && (
          <div style={{ background: '#1e1a00', border: '1px solid #ca8a04', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#fde68a', lineHeight: 1.6 }}>
            <strong>ℹ️ Datos históricos limitados</strong> — Con un solo recibo, las proyecciones y tendencias no están disponibles.
            Agrega más recibos en la pestaña <strong>Recibos</strong> para desbloquear estas funcionalidades.
          </div>
        )}

        {/* ── TAB DASHBOARD ── */}
        {tab === 'dashboard' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              <Tarjeta
                label="Último recibo"
                valor={recibos[0] ? `$${Number(recibos[0].total).toFixed(0)}` : '—'}
                sub={recibos[0]?.fecha_emision || 'sin recibos'}
                color="#1aff70"
              />
              <Tarjeta
                label="Consumo ciclo actual"
                valor={eventos.length
                  ? `${(eventos[0].lectura_valor - (eventos[eventos.length - 1]?.lectura_valor || eventos[0].lectura_valor) + (eventos[events.length - 1]?.consumo_dia || 0))} kWh`
                  : '—'}
                sub="estimado"
                color="#38bdf8"
              />
              <Tarjeta
                label="Lecturas registradas"
                valor={eventos.filter(e => e.tipo === 'lectura_diaria').length}
                sub="este ciclo"
                color="#a78bfa"
              />
              <Tarjeta
                label="Recibos históricos"
                valor={recibos.length}
                sub="importados"
                color="#fb923c"
              />
            </div>

            <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', padding: '20px' }}>
              <p style={{ color: '#64748b', fontSize: '11px', letterSpacing: '1px', margin: '0 0 16px' }}>CONSUMO DIARIO (kWh)</p>
              {datosGrafica.length > 1 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={datosGrafica}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1d2430" />
                    <XAxis dataKey="fecha" tick={{ fill: '#3d5070', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#3d5070', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#0f1923', border: '1px solid #1d2430', color: '#e2e8f0' }} />
                    <Line type="monotone" dataKey="consumo" stroke="#1aff70" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <p style={{ color: '#3d5070', margin: '0 0 8px' }}>Registra lecturas diarias para ver la gráfica</p>
                  <button onClick={() => setTab('lecturas')} style={{ ...btnPrimario, fontSize: '12px', padding: '6px 16px' }}>
                    Registrar lectura →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB LECTURAS ── */}
        {tab === 'lecturas' && (
          <div>
            <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
              <p style={{ color: '#64748b', fontSize: '11px', letterSpacing: '1px', margin: '0 0 14px' }}>REGISTRAR LECTURA</p>
              <form onSubmit={handleRegistrarLectura} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={fechaLectura}
                  onChange={e => setFechaLectura(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="number"
                  value={nuevaLectura}
                  onChange={e => setNuevaLectura(e.target.value)}
                  placeholder="Lectura del medidor (kWh)"
                  style={{ ...inputStyle, flex: 1, minWidth: '160px' }}
                  required
                />
                <button type="submit" disabled={guardando} style={btnPrimario}>
                  {guardando ? 'Guardando...' : '+ Guardar'}
                </button>
              </form>
              {errorForm && <p style={{ color: '#f87171', fontSize: '12px', margin: '8px 0 0' }}>{errorForm}</p>}
            </div>

            <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1d2430' }}>
                {['Fecha', 'Lectura', 'Consumo', 'Fuente'].map(h => (
                  <span key={h} style={{ color: '#3d5070', fontSize: '11px', letterSpacing: '1px' }}>{h}</span>
                ))}
              </div>
              {eventos.length === 0 ? (
                <p style={{ color: '#3d5070', textAlign: 'center', padding: '30px' }}>
                  No hay lecturas registradas en este ciclo
                </p>
              ) : (
                eventos.map(e => (
                  <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #0f1923' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>{e.fecha}</span>
                    <span style={{ color: '#e2e8f0', fontSize: '13px' }}>{Number(e.lectura_valor).toLocaleString()}</span>
                    <span style={{ color: e.consumo_dia > 0 ? '#1aff70' : '#3d5070', fontSize: '13px' }}>
                      {e.consumo_dia != null ? `${e.consumo_dia} kWh` : '—'}
                    </span>
                    <span style={{ color: '#3d5070', fontSize: '11px', textTransform: 'uppercase' }}>
                      {e.sobreescrita ? '⚠️ ajustada' : e.fuente}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── TAB RECIBOS ── */}
        {tab === 'recibos' && (
          <div>
            <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1d2430' }}>
                {['Emisión', 'Corte CFE', 'Consumo', 'Total'].map(h => (
                  <span key={h} style={{ color: '#3d5070', fontSize: '11px', letterSpacing: '1px' }}>{h}</span>
                ))}
              </div>
              {recibos.length === 0 ? (
                <p style={{ color: '#3d5070', textAlign: 'center', padding: '30px' }}>
                  No hay recibos importados aún
                </p>
              ) : (
                recibos.map(r => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #0f1923' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>{r.fecha_emision || '—'}</span>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>{r.fecha_lectura_cfe}</span>
                    <span style={{ color: '#38bdf8', fontSize: '13px' }}>{(r.lectura_actual - r.lectura_anterior).toLocaleString()} kWh</span>
                    <span style={{ color: '#1aff70', fontSize: '13px' }}>${Number(r.total).toFixed(0)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function Tarjeta({ label, valor, sub, color }) {
  return (
    <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', padding: '16px' }}>
      <p style={{ color: '#3d5070', fontSize: '11px', letterSpacing: '1px', margin: '0 0 8px' }}>{label.toUpperCase()}</p>
      <p style={{ color, fontSize: '24px', fontWeight: 'bold', margin: '0 0 4px' }}>{valor}</p>
      <p style={{ color: '#3d5070', fontSize: '11px', margin: 0 }}>{sub}</p>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0f14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#3d5070', fontSize: '14px' }}>⏳ Cargando...</span>
    </div>
  )
}

const inputStyle  = { background: '#1d2430', border: '1px solid #2d3748', borderRadius: '6px', padding: '8px 12px', color: '#e2e8f0', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }
const btnPrimario = { background: '#1aff70', color: '#0a0f14', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }
const btnHeader   = { background: 'none', border: '1px solid #1d2430', borderRadius: '6px', color: '#3d5070', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }
