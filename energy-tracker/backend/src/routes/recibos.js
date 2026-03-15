const express  = require('express')
const router   = express.Router()
const pool     = require('../db/pool')
const { auth } = require('../middleware/auth')

// GET /api/recibos?servicio_id=...
router.get('/', auth, async (req, res) => {
  const { servicio_id } = req.query
  if (!servicio_id) return res.status(400).json({ error: 'servicio_id requerido' })

  try {
    const { rows: svc } = await pool.query(
      `SELECT id FROM servicios WHERE id=$1 AND usuario_id=$2 AND activo=true`,
      [servicio_id, req.usuario.id]
    )
    if (!svc[0]) return res.status(404).json({ error: 'Servicio no encontrado' })

    const { rows } = await pool.query(
      `SELECT * FROM recibos WHERE servicio_id=$1 ORDER BY fecha_lectura_cfe DESC`,
      [servicio_id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
