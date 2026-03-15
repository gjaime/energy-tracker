import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ComposedChart, BarChart, Bar, LineChart, AreaChart, Area,
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import api from "../api/client";

// ─────────────────────────────────────────────────────────────
// TARIFA — se rellena desde el último recibo importado
// ─────────────────────────────────────────────────────────────
const TARIFA_DEFAULT = {
  bas_lim:150, int_lim:280,
  p_bas:1.110, p_int:1.349, p_exc:3.944,
  dap:68.37, iva:0.16
};

// ─────────────────────────────────────────────────────────────
// MOTOR DE INTERPOLACIÓN
// ─────────────────────────────────────────────────────────────
function interpolateGaps(registros, nuevaEntrada) {
  const sorted = [...registros].sort((a,b) => a.fecha.localeCompare(b.fecha));
  const ultima = sorted[sorted.length - 1];
  const gapDias = daysBetween(ultima.fecha, nuevaEntrada.fecha);
  if (gapDias <= 1) return [];
  const ancla = sorted.find(r =>
    r.tipo === "cierre_ciclo" &&
    r.fecha > ultima.fecha &&
    r.fecha < nuevaEntrada.fecha
  );
  let baseId = Date.now();
  if (ancla) {
    return [
      ...buildSegment(ultima, ancla, true, baseId),
      ...buildSegment(ancla, nuevaEntrada, false, baseId + 10000),
    ];
  }
  return buildSegment(ultima, nuevaEntrada, false, baseId);
}

function buildSegment(desde, hasta, esRetro, baseId) {
  const totalDias = daysBetween(desde.fecha, hasta.fecha);
  const gapDias   = totalDias - 1;
  if (gapDias <= 0) return [];
  const deltaTotal = hasta.lectura - desde.lectura;
  const base       = Math.floor(deltaTotal / totalDias);
  const residuo    = deltaTotal - base * totalDias;
  const label = esRetro
    ? `[auto] estimada retroactiva → ancla CFE ${hasta.fecha}`
    : `[auto] interpolada entre ${desde.fecha} y ${hasta.fecha}`;
  const estimados = [];
  let acc = desde.lectura;
  const d1 = new Date(desde.fecha);
  for (let i = 1; i <= gapDias; i++) {
    const d = new Date(d1);
    d.setDate(d.getDate() + i);
    const fechaStr = d.toISOString().split("T")[0];
    const kwhHoy   = i === gapDias ? base + residuo : base;
    acc += kwhHoy;
    estimados.push({ id: baseId + i, fecha: fechaStr, lectura: acc, tipo: "estimada", estimada: true, nota: label });
  }
  return estimados;
}

// ─────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────
function calcCosto(kwh, T = TARIFA_DEFAULT) {
  const { bas_lim, int_lim, p_bas, p_int, p_exc, dap, iva } = T;
  const bas  = Math.min(kwh, bas_lim);
  const int_ = Math.max(0, Math.min(kwh, int_lim) - bas_lim);
  const exc  = Math.max(0, kwh - int_lim);
  const sub  = bas*p_bas + int_*p_int + exc*p_exc;
  const ivaAmt = sub * iva;
  return { bas, int:int_, exc, sub, iva:ivaAmt, dap, total: sub + ivaAmt + dap, kwh };
}

function calcCostoDia(kwhAcumHoy, kwhAcumAyer, T = TARIFA_DEFAULT) {
  if (kwhAcumAyer < 0) kwhAcumAyer = 0;
  const cHoy  = calcCosto(kwhAcumHoy, T);
  const cAyer = calcCosto(kwhAcumAyer, T);
  const energiaDelta = cHoy.sub  - cAyer.sub;
  const ivaDelta     = cHoy.iva  - cAyer.iva;
  const total        = energiaDelta + ivaDelta;
  const { bas_lim, int_lim } = T;
  let rango;
  if      (kwhAcumAyer >= int_lim)                               rango = "exc";
  else if (kwhAcumAyer >= bas_lim)                               rango = "int";
  else if (kwhAcumHoy  <= bas_lim)                               rango = "bas";
  else if (kwhAcumHoy  <= int_lim)                               rango = "int";
  else                                                           rango = "exc";
  const cruce = (kwhAcumAyer < bas_lim && kwhAcumHoy >= bas_lim)
             || (kwhAcumAyer < int_lim && kwhAcumHoy >= int_lim);
  return { total, energiaDelta, ivaDelta, rango, cruce };
}

function nivelColor(kwh, T = TARIFA_DEFAULT) {
  if (kwh <= T.bas_lim) return { nivel:"BÁSICO",     col:"#22c55e" };
  if (kwh <= T.int_lim) return { nivel:"INTERMEDIO", col:"#f59e0b" };
  return                       { nivel:"EXCEDENTE",  col:"#ef4444" };
}

const mxn  = v => new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(v);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// ─────────────────────────────────────────────────────────────
// MAPEAR datos del backend al formato interno
// ─────────────────────────────────────────────────────────────
function eventoToReg(e) {
  const tipoMap = {
    lectura_diaria:  "diaria",
    cierre_ciclo:    "cierre_ciclo",
    apertura_ciclo:  "cierre_ciclo",
    evento_especial: "evento",
  };
  return {
    id:       e.id,
    fecha:    e.fecha,
    lectura:  e.lectura_valor,
    tipo:     tipoMap[e.tipo] || "diaria",
    estimada: e.sobreescrita || e.fuente === 'sistema',
    nota:     e.notas || "",
  };
}

function reciboToCiclo(r, idx) {
  const dias = r.periodo_inicio && r.periodo_fin
    ? Math.max(1, daysBetween(r.periodo_inicio, r.periodo_fin))
    : 60;
  const kwh  = r.lectura_actual - r.lectura_anterior;
  return {
    id:          idx + 1,
    inicio:      r.periodo_inicio || "",
    fin:         r.periodo_fin    || r.fecha_lectura_cfe || "",
    lectura_ini: r.lectura_anterior,
    lectura_fin: r.lectura_actual,
    kwh,
    importe:     Number(r.total),
    dias,
  };
}

// ─────────────────────────────────────────────────────────────
// ESTILOS
// ─────────────────────────────────────────────────────────────
const ACCENT = "#1aff70";
const S = {
  root:  { fontFamily:"'Courier New',Courier,monospace", backgroundColor:"#070b10", color:"#dde4ef", minHeight:"100vh" },
  header:{ background:"#0c1016", borderBottom:"1px solid #1aff7020", padding:"14px 28px", display:"flex", justifyContent:"space-between", alignItems:"center" },
  nav:   { display:"flex", backgroundColor:"#0c1016", borderBottom:"1px solid #1d2430", padding:"0 28px" },
  body:  { padding:"24px 28px", maxWidth:"1280px", margin:"0 auto" },
  card:  (accent="#1d2430") => ({ backgroundColor:"#0e1520", border:`1px solid ${accent}`, borderRadius:"10px", padding:"20px" }),
  table: { width:"100%", borderCollapse:"collapse" },
  th:    { padding:"9px 14px", textAlign:"left", fontSize:"10px", color:"#5a6a7e", letterSpacing:"1.5px", textTransform:"uppercase", borderBottom:"1px solid #1d2430", backgroundColor:"#0c1016" },
  td:    { padding:"10px 14px", borderBottom:"1px solid #141c28", verticalAlign:"middle" },
};
const ttStyle = { backgroundColor:"#131922", border:"1px solid #2a3448", color:"#dde4ef", fontSize:"11px", borderRadius:"6px" };

// ─────────────────────────────────────────────────────────────
// COMPONENTES UI
// ─────────────────────────────────────────────────────────────
function TipoBadge({ tipo, estimada }) {
  const m = {
    cierre_ciclo:{ bg:"#0f2d1c", col:"#1aff70", label:"CIERRE CFE" },
    diaria:      { bg:"#0d1e30", col:"#60a5fa", label:"DIARIA"     },
    estimada:    { bg:"#2d2200", col:"#f59e0b", label:"ESTIMADA"   },
    evento:      { bg:"#2d1515", col:"#f87171", label:"EVENTO"     },
  };
  const s = estimada ? m.estimada : (m[tipo] || m.diaria);
  return <span style={{ fontSize:"9px", padding:"3px 8px", borderRadius:"4px", backgroundColor:s.bg, color:s.col, letterSpacing:"1.5px", fontWeight:"700" }}>{s.label}</span>;
}

function NivelBadge({ kwh, tarifa }) {
  const { nivel, col } = nivelColor(kwh, tarifa || TARIFA_DEFAULT);
  return <span style={{ fontSize:"9px", padding:"3px 8px", borderRadius:"4px", backgroundColor:`${col}18`, color:col, letterSpacing:"1.5px", fontWeight:"700" }}>{nivel}</span>;
}

function KpiCard({ icon, label, value, sub, col="#1aff70" }) {
  return (
    <div style={{ ...S.card(`${col}30`), position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:"2px", background:col }}/>
      <div style={{ fontSize:"18px", marginBottom:"8px" }}>{icon}</div>
      <div style={{ fontSize:"10px", color:"#5a6a7e", letterSpacing:"2px", textTransform:"uppercase", marginBottom:"5px" }}>{label}</div>
      <div style={{ fontSize:"22px", fontWeight:"700", color:col, letterSpacing:"1px" }}>{value}</div>
      <div style={{ fontSize:"11px", color:"#4a5568", marginTop:"4px" }}>{sub}</div>
    </div>
  );
}

function DailyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d    = payload[0]?.payload ?? {};
  const dia  = payload.find(p=>p.dataKey==="kwhDia");
  const acum = payload.find(p=>p.dataKey==="acum");
  return (
    <div style={{ ...ttStyle, padding:"10px 14px", minWidth:"160px" }}>
      <div style={{fontSize:"11px",color:"#5a6a7e",marginBottom:"6px",letterSpacing:"1px"}}>{d.fecha}</div>
      {dia && (
        <div style={{display:"flex",justifyContent:"space-between",gap:"16px",marginBottom:"4px"}}>
          <span style={{fontSize:"10px",color:"#5a6a7e"}}>Consumo día</span>
          <span style={{fontSize:"13px",fontWeight:"700",color:d.estimada?"#f59e0b":ACCENT}}>
            {dia.value} kWh
            {d.estimada&&<span style={{fontSize:"9px",marginLeft:"5px",color:"#f59e0b"}}>~est.</span>}
          </span>
        </div>
      )}
      {acum && (
        <div style={{display:"flex",justifyContent:"space-between",gap:"16px",borderTop:"1px solid #1d2430",paddingTop:"4px",marginTop:"2px"}}>
          <span style={{fontSize:"10px",color:"#5a6a7e"}}>Acumulado ciclo</span>
          <span style={{fontSize:"13px",fontWeight:"700",color:"#818cf8"}}>{acum.value} kWh</span>
        </div>
      )}
      {d.nota && <div style={{fontSize:"9px",color:"#5a6a7e",marginTop:"6px",borderTop:"1px solid #1d2430",paddingTop:"4px"}}>{d.nota}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB RECIBOS — extracción + revisión + guardado en backend
// ─────────────────────────────────────────────────────────────
function TabRecibos({ ciclosHistoricos, servicioId, onGuardado }) {
  const [stage,      setStage]      = useState("upload");
  const [processing, setProcessing] = useState(false);
  const [error,      setError]      = useState(null);
  const [fileName,   setFileName]   = useState("");
  const [fileObj,    setFileObj]    = useState(null);
  const [datos,      setDatos]      = useState(null);
  const [drag,       setDrag]       = useState(false);
  const ref = useRef();

  async function handleFile(file) {
    if (!file) return;
    setError(null); setFileName(file.name); setFileObj(file); setProcessing(true); setStage("upload");
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      const { data } = await api.post("/onboarding/extraer", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      setDatos(data.datos); setStage("review");
    } catch(e) {
      setError(e.response?.data?.error || `Error al procesar: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  }

  async function guardar() {
    if (!fileObj || !servicioId) return;
    setProcessing(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("archivo", fileObj);
      fd.append("servicio_id", servicioId);
      await api.post("/onboarding/historial", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      if (onGuardado) onGuardado();
      setStage("saved");
    } catch(e) {
      setError(e.response?.data?.error || "Error al guardar el recibo");
    } finally {
      setProcessing(false);
    }
  }

  function resetear() { setStage("upload"); setDatos(null); setFileName(""); setFileObj(null); setError(null); }
  const upd = (k,v) => setDatos(d=>({...d,[k]:v}));

  const onDrop  = useCallback(e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }, []);
  const onDragOver = e => { e.preventDefault(); setDrag(true); };
  const onDragLeave= () => setDrag(false);

  if (stage === "upload") return (
    <div>
      <div
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        onClick={()=>!processing&&ref.current?.click()}
        style={{border:`2px dashed ${drag?"#1aff70":"#1d2430"}`,borderRadius:"12px",padding:"48px 32px",
          textAlign:"center",cursor:processing?"wait":"pointer",
          backgroundColor:drag?"#0d1f17":"#131922",transition:"all 0.2s"}}>
        <input ref={ref} type="file" accept=".pdf,image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
        {processing ? (
          <div>
            <div style={{fontSize:"28px",marginBottom:"10px",display:"inline-block",animation:"spin 1s linear infinite"}}>⚙️</div>
            <div style={{fontSize:"12px",color:"#1aff70",fontWeight:"700",letterSpacing:"2px"}}>ANALIZANDO RECIBO...</div>
            <div style={{fontSize:"10px",color:"#3d5070",marginTop:"5px"}}>Claude está extrayendo los datos</div>
          </div>
        ) : (
          <div>
            <div style={{fontSize:"36px",marginBottom:"12px",opacity:0.5}}>📄</div>
            <div style={{fontSize:"12px",color:"#dde4ef",fontWeight:"700",letterSpacing:"1px"}}>Arrastra el recibo CFE aquí</div>
            <div style={{fontSize:"10px",color:"#3d5070",marginTop:"5px"}}>PDF o imagen (JPG, PNG) · Clic para seleccionar</div>
            <div style={{fontSize:"9px",color:"#3d5070",marginTop:"10px",backgroundColor:"#0e1520",
              borderRadius:"4px",padding:"4px 12px",display:"inline-block",letterSpacing:"1px"}}>
              ✦ Powered by Claude — extracción automática
            </div>
          </div>
        )}
      </div>
      {error && <div style={{marginTop:"12px",backgroundColor:"#2d0f0f",border:"1px solid #ef444440",
        borderRadius:"6px",padding:"11px 16px",color:"#ef4444",fontSize:"11px"}}>❌ {error}</div>}
    </div>
  );

  if (stage === "review" && datos) return (
    <div>
      <div style={{...S.card("#1aff7030"),marginBottom:"16px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:"2px",background:"#1aff70"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"12px"}}>
          <div>
            <div style={{fontSize:"9px",color:"#1aff70",letterSpacing:"3px",marginBottom:"4px"}}>RECIBO DETECTADO</div>
            <div style={{fontSize:"17px",fontWeight:"700",letterSpacing:"1px"}}>{datos.periodo_inicio} → {datos.periodo_fin}</div>
            <div style={{fontSize:"11px",color:"#5a6a7e",marginTop:"3px"}}>
              {datos.lectura_anterior?.toLocaleString()} → {datos.lectura_actual?.toLocaleString()} kWh
            </div>
            <div style={{fontSize:"9px",color:"#3d5070",marginTop:"6px"}}>📄 {fileName}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:"26px",fontWeight:"700",color:"#1aff70"}}>{mxn(datos.total)}</div>
            <div style={{fontSize:"10px",color:"#5a6a7e",marginTop:"2px"}}>Total</div>
          </div>
        </div>
      </div>

      {/* Campos editables */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",marginBottom:"16px"}}>
        <div style={S.card()}>
          <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"14px"}}>Período y Lecturas</div>
          {[
            {label:"Inicio período",  key:"periodo_inicio"},
            {label:"Fin período",     key:"periodo_fin"},
            {label:"Lectura anterior",key:"lectura_anterior",  num:true},
            {label:"Lectura actual",  key:"lectura_actual",    num:true},
            {label:"Total",           key:"total",             num:true},
          ].map(({label,key,num}) => (
            <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px",paddingBottom:"8px",borderBottom:"1px solid #1d2430"}}>
              <span style={{fontSize:"11px",color:"#5a6a7e"}}>{label}</span>
              <input
                value={datos[key]??""} onChange={e=>upd(key, num ? Number(e.target.value) : e.target.value)}
                style={{backgroundColor:"#131922",border:"1px solid #2a3448",color:"#dde4ef",
                  padding:"4px 8px",borderRadius:"4px",fontSize:"12px",fontFamily:"inherit",
                  textAlign:"right",width:"160px"}}
              />
            </div>
          ))}
        </div>
        <div style={S.card()}>
          <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"14px"}}>Tarifas</div>
          {[
            {label:"Precio básico",     key:"tarifa_precio_basico",      num:true},
            {label:"Precio intermedio", key:"tarifa_precio_intermedio",   num:true},
            {label:"Precio excedente",  key:"tarifa_precio_excedente",    num:true},
            {label:"Subtotal",          key:"subtotal",                   num:true},
            {label:"Impuestos",         key:"impuestos",                  num:true},
          ].map(({label,key,num}) => (
            <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px",paddingBottom:"8px",borderBottom:"1px solid #1d2430"}}>
              <span style={{fontSize:"11px",color:"#5a6a7e"}}>{label}</span>
              <input
                value={datos[key]??""} onChange={e=>upd(key, num ? Number(e.target.value) : e.target.value)}
                style={{backgroundColor:"#131922",border:"1px solid #2a3448",color:"#dde4ef",
                  padding:"4px 8px",borderRadius:"4px",fontSize:"12px",fontFamily:"inherit",
                  textAlign:"right",width:"160px"}}
              />
            </div>
          ))}
        </div>
      </div>

      {error && <div style={{marginBottom:"12px",backgroundColor:"#2d0f0f",border:"1px solid #ef444440",
        borderRadius:"6px",padding:"11px 16px",color:"#ef4444",fontSize:"11px"}}>❌ {error}</div>}

      <div style={{display:"flex",gap:"12px",justifyContent:"flex-end"}}>
        <button onClick={resetear} style={{backgroundColor:"transparent",border:"1px solid #1d2430",color:"#5a6a7e",
          padding:"9px 18px",borderRadius:"4px",fontSize:"11px",cursor:"pointer",fontFamily:"inherit",letterSpacing:"1px"}}>
          ← Cancelar
        </button>
        <button onClick={guardar} disabled={processing} style={{backgroundColor:ACCENT,color:"#070b10",border:"none",padding:"9px 24px",
          borderRadius:"4px",fontSize:"11px",fontWeight:"700",cursor:processing?"wait":"pointer",fontFamily:"inherit",letterSpacing:"1px"}}>
          {processing ? "GUARDANDO..." : "✅ Confirmar y guardar en histórico"}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{textAlign:"center",padding:"48px 32px"}}>
      <div style={{fontSize:"44px",marginBottom:"14px"}}>✅</div>
      <div style={{fontSize:"14px",fontWeight:"700",color:"#1aff70",letterSpacing:"2px",marginBottom:"6px"}}>RECIBO GUARDADO</div>
      <div style={{fontSize:"11px",color:"#5a6a7e",marginBottom:"22px"}}>
        {datos?.periodo_inicio} → {datos?.periodo_fin} · {(datos?.lectura_actual - datos?.lectura_anterior)} kWh · {mxn(datos?.total)}
      </div>
      <button onClick={resetear} style={{backgroundColor:ACCENT,color:"#070b10",border:"none",padding:"9px 22px",
        borderRadius:"4px",fontSize:"11px",fontWeight:"700",cursor:"pointer",fontFamily:"inherit",letterSpacing:"1px"}}>
        📄 Importar otro recibo
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FORMULARIO LECTURA
// ─────────────────────────────────────────────────────────────
function FormularioLectura({ form, setForm, regs, handleLecturaChange, agregar, preview, guardando }) {
  const ult = [...regs].sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(-1)[0];
  return (
    <div style={{ ...S.card(`${ACCENT}40`) }}>
      <div style={{ fontSize:"10px", color:ACCENT, letterSpacing:"2px", textTransform:"uppercase", marginBottom:"14px" }}>⚡ Registrar Lectura</div>
      <div style={{ display:"flex", gap:"12px", flexWrap:"wrap", alignItems:"flex-end" }}>
        <div>
          <div style={{ fontSize:"9px", color:"#3d5070", marginBottom:"4px", letterSpacing:"1.5px" }}>FECHA</div>
          <input type="date" value={form.fecha} onChange={e=>setForm(f=>({...f,fecha:e.target.value}))}
            style={{ backgroundColor:"#131922", border:"1px solid #2a3448", color:"#dde4ef", padding:"8px 12px", borderRadius:"4px", fontSize:"12px", fontFamily:"inherit" }}/>
        </div>
        <div>
          <div style={{ fontSize:"9px", color:"#3d5070", marginBottom:"4px", letterSpacing:"1.5px" }}>
            LECTURA <span style={{ color:"#5a6a7e" }}>(actual: {ult?.lectura?.toLocaleString() || "—"})</span>
          </div>
          <input type="number" value={form.lectura} onChange={e=>handleLecturaChange(e.target.value)}
            placeholder={ult ? `≥ ${ult.lectura+1}` : ""}
            style={{ backgroundColor:"#131922", border:"1px solid #2a3448", color:ACCENT, padding:"8px 12px", borderRadius:"4px", fontSize:"22px", fontFamily:"inherit", width:"160px", letterSpacing:"2px" }}/>
        </div>
        <div>
          <div style={{ fontSize:"9px", color:"#3d5070", marginBottom:"4px", letterSpacing:"1.5px" }}>TIPO</div>
          <select value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}
            style={{ backgroundColor:"#131922", border:"1px solid #2a3448", color:"#dde4ef", padding:"8px 12px", borderRadius:"4px", fontSize:"12px", fontFamily:"inherit" }}>
            <option value="lectura_diaria">📅 Lectura Diaria</option>
            <option value="cierre_ciclo">🔒 Cierre CFE</option>
            <option value="evento_especial">⚠️ Evento</option>
          </select>
        </div>
        <div style={{ flex:1, minWidth:"180px" }}>
          <div style={{ fontSize:"9px", color:"#3d5070", marginBottom:"4px", letterSpacing:"1.5px" }}>NOTA</div>
          <input type="text" value={form.nota} onChange={e=>setForm(f=>({...f,nota:e.target.value}))}
            placeholder="AC, lavadora, visita CFE..."
            style={{ backgroundColor:"#131922", border:"1px solid #2a3448", color:"#dde4ef", padding:"8px 12px", borderRadius:"4px", fontSize:"12px", fontFamily:"inherit", width:"100%" }}/>
        </div>
        <button onClick={agregar} disabled={guardando} style={{ backgroundColor:ACCENT, color:"#070b10", border:"none",
          padding:"9px 24px", borderRadius:"4px", fontSize:"12px", fontWeight:"700",
          cursor:guardando?"wait":"pointer", fontFamily:"inherit", letterSpacing:"1px" }}>
          {guardando ? "..." : "AGREGAR"}
        </button>
      </div>
      {preview && preview.length > 0 && (
        <div style={{ marginTop:"14px", backgroundColor:"#1a1200", border:"1px solid #f59e0b40", borderRadius:"6px", padding:"12px 16px" }}>
          <div style={{ fontSize:"10px", color:"#f59e0b", fontWeight:"700", letterSpacing:"2px", marginBottom:"8px" }}>
            ⚠ BRECHA DETECTADA — Se generarán {preview.length} registros estimados automáticamente
          </div>
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
            {preview.map((p,i) => (
              <div key={i} style={{ backgroundColor:"#2d2200", border:"1px solid #f59e0b30", borderRadius:"4px", padding:"5px 10px", fontSize:"10px" }}>
                <span style={{ color:"#a07020" }}>{p.fecha} </span>
                <span style={{ color:"#f59e0b", fontWeight:"700" }}>→ {p.lectura.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize:"9px", color:"#5a6a7e", marginTop:"8px" }}>
            Distribución proporcional · Residuo en el último día · Detecta anclas CFE en el gap
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APP PRINCIPAL
// ─────────────────────────────────────────────────────────────

function TabRecibosHistorial({ recibos, servicioId, onActualizado }) {
  const [archivos,   setArchivos]   = useState([])
  const [procesando, setProcesando] = useState(false)
  const [resultado,  setResultado]  = useState(null)
  const [error,      setError]      = useState(null)
  const [drag,       setDrag]       = useState(false)
  const fileRef = useRef()

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false)
    setArchivos(Array.from(e.dataTransfer.files))
  }

  const handleSubir = async () => {
    if (!archivos.length || !servicioId) return
    setProcesando(true); setError(null); setResultado(null)
    try {
      const fd = new FormData()
      fd.append("servicio_id", servicioId)
      archivos.forEach(f => fd.append("archivos", f))
      const { data } = await api.post("/recibos/historial", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 300000,
      })
      setResultado(data)
      setArchivos([])
      if (data.resumen.importados > 0 && onActualizado) onActualizado()
    } catch (e) {
      setError(e.response?.data?.error || "Error al procesar los recibos")
    } finally {
      setProcesando(false)
    }
  }

  return (
    <div>
      {!resultado && (
        <div style={{...S.card(), marginBottom:"20px"}}>
          <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"14px"}}>
            Cargar Recibos Históricos
          </div>
          <div
            onDrop={onDrop}
            onDragOver={e=>{e.preventDefault();setDrag(true)}}
            onDragLeave={()=>setDrag(false)}
            onClick={()=>!procesando&&fileRef.current?.click()}
            style={{border:`2px dashed ${drag?"#1aff70":"#1d2430"}`,borderRadius:"10px",
              padding:"36px",textAlign:"center",cursor:procesando?"wait":"pointer",
              backgroundColor:drag?"#0d1f17":"#131922",transition:"all 0.2s",marginBottom:"14px"}}>
            <input ref={fileRef} type="file" accept=".pdf,image/*" multiple
              style={{display:"none"}} onChange={e=>setArchivos(Array.from(e.target.files))}/>
            {procesando ? (
              <div>
                <div style={{fontSize:"28px",marginBottom:"10px",display:"inline-block",animation:"spin 1s linear infinite"}}>⚙️</div>
                <div style={{fontSize:"12px",color:"#1aff70",fontWeight:"700",letterSpacing:"2px"}}>PROCESANDO...</div>
                <div style={{fontSize:"10px",color:"#3d5070",marginTop:"5px"}}>Claude extrayendo datos</div>
              </div>
            ) : archivos.length > 0 ? (
              <div>
                <div style={{fontSize:"28px",marginBottom:"8px"}}>📑</div>
                <div style={{fontSize:"13px",color:"#1aff70",fontWeight:"700",marginBottom:"4px"}}>
                  {archivos.length} archivo{archivos.length!==1?"s":""} seleccionado{archivos.length!==1?"s":""}
                </div>
                <div style={{fontSize:"10px",color:"#3d5070"}}>Haz clic para cambiar</div>
              </div>
            ) : (
              <div>
                <div style={{fontSize:"36px",marginBottom:"12px",opacity:0.5}}>📂</div>
                <div style={{fontSize:"12px",color:"#dde4ef",fontWeight:"700",marginBottom:"5px"}}>
                  Arrastra tus recibos CFE aquí
                </div>
                <div style={{fontSize:"10px",color:"#3d5070",marginBottom:"10px"}}>
                  PDF o imagen · varios archivos · se ordenan automáticamente
                </div>
                <div style={{fontSize:"9px",color:"#3d5070",backgroundColor:"#0e1520",
                  borderRadius:"4px",padding:"4px 12px",display:"inline-block",letterSpacing:"1px"}}>
                  ✦ Duplicados detectados automáticamente
                </div>
              </div>
            )}
          </div>
          {error && (
            <div style={{backgroundColor:"#2d0f0f",border:"1px solid #ef444440",borderRadius:"6px",
              padding:"10px 14px",color:"#ef4444",fontSize:"11px",marginBottom:"12px"}}>❌ {error}</div>
          )}
          <div style={{display:"flex",gap:"10px",justifyContent:"flex-end"}}>
            {archivos.length > 0 && (
              <button onClick={()=>setArchivos([])} style={{background:"none",border:"1px solid #1d2430",
                color:"#5a6a7e",padding:"8px 16px",borderRadius:"4px",fontSize:"11px",cursor:"pointer",fontFamily:"inherit"}}>
                Limpiar
              </button>
            )}
            <button onClick={handleSubir} disabled={procesando||!archivos.length} style={{
              backgroundColor:procesando||!archivos.length?"#1a2a1a":"#1aff70",
              color:"#070b10",border:"none",padding:"8px 24px",borderRadius:"4px",
              fontSize:"11px",fontWeight:"700",cursor:procesando||!archivos.length?"not-allowed":"pointer",
              fontFamily:"inherit",letterSpacing:"1px"}}>
              {procesando?"PROCESANDO...":"IMPORTAR"}
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div style={{marginBottom:"20px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginBottom:"16px"}}>
            {[
              {l:"Importados",        v:resultado.resumen.importados,        c:"#1aff70"},
              {l:"Duplicados",        v:resultado.resumen.duplicados,        c:"#f59e0b"},
              {l:"Huecos rellenados", v:resultado.resumen.huecos_rellenados, c:"#60a5fa"},
              {l:"Errores",           v:resultado.resumen.errores,           c:"#ef4444"},
            ].map((it,i)=>(
              <div key={i} style={{...S.card(`${it.c}30`),position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:"2px",background:it.c}}/>
                <div style={{fontSize:"9px",color:"#5a6a7e",letterSpacing:"2px",marginBottom:"4px"}}>{it.l.toUpperCase()}</div>
                <div style={{fontSize:"28px",fontWeight:"700",color:it.c}}>{it.v}</div>
              </div>
            ))}
          </div>

          {resultado.importados.length > 0 && (
            <div style={{...S.card(),padding:0,overflow:"hidden",marginBottom:"12px"}}>
              <div style={{padding:"10px 16px",borderBottom:"1px solid #1d2430",fontSize:"10px",color:"#1aff70",letterSpacing:"2px"}}>
                IMPORTADOS ({resultado.importados.length})
              </div>
              <table style={S.table}><thead><tr>
                {["Período","kWh","Total","Confianza","Hueco"].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead><tbody>
                {resultado.importados.map((r,i)=>(
                  <tr key={i} style={{backgroundColor:i%2===0?"#0c1016":"transparent"}}>
                    <td style={{...S.td,fontSize:"11px"}}>{r.periodo}</td>
                    <td style={{...S.td,fontSize:"12px",color:"#1aff70",fontWeight:"700"}}>{r.kwh} kWh</td>
                    <td style={{...S.td,fontSize:"12px",color:"#a78bfa"}}>${Number(r.total).toFixed(2)}</td>
                    <td style={S.td}><span style={{fontSize:"9px",padding:"2px 7px",borderRadius:"3px",fontWeight:"700",
                      backgroundColor:r.confianza>=85?"#0f2d1c":r.confianza>=60?"#2d2200":"#2d0f0f",
                      color:r.confianza>=85?"#22c55e":r.confianza>=60?"#f59e0b":"#ef4444"}}>{r.confianza}%</span></td>
                    <td style={{...S.td,fontSize:"10px",color:r.relleno_hueco?"#60a5fa":"#3d5070"}}>
                      {r.relleno_hueco?"✓ rellenado":"—"}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}

          {resultado.duplicados.length > 0 && (
            <div style={{...S.card("#f59e0b20"),padding:0,overflow:"hidden",marginBottom:"12px"}}>
              <div style={{padding:"10px 16px",borderBottom:"1px solid #f59e0b30",fontSize:"10px",color:"#f59e0b",letterSpacing:"2px"}}>
                YA EXISTÍAN — no se modificaron ({resultado.duplicados.length})
              </div>
              <table style={S.table}><thead><tr>
                {["Período","kWh","Total"].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead><tbody>
                {resultado.duplicados.map((r,i)=>(
                  <tr key={i} style={{backgroundColor:i%2===0?"#0c1016":"transparent"}}>
                    <td style={{...S.td,fontSize:"11px",color:"#a07020"}}>{r.periodo}</td>
                    <td style={{...S.td,fontSize:"12px",color:"#f59e0b"}}>{r.kwh} kWh</td>
                    <td style={{...S.td,fontSize:"12px",color:"#5a6a7e"}}>${Number(r.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}

          {resultado.errores.length > 0 && (
            <div style={{...S.card("#ef444420"),padding:"12px 16px",marginBottom:"12px"}}>
              <div style={{fontSize:"10px",color:"#ef4444",letterSpacing:"2px",marginBottom:"8px"}}>
                ERRORES ({resultado.errores.length})
              </div>
              {resultado.errores.map((e,i)=>(
                <div key={i} style={{fontSize:"11px",color:"#f87171",marginBottom:"4px"}}>{e.nombre}: {e.error}</div>
              ))}
            </div>
          )}

          <button onClick={()=>setResultado(null)} style={{backgroundColor:"#1aff70",color:"#070b10",
            border:"none",padding:"8px 20px",borderRadius:"4px",fontSize:"11px",fontWeight:"700",
            cursor:"pointer",fontFamily:"inherit",letterSpacing:"1px"}}>
            ← Cargar más recibos
          </button>
        </div>
      )}

      <div style={{...S.card(),padding:0,overflow:"hidden"}}>
        <div style={{padding:"12px 20px",borderBottom:"1px solid #1d2430",fontSize:"10px",
          color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase"}}>
          Histórico — {recibos.length} Recibo{recibos.length!==1?"s":""}
        </div>
        {recibos.length === 0 ? (
          <div style={{padding:"30px",textAlign:"center",fontSize:"11px",color:"#3d5070"}}>No hay recibos importados aún</div>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={S.table}><thead><tr>
              {["Corte CFE","Período","Lec. Ant.","Lec. Act.","kWh","Total","$/kWh"].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead><tbody>
              {recibos.map((c,i)=>(
                <tr key={c.id||i} style={{backgroundColor:i===0?"#0d1f17":i%2===0?"#0c1016":"transparent"}}>
                  <td style={{...S.td,fontSize:"11px",color:"#94a3b8"}}>{c.fin||c.fecha_lectura_cfe||""}</td>
                  <td style={{...S.td,fontSize:"11px",color:"#5a6a7e"}}>{c.inicio||c.periodo_inicio||""} → {c.fin||c.periodo_fin||""}</td>
                  <td style={{...S.td,fontSize:"11px",color:"#3d5070"}}>{(c.lectura_ini||c.lectura_anterior||0).toLocaleString()}</td>
                  <td style={{...S.td,fontSize:"11px",color:"#5a6a7e"}}>{(c.lectura_fin||c.lectura_actual||0).toLocaleString()}</td>
                  <td style={{...S.td,fontSize:"14px",fontWeight:"700",color:"#1aff70"}}>{c.kwh||((c.lectura_actual||0)-(c.lectura_anterior||0))}</td>
                  <td style={{...S.td,fontSize:"13px",fontWeight:"600",color:"#a78bfa"}}>${Number(c.importe||c.total||0).toFixed(2)}</td>
                  <td style={{...S.td,fontSize:"11px",color:"#f97316"}}>
                    ${(Number(c.importe||c.total||0)/Math.max(1,c.kwh||((c.lectura_actual||0)-(c.lectura_anterior||0)))).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { usuario, logout }  = useAuth();
  const navigate             = useNavigate();

  // ── Estado de datos del backend ───────────────────────────
  const [servicio,  setServicio]  = useState(null);
  const [cargando,  setCargando]  = useState(true);
  const [recibos,   setRecibos]   = useState([]);
  const [tarifa,    setTarifa]    = useState(TARIFA_DEFAULT);
  const [cicloInfo, setCicloInfo] = useState(null);

  // ── Estado local (lecturas del ciclo activo) ──────────────
  const [regs,    setRegs]    = useState([]);
  const [tab,     setTab]     = useState("dashboard");
  const [form,    setForm]    = useState({ fecha:new Date().toISOString().split("T")[0], lectura:"", tipo:"lectura_diaria", nota:"" });
  const [preview, setPreview] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg,  setErrorMsg]  = useState(null);

  // ── Carga inicial ─────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    try {
      const { data: svcs } = await api.get("/servicios/");
      if (!svcs[0]) { setCargando(false); return; }
      const svc = svcs[0];
      setServicio(svc);
      setCicloInfo({ inicio: svc.fecha_alta?.split("T")[0] || new Date().toISOString().split("T")[0], dias_est: 60 });

      const [evRes, recRes, ciclosRes] = await Promise.all([
        api.get("/lecturas", { params: { servicio_id: svc.id } }),
        api.get("/recibos",  { params: { servicio_id: svc.id } }),
        api.get("/ciclos",   { params: { servicio_id: svc.id } }),
      ]);

      // Mapear eventos a registros internos
      const mapped = evRes.data.map(eventoToReg)
        .sort((a,b) => a.fecha.localeCompare(b.fecha));

      // Inyectar registro de apertura desde el ciclo activo
      // para que el motor de interpolación tenga punto de partida
      const cicloActivo = ciclosRes.data.find(c => c.estado === "abierto");
      if (cicloActivo && cicloActivo.lectura_inicial) {
        const fechaApertura = cicloActivo.fecha_inicio;
        const yaExiste = mapped.some(r => r.fecha === fechaApertura && r.lectura === cicloActivo.lectura_inicial);
        if (!yaExiste) {
          mapped.unshift({
            id:       "apertura-" + cicloActivo.id,
            fecha:    fechaApertura,
            lectura:  cicloActivo.lectura_inicial,
            tipo:     "cierre_ciclo",
            estimada: false,
            nota:     "Lectura CFE — apertura de ciclo",
          });
        }
        setCicloInfo({ inicio: fechaApertura, dias_est: 60 });
      }

      setRegs(mapped);

      // Mapear recibos a ciclos históricos
      const ciclos = [...evRes.data.map ? [] : [],
        ...recRes.data.map(reciboToCiclo)
      ].sort((a,b) => String(a.inicio).localeCompare(String(b.inicio)));
      setRecibos(ciclos);

      // Tarifa del último recibo
      const ultimo = recRes.data[0];
      if (ultimo?.tarifa_precio_basico) {
        setTarifa({
          bas_lim: ultimo.tarifa_limite_basico     || 150,
          int_lim: ultimo.tarifa_limite_intermedio || 280,
          p_bas:   Number(ultimo.tarifa_precio_basico),
          p_int:   Number(ultimo.tarifa_precio_intermedio),
          p_exc:   Number(ultimo.tarifa_precio_excedente),
          dap:     Number(ultimo.dap)  || 68.37,
          iva:     0.16,
        });
      }

      // ciclo abierto
      const fechaInicio = svc.fecha_alta
        ? svc.fecha_alta.split("T")[0]
        : (mapped[0]?.fecha || new Date().toISOString().split("T")[0]);
      setCicloInfo({ inicio: fechaInicio, dias_est: 60 });

    } catch(e) {
      console.error("Error cargando datos:", e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // ── Formulario — preview interpolación ───────────────────
  function handleLecturaChange(val) {
    setForm(f=>({...f,lectura:val}));
    const lec = parseInt(val);
    if (!lec || !form.fecha) { setPreview(null); return; }
    const ult = [...regs].sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(-1)[0];
    if (!ult || lec <= ult.lectura) { setPreview(null); return; }
    const gen = interpolateGaps(regs, { fecha:form.fecha, lectura:lec, tipo:form.tipo });
    setPreview(gen.length ? gen : null);
  }

  async function agregar() {
    const lec = parseInt(form.lectura);
    if (!lec || !servicio) return;
    const ult = [...regs].sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(-1)[0];
    if (ult && lec <= ult.lectura) { setErrorMsg(`La lectura debe ser mayor a ${ult.lectura}`); return; }

    setGuardando(true);
    setErrorMsg(null);
    try {
      await api.post("/lecturas", {
        servicio_id:   servicio.id,
        lectura_valor: lec,
        tipo:          form.tipo,
        fecha:         form.fecha,
        notas:         form.nota,
      });
      // Recargar lecturas desde el backend
      const { data } = await api.get("/lecturas", { params: { servicio_id: servicio.id } });
      setRegs(data.map(eventoToReg).sort((a,b) => a.fecha.localeCompare(b.fecha)));
      setForm(f=>({...f,lectura:"",nota:""}));
      setPreview(null);
    } catch(e) {
      setErrorMsg(e.response?.data?.error || "Error al guardar la lectura");
    } finally {
      setGuardando(false);
    }
  }

  // ── Stats derivados ───────────────────────────────────────
  const stats = useMemo(() => {
    if (!regs.length) return null;
    const sorted = [...regs].sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const inicio = sorted[0];
    const ultima = sorted[sorted.length-1];
    const kwh    = ultima.lectura - inicio.lectura;
    const dias   = Math.max(1, daysBetween(cicloInfo?.inicio || inicio.fecha, ultima.fecha));
    const reales = sorted.filter(r => !r.estimada);
    let kwhDia = 0;
    if (reales.length >= 2) {
      let tk=0, td=0;
      for (let i=1;i<reales.length;i++) {
        tk += reales[i].lectura - reales[i-1].lectura;
        td += Math.max(1, daysBetween(reales[i-1].fecha, reales[i].fecha));
      }
      kwhDia = +(tk/td).toFixed(2);
    } else {
      kwhDia = +(kwh/Math.max(1,dias)).toFixed(2);
    }
    const kwhProy = Math.round(kwhDia * (cicloInfo?.dias_est || 60));
    const cA = calcCosto(kwh, tarifa);
    const cP = calcCosto(kwhProy, tarifa);
    const nA = nivelColor(kwh, tarifa);
    const nP = nivelColor(kwhProy, tarifa);
    const diarios = sorted.slice(1).map((r,i) => {
      const prev  = sorted[i];
      const d     = Math.max(1, daysBetween(prev.fecha, r.fecha));
      const kwhD  = +((r.lectura-prev.lectura)/d).toFixed(1);
      const acum  = r.lectura - sorted[0].lectura;
      return { fecha:r.fecha.slice(5), kwhDia:kwhD, acum, estimada:r.estimada,
               anomalia:!r.estimada && kwhD>kwhDia*1.6, nota:r.nota };
    });
    return { kwh, dias, kwhDia, kwhProy, cA, cP, nA, nP, diarios, ultima };
  }, [regs, tarifa, cicloInfo]);

  const countEst  = regs.filter(r=>r.estimada).length;

  const histData  = recibos.map(c => ({
    per:  String(c.fin).slice(5,10) || String(c.id),
    kwh:  c.kwh, imp: c.importe,
    cKwh: +(c.importe/Math.max(1,c.kwh)).toFixed(2),
    dKwh: +(c.kwh/Math.max(1,c.dias)).toFixed(1),
  }));

  const navItems = [
    {key:"dashboard",label:"📊  Panel"},
    {key:"registros",label:"📝  Registros"},
    {key:"historico",label:"📈  Histórico"},
    {key:"tarifas",  label:"⚡  Tarifas"},
    {key:"recibos",  label:"📄  Recibos"},
  ];

  if (cargando) return (
    <div style={{ minHeight:"100vh", background:"#070b10", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <span style={{ color:"#3d5070", fontFamily:"'Courier New',monospace", letterSpacing:"2px" }}>CARGANDO...</span>
    </div>
  );

  return (
    <div style={S.root}>

      {/* HEADER */}
      <div style={S.header}>
        <div>
          <div style={{fontSize:"9px",color:ACCENT,letterSpacing:"4px"}}>ENERGY TRACKER · Tarifa 01</div>
          <div style={{fontSize:"22px",fontWeight:"700",color:"#fff",letterSpacing:"2px",marginTop:"2px"}}>⚡ MONITOR ELÉCTRICO</div>
          {servicio && (
            <div style={{fontSize:"10px",color:"#3d5070",marginTop:"3px"}}>
              No. Servicio {servicio.numero_servicio || "—"} · Medidor {servicio.numero_medidor || "—"} · {servicio.ciudad || ""}{servicio.estado_rep ? `, ${servicio.estado_rep}` : ""}
            </div>
          )}
        </div>
        <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"4px"}}>
          <div style={{fontSize:"9px",color:"#3d5070",letterSpacing:"2px"}}>CICLO ACTUAL B1-{new Date().getFullYear()}</div>
          {stats && (
            <div style={{fontSize:"11px",color:ACCENT}}>Día {stats.dias} de ~{cicloInfo?.dias_est || 60}</div>
          )}
          {countEst>0 && <div style={{fontSize:"10px",color:"#f59e0b"}}>⚠ {countEst} lecturas estimadas</div>}
          <div style={{display:"flex",gap:"8px",marginTop:"4px"}}>
            <span style={{fontSize:"10px",color:"#3d5070"}}>{usuario?.nombre_usuario}</span>
            {usuario?.rol === "admin" && (
              <button onClick={()=>navigate("/admin")} style={{background:"none",border:"1px solid #1d2430",color:"#3d5070",padding:"2px 8px",fontSize:"10px",cursor:"pointer",borderRadius:"3px",fontFamily:"inherit"}}>CONFIG</button>
            )}
            <button onClick={()=>{logout();navigate("/login");}} style={{background:"none",border:"1px solid #1d2430",color:"#3d5070",padding:"2px 8px",fontSize:"10px",cursor:"pointer",borderRadius:"3px",fontFamily:"inherit"}}>SALIR</button>
          </div>
        </div>
      </div>

      {/* NAV */}
      <div style={S.nav}>
        {navItems.map(n=>(
          <button key={n.key} onClick={()=>setTab(n.key)} style={{
            padding:"11px 20px",backgroundColor:"transparent",border:"none",
            borderBottom:tab===n.key?`2px solid ${ACCENT}`:"2px solid transparent",
            color:tab===n.key?ACCENT:"#3d5070",cursor:"pointer",fontSize:"10px",
            letterSpacing:"2px",textTransform:"uppercase",fontFamily:"inherit",transition:"color 0.2s",
          }}>{n.label}</button>
        ))}
      </div>

      <div style={S.body}>

        {/* ══════════ DASHBOARD ══════════ */}
        {tab==="dashboard" && stats && (
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"14px",marginBottom:"20px"}}>
              <KpiCard icon="⚡" label="Consumo actual"      value={`${stats.kwh} kWh`}          sub={`${stats.dias} días transcurridos`}  col={stats.nA.col}/>
              <KpiCard icon="📅" label="Prom. diario (real)"  value={`${stats.kwhDia} kWh/día`}   sub="Solo lecturas verificadas"           col="#60a5fa"/>
              <KpiCard icon="💰" label="Saldo estimado hoy"   value={mxn(stats.cA.total)}          sub={`Nivel: ${stats.nA.nivel}`}         col="#a78bfa"/>
              <KpiCard icon="🔮" label="Proyección cierre"    value={`${stats.kwhProy} kWh`}       sub={mxn(stats.cP.total)}                col={stats.nP.col}/>
            </div>

            {/* Barra nivel */}
            <div style={{...S.card(),marginBottom:"20px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                <div>
                  <span style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px"}}>NIVEL: </span>
                  <span style={{fontSize:"13px",fontWeight:"700",color:stats.nA.col}}>{stats.nA.nivel}</span>
                </div>
                <div style={{fontSize:"10px",color:"#5a6a7e"}}>{stats.kwh} kWh · B≤{tarifa.bas_lim} · I≤{tarifa.int_lim}</div>
              </div>
              <div style={{position:"relative",height:"14px",backgroundColor:"#131922",borderRadius:"7px",overflow:"hidden"}}>
                {[tarifa.bas_lim, tarifa.int_lim].map(lim=>(
                  <div key={lim} style={{position:"absolute",left:`${(lim/(tarifa.int_lim*1.5))*100}%`,top:0,bottom:0,width:"2px",
                    backgroundColor:lim===tarifa.bas_lim?"#f59e0b":"#ef4444",zIndex:2}}/>
                ))}
                <div style={{height:"100%",width:`${Math.min((stats.kwh/(tarifa.int_lim*1.5))*100,100)}%`,
                  background:stats.kwh<=tarifa.bas_lim?"#22c55e":stats.kwh<=tarifa.int_lim?"#f59e0b":"#ef4444",
                  borderRadius:"7px",transition:"width 0.6s ease"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:"5px",fontSize:"9px",color:"#3d5070"}}>
                <span>0</span>
                <span style={{color:"#f59e0b"}}>Básico {tarifa.bas_lim}</span>
                <span style={{color:"#ef4444"}}>Intermedio {tarifa.int_lim}</span>
                <span>{Math.round(tarifa.int_lim*1.5)} kWh</span>
              </div>
            </div>

            {/* Gráfica + Desglose */}
            <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:"14px",marginBottom:"20px"}}>
              <div style={S.card()}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
                  <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase"}}>
                    Consumo Diario — Ciclo Actual
                  </div>
                  <div style={{display:"flex",gap:"14px",fontSize:"9px",alignItems:"center"}}>
                    <span style={{color:ACCENT}}>█ real</span>
                    <span style={{color:"#f59e0b"}}>█ estimado</span>
                    <span style={{color:"#ef4444"}}>█ anomalía</span>
                    <span style={{color:"#818cf8",borderBottom:"2px dashed #818cf8",paddingBottom:"1px"}}>── acumulado</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={230}>
                  <ComposedChart data={stats.diarios} margin={{top:4,right:52,bottom:0,left:-20}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1d2430"/>
                    <XAxis dataKey="fecha" tick={{fill:"#3d5070",fontSize:9}}/>
                    <YAxis yAxisId="dia"  orientation="left"  tick={{fill:"#3d5070",fontSize:10}}/>
                    <YAxis yAxisId="acum" orientation="right" tick={{fill:"#818cf8",fontSize:10}} axisLine={{stroke:"#818cf840"}} tickLine={{stroke:"#818cf840"}}/>
                    <Tooltip content={<DailyTooltip/>}/>
                    <ReferenceLine yAxisId="dia" y={stats.kwhDia} stroke={ACCENT} strokeDasharray="5 3"
                      label={{value:`↔ ${stats.kwhDia}`,fill:ACCENT,fontSize:9,position:"insideTopRight"}}/>
                    <Bar yAxisId="dia" dataKey="kwhDia" radius={[3,3,0,0]}
                      shape={(props)=>{
                        const {x,y,width,height,payload}=props;
                        const col=payload.estimada?"#f59e0b":payload.anomalia?"#ef4444":ACCENT;
                        return <rect x={x} y={y} width={width} height={height} fill={col} fillOpacity={payload.estimada?0.45:0.85} rx={3} ry={3}/>;
                      }}/>
                    <Line yAxisId="acum" dataKey="acum" type="monotone" stroke="#818cf8" strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{r:4,fill:"#818cf8"}}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={S.card()}>
                <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"14px"}}>
                  Desglose Costo Estimado
                </div>
                {[
                  {lbl:`Básico  (${stats.cA.bas} × $${tarifa.p_bas})`,  val:stats.cA.bas*tarifa.p_bas, col:"#22c55e"},
                  {lbl:`Interm. (${stats.cA.int} × $${tarifa.p_int})`,  val:stats.cA.int*tarifa.p_int, col:"#f59e0b"},
                  {lbl:`Excede. (${stats.cA.exc} × $${tarifa.p_exc})`,  val:stats.cA.exc*tarifa.p_exc, col:"#ef4444"},
                  {lbl:"IVA 16%",                                        val:stats.cA.iva,              col:"#5a6a7e"},
                  {lbl:"DAP",                                            val:stats.cA.dap,              col:"#5a6a7e"},
                ].map((row,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:"10px",
                    paddingBottom:"10px",borderBottom:i<4?"1px solid #1d2430":"none"}}>
                    <span style={{fontSize:"10px",color:"#5a6a7e"}}>{row.lbl}</span>
                    <span style={{fontSize:"12px",color:row.col,fontWeight:"700"}}>{mxn(row.val)}</span>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",borderTop:"2px solid #2a3448",paddingTop:"10px",marginTop:"4px"}}>
                  <span style={{fontSize:"12px",fontWeight:"700"}}>TOTAL HOY</span>
                  <span style={{fontSize:"18px",fontWeight:"700",color:ACCENT}}>{mxn(stats.cA.total)}</span>
                </div>
                <div style={{marginTop:"10px",padding:"8px 12px",backgroundColor:"#0c1016",borderRadius:"6px",border:"1px solid #1d2430"}}>
                  <div style={{fontSize:"9px",color:"#3d5070",letterSpacing:"1px"}}>PROYECCIÓN CIERRE (~{cicloInfo?.dias_est||60}d)</div>
                  <div style={{fontSize:"15px",color:stats.nP.col,fontWeight:"700",marginTop:"4px"}}>
                    {stats.kwhProy} kWh → {mxn(stats.cP.total)}
                  </div>
                </div>
              </div>
            </div>

            <FormularioLectura form={form} setForm={setForm} regs={regs}
              handleLecturaChange={handleLecturaChange} agregar={agregar} preview={preview} guardando={guardando}/>
            {errorMsg && <div style={{marginTop:"10px",color:"#ef4444",fontSize:"11px"}}>❌ {errorMsg}</div>}
          </div>
        )}

        {/* ══════════ REGISTROS ══════════ */}
        {tab==="registros" && (
          <div>
            <div style={{marginBottom:"20px"}}>
              <FormularioLectura form={form} setForm={setForm} regs={regs}
                handleLecturaChange={handleLecturaChange} agregar={agregar} preview={preview} guardando={guardando}/>
              {errorMsg && <div style={{marginTop:"10px",color:"#ef4444",fontSize:"11px"}}>❌ {errorMsg}</div>}
            </div>

            {countEst>0 && (
              <div style={{...S.card("#f59e0b30"),marginBottom:"16px",padding:"12px 16px",display:"flex",gap:"12px",alignItems:"center"}}>
                <span style={{fontSize:"16px"}}>⚠️</span>
                <div>
                  <span style={{fontSize:"11px",color:"#f59e0b",fontWeight:"700"}}>{countEst} registros estimados por interpolación</span>
                  <span style={{fontSize:"10px",color:"#5a6a7e",marginLeft:"12px"}}>
                    Fondo ámbar · Repartidos proporcionalmente · Residuo en el último día real
                  </span>
                </div>
              </div>
            )}

            <div style={{...S.card(),padding:0,overflow:"hidden"}}>
              <div style={{padding:"14px 20px",borderBottom:"1px solid #1d2430",display:"flex",justifyContent:"space-between"}}>
                <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase"}}>Tabla de Eventos — Ciclo Actual</div>
                <div style={{fontSize:"10px",color:"#3d5070"}}>{regs.length} total · {regs.filter(r=>!r.estimada).length} reales · {countEst} estimados</div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={S.table}>
                  <thead>
                    <tr>{["Fecha","Lectura kWh","Δ kWh","kWh/día","Tipo","💸 Costo Día","Costo Acum.","Nota"].map((h,hi)=>(
                      <th key={h} style={{...S.th, color:hi===5?"#c084fc":"#5a6a7e",
                        borderLeft:hi===5?"1px solid #2a1f40":"none", borderRight:hi===5?"1px solid #2a1f40":"none",
                        backgroundColor:hi===5?"#120d1e":"#0c1016"}}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {[...regs].sort((a,b)=>b.fecha.localeCompare(a.fecha)).map((r,ri)=>{
                      const sorted    = [...regs].sort((a,b)=>a.fecha.localeCompare(b.fecha));
                      const idx       = sorted.findIndex(x=>x.id===r.id);
                      const prev      = sorted[idx-1];
                      const kwhAcum   = r.lectura - sorted[0].lectura;
                      const kwhAcumPrev = prev ? prev.lectura - sorted[0].lectura : 0;
                      const delta     = prev ? r.lectura-prev.lectura : 0;
                      const dDias     = prev ? Math.max(1,daysBetween(prev.fecha,r.fecha)) : 1;
                      const kwhD      = prev ? +(delta/dDias).toFixed(1) : 0;
                      const anomal    = !r.estimada && prev && stats && kwhD > stats.kwhDia*1.6;
                      const cAcum     = calcCosto(kwhAcum, tarifa);
                      const cm        = idx > 0 ? calcCostoDia(kwhAcum, kwhAcumPrev, tarifa) : null;
                      const cmColores = { bas:"#22c55e", int:"#f59e0b", exc:"#ef4444" };
                      const rowBg     = r.estimada?"#140f00":anomal?"#1e0f0f":ri%2===0?"#0c1016":"transparent";
                      return (
                        <tr key={r.id} style={{backgroundColor:rowBg}}>
                          <td style={{...S.td,fontSize:"11px",color:r.estimada?"#a07020":"#94a3b8",fontStyle:r.estimada?"italic":"normal"}}>{r.fecha}</td>
                          <td style={{...S.td,fontSize:"13px",fontWeight:"700",color:r.estimada?"#c08020":ACCENT,letterSpacing:"1px"}}>{r.lectura.toLocaleString()}</td>
                          <td style={{...S.td,fontSize:"12px",color:delta>0?r.estimada?"#c08020":ACCENT:"#3d5070"}}>{delta>0?`+${delta}`:delta||"—"}</td>
                          <td style={{...S.td,fontSize:"11px",color:anomal?"#ef4444":"#5a6a7e"}}>{kwhD>0?`${kwhD}`:""}</td>
                          <td style={S.td}><TipoBadge tipo={r.tipo} estimada={r.estimada}/></td>
                          <td style={{...S.td,borderLeft:"1px solid #2a1f40",borderRight:"1px solid #2a1f40",backgroundColor:"#0d0a18"}}>
                            {cm ? (
                              <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
                                <span style={{fontSize:"13px",fontWeight:"700",color:r.estimada?"#c08020":cmColores[cm.rango],opacity:r.estimada?0.7:1}}>
                                  {mxn(cm.total)}
                                </span>
                                {cm.cruce && <span style={{fontSize:"8px",padding:"2px 5px",borderRadius:"3px",backgroundColor:"#2d1f00",color:"#f59e0b",letterSpacing:"1px",fontWeight:"700"}}>CRUCE</span>}
                              </div>
                            ) : <span style={{color:"#2a3448",fontSize:"11px"}}>—</span>}
                          </td>
                          <td style={{...S.td,fontSize:"12px",color:"#a78bfa"}}>{kwhAcum>0?mxn(cAcum.total):"—"}</td>
                          <td style={{...S.td,fontSize:"10px",color:r.estimada?"#a07020":"#3d5070",fontStyle:r.estimada?"italic":"normal",maxWidth:"240px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.nota||"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ HISTÓRICO ══════════ */}
        {tab==="historico" && (
          <div>
            {recibos.length < 2 && (
              <div style={{...S.card("#ca8a0430"),marginBottom:"20px",padding:"12px 16px"}}>
                <span style={{fontSize:"11px",color:"#fde68a"}}>ℹ️ Agrega más recibos en la pestaña <strong>Recibos</strong> para ver tendencias históricas completas.</span>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",marginBottom:"20px"}}>
              <div style={S.card()}>
                <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",marginBottom:"14px"}}>CONSUMO BIMESTRAL (kWh)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={histData} margin={{top:0,right:0,bottom:0,left:-20}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1d2430"/>
                    <XAxis dataKey="per" tick={{fill:"#3d5070",fontSize:9}}/>
                    <YAxis tick={{fill:"#3d5070",fontSize:10}}/>
                    <Tooltip contentStyle={ttStyle} formatter={v=>[`${v} kWh`,"Consumo"]}/>
                    <Bar dataKey="kwh" radius={[3,3,0,0]} fill="#1aff70"/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={S.card()}>
                <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",marginBottom:"14px"}}>IMPORTE BIMESTRAL (MXN)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={histData} margin={{top:0,right:0,bottom:0,left:-10}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1d2430"/>
                    <XAxis dataKey="per" tick={{fill:"#3d5070",fontSize:9}}/>
                    <YAxis tick={{fill:"#3d5070",fontSize:10}}/>
                    <Tooltip contentStyle={ttStyle} formatter={v=>[mxn(v),"Importe"]}/>
                    <Area type="monotone" dataKey="imp" stroke="#a78bfa" fill="#a78bfa20" strokeWidth={2}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{...S.card(),marginBottom:"20px"}}>
              <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",marginBottom:"14px"}}>kWh/DÍA PROMEDIO — detecta cambios de hábito o temporada</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={histData} margin={{top:0,right:0,bottom:0,left:-20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1d2430"/>
                  <XAxis dataKey="per" tick={{fill:"#3d5070",fontSize:9}}/>
                  <YAxis tick={{fill:"#3d5070",fontSize:10}}/>
                  <Tooltip contentStyle={ttStyle} formatter={v=>[`${v} kWh/día`,"Promedio"]}/>
                  <Line type="monotone" dataKey="dKwh" stroke="#f97316" strokeWidth={2} dot={{fill:"#f97316",r:3}}/>
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{...S.card(),padding:0,overflow:"hidden"}}>
              <div style={{padding:"14px 20px",borderBottom:"1px solid #1d2430"}}>
                <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase"}}>Histórico Completo — {recibos.length} Ciclos</div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={S.table}>
                  <thead>
                    <tr>{["#","Período","Días","Lec. Ini","Lec. Fin","kWh","kWh/día","Importe","$/kWh","Nivel"].map(h=>(
                      <th key={h} style={S.th}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {[...recibos].reverse().map((c,i)=>{
                      const {nivel,col}=nivelColor(c.kwh,tarifa);
                      return (
                        <tr key={c.id} style={{backgroundColor:i===0?"#0d1f17":i%2===0?"#0c1016":"transparent"}}>
                          <td style={{...S.td,fontSize:"10px",color:"#3d5070"}}>B{c.id}</td>
                          <td style={{...S.td,fontSize:"11px"}}>{c.inicio} → {c.fin}</td>
                          <td style={{...S.td,fontSize:"11px",color:"#3d5070"}}>{c.dias}d</td>
                          <td style={{...S.td,fontSize:"11px",color:"#3d5070"}}>{c.lectura_ini.toLocaleString()}</td>
                          <td style={{...S.td,fontSize:"11px",color:"#5a6a7e"}}>{c.lectura_fin.toLocaleString()}</td>
                          <td style={{...S.td,fontSize:"14px",fontWeight:"700",color:col}}>{c.kwh}</td>
                          <td style={{...S.td,fontSize:"11px",color:"#5a6a7e"}}>{+(c.kwh/Math.max(1,c.dias)).toFixed(1)}</td>
                          <td style={{...S.td,fontSize:"13px",fontWeight:"600",color:"#a78bfa"}}>{mxn(c.importe)}</td>
                          <td style={{...S.td,fontSize:"11px",color:"#f97316"}}>${(c.importe/Math.max(1,c.kwh)).toFixed(2)}</td>
                          <td style={S.td}><NivelBadge kwh={c.kwh} tarifa={tarifa}/></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {recibos.length > 0 && (
                    <tfoot>
                      <tr style={{backgroundColor:"#0c1016",borderTop:"2px solid #2a3448"}}>
                        <td colSpan={5} style={{...S.td,fontSize:"10px",color:"#5a6a7e",textTransform:"uppercase"}}>TOTALES ({recibos.length} ciclos)</td>
                        <td style={{...S.td,fontSize:"13px",fontWeight:"700",color:ACCENT}}>
                          {recibos.reduce((a,c)=>a+c.kwh,0).toLocaleString()} kWh
                        </td>
                        <td style={{...S.td,fontSize:"11px",color:"#5a6a7e"}}>
                          {+(recibos.reduce((a,c)=>a+c.kwh,0)/Math.max(1,recibos.reduce((a,c)=>a+c.dias,0))).toFixed(1)} prom
                        </td>
                        <td style={{...S.td,fontSize:"13px",fontWeight:"700",color:"#a78bfa"}}>
                          {mxn(recibos.reduce((a,c)=>a+c.importe,0))}
                        </td>
                        <td colSpan={2}/>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ TARIFAS ══════════ */}
        {tab==="tarifas" && (
          <div>
            <div style={{...S.card(),marginBottom:"20px"}}>
              <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"16px"}}>
                Tarifa 01 Vigente — {servicio?.ciudad || ""}{servicio?.estado_rep ? `, ${servicio.estado_rep}` : ""}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"14px"}}>
                {[
                  {rango:"BÁSICO",     rng:`0 – ${tarifa.bas_lim} kWh`,           precio:`$${tarifa.p_bas}`,  col:"#22c55e"},
                  {rango:"INTERMEDIO", rng:`${tarifa.bas_lim+1} – ${tarifa.int_lim} kWh`, precio:`$${tarifa.p_int}`,  col:"#f59e0b"},
                  {rango:"EXCEDENTE",  rng:`> ${tarifa.int_lim} kWh`,              precio:`$${tarifa.p_exc}`,  col:"#ef4444"},
                ].map((t,i)=>(
                  <div key={i} style={{backgroundColor:"#131922",borderRadius:"8px",padding:"18px",border:`1px solid ${t.col}25`}}>
                    <div style={{fontSize:"9px",color:t.col,letterSpacing:"3px",textTransform:"uppercase",marginBottom:"8px"}}>{t.rango}</div>
                    <div style={{fontSize:"11px",color:"#3d5070",marginBottom:"6px"}}>{t.rng}</div>
                    <div style={{fontSize:"32px",fontWeight:"700",color:t.col}}>{t.precio}<span style={{fontSize:"13px"}}>/kWh</span></div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px",marginTop:"14px"}}>
                {[
                  {l:"IVA",   v:"16%",              c:"#60a5fa"},
                  {l:"DAP",   v:`$${tarifa.dap}`,   c:"#f97316"},
                ].map((it,i)=>(
                  <div key={i} style={{backgroundColor:"#131922",borderRadius:"6px",padding:"12px 14px",
                    border:"1px solid #1d2430",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:"9px",color:"#3d5070"}}>{it.l}</div>
                    <div style={{fontSize:"17px",fontWeight:"700",color:it.c}}>{it.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {histData.length > 0 && (
              <div style={S.card()}>
                <div style={{fontSize:"10px",color:"#5a6a7e",letterSpacing:"2px",marginBottom:"4px"}}>TENDENCIA $/kWh PROMEDIO</div>
                <div style={{fontSize:"10px",color:"#3d5070",marginBottom:"14px"}}>Importe ÷ kWh · Refleja impacto del rango + ajuste tarifario bimestral.</div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={histData} margin={{top:0,right:0,bottom:0,left:-10}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1d2430"/>
                    <XAxis dataKey="per" tick={{fill:"#3d5070",fontSize:9}}/>
                    <YAxis tick={{fill:"#3d5070",fontSize:10}} domain={["auto","auto"]}/>
                    <Tooltip contentStyle={ttStyle} formatter={v=>[`$${v}/kWh`,"Costo promedio"]}/>
                    <Line type="monotone" dataKey="cKwh" stroke="#f97316" strokeWidth={2.5} dot={{fill:"#f97316",r:4}}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ══════════ RECIBOS ══════════ */}
        {tab==="recibos" && (
          <TabRecibosHistorial
            recibos={recibos}
            servicioId={servicio?.id}
            onActualizado={() => {
              if (servicio?.id) getRecibos(servicio.id).then(setRecibos).catch(() => {})
            }}
          />
        )}

        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>

      {/* Footer */}
      <div style={{padding:"10px 28px",borderTop:"1px solid #1d2430",display:"flex",justifyContent:"space-between",fontSize:"9px",color:"#2a3448",letterSpacing:"1px"}}>
        <span>ENERGY TRACKER · TARIFA 01 · {servicio?.ciudad?.toUpperCase() || ""} · {servicio?.numero_servicio || ""}</span>
        <span>CICLO B1-{new Date().getFullYear()} · {new Date().toLocaleDateString("es-MX")}</span>
      </div>
    </div>
  );
}
