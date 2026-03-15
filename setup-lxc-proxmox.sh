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
CT_DISK=20
CT_STORAGE="local-lvm"
CT_BRIDGE="vmbr0"
CT_DNS="10.13.69.102"

TEMPLATE_STORAGE="local"
DEBIAN_TEMPLATE=""
REPO_URL="https://github.com/gjaime/energy-tracker.git"
APP_DIR="/opt/energy-tracker"

LOG_FILE="/root/setup-energy-tracker-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓ $*${NC}"; }
info() { echo -e "${CYAN}[$(date '+%H:%M:%S')] → $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠ $*${NC}"; }
die()  { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ ERROR: $*${NC}"; exit 1; }

echo -e "\n${BOLD}${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}   Energy Tracker — Setup LXC pve02 · CT ${CT_ID}${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${NC}\n"

# ── Verificar Proxmox y root ──────────────────────────────────────────────────
command -v pct &>/dev/null || \
    [[ -x /usr/sbin/pct ]] || \
    [[ -x /usr/bin/pct  ]] || \
    die "Este script debe correr en el host Proxmox (pct no encontrado)"
[[ $(id -u) -eq 0 ]] || die "Ejecutar como root"

# ── Sysctl requerido por Docker en LXC — aplicar en el host ──────────────────
info "Configurando sysctl en el host..."
sysctl -w net.ipv4.ip_unprivileged_port_start=0
echo "net.ipv4.ip_unprivileged_port_start=0" > /etc/sysctl.d/99-docker-lxc.conf
log "Sysctl host configurado"

# ── Verificar / destruir CT existente ────────────────────────────────────────
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

# ── Template Debian 12 ────────────────────────────────────────────────────────
info "Actualizando lista de templates disponibles..."
pveam update

info "Buscando template Debian 12 disponible..."
DEBIAN_TEMPLATE=$(pveam available --section system 2>/dev/null \
    | awk '{print $2}' \
    | grep -E '^debian-12' \
    | sort -V | tail -1)

[[ -n "$DEBIAN_TEMPLATE" ]] \
    || die "No se encontró ningún template debian-12. Verifica conexión."

info "Template encontrado: $DEBIAN_TEMPLATE"

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
    --hostname     "$CT_NAME" \
    --cores        "$CT_CORES" \
    --memory       "$CT_RAM" \
    --swap         "$CT_SWAP" \
    --rootfs       "${CT_STORAGE}:${CT_DISK}" \
    --net0         "name=eth0,bridge=${CT_BRIDGE},ip=${CT_IP}/${CT_NETMASK},gw=${CT_GW}" \
    --nameserver   "$CT_DNS" \
    --searchdomain "local" \
    --ostype       debian \
    --features     "nesting=1,keyctl=1" \
    --unprivileged 0 \
    --start        0

log "Contenedor CT $CT_ID creado"

# ── Config extra para Docker en LXC ──────────────────────────────────────────
info "Aplicando configuración LXC para Docker..."
cat >> /etc/pve/lxc/${CT_ID}.conf <<EOF
lxc.apparmor.profile = unconfined
lxc.cap.drop =
EOF
log "Configuración LXC aplicada"

# ── Arrancar ──────────────────────────────────────────────────────────────────
info "Arrancando CT $CT_ID..."
pct start "$CT_ID"
sleep 5

# ── Esperar red ───────────────────────────────────────────────────────────────
info "Esperando conectividad de red..."
for i in $(seq 1 20); do
    if pct exec "$CT_ID" -- ping -c1 -W2 8.8.8.8 &>/dev/null; then
        log "Red disponible (intento $i)"
        break
    fi
    [[ $i -eq 20 ]] && die "Sin conectividad de red. Verifica gateway y bridge."
    sleep 3
done

lxc() { pct exec "$CT_ID" -- bash -c "$*"; }

# ── Sistema base ──────────────────────────────────────────────────────────────
info "Actualizando sistema base Debian 12..."
lxc "export DEBIAN_FRONTEND=noninteractive && \
     apt-get update -qq && \
     apt-get upgrade -y -qq && \
     apt-get install -y -qq \
         curl wget git ca-certificates gnupg lsb-release \
         apt-transport-https software-properties-common \
         nano htop ufw"
log "Sistema base actualizado"

# ── Sysctl dentro del CT ──────────────────────────────────────────────────────
info "Configurando sysctl dentro del CT..."
lxc "sysctl -w net.ipv4.ip_unprivileged_port_start=0 && \
     echo 'net.ipv4.ip_unprivileged_port_start=0' > /etc/sysctl.d/99-docker.conf"
log "Sysctl CT configurado"

# ── Docker Engine ─────────────────────────────────────────────────────────────
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

# ── Daemon Docker — storage driver y sin manipulación de iptables ─────────────
info "Configurando Docker daemon..."
lxc "mkdir -p /etc/docker && cat > /etc/docker/daemon.json <<'EOF'
{
  \"storage-driver\": \"overlay2\",
  \"iptables\": false
}
EOF"

lxc "systemctl enable docker && systemctl restart docker && sleep 3"
lxc "docker --version && docker compose version"
log "Docker instalado"

# ── Clonar repo ───────────────────────────────────────────────────────────────
info "Clonando repositorio Energy Tracker..."
lxc "git clone $REPO_URL $APP_DIR"
log "Repositorio clonado en $APP_DIR"

# ── .env ──────────────────────────────────────────────────────────────────────
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
SECRET_KEY=REEMPLAZAR
NODE_ENV=production
ANTHROPIC_API_KEY=sk-ant-REEMPLAZAR
ENVEOF"
fi

lxc "SECRET=\$(openssl rand -hex 32) && \
     sed -i \"s|genera_con_openssl_rand_hex_32|\$SECRET|g\" ${APP_DIR}/.env"
log "SECRET_KEY generada"

lxc "mkdir -p ${APP_DIR}/backend/uploads && chmod 777 ${APP_DIR}/backend/uploads"

# ── Firewall ──────────────────────────────────────────────────────────────────
info "Configurando firewall..."
lxc "ufw --force reset && \
     ufw default deny incoming && \
     ufw default allow outgoing && \
     ufw allow ssh && \
     ufw allow 80/tcp && \
     ufw allow 443/tcp && \
     ufw --force enable"
log "Firewall configurado"

# ── Levantar servicios ────────────────────────────────────────────────────────
info "Levantando servicios con Docker Compose..."
lxc "cd ${APP_DIR} && docker compose build --quiet"
lxc "cd ${APP_DIR} && docker compose up -d"
log "Servicios levantados"

# ── Health check ──────────────────────────────────────────────────────────────
info "Esperando que el backend esté disponible..."
for i in $(seq 1 30); do
    if lxc "curl -sf http://localhost/health" &>/dev/null; then
        log "Backend respondiendo (intento $i)"
        break
    fi
    [[ $i -eq 30 ]] && {
        warn "El backend no respondió en 30 intentos. Revisa:"
        warn "  pct exec $CT_ID -- docker compose -f ${APP_DIR}/docker-compose.yml logs backend"
    }
    sleep 5
done

# ── Resumen ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   ✅  Energy Tracker instalado correctamente${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Contenedor:${NC}  CT $CT_ID en pve02"
echo -e "  ${BOLD}App:${NC}         http://${CT_IP}"
echo -e "  ${BOLD}Health:${NC}      http://${CT_IP}/health"
echo -e "  ${BOLD}Log setup:${NC}   $LOG_FILE"
echo ""
echo -e "${YELLOW}  ⚠  Edita el .env antes de usar la app:${NC}"
echo -e "     pct exec $CT_ID -- nano ${APP_DIR}/.env"
echo ""
echo -e "  Variables requeridas:"
echo -e "    ${BOLD}DB_PASSWORD${NC}       → contraseña segura"
echo -e "    ${BOLD}ANTHROPIC_API_KEY${NC} → sk-ant-..."
echo ""
echo -e "  Tras editar el .env:"
echo -e "    ${CYAN}pct exec $CT_ID -- bash -c 'cd ${APP_DIR} && docker compose restart'${NC}"
echo ""
