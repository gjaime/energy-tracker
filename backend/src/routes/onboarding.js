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
      datos.fecha_emision, datos.fecha_lectura_cfe || datos.periodo_fin, datos.periodo_inicio, datos.periodo_fin,
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
      [servicioId, datos.fecha_lectura_cfe || datos.periodo_fin, datos.lectura_actual]
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



// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Parser de CFDI CFE (sin Claude, 100% determinista)
// ─────────────────────────────────────────────────────────────────────────────

const MESES_CFE = {
  ENE:'01',FEB:'02',MAR:'03',ABR:'04',MAY:'05',JUN:'06',
  JUL:'07',AGO:'08',SEP:'09',OCT:'10',NOV:'11',DIC:'12'
}

function parseFechaCFE(str) {
  // "29 DIC 25" → "2025-12-29"
  const m = (str || '').trim().match(/^(\d+)\s+(\w+)\s+(\d+)$/)
  if (!m) return null
  const mes = MESES_CFE[m[2].toUpperCase()]
  if (!mes) return null
  return `20${m[3]}-${mes}-${m[1].padStart(2,'0')}`
}

function parsearXMLCFDI(xml) {
  const tag  = (t) => { const m = xml.match(new RegExp(`<${t}>([^<]+)</${t}>`));  return m ? m[1].trim() : null }
  const attr = (el, a) => { const m = xml.match(new RegExp(`${el}[^>]*\\s${a}="([^"]*)"`)); return m ? m[1] : null }

  // ── Cabecera CFDI ──────────────────────────────────────────────────────────
  const fechaEmision  = (attr('cfdi:Comprobante', 'Fecha') || '').split('T')[0] || null
  const subtotal      = parseFloat(attr('cfdi:Comprobante', 'SubTotal') || '0')
  const total         = parseFloat(attr('cfdi:Comprobante', 'Total')    || '0')

  // IVA (Traslado Impuesto="002")
  const ivaM = xml.match(/Impuesto="002"[^>]*Importe="([^"]*)"/)
            || xml.match(/Importe="([^"]*)"[^>]*Impuesto="002"/)
  const impuestos = ivaM ? parseFloat(ivaM[1]) : parseFloat((total - subtotal).toFixed(2))

  // DAP (Concepto Descripcion="DAP")
  const dapM = xml.match(/Descripcion="DAP"[^>]*Importe="([^"]*)"/)
            || xml.match(/Importe="([^"]*)"[^>]*Descripcion="DAP"/)
  const dap  = dapM ? parseFloat(dapM[1]) : null

  // ── clsRegArchFact ──────────────────────────────────────────────────────────
  const kwb01       = parseInt(tag('KWB01')          || '0')
  const kwi01       = parseInt(tag('KWI01')          || '0')
  const consumoKwh  = kwb01 + kwi01
  const diasPeriodo = parseInt(tag('DIASXPERIODO1')  || '60')

  const pBasico       = parseFloat(tag('PRECIO_ESCALON1_1') || '0') || null
  const pIntermedio   = parseFloat(tag('PRECIO_ESCALON1_2') || '0') || null
  const pExcedente    = parseFloat(tag('PRECIO_ESCALON1_3') || '0') || null
  const limBasico     = parseInt(tag('KWH_ESCALON1_1')      || '0') || null
  const limIntermedio = limBasico && parseInt(tag('KWH_ESCALON1_2') || '0')
                        ? limBasico + parseInt(tag('KWH_ESCALON1_2'))
                        : null

  const apoyoRaw  = parseFloat(tag('AportacionGub') || '0')
  const apoyoGub  = apoyoRaw > 0 ? apoyoRaw : null

  // Cargos MEM: MOTIVO_REG_N → campo
  const MEM_MAP = { ES1:'cargo_suministro', ED1:'cargo_distribucion', ET1:'cargo_transmision',
                    EC1:'cargo_cenace',     EG1:'cargo_energia',      EIK:'cargo_capacidad',  EM1:'cargo_scnmen' }
  const cargos = {}
  for (let i = 1; i <= 10; i++) {
    const motivo  = tag(`MOTIVO_REG_${i}`)
    const importe = parseFloat(tag(`IMPTE_TOT_REG_${i}`) || '0')
    if (motivo && MEM_MAP[motivo] && importe > 0) cargos[MEM_MAP[motivo]] = importe
  }

  // ── Derivar periodo desde FacturaAnt1 ─────────────────────────────────────
  // FacturaAnt1 = "del DD MMM AA al DD MMM AA" → periodoInicio = fin de esa factura
  const factAnt1 = tag('FacturaAnt1')
  let periodoInicio = null
  if (factAnt1) {
    const m = factAnt1.match(/al\s+(\d+\s+\w+\s+\d+)\s*$/)
    if (m) periodoInicio = parseFechaCFE(m[1])
  }

  let periodoFin = null
  if (periodoInicio) {
    const d = new Date(periodoInicio + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + diasPeriodo)
    periodoFin = d.toISOString().split('T')[0]
  } else if (fechaEmision) {
    // fallback: fecha_emision - 2 días
    const d = new Date(fechaEmision + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 2)
    periodoFin = d.toISOString().split('T')[0]
    const d2 = new Date(periodoFin + 'T12:00:00Z')
    d2.setUTCDate(d2.getUTCDate() - diasPeriodo)
    periodoInicio = d2.toISOString().split('T')[0]
  }

  return {
    fecha_emision:              fechaEmision,
    fecha_lectura_cfe:          periodoFin,
    periodo_inicio:             periodoInicio,
    periodo_fin:                periodoFin,
    consumo_kwh:                consumoKwh,
    tarifa_precio_basico:       pBasico,
    tarifa_precio_intermedio:   pIntermedio,
    tarifa_precio_excedente:    pExcedente,
    tarifa_limite_basico:       limBasico,
    tarifa_limite_intermedio:   limIntermedio,
    apoyo_gubernamental:        apoyoGub,
    dap,
    subtotal,
    impuestos,
    total,
    ...cargos,
  }
}

// ── POST /api/onboarding/historial-xml ────────────────────────────────────────
// Acepta múltiples CFDIs XML de CFE, los parsea deterministamente (sin Claude)
// y reconstruye el histórico de ciclos/recibos.
router.post('/historial-xml', auth, upload.array('archivos', 30), async (req, res) => {
  const { servicio_id } = req.body
  if (!servicio_id || !req.files?.length)
    return res.status(400).json({ error: 'servicio_id y archivos son requeridos' })

  const client = await pool.connect()
  const resultado = { importados: 0, duplicados: 0, errores: [], huecos_rellenados: 0 }

  try {
    await client.query('BEGIN')

    // 1. Parsear todos los XMLs
    const parsed = []
    for (const file of req.files) {
      try {
        const content = fs.readFileSync(file.path, 'utf8')
        const datos   = parsearXMLCFDI(content)
        if (!datos.fecha_lectura_cfe) throw new Error('No se pudo determinar fecha_lectura_cfe')
        datos._nombre = file.originalname
        parsed.push(datos)
      } catch (e) {
        resultado.errores.push({ archivo: file.originalname, error: e.message })
      }
    }

    if (!parsed.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Ningún XML válido', ...resultado })
    }

    // 2. Ordenar de más antiguo a más reciente
    parsed.sort((a, b) => new Date(a.fecha_lectura_cfe) - new Date(b.fecha_lectura_cfe))

    // 3. Detectar duplicados y recibos existentes para encadenar lecturas
    const { rows: existentes } = await client.query(
      `SELECT fecha_lectura_cfe::text, lectura_anterior, lectura_actual
       FROM recibos WHERE servicio_id=$1 ORDER BY fecha_lectura_cfe`,
      [servicio_id]
    )
    const existenteMap = {}
    existentes.forEach(r => existenteMap[r.fecha_lectura_cfe] = r)

    // 4. Encadenar lecturas
    // 4. Encadenar lecturas con anclas de confianza
    // 4a. Buscar ancla confiable: recibo revisado que coincida con un XML del batch
    let anclaActual = null
    let anclaIdx    = -1
    for (let i = parsed.length - 1; i >= 0; i--) {
      const key = parsed[i].fecha_lectura_cfe
      const existente = existenteMap[key]
      if (existente && existente.extraccion_revisada) {
        anclaActual = parseInt(existente.lectura_actual)
        anclaIdx    = i
        break
      }
    }
    // 4b. Si no hay ancla revisada en el batch, buscar el revisado más reciente en DB
    if (anclaActual === null) {
      const revisados = existentes
        .filter(r => r.extraccion_revisada)
        .sort((a, b) => String(b.fecha_lectura_cfe).localeCompare(String(a.fecha_lectura_cfe)))
      if (revisados.length) {
        anclaActual = parseInt(revisados[0].lectura_actual)
        anclaIdx    = -1
      }
    }
    // 4c. Sin ancla confiable — pedir lectura_referencia
    if (anclaActual === null) {
      const lecturaRef = req.body.lectura_referencia ? parseInt(req.body.lectura_referencia) : null
      if (!lecturaRef || isNaN(lecturaRef)) {
        await client.query('ROLLBACK')
        return res.status(422).json({
          error: 'Se requiere una lectura de referencia',
          detalle: 'No hay recibos verificados en la base de datos. Incluye el campo "lectura_referencia" con la lectura actual del medidor.',
          requiere_lectura_referencia: true,
        })
      }
      anclaActual = lecturaRef
      anclaIdx    = parsed.length - 1
      parsed[anclaIdx].lectura_actual   = lecturaRef
      parsed[anclaIdx].lectura_anterior = lecturaRef - parsed[anclaIdx].consumo_kwh
    }
    // 4d. Propagar cadena desde la ancla
    if (anclaIdx <= 0) {
      // Ancla es el más reciente o externa — propagar hacia atrás
      let lecActual = anclaActual
      const inicio = anclaIdx === -1 ? parsed.length - 1 : anclaIdx
      for (let i = inicio; i >= 0; i--) {
        if (parsed[i].lectura_actual == null) {
          parsed[i].lectura_actual   = lecActual
          parsed[i].lectura_anterior = lecActual - parsed[i].consumo_kwh
        }
        lecActual = parsed[i].lectura_anterior
      }
    } else {
      // Ancla en medio — propagar en ambas direcciones
      let lecActual = anclaActual
      for (let i = anclaIdx - 1; i >= 0; i--) {
        parsed[i].lectura_actual   = lecActual
        parsed[i].lectura_anterior = lecActual - parsed[i].consumo_kwh
        lecActual = parsed[i].lectura_anterior
      }
      let lecPrev = anclaActual
      for (let i = anclaIdx + 1; i < parsed.length; i++) {
        parsed[i].lectura_anterior = lecPrev
        parsed[i].lectura_actual   = lecPrev + parsed[i].consumo_kwh
        lecPrev = parsed[i].lectura_actual
      }
    }
    // 4e. Validar consistencia de cadena
    const erroresConsistencia = []
    for (let i = 0; i < parsed.length - 1; i++) {
      const actual    = parsed[i].lectura_actual
      const siguiente = parsed[i + 1].lectura_anterior
      if (actual != null && siguiente != null && actual !== siguiente) {
        erroresConsistencia.push(
          `Inconsistencia entre ${parsed[i].fecha_lectura_cfe} (act: ${actual}) y ${parsed[i+1].fecha_lectura_cfe} (ant: ${siguiente})`
        )
      }
    }
    if (erroresConsistencia.length) {
      await client.query('ROLLBACK')
      return res.status(422).json({
        error: 'La cadena de lecturas no es consistente',
        detalle: erroresConsistencia,
        requiere_lectura_referencia: true,
      })
    }

    // 5. Insertar cada recibo y crear ciclos históricos directamente
    // Obtener el ciclo activo actual para no tocarlo con recibos históricos
    const { rows: ciclosActivos } = await client.query(
      `SELECT id, fecha_inicio FROM ciclos WHERE servicio_id=$1 AND estado='abierto' LIMIT 1`,
      [servicio_id]
    )
    const cicloActivoId = ciclosActivos[0]?.id || null

    for (let idx = 0; idx < parsed.length; idx++) {
      const datos = parsed[idx]
      if (datos.lectura_anterior == null || datos.lectura_actual == null) {
        resultado.errores.push({ archivo: datos._nombre, error: 'No se pudo determinar lecturas' }); continue
      }
      try {
        let recibo
        if (existenteMap[datos.fecha_lectura_cfe]) {
          // XML es fuente de verdad — sobreescribir recibo existente completo
          const { rows: updRows } = await client.query(
            `UPDATE recibos SET
              fecha_emision              = $1,
              periodo_inicio             = $2,
              periodo_fin                = $3,
              lectura_anterior           = $4,
              lectura_actual             = $5,
              tarifa_precio_basico       = $6,
              tarifa_precio_intermedio   = $7,
              tarifa_precio_excedente    = $8,
              tarifa_limite_basico       = $9,
              tarifa_limite_intermedio   = $10,
              cargo_suministro           = $11,
              cargo_distribucion         = $12,
              cargo_transmision          = $13,
              cargo_cenace               = $14,
              cargo_energia              = $15,
              cargo_capacidad            = $16,
              cargo_scnmen               = $17,
              apoyo_gubernamental        = $18,
              dap                        = $19,
              subtotal                   = $20,
              impuestos                  = $21,
              total                      = $22,
              extraccion_confianza       = 100,
              extraccion_revisada        = true
            WHERE servicio_id=$23 AND fecha_lectura_cfe=$24
            RETURNING *`,
            [
              datos.fecha_emision, datos.periodo_inicio, datos.periodo_fin,
              datos.lectura_anterior, datos.lectura_actual,
              datos.tarifa_precio_basico,     datos.tarifa_precio_intermedio,  datos.tarifa_precio_excedente,
              datos.tarifa_limite_basico,     datos.tarifa_limite_intermedio,
              datos.cargo_suministro || null, datos.cargo_distribucion || null, datos.cargo_transmision || null,
              datos.cargo_cenace    || null,  datos.cargo_energia      || null, datos.cargo_capacidad   || null,
              datos.cargo_scnmen    || null,  datos.apoyo_gubernamental,
              datos.dap, datos.subtotal, datos.impuestos, datos.total,
              servicio_id, datos.fecha_lectura_cfe,
            ]
          )
          recibo = updRows[0]
          // Actualizar también el ciclo asociado con lecturas correctas
          await client.query(
            `UPDATE ciclos SET
               lectura_inicial = $1,
               lectura_final   = $2
             WHERE recibo_id = $3`,
            [datos.lectura_anterior, datos.lectura_actual, recibo.id]
          )
          resultado.actualizados = (resultado.actualizados || 0) + 1
        } else {
          // Recibo nuevo — INSERT normal
          const { rows: reciboRows } = await client.query(
            `INSERT INTO recibos (
              servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
              lectura_anterior, lectura_actual,
              tarifa_precio_basico, tarifa_precio_intermedio, tarifa_precio_excedente,
              tarifa_limite_basico, tarifa_limite_intermedio,
              cargo_suministro, cargo_distribucion, cargo_transmision,
              cargo_cenace, cargo_energia, cargo_capacidad, cargo_scnmen,
              apoyo_gubernamental, dap, subtotal, impuestos, total,
              extraccion_confianza
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,100)
            RETURNING *`,
            [
              servicio_id, datos.fecha_emision, datos.fecha_lectura_cfe,
              datos.periodo_inicio, datos.periodo_fin,
              datos.lectura_anterior, datos.lectura_actual,
              datos.tarifa_precio_basico,     datos.tarifa_precio_intermedio,  datos.tarifa_precio_excedente,
              datos.tarifa_limite_basico,     datos.tarifa_limite_intermedio,
              datos.cargo_suministro || null, datos.cargo_distribucion || null, datos.cargo_transmision || null,
              datos.cargo_cenace    || null,  datos.cargo_energia      || null, datos.cargo_capacidad   || null,
              datos.cargo_scnmen    || null,  datos.apoyo_gubernamental,
              datos.dap, datos.subtotal, datos.impuestos, datos.total,
            ]
          )
          recibo = reciboRows[0]

          // Verificar si ya existe un ciclo que cubra este período
          const { rows: cicloExist } = await client.query(
            `SELECT id FROM ciclos
             WHERE servicio_id=$1
               AND fecha_inicio <= $2::date
               AND (fecha_fin >= $2::date OR fecha_fin IS NULL)
             LIMIT 1`,
            [servicio_id, datos.fecha_lectura_cfe]
          )

          if (cicloExist.length === 0) {
            // Crear ciclo cerrado histórico directamente
            const fechaInicio = datos.periodo_inicio || datos.fecha_lectura_cfe
            await client.query(
              `INSERT INTO ciclos
                 (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final,
                  estado, recibo_id, fuente_cierre)
               VALUES ($1,$2,$3,$4,$5,'cerrado',$6,'recibo_importado')`,
              [servicio_id, fechaInicio, datos.fecha_lectura_cfe,
               datos.lectura_anterior, datos.lectura_actual, recibo.id]
            )
          } else if (cicloExist[0].id !== cicloActivoId) {
            // Actualizar ciclo existente cerrado con el recibo_id
            await client.query(
              `UPDATE ciclos SET recibo_id=$1 WHERE id=$2`,
              [recibo.id, cicloExist[0].id]
            )
          }
          resultado.importados++
        } // fin else INSERT
      } catch (e) {
        resultado.errores.push({ archivo: datos._nombre, error: e.message })
      }
    }

    // Actualizar lectura_inicial del ciclo activo con la última lectura de los XMLs
    // Solo si realmente se importaron recibos nuevos
    if (cicloActivoId && resultado.importados > 0) {
      const nuevosParsed = parsed.filter(p => !existenteMap[p.fecha_lectura_cfe])
      const ultimo = nuevosParsed[nuevosParsed.length - 1]
      if (ultimo?.lectura_actual != null) {
        await client.query(
          `UPDATE ciclos SET lectura_inicial=$1 WHERE id=$2 AND estado='abierto'`,
          [ultimo.lectura_actual, cicloActivoId]
        )
      }
    }

    await client.query('COMMIT')
    res.json({ ok: true, ...resultado })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('POST /onboarding/historial-xml error:', err)
    res.status(500).json({ error: 'Error al procesar XMLs', detalle: err.message })
  } finally {
    client.release()
    req.files?.forEach(f => fs.unlink(f.path, () => {}))
  }
})


// ── POST /api/onboarding/recibo-nuevo ─────────────────────────────────────────
// Sube el recibo más reciente: cierra el ciclo activo, abre el nuevo,
// actualiza tarifas. Llama ajustarCicloPorRecibo igual que el flujo legacy.
router.post('/recibo-nuevo', auth, upload.single('archivo'), async (req, res) => {
  const { servicio_id } = req.body
  if (!servicio_id || !req.file)
    return res.status(400).json({ error: 'servicio_id y archivo son requeridos' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Extraer datos del PDF con Claude
    const datos = await extraerDatosConClaude(req.file)
    if (!datos.fecha_lectura_cfe && datos.periodo_fin)
      datos.fecha_lectura_cfe = datos.periodo_fin

    if (!datos.fecha_lectura_cfe)
      return res.status(422).json({ error: 'No se pudo determinar la fecha de corte del recibo' })

    // 2. Verificar que no sea duplicado
    const { rows: dup } = await client.query(
      `SELECT id FROM recibos WHERE servicio_id=$1 AND fecha_lectura_cfe=$2`,
      [servicio_id, datos.fecha_lectura_cfe]
    )
    if (dup.length) {
      await client.query('ROLLBACK')
      return res.status(409).json({
        error: `Ya existe un recibo con fecha de corte ${datos.fecha_lectura_cfe}`,
        duplicado: true,
      })
    }

    // 3. Insertar recibo
    const recibo = await insertarRecibo(client, servicio_id, datos)

    // 4. Ajustar ciclos — cierra el activo, abre el nuevo
    const resumenAjuste = await ajustarCicloPorRecibo(client, recibo)

    // 5. Actualizar tarifas históricas si el recibo las trae
    if (datos.tarifa_precio_basico && datos.tarifa_precio_excedente) {
      const fechaCorte = new Date(datos.fecha_lectura_cfe)
      const bimestre   = Math.ceil((fechaCorte.getMonth() + 1) / 2)
      const anio       = fechaCorte.getFullYear()
      await client.query(
        `INSERT INTO tarifas_historicas
           (tarifa_tipo, estado_rep, bimestre, anio,
            precio_basico, precio_intermedio, precio_excedente,
            limite_basico, limite_intermedio, dap, apoyo_gubernamental)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tarifa_tipo, estado_rep, bimestre, anio) DO UPDATE SET
           precio_basico       = EXCLUDED.precio_basico,
           precio_intermedio   = EXCLUDED.precio_intermedio,
           precio_excedente    = EXCLUDED.precio_excedente,
           dap                 = EXCLUDED.dap,
           apoyo_gubernamental = EXCLUDED.apoyo_gubernamental`,
        [
          '1', datos.estado_rep || 'Querétaro',
          bimestre, anio,
          datos.tarifa_precio_basico,
          datos.tarifa_precio_intermedio,
          datos.tarifa_precio_excedente,
          datos.tarifa_limite_basico    || 150,
          datos.tarifa_limite_intermedio || 280,
          datos.dap                     || null,
          datos.apoyo_gubernamental     || null,
        ]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({
      ok: true,
      recibo,
      ajuste: resumenAjuste,
      requiere_revision: (datos.confianza || 100) < 85,
      confianza: datos.confianza || 100,
    })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('POST /onboarding/recibo-nuevo error:', err)
    res.status(500).json({ error: 'Error al procesar el recibo', detalle: err.message })
  } finally {
    client.release()
    if (req.file) fs.unlink(req.file.path, () => {})
  }
})


// ── POST /api/onboarding/recibo-nuevo-xml ─────────────────────────────────────
// Sube el recibo más reciente como XML/CFDI (sin Claude, 100% determinista)
// Cierra el ciclo activo y abre el nuevo, igual que recibo-nuevo.
router.post('/recibo-nuevo-xml', auth, upload.single('archivo'), async (req, res) => {
  const { servicio_id } = req.body
  if (!servicio_id || !req.file)
    return res.status(400).json({ error: 'servicio_id y archivo requeridos' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Parsear XML
    const xml   = fs.readFileSync(req.file.path, 'utf8')
    const datos = parsearXMLCFDI(xml)

    if (!datos.fecha_lectura_cfe)
      return res.status(422).json({ error: 'No se pudo determinar la fecha de corte del XML' })

    // 2. Necesitamos lectura_anterior y lectura_actual
    // Para el recibo más reciente, buscar ancla en DB
    const { rows: existentes } = await client.query(
      `SELECT fecha_lectura_cfe, lectura_actual, extraccion_revisada
       FROM recibos WHERE servicio_id=$1
       ORDER BY fecha_lectura_cfe DESC LIMIT 5`,
      [servicio_id]
    )
    const ancla = existentes.find(r => r.extraccion_revisada) || existentes[0]
    if (!ancla)
      return res.status(422).json({
        error: 'No hay recibos previos para anclar las lecturas. Sube primero los recibos históricos.',
      })

    datos.lectura_anterior = parseInt(ancla.lectura_actual)
    datos.lectura_actual   = datos.lectura_anterior + datos.consumo_kwh

    // 3. Verificar duplicado
    const { rows: dup } = await client.query(
      `SELECT id FROM recibos WHERE servicio_id=$1 AND fecha_lectura_cfe=$2`,
      [servicio_id, datos.fecha_lectura_cfe]
    )
    if (dup.length) {
      await client.query('ROLLBACK')
      return res.status(409).json({
        error: `Ya existe un recibo con fecha de corte ${datos.fecha_lectura_cfe}`,
        duplicado: true,
      })
    }

    // 4. Insertar recibo con confianza 100
    const { rows: reciboRows } = await client.query(
      `INSERT INTO recibos (
        servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
        lectura_anterior, lectura_actual,
        tarifa_precio_basico, tarifa_precio_intermedio, tarifa_precio_excedente,
        tarifa_limite_basico, tarifa_limite_intermedio,
        cargo_suministro, cargo_distribucion, cargo_transmision,
        cargo_cenace, cargo_energia, cargo_capacidad, cargo_scnmen,
        apoyo_gubernamental, dap, subtotal, impuestos, total,
        extraccion_confianza, extraccion_revisada
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,100,true)
      RETURNING *`,
      [
        servicio_id, datos.fecha_emision, datos.fecha_lectura_cfe,
        datos.periodo_inicio, datos.periodo_fin,
        datos.lectura_anterior, datos.lectura_actual,
        datos.tarifa_precio_basico,     datos.tarifa_precio_intermedio,  datos.tarifa_precio_excedente,
        datos.tarifa_limite_basico,     datos.tarifa_limite_intermedio,
        datos.cargo_suministro || null, datos.cargo_distribucion || null, datos.cargo_transmision || null,
        datos.cargo_cenace    || null,  datos.cargo_energia      || null, datos.cargo_capacidad   || null,
        datos.cargo_scnmen    || null,  datos.apoyo_gubernamental,
        datos.dap, datos.subtotal, datos.impuestos, datos.total,
      ]
    )
    const recibo = reciboRows[0]

    // 5. Ajustar ciclos
    const resumenAjuste = await ajustarCicloPorRecibo(client, recibo)

    // 6. Actualizar tarifas históricas
    if (datos.tarifa_precio_basico) {
      const fechaCorte = new Date(datos.fecha_lectura_cfe)
      const bimestre   = Math.ceil((fechaCorte.getMonth() + 1) / 2)
      const anio       = fechaCorte.getFullYear()
      await client.query(
        `INSERT INTO tarifas_historicas
           (tarifa_tipo, estado_rep, bimestre, anio,
            precio_basico, precio_intermedio, precio_excedente,
            limite_basico, limite_intermedio, dap, apoyo_gubernamental)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tarifa_tipo, estado_rep, bimestre, anio) DO UPDATE SET
           precio_basico     = EXCLUDED.precio_basico,
           precio_intermedio = EXCLUDED.precio_intermedio,
           precio_excedente  = EXCLUDED.precio_excedente,
           dap               = EXCLUDED.dap`,
        [
          '1', 'Querétaro', bimestre, anio,
          datos.tarifa_precio_basico, datos.tarifa_precio_intermedio, datos.tarifa_precio_excedente,
          datos.tarifa_limite_basico || 150, datos.tarifa_limite_intermedio || 280,
          datos.dap || null, datos.apoyo_gubernamental || null,
        ]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ ok: true, recibo, ajuste: resumenAjuste, confianza: 100 })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('POST /onboarding/recibo-nuevo-xml error:', err)
    res.status(500).json({ error: 'Error al procesar el XML', detalle: err.message })
  } finally {
    client.release()
    if (req.file) fs.unlink(req.file.path, () => {})
  }
})

module.exports = router
