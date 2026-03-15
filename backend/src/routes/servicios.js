const express  = require('express')
const router   = express.Router()
const pool     = require('../db/pool')
const { obtenerCicloActivo, evaluarAlertaCiclo } = require('../services/cicloService')
const { auth } = require('../middleware/auth')

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM servicios WHERE usuario_id=$1 AND activo=true ORDER BY alias`,
      [req.usuario.id]
    )
    const resultado = await Promise.all(rows.map(async s => {
      const ciclo  = await obtenerCicloActivo(s.id)
      const alerta = evaluarAlertaCiclo(ciclo)
      return { ...s, alerta_ciclo: alerta }
    }))
    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
