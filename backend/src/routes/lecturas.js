/**
 * POST /api/lecturas  ← endpoint principal que llama n8n desde Telegram
 * Soporta: lectura_diaria, cierre_ciclo, evento_especial
 * Soporta: backdating (fecha en el body)
 * Valida: anomalías (>3x promedio) → tabla pendientes
 */
const express = require('express')
const router  = express.Router()
const pool    = require('../db/pool')
const { obtenerCicloActivo, calcularPromedioDiario, calcularConsumoDia } = require('../services/cicloService')
const { auth } = require('../middleware/auth')

// ── POST /api/lecturas ────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { servicio_id, lectura_valor, tipo = 'lectura_diaria', fecha, notas = '', telegram_id } = req.body

  if (!servicio_id || lectura_valor == null)
    return res.status(400).json({ error: 'servicio_id y lectura_valor son requeridos' })

  const lecturaInt = parseInt(lectura_valor)
  if (isNaN(lecturaInt) || lecturaInt < 0)
    return res.status(400).json({ error: 'lectura_valor debe ser un entero positivo' })

  // Fecha: usar la del body (backdating) o hoy en CST
  const fechaRegistro = fecha || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })

  // No permitir fechas futuras
  const hoyCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  if (fechaRegistro > hoyCST)
    return res.status(400).json({ error: 'No se permiten lecturas con fecha futura' })

  const esBacking = !!fecha

  try {
    // Verificar que el servicio pertenece al usuario
    const { rows: servicios } = await pool.query(
      `SELECT * FROM servicios WHERE id=$1 AND usuario_id=$2 AND activo=true`,
      [servicio_id, req.usuario.id]
    )
    if (!servicios[0]) return res.status(404).json({ error: 'Servicio no encontrado' })

    const ciclo = await obtenerCicloActivo(servicio_id)
    if (!ciclo) return res.status(400).json({ error: 'No existe ciclo activo para este servicio' })

    // Obtener última lectura para validación
    const { rows: ultimas } = await pool.query(
      `SELECT lectura_valor FROM eventos
       WHERE ciclo_id=$1 AND tipo IN ('lectura_diaria','apertura_ciclo','cierre_ciclo')
       ORDER BY fecha DESC, created_at DESC LIMIT 1`,
      [ciclo.id]
    )
    const ultimaLect = ultimas[0]?.lectura_valor ?? ciclo.lectura_inicial

    // Lectura no puede ser menor o igual a la anterior (excepto eventos especiales)
    if (tipo !== 'evento_especial' && lecturaInt <= ultimaLect)
      return res.status(400).json({ error: `La lectura (${lecturaInt}) debe ser mayor a la anterior (${ultimaLect})` })

    const consumoDia = lecturaInt - ultimaLect

    // ── Validación de anomalía: >3x promedio diario real ─────────────────
    const promedio = await calcularPromedioDiario(ciclo.id)
    if (promedio && consumoDia > promedio * 3 && tipo === 'lectura_diaria') {
      // Guardar en pendientes, no en eventos
      const { rows: pend } = await pool.query(
        `INSERT INTO pendientes (servicio_id, ciclo_id, telegram_id, fecha, lectura_valor, consumo_dia, promedio_real, tipo, notas, es_backdating)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [servicio_id, ciclo.id, telegram_id || null, fechaRegistro, lecturaInt, consumoDia, promedio, tipo, notas, esBacking]
      )
      return res.status(202).json({
        status: 'pendiente',
        pendiente_id: pend[0].id,
        mensaje: `⚠️ Consumo inusual: ${consumoDia} kWh (promedio: ${promedio.toFixed(1)} kWh/día). Usa /confirmar ${pend[0].id.slice(0,8)} para confirmar o /cancelar para descartar.`,
        expira_en: '10 minutos'
      })
    }

    // ── Insertar lectura normal ───────────────────────────────────────────
    const notaFinal = esBacking ? `${notas} [backdated]`.trim() : notas
    const { rows: nuevo } = await pool.query(
      `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, consumo_dia, tipo, fuente, es_backdating, notas)
       VALUES ($1,$2,$3,$4,$5,$6,'n8n',$7,$8) RETURNING *`,
      [ciclo.id, servicio_id, fechaRegistro, lecturaInt, consumoDia, tipo, esBacking, notaFinal]
    )

    // Calcular costo acumulado estimado
    const { rows: stats } = await pool.query(
      `SELECT SUM(consumo_dia) as total_kwh FROM eventos
       WHERE ciclo_id=$1 AND tipo='lectura_diaria' AND consumo_dia > 0`,
      [ciclo.id]
    )
    const acumKwh = parseInt(stats[0]?.total_kwh || 0)

    return res.status(201).json({
      status: 'ok',
      evento: nuevo[0],
      acumulado_kwh: acumKwh,
      promedio_dia: promedio ? promedio.toFixed(1) : null,
      mensaje: `✅ Lectura registrada · ${lecturaInt.toLocaleString()} kWh · +${consumoDia} kWh hoy · ${acumKwh} kWh acumulados`
    })

  } catch (err) {
    console.error('POST /api/lecturas error:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ── GET /api/lecturas — histórico del ciclo activo ────────────────────────
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

// ── POST /api/confirmar ───────────────────────────────────────────────────
router.post('/confirmar', auth, async (req, res) => {
  const { pendiente_id } = req.body
  if (!pendiente_id) return res.status(400).json({ error: 'pendiente_id requerido' })

  try {
    // Buscar pendiente (puede ser prefijo del UUID)
    const { rows } = await pool.query(
      `SELECT * FROM pendientes WHERE id::text LIKE $1 AND estado='esperando' AND expira_at > NOW()`,
      [`${pendiente_id}%`]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Pendiente no encontrado o expirado' })

    const p = rows[0]

    // Confirmar: insertar en eventos
    const { rows: nuevo } = await pool.query(
      `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, consumo_dia, tipo, fuente, es_backdating, notas)
       VALUES ($1,$2,$3,$4,$5,$6,'n8n',$7,$8) RETURNING *`,
      [p.ciclo_id, p.servicio_id, p.fecha, p.lectura_valor, p.consumo_dia, p.tipo, p.es_backdating, p.notas]
    )

    // Marcar pendiente como confirmado
    await pool.query(`UPDATE pendientes SET estado='confirmado' WHERE id=$1`, [p.id])

    res.json({ status: 'ok', evento: nuevo[0], mensaje: `✅ Lectura confirmada · ${p.lectura_valor.toLocaleString()} kWh` })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

// ── POST /api/cancelar ────────────────────────────────────────────────────
router.post('/cancelar', auth, async (req, res) => {
  const { pendiente_id } = req.body
  if (!pendiente_id) return res.status(400).json({ error: 'pendiente_id requerido' })

  try {
    const { rows } = await pool.query(
      `UPDATE pendientes SET estado='cancelado' WHERE id::text LIKE $1 AND estado='esperando' RETURNING id`,
      [`${pendiente_id}%`]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Pendiente no encontrado' })

    res.json({ status: 'ok', mensaje: '❌ Lectura cancelada' })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
