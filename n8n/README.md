# n8n — Energy Tracker

n8n corre como un servicio más dentro del `docker-compose.yml`.
Es el único puente entre Telegram y el backend API.

## Acceso a la UI

```
http://10.13.69.90:5678
Usuario:    admin  (o el valor de N8N_UI_USER en .env)
Contraseña: valor de N8N_UI_PASSWORD en .env
```

## Importar el workflow

1. Abre `http://10.13.69.90:5678`
2. **Workflows → Import from file**
3. Selecciona `n8n/energy-workflow.json`

## Configurar credenciales en n8n

### 1. Telegram Bot API
- **Credentials → New → Telegram API**
- Token: el que te dio @BotFather
- Nombre: `Telegram Energy Bot`

### 2. Energy API Key
- **Credentials → New → Header Auth**
- Header name:  `X-API-Key`
- Header value: el valor de `N8N_API_KEY` de tu `.env`
- Nombre: `Energy API Key`

## Variables de entorno en n8n

Estas se inyectan automáticamente desde el `.env` via `docker-compose.yml`:

| Variable en n8n | Variable en .env |
|---|---|
| `$env.ENERGY_SERVICIO_ID` | `ENERGY_SERVICIO_ID` |
| `$env.ENERGY_API_KEY` | `N8N_API_KEY` |

Para obtener el `ENERGY_SERVICIO_ID` tras el primer deploy:
```bash
docker compose exec database psql -U cfe_user -d energy_tracker \
  -c "SELECT id, alias FROM servicios;"
```

## Arquitectura de red

Dentro de Docker Compose todos los servicios comparten red interna.
n8n llama al backend directamente por nombre de servicio:

```
n8n (container) → http://backend:3847/api/...
```

No se necesita la IP del LXC ni puerto expuesto para la comunicación interna.

## Comandos soportados

| Comando | Ejemplo | Ruta API |
|---|---|---|
| `/lectura <val> [fecha] [nota]` | `/lectura 17580` | `POST /api/lecturas` |
| `/lectura <val> <fecha> [nota]` | `/lectura 17580 2026-03-01 Lavado` | `POST /api/lecturas` (backdating) |
| `/cierre <val> [nota]` | `/cierre 17610` | `POST /api/lecturas` (tipo: cierre_ciclo) |
| `/evento <val> [nota]` | `/evento 17580 Revisión` | `POST /api/lecturas` (tipo: evento_especial) |
| `/confirmar <id>` | `/confirmar abc12345` | `POST /api/lecturas/confirmar` |
| `/cancelar <id>` | `/cancelar abc12345` | `POST /api/lecturas/cancelar` |
| `/estado` | `/estado` | `GET /api/stats` |
| `/ayuda` | `/ayuda` | (respuesta local) |

## Flujo de datos

```
Tu celular
    │
    ▼
 Telegram
    │  webhook POST
    ▼
  n8n (:5678)           ← dentro del LXC .120
    │  1. Parsea comando con expresiones
    │  2. Valida formato básico
    │  3. HTTP Request → http://backend:3847
    │  4. Formatea respuesta JSON
    ▼
 Telegram
    │
    ▼
Tu celular
```
