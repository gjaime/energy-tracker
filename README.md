# ⚡ Energy Tracker

Webapp para monitoreo de consumo eléctrico bimestral en México (CFE).
Registro diario de lecturas del medidor, importación de recibos PDF con extracción automática via Claude AI, y bot de Telegram para registro desde el celular.

---

## 🗂 Estructura del proyecto

```
energy-tracker/
├── backend/          → API REST (Node.js + Express)
├── frontend/         → Interfaz web (React + Vite)
├── database/         → Scripts SQL de inicialización y seed
├── n8n/              → Workflow de Telegram importable
├── nginx/            → Reverse proxy
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🏗 Arquitectura

```
Tu celular
    │
    ▼
 Telegram ──webhook──► n8n (:5678)
                         │
                         │ http://backend:3847  (red interna Docker)
                         ▼
┌─────────────────────────────────────────┐
│         LXC 10.13.69.90                │
│                                         │
│  nginx (:80)                            │
│    ├── / ──────► frontend (:3000)       │
│    └── /api ───► backend (:3847)        │
│                     │                  │
│              PostgreSQL (:5432)         │
│                                         │
│  n8n (:5678) ──► backend (:3847)        │
└─────────────────────────────────────────┘
                    │
              ☁️ Anthropic API
          (extracción de recibos PDF)
```

---

## 🚀 Instalación

### 1. Crear el LXC en Proxmox

```bash
# Desde la terminal del host pve01
chmod +x setup-lxc-proxmox.sh
./setup-lxc-proxmox.sh
```

El script crea el LXC `.105` con Debian 12, instala Docker y clona el repo.

### 2. Configurar variables de entorno

```bash
pct enter 105
nano /opt/energy-tracker/.env
```

Ver `.env.example` para la lista completa. Variables mínimas requeridas:

| Variable | Descripción |
|---|---|
| `DB_PASSWORD` | Contraseña de PostgreSQL |
| `SECRET_KEY` | Clave JWT — `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | API key de Anthropic |
| `N8N_UI_PASSWORD` | Contraseña de acceso a n8n |
| `N8N_ENCRYPTION_KEY` | Clave de encriptación n8n — `openssl rand -hex 32` |
| `N8N_API_KEY` | API key para autenticar n8n → backend — `openssl rand -hex 32` |

### 3. Levantar los servicios

```bash
cd /opt/energy-tracker
docker compose up -d
docker compose ps
```

### 4. Obtener UUIDs para el .env

Después del primer deploy, obtener los UUIDs reales:

```bash
# UUID del usuario admin (para N8N_SERVICE_USER_ID)
docker compose exec database psql -U energy_user -d energy_tracker \
  -c "SELECT id, email FROM usuarios;"

# UUID del servicio CFE (para ENERGY_SERVICIO_ID)
docker compose exec database psql -U energy_user -d energy_tracker \
  -c "SELECT id, alias, numero_servicio FROM servicios;"
```

Actualizar `.env` con esos valores y reiniciar:
```bash
docker compose restart backend n8n
```

### 5. Configurar el bot de Telegram en n8n

```
1. Abre http://10.13.69.90:5678
2. Workflows → Import from file → n8n/energy-workflow.json
3. Credentials → Telegram API → pegar token de @BotFather
4. Credentials → Header Auth → pegar N8N_API_KEY
5. Activar el workflow
```

### 6. Acceder

| Servicio | URL |
|---|---|
| Webapp | `http://10.13.69.90` |
| n8n | `http://10.13.69.90:5678` |
| API health | `http://10.13.69.90/health` |

---

## 📦 Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite + Recharts |
| Backend | Node.js 20 + Express |
| Base de datos | PostgreSQL 16 |
| Telegram bridge | n8n (self-hosted) |
| Extracción PDF | Claude API (Anthropic) |
| Proxy | Nginx Alpine |
| Contenedores | Docker Compose |

---

## 🤖 Comandos de Telegram

| Comando | Ejemplo |
|---|---|
| `/lectura <val> [nota]` | `/lectura 17580` |
| `/lectura <val> <fecha> [nota]` | `/lectura 17580 2026-03-01 Lavado` |
| `/cierre <val> [nota]` | `/cierre 17610` |
| `/evento <val> [nota]` | `/evento 17580 Revisión` |
| `/confirmar <id>` | `/confirmar abc12345` |
| `/cancelar <id>` | `/cancelar abc12345` |
| `/estado` | resumen del ciclo actual |
| `/ayuda` | lista de comandos |

---

## ⚙️ Comandos útiles

```bash
# Ver todos los servicios
docker compose ps

# Ver logs en tiempo real
docker compose logs -f
docker compose logs -f backend
docker compose logs -f n8n

# Reiniciar un servicio
docker compose restart backend

# Resetear la base de datos (⚠️ borra todo)
docker compose down -v && docker compose up -d

# Entrar a psql
docker compose exec database psql -U energy_user -d energy_tracker
```
