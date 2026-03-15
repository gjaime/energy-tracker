# ⚡ Energy Tracker

Webapp para monitoreo de consumo eléctrico bimestral en México (CFE).  
Registro diario de lecturas del medidor, importación de recibos vía PDF o XML/CFDI con extracción automática, y bot de Telegram para registro desde el celular.

---

## 🗂 Estructura del proyecto

```
energy-tracker/
├── backend/          → API REST (Node.js + Express)
├── frontend/         → Interfaz web (React + Vite)
├── database/         → Scripts SQL de inicialización
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
│         LXC / VM / VPS                  │
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

### 1. Clonar el repositorio

```bash
git clone https://github.com/gjaime/energy-tracker.git
cd energy-tracker
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
nano .env
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
1. Abre http://<tu-ip>:5678
2. Workflows → Import from file → n8n/energy-workflow.json
3. Credentials → Telegram API → pegar token de @BotFather
4. Credentials → Header Auth → pegar N8N_API_KEY
5. Activar el workflow
```

### 6. Acceder

| Servicio | URL |
|---|---|
| Webapp | `http://<tu-ip>` |
| n8n | `http://<tu-ip>:5678` |
| API health | `http://<tu-ip>/health` |

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

## 📋 Importación de recibos históricos

El sistema soporta dos métodos para cargar el historial de recibos CFE:

### XML / CFDI (recomendado)
Los archivos XML descargados desde el portal de CFE contienen todos los datos estructurados y son la fuente de verdad. El parser es 100% determinista — no requiere IA ni puede cometer errores de OCR. Los XMLs también pueden **corregir y sobreescribir** datos de recibos previamente cargados por PDF.

### PDF / Imagen
Los PDFs son procesados por Claude AI para extracción automática de datos. Útil cuando no se tienen los XMLs disponibles. La confianza de extracción se muestra en la interfaz.

---

## 🔐 Primer acceso

Al iniciar por primera vez, el sistema te guiará por un proceso de onboarding de 4 pasos:

1. **Recibo más reciente** — sube tu último recibo CFE (PDF) para extraer los datos del ciclo actual
2. **Lectura de hoy** — ingresa la lectura actual de tu medidor físico
3. **Historial** — carga recibos anteriores para habilitar tendencias (opcional, recomendado XML)
4. **Listo** — accede al dashboard completo

> ⚠️ Cambia la contraseña por defecto en la sección **Configuración → Cuenta** después del primer acceso.

---

## ⚙️ Comandos útiles

```bash
# Ver todos los servicios
docker compose ps

# Ver logs en tiempo real
docker compose logs -f
docker compose logs -f backend

# Reiniciar un servicio
docker compose restart backend

# Resetear la base de datos (⚠️ borra todo)
docker compose down -v && docker compose up -d

# Entrar a psql
docker compose exec database psql -U energy_user -d energy_tracker
```

---

## 📁 Variables de entorno

Ver `.env.example` para la referencia completa. Nunca subas tu `.env` al repositorio.

```bash
# Generar claves seguras
openssl rand -hex 32   # para SECRET_KEY, N8N_ENCRYPTION_KEY, N8N_API_KEY
```
