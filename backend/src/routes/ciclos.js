const express = require('express')
const router  = express.Router()
const pool    = require('../db/pool')
const { ajustarCicloPorRecibo } = require('../services/cicloService')
const { auth } = require('../middleware/auth')
const multer  = require('multer')
const path    = require('path')
const Anthropic = require('@anthropic-ai/sdk')
const fs      = require('fs')

const upload = multer({ dest: '/app/uploads/', limits: { fileSize: 20 * 1024 * 1024 } })

// GET /api/ciclos — histórico de ciclos del servicio
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

// POST /api/ciclos — importar recibo PDF/imagen
router.post('/', auth, upload.single('archivo'), async (req, res) => {
  const { servicio_id } = req.body
  if (!servicio_id || !req.file) return res.status(400).json({ error: 'servicio_id y archivo son requeridos' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Extraer datos con Claude
    const archivoBytes = fs.readFileSync(req.file.path)
    const b64 = archivoBytes.toString('base64')
    const mediaType = req.file.mimetype

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response  = await anthropic.messages.create({
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

    const datos = JSON.parse(response.content[0].text.trim())

    // Insertar recibo
    const { rows: reciboRows } = await client.query(
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
        archivo_url, extraccion_confianza
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
      RETURNING *`,
      [
        servicio_id, datos.fecha_emision, datos.fecha_lectura_cfe, datos.periodo_inicio, datos.periodo_fin,
        datos.lectura_anterior, datos.lectura_actual,
        datos.tarifa_precio_basico, datos.tarifa_precio_intermedio, datos.tarifa_precio_excedente,
        datos.tarifa_limite_basico, datos.tarifa_limite_intermedio,
        datos.importe_basico, datos.importe_intermedio, datos.importe_excedente,
        datos.cargo_suministro, datos.cargo_distribucion, datos.cargo_transmision,
        datos.cargo_cenace, datos.cargo_energia, datos.cargo_capacidad, datos.cargo_scnmen,
        datos.cargo_alumbrado_publico, datos.cargo_aportaciones, datos.apoyo_gubernamental,
        JSON.stringify(datos.cargos_adicionales || []), datos.dap,
        datos.subtotal, datos.impuestos, datos.total,
        req.file.path, datos.confianza
      ]
    )
    const recibo = reciboRows[0]

    // Ajuste retroactivo de ciclos
    const resumenAjuste = await ajustarCicloPorRecibo(client, recibo)

    await client.query('COMMIT')
    res.status(201).json({ recibo, ajuste_ciclos: resumenAjuste, requiere_revision: datos.confianza < 85 })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('POST /api/ciclos error:', err)
    res.status(500).json({ error: 'Error al procesar el recibo' })
  } finally {
    client.release()
    if (req.file) fs.unlink(req.file.path, () => {})
  }
})

const PROMPT_EXTRACCION = `Eres un asistente especializado en extraer datos de recibos CFE de México.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques markdown.
Campos: fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin, numero_servicio,
lectura_anterior, lectura_actual, tarifa_precio_basico, tarifa_precio_intermedio, tarifa_precio_excedente,
tarifa_limite_basico, tarifa_limite_intermedio, importe_basico, importe_intermedio, importe_excedente,
cargo_suministro, cargo_distribucion, cargo_transmision, cargo_cenace, cargo_energia, cargo_capacidad, cargo_scnmen,
cargo_alumbrado_publico, cargo_aportaciones, apoyo_gubernamental, dap,
cargos_adicionales (array de {nombre,importe}), subtotal, impuestos, total, confianza (0-100).
Fechas en YYYY-MM-DD. Usa null para campos no encontrados.`

module.exports = router
