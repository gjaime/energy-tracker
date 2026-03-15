-- Vista: ciclo activo por servicio
CREATE VIEW v_ciclo_activo AS
SELECT
    c.id                                        AS ciclo_id,
    c.servicio_id,
    s.alias                                     AS servicio_alias,
    s.numero_servicio,
    s.usuario_id,
    c.fecha_inicio,
    c.lectura_inicial,
    CURRENT_DATE - c.fecha_inicio               AS dias_transcurridos,
    MAX(e.lectura_valor)                        AS ultima_lectura,
    MAX(e.fecha)                                AS fecha_ultima_lectura,
    MAX(e.lectura_valor) - c.lectura_inicial    AS consumo_acumulado,
    CASE
        WHEN (CURRENT_DATE - c.fecha_inicio) > 75 THEN 'critico'
        WHEN (CURRENT_DATE - c.fecha_inicio) > 60 THEN 'advertencia'
        ELSE 'normal'
    END                                         AS estado_alerta
FROM ciclos c
JOIN servicios s ON s.id = c.servicio_id
LEFT JOIN eventos e ON e.ciclo_id = c.id
WHERE c.estado = 'abierto'
GROUP BY c.id, s.id;

-- Vista: consumo diario
CREATE VIEW v_consumo_diario AS
SELECT
    e.id,
    e.servicio_id,
    e.ciclo_id,
    e.fecha,
    e.lectura_valor,
    e.fuente,
    e.sobreescrita,
    LAG(e.lectura_valor) OVER (
        PARTITION BY e.ciclo_id ORDER BY e.fecha
    )                                           AS lectura_anterior,
    e.lectura_valor - LAG(e.lectura_valor) OVER (
        PARTITION BY e.ciclo_id ORDER BY e.fecha
    )                                           AS consumo_kwh_dia
FROM eventos e
WHERE e.tipo = 'lectura_diaria'
ORDER BY e.servicio_id, e.fecha DESC;

-- Vista: histórico de ciclos cerrados
CREATE VIEW v_historico_ciclos AS
SELECT
    c.id                                        AS ciclo_id,
    c.servicio_id,
    s.alias                                     AS servicio_alias,
    s.numero_servicio,
    s.usuario_id,
    c.fecha_inicio,
    c.fecha_fin,
    c.fecha_fin - c.fecha_inicio                AS dias_ciclo,
    c.lectura_inicial,
    c.lectura_final,
    c.lectura_final - c.lectura_inicial         AS consumo_total_kwh,
    r.total                                     AS costo_total,
    r.tarifa_precio_basico,
    r.tarifa_precio_intermedio,
    r.tarifa_precio_excedente,
    r.fecha_emision,
    c.fuente_cierre
FROM ciclos c
JOIN servicios s ON s.id = c.servicio_id
LEFT JOIN recibos r ON r.id = c.recibo_id
WHERE c.estado = 'cerrado'
ORDER BY c.servicio_id, c.fecha_inicio DESC;
