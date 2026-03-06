const pool = require('../db/pool')

// Obtener ciclo activo de un servicio
async function obtenerCicloActivo(servicioId) {
  const { rows } = await pool.query(
    `SELECT * FROM ciclos WHERE servicio_id = $1 AND estado = 'abierto' LIMIT 1`,
    [servicioId]
  )
  return rows[0] || null
}

// Calcular promedio diario real (solo lecturas no estimadas)
async function calcularPromedioDiario(cicloId) {
  const { rows } = await pool.query(
    `SELECT AVG(consumo_dia) as promedio
     FROM eventos
     WHERE ciclo_id = $1 AND tipo = 'lectura_diaria' AND consumo_dia > 0`,
    [cicloId]
  )
  return parseFloat(rows[0]?.promedio) || null
}

// Última lectura del ciclo
async function ultimaLectura(cicloId) {
  const { rows } = await pool.query(
    `SELECT * FROM eventos
     WHERE ciclo_id = $1 AND tipo IN ('lectura_diaria','apertura_ciclo')
     ORDER BY fecha DESC, created_at DESC LIMIT 1`,
    [cicloId]
  )
  return rows[0] || null
}

// Calcular consumo_dia respecto a la lectura anterior del ciclo
async function calcularConsumoDia(cicloId, fecha, lecturaValor) {
  const { rows } = await pool.query(
    `SELECT lectura_valor FROM eventos
     WHERE ciclo_id = $1 AND fecha < $2 AND tipo IN ('lectura_diaria','apertura_ciclo')
     ORDER BY fecha DESC, created_at DESC LIMIT 1`,
    [cicloId, fecha]
  )
  if (!rows[0]) return null
  return lecturaValor - rows[0].lectura_valor
}

// Evaluar alerta por ciclo extendido (>60 días)
function evaluarAlertaCiclo(ciclo) {
  if (!ciclo || ciclo.estado !== 'abierto') return null
  const dias = Math.floor((new Date() - new Date(ciclo.fecha_inicio)) / 86400000)
  if (dias > 75) return { nivel: 'critico',     dias, mensaje: `Este ciclo lleva ${dias} días. Por favor cargue el último recibo.` }
  if (dias > 60) return { nivel: 'advertencia', dias, mensaje: `Este ciclo lleva ${dias} días. Por favor cargue el último recibo.` }
  return null
}

// Ajuste retroactivo al importar un recibo
async function ajustarCicloPorRecibo(client, recibo) {
  const fechaCorte   = new Date(recibo.fecha_lectura_cfe)
  const lecturaCorte = recibo.lectura_actual
  const servicioId   = recibo.servicio_id
  const hoy          = new Date()
  const diasDesdeCorte = Math.floor((hoy - fechaCorte) / 86400000)

  const resumen = { fechaCorte: recibo.fecha_lectura_cfe, diasDesdeCorte, ciclosVaciosCreados: 0, eventosReasignados: 0, alertas: [] }

  // Obtener ciclo activo
  const { rows: ciclosActivos } = await client.query(
    `SELECT * FROM ciclos WHERE servicio_id = $1 AND estado = 'abierto' LIMIT 1`,
    [servicioId]
  )
  const cicloActivo = ciclosActivos[0]

  if (!cicloActivo) {
    await _crearNuevoCiclo(client, servicioId, recibo.fecha_lectura_cfe, lecturaCorte, recibo.id)
    resumen.alertas.push('No existía ciclo abierto. Se creó uno nuevo desde el recibo.')
    return resumen
  }

  // Clasificar eventos: grupo A (< corte) y grupo B (>= corte)
  const { rows: todosEventos } = await client.query(
    `SELECT * FROM eventos WHERE ciclo_id = $1 ORDER BY fecha`,
    [cicloActivo.id]
  )
  const grupoA = todosEventos.filter(e => new Date(e.fecha) < fechaCorte)
  const grupoB = todosEventos.filter(e => new Date(e.fecha) >= fechaCorte)

  // Marcar lecturas del día del corte como sobreescritas
  for (const e of grupoB.filter(e => e.fecha === recibo.fecha_lectura_cfe)) {
    await client.query(`UPDATE eventos SET sobreescrita = true, notas = COALESCE(notas,'') || ' [sobreescrita por recibo CFE]' WHERE id = $1`, [e.id])
  }

  // Cerrar ciclo activo
  await client.query(
    `UPDATE ciclos SET fecha_fin=$1, lectura_final=$2, estado='cerrado', recibo_id=$3, fuente_cierre='recibo_importado' WHERE id=$4`,
    [recibo.fecha_lectura_cfe, lecturaCorte, recibo.id, cicloActivo.id]
  )

  // Insertar evento de cierre
  await client.query(
    `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, tipo, fuente, notas)
     VALUES ($1,$2,$3,$4,'cierre_ciclo','recibo_importado','Lectura oficial CFE')`,
    [cicloActivo.id, servicioId, recibo.fecha_lectura_cfe, lecturaCorte]
  )

  // Crear ciclos vacíos intermedios si el recibo es antiguo
  let fechaNuevoCiclo = recibo.fecha_lectura_cfe
  if (diasDesdeCorte > 60) {
    const ciclosFaltantes = Math.floor(diasDesdeCorte / 60)
    resumen.alertas.push(`Recibo con ${diasDesdeCorte} días de antigüedad. Se crearán ${ciclosFaltantes - 1} ciclo(s) intermedio(s) vacío(s).`)
    let fechaIni = recibo.fecha_lectura_cfe
    for (let i = 0; i < ciclosFaltantes - 1; i++) {
      const fechaFin = new Date(new Date(fechaIni).getTime() + 60 * 86400000).toISOString().split('T')[0]
      await client.query(
        `INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, estado) VALUES ($1,$2,$3,$4,'sin_recibo_pendiente')`,
        [servicioId, fechaIni, fechaFin, lecturaCorte]
      )
      resumen.ciclosVaciosCreados++
      fechaIni = fechaFin
    }
    fechaNuevoCiclo = fechaIni
  }

  // Crear nuevo ciclo activo
  const nuevoCiclo = await _crearNuevoCiclo(client, servicioId, fechaNuevoCiclo, lecturaCorte)

  // Evento de apertura
  await client.query(
    `INSERT INTO eventos (ciclo_id, servicio_id, fecha, lectura_valor, tipo, fuente, notas)
     VALUES ($1,$2,$3,$4,'apertura_ciclo','sistema','Apertura automática tras importación de recibo')`,
    [nuevoCiclo.id, servicioId, fechaNuevoCiclo, lecturaCorte]
  )

  // Reasignar grupo B al nuevo ciclo
  for (const e of grupoB) {
    await client.query(`UPDATE eventos SET ciclo_id = $1 WHERE id = $2`, [nuevoCiclo.id, e.id])
    resumen.eventosReasignados++
  }

  // Recalcular consumos del nuevo ciclo
  await _recalcularConsumos(client, nuevoCiclo.id, lecturaCorte)

  return resumen
}

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
    `SELECT * FROM eventos WHERE ciclo_id=$1 AND tipo='lectura_diaria' ORDER BY fecha`,
    [cicloId]
  )
  let prev = lecturaInicial
  for (const e of rows) {
    const consumo = e.lectura_valor - prev
    await client.query(`UPDATE eventos SET consumo_dia=$1 WHERE id=$2`, [consumo, e.id])
    prev = e.lectura_valor
  }
}

module.exports = { obtenerCicloActivo, calcularPromedioDiario, ultimaLectura, calcularConsumoDia, evaluarAlertaCiclo, ajustarCicloPorRecibo }
