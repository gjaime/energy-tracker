const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcryptjs')
const pool     = require('../db/pool')
const { auth } = require('../middleware/auth')

function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin')
    return res.status(403).json({ error: 'Acceso restringido a administradores' })
  next()
}

router.get('/perfil', auth, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre_usuario, rol, fecha_registro, ultimo_acceso
       FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    )
    res.json(rows[0])
  } catch {
    res.status(500).json({ error: 'Error interno' })
  }
})

router.put('/pin', auth, soloAdmin, async (req, res) => {
  const { pin_actual, pin_nuevo } = req.body
  if (!pin_actual || !pin_nuevo)
    return res.status(400).json({ error: 'pin_actual y pin_nuevo son requeridos' })
  if (!/^\d{4}$/.test(pin_nuevo))
    return res.status(400).json({ error: 'El PIN nuevo debe ser exactamente 4 dígitos' })

  try {
    const { rows } = await pool.query(
      `SELECT pin_hash FROM usuarios WHERE id = $1`, [req.usuario.id]
    )
    const valido = await bcrypt.compare(pin_actual, rows[0].pin_hash)
    if (!valido) return res.status(401).json({ error: 'El PIN actual es incorrecto' })

    const nuevo_hash = await bcrypt.hash(pin_nuevo, 10)
    await pool.query(
      `UPDATE usuarios SET pin_hash = $1 WHERE id = $2`,
      [nuevo_hash, req.usuario.id]
    )
    res.json({ ok: true, mensaje: 'PIN actualizado correctamente' })
  } catch {
    res.status(500).json({ error: 'Error interno' })
  }
})

router.get('/sistema', auth, soloAdmin, async (req, res) => {
  try {
    const [usuarios, servicios, ciclos, eventos, recibos] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM usuarios`),
      pool.query(`SELECT COUNT(*) FROM servicios WHERE activo = true`),
      pool.query(`SELECT COUNT(*) FROM ciclos WHERE estado = 'abierto'`),
      pool.query(`SELECT COUNT(*) FROM eventos`),
      pool.query(`SELECT COUNT(*) FROM recibos`),
    ])

    const { rows: ultima } = await pool.query(
      `SELECT fecha, lectura_valor, fuente FROM eventos ORDER BY created_at DESC LIMIT 1`
    )

    res.json({
      usuarios:          parseInt(usuarios.rows[0].count),
      servicios_activos: parseInt(servicios.rows[0].count),
      ciclos_abiertos:   parseInt(ciclos.rows[0].count),
      total_eventos:     parseInt(eventos.rows[0].count),
      total_recibos:     parseInt(recibos.rows[0].count),
      ultima_lectura:    ultima.rows[0] || null,
      timestamp:         new Date().toISOString(),
    })
  } catch {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
