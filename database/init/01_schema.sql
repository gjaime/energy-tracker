CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USUARIOS — username corto + PIN de 4 dígitos
CREATE TABLE usuarios (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre_usuario        VARCHAR(10) UNIQUE NOT NULL,
    pin_hash              VARCHAR(255) NOT NULL,
    nombre                VARCHAR(100),
    rol                   VARCHAR(20) NOT NULL DEFAULT 'usuario'
                              CHECK (rol IN ('admin','usuario')),
    activo                BOOLEAN NOT NULL DEFAULT TRUE,
    onboarding_completado BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_registro        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_acceso         TIMESTAMPTZ
);

-- SERVICIOS (contratos CFE)
CREATE TABLE servicios (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id       UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    alias            VARCHAR(100) NOT NULL DEFAULT 'Casa',
    numero_servicio  VARCHAR(50),
    numero_medidor   VARCHAR(50),
    tarifa_tipo      VARCHAR(10) NOT NULL DEFAULT '1',
    direccion        VARCHAR(255),
    ciudad           VARCHAR(100),
    estado_rep       VARCHAR(100),
    activo           BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_alta       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notas            TEXT
);

-- CICLOS (bimestres)
CREATE TABLE ciclos (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    servicio_id      UUID NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
    fecha_inicio     DATE NOT NULL,
    fecha_fin        DATE,
    lectura_inicial  INTEGER NOT NULL,
    lectura_final    INTEGER,
    estado           VARCHAR(30) NOT NULL DEFAULT 'abierto'
                         CHECK (estado IN ('abierto','cerrado','sin_recibo_pendiente')),
    recibo_id        UUID,
    fuente_cierre    VARCHAR(30),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- EVENTOS / LECTURAS
CREATE TABLE eventos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ciclo_id        UUID NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
    servicio_id     UUID NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
    fecha           DATE NOT NULL,
    lectura_valor   INTEGER NOT NULL,
    consumo_dia     INTEGER,
    tipo            VARCHAR(30) NOT NULL
                        CHECK (tipo IN (
                            'lectura_diaria',
                            'cierre_ciclo',
                            'apertura_ciclo',
                            'evento_especial'
                        )),
    fuente          VARCHAR(30) NOT NULL DEFAULT 'usuario'
                        CHECK (fuente IN ('usuario','recibo_importado','sistema')),
    es_backdating   BOOLEAN NOT NULL DEFAULT FALSE,
    sobreescrita    BOOLEAN NOT NULL DEFAULT FALSE,
    notas           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RECIBOS
CREATE TABLE recibos (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    servicio_id               UUID NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
    fecha_emision             DATE,
    fecha_lectura_cfe         DATE NOT NULL,
    periodo_inicio            DATE NOT NULL,
    periodo_fin               DATE NOT NULL,
    lectura_anterior          INTEGER NOT NULL,
    lectura_actual            INTEGER NOT NULL,
    tarifa_precio_basico      NUMERIC(10,4),
    tarifa_precio_intermedio  NUMERIC(10,4),
    tarifa_precio_excedente   NUMERIC(10,4),
    tarifa_limite_basico      INTEGER,
    tarifa_limite_intermedio  INTEGER,
    importe_basico            NUMERIC(12,2),
    importe_intermedio        NUMERIC(12,2),
    importe_excedente         NUMERIC(12,2),
    cargo_suministro          NUMERIC(12,2),
    cargo_distribucion        NUMERIC(12,2),
    cargo_transmision         NUMERIC(12,2),
    cargo_cenace              NUMERIC(12,2),
    cargo_energia             NUMERIC(12,2),
    cargo_capacidad           NUMERIC(12,2),
    cargo_scnmen              NUMERIC(12,2),
    cargo_alumbrado_publico   NUMERIC(12,2),
    cargo_aportaciones        NUMERIC(12,2),
    apoyo_gubernamental       NUMERIC(12,2),
    cargos_adicionales        JSONB DEFAULT '[]',
    dap                       NUMERIC(12,2),
    subtotal                  NUMERIC(12,2),
    impuestos                 NUMERIC(12,2),
    total                     NUMERIC(12,2) NOT NULL,
    archivo_url               VARCHAR(500),
    fecha_importacion         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extraccion_confianza      NUMERIC(5,2),
    extraccion_revisada       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK circular ciclos → recibos
ALTER TABLE ciclos
    ADD CONSTRAINT fk_ciclos_recibo
    FOREIGN KEY (recibo_id) REFERENCES recibos(id) ON DELETE SET NULL;

-- TARIFAS HISTÓRICAS
CREATE TABLE tarifas_historicas (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tarifa_tipo         VARCHAR(10) NOT NULL,
    estado_rep          VARCHAR(100),
    bimestre            INTEGER NOT NULL CHECK (bimestre BETWEEN 1 AND 6),
    anio                INTEGER NOT NULL,
    precio_basico       NUMERIC(10,4) NOT NULL,
    precio_intermedio   NUMERIC(10,4) NOT NULL,
    precio_excedente    NUMERIC(10,4) NOT NULL,
    limite_basico       INTEGER NOT NULL,
    limite_intermedio   INTEGER NOT NULL,
    dap                 NUMERIC(10,2),
    apoyo_gubernamental NUMERIC(10,2),
    fuente              VARCHAR(50) DEFAULT 'recibo_importado',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tarifa_tipo, estado_rep, bimestre, anio)
);

-- ÍNDICES
CREATE INDEX idx_eventos_servicio_fecha ON eventos  (servicio_id, fecha DESC);
CREATE INDEX idx_eventos_ciclo          ON eventos  (ciclo_id);
CREATE INDEX idx_ciclos_servicio        ON ciclos   (servicio_id, fecha_inicio DESC);
CREATE INDEX idx_ciclos_estado          ON ciclos   (estado);
CREATE INDEX idx_recibos_servicio       ON recibos  (servicio_id, fecha_lectura_cfe DESC);
CREATE INDEX idx_servicios_usuario      ON servicios(usuario_id);

-- TRIGGER updated_at
CREATE OR REPLACE FUNCTION actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ciclos_updated_at
    BEFORE UPDATE ON ciclos
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();
