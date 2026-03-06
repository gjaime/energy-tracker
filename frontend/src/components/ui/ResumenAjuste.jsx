/**
 * Modal/panel que muestra el resumen del ajuste retroactivo
 * después de importar un recibo.
 */
export function ResumenAjuste({ resultado, onCerrar }) {
  if (!resultado) return null

  const { ajuste_ciclos, confianza_extraccion, total, requiere_revision } = resultado

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#0f1923',
        border: '1px solid #1aff70',
        borderRadius: '12px',
        padding: '28px',
        maxWidth: '480px',
        width: '90%',
      }}>
        <h3 style={{ color: '#1aff70', margin: '0 0 16px', fontSize: '16px' }}>
          ✅ Recibo importado correctamente
        </h3>

        {/* Datos extraídos */}
        <div style={{ marginBottom: '16px' }}>
          <Row label="Total del recibo" valor={`$${Number(total).toFixed(2)}`} />
          <Row
            label="Confianza de extracción"
            valor={`${confianza_extraccion}%`}
            color={confianza_extraccion >= 85 ? '#1aff70' : '#f59e0b'}
          />
        </div>

        {/* Ajuste de ciclos */}
        {ajuste_ciclos && (
          <div style={{
            background: '#1d2430',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
          }}>
            <p style={{ color: '#94a3b8', fontSize: '11px', margin: '0 0 8px', letterSpacing: '1px' }}>
              AJUSTE DE CICLOS
            </p>
            <Row label="Fecha de corte CFE" valor={ajuste_ciclos.fecha_corte} />
            <Row label="Días desde el corte" valor={ajuste_ciclos.dias_desde_corte} />
            <Row label="Lecturas reasignadas" valor={ajuste_ciclos.eventos_reasignados} />
            {ajuste_ciclos.ciclos_vacios_creados > 0 && (
              <Row
                label="Ciclos vacíos creados"
                valor={ajuste_ciclos.ciclos_vacios_creados}
                color="#f59e0b"
              />
            )}
          </div>
        )}

        {/* Alertas del proceso */}
        {ajuste_ciclos?.alertas?.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            {ajuste_ciclos.alertas.map((a, i) => (
              <div key={i} style={{
                background: '#451a03',
                border: '1px solid #92400e',
                borderRadius: '6px',
                padding: '8px 12px',
                marginBottom: '6px',
                fontSize: '12px',
                color: '#fde68a',
              }}>
                ⚠️ {a}
              </div>
            ))}
          </div>
        )}

        {/* Aviso de revisión */}
        {requiere_revision && (
          <div style={{
            background: '#1e1a00',
            border: '1px solid #ca8a04',
            borderRadius: '6px',
            padding: '10px 12px',
            marginBottom: '16px',
            fontSize: '12px',
            color: '#fde68a',
          }}>
            ⚠️ La confianza de extracción es menor al 85%. Te recomendamos revisar y corregir los datos manualmente.
          </div>
        )}

        <button
          onClick={onCerrar}
          style={{
            width: '100%',
            background: '#1aff70',
            color: '#0a0f14',
            border: 'none',
            borderRadius: '8px',
            padding: '10px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Entendido
        </button>
      </div>
    </div>
  )
}

function Row({ label, valor, color = '#e2e8f0' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
      <span style={{ color: '#64748b', fontSize: '13px' }}>{label}</span>
      <span style={{ color, fontSize: '13px', fontWeight: 'bold' }}>{valor}</span>
    </div>
  )
}
