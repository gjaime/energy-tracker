const express = require('express')
const router  = express.Router()
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const pool    = require('../db/pool')

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { nombre_usuario, pin } = req.body

  if (!nombre_usuario || !pin)
    return res.status(400).json({ error: 'nombre_usuario y pin son requeridos' })
  if (!/^[a-zA-Z0-9]{1,10}$/.test(nombre_usuario))
    return res.status(400).json({ error: 'El usuario debe tener entre 1 y 10 caracteres alfanuméricos' })
  if (!/^\d{4}$/.test(pin))
    return res.status(400).json({ error: 'El PIN debe ser exactamente 4 dígitos' })

  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM usuarios WHERE nombre_usuario=$1`, [nombre_usuario.toLowerCase()]
    )
    if (existing[0])
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' })

    const pin_hash = await bcrypt.hash(pin, 10)
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre_usuario, pin_hash, rol)
       VALUES ($1, $2, 'usuario')
       RETURNING id, nombre_usuario, rol, onboarding_completado`,
      [nombre_usuario.toLowerCase(), pin_hash]
    )
    const usuario = rows[0]
    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol },
      process.env.SECRET_KEY,
      { expiresIn: '7d' }
    )
    res.status(201).json({
      access_token:          token,
      usuario_id:            usuario.id,
      nombre_usuario:        usuario.nombre_usuario,
      rol:                   usuario.rol,
      onboarding_completado: usuario.onboarding_completado,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error interno' })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { nombre_usuario, pin } = req.body
  if (!nombre_usuario || !pin)
    return res.status(400).json({ error: 'nombre_usuario y pin son requeridos' })

  try {
    const { rows } = await pool.query(
      `SELECT * FROM usuarios WHERE nombre_usuario=$1 AND activo=true`,
      [nombre_usuario.toLowerCase()]
    )
    const usuario = rows[0]
    if (!usuario || !(await bcrypt.compare(pin, usuario.pin_hash)))
      return res.status(401).json({ error: 'Usuario o PIN incorrecto' })

    await pool.query(`UPDATE usuarios SET ultimo_acceso=NOW() WHERE id=$1`, [usuario.id])

    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol },
      process.env.SECRET_KEY,
      { expiresIn: '7d' }
    )
    res.json({
      access_token:          token,
      usuario_id:            usuario.id,
      nombre_usuario:        usuario.nombre_usuario,
      rol:                   usuario.rol,
      onboarding_completado: usuario.onboarding_completado,
    })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
