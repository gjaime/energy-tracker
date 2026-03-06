const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const pool     = require('../db/pool')

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' })

  try {
    const { rows } = await pool.query(`SELECT * FROM usuarios WHERE email=$1 AND activo=true`, [email])
    const usuario = rows[0]
    if (!usuario || !(await bcrypt.compare(password, usuario.password_hash)))
      return res.status(401).json({ error: 'Credenciales incorrectas' })

    await pool.query(`UPDATE usuarios SET ultimo_acceso=NOW() WHERE id=$1`, [usuario.id])

    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol },
      process.env.SECRET_KEY,
      { expiresIn: '7d' }
    )
    res.json({ access_token: token, token_type: 'bearer', usuario_id: usuario.id, nombre: usuario.nombre, rol: usuario.rol })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
