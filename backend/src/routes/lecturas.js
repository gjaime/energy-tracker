const express  = require('express')
const router   = express.Router()
const pool     = require('../db/pool')
const {
  obtenerCicloActivo,
  calcularPromedioDiario,
  insertarLecturaConInterpolacion,
} = require('../services/cicloService')
const { auth } = require('../middleware/auth')

// POST /api/lecturas
router.post('/', auth, async (req, res) => {
  const { servicio_id, lectura_valor, tipo = 'lectura_diaria', fecha, notas = '' } = req.body

  if (!servicio_id || lectura_valor == null)
    return res.status(400).json({ error: 'servicio_id y lectura_valor son requeridos' })

  const lecturaInt = parseInt(lectura_valor)
  if (isNaN(lecturaInt) || lecturaInt < 0)
    return res.status(400).json({ error: 'lectura_valor debe ser un entero positivo' })

  const fechaRegistro = fecha || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const hoyCST        = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  if (fechaRegistro > hoyCST)
    return res.status(400).json({ error: 'No se permiten lecturas con fecha futura' })

  const esBacking = !!fecha
  const client    = await pool.connect()

  try {
    await client.query('BEGIN')

    const { rows: servicios } = await client.query(
      `SELECT * FROM servicios WHERE id=$1 AND usuario_id=$2 AND activo=true`,
      [servicio_id, req.usuario.id]
    )
    if (!servicios[0]) return res.status(404).json({ error: 'Servicio no encontrado' })

    const ciclo = await obtenerCicloActivo(servicio_id)
    if (!ciclo) return res.status(400).json({ error: 'No existe ciclo activo para este servicio' })

    // Si no hay eventos, crear apertura automáticamente como punto de partida
    const { rows: countEvs } = await client.query(
      `SELECT COUNT(*) as n FROM eventos WHERE ciclo_id=$1`, [ciclo.id]
    )
    if (parseInt(countEvs[0].n) === 0) {
      await client.query(
        `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, tipo, fuente, notas)
         VALUES ($1,$2,$3,$4,'apertura_ciclo','sistema','Apertura automática del ciclo')`,
        [ciclo.id, servicio_id, ciclo.fecha_inicio, ciclo.lectura_inicial]
      )
    }

    // Validar que la lectura sea mayor a la anterior (excepto eventos especiales)
    const { rows: ultimas } = await client.query(
      `SELECT lectura_valor FROM eventos
       WHERE ciclo_id=$1 AND tipo IN ('lectura_diaria','apertura_ciclo','cierre_ciclo')
         AND fuente != 'sistema'
       ORDER BY fecha DESC, created_at DESC LIMIT 1`,
      [ciclo.id]
    )
    const ultimaLect = ultimas[0]?.lectura_valor ?? ciclo.lectura_inicial

    if (tipo !== 'evento_especial' && lecturaInt <= ultimaLect)
      return res.status(400).json({
        error: `La lectura (${lecturaInt}) debe ser mayor a la anterior (${ultimaLect})`
      })

    const notaFinal = esBacking ? `${notas} [backdated]`.trim() : notas

    // Insertar con interpolación automática de gaps
    const insertados = await insertarLecturaConInterpolacion(client, {
      cicloId:       ciclo.id,
      servicioId:    servicio_id,
      fechaRegistro,
      lecturaInt,
      tipo,
      fuente:        'usuario',
      esBacking,
      notaFinal,
    })

    const { rows: stats } = await client.query(
      `SELECT SUM(consumo_dia) as total_kwh FROM eventos
       WHERE ciclo_id=$1 AND tipo='lectura_diaria' AND consumo_dia > 0`,
      [ciclo.id]
    )

    const promedio = await calcularPromedioDiario(ciclo.id)

    await client.query('COMMIT')

    const nuevo     = insertados[insertados.length - 1]
    const estimados = insertados.slice(0, -1)

    res.status(201).json({
      status:           'ok',
      evento:           nuevo,
      estimados_creados: estimados.length,
      acumulado_kwh:    parseInt(stats[0]?.total_kwh || 0),
      promedio_dia:     promedio ? promedio.toFixed(1) : null,
    })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('POST /api/lecturas error:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  } finally {
    client.release()
  }
})

// GET /api/lecturas — todos los eventos del ciclo activo
router.get('/', auth, async (req, res) => {
  const { servicio_id } = req.query
  if (!servicio_id) return res.status(400).json({ error: 'servicio_id requerido' })

  try {
    const ciclo = await obtenerCicloActivo(servicio_id)
    if (!ciclo) return res.json([])

    const { rows } = await pool.query(
      `SELECT * FROM eventos WHERE ciclo_id=$1 ORDER BY fecha DESC, created_at DESC`,
      [ciclo.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
