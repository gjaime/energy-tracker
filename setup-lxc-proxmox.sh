#!/usr/bin/env bash
# =============================================================================
# Energy Tracker — Setup LXC en Proxmox
# Nodo:        pve02
# CT ID:       222
# IP:          10.13.69.90/24
# Gateway:     10.13.69.1
# RAM:         1536 MB (1.5 GB)
# Disco:       20 GB
# Cores:       1
# SO:          Debian 12 (bookworm)
# =============================================================================
set -euo pipefail

# ── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

# ── Config ───────────────────────────────────────────────────────────────────
CT_ID=222
CT_NAME="energy-tracker"
CT_IP="10.13.69.90"
CT_GW="10.13.69.1"
CT_NETMASK="24"
CT_RAM=1536
CT_SWAP=512
CT_CORES=1
CT_DISK=20          # GB
CT_STORAGE="local-lvm"
CT_BRIDGE="vmbr0"
CT_DNS="10.13.69.102"   # AdGuard Home

TEMPLATE_STORAGE="local"
DEBIAN_TEMPLATE=""   # se detecta automáticamente
REPO_URL="https://github.com/gjaime/energy-tracker.git"
APP_DIR="/opt/energy-tracker"

LOG_FILE="/root/setup-energy-tracker-$(date +%Y%m%d-%H%M%S).log"

# ── Logging ───────────────────────────────────────────────────────────────────
exec > >(tee -a "$LOG_FILE") 2>&1

log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓ $*${NC}"; }
info() { echo -e "${CYAN}[$(date '+%H:%M:%S')] → $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠ $*${NC}"; }
die()  { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ ERROR: $*${NC}"; exit 1; }

# =============================================================================
echo -e "\n${BOLD}${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}   Energy Tracker — Setup LXC pve02 · CT ${CT_ID}${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${NC}\n"
# =============================================================================

# ── Verificar que corremos en Proxmox ────────────────────────────────────────
command -v pct &>/dev/null || \
    [[ -x /usr/sbin/pct ]] || \
    [[ -x /usr/bin/pct  ]] || \
    die "Este script debe correr en el host Proxmox (pct no encontrado)"
[[ $(id -u) -eq 0 ]]  || die "Ejecutar como root"

# ── Verificar que el CT ID no existe ya ──────────────────────────────────────
if pct status "$CT_ID" &>/dev/null; then
    warn "El contenedor $CT_ID ya existe."
    read -rp "¿Destruirlo y recrear? [s/N]: " confirm
    [[ "$confirm" =~ ^[sS]$ ]] || die "Abortado por el usuario"
    info "Deteniendo y destruyendo CT $CT_ID..."
    pct stop "$CT_ID" --skiplock 2>/dev/null || true
    sleep 2
    pct destroy "$CT_ID" --destroy-unreferenced-disks 1 --purge 1
    log "CT $CT_ID eliminado"
fi

# ── Descargar template Debian 12 (detección automática del nombre) ────────────
info "Actualizando lista de templates disponibles..."
pveam update

info "Buscando template Debian 12 disponible..."
# Buscar en el repositorio remoto
DEBIAN_TEMPLATE=$(pveam available --section system 2>/dev/null \
    | awk '{print $2}' \
    | grep -E '^debian-12' \
    | sort -V | tail -1)

[[ -n "$DEBIAN_TEMPLATE" ]] \
    || die "No se encontró ningún template debian-12 en los repos de Proxmox. Verifica conexión."

info "Template encontrado: $DEBIAN_TEMPLATE"

# Verificar si ya está descargado
if pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$DEBIAN_TEMPLATE"; then
    log "Template ya disponible localmente"
else
    info "Descargando $DEBIAN_TEMPLATE..."
    pveam download "$TEMPLATE_STORAGE" "$DEBIAN_TEMPLATE" \
        || die "No se pudo descargar el template."
    log "Template descargado"
fi

# ── Crear el contenedor ───────────────────────────────────────────────────────
info "Creando contenedor CT $CT_ID ($CT_NAME)..."
pct create "$CT_ID" \
    "${TEMPLATE_STORAGE}:vztmpl/${DEBIAN_TEMPLATE}" \
    --hostname    "$CT_NAME" \
    --cores       "$CT_CORES" \
    --memory      "$CT_RAM" \
    --swap        "$CT_SWAP" \
    --rootfs      "${CT_STORAGE}:${CT_DISK}" \
    --net0        "name=eth0,bridge=${CT_BRIDGE},ip=${CT_IP}/${CT_NETMASK},gw=${CT_GW}" \
    --nameserver  "$CT_DNS" \
    --searchdomain "local" \
    --ostype      debian \
    --features    "nesting=1" \
    --unprivileged 1 \
    --start       0

log "Contenedor CT $CT_ID creado"

# ── Configuraciones extra antes de arrancar ───────────────────────────────────
info "Aplicando opciones adicionales..."

# Aumentar límite de archivos abiertos para Docker
cat >> /etc/pve/lxc/${CT_ID}.conf <<EOF

# Docker / Energy Tracker
lxc.prlimit.nofile = 1048576
EOF

log "Opciones aplicadas"

# ── Arrancar el contenedor ────────────────────────────────────────────────────
info "Arrancando CT $CT_ID..."
pct start "$CT_ID"
sleep 5

# Esperar a que la red esté lista
info "Esperando conectividad de red..."
for i in $(seq 1 20); do
    if pct exec "$CT_ID" -- ping -c1 -W2 8.8.8.8 &>/dev/null; then
        log "Red disponible (intento $i)"
        break
    fi
    [[ $i -eq 20 ]] && die "Sin conectividad de red tras 20 intentos. Verifica gateway y bridge."
    sleep 3
done

# ── Función helper para ejecutar comandos dentro del CT ───────────────────────
lxc() { pct exec "$CT_ID" -- bash -c "$*"; }

# ── Actualizar sistema base ───────────────────────────────────────────────────
info "Actualizando sistema base Debian 12..."
lxc "export DEBIAN_FRONTEND=noninteractive && \
     apt-get update -qq && \
     apt-get upgrade -y -qq && \
     apt-get install -y -qq \
         curl wget git ca-certificates gnupg lsb-release \
         apt-transport-https software-properties-common \
         nano htop ufw"
log "Sistema base actualizado"

# ── Instalar Docker ───────────────────────────────────────────────────────────
info "Instalando Docker Engine..."
lxc "install -m 0755 -d /etc/apt/keyrings && \
     curl -fsSL https://download.docker.com/linux/debian/gpg \
         | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
     chmod a+r /etc/apt/keyrings/docker.gpg"

lxc "echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
     https://download.docker.com/linux/debian \
     \$(lsb_release -cs) stable\" \
     > /etc/apt/sources.list.d/docker.list"

lxc "apt-get update -qq && \
     apt-get install -y -qq \
         docker-ce docker-ce-cli containerd.io \
         docker-buildx-plugin docker-compose-plugin"

lxc "systemctl enable docker && systemctl start docker"
lxc "docker --version && docker compose version"
log "Docker instalado"

# ── Clonar el repositorio ─────────────────────────────────────────────────────
info "Clonando repositorio Energy Tracker..."
lxc "mkdir -p $(dirname $APP_DIR) && \
     git clone $REPO_URL $APP_DIR"
log "Repositorio clonado en $APP_DIR"

# ── Crear .env desde .env.example ────────────────────────────────────────────
info "Creando archivo .env..."
if lxc "test -f ${APP_DIR}/.env.example"; then
    lxc "cp ${APP_DIR}/.env.example ${APP_DIR}/.env"
    log ".env creado desde .env.example"
else
    warn ".env.example no encontrado — creando .env mínimo"
    pct exec "$CT_ID" -- bash -c "cat > ${APP_DIR}/.env <<'ENVEOF'
DB_NAME=energy_tracker
DB_USER=energy_user
DB_PASSWORD=CAMBIA_ESTA_PASSWORD
SECRET_KEY=$(openssl rand -hex 32)
NODE_ENV=production
ANTHROPIC_API_KEY=sk-ant-REEMPLAZAR
ENVEOF"
fi

# Generar SECRET_KEY automáticamente si está vacía
lxc "SECRET=\$(openssl rand -hex 32) && \
     sed -i \"s|genera_con_openssl_rand_hex_32|\$SECRET|g\" ${APP_DIR}/.env"
log "SECRET_KEY generada automáticamente"

# ── Crear directorio de uploads ───────────────────────────────────────────────
lxc "mkdir -p ${APP_DIR}/backend/uploads && chmod 777 ${APP_DIR}/backend/uploads"

# ── Firewall básico ───────────────────────────────────────────────────────────
info "Configurando firewall (ufw)..."
lxc "ufw --force reset && \
     ufw default deny incoming && \
     ufw default allow outgoing && \
     ufw allow ssh && \
     ufw allow 80/tcp && \
     ufw allow 443/tcp && \
     ufw --force enable"
log "Firewall configurado"

# ── Levantar los servicios ────────────────────────────────────────────────────
info "Levantando servicios con Docker Compose..."
lxc "cd ${APP_DIR} && docker compose pull --quiet 2>/dev/null || true"
lxc "cd ${APP_DIR} && docker compose build --quiet"
lxc "cd ${APP_DIR} && docker compose up -d"
log "Servicios levantados"

# ── Esperar health check del backend ─────────────────────────────────────────
info "Esperando que el backend esté disponible..."
for i in $(seq 1 30); do
    if lxc "curl -sf http://localhost/health" &>/dev/null; then
        log "Backend respondiendo (intento $i)"
        break
    fi
    [[ $i -eq 30 ]] && {
        warn "El backend no respondió tras 30 intentos. Revisa los logs:"
        warn "  pct exec $CT_ID -- docker compose -f ${APP_DIR}/docker-compose.yml logs backend"
    }
    sleep 5
done

# ── Resumen final ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   ✅  Energy Tracker instalado correctamente${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Contenedor:${NC}  CT $CT_ID en pve02"
echo -e "  ${BOLD}IP:${NC}          http://${CT_IP}"
echo -e "  ${BOLD}App:${NC}         http://${CT_IP}"
echo -e "  ${BOLD}Health:${NC}      http://${CT_IP}/health"
echo -e "  ${BOLD}Log setup:${NC}   $LOG_FILE"
echo ""
echo -e "${YELLOW}  ⚠  IMPORTANTE — edita el .env antes de usar:${NC}"
echo -e "     pct exec $CT_ID -- nano ${APP_DIR}/.env"
echo ""
echo -e "  Variables que debes completar manualmente:"
echo -e "    ${BOLD}DB_PASSWORD${NC}       → contraseña segura para PostgreSQL"
echo -e "    ${BOLD}ANTHROPIC_API_KEY${NC} → tu API key de Anthropic"
echo ""
echo -e "  Tras editar el .env, reinicia los servicios:"
echo -e "    ${CYAN}pct exec $CT_ID -- bash -c 'cd ${APP_DIR} && docker compose restart'${NC}"
echo ""
echo -e "${CYAN}  Comandos útiles:${NC}"
echo -e "    pct enter $CT_ID"
echo -e "    pct exec $CT_ID -- docker compose -f ${APP_DIR}/docker-compose.yml ps"
echo -e "    pct exec $CT_ID -- docker compose -f ${APP_DIR}/docker-compose.yml logs -f backend"
echo -e "    pct exec $CT_ID -- docker compose -f ${APP_DIR}/docker-compose.yml logs -f"
echo ""
