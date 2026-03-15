# ⚡ Energy Tracker

Webapp personal para monitoreo de consumo eléctrico bimestral en México (CFE).  
Registro de lecturas del medidor, importación de recibos PDF con extracción automática via IA, y dashboard de historial de consumo y costos.

---

## 📋 Características

- **Registro de usuarios** con username corto (≤10 caracteres) y PIN de 4 dígitos
- **Wizard de onboarding** guiado para configurar el perfil desde los recibos existentes
- **Extracción automática de recibos** PDF e imagen via Claude AI (Anthropic)
- **Carga de historial en batch** — sube varios recibos a la vez, el sistema los ordena automáticamente
- **Registro de lecturas diarias** desde la webapp
- **Dashboard** con gráfica de consumo diario, tarjetas de resumen e historial de recibos
- **Alertas** cuando el ciclo lleva más de 60 días sin recibo nuevo
- **Aviso de funcionalidades limitadas** cuando hay menos de 2 recibos (proyecciones no disponibles)
- **Panel de administración** para cambio de PIN y estado del sistema

---

## 🏗 Arquitectura

```
Navegador
    │
    ▼
┌─────────────────────────────────────────┐
│         LXC CT 222 · 10.13.69.90        │
│         pve02 · Debian 12               │
│                                         │
│  nginx (:80)                            │
│    ├── /      → frontend (:3000)        │
│    └── /api/  → backend  (:3847)        │
│                                         │
│  backend (Node.js/Express)              │
│    └── PostgreSQL (:5432)               │
│                                         │
│  frontend (React/Vite)                  │
└─────────────────────────────────────────┘
                    │
              ☁️ Anthropic API
         (extracción de recibos PDF)
```

---

## 🗂 Estructura del proyecto

```
energy-tracker/
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js                  → Entry point, registro de rutas
│       ├── db/pool.js                → Pool de conexiones PostgreSQL
│       ├── middleware/auth.js        → JWT middleware
│       ├── services/cicloService.js  → Lógica de ciclos bimestrales
│       └── routes/
│           ├── auth.js               → POST /login, POST /register
│           ├── onboarding.js         → Wizard de configuración inicial
│           ├── lecturas.js           → GET/POST lecturas del medidor
│           ├── servicios.js          → GET servicios del usuario
│           ├── ciclos.js             → GET historial de ciclos
│           ├── recibos.js            → GET recibos importados
│           ├── stats.js              → GET resumen del ciclo activo
│           └── admin.js              → Panel de administración
├── frontend/
│   ├── Dockerfile
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx                  → Rutas React Router
│       ├── api/                      → Capa HTTP (axios)
│       │   ├── client.js             → Axios base + interceptores JWT
│       │   ├── auth.js
│       │   ├── onboarding.js
│       │   ├── servicios.js
│       │   ├── eventos.js
│       │   ├── recibos.js
│       │   └── admin.js
│       ├── context/AuthContext.jsx   → Sesión global (login/logout/onboarding)
│       ├── components/
│       │   ├── layout/ProtectedRoute.jsx
│       │   └── ui/AlertaCiclo.jsx
│       └── pages/
│           ├── Login.jsx             → Login + registro en una pantalla
│           ├── Onboarding.jsx        → Wizard 4 pasos
│           ├── Dashboard.jsx         → Vista principal (3 tabs)
│           └── Admin.jsx             → Panel de configuración
├── database/
│   └── init/
│       ├── 01_schema.sql             → Tablas, índices, triggers
│       └── 02_views.sql              → Vistas para consultas frecuentes
├── nginx/
│   └── nginx.conf
├── docker-compose.yml
├── .env.example
└── setup-lxc-proxmox.sh             → Script de instalación en Proxmox
```

---

## 🚀 Instalación

### Requisitos

- Proxmox VE (probado en pve02)
- Acceso root al nodo
- Conexión a internet desde el nodo
- API Key de Anthropic

### 1. Correr el script de setup en pve02

```bash
# Copiar el script al nodo
scp setup-lxc-proxmox.sh root@10.13.69.8:/root/

# En pve02
chmod +x /root/setup-lxc-proxmox.sh
./setup-lxc-proxmox.sh
```

El script crea el LXC CT 222 con:

| Parámetro | Valor |
|---|---|
| Nodo | pve02 |
| CT ID | 222 |
| IP | 10.13.69.90/24 |
| RAM | 1.5 GB |
| Disco | 20 GB |
| Cores | 1 |
| SO | Debian 12 |

### 2. Configurar variables de entorno

```bash
pct exec 222 -- nano /opt/energy-tracker/.env
```

| Variable | Descripción |
|---|---|
| `DB_PASSWORD` | Contraseña para PostgreSQL |
| `SECRET_KEY` | Clave JWT — generada automáticamente por el script |
| `ANTHROPIC_API_KEY` | API key de Anthropic (sk-ant-...) |

### 3. Reiniciar servicios tras editar el .env

```bash
pct exec 222 -- bash -c 'cd /opt/energy-tracker && docker compose restart'
```

### 4. Acceder

| Servicio | URL |
|---|---|
| Webapp | http://10.13.69.90 |
| Health check | http://10.13.69.90/health |

---

## 🖥 Uso

### Primer uso — Registro y onboarding

1. Entra a `http://10.13.69.90`
2. Selecciona **Crear cuenta**, elige un username (≤10 caracteres alfanuméricos) y un PIN de 4 dígitos
3. El wizard de onboarding te guía en 4 pasos:
   - **Paso 1** — Sube tu recibo CFE más reciente (PDF o imagen). Claude extrae los datos automáticamente
   - **Paso 2** — Confirma que es el recibo más reciente e ingresa la lectura actual de tu medidor. Con esto se calcula el consumo acumulado desde el último corte
   - **Paso 3** — Opcionalmente, sube recibos históricos en batch (el sistema los ordena por fecha automáticamente)
   - **Paso 4** — Resumen del perfil creado

### Uso diario

- **Tab Lecturas** → registra la lectura del medidor cada que quieras
- **Tab Recibos** → consulta el historial de recibos importados
- **Tab Dashboard** → gráfica de consumo diario y tarjetas de resumen

---

## 📦 Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite + Recharts |
| Backend | Node.js 20 + Express |
| Base de datos | PostgreSQL 16 |
| Extracción PDF | Claude API — claude-sonnet-4 (Anthropic) |
| Proxy | Nginx Alpine |
| Contenedores | Docker Compose |
| Infraestructura | Proxmox VE · LXC Debian 12 |

---

## 🗄 Base de datos

### Tablas principales

| Tabla | Descripción |
|---|---|
| `usuarios` | Usuarios del sistema (username + PIN hash) |
| `servicios` | Contratos CFE por usuario |
| `ciclos` | Bimestres de consumo (abiertos o cerrados) |
| `eventos` | Lecturas diarias del medidor |
| `recibos` | Datos extraídos de los PDFs importados |
| `tarifas_historicas` | Precios por bimestre para proyecciones futuras |

### Vistas

| Vista | Descripción |
|---|---|
| `v_ciclo_activo` | Ciclo abierto con consumo acumulado y alerta por días |
| `v_consumo_diario` | Consumo diario por diferencia entre lecturas |
| `v_historico_ciclos` | Ciclos cerrados con costo total del recibo |

---

## ⚙️ Comandos útiles

```bash
# Entrar al contenedor
pct enter 222

# Ver estado de los servicios
pct exec 222 -- docker compose -f /opt/energy-tracker/docker-compose.yml ps

# Ver logs en tiempo real
pct exec 222 -- docker compose -f /opt/energy-tracker/docker-compose.yml logs -f
pct exec 222 -- docker compose -f /opt/energy-tracker/docker-compose.yml logs -f backend

# Reiniciar un servicio
pct exec 222 -- docker compose -f /opt/energy-tracker/docker-compose.yml restart backend

# Entrar a psql
pct exec 222 -- docker compose -f /opt/energy-tracker/docker-compose.yml exec database \
    psql -U energy_user -d energy_tracker

# Asignar rol admin a un usuario
pct exec 222 -- docker compose -f /opt/energy-tracker/docker-compose.yml exec database \
    psql -U energy_user -d energy_tracker \
    -c "UPDATE usuarios SET rol='admin' WHERE nombre_usuario='tu_usuario';"

# Reset completo de la base de datos (⚠️ borra todo)
pct exec 222 -- bash -c 'cd /opt/energy-tracker && docker compose down -v && docker compose up -d'
```

### Actualizar desde el repo

```bash
# En tu laptop
git add -A && git commit -m "..." && git push

# En el LXC
pct exec 222 -- bash -c '
    cd /opt/energy-tracker &&
    git reset --hard origin/main &&
    git pull &&
    docker compose build &&
    docker compose up -d
'
```

---

## 🔐 Seguridad

- PINs almacenados con bcrypt (10 rounds)
- Autenticación JWT con expiración de 7 días
- Comunicación interna Docker en red privada (backend no expuesto directamente)
- Firewall ufw: solo puertos 22, 80 y 443 habilitados

---

## 🗺 Roadmap

- [ ] Integración Telegram (fase 2) — registro de lecturas via bot
- [ ] Proyecciones de consumo y costo estimado para el cierre del ciclo
- [ ] Gráfica de tendencia histórica bimestral
- [ ] Soporte multi-servicio (varios medidores por usuario)
- [ ] Importación de recibos desde el dashboard (fuera del onboarding)
- [ ] Tunnel HTTPS permanente (Cloudflare)
