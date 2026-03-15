const pool = require('../db/pool')

// ─────────────────────────────────────────────────────────────
// HELPERS BÁSICOS
// ─────────────────────────────────────────────────────────────

async function obtenerCicloActivo(servicioId) {
  const { rows } = await pool.query(
    `SELECT * FROM ciclos WHERE servicio_id = $1 AND estado = 'abierto'
     ORDER BY fecha_inicio DESC LIMIT 1`,
    [servicioId]
  )
  return rows[0] || null
}

async function calcularPromedioDiario(cicloId) {
  // Solo sobre lecturas REALES (no estimadas del sistema)
  const { rows } = await pool.query(
    `SELECT AVG(consumo_dia) as promedio
     FROM eventos
     WHERE ciclo_id = $1
       AND tipo = 'lectura_diaria'
       AND consumo_dia > 0
       AND fuente != 'sistema'`,
    [cicloId]
  )
  return parseFloat(rows[0]?.promedio) || null
}

function evaluarAlertaCiclo(ciclo) {
  if (!ciclo || ciclo.estado !== 'abierto') return null
  const dias = Math.floor((new Date() - new Date(ciclo.fecha_inicio)) / 86400000)
  if (dias > 75) return {
    nivel: 'critico',
    dias,
    mensaje: `Este ciclo lleva ${dias} días. Los ciclos suelen ser de 60 días. Por favor carga el último recibo para tener datos actualizados.`,
  }
  if (dias > 60) return {
    nivel: 'advertencia',
    dias,
    mensaje: `Este ciclo lleva ${dias} días. Los ciclos suelen ser de 60 días. Por favor carga el último recibo para tener datos actualizados.`,
  }
  return null
}

function diasEntre(fechaA, fechaB) {
  return Math.round((new Date(fechaB + 'T12:00:00') - new Date(fechaA + 'T12:00:00')) / 86400000)
}

// ─────────────────────────────────────────────────────────────
// INTERPOLACIÓN DE GAPS
// ─────────────────────────────────────────────────────────────

function buildSegmentoEstimado(desde, hasta, label) {
  const totalDias = diasEntre(desde.fecha, hasta.fecha)
  const gapDias   = totalDias - 1
  if (gapDias <= 0) return []

  const delta   = hasta.lectura - desde.lectura
  const base    = Math.floor(delta / totalDias)
  const residuo = delta - base * totalDias

  const estimados = []
  let acc = desde.lectura
  const d1 = new Date(desde.fecha + 'T12:00:00')

  for (let i = 1; i <= gapDias; i++) {
    const d = new Date(d1)
    d.setDate(d.getDate() + i)
    const fechaStr   = d.toISOString().split('T')[0]
    const kwhHoy     = i === gapDias ? base + residuo : base
    acc += kwhHoy
    estimados.push({
      fecha:       fechaStr,
      lectura:     acc,
      consumo_dia: kwhHoy,
      notas:       label,
    })
  }
  return estimados
}

function normalizarFecha(f) {
  if (!f) return f
  // PostgreSQL devuelve DATE como objeto Date en node-postgres
  if (f instanceof Date) return f.toISOString().slice(0, 10)
  // También puede llegar como string timestamp
  return String(f).slice(0, 10)
}

function generarEstimados(registrosExistentes, nuevaEntrada) {
  const sorted = [...registrosExistentes]
    .map(r => ({ ...r, fecha: normalizarFecha(r.fecha) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
  const ultima = sorted[sorted.length - 1]
  if (!ultima) return []

  const gap = diasEntre(ultima.fecha, nuevaEntrada.fecha)
  if (gap <= 1) return []

  // ¿Hay ancla CFE dentro del gap?
  const ancla = sorted.find(r =>
    r.tipo === 'cierre_ciclo' &&
    r.fecha > ultima.fecha &&
    r.fecha < nuevaEntrada.fecha
  )

  if (ancla) {
    const segA = buildSegmentoEstimado(
      { fecha: ultima.fecha, lectura: ultima.lectura_valor },
      { fecha: ancla.fecha,  lectura: ancla.lectura_valor  },
      `[auto] estimada retroactiva → ancla CFE ${ancla.fecha}`
    )
    const segB = buildSegmentoEstimado(
      { fecha: ancla.fecha,        lectura: ancla.lectura_valor  },
      { fecha: nuevaEntrada.fecha, lectura: nuevaEntrada.lectura },
      `[auto] interpolada entre ${ancla.fecha} y ${nuevaEntrada.fecha}`
    )
    return [...segA, ...segB]
  }

  return buildSegmentoEstimado(
    { fecha: ultima.fecha, lectura: ultima.lectura_valor },
    { fecha: nuevaEntrada.fecha, lectura: nuevaEntrada.lectura },
    `[auto] interpolada entre ${ultima.fecha} y ${nuevaEntrada.fecha}`
  )
}

async function insertarLecturaConInterpolacion(client, {
  cicloId, servicioId, fechaRegistro, lecturaInt, tipo, fuente, esBacking, notaFinal
}) {
  const { rows: existentes } = await client.query(
    `SELECT fecha, lectura_valor, tipo FROM eventos
     WHERE ciclo_id = $1 ORDER BY fecha ASC, created_at ASC`,
    [cicloId]
  )

  const estimados = generarEstimados(existentes, { fecha: fechaRegistro, lectura: lecturaInt })

  const insertados = []

  for (const est of estimados) {
    const { rows } = await client.query(
      `INSERT INTO eventos
         (ciclo_id, servicio_id, fecha, lectura_valor, consumo_dia,
          tipo, fuente, sobreescrita, notas)
       VALUES ($1,$2,$3,$4,$5,'lectura_diaria','sistema',false,$6)
       RETURNING *`,
      [cicloId, servicioId, est.fecha, est.lectura, est.consumo_dia, est.notas]
    )
    insertados.push(rows[0])
  }

  // consumo_dia de la lectura real = diferencia con el último registro
  const todosOrdenados = [
    ...existentes,
    ...estimados.map(e => ({ fecha: e.fecha, lectura_valor: e.lectura }))
  ].sort((a, b) => a.fecha.localeCompare(b.fecha))

  const anterior    = todosOrdenados[todosOrdenados.length - 1]
  const consumoDia  = anterior ? lecturaInt - anterior.lectura_valor : 0

  const { rows: nuevo } = await client.query(
    `INSERT INTO eventos
       (ciclo_id, servicio_id, fecha, lectura_valor, consumo_dia,
        tipo, fuente, es_backdating, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [cicloId, servicioId, fechaRegistro, lecturaInt, Math.max(0, consumoDia),
     tipo, fuente, esBacking, notaFinal]
  )
  insertados.push(nuevo[0])

  return insertados
}

// ─────────────────────────────────────────────────────────────
// AJUSTE RETROACTIVO AL IMPORTAR UN RECIBO
// Regla fecha: < corte → ciclo cerrado | >= corte → nuevo ciclo
// ─────────────────────────────────────────────────────────────

async function ajustarCicloPorRecibo(client, recibo) {
  const fechaCorteStr  = recibo.fecha_lectura_cfe
  const fechaCorte     = new Date(fechaCorteStr + 'T12:00:00')
  const lecturaCorte   = recibo.lectura_actual
  const servicioId     = recibo.servicio_id
  const hoy            = new Date()
  const diasDesdeCorte = Math.floor((hoy - fechaCorte) / 86400000)

  const resumen = {
    fechaCorte:          fechaCorteStr,
    diasDesdeCorte,
    ciclosVaciosCreados: 0,
    eventosReasignados:  0,
    alertas:             [],
  }

  const { rows: ciclosActivos } = await client.query(
    `SELECT * FROM ciclos WHERE servicio_id = $1 AND estado = 'abierto'
     ORDER BY fecha_inicio DESC LIMIT 1`,
    [servicioId]
  )
  const cicloActivo = ciclosActivos[0]

  if (!cicloActivo) {
    const nuevo = await _crearNuevoCiclo(client, servicioId, fechaCorteStr, lecturaCorte, recibo.id)
    await client.query(
      `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, tipo, fuente, notas)
       VALUES ($1,$2,$3,$4,'apertura_ciclo','sistema','Apertura automática desde recibo importado')`,
      [nuevo.id, servicioId, fechaCorteStr, lecturaCorte]
    )
    resumen.alertas.push('No existía ciclo abierto. Se creó uno nuevo desde el recibo.')
    return resumen
  }

  // Clasificar eventos: fecha < corte → A (ciclo cerrado) | >= corte → B (nuevo ciclo)
  const { rows: todosEventos } = await client.query(
    `SELECT * FROM eventos WHERE ciclo_id = $1 ORDER BY fecha ASC`,
    [cicloActivo.id]
  )

  const grupoA = todosEventos.filter(e => new Date(e.fecha + 'T12:00:00') <  fechaCorte)
  const grupoB = todosEventos.filter(e => new Date(e.fecha + 'T12:00:00') >= fechaCorte)

  // Marcar como sobreescritas las lecturas del día exacto del corte
  for (const e of grupoB.filter(e => e.fecha === fechaCorteStr)) {
    await client.query(
      `UPDATE eventos
       SET sobreescrita = true,
           notas = COALESCE(notas,'') || ' [sobreescrita por lectura oficial CFE]'
       WHERE id = $1`,
      [e.id]
    )
  }

  // Cerrar ciclo activo
  await client.query(
    `UPDATE ciclos
     SET fecha_fin = $1, lectura_final = $2, estado = 'cerrado',
         recibo_id = $3, fuente_cierre = 'recibo_importado'
     WHERE id = $4`,
    [fechaCorteStr, lecturaCorte, recibo.id, cicloActivo.id]
  )

  // Insertar evento de cierre oficial en el ciclo cerrado
  await client.query(
    `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, tipo, fuente, notas)
     VALUES ($1,$2,$3,$4,'cierre_ciclo','recibo_importado','Lectura oficial CFE')`,
    [cicloActivo.id, servicioId, fechaCorteStr, lecturaCorte]
  )

  // Ciclos vacíos intermedios si el recibo es antiguo
  let fechaNuevoCiclo = fechaCorteStr

  if (diasDesdeCorte > 60) {
    const ciclosFaltantes = Math.floor(diasDesdeCorte / 60)
    const intermedios     = Math.max(0, ciclosFaltantes - 1)

    if (intermedios > 0) {
      resumen.alertas.push(
        `Recibo con ${diasDesdeCorte} días de antigüedad. Se crean ${intermedios} ciclo(s) intermedio(s) vacío(s).`
      )
      let fechaIni = fechaCorteStr
      for (let i = 0; i < intermedios; i++) {
        const fechaFin = new Date(new Date(fechaIni + 'T12:00:00').getTime() + 60 * 86400000)
          .toISOString().split('T')[0]
        await client.query(
          `INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, estado)
           VALUES ($1,$2,$3,$4,'sin_recibo_pendiente')`,
          [servicioId, fechaIni, fechaFin, lecturaCorte]
        )
        resumen.ciclosVaciosCreados++
        fechaIni = fechaFin
      }
      fechaNuevoCiclo = fechaIni
    }
  }

  // Crear nuevo ciclo abierto
  const nuevoCiclo = await _crearNuevoCiclo(client, servicioId, fechaNuevoCiclo, lecturaCorte)

  // Evento de apertura en el nuevo ciclo
  await client.query(
    `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, tipo, fuente, notas)
     VALUES ($1,$2,$3,$4,'apertura_ciclo','sistema','Apertura automática tras importación de recibo')`,
    [nuevoCiclo.id, servicioId, fechaNuevoCiclo, lecturaCorte]
  )

  // Reasignar grupoB al nuevo ciclo
  for (const e of grupoB) {
    await client.query(`UPDATE eventos SET ciclo_id = $1 WHERE id = $2`, [nuevoCiclo.id, e.id])
    resumen.eventosReasignados++
  }

  // Recalcular consumos del nuevo ciclo desde la lectura de apertura
  await _recalcularConsumos(client, nuevoCiclo.id, lecturaCorte)

  return resumen
}

// ─────────────────────────────────────────────────────────────
// TARIFA VIGENTE
// ─────────────────────────────────────────────────────────────

async function obtenerTarifaVigente(servicioId) {
  const { rows } = await pool.query(
    `SELECT
       tarifa_precio_basico, tarifa_precio_intermedio, tarifa_precio_excedente,
       tarifa_limite_basico, tarifa_limite_intermedio, dap, fecha_lectura_cfe
     FROM recibos
     WHERE servicio_id = $1 AND tarifa_precio_basico IS NOT NULL
     ORDER BY fecha_lectura_cfe DESC LIMIT 1`,
    [servicioId]
  )
  if (!rows[0]) return null
  const r = rows[0]
  return {
    bas_lim: r.tarifa_limite_basico     || 150,
    int_lim: r.tarifa_limite_intermedio || 280,
    p_bas:   Number(r.tarifa_precio_basico),
    p_int:   Number(r.tarifa_precio_intermedio),
    p_exc:   Number(r.tarifa_precio_excedente),
    dap:     Number(r.dap) || 68.37,
    iva:     0.16,
    fuente:  r.fecha_lectura_cfe,
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────

async function _crearNuevoCiclo(client, servicioId, fechaInicio, lecturaInicial, reciboId = null) {
  const { rows } = await client.query(
    `INSERT INTO ciclos (servicio_id, fecha_inicio, lectura_inicial, estado, recibo_id)
     VALUES ($1,$2,$3,'abierto',$4) RETURNING *`,
    [servicioId, fechaInicio, lecturaInicial, reciboId]
  )
  return rows[0]
}

async function _recalcularConsumos(client, cicloId, lecturaInicial) {
  const { rows } = await client.query(
    `SELECT * FROM eventos
     WHERE ciclo_id = $1
       AND tipo IN ('lectura_diaria','cierre_ciclo','apertura_ciclo')
     ORDER BY fecha ASC, created_at ASC`,
    [cicloId]
  )
  let prev = lecturaInicial
  for (const e of rows) {
    if (e.tipo === 'apertura_ciclo') { prev = e.lectura_valor; continue }
    const consumo = Math.max(0, e.lectura_valor - prev)
    await client.query(`UPDATE eventos SET consumo_dia = $1 WHERE id = $2`, [consumo, e.id])
    prev = e.lectura_valor
  }
}

module.exports = {
  obtenerCicloActivo,
  calcularPromedioDiario,
  evaluarAlertaCiclo,
  ajustarCicloPorRecibo,
  generarEstimados,
  insertarLecturaConInterpolacion,
  obtenerTarifaVigente,
}
