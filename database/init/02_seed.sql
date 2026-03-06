-- =============================================================
-- Energy Tracker v2 — Datos históricos reales
-- Servicio: 076200457478 · Medidor: Y613KR · Querétaro
-- =============================================================

-- Usuario de prueba (password: energy2026 — cambiar en producción)
UPDATE usuarios
SET password_hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
WHERE email = 'admin@energy-tracker.local';

-- Servicio real
INSERT INTO servicios (usuario_id, alias, numero_servicio, numero_medidor, tarifa_tipo, ciudad, estado_rep)
SELECT id, 'Casa', '076200457478', 'Y613KR', '1', 'Querétaro', 'Querétaro'
FROM usuarios WHERE email = 'admin@energy-tracker.local';

-- Ciclos históricos (B1-2024 a B12-2025)
-- Se insertan como cerrados con sus recibos reales
DO $$
DECLARE
  v_servicio_id UUID;
  v_ciclo_id    UUID;
BEGIN
  SELECT id INTO v_servicio_id FROM servicios WHERE numero_servicio = '076200457478';

  -- B1-2024
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2024-02-26', '2024-04-25', 14700, 15114, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2024-04-28', '2024-04-25', '2024-02-26', '2024-04-25',
    14700, 15114, 859.48, 137.52, 997.00);

  -- B2-2024
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2024-04-25', '2024-06-26', 15114, 16026, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2024-06-29', '2024-06-26', '2024-04-25', '2024-06-26',
    15114, 16026, 2820.69, 451.31, 3272.00);

  -- B3-2024
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2024-06-26', '2024-08-28', 16026, 16785, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2024-08-31', '2024-08-28', '2024-06-26', '2024-08-28',
    16026, 16785, 2235.34, 357.66, 2593.00);

  -- B4-2024
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2024-08-28', '2024-10-29', 16785, 17727, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2024-11-01', '2024-10-29', '2024-08-28', '2024-10-29',
    16785, 17727, 2980.17, 476.83, 3457.00);

  -- B5-2024
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2024-10-29', '2024-12-27', 17727, 18709, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2024-12-30', '2024-12-27', '2024-10-29', '2024-12-27',
    17727, 18709, 3161.21, 505.79, 3667.00);

  -- B6-2024
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2024-12-27', '2025-02-25', 18709, 19334, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2025-02-28', '2025-02-25', '2024-12-27', '2025-02-25',
    18709, 19334, 1742.24, 278.76, 2021.00);

  -- B7-2025
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2025-02-25', '2025-04-28', 19334, 20164, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2025-05-01', '2025-04-28', '2025-02-25', '2025-04-28',
    19334, 20164, 2589.66, 414.34, 3004.00);

  -- B8-2025
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2025-04-28', '2025-06-26', 20164, 20891, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2025-06-29', '2025-06-26', '2025-04-28', '2025-06-26',
    20164, 20891, 2186.21, 349.79, 2536.00);

  -- B9-2025
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2025-06-26', '2025-08-27', 20891, 21454, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2025-08-30', '2025-08-27', '2025-06-26', '2025-08-27',
    20891, 21454, 1526.72, 244.28, 1771.00);

  -- B10-2025
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2025-08-27', '2025-10-28', 21454, 21971, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2025-10-31', '2025-10-28', '2025-08-27', '2025-10-28',
    21454, 21971, 1346.55, 215.45, 1562.00);

  -- B11-2025
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2025-10-28', '2025-12-29', 21971, 22443, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual, subtotal, impuestos, total)
  VALUES (v_servicio_id, '2026-01-01', '2025-12-29', '2025-10-28', '2025-12-29',
    21971, 22443, 1167.24, 186.76, 1354.00);

  -- B12-2025 (recibo real completo con MEM)
  INSERT INTO ciclos (servicio_id, fecha_inicio, fecha_fin, lectura_inicial, lectura_final, estado, fuente_cierre)
  VALUES (v_servicio_id, '2025-12-29', '2026-02-25', 22443, 22853, 'cerrado', 'recibo_importado')
  RETURNING id INTO v_ciclo_id;

  INSERT INTO recibos (
    servicio_id, fecha_emision, fecha_lectura_cfe, periodo_inicio, periodo_fin,
    lectura_anterior, lectura_actual,
    tarifa_precio_basico, tarifa_precio_intermedio, tarifa_precio_excedente,
    tarifa_limite_basico, tarifa_limite_intermedio,
    importe_basico, importe_intermedio, importe_excedente,
    cargo_suministro, cargo_distribucion, cargo_transmision,
    cargo_cenace, cargo_energia, cargo_capacidad, cargo_scnmen,
    dap, apoyo_gubernamental,
    subtotal, impuestos, total
  ) VALUES (
    v_servicio_id, '2026-02-28', '2026-02-25', '2025-12-29', '2026-02-25',
    22443, 22853,
    1.1100, 1.3490, 3.9440,
    150, 280,
    166.50, 174.37, 0.00,
    NULL, NULL, NULL,
    NULL, NULL, NULL, NULL,
    68.37, 241.41,
    914.74, 146.36, 1060.10
  );

  -- B1-2026 (ciclo activo)
  INSERT INTO ciclos (servicio_id, fecha_inicio, lectura_inicial, estado)
  VALUES (v_servicio_id, '2026-02-25', 17510, 'abierto');

END $$;

-- Tarifas históricas B12 (vigentes)
INSERT INTO tarifas_historicas
  (tarifa_tipo, estado_rep, bimestre, anio, precio_basico, precio_intermedio,
   precio_excedente, limite_basico, limite_intermedio, dap, apoyo_gubernamental)
VALUES
  ('1', 'Querétaro', 6, 2025, 1.1100, 1.3490, 3.9440, 150, 280, 68.37, 241.41);
