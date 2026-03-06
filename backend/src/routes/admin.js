/**
 * /api/admin — Rutas exclusivas para el usuario admin
 * - Cambiar contraseña
 * - Ver/editar datos del servicio eléctrico
 * - Estado del sistema
 */
const express = require('express')
const router  = express.Router()
const bcrypt  = require('bcryptjs')
const pool    = require('../db/pool')
const { auth } = require('../middleware/auth')

// Middleware — solo admin
function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin')
    return res.status(403).json({ error: 'Acceso restringido a administradores' })
  next()
}

// ── GET /api/admin/perfil ─────────────────────────────────────────────────
router.get('/perfil', auth, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, email, rol, fecha_registro, ultimo_acceso
       FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    )
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

// ── PUT /api/admin/password ───────────────────────────────────────────────
router.put('/password', auth, soloAdmin, async (req, res) => {
  const { password_actual, password_nuevo } = req.body

  if (!password_actual || !password_nuevo)
    return res.status(400).json({ error: 'password_actual y password_nuevo son requeridos' })
  if (password_nuevo.length < 8)
    return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres' })

  try {
    const { rows } = await pool.query(
      `SELECT password_hash FROM usuarios WHERE id = $1`, [req.usuario.id]
    )
    const valido = await bcrypt.compare(password_actual, rows[0].password_hash)
    if (!valido)
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' })

    const nuevo_hash = await bcrypt.hash(password_nuevo, 10)
    await pool.query(
      `UPDATE usuarios SET password_hash = $1 WHERE id = $2`,
      [nuevo_hash, req.usuario.id]
    )
    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

// ── PUT /api/admin/servicio/:id ───────────────────────────────────────────
router.put('/servicio/:id', auth, soloAdmin, async (req, res) => {
  const { alias, numero_servicio, numero_medidor, tarifa_tipo, direccion, ciudad, estado_rep, notas } = req.body

  try {
    // Verificar que el servicio pertenece al admin
    const { rows: check } = await pool.query(
      `SELECT id FROM servicios WHERE id = $1 AND usuario_id = $2`,
      [req.params.id, req.usuario.id]
    )
    if (!check[0]) return res.status(404).json({ error: 'Servicio no encontrado' })

    const { rows } = await pool.query(
      `UPDATE servicios SET
        alias = COALESCE($1, alias),
        numero_servicio = COALESCE($2, numero_servicio),
        numero_medidor  = COALESCE($3, numero_medidor),
        tarifa_tipo     = COALESCE($4, tarifa_tipo),
        direccion       = COALESCE($5, direccion),
        ciudad          = COALESCE($6, ciudad),
        estado_rep      = COALESCE($7, estado_rep),
        notas           = COALESCE($8, notas)
       WHERE id = $9 RETURNING *`,
      [alias, numero_servicio, numero_medidor, tarifa_tipo, direccion, ciudad, estado_rep, notas, req.params.id]
    )
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

// ── GET /api/admin/sistema ────────────────────────────────────────────────
router.get('/sistema', auth, soloAdmin, async (req, res) => {
  try {
    const [usuarios, servicios, ciclos, eventos, recibos, pendientes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM usuarios`),
      pool.query(`SELECT COUNT(*) FROM servicios WHERE activo = true`),
      pool.query(`SELECT COUNT(*) FROM ciclos WHERE estado = 'abierto'`),
      pool.query(`SELECT COUNT(*) FROM eventos`),
      pool.query(`SELECT COUNT(*) FROM recibos`),
      pool.query(`SELECT COUNT(*) FROM pendientes WHERE estado = 'esperando' AND expira_at > NOW()`),
    ])

    // Última lectura registrada
    const { rows: ultima } = await pool.query(
      `SELECT fecha, lectura_valor, fuente FROM eventos
       ORDER BY created_at DESC LIMIT 1`
    )

    res.json({
      usuarios:          parseInt(usuarios.rows[0].count),
      servicios_activos: parseInt(servicios.rows[0].count),
      ciclos_abiertos:   parseInt(ciclos.rows[0].count),
      total_eventos:     parseInt(eventos.rows[0].count),
      total_recibos:     parseInt(recibos.rows[0].count),
      pendientes_activos:parseInt(pendientes.rows[0].count),
      ultima_lectura:    ultima.rows[0] || null,
      timestamp:         new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
