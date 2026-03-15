const express   = require('express')
const router    = express.Router()
const pool      = require('../db/pool')
const { auth }  = require('../middleware/auth')
const multer    = require('multer')
const Anthropic = require('@anthropic-ai/sdk')
const fs        = require('fs')

const upload = multer({ dest: '/app/uploads/', limits: { fileSize: 20 * 1024 * 1024 } })

// ── Helpers ───────────────────────────────────────────────────────────────

async function extraerDatosConClaude(file) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const b64       = fs.readFileSync(file.path).toString('base64')
  const mediaType = file.mimetype

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        mediaType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
          : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text: PROMPT_EXTRACCION }
      ]
    }]
  })

  const texto = response.content[0].text.trim().replace(/```json|```/g, '').trim()
  return JSON.parse(texto)
}

async function insertarRecibo(client, servicioId, datos) {
  const { rows } = await client.query(
    `INSERT INTO recibos (
      servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
      lectura_anterior, lectura_actual,
      tarifa_precio_basico, tarifa_precio_intermedio, tarifa_precio_excedente,
      tarifa_limite_basico, tarifa_limite_intermedio,
      importe_basico, importe_intermedio, importe_excedente,
      cargo_suministro, cargo_distribucion, cargo_transmision,
      cargo_cenace, cargo_energia, cargo_capacidad, cargo_scnmen,
      cargo_alumbrado_publico, cargo_aportaciones, apoyo_gubernamental,
      cargos_adicionales, dap, subtotal, impuestos, total,
      extraccion_confianza
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
    ) RETURNING *`,
    [
      servicioId,
      datos.fecha_emision, datos.fecha_lectura_cfe, datos.periodo_inicio, datos.periodo_fin,
      datos.lectura_anterior, datos.lectura_actual,
      datos.tarifa_precio_basico, datos.tarifa_precio_intermedio, datos.tarifa_precio_excedente,
      datos.tarifa_limite_basico, datos.tarifa_limite_intermedio,
      datos.importe_basico, datos.importe_intermedio, datos.importe_excedente,
      datos.cargo_suministro, datos.cargo_distribucion, datos.cargo_transmision,
      datos.cargo_cenace, datos.cargo_energia, datos.cargo_capacidad, datos.cargo_scnmen,
      datos.cargo_alumbrado_publico, datos.cargo_aportaciones, datos.apoyo_gubernamental,
      JSON.stringify(datos.cargos_adicionales || []),
      datos.dap, datos.subtotal, datos.impuestos, datos.total,
      datos.confianza,
    ]
  )
  return rows[0]
}

// ── POST /api/onboarding/extraer ──────────────────────────────────────────
router.post('/extraer', auth, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'archivo requerido' })
  try {
    const datos = await extraerDatosConClaude(req.file)
    res.json({ datos })
  } catch (err) {
    console.error('Error extrayendo recibo:', err)
    res.status(500).json({ error: 'No se pudo leer el recibo. Verifica que sea un PDF o imagen válidos.' })
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {})
  }
})

// ── POST /api/onboarding/iniciar ──────────────────────────────────────────
router.post('/iniciar', auth, upload.single('archivo'), async (req, res) => {
  const { lectura_hoy } = req.body
  if (!req.file)    return res.status(400).json({ error: 'archivo requerido' })
  if (!lectura_hoy) return res.status(400).json({ error: 'lectura_hoy requerida' })

  const lecturaHoyInt = parseInt(lectura_hoy)
  if (isNaN(lecturaHoyInt) || lecturaHoyInt < 0)
    return res.status(400).json({ error: 'lectura_hoy inválida' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const datos = await extraerDatosConClaude(req.file)

    if (lecturaHoyInt <= datos.lectura_actual)
      return res.status(400).json({
        error: `La lectura de hoy (${lecturaHoyInt}) debe ser mayor a la del recibo (${datos.lectura_actual})`
      })

    // Crear servicio
    const { rows: svcRows } = await client.query(
      `INSERT INTO servicios (usuario_id, alias, numero_servicio, tarifa_tipo, ciudad, estado_rep)
       VALUES ($1, 'Casa', $2, '1', $3, $4) RETURNING id`,
      [
        req.usuario.id,
        datos.numero_servicio || `SVC-${Date.now()}`,
        datos.ciudad  || null,
        datos.estado  || null,
      ]
    )
    const servicioId = svcRows[0].id

    // Insertar recibo
    const recibo = await insertarRecibo(client, servicioId, datos)

    // Ciclo cerrado correspondiente al recibo
    await client.query(
      `INSERT INTO ciclos
         (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, recibo_id, fuente_cierre)
       VALUES ($1,$2,$3,$4,$5,'cerrado',$6,'recibo_importado')`,
      [servicioId, datos.periodo_inicio, datos.periodo_fin,
       datos.lectura_anterior, datos.lectura_actual, recibo.id]
    )

    // Ciclo abierto desde la fecha de corte
    const hoyCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
    const { rows: cicloRows } = await client.query(
      `INSERT INTO ciclos (servicio_id, fecha_inicio, lectura_inicial, estado)
       VALUES ($1,$2,$3,'abierto') RETURNING id`,
      [servicioId, datos.fecha_lectura_cfe, datos.lectura_actual]
    )
    const cicloActivoId = cicloRows[0].id

    // Métricas desde el corte hasta hoy
    const diasDesdeCorte    = Math.floor((new Date() - new Date(datos.fecha_lectura_cfe + 'T12:00:00')) / 86400000)
    const consumoDesdeCorte = lecturaHoyInt - datos.lectura_actual
    const promedioDiario    = diasDesdeCorte > 0
      ? (consumoDesdeCorte / diasDesdeCorte).toFixed(1)
      : '0'

    // Lectura de hoy como primer evento del ciclo abierto
    await client.query(
      `INSERT INTO eventos
         (ciclo_id, servicio_id, fecha, lectura_valor, consumo_dia, tipo, fuente, notas)
       VALUES ($1,$2,$3,$4,$5,'lectura_diaria','usuario',$6)`,
      [
        cicloActivoId, servicioId, hoyCST, lecturaHoyInt, consumoDesdeCorte,
        `Lectura inicial — ${diasDesdeCorte} días desde el último corte CFE`,
      ]
    )

    await client.query('COMMIT')

    res.status(201).json({
      servicio_id:        servicioId,
      ciclo_activo_id:    cicloActivoId,
      dias_desde_corte:   diasDesdeCorte,
      consumo_desde_corte: consumoDesdeCorte,
      promedio_diario:    promedioDiario,
      recibo,
    })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error en onboarding/iniciar:', err)
    res.status(500).json({ error: 'Error al crear el perfil' })
  } finally {
    client.release()
    if (req.file) fs.unlink(req.file.path, () => {})
  }
})

// ── POST /api/onboarding/historial ────────────────────────────────────────
router.post('/historial', auth, upload.array('archivos', 20), async (req, res) => {
  const { servicio_id } = req.body
  if (!servicio_id)
    return res.status(400).json({ error: 'servicio_id requerido' })
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'archivos requeridos' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: svc } = await client.query(
      `SELECT id FROM servicios WHERE id=$1 AND usuario_id=$2`,
      [servicio_id, req.usuario.id]
    )
    if (!svc[0]) return res.status(404).json({ error: 'Servicio no encontrado' })

    // Extraer datos de todos los archivos
    const resultados = []
    const errores    = []
    for (const file of req.files) {
      try {
        const datos = await extraerDatosConClaude(file)
        resultados.push(datos)
      } catch {
        errores.push(file.originalname)
      }
    }

    // Ordenar por fecha de corte ASC (más viejo primero)
    resultados.sort((a, b) => new Date(a.fecha_lectura_cfe) - new Date(b.fecha_lectura_cfe))

    // Límite: no solapar el ciclo activo
    const { rows: cicloActivo } = await client.query(
      `SELECT fecha_inicio FROM ciclos WHERE servicio_id=$1 AND estado='abierto' LIMIT 1`,
      [servicio_id]
    )
    const fechaLimite = cicloActivo[0]?.fecha_inicio

    let importados = 0
    let omitidos   = 0

    for (const datos of resultados) {
      if (fechaLimite && datos.fecha_lectura_cfe >= fechaLimite) { omitidos++; continue }

      const { rows: dup } = await client.query(
        `SELECT id FROM recibos WHERE servicio_id=$1 AND fecha_lectura_cfe=$2`,
        [servicio_id, datos.fecha_lectura_cfe]
      )
      if (dup[0]) { omitidos++; continue }

      const recibo = await insertarRecibo(client, servicio_id, datos)

      await client.query(
        `INSERT INTO ciclos
           (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, recibo_id, fuente_cierre)
         VALUES ($1,$2,$3,$4,$5,'cerrado',$6,'recibo_importado')`,
        [servicio_id, datos.periodo_inicio, datos.periodo_fin,
         datos.lectura_anterior, datos.lectura_actual, recibo.id]
      )
      importados++
    }

    await client.query('COMMIT')
    res.json({ importados, omitidos, errores })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error en onboarding/historial:', err)
    res.status(500).json({ error: 'Error al procesar los recibos' })
  } finally {
    client.release()
    req.files?.forEach(f => fs.unlink(f.path, () => {}))
  }
})

// ── POST /api/onboarding/completar ────────────────────────────────────────
router.post('/completar', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE usuarios SET onboarding_completado=true WHERE id=$1`,
      [req.usuario.id]
    )
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Error interno' })
  }
})

// ── Prompt de extracción ──────────────────────────────────────────────────
const PROMPT_EXTRACCION = `Eres un asistente especializado en extraer datos de recibos CFE de México.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques markdown.

Campos (usa null si no aparece en el recibo):
fecha_emision (YYYY-MM-DD), fecha_lectura_cfe (YYYY-MM-DD, requerido),
periodo_inicio (YYYY-MM-DD, requerido), periodo_fin (YYYY-MM-DD, requerido),
numero_servicio (string), ciudad (string), estado (string),
lectura_anterior (integer, requerido), lectura_actual (integer, requerido),
tarifa_precio_basico, tarifa_precio_intermedio, tarifa_precio_excedente (decimales),
tarifa_limite_basico, tarifa_limite_intermedio (enteros),
importe_basico, importe_intermedio, importe_excedente (decimales),
cargo_suministro, cargo_distribucion, cargo_transmision, cargo_cenace,
cargo_energia, cargo_capacidad, cargo_scnmen (decimales),
cargo_alumbrado_publico, cargo_aportaciones, apoyo_gubernamental (decimales),
dap (decimal), cargos_adicionales (array [{nombre, importe}]),
subtotal (decimal), impuestos (decimal), total (decimal, requerido),
confianza (0-100 según qué tan legibles están los datos).`

module.exports = router
