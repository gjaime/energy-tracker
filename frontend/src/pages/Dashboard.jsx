import { useState } from 'react'
import { useServicios } from '../hooks/useServicios'
import { useEventos } from '../hooks/useEventos'
import { useRecibos } from '../hooks/useRecibos'
import { AlertaCiclo } from '../components/ui/AlertaCiclo'
import { ResumenAjuste } from '../components/ui/ResumenAjuste'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function Dashboard() {
  const { servicios, cargando: cargandoServicios } = useServicios()
  const [servicioActivo, setServicioActivo] = useState(null)
  const servicio = servicios.find(s => s.id === servicioActivo) || servicios[0]

  const { eventos, cargando: cargandoEventos, agregarLectura } = useEventos(servicio?.id)
  const { recibos, importando, subir } = useRecibos(servicio?.id)

  const [tab, setTab] = useState('dashboard')
  const [nuevaLectura, setNuevaLectura] = useState('')
  const [fechaLectura, setFechaLectura] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [guardando, setGuardando] = useState(false)
  const [resultadoImport, setResultadoImport] = useState(null)
  const [errorForm, setErrorForm] = useState(null)

  const alerta = servicio?.alerta_ciclo || null

  // Datos para la gráfica de consumo
  const datosGrafica = eventos
    .filter(e => e.tipo === 'lectura_diaria' && e.consumo_dia != null)
    .slice(0, 30)
    .reverse()
    .map(e => ({
      fecha: format(new Date(e.fecha + 'T12:00:00'), 'd MMM', { locale: es }),
      consumo: e.consumo_dia,
    }))

  const handleRegistrarLectura = async (e) => {
    e.preventDefault()
    if (!nuevaLectura) return
    setGuardando(true)
    setErrorForm(null)
    try {
      await agregarLectura(fechaLectura, parseInt(nuevaLectura))
      setNuevaLectura('')
    } catch (err) {
      setErrorForm(err.response?.data?.detail || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const handleSubirRecibo = async (e) => {
    const archivo = e.target.files[0]
    if (!archivo) return
    try {
      const resultado = await subir(archivo)
      setResultadoImport(resultado)
    } catch (_) {}
    e.target.value = ''
  }

  if (cargandoServicios) return <Spinner />

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f14', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ background: '#0f1923', borderBottom: '1px solid #1d2430', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#1aff70', fontWeight: 'bold', fontSize: '16px' }}>⚡ CFE Tracker</span>

        {/* Selector de servicio */}
        {servicios.length > 1 && (
          <select
            value={servicio?.id || ''}
            onChange={e => setServicioActivo(e.target.value)}
            style={{ background: '#1d2430', border: '1px solid #2d3748', color: '#e2e8f0', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
          >
            {servicios.map(s => <option key={s.id} value={s.id}>{s.alias}</option>)}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1d2430', background: '#0f1923' }}>
        {[
          { id: 'dashboard', label: '📊 Dashboard' },
          { id: 'lecturas', label: '📖 Lecturas' },
          { id: 'recibos', label: '🧾 Recibos' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '12px 20px', background: 'none',
            border: 'none', borderBottom: tab === t.id ? '2px solid #1aff70' : '2px solid transparent',
            color: tab === t.id ? '#1aff70' : '#3d5070',
            fontSize: '13px', cursor: 'pointer', letterSpacing: '0.5px',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>

        {/* Banner de alerta ciclo extendido */}
        <AlertaCiclo alerta={alerta} />

        {/* ── TAB DASHBOARD ── */}
        {tab === 'dashboard' && (
          <div>
            {/* Tarjetas de resumen */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              <Tarjeta label="Último recibo" valor={recibos[0] ? `$${Number(recibos[0].total).toFixed(0)}` : '—'} sub={recibos[0]?.fecha_emision || ''} color="#1aff70" />
              <Tarjeta label="Consumo acumulado" valor={eventos[0] ? `${eventos[0].lectura_valor - (eventos[eventos.length - 1]?.lectura_valor || 0)} kWh` : '—'} sub="ciclo actual" color="#38bdf8" />
              <Tarjeta label="Lecturas registradas" valor={eventos.filter(e => e.tipo === 'lectura_diaria').length} sub="este ciclo" color="#a78bfa" />
              <Tarjeta label="Recibos históricos" valor={recibos.length} sub="importados" color="#fb923c" />
            </div>

            {/* Gráfica de consumo diario */}
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
                <p style={{ color: '#3d5070', textAlign: 'center', padding: '40px 0' }}>
                  Registra más lecturas para ver la gráfica de consumo
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── TAB LECTURAS ── */}
        {tab === 'lecturas' && (
          <div>
            {/* Formulario nueva lectura */}
            <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
              <p style={{ color: '#64748b', fontSize: '11px', letterSpacing: '1px', margin: '0 0 14px' }}>REGISTRAR LECTURA</p>
              <form onSubmit={handleRegistrarLectura} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input
                  type="date" value={fechaLectura}
                  onChange={e => setFechaLectura(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="number" value={nuevaLectura}
                  onChange={e => setNuevaLectura(e.target.value)}
                  placeholder="Lectura del medidor (kWh)"
                  style={{ ...inputStyle, flex: 1, minWidth: '160px' }}
                  required
                />
                <button type="submit" disabled={guardando} style={btnStyle}>
                  {guardando ? 'Guardando...' : '+ Guardar'}
                </button>
              </form>
              {errorForm && <p style={{ color: '#f87171', fontSize: '12px', margin: '8px 0 0' }}>{errorForm}</p>}
            </div>

            {/* Lista de lecturas */}
            <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1d2430' }}>
                {['Fecha', 'Lectura', 'Consumo', 'Fuente'].map(h => (
                  <span key={h} style={{ color: '#3d5070', fontSize: '11px', letterSpacing: '1px' }}>{h}</span>
                ))}
              </div>
              {cargandoEventos ? <Spinner small /> : eventos.map(e => (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #0f1923' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>{e.fecha}</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>{e.lectura_valor}</span>
                  <span style={{ color: e.consumo_dia > 0 ? '#1aff70' : '#3d5070', fontSize: '13px' }}>
                    {e.consumo_dia != null ? `${e.consumo_dia} kWh` : '—'}
                  </span>
                  <span style={{ color: '#3d5070', fontSize: '11px', textTransform: 'uppercase' }}>
                    {e.sobreescrita ? '⚠️ ajustada' : e.fuente}
                  </span>
                </div>
              ))}
              {!cargandoEventos && eventos.length === 0 && (
                <p style={{ color: '#3d5070', textAlign: 'center', padding: '30px' }}>
                  No hay lecturas registradas en este ciclo
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── TAB RECIBOS ── */}
        {tab === 'recibos' && (
          <div>
            {/* Área de importación */}
            <div style={{ background: '#0f1923', border: '2px dashed #1d2430', borderRadius: '10px', padding: '30px', textAlign: 'center', marginBottom: '20px' }}>
              <p style={{ color: '#3d5070', fontSize: '13px', margin: '0 0 16px' }}>
                Sube un PDF o imagen de tu recibo CFE para extraer los datos automáticamente
              </p>
              <label style={{ ...btnStyle, display: 'inline-block', cursor: importando ? 'not-allowed' : 'pointer' }}>
                {importando ? '⏳ Procesando con Claude...' : '📄 Seleccionar recibo'}
                <input type="file" accept=".pdf,image/*" onChange={handleSubirRecibo} style={{ display: 'none' }} disabled={importando} />
              </label>
            </div>

            {/* Lista de recibos históricos */}
            <div style={{ background: '#0f1923', border: '1px solid #1d2430', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1d2430' }}>
                {['Emisión', 'Lectura CFE', 'Consumo', 'Total'].map(h => (
                  <span key={h} style={{ color: '#3d5070', fontSize: '11px', letterSpacing: '1px' }}>{h}</span>
                ))}
              </div>
              {recibos.map(r => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #0f1923' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>{r.fecha_emision}</span>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>{r.fecha_lectura_cfe}</span>
                  <span style={{ color: '#38bdf8', fontSize: '13px' }}>{r.consumo_kwh} kWh</span>
                  <span style={{ color: '#1aff70', fontSize: '13px' }}>${Number(r.total).toFixed(0)}</span>
                </div>
              ))}
              {recibos.length === 0 && (
                <p style={{ color: '#3d5070', textAlign: 'center', padding: '30px' }}>
                  No hay recibos importados aún
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal resumen de ajuste */}
      <ResumenAjuste resultado={resultadoImport} onCerrar={() => setResultadoImport(null)} />
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

function Spinner({ small }) {
  return (
    <div style={{ textAlign: 'center', padding: small ? '20px' : '60px', color: '#3d5070' }}>
      ⏳ Cargando...
    </div>
  )
}

const inputStyle = {
  background: '#1d2430', border: '1px solid #2d3748',
  borderRadius: '6px', padding: '8px 12px',
  color: '#e2e8f0', fontSize: '13px', outline: 'none',
  boxSizing: 'border-box',
}

const btnStyle = {
  background: '#1aff70', color: '#0a0f14',
  border: 'none', borderRadius: '6px',
  padding: '8px 16px', fontSize: '13px',
  fontWeight: 'bold', cursor: 'pointer',
}
