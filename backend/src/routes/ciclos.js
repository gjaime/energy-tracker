const express  = require('express')
const router   = express.Router()
const pool     = require('../db/pool')
const { auth } = require('../middleware/auth')

// GET /api/ciclos?servicio_id=...
router.get('/', auth, async (req, res) => {
  const { servicio_id } = req.query
  if (!servicio_id) return res.status(400).json({ error: 'servicio_id requerido' })

  try {
    const { rows } = await pool.query(
      `SELECT c.*, r.total as costo_total, r.fecha_emision
       FROM ciclos c LEFT JOIN recibos r ON r.id = c.recibo_id
       WHERE c.servicio_id=$1 ORDER BY c.fecha_inicio DESC`,
      [servicio_id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
