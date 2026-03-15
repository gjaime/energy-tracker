const jwt  = require('jsonwebtoken')
const pool = require('../db/pool')

async function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token requerido' })

  try {
    const payload = jwt.verify(header.slice(7), process.env.SECRET_KEY)
    const { rows } = await pool.query(
      `SELECT id, nombre_usuario, rol, activo, onboarding_completado
       FROM usuarios WHERE id=$1`,
      [payload.id]
    )
    if (!rows[0] || !rows[0].activo)
      return res.status(401).json({ error: 'Usuario inactivo' })
    req.usuario = rows[0]
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

module.exports = { auth }
