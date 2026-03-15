import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  extraerRecibo, iniciarPerfil,
  subirHistorial, subirHistorialXML, marcarOnboardingCompleto
} from '../api/onboarding'

export default function Onboarding() {
  const navigate                 = useNavigate()
  const { completarOnboarding }  = useAuth()

  const [paso, setPaso]          = useState(1)
  const [archivo, setArchivo]    = useState(null)
  const [datos, setDatos]        = useState(null)
  const [procesando, setProcesando] = useState(false)
  const [lecturaHoy, setLecturaHoy] = useState('')
  const [servicioId, setServicioId] = useState(null)
  const [resumenInicio, setResumenInicio] = useState(null)
  const [archivosHist, setArchivosHist]   = useState([])
  const [resumenHist, setResumenHist]     = useState(null)
  const [tipoHistorial, setTipoHistorial] = useState('xml') // 'xml' | 'pdf'
  const [error, setError]        = useState(null)

  const fileRef  = useRef()
  const fileRefH = useRef()

  const diasDesdeCorte = datos
    ? Math.floor((new Date() - new Date(datos.fecha_lectura_cfe + 'T12:00:00')) / 86400000)
    : 0

  const lecturaHoyInt = parseInt(lecturaHoy) || 0
  const consumoEst    = datos && lecturaHoyInt > datos.lectura_actual
    ? lecturaHoyInt - datos.lectura_actual : null
  const promedioEst   = consumoEst && diasDesdeCorte > 0
    ? (consumoEst / diasDesdeCorte).toFixed(1) : null

  // ── Paso 1 ────────────────────────────────────────────────────────────
  const handleArchivo = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setArchivo(file)
    setDatos(null)
    setError(null)
    setProcesando(true)
    try {
      const result = await extraerRecibo(file)
      setDatos(result.datos)
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo leer el archivo. Prueba con otro recibo.')
      setArchivo(null)
      if (fileRef.current) fileRef.current.value = ''
    } finally {
      setProcesando(false)
    }
  }

  const confirmarEsUltimo = () => setPaso(2)

  const noEsUltimo = () => {
    setError('Sube primero tu recibo más reciente. Necesitamos la última lectura de CFE para calcular tu consumo actual.')
    setArchivo(null)
    setDatos(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Paso 2 ────────────────────────────────────────────────────────────
  const handleIniciar = async () => {
    if (!lecturaHoy || lecturaHoyInt <= datos.lectura_actual) {
      setError(`La lectura debe ser mayor a ${datos.lectura_actual?.toLocaleString()} kWh`)
      return
    }
    setProcesando(true)
    setError(null)
    try {
      const result = await iniciarPerfil(archivo, lecturaHoy)
      setServicioId(result.servicio_id)
      setResumenInicio(result)
      setPaso(3)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el perfil')
    } finally {
      setProcesando(false)
    }
  }

  // ── Paso 3 ────────────────────────────────────────────────────────────
  const handleArchivosHist = (e) => setArchivosHist(Array.from(e.target.files))

  const handleSubirHistorial = async () => {
    if (archivosHist.length === 0) { await finalizar(); return }
    setProcesando(true)
    setError(null)
    try {
      const fn = tipoHistorial === 'xml' ? subirHistorialXML : subirHistorial
      const result = await fn(servicioId, archivosHist)
      await finalizar(result)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al procesar los recibos históricos')
    } finally {
      setProcesando(false)
    }
  }

  const finalizar = async (hist = null) => {
    try {
      await marcarOnboardingCompleto()
      completarOnboarding()
      if (hist) setResumenHist(hist)
      setPaso(4)
    } catch {
      setError('Error al finalizar la configuración')
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0a0f14', color: '#e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>

      {/* Barra de progreso */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '36px' }}>
        {[1, 2, 3, 4].map(p => (
          <div key={p} style={{
            height: '4px', borderRadius: '2px',
            width: p === paso ? '28px' : '12px',
            background: p <= paso ? '#1aff70' : '#1d2430',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>

      <div style={{ width: '100%', maxWidth: '500px' }}>

        {/* ── PASO 1: subir recibo más reciente ── */}
        {paso === 1 && (
          <div>
            <h2 style={h2}>⚡ Configura tu perfil</h2>
            <p style={subtitulo}>
              Sube tu recibo de CFE más reciente. Extraeremos los datos automáticamente con IA.
            </p>

            {error && <ErrorBox msg={error} onClose={() => setError(null)} />}

            {!datos && (
              <label style={{
                display: 'block', background: '#0f1923',
                border: `2px dashed ${procesando ? '#1aff70' : '#1d2430'}`,
                borderRadius: '12px', padding: '44px', textAlign: 'center',
                cursor: procesando ? 'default' : 'pointer', marginBottom: '8px',
              }}>
                {procesando ? (
                  <>
                    <div style={{ fontSize: '36px', marginBottom: '12px' }}>⏳</div>
                    <p style={{ color: '#1aff70', fontSize: '14px', margin: 0 }}>Analizando con Claude AI…</p>
                    <p style={{ color: '#3d5070', fontSize: '12px', margin: '4px 0 0' }}>puede tardar unos segundos</p>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '36px', marginBottom: '12px' }}>📄</div>
                    <p style={{ color: '#e2e8f0', fontSize: '14px', margin: '0 0 4px' }}>Selecciona tu recibo más reciente</p>
                    <p style={{ color: '#3d5070', fontSize: '12px', margin: 0 }}>PDF o imagen · hasta 20 MB</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".pdf,image/*" onChange={handleArchivo} style={{ display: 'none' }} disabled={procesando} />
              </label>
            )}

            {datos && (
              <div>
                <div style={card}>
                  <p style={seccion}>DATOS EXTRAÍDOS DEL RECIBO</p>
                  <Fila label="Período"          valor={`${datos.periodo_inicio}  →  ${datos.periodo_fin}`} />
                  <Fila label="Fecha de corte"   valor={datos.fecha_lectura_cfe} />
                  <Fila label="Lectura anterior" valor={`${datos.lectura_anterior?.toLocaleString()} kWh`} />
                  <Fila label="Lectura al corte" valor={`${datos.lectura_actual?.toLocaleString()} kWh`} />
                  <Fila label="Consumo bimestral" valor={`${(datos.lectura_actual - datos.lectura_anterior).toLocaleString()} kWh`} />
                  <Fila label="Total pagado"     valor={`$${Number(datos.total).toFixed(2)}`} color="#1aff70" />
                  {datos.confianza < 85 && (
                    <p style={{ color: '#f59e0b', fontSize: '12px', margin: '10px 0 0' }}>
                      ⚠️ Confianza de extracción: {datos.confianza}% — revisa que los datos sean correctos.
                    </p>
                  )}
                </div>

                <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', margin: '20px 0 14px' }}>
                  ¿Es este tu recibo <strong style={{ color: '#1aff70' }}>más reciente</strong>?
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button onClick={noEsUltimo}       style={btnSecundario}>No, subir otro</button>
                  <button onClick={confirmarEsUltimo} style={btnPrimario}>Sí, es el último ›</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PASO 2: lectura de hoy ── */}
        {paso === 2 && datos && (
          <div>
            <h2 style={h2}>📍 Lectura de hoy</h2>

            {diasDesdeCorte > 60 && (
              <div style={{ background: '#451a03', border: '1px solid #92400e', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#fde68a', lineHeight: 1.5 }}>
                ⚠️ Han pasado <strong>{diasDesdeCorte} días</strong> desde tu último corte ({datos.fecha_lectura_cfe}).
                La lectura de hoy es esencial para estimar tu consumo actual.
              </div>
            )}

            {diasDesdeCorte <= 60 && (
              <p style={subtitulo}>
                Tu último corte fue el <strong style={{ color: '#94a3b8' }}>{datos.fecha_lectura_cfe}</strong> (hace {diasDesdeCorte} días).
                Ingresa la lectura actual de tu medidor para calcular el consumo acumulado.
              </p>
            )}

            {error && <ErrorBox msg={error} onClose={() => setError(null)} />}

            <div style={card}>
              <label style={{ display: 'block', color: '#64748b', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px' }}>
                LECTURA ACTUAL DEL MEDIDOR (kWh)
              </label>
              <input
                type="number"
                value={lecturaHoy}
                onChange={e => setLecturaHoy(e.target.value)}
                placeholder={`más de ${datos.lectura_actual?.toLocaleString()}`}
                autoFocus
                style={{ ...inputBase, fontSize: '26px', textAlign: 'center', fontWeight: 'bold', padding: '12px' }}
              />
              {promedioEst && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' }}>
                  <MiniStat label="Consumo desde corte" valor={`${consumoEst.toLocaleString()} kWh`} color="#38bdf8" />
                  <MiniStat label="Promedio diario"     valor={`${promedioEst} kWh/día`}             color="#1aff70" />
                </div>
              )}
            </div>

            <button
              onClick={handleIniciar}
              disabled={procesando || !lecturaHoy || lecturaHoyInt <= datos.lectura_actual}
              style={{
                ...btnPrimario, width: '100%', marginTop: '4px', padding: '12px',
                opacity: (procesando || !lecturaHoy || lecturaHoyInt <= datos.lectura_actual) ? 0.5 : 1,
                cursor: (procesando || !lecturaHoy || lecturaHoyInt <= datos.lectura_actual) ? 'not-allowed' : 'pointer',
              }}
            >
              {procesando ? 'Creando perfil…' : 'Continuar ›'}
            </button>
          </div>
        )}

        {/* ── PASO 3: historial ── */}
        {paso === 3 && (
          <div>
            <h2 style={h2}>📚 Historial (opcional)</h2>
            <p style={subtitulo}>
              Sube tus recibos anteriores para habilitar tendencias y proyecciones.
              Puedes subir varios a la vez — los ordenamos automáticamente.
            </p>

            {error && <ErrorBox msg={error} onClose={() => setError(null)} />}

            {/* Toggle XML / PDF */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                onClick={() => { setTipoHistorial('xml'); setArchivosHist([]); if (fileRefH.current) fileRefH.current.value = '' }}
                style={{
                  flex: 1, padding: '9px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
                  cursor: 'pointer', border: '1px solid',
                  background: tipoHistorial === 'xml' ? '#0a2a15' : 'transparent',
                  borderColor: tipoHistorial === 'xml' ? '#1aff70' : '#1d2430',
                  color: tipoHistorial === 'xml' ? '#1aff70' : '#3d5070',
                }}
              >
                📋 XML / CFDI
                <span style={{ display: 'block', fontSize: '10px', fontWeight: 'normal', marginTop: '2px', color: tipoHistorial === 'xml' ? '#1aff70' : '#3d5070' }}>
                  Recomendado · 100% exacto
                </span>
              </button>
              <button
                onClick={() => { setTipoHistorial('pdf'); setArchivosHist([]); if (fileRefH.current) fileRefH.current.value = '' }}
                style={{
                  flex: 1, padding: '9px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
                  cursor: 'pointer', border: '1px solid',
                  background: tipoHistorial === 'pdf' ? '#0a2a15' : 'transparent',
                  borderColor: tipoHistorial === 'pdf' ? '#1aff70' : '#1d2430',
                  color: tipoHistorial === 'pdf' ? '#1aff70' : '#3d5070',
                }}
              >
                📄 PDF / Imagen
                <span style={{ display: 'block', fontSize: '10px', fontWeight: 'normal', marginTop: '2px', color: tipoHistorial === 'pdf' ? '#1aff70' : '#3d5070' }}>
                  Extracción con Claude AI
                </span>
              </button>
            </div>

            <label style={{
              display: 'block', background: '#0f1923',
              border: `2px dashed ${archivosHist.length > 0 ? '#1aff70' : '#1d2430'}`,
              borderRadius: '12px', padding: '32px', textAlign: 'center',
              cursor: procesando ? 'default' : 'pointer', marginBottom: '16px',
            }}>
              {procesando ? (
                <>
                  <div style={{ fontSize: '28px', marginBottom: '10px' }}>⏳</div>
                  <p style={{ color: '#1aff70', fontSize: '14px', margin: 0 }}>Procesando {archivosHist.length} recibos…</p>
                  <p style={{ color: '#3d5070', fontSize: '12px', margin: '4px 0 0' }}>
                    {tipoHistorial === 'xml' ? 'parseando CFDIs…' : 'analizando con Claude AI…'}
                  </p>
                </>
              ) : archivosHist.length > 0 ? (
                <>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>📑</div>
                  <p style={{ color: '#1aff70', fontSize: '14px', margin: '0 0 4px' }}>
                    {archivosHist.length} archivo{archivosHist.length !== 1 ? 's' : ''} seleccionado{archivosHist.length !== 1 ? 's' : ''}
                  </p>
                  <p style={{ color: '#3d5070', fontSize: '12px', margin: 0 }}>Toca para cambiar</p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>{tipoHistorial === 'xml' ? '📋' : '📂'}</div>
                  <p style={{ color: '#e2e8f0', fontSize: '14px', margin: '0 0 4px' }}>
                    {tipoHistorial === 'xml' ? 'Seleccionar archivos XML (CFDI)' : 'Seleccionar recibos PDF'}
                  </p>
                  <p style={{ color: '#3d5070', fontSize: '12px', margin: 0 }}>
                    {tipoHistorial === 'xml' ? 'Descárgalos desde Mi CFE · varios a la vez' : 'Varios archivos a la vez · PDF o imagen'}
                  </p>
                </>
              )}
              <input
                ref={fileRefH}
                type="file"
                accept={tipoHistorial === 'xml' ? '.xml' : '.pdf,image/*'}
                multiple
                onChange={handleArchivosHist}
                style={{ display: 'none' }}
                disabled={procesando}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button onClick={() => finalizar()} style={btnSecundario} disabled={procesando}>
                Omitir por ahora
              </button>
              <button onClick={handleSubirHistorial} style={btnPrimario} disabled={procesando}>
                {procesando ? 'Procesando…'
                  : archivosHist.length > 0
                    ? `Subir ${archivosHist.length} ${tipoHistorial === 'xml' ? 'XML' : 'recibo'}${archivosHist.length !== 1 ? 's' : ''}`
                    : 'Continuar ›'}
              </button>
            </div>
          </div>
        )}

        {/* ── PASO 4: resumen final ── */}
        {paso === 4 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ ...h2, textAlign: 'center' }}>¡Perfil listo!</h2>
            <p style={{ ...subtitulo, textAlign: 'center' }}>Tu cuenta está configurada. Aquí está lo que cargamos:</p>

            <div style={{ ...card, textAlign: 'left', marginBottom: '16px' }}>
              <Fila label="Último corte CFE"  valor={resumenInicio?.recibo?.fecha_lectura_cfe || '—'} />
              <Fila label="Días desde corte"  valor={`${resumenInicio?.dias_desde_corte || 0} días`} />
              <Fila label="Consumo estimado"  valor={`${resumenInicio?.consumo_desde_corte?.toLocaleString() || 0} kWh`} />
              <Fila label="Promedio diario"   valor={`${resumenInicio?.promedio_diario || 0} kWh/día`} color="#1aff70" />
              {resumenHist && resumenHist.importados > 0 && (
                <Fila label="Recibos históricos" valor={`${resumenHist.importados} importados`} color="#38bdf8" />
              )}
            </div>

            {(!resumenHist || resumenHist.importados < 1) && (
              <div style={{ background: '#1e1a00', border: '1px solid #ca8a04', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '12px', color: '#fde68a', textAlign: 'left', lineHeight: 1.6 }}>
                <strong>ℹ️ Funcionalidades limitadas por ahora</strong><br />
                Con un solo recibo, las proyecciones de consumo y el análisis de tendencias no están disponibles.
                Puedes agregar más recibos desde el dashboard en cualquier momento.
              </div>
            )}

            <button onClick={() => navigate('/')} style={{ ...btnPrimario, width: '100%', padding: '14px', fontSize: '15px' }}>
              Ir al Dashboard →
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────

function ErrorBox({ msg, onClose }) {
  return (
    <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0 }}>❌</span>
      <p style={{ color: '#fca5a5', fontSize: '13px', margin: 0, flex: 1, lineHeight: 1.5 }}>{msg}</p>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
    </div>
  )
}

function Fila({ label, valor, color = '#e2e8f0' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #0a0f14' }}>
      <span style={{ color: '#3d5070', fontSize: '13px' }}>{label}</span>
      <span style={{ color, fontSize: '13px', fontWeight: 'bold' }}>{valor}</span>
    </div>
  )
}

function MiniStat({ label, valor, color }) {
  return (
    <div style={{ background: '#1d2430', borderRadius: '8px', padding: '12px' }}>
      <p style={{ color: '#3d5070', fontSize: '11px', margin: '0 0 4px', letterSpacing: '0.5px' }}>{label.toUpperCase()}</p>
      <p style={{ color, fontSize: '16px', fontWeight: 'bold', margin: 0 }}>{valor}</p>
    </div>
  )
}

// ── Estilos compartidos ───────────────────────────────────────────────────
const h2          = { color: '#1aff70', margin: '0 0 8px', fontSize: '20px', fontWeight: 'bold' }
const subtitulo   = { color: '#3d5070', fontSize: '13px', margin: '0 0 20px', lineHeight: 1.6 }
const card        = { background: '#0f1923', border: '1px solid #1d2430', borderRadius: '12px', padding: '20px', marginBottom: '16px' }
const seccion     = { color: '#64748b', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }
const inputBase   = { display: 'block', width: '100%', background: '#1d2430', border: '1px solid #2d3748', borderRadius: '6px', padding: '10px 12px', color: '#e2e8f0', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }
const btnPrimario   = { background: '#1aff70', color: '#0a0f14', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }
const btnSecundario = { background: 'none', color: '#64748b', border: '1px solid #1d2430', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' }
