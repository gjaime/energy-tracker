# ⚡ Energy Tracker

Webapp para monitoreo de consumo eléctrico bimestral en México (CFE).
Registro diario de lecturas del medidor, importación de recibos PDF/XML con extracción automática, bot de Telegram para registro desde el celular, e historial de tarifas bimestrales.

> **Demo disponible** — el repo incluye datos ficticios precargados para explorar el dashboard sin necesidad de importar recibos reales. Ver sección [Datos de demostración](#-datos-de-demostración).

---

## 🗂 Estructura del proyecto

```
energy-tracker/
├── backend/          → API REST (Node.js + Express)
├── frontend/         → Interfaz web (React + Vite)
├── database/
│   └── init/
│       ├── 01_schema.sql     → Tablas, índices, triggers
│       ├── 02_views.sql      → Vistas para el backend
│       ├── 03_seed.sql       → Datos reales (ignorado en .gitignore)
│       └── 03_seed_demo.sql  → Datos ficticios para demo pública
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

El script crea el LXC con Debian 12, instala Docker y clona el repo.

### 2. Configurar variables de entorno

```bash
pct enter <CT_ID>
nano /opt/energy-tracker/.env
```

Ver `.env.example` para la lista completa. Variables mínimas requeridas:

| Variable | Descripción |
|---|---|
| `DB_PASSWORD` | Contraseña de PostgreSQL |
| `SECRET_KEY` | Clave JWT — `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | API key de Anthropic (para extracción PDF) |
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
1. Abre http://<IP_LXC>:5678
2. Workflows → Import from file → n8n/energy-workflow.json
3. Credentials → Telegram API → pegar token de @BotFather
4. Credentials → Header Auth → pegar N8N_API_KEY
5. Activar el workflow
```

### 6. Acceder

| Servicio | URL |
|---|---|
| Webapp | `http://<IP_LXC>` |
| n8n | `http://<IP_LXC>:5678` |
| API health | `http://<IP_LXC>/health` |

---

## 🎭 Datos de demostración

El archivo `database/init/03_seed_demo.sql` carga datos ficticios para explorar el dashboard sin necesidad de importar recibos reales:

- **Usuario demo**: `demo@energy-tracker.local` / `demo2026`
- **Servicio ficticio**: Número de servicio y medidor inventados
- **12 ciclos históricos**: 2 años de lecturas simuladas con variación estacional realista
- **Lecturas diarias**: ~180 días de registros en el ciclo actual
- **Tarifas históricas**: Basadas en tarifas reales de CFE publicadas

Para usar datos reales en producción, reemplazar `03_seed_demo.sql` con `03_seed.sql` (ignorado en `.gitignore` para no exponer datos personales).

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

## 🔌 API Reference

### Autenticación
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Login con email y password → JWT |

### Servicios y ciclos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/servicios` | Lista servicios del usuario |
| POST | `/api/servicios` | Crear nuevo servicio |
| GET | `/api/ciclos?servicio_id=` | Histórico de ciclos |
| GET | `/api/stats?servicio_id=` | Resumen del ciclo activo |

### Lecturas
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/lecturas?servicio_id=` | Lecturas del ciclo activo |
| POST | `/api/lecturas` | Registrar lectura (soporta backdating) |
| POST | `/api/lecturas/confirmar` | Confirmar lectura anómala pendiente |
| POST | `/api/lecturas/cancelar` | Cancelar lectura pendiente |

### Recibos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/recibos?servicio_id=` | Lista de recibos importados |

### Onboarding
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/onboarding/recibo-nuevo` | Importar recibo PDF (Claude) — cierra ciclo activo y abre nuevo |
| POST | `/api/onboarding/recibo-nuevo-xml` | Importar recibo XML CFDI — mismo flujo sin Claude |
| POST | `/api/onboarding/historial-xml` | Carga batch de XMLs históricos con validación de cadena |

### Admin
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/perfil` | Perfil del admin |
| GET | `/api/admin/sistema` | Estado general del sistema |
| PUT | `/api/admin/password` | Cambiar contraseña |
| PUT | `/api/admin/servicio/:id` | Editar datos del servicio CFE |

### Respaldo *(pendiente)*
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/backup/export` | Exportar todos los datos en JSON |
| POST | `/api/backup/import` | Importar respaldo JSON |

---

## 🤖 Comandos de Telegram

| Comando | Ejemplo | Descripción |
|---|---|---|
| `/lectura <val> [nota]` | `/lectura 17580` | Lectura diaria |
| `/lectura <val> <fecha> [nota]` | `/lectura 17580 2026-03-01 Lavado` | Lectura con backdating |
| `/cierre <val> [nota]` | `/cierre 17610` | Cierre de ciclo bimestral |
| `/evento <val> [nota]` | `/evento 17580 Revisión` | Evento especial |
| `/confirmar <id>` | `/confirmar abc12345` | Confirmar lectura anómala |
| `/cancelar <id>` | `/cancelar abc12345` | Cancelar lectura pendiente |
| `/estado` | `/estado` | Resumen del ciclo actual |
| `/ayuda` | `/ayuda` | Lista de comandos |

---

## 🗺 Roadmap

### 🔜 Corto plazo

| Feature | Descripción |
|---|---|
| 💾 **Respaldo** | Tab en Dashboard — exportar JSON (descarga + Google Drive client-side) e importar respaldo. Incluye recibos, ciclos, lecturas y config del servicio |
| 👥 **Multi-usuario** | Registro de nuevos usuarios, roles admin/usuario, panel admin para gestión. Cada usuario gestiona sus propios servicios |
| 🏠 **Multi-medidor** | Cada usuario puede registrar más de un servicio CFE desde la UI. Flujo de onboarding multi-servicio |

### 📱 Mediano plazo

| Feature | Descripción |
|---|---|
| 🌐 **Cloudflare Named Tunnel** | URL pública estable con HTTPS para acceso fuera de la red local, sin abrir puertos |
| 🔐 **Google SSO** | Login con cuenta Google como alternativa a email/password. Requiere URL pública HTTPS |
| 📱 **PWA + Responsive** | Manifest para instalar como app en celular, layout adaptado a pantallas pequeñas |
| 📲 **Bot WhatsApp** | Alternativa al bot de Telegram usando n8n con WhatsApp Business API. Mismos comandos |
| 📷 **Lectura por foto del medidor** | El usuario envía una foto del medidor por Telegram o WhatsApp y el sistema extrae la lectura automáticamente usando Claude Vision. Soporta medidores digitales y analógicos. Para analógicos, el prompt guía a Claude sobre la dirección alternada de los diales CFE para evitar errores de lectura. Si la confianza es alta registra automáticamente; si es baja, solicita confirmación al usuario antes de guardar |

### 🔭 Largo plazo

| Feature | Descripción |
|---|---|
| 🔌 **Integración dispositivos IoT** | Vincular cuentas de plataformas cloud (Tuya, Kasa TP-Link, Shelly) para desagregar el consumo diario por dispositivo. Diseño agnóstico de marca — el usuario conecta su cuenta una vez y Energy Tracker jala los datos periódicamente |

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

# Entrar a psql
docker compose exec database psql -U energy_user -d energy_tracker

# Resetear la base de datos (⚠️ borra todo)
docker compose down -v && docker compose up -d
```
