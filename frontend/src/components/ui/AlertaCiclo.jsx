export function AlertaCiclo({ alerta }) {
  if (!alerta) return null

  const estilos = {
    advertencia: { bg: '#7c2d12', borde: '#ea580c', icono: '⚠️' },
    critico:     { bg: '#450a0a', borde: '#dc2626', icono: '🚨' },
  }
  const s = estilos[alerta.nivel] || estilos.advertencia

  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.borde}`,
      borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
      display: 'flex', alignItems: 'flex-start', gap: '10px',
    }}>
      <span style={{ fontSize: '18px', flexShrink: 0 }}>{s.icono}</span>
      <p style={{ margin: 0, color: '#fef2f2', fontSize: '13px', lineHeight: '1.5' }}>
        <strong>Las estimaciones pueden no ser precisas</strong> — este ciclo lleva{' '}
        <strong>{alerta.dias} días</strong> y los ciclos suelen ser de 60 días.{' '}
        Carga el último recibo para actualizar los datos.
      </p>
    </div>
  )
}
