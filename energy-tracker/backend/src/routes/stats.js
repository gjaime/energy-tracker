const express  = require('express')
const router   = express.Router()
const pool     = require('../db/pool')
const { obtenerCicloActivo, evaluarAlertaCiclo } = require('../services/cicloService')
const { auth } = require('../middleware/auth')

router.get('/', auth, async (req, res) => {
  const { servicio_id } = req.query
  if (!servicio_id) return res.status(400).json({ error: 'servicio_id requerido' })

  try {
    const ciclo = await obtenerCicloActivo(servicio_id)
    if (!ciclo) return res.json({ mensaje: 'No hay ciclo activo' })

    const { rows: eventos } = await pool.query(
      `SELECT fecha, lectura_valor, consumo_dia FROM eventos
       WHERE ciclo_id=$1 AND tipo='lectura_diaria' AND consumo_dia > 0
       ORDER BY fecha DESC`,
      [ciclo.id]
    )

    const { rows: ultima } = await pool.query(
      `SELECT lectura_valor, fecha FROM eventos WHERE ciclo_id=$1
       ORDER BY fecha DESC LIMIT 1`, [ciclo.id]
    )

    const totalKwh     = eventos.reduce((s, e) => s + (e.consumo_dia || 0), 0)
    const promedioReal = eventos.length ? (totalKwh / eventos.length).toFixed(1) : null
    const diasCiclo    = Math.floor((new Date() - new Date(ciclo.fecha_inicio)) / 86400000)
    const alerta       = evaluarAlertaCiclo(ciclo)

    res.json({
      ciclo_id:        ciclo.id,
      fecha_inicio:    ciclo.fecha_inicio,
      lectura_inicial: ciclo.lectura_inicial,
      ultima_lectura:  ultima[0]?.lectura_valor,
      fecha_ultima:    ultima[0]?.fecha,
      acumulado_kwh:   totalKwh,
      promedio_dia:    promedioReal,
      dias_ciclo:      diasCiclo,
      num_lecturas:    eventos.length,
      alerta,
    })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
