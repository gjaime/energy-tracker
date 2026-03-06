const jwt  = require('jsonwebtoken')
const pool = require('../db/pool')

async function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token requerido' })

  try {
    const payload = jwt.verify(header.slice(7), process.env.SECRET_KEY)
    const { rows } = await pool.query(`SELECT id, nombre, rol, activo FROM usuarios WHERE id=$1`, [payload.id])
    if (!rows[0] || !rows[0].activo) return res.status(401).json({ error: 'Usuario inactivo' })
    req.usuario = rows[0]
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// Middleware especial para n8n: acepta API key en header X-API-Key
async function authN8N(req, res, next) {
  const apiKey = req.headers['x-api-key']
  if (apiKey && apiKey === process.env.N8N_API_KEY) {
    // Inyectar usuario de servicio para n8n
    req.usuario = { id: process.env.N8N_SERVICE_USER_ID, rol: 'usuario' }
    return next()
  }
  return auth(req, res, next)
}

module.exports = { auth, authN8N }
