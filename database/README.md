# Base de datos — CFE Tracker

Scripts SQL ejecutados automáticamente al iniciar el contenedor PostgreSQL.

## Archivos

| Archivo | Descripción |
|---|---|
| `init/01_schema.sql` | Tablas, índices, triggers y datos iniciales |
| `init/02_views.sql` | Vistas para consultas frecuentes del backend |

## Tablas

| Tabla | Descripción |
|---|---|
| `usuarios` | Usuarios del sistema |
| `servicios` | Contratos CFE por usuario |
| `ciclos` | Bimestres de consumo |
| `eventos` | Lecturas diarias del medidor |
| `recibos` | Datos extraídos de PDFs importados |
| `tarifas_historicas` | Precios por bimestre para proyecciones |
| `telegram_sesiones` | Estado del bot por usuario |

## Vistas

| Vista | Descripción |
|---|---|
| `v_ciclo_activo` | Ciclo abierto con consumo acumulado y nivel de alerta |
| `v_consumo_diario` | Consumo diario calculado por diferencia entre lecturas |
| `v_historico_ciclos` | Ciclos cerrados con costo total del recibo |

## Migraciones futuras

Agregar archivos numerados en `init/`:
```
03_migracion_descripcion.sql
04_migracion_descripcion.sql
...
```
