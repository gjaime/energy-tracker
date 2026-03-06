const express = require('express')
const router  = express.Router()
const pool    = require('../db/pool')
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

router.post('/', auth, async (req, res) => {
  const { alias, numero_servicio, numero_medidor, tarifa_tipo = '1', direccion, ciudad, estado_rep, notas } = req.body
  if (!alias || !numero_servicio) return res.status(400).json({ error: 'alias y numero_servicio son requeridos' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO servicios (usuario_id, alias, numero_servicio, numero_medidor, tarifa_tipo, direccion, ciudad, estado_rep, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.usuario.id, alias, numero_servicio, numero_medidor, tarifa_tipo, direccion, ciudad, estado_rep, notas]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Número de servicio ya registrado' })
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
