const express   = require('express')
const router    = express.Router()
const pool      = require('../db/pool')
const { auth }  = require('../middleware/auth')
const multer    = require('multer')
const Anthropic = require('@anthropic-ai/sdk')
const fs        = require('fs')

const upload = multer({ dest: '/app/uploads/', limits: { fileSize: 20 * 1024 * 1024 } })

// ── Extracción con Claude ────────────────────────────────────────────────
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
  // Fallback: si Claude no extrajo fecha_lectura_cfe, usar periodo_fin
  if (!datos.fecha_lectura_cfe && datos.periodo_fin) {
    datos.fecha_lectura_cfe = datos.periodo_fin
  }
  // Fallback periodo_inicio desde fecha_emision si falta
  if (!datos.periodo_inicio && datos.fecha_emision) {
    datos.periodo_inicio = datos.fecha_emision
  }
  if (!datos.periodo_fin && datos.fecha_lectura_cfe) {
    datos.periodo_fin = datos.fecha_lectura_cfe
  }

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

// ── GET /api/recibos?servicio_id=... ─────────────────────────────────────
router.get('/', auth, async (req, res) => {
  const { servicio_id } = req.query
  if (!servicio_id) return res.status(400).json({ error: 'servicio_id requerido' })

  try {
    const { rows: svc } = await pool.query(
      `SELECT id FROM servicios WHERE id=$1 AND usuario_id=$2 AND activo=true`,
      [servicio_id, req.usuario.id]
    )
    if (!svc[0]) return res.status(404).json({ error: 'Servicio no encontrado' })

    const { rows } = await pool.query(
      `SELECT * FROM recibos WHERE servicio_id=$1 ORDER BY fecha_lectura_cfe DESC`,
      [servicio_id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

// ── POST /api/recibos/historial ──────────────────────────────────────────
// Carga batch de recibos históricos.
// - Auto-ordena por fecha
// - Detecta duplicados (ya existentes en DB)
// - Para nuevos: crea ciclo cerrado y rellena huecos sin_recibo_pendiente
// - Devuelve reporte detallado
router.post('/historial', auth, upload.array('archivos', 30), async (req, res) => {
  const { servicio_id } = req.body

  if (!servicio_id)
    return res.status(400).json({ error: 'servicio_id requerido' })
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'archivos requeridos' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Verificar propiedad del servicio
    const { rows: svc } = await client.query(
      `SELECT id FROM servicios WHERE id=$1 AND usuario_id=$2 AND activo=true`,
      [servicio_id, req.usuario.id]
    )
    if (!svc[0]) return res.status(404).json({ error: 'Servicio no encontrado' })

    // ── Extraer todos los archivos ────────────────────────────────────────
    const extraidos = []
    const errores   = []

    for (const file of req.files) {
      try {
        const datos = await extraerDatosConClaude(file)
        extraidos.push({ datos, nombre: file.originalname })
      } catch (e) {
        errores.push({ nombre: file.originalname, error: e.message })
      }
    }

    // Ordenar por fecha de corte ASC (más viejo primero)
    extraidos.sort((a, b) =>
      new Date(a.datos.fecha_lectura_cfe) - new Date(b.datos.fecha_lectura_cfe)
    )

    // ── Verificar cuáles ya existen ───────────────────────────────────────
    const { rows: existentes } = await client.query(
      `SELECT fecha_lectura_cfe::text as fecha FROM recibos WHERE servicio_id=$1`,
      [servicio_id]
    )
    const fechasExistentes = new Set(existentes.map(r => r.fecha))

    const duplicados  = []
    const importados  = []
    const omitidos    = []

    // ── Ciclo activo — no solapar ─────────────────────────────────────────
    const { rows: cicloActivo } = await client.query(
      `SELECT fecha_inicio::text as fecha_inicio FROM ciclos
       WHERE servicio_id=$1 AND estado='abierto'
       ORDER BY fecha_inicio DESC LIMIT 1`,
      [servicio_id]
    )
    const fechaLimite = cicloActivo[0]?.fecha_inicio || null

    for (const { datos, nombre } of extraidos) {
      const fechaCorte = datos.fecha_lectura_cfe

      // Duplicado exacto
      if (fechasExistentes.has(fechaCorte)) {
        duplicados.push({
          nombre,
          fecha: fechaCorte,
          periodo: `${datos.periodo_inicio} → ${datos.periodo_fin}`,
          kwh: datos.lectura_actual - datos.lectura_anterior,
          total: datos.total,
        })
        continue
      }

      // Sobrepasa el ciclo activo
      if (fechaLimite && fechaCorte >= fechaLimite) {
        omitidos.push({ nombre, fecha: fechaCorte, razon: 'Sobrepasa el ciclo activo' })
        continue
      }

      // ── Insertar recibo nuevo ───────────────────────────────────────────
      const recibo = await insertarRecibo(client, servicio_id, datos)

      // ── ¿Existe un ciclo sin_recibo_pendiente que corresponda? ──────────
      // Buscar ciclo cuyo período solape con el del recibo
      const { rows: hueco } = await client.query(
        `SELECT id FROM ciclos
         WHERE servicio_id=$1
           AND estado='sin_recibo_pendiente'
           AND fecha_inicio::text <= $2
           AND (fecha_fin IS NULL OR fecha_fin::text >= $3)
         LIMIT 1`,
        [servicio_id, fechaCorte, datos.periodo_inicio]
      )

      if (hueco[0]) {
        // Rellenar el hueco existente
        await client.query(
          `UPDATE ciclos
           SET fecha_inicio   = $1,
               fecha_fin      = $2,
               lectura_inicial = $3,
               lectura_final  = $4,
               estado         = 'cerrado',
               recibo_id      = $5,
               fuente_cierre  = 'recibo_importado'
           WHERE id = $6`,
          [datos.periodo_inicio, fechaCorte,
           datos.lectura_anterior, datos.lectura_actual,
           recibo.id, hueco[0].id]
        )
      } else {
        // Crear ciclo cerrado nuevo
        await client.query(
          `INSERT INTO ciclos
             (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final,
              estado, recibo_id, fuente_cierre)
           VALUES ($1,$2,$3,$4,$5,'cerrado',$6,'recibo_importado')`,
          [servicio_id, datos.periodo_inicio, fechaCorte,
           datos.lectura_anterior, datos.lectura_actual, recibo.id]
        )
      }

      fechasExistentes.add(fechaCorte)
      importados.push({
        nombre,
        fecha: fechaCorte,
        periodo: `${datos.periodo_inicio} → ${datos.periodo_fin}`,
        kwh: datos.lectura_actual - datos.lectura_anterior,
        total: datos.total,
        confianza: datos.confianza,
        relleno_hueco: !!hueco[0],
      })
    }

    await client.query('COMMIT')

    res.json({
      importados,
      duplicados,
      omitidos,
      errores,
      resumen: {
        total_archivos:   req.files.length,
        importados:       importados.length,
        duplicados:       duplicados.length,
        omitidos:         omitidos.length,
        errores:          errores.length,
        huecos_rellenados: importados.filter(r => r.relleno_hueco).length,
      }
    })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('POST /api/recibos/historial error:', err)
    res.status(500).json({ error: 'Error al procesar los recibos' })
  } finally {
    client.release()
    req.files?.forEach(f => fs.unlink(f.path, () => {}))
  }
})

const PROMPT_EXTRACCION = `Eres un experto extractor de datos de recibos CFE (Comisión Federal de Electricidad) de México.
Responde ÚNICAMENTE con JSON válido. Sin texto adicional, sin bloques markdown, sin explicaciones.

INSTRUCCIONES CRÍTICAS:
1. fecha_lectura_cfe es la fecha en que el lector de CFE tomó la lectura del medidor. En el recibo aparece como "Fecha de lectura", "Fecha corte", "Fecha de toma de lectura" o similar. Si no aparece explícitamente, usa el valor de periodo_fin.
2. periodo_fin es la fecha de fin del período de facturación — generalmente coincide con fecha_lectura_cfe.
3. periodo_inicio es la fecha de inicio del período — coincide con la lectura anterior del bimestre pasado.
4. fecha_emision es la fecha en que se emitió/imprimió el recibo, generalmente unos días después del corte.
5. lectura_anterior y lectura_actual son los valores enteros del medidor en kWh. lectura_actual > lectura_anterior siempre.
6. dap = Derecho de Alumbrado Público, cargo fijo bimestral en pesos.
7. apoyo_gubernamental = subsidio o descuento gubernamental, valor positivo (se resta del total).
8. cargos_adicionales = array de cualquier cargo extra que aparezca y no tenga campo propio, incluyendo adeudos anteriores.
9. confianza = 0-100. 90-100 si todo está legible, 60-89 si algunos campos son difusos, <60 si hay partes ilegibles.
10. Todos los valores monetarios son decimales en pesos MXN, sin símbolo $.
11. Fechas siempre en formato YYYY-MM-DD.
12. Si un campo no aparece en el recibo, usa null. NUNCA inventes valores.

JSON a devolver:
{
  "fecha_emision": "YYYY-MM-DD",
  "fecha_lectura_cfe": "YYYY-MM-DD",
  "periodo_inicio": "YYYY-MM-DD",
  "periodo_fin": "YYYY-MM-DD",
  "numero_servicio": "string",
  "ciudad": "string",
  "estado": "string",
  "lectura_anterior": integer,
  "lectura_actual": integer,
  "tarifa_precio_basico": decimal,
  "tarifa_precio_intermedio": decimal,
  "tarifa_precio_excedente": decimal,
  "tarifa_limite_basico": integer,
  "tarifa_limite_intermedio": integer,
  "importe_basico": decimal,
  "importe_intermedio": decimal,
  "importe_excedente": decimal,
  "cargo_suministro": decimal,
  "cargo_distribucion": decimal,
  "cargo_transmision": decimal,
  "cargo_cenace": decimal,
  "cargo_energia": decimal,
  "cargo_capacidad": decimal,
  "cargo_scnmen": decimal,
  "cargo_alumbrado_publico": decimal,
  "cargo_aportaciones": decimal,
  "apoyo_gubernamental": decimal,
  "dap": decimal,
  "cargos_adicionales": [{"nombre": "string", "importe": decimal}],
  "subtotal": decimal,
  "impuestos": decimal,
  "total": decimal,
  "confianza": integer
}`

module.exports = router
