"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/frontend/services/firebase";
import { MapFloor } from "@/frontend/components/maps/map-floor";
import { I } from "@/frontend/components/icons";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions, subscribeMembretes, iniciarJornada, pausarJornada, reanudarJornada, finalizarJornada, updateZone } from "@/frontend/services/firestore";
import { mapZoneToWarehousePosition } from "@/frontend/services/warehouse-layout";
import type { Zone, Armador, ScanSession, Pos, Membrete, MembreteProduct } from "@/types";

/* ─── Constants ─── */
const ZONE_COLORS: Record<string, string> = {
  Z01: "#0D9488", Z02: "#6366F1", Z03: "#8B5CF6", Z04: "#F59E0B", Z05: "#10B981", Z06: "#EF4444",
  Z07: "#0EA5E9", Z08: "#EC4899", Z09: "#14B8A6", Z10: "#F97316", Z11: "#3B82F6", Z12: "#A855F7",
  Z13: "#22C55E", Z14: "#E11D48", Z15: "#06B6D4", Z16: "#84CC16", Z17: "#D946EF", Z18: "#0891B2",
  Z19: "#65A30D", Z20: "#DC2626",
};

/** Paleta de respaldo (las mismas 20 tonalidades de ZONE_COLORS, en orden) para
 * cualquier código de zona real que no siga el patrón "Z01".."Z20" — este
 * proyecto tiene zonas con nombres propios ("ACCESO-SUPERPACK") o códigos
 * numéricos, y el mapa fijo nunca los va a cubrir. */
const ZONE_COLOR_FALLBACK = Object.values(ZONE_COLORS);
function colorForZone(code: string): string {
  if (ZONE_COLORS[code]) return ZONE_COLORS[code];
  // hash simple y estable (mismo código -> siempre el mismo color en esta sesión)
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  return ZONE_COLOR_FALLBACK[hash % ZONE_COLOR_FALLBACK.length];
}

/* ─── Helpers ─── */
/** Genera array de horas del turno basado en inicio/fin (ej. "20:00" a "06:00") */
function buildShiftHours(inicio: string, _fin: string): string[] {
  const [startH] = inicio.split(":").map(Number);
  const hours: string[] = [];
  const h = startH;
  for (let i = 0; i <= 10; i++) {
    const cur = (h + i) % 24;
    const suffix = cur === 0 ? "12am" : cur < 12 ? `${cur}am` : cur === 12 ? "12pm" : `${cur - 12}pm`;
    hours.push(suffix);
  }
  return hours;
}

function getSatisfactionStatus(s: number): { label: string; color: string; bg: string } {
  // Mismos umbrales/colores que las bandas y la leyenda del gráfico "Satisfacción por hora"
  // (antes este helper usaba 75/50/25 mientras el gráfico dibujaba 85/70/55 — quedaban descoordinados).
  if (s >= 85) return { label: "Óptimo", color: "#3f9d6b", bg: "rgba(63,157,107,0.10)" };
  if (s >= 70) return { label: "Bien", color: "#3e9ab0", bg: "rgba(62,154,176,0.08)" };
  if (s >= 55) return { label: "Atención", color: "#c98a2e", bg: "rgba(201,138,46,0.10)" };
  return { label: "Crítico", color: "#c85c54", bg: "rgba(200,92,84,0.08)" };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN: MOD-PANTALLA
   ═══════════════════════════════════════════════════════════════════════════════ */

export function ModPantalla() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [clock, setClock] = useState(new Date());
  const [isFs, setIsFs] = useState(false);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [shiftConfig, setShiftConfig] = useState<{ inicio: string; fin: string }>({ inicio: "20:00", fin: "06:00" });
  /** Meta real de productos/hora configurada por la empresa (Company.metaProdHora) — null si no está configurada. */
  const [metaProdHora, setMetaProdHora] = useState<number | null>(null);
  const [jornadaActiva, setJornadaActiva] = useState(false);
  const [jornadaPaused, setJornadaPaused] = useState(false);
  const [jornadaLoading, setJornadaLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  /** Medición defensiva del alto disponible del panel "Monitor de zonas" en
   *  pantalla completa — evita depender de que flex/grid calculen bien el alto
   *  a través de varios niveles anidados (y de particularidades de la Fullscreen API). */
  const monitorScrollRef = useRef<HTMLDivElement>(null);
  const [monitorMaxH, setMonitorMaxH] = useState<number | null>(null);
  /** Anchos ajustables arrastrando los divisores — el usuario puede encoger un
   *  lado y agrandar el otro; se guardan en localStorage para recordarlos. */
  const [mapPct, setMapPct] = useState(55); // % de ancho de "Mapa de la bodega" (isFs)
  const [zoneLeftW, setZoneLeftW] = useState(340); // px de la columna izquierda de "Zona seleccionada"
  const [draggingSplit, setDraggingSplit] = useState<"main" | "zone" | null>(null);
  const [zoneNarrow, setZoneNarrow] = useState(false); // true cuando el panel de "Zona seleccionada" queda muy angosto
  const [mainNarrow, setMainNarrow] = useState(false); // true cuando Mapa+Monitor no entran cómodos lado a lado y se apilan
  const mainGridRef = useRef<HTMLDivElement>(null);
  const zoneGridRef = useRef<HTMLDivElement>(null);
  const lastMapPctRef = useRef(55);
  const lastZoneLeftWRef = useRef(340);

  // Cargar configuración del turno desde la empresa (ahora dentro del onSnapshot)
  // Detecta automáticamente el turno activo según la hora actual

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => {
      setZones(z);
      // Usar posiciones de Firestore si existen, solo computar para nuevas
      setPositions((prev) => {
        const pos: Record<string, Pos> = {};
        let sA = 0, sB = 0;
        z.forEach((zone) => {
          // Prioridad: posición de Firestore > posición previa > cálculo automático
          if (zone.position && (zone.position.x !== 0 || zone.position.y !== 0)) {
            pos[zone.code] = zone.position;
          } else if (prev[zone.code]) {
            pos[zone.code] = prev[zone.code];
          } else {
            const idx = zone.sector === "A" ? sA : sB;
            const mapped = mapZoneToWarehousePosition(zone.sector || "A", idx);
            pos[zone.code] = { x: mapped.x, y: mapped.y };
            if (zone.sector === "A") sA++; else sB++;
          }
        });
        return pos;
      });
      setLoading(false);
    });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubS = subscribeSessions(user.companyId, setSessions);
    const unsubM = subscribeMembretes(user.companyId, setMembretes);
    return () => { unsubZ(); unsubA(); unsubS(); unsubM(); };
  }, [user?.companyId]);

  // Subscribe to company for real-time jornada state + shift config
  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = onSnapshot(doc(db, "companies", user.companyId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setJornadaActiva(data.jornadaActiva || false);
      setJornadaPaused(!!data.jornadaPausedAt);

      // Use saved shift from jornada if active, otherwise auto-detect
      if (data.jornadaShiftInicio && data.jornadaShiftFin) {
        setShiftConfig({ inicio: data.jornadaShiftInicio, fin: data.jornadaShiftFin });
      } else {
        const currentH = new Date().getHours();
        const shifts: { inicio: string; fin: string }[] = [];
        if (data.turnoMananaInicio && data.turnoMananaFin) shifts.push({ inicio: data.turnoMananaInicio, fin: data.turnoMananaFin });
        if (data.turnoTardeInicio && data.turnoTardeFin) shifts.push({ inicio: data.turnoTardeInicio, fin: data.turnoTardeFin });
        if (data.turnoNocheInicio && data.turnoNocheFin) shifts.push({ inicio: data.turnoNocheInicio, fin: data.turnoNocheFin });

        if (shifts.length > 0) {
          const match = shifts.find((s) => {
            const startH = Number(s.inicio.split(":")[0]);
            const endH = Number(s.fin.split(":")[0]);
            if (startH < endH) {
              return currentH >= startH && currentH < endH;
            }
            return currentH >= startH || currentH < endH;
          });
          setShiftConfig(match || shifts[0]);
        }
      }

      setMetaProdHora(typeof data?.metaProdHora === "number" && data.metaProdHora > 0 ? data.metaProdHora : null);
    }, (error) => console.error("company onSnapshot error:", error));
    return () => unsub();
  }, [user?.companyId]);

  // Horas del turno computadas desde la config
  const SHIFT_HOURS = useMemo(() => buildShiftHours(shiftConfig.inicio, shiftConfig.fin), [shiftConfig]);

  // ─── Membretes por zona (fuente de verdad para estado) ────────────────
  const membretesByZone = useMemo(() => {
    const m: Record<string, Membrete[]> = {};
    membretes.forEach((mem) => {
      if (mem.zonaId) {
        if (!m[mem.zonaId]) m[mem.zonaId] = [];
        m[mem.zonaId].push(mem);
      }
    });
    return m;
  }, [membretes]);

  /** Estado REAL de una zona, derivado de sus membretes.
   * "assigned" ahora tambien cubre la cola: membretes esperando en la zona
   * que ningun armador ha tomado todavia (o que el supervisor ya puso ahi). */
  function displayStatus(zone: Zone): Zone["status"] {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    if (zoneMembretes.length === 0) return "idle";
    if (zoneMembretes.some((m) => m.status === "active")) return "active";
    if (zoneMembretes.every((m) => m.status === "completed")) return "done";
    if (zoneMembretes.some((m) => m.status === "cancelled")) return "incident";
    if (zoneMembretes.some((m) => m.armadorId || m.status === "pending")) return "assigned";
    return "idle";
  }

  /** TODOS los armadores trabajando en la zona ahora mismo (una zona puede
   * tener varios armadores a la vez tomando membretes de su cola). */
  function getArmadoresForZone(zone: Zone): Armador[] {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    const ids = Array.from(new Set(zoneMembretes.filter((m) => m.armadorId && m.status === "active").map((m) => m.armadorId as string)));
    return ids.map((id) => armadores.find((a) => a.id === id)).filter((a): a is Armador => !!a);
  }

  /** Membretes pendientes en cola (sin tomar) en la zona */
  function getColaForZone(zone: Zone): Membrete[] {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    return zoneMembretes.filter((m) => !m.armadorId && m.status === "pending");
  }

  useEffect(() => { const i = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  // Esc cierra el detalle de zona (overlay a pantalla completa e independiente)
  useEffect(() => {
    if (!selectedZone) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedZone(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedZone]);

  // Alto explícito (en px) del contenido scrolleable de "Monitor de zonas" en
  // pantalla completa, calculado en JS en vez de confiar solo en flex/minHeight:0
  // a través de varios contenedores anidados — así el scroll interno SIEMPRE
  // tiene un límite real y nunca se corta sin poder verse el resto del contenido.
  useEffect(() => {
    if (!isFs) { setMonitorMaxH(null); return; }
    const recompute = () => {
      const el = monitorScrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setMonitorMaxH(Math.max(160, window.innerHeight - top - 12));
    };
    recompute();
    const t1 = setTimeout(recompute, 60);
    const t2 = setTimeout(recompute, 300);
    window.addEventListener("resize", recompute);
    document.addEventListener("fullscreenchange", recompute);
    return () => {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener("resize", recompute);
      document.removeEventListener("fullscreenchange", recompute);
    };
  }, [isFs]);

  // Responsive automático: si el panel "Zona seleccionada" queda muy angosto
  // (p. ej. al encoger "Monitor de zonas" con el divisor principal), se apila en
  // una sola columna y reduce tamaños en vez de verse roto/encimado.
  useEffect(() => {
    const el = zoneGridRef.current;
    if (!el) { setZoneNarrow(false); return; }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setZoneNarrow(w < 620);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedZone]);

  // Responsive automático del split principal (Mapa ↔ Monitor) en pantalla completa:
  // si la ventana queda angosta, se apilan en vez de apretarse hasta verse mal.
  useEffect(() => {
    if (!isFs) { setMainNarrow(false); return; }
    const el = mainGridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setMainNarrow(w < 760);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFs]);

  // Recuerda los anchos que el usuario dejó arrastrando los divisores
  useEffect(() => {
    try {
      const savedMap = Number(localStorage.getItem("pantalla:mapPct"));
      if (savedMap && savedMap >= 25 && savedMap <= 75) { setMapPct(savedMap); lastMapPctRef.current = savedMap; }
      const savedZone = Number(localStorage.getItem("pantalla:zoneLeftW"));
      if (savedZone && savedZone >= 260 && savedZone <= 560) { setZoneLeftW(savedZone); lastZoneLeftWRef.current = savedZone; }
    } catch { /* noop */ }
  }, []);

  // Arrastre de los divisores: "main" = Mapa de la bodega ↔ Monitor de zonas,
  // "zone" = columna de identidad ↔ Armadores dentro de "Zona seleccionada".
  function startSplitDrag(kind: "main" | "zone") {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      setDraggingSplit(kind);
      const gridEl = kind === "main" ? mainGridRef.current : zoneGridRef.current;
      if (!gridEl) return;
      const prevCursor = document.body.style.cursor;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        const rect = gridEl.getBoundingClientRect();
        if (kind === "main") {
          const pct = Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100));
          lastMapPctRef.current = pct;
          setMapPct(pct);
        } else {
          const px = Math.min(560, Math.max(260, ev.clientX - rect.left));
          lastZoneLeftWRef.current = px;
          setZoneLeftW(px);
        }
      };
      const onUp = () => {
        setDraggingSplit(null);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        try {
          if (kind === "main") localStorage.setItem("pantalla:mapPct", String(lastMapPctRef.current));
          else localStorage.setItem("pantalla:zoneLeftW", String(lastZoneLeftWRef.current));
        } catch { /* noop */ }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  async function toggleFs() {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* noop */ }
  }

  async function handleIniciarJornada() {
    if (!user?.companyId) return;
    setJornadaLoading(true);
    try { await iniciarJornada(user.companyId, { uid: user.uid, name: user.name }); } catch { /* noop */ }
    setJornadaLoading(false);
  }
  async function handlePausarJornada() {
    if (!user?.companyId) return;
    setJornadaLoading(true);
    try { await pausarJornada(user.companyId, { uid: user.uid, name: user.name }); } catch { /* noop */ }
    setJornadaLoading(false);
  }
  async function handleReanudarJornada() {
    if (!user?.companyId) return;
    setJornadaLoading(true);
    try { await reanudarJornada(user.companyId, { uid: user.uid, name: user.name }); } catch { /* noop */ }
    setJornadaLoading(false);
  }
  async function handleFinalizarJornada() {
    if (!user?.companyId) return;
    if (!confirm("¿Finalizar la jornada? Los armadores no podrán tomar más membretes.")) return;
    setJornadaLoading(true);
    try { await finalizarJornada(user.companyId, { uid: user.uid, name: user.name }); } catch { /* noop */ }
    setJornadaLoading(false);
  }

  // Membretes completados HOY (fuente de verdad para productividad)
  const todayStr = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, "0")}-${String(clock.getDate()).padStart(2, "0")}`;
  const todayCompletedMembretes = useMemo(() => {
    return membretes.filter((m) => {
      if (m.status !== "completed" || !m.finishedAt) return false;
      const d = new Date(m.finishedAt);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return ds === todayStr;
    });
  }, [membretes, todayStr]);

  const statusOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "idle";
    return displayStatus(z);
  };
  const colorOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "var(--s-idle)";
    const arms = getArmadoresForZone(z);
    if (arms[0]?.color) return arms[0].color;
    const sc: Record<string, string> = { done: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)", incident: "var(--s-inc)", idle: "var(--s-idle)", paused: "var(--s-paused)" };
    return sc[displayStatus(z)] || "var(--s-idle)";
  };
  const ownerOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "";
    const arms = getArmadoresForZone(z);
    const cola = getColaForZone(z);
    const names = arms.map((a) => a.name).join(", ");
    if (names && cola.length > 0) return `${names} (+${cola.length} en cola)`;
    if (names) return names;
    if (cola.length > 0) return `${cola.length} en cola`;
    return "";
  };
  const activeOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return false;
    const st = displayStatus(z);
    return st === "active" || st === "incident";
  };

  const handlePositionChange = async (code: string, pos: { x: number; y: number }) => {
    setPositions((prev) => ({ ...prev, [code]: pos }));
    if (user?.companyId) {
      const zone = zones.find((z) => z.code === code);
      if (zone?.id) {
        try { await updateZone(zone.id, { position: pos }, { uid: user.uid, name: user.name }); } catch { /* noop */ }
      }
    }
  };

  const getPedidoForZone = (zone: Zone) => {
    const zm = membretes.filter((m) => m.zonaId === zone.id);
    const active = zm.find((m) => m.status === "active" || m.status === "pending");
    if (!active) return {};
    return { pallet: active.pallet, ruta: active.ruta, familia: active.familia, camion: active.camion, fechaEntrega: active.fechaEntrega };
  };

  const tooltipOf = (code: string) => {
    const zone = zones.find((z) => z.code === code);
    if (!zone) return null;
    const arms = getArmadoresForZone(zone);
    const cola = getColaForZone(zone);
    const pedido = getPedidoForZone(zone);
    const statusLabel: Record<string, string> = { done: "Completada", active: "En proceso", assigned: "Asignada", incident: "Incidencia", idle: "Sin asignar", paused: "Pausada" };
    return (
      <>
        {zone.name && <div className="zone-tooltip-row"><span className="k">Zona</span><span className="v">{zone.name}</span></div>}
        <div className="zone-tooltip-row"><span className="k">{arms.length > 1 ? "Trabajando" : "Encargado"}</span><span className="v">{arms.length > 0 ? arms.map((a) => a.name).join(", ") : "Sin asignar"}</span></div>
        <div className="zone-tooltip-row"><span className="k">Estado</span><span className="v">{statusLabel[displayStatus(zone)] || zone.status}</span></div>
        {cola.length > 0 && <div className="zone-tooltip-row"><span className="k">En cola</span><span className="v">{cola.length} membrete{cola.length === 1 ? "" : "s"}</span></div>}
        {pedido.pallet && <div className="zone-tooltip-row"><span className="k">Pallet</span><span className="v mono">{pedido.pallet}</span></div>}
        {pedido.ruta && <div className="zone-tooltip-row"><span className="k">Ruta</span><span className="v mono">{pedido.ruta}</span></div>}
        <div className="zone-tooltip-row"><span className="k">Productos</span><span className="v">{zone.totalProducts || zone.products?.length || 0}</span></div>
      </>
    );
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando pantalla en vivo...</div>;

  const done = zones.filter((z) => statusOf(z.code) === "done").length;
  const active = zones.filter((z) => statusOf(z.code) === "active").length;
  const pctDone = zones.length > 0 ? Math.round((done / zones.length) * 100) : 0;
  const zoneCodes = zones.map((z) => z.code).sort();

  /* ─── Hora real (24h) para un índice del turno, según la config real de la empresa ───
   * Antes esto asumía SIEMPRE turno nocturno 20:00→06:00 con una fórmula fija
   * (hourIdx<4 ? 20+hourIdx : hourIdx-4). Si la empresa tiene un turno distinto
   * configurado (mañana/tarde), esa fórmula buscaba datos en las horas equivocadas
   * y el gráfico salía vacío — este es el motivo más probable de "el gráfico no mide nada". */
  const shiftStartH = (() => {
    const n = Number(shiftConfig.inicio.split(":")[0]);
    return Number.isFinite(n) ? n : 20;
  })();
  const hour24For = (hourIdx: number) => (shiftStartH + hourIdx) % 24;

  /** Productos REALES (completados o con incidencia) de una zona, hoy, con su membrete dueño. */
  function zoneProductsToday(code: string): { p: MembreteProduct; m: Membrete }[] {
    return membretes
      .filter((m) => m.zonaCode === code)
      .flatMap((m) => (m.products || []).map((p) => ({ p, m })))
      .filter(({ p }) => {
        if (!p.completedAt) return false;
        const d = new Date(p.completedAt);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return ds === todayStr;
      });
  }

  /** Blend real: ritmo (tareas vs. meta) 55% + calidad (según incidencias reales, no estimadas) 45%. */
  function blendScore(tasksDone: number, incidents: number, expectedTasks: number): number {
    const total = tasksDone + incidents;
    const pace = Math.min(100, Math.round((tasksDone / Math.max(expectedTasks, 1)) * 100));
    const errorRate = total > 0 ? (incidents / total) * 100 : 0;
    const quality = Math.max(0, Math.round(100 - errorRate * 3));
    return Math.max(0, Math.min(100, Math.round(pace * 0.55 + quality * 0.45)));
  }

  /* ─── Hourly productivity: productos reales completados/con incidencia, por zona y hora ─── */
  const hourlyProductivity: Record<string, (number | null)[]> = {};
  zoneCodes.forEach((code) => {
    const productsToday = zoneProductsToday(code);
    const values: (number | null)[] = [];
    SHIFT_HOURS.forEach((_, hourIdx) => {
      const hour24 = hour24For(hourIdx);

      // 1) Productos reales completados/con incidencia en esta zona/hora (fuente primaria y honesta)
      const hourProducts = productsToday.filter(({ p }) => new Date(p.completedAt!).getHours() === hour24);
      const hourCompleted = hourProducts.filter(({ p }) => p.status === "completed").length;
      const hourIncidents = hourProducts.filter(({ p }) => p.status === "incident").length;

      // 2) Fallback legacy: ScanSessions, solo si esta zona/hora no tiene productos reales
      const hourSessions = hourProducts.length === 0
        ? sessions.filter((s) => {
            if (s.zoneCode !== code) return false;
            if (!s.endTime && !s.startTime) return false;
            const d = new Date(s.startTime);
            const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            if (ds !== todayStr) return false;
            return d.getHours() === hour24;
          })
        : [];

      if (hourProducts.length === 0 && hourSessions.length === 0) { values.push(null); return; }

      if (hourProducts.length > 0) {
        // Meta real por hora (Company.metaProdHora) — si no está configurada, usar 3/hora como referencia neutral.
        const expectedTasks = metaProdHora ?? 3;
        values.push(blendScore(hourCompleted, hourIncidents, expectedTasks));
      } else {
        // Legacy: sin productos individuales, se estima por duración de sesión (sin inventar errores)
        const avgDuration = hourSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / hourSessions.length;
        const targetDuration = 15 * 60;
        const efficiencyScore = Math.min(100, Math.round((targetDuration / Math.max(avgDuration, 1)) * 100));
        const completionRate = Math.min(1, hourSessions.length / 3);
        values.push(Math.min(100, Math.round(efficiencyScore * 0.6 + completionRate * 100 * 0.4)));
      }
    });
    hourlyProductivity[code] = values;
  });

  /* ─── Current hour index (realtime) ───
   * currentShiftIdx es -1 cuando AHORA cae fuera de la ventana del turno
   * configurado (p. ej. es la 1pm y el turno nocturno ya terminó a las 6am,
   * o todavía no empieza). Antes, todo el gráfico/detalle de zona usaba
   * currentShiftIdx para decidir qué horas mostrar — así que en cuanto
   * currentShiftIdx era -1, TODO se ocultaba aunque hubiera datos reales
   * ya capturados (por eso el gráfico se veía completamente vacío fuera
   * del horario del turno). displayUpToIdx corrige esto: mientras el turno
   * está en vivo, se comporta igual que currentShiftIdx; fuera del turno,
   * muestra el turno completo (los buckets sin datos reales ya salen como
   * null y no se dibujan, así que no hay riesgo de "inventar" horas). */
  const now = clock;
  const currentHour24 = now.getHours();
  const currentShiftIdx = currentHour24 >= 20 ? currentHour24 - 20 : currentHour24 < 6 ? currentHour24 + 4 : -1;
  const displayUpToIdx = currentShiftIdx >= 0 ? currentShiftIdx : SHIFT_HOURS.length - 1;

  /* ─── Zone averages (only completed hours) ─── */
  const zoneAverages: Record<string, number> = {};
  zoneCodes.forEach((code) => {
    const vals = (hourlyProductivity[code] || []).filter((v): v is number => v !== null);
    zoneAverages[code] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });

  const generalAvg = zoneCodes.length > 0
    ? Math.round(zoneCodes.map((c) => zoneAverages[c] || 0).reduce((a, b) => a + b, 0) / zoneCodes.length)
    : 0;
  const bestZone = zoneCodes.reduce((a, b) => (zoneAverages[a] || 0) > (zoneAverages[b] || 0) ? a : b, zoneCodes[0] || "Z01");
  const riskZone = zoneCodes.reduce((a, b) => (zoneAverages[a] || 100) < (zoneAverages[b] || 100) ? a : b, zoneCodes[0] || "Z01");
  const warningZones = zoneCodes.filter((c) => (zoneAverages[c] || 0) < 50 && (zoneAverages[c] || 0) > 0);

  /* ─── Cap de líneas en el gráfico ───
   * Con hasta 50 zonas reales, dibujar una línea por zona sería ilegible (y
   * la paleta categórica deja de distinguirse bien pasando de ~8 series).
   * El gráfico dibuja como máximo CHART_ZONE_CAP líneas: las de peor
   * desempeño primero (son las más urgentes de ver), más la zona
   * seleccionada aunque no esté entre las peores. El selector de zonas
   * (chips) sigue mostrando todas — esto solo limita qué se DIBUJA. */
  const CHART_ZONE_CAP = 6;
  const zonesWithData = zoneCodes.filter((c) => (hourlyProductivity[c] || []).some((v) => v !== null));
  const rankedZoneCodes = [...zonesWithData].sort((a, b) => (zoneAverages[a] || 0) - (zoneAverages[b] || 0));
  const chartZoneCodes = (() => {
    const base = rankedZoneCodes.slice(0, CHART_ZONE_CAP);
    if (selectedZone && zonesWithData.includes(selectedZone) && !base.includes(selectedZone)) {
      return [selectedZone, ...base.slice(0, CHART_ZONE_CAP - 1)];
    }
    return base;
  })();
  const hiddenZoneCount = Math.max(0, zonesWithData.length - chartZoneCodes.length);

  const rootStyle: React.CSSProperties = isFs
    ? { position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "auto" }
    : { display: "flex", flexDirection: "column", gap: 12, minHeight: 0 };

  /* ─── Trend helpers for KPIs ─── */
  const generalAvgPrev = (() => {
    const allVals = zoneCodes.flatMap((c) => {
      const vals = (hourlyProductivity[c] || []).filter((v): v is number => v !== null);
      return vals.length >= 2 ? [vals[vals.length - 2]] : [];
    });
    return allVals.length > 0 ? Math.round(allVals.reduce((a, b) => a + b, 0) / allVals.length) : null;
  })();
  const generalDelta = generalAvgPrev != null ? generalAvg - generalAvgPrev : null;

  const shiftLabel = shiftConfig.inicio === "20:00" ? "nocturno" : shiftConfig.inicio === "14:00" ? "tarde" : "mañana";
  const shiftTime = `${shiftConfig.inicio} → ${shiftConfig.fin}`;
  const turnHour = currentShiftIdx >= 0 ? SHIFT_HOURS[currentShiftIdx] : "—";
  const turnProgress = currentShiftIdx >= 0 ? `${currentShiftIdx} / ${SHIFT_HOURS.length - 1}` : "— / —";

  return (
    <div ref={rootRef} style={rootStyle}>
      {/* ─── HEADER (ejecutivo: estado en vivo + turno + reloj) ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: isFs ? "18px 24px" : "16px 20px", background: "var(--panel)", borderBottom: "1px solid var(--line)", flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 700,
            color: "#fff", background: "#3f9d6b", borderRadius: 999, padding: "6px 13px", flexShrink: 0,
            letterSpacing: "0.03em", boxShadow: "0 1px 4px rgba(63,157,107,0.35)",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", boxShadow: "0 0 0 0 rgba(255,255,255,0.7)", animation: "pulse 2.2s infinite" }} />
            EN VIVO
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.01em" }}>Turno {shiftLabel}</span>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>
              {shiftTime}
              {isFs && <> · <b style={{ color: "var(--dim)", fontWeight: 600 }}>{zones.length}</b> zonas · <b style={{ color: "var(--dim)", fontWeight: 600 }}>{armadores.length}</b> armadores</>}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "9px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", minWidth: 44 }}>
              <span style={{ fontSize: 9.5, color: "var(--faint)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Turno</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: currentShiftIdx >= 0 ? "var(--accent)" : "var(--faint)" }}>{turnHour}</span>
            </div>
            <div style={{ width: 1, height: 28, background: "var(--line)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", minWidth: 44 }}>
              <span style={{ fontSize: 9.5, color: "var(--faint)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Avance</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: currentShiftIdx >= 0 ? "var(--ink)" : "var(--faint)" }}>{turnProgress}</span>
            </div>
            <div style={{ width: 1, height: 28, background: "var(--line)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", minWidth: 52 }}>
              <span style={{ fontSize: 9.5, color: "var(--faint)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Reloj</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{clock.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
          <button onClick={toggleFs} title={isFs ? "Salir de pantalla completa" : "Pantalla completa"}
            style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--tx)", cursor: "pointer", fontSize: 15, width: 36, height: 36, display: "grid", placeItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}>
            {isFs ? "✕" : "⛶"}
          </button>
        </div>
      </div>

      {/* ─── KPIs ROW ─── */}
      <div style={{ display: "grid", gridTemplateColumns: isFs ? "repeat(5, 1fr)" : "repeat(4, 1fr)", gap: isFs ? 13 : 8, padding: isFs ? "0 24px" : "0 14px", flexShrink: 0 }}>
        {[
          {
            k: "Promedio",
            v: `${generalAvg}%`,
            delta: generalDelta,
            accent: getSatisfactionStatus(generalAvg).color,
          },
          {
            k: "Mejor",
            v: bestZone,
            accent: "#3f9d6b",
          },
          {
            k: "Riesgo",
            v: riskZone,
            accent: "#c85c54",
          },
          {
            k: "Completadas",
            v: String(done),
            accent: "var(--s-done, #3f9d6b)",
          },
          ...(isFs ? [{
            k: "Activas",
            v: String(active),
            accent: "var(--s-active, #F59E0B)",
          }] : []),
        ].map((kpi) => (
          <div key={kpi.k} style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: isFs ? 14 : 10,
            padding: isFs ? "14px 16px" : "8px 12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontSize: isFs ? 11 : 10, color: "var(--faint)", fontWeight: 600 }}>{kpi.k}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginLeft: "auto" }}>
              <span style={{ fontFamily: "var(--font)", fontSize: isFs ? 22 : 16, fontWeight: 700, lineHeight: 1, color: kpi.accent }}>{kpi.v}</span>
              {kpi.delta != null && kpi.delta !== 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: kpi.delta > 0 ? "#3f9d6b" : "#c85c54" }}>
                  {kpi.delta > 0 ? "▲" : "▼"}{Math.abs(kpi.delta)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ─── MAIN: MONITOR (+ MAP in fullscreen) ─── */}
      <div ref={mainGridRef} style={{
        flex: isFs ? "1 0 420px" : "none",
        display: "grid",
        gridTemplateColumns: isFs ? (mainNarrow ? "1fr" : `${mapPct}fr 14px ${100 - mapPct}fr`) : "1fr",
        gridAutoRows: isFs && mainNarrow ? "auto" : undefined,
        gap: isFs && mainNarrow ? 12 : 0,
        minHeight: isFs ? 420 : undefined,
        overflow: isFs ? (mainNarrow ? "auto" : "hidden") : "visible",
        padding: isFs ? "0 16px 12px" : "0 14px 14px",
      }}>

        {/* LEFT: Map (fullscreen only) */}
        {isFs && (
          <div style={{ display: "flex", flexDirection: "column", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", ...(mainNarrow ? { height: 320, flexShrink: 0 } : { minHeight: 0 }) }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <I.route style={{ fontSize: 14, color: "var(--accent)" }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>Mapa de la bodega</span>
              </div>
              <div style={{ display: "flex", gap: 10, fontSize: 9, flexWrap: "wrap" }}>
                {[{ c: "var(--s-idle)", l: "Sin asignar" }, { c: "var(--s-done)", l: "✓ Completada" }, { c: "var(--s-active)", l: "● En proceso" }, { c: "var(--s-paused)", l: "⏸ Pausada" }, { c: "var(--s-inc)", l: "✕ Incidencia" }].map((l) => (
                  <span key={l.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: l.c }} />
                    <span style={{ color: "var(--faint)" }}>{l.l}</span>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <MapFloor
                codes={zones.map((z) => z.code)}
                positions={positions}
                setPositions={setPositions}
                onPositionCommit={handlePositionChange}
                editable={false}
                colorOf={colorOf}
                ownerOf={ownerOf}
                activeOf={activeOf}
                statusOf={statusOf}
                priorityOf={(code) => zones.find((z) => z.code === code)?.prioridad}
                sizeOf={(code) => { const z = zones.find((zz) => zz.code === code); return z?.w && z?.h ? { w: z.w, h: z.h } : undefined; }}
                selected={selectedZone || undefined}
                onSelect={(code) => setSelectedZone(selectedZone === code ? null : code)}
                tooltipOf={tooltipOf}
              />
            </div>
          </div>
        )}

        {/* Divisor arrastrable: encoge un panel y agranda el otro */}
        {isFs && !mainNarrow && (
          <div
            className={`splitter-handle${draggingSplit === "main" ? " dragging" : ""}`}
            onMouseDown={startSplitDrag("main")}
            title="Arrastra para ajustar el ancho"
          />
        )}

        {/* RIGHT: Monitor */}
        <div style={{ display: "flex", flexDirection: "column", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, overflow: isFs ? "hidden" : "visible", minHeight: isFs ? 0 : undefined }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <I.chart style={{ fontSize: 14, color: "var(--accent)" }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Monitor de zonas</span>
            </div>
            <span style={{ fontSize: 10, color: "var(--faint)", background: "var(--panel2)", padding: "2px 8px", borderRadius: 999 }}>{zoneCodes.length} zonas</span>
          </div>
          <div ref={monitorScrollRef} style={{ flex: isFs ? 1 : "none", display: "flex", flexDirection: "column", padding: 10, gap: 10, overflow: isFs ? "auto" : "visible", minHeight: isFs ? 0 : undefined, maxHeight: isFs ? (monitorMaxH ?? undefined) : undefined }}>
            {/* Alerts banner */}
            {warningZones.length > 0 ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                background: "color-mix(in srgb, #c85c54 6%, var(--panel))", border: "1px solid color-mix(in srgb, #c85c54 25%, var(--line))",
                borderLeft: "4px solid #c85c54", borderRadius: 14, padding: "13px 16px",
                boxShadow: "0 2px 8px color-mix(in srgb, #c85c54 10%, transparent)", flexShrink: 0,
              }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#c85c54" strokeWidth={1.8}>
                  <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  <b style={{ color: "#c85c54" }}>{warningZones.length} zona{warningZones.length > 1 ? "s" : ""}</b> por vigilar
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
                  {warningZones.map((z) => (
                    <button key={z} onClick={() => setSelectedZone(z)} style={{
                      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                      color: "var(--ink)", background: "var(--panel)",
                      border: "1px solid color-mix(in srgb, #c85c54 30%, var(--line))", borderRadius: 999, padding: "5px 12px",
                      cursor: "pointer", fontFamily: "inherit", transition: "transform 0.15s, box-shadow 0.15s",
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorForZone(z) }} />
                      {z}
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                        color: "#c85c54", background: "color-mix(in srgb, #c85c54 12%, transparent)",
                      }}>vigilar</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              (() => {
                // Antes esto exigia que el turno estuviera EN VIVO (currentShiftIdx>=0) para
                // mostrar el banner de "todo va bien" — fuera del turno no mostraba nada.
                // Ahora se basa en si hay datos reales capturados hoy, sin importar la hora actual.
                const anyData = zoneCodes.some((c) => (hourlyProductivity[c] || []).some((v) => v !== null));
                return anyData ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    background: "color-mix(in srgb, #3f9d6b 5%, var(--panel))", border: "1px solid color-mix(in srgb, #3f9d6b 20%, var(--line))",
                    borderLeft: "4px solid #3f9d6b", borderRadius: 14, padding: "13px 16px",
                    boxShadow: "0 2px 8px color-mix(in srgb, #3f9d6b 8%, transparent)", flexShrink: 0,
                  }}>
                    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#3f9d6b" strokeWidth={1.8}>
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Todas las zonas van en buen ritmo por ahora.</span>
                  </div>
                ) : null;
              })()
            )}

            {/* ═══ PROFESSIONAL SVG CHART ═══ */}
            <div ref={chartRef} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 12, boxShadow: "var(--shadow, 0 1px 3px rgba(0,0,0,0.06))", flexShrink: 0 }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>Satisfacción por hora</div>
                <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4, lineHeight: 1.4 }}>Selecciona una zona para ver todo su detalle abajo. Pasa por las horas para recorrer el turno.</div>
              </div>
              {/* Selector de zonas — su propia fila arriba de la gráfica, con el MISMO
                 ancho que ella (antes competía por espacio junto al título y terminaba
                 empujado lejos, a la derecha, angosto). */}
              <div style={{ width: "100%", maxWidth: 760, margin: "0 auto 16px" }}>
                <div style={{ display: "flex", flexWrap: "nowrap", gap: 7, overflowX: "auto", overflowY: "hidden", paddingBottom: 2, scrollbarWidth: "thin" }}>
                  {/* Solo zonas con datos reales — mostrar las 50, casi todas con "—", solo ensucia el selector */}
                  {zonesWithData.map((z) => {
                    const vals = hourlyProductivity[z] || [];
                    let lastVal: number | null = null;
                    for (let i = vals.length - 1; i >= 0; i--) {
                      if (vals[i] !== null && i <= displayUpToIdx) { lastVal = vals[i]; break; }
                    }
                    const isSel = selectedZone === z;
                    const off = selectedZone && !isSel;
                    return (
                      <button key={z} onClick={() => setSelectedZone(isSel ? null : z)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                          border: `1px solid ${isSel ? (colorForZone(z)) : "var(--hair, var(--line))"}`,
                          background: isSel ? "var(--surface)" : "var(--soft, var(--panel2))",
                          color: isSel ? "var(--ink)" : "var(--dim)",
                          borderRadius: 999, padding: "5px 10px", fontSize: 11, fontWeight: 500,
                          fontFamily: "inherit", opacity: off ? 0.55 : 1,
                          boxShadow: isSel ? `0 0 0 3px color-mix(in srgb, ${colorForZone(z)} 16%, transparent)` : "none",
                          transition: "all 0.18s ease",
                        }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorForZone(z), flexShrink: 0 }} />
                        {z} <span style={{ fontWeight: 700, color: "var(--ink)" }}>{lastVal == null ? "—" : lastVal + "%"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* max-width: sin esto, el SVG (escala por viewBox) crece con el
                 ancho de la tarjeta y en la vista normal (sin dividir con el mapa)
                 queda desproporcionado — letras y trazos enormes comparados con el
                 resto de la pantalla. Con el tope se ve igual de proporcionado que en
                 la vista dividida, y sigue encogiendo normal en pantallas angostas.
                 margin "0 auto" (no solo "0"): centrada, para que quede exactamente
                 alineada bajo el selector de zonas de arriba, que usa el mismo ancho. */}
              <div style={{ position: "relative", width: "100%", maxWidth: 760, margin: "0 auto" }}>
                <ProductivityChart
                  hourlyData={hourlyProductivity}
                  zoneCodes={chartZoneCodes}
                  zoneAverages={zoneAverages}
                  selectedZone={selectedZone}
                  onSelectZone={setSelectedZone}
                  hoveredHour={hoveredHour}
                  onHoverHour={setHoveredHour}
                  currentShiftIdx={displayUpToIdx}
                  clock={clock}
                  shiftHours={SHIFT_HOURS}
                />
                {/* End-label pills (HTML overlay for crisp text) */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  {(() => {
                    const W = 640, H = 320;
                    const padL = { top: 20, right: 68, bottom: 34, left: 36 };
                    const pW = W - padL.left - padL.right;
                    const pH = H - padL.top - padL.bottom;
                    const xFor = (i: number) => padL.left + (i / (SHIFT_HOURS.length - 1)) * pW;
                    const yFor = (v: number) => padL.top + pH - (v / 100) * pH;
                    const labels: { z: string; c: string; x: number; ly: number; val: number }[] = [];
                    chartZoneCodes.forEach((z) => {
                      const vals = hourlyProductivity[z] || [];
                      let li: number | null = null;
                      for (let i = vals.length - 1; i >= 0; i--) {
                        if (vals[i] !== null && i <= displayUpToIdx) { li = i; break; }
                      }
                      if (li === null) return;
                      const val = vals[li]!;
                      labels.push({ z, c: colorForZone(z), x: xFor(li), ly: yFor(val), val });
                    });
                    labels.sort((a, b) => a.ly - b.ly);
                    const g = 30;
                    for (let i = 1; i < labels.length; i++) {
                      if (labels[i].ly - labels[i - 1].ly < g) labels[i].ly = labels[i - 1].ly + g;
                    }
                    const bMax = H - padL.bottom - 8;
                    if (labels.length && labels[labels.length - 1].ly > bMax) {
                      labels[labels.length - 1].ly = bMax;
                      for (let i = labels.length - 2; i >= 0; i--) {
                        if (labels[i].ly > labels[i + 1].ly - g) labels[i].ly = labels[i + 1].ly - g;
                      }
                    }
                    const tMin = padL.top + 8;
                    if (labels.length && labels[0].ly < tMin) {
                      labels[0].ly = tMin;
                      for (let i = 1; i < labels.length; i++) {
                        if (labels[i].ly < labels[i - 1].ly + g) labels[i].ly = labels[i - 1].ly + g;
                      }
                    }
                    // Ancla las pills justo después del último dato real (no en el borde
                    // derecho fijo) — evita la línea diagonal "fantasma" hacia horas sin datos.
                    const lastX = labels.length ? Math.max(...labels.map((l) => l.x)) : padL.left;
                    const anchorX = Math.min(lastX + 26, W - 6);
                    return labels.map((l) => (
                      <button key={l.z} onClick={() => setSelectedZone(selectedZone === l.z ? null : l.z)}
                        style={{
                          position: "absolute", left: `${(anchorX / W) * 100}%`,
                          top: `${(l.ly / H) * 100}%`, transform: "translateY(-50%)",
                          pointerEvents: "auto", cursor: "pointer",
                          display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: 12, fontWeight: 0,
                          color: "#fff", background: l.c, border: "2.5px solid #fff",
                          borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap",
                          boxShadow: "0 2px 7px rgba(64,58,40,0.20)",
                          transition: "transform 0.12s, box-shadow 0.12s",
                        }}>
                        <b>{l.z}</b><span style={{ opacity: 0.95 }}>{l.val}%</span>
                      </button>
                    ));
                  })()}
                </div>
                {/* Floating tooltip */}
                {hoveredHour !== null && hoveredHour <= displayUpToIdx && (() => {
                  const vals = zoneCodes.map((z) => ({ z, v: hourlyProductivity[z]?.[hoveredHour] })).filter((e): e is { z: string; v: number } => e.v !== null);
                  if (vals.length === 0) return null;
                  return (
                    // Fondo/texto en valores fijos (no en variables de tema): este tooltip flota
                    // sobre el gráfico y necesita contraste garantizado en cualquier tema/modo,
                    // así que cada texto trae su color explícito en vez de heredarlo.
                    <div style={{
                      position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)",
                      background: "#1f2430", color: "#ffffff", borderRadius: 12,
                      padding: "9px 14px", fontSize: 12, pointerEvents: "none", zIndex: 20,
                      boxShadow: "0 14px 30px -12px rgba(0,0,0,0.45)", whiteSpace: "nowrap",
                      maxWidth: 220, overflow: "hidden",
                    }}>
                      <div style={{ color: "#B8BFCC", fontSize: 11, marginBottom: 3 }}>{SHIFT_HOURS[hoveredHour]}</div>
                      {vals.sort((a, b) => b.v - a.v).map((e) => (
                        <div key={e.z} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorForZone(e.z), flexShrink: 0 }} />
                          <span style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 12, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis" }}>{e.z}</span>
                          <span style={{ fontWeight: 700, fontSize: 13, marginLeft: "auto", color: "#ffffff", flexShrink: 0 }}>{e.v}%</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 18px", marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--dim)" }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "#3f9d6b", display: "inline-block" }} />Óptimo 85+</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--dim)" }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "#3e9ab0", display: "inline-block" }} />Bien 70–84</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--dim)" }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "#c98a2e", display: "inline-block" }} />Atención 55–69</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--dim)" }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "#c85c54", display: "inline-block" }} />Crítico &lt;55</span>
                <span style={{ fontSize: 12, color: "var(--faint)", marginLeft: "auto" }}>
                  El círculo con el código al final de cada línea identifica la zona · clic para ver detalle
                  {hiddenZoneCount > 0 && ` · mostrando las ${chartZoneCodes.length} zonas con peor ritmo (+${hiddenZoneCount} más — selecciónalas en los chips de arriba)`}
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Zona seleccionada — tarjeta a todo lo ancho, inline debajo de Mapa/Monitor
          (mismo estilo de panel que ellos: var(--panel) + borde + radio 14 — ya no
          es un overlay aparte, sino parte normal del flujo de la pantalla). */}
      {selectedZone && (() => {
              const z = zones.find((zz) => zz.code === selectedZone);
              if (!z) return null;
              const avg = zoneAverages[selectedZone] || 0;
              const st = getSatisfactionStatus(avg);
              const zoneMembretesCompleted = todayCompletedMembretes.filter((m) => m.zonaCode === selectedZone);
              const zoneSessions = sessions.filter((s) => s.zoneCode === selectedZone && s.endTime);
              const zoneProdToday = zoneProductsToday(selectedZone);
              const zoneCompletedProd = zoneProdToday.filter(({ p }) => p.status === "completed");
              const zoneIncidentProd = zoneProdToday.filter(({ p }) => p.status === "incident");
              const membreteArmadorIds = Array.from(new Set(zoneMembretesCompleted.filter((m) => m.armadorId).map((m) => m.armadorId as string)));
              const productArmadorIds = Array.from(new Set(zoneProdToday.filter(({ m }) => m.armadorId).map(({ m }) => m.armadorId as string)));
              const sessionArmadorIds = Array.from(new Set(zoneSessions.map((s) => s.armadorId)));
              const armadorIds = Array.from(new Set([...productArmadorIds, ...membreteArmadorIds, ...sessionArmadorIds]));
              const vals = hourlyProductivity[selectedZone] || [];
              const completedVals = vals.filter((v): v is number => v !== null);
              const prevVal = completedVals.length >= 2 ? completedVals[completedVals.length - 2] : avg;
              const lastVal = completedVals.length >= 1 ? completedVals[completedVals.length - 1] : avg;
              const delta = lastVal - prevVal;
              const hasProductData = zoneCompletedProd.length + zoneIncidentProd.length > 0;
              const totalTasks = hasProductData ? zoneCompletedProd.length + zoneIncidentProd.length : Math.max(zoneMembretesCompleted.length, zoneSessions.length);
              const totalErrors = hasProductData ? zoneIncidentProd.length : 0;
              const errRate = totalTasks > 0 ? ((totalErrors / totalTasks) * 100).toFixed(1) : "0";
              const zColor = colorForZone(selectedZone);
              const colaActual = getColaForZone(z).length;
              const armadoresActuales = getArmadoresForZone(z).length;
              const viewingHour = hoveredHour ?? displayUpToIdx;

              return (
                <div style={{ padding: isFs ? "0 16px 12px" : "0 14px 14px", flexShrink: 0 }}>
                <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
                  {/* Header — misma barra de cabecera que "Mapa de la bodega" / "Monitor de zonas" */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "10px 14px", background: "var(--panel2)", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: zColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, color: "var(--faint)", fontWeight: 600 }}>Detalle de zona</span>
                      <span style={{ fontFamily: "var(--font)", fontSize: 15, fontWeight: 700 }}>{selectedZone}</span>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
                        color: st.color, background: `color-mix(in srgb, ${st.color} 13%, transparent)`, padding: "4px 10px", borderRadius: 999,
                      }}>{st.label}</span>
                    </div>
                    <button onClick={() => setSelectedZone(null)} title="Cerrar detalle de zona (Esc)"
                      style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--tx)", cursor: "pointer", fontSize: 14, width: 30, height: 30, display: "grid", placeItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", flexShrink: 0, transition: "background 0.15s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}>
                      ✕
                    </button>
                  </div>
                  <div ref={zoneGridRef} style={{ display: "grid", gridTemplateColumns: zoneNarrow ? "1fr" : `${zoneLeftW}px 14px 1fr`, minHeight: 0 }}>
                    {/* LEFT: Zone identity + score + sparkline + stats */}
                    <div style={{ padding: zoneNarrow ? "18px 20px" : 24, borderBottom: zoneNarrow ? "1px solid var(--line)" : undefined }}>
                      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 8 }}>Zona seleccionada</div>
                      <div style={{ fontFamily: "var(--font)", fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 11 }}>
                        <span style={{ width: 14, height: 14, borderRadius: "50%", background: zColor, flexShrink: 0 }} />
                        {selectedZone}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12, margin: "16px 0 4px" }}>
                        <span style={{ fontFamily: "var(--font)", fontSize: zoneNarrow ? 38 : 56, fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.02em", color: zColor }}>
                          {avg}<span style={{ fontSize: zoneNarrow ? 16 : 22, color: "var(--faint)", fontWeight: 500 }}>%</span>
                        </span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
                            color: st.color, background: `color-mix(in srgb, ${st.color} 13%, transparent)`, padding: "5px 11px", borderRadius: 999,
                          }}>{st.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: delta > 0 ? "#3f9d6b" : delta < 0 ? "#c85c54" : "var(--faint)" }}>
                            {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} pts vs. hora previa` : "estable"}
                          </span>
                        </div>
                      </div>
                      {/* Sparkline */}
                      <div style={{ margin: "18px 0 16px" }}>
                        <ZoneSparkline zoneCode={selectedZone} hourlyData={hourlyProductivity} currentShiftIdx={displayUpToIdx} color={zColor} hoveredHour={hoveredHour} shiftHours={SHIFT_HOURS} />
                      </div>
                      {/* 3 stats — mockup style */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {[
                          { k: "Tareas turno", v: String(totalTasks) },
                          { k: "Errores", v: `${totalErrors}`, sub: `(${errRate}%)` },
                          { k: "Prom. turno", v: `${avg}`, sub: "%" },
                        ].map((s) => (
                          <div key={s.k} style={{ background: "var(--soft, var(--panel2))", border: "1px solid var(--line)", borderRadius: 11, padding: "11px 12px" }}>
                            <div style={{ fontSize: 11, color: "var(--faint)" }}>{s.k}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 3 }}>{s.v}{s.sub && <small style={{ fontSize: 11, color: "var(--faint)", fontWeight: 500 }}>{s.sub}</small>}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Divisor arrastrable: encoge un lado y agranda el otro (oculto si está apilado) */}
                    {!zoneNarrow && (
                      <div
                        className={`splitter-handle${draggingSplit === "zone" ? " dragging" : ""}`}
                        onMouseDown={startSplitDrag("zone")}
                        title="Arrastra para ajustar el ancho"
                      />
                    )}

                    {/* RIGHT: Armadores + hour strip */}
                    <div style={{ padding: zoneNarrow ? "16px 20px" : "22px 24px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                        <span style={{ fontFamily: "var(--font)", fontSize: 15, fontWeight: 700 }}>Armadores</span>
                        <span style={{ fontSize: 12, color: "var(--dim)" }}>mostrando <b style={{ color: zColor }}>{SHIFT_HOURS[viewingHour] || "—"}</b>{hoveredHour != null ? " · recorriendo" : " · última hora"}</span>
                      </div>
                      {armadorIds.length === 0 ? (
                        <div style={{ fontSize: 13, color: "var(--faint)", textAlign: "center", padding: 30 }}>
                          Sin datos de armadores para esta zona
                        </div>
                      ) : (
                        armadorIds.slice(0, 4).map((armId) => {
                          const arm = armadores.find((a) => a.id === armId);
                          const armSessions = zoneSessions.filter((s) => s.armadorId === armId);
                          // Productos reales de este armador en esta zona, hoy (fuente primaria)
                          const armCompleted = zoneCompletedProd.filter(({ m }) => m.armadorId === armId).length;
                          const armIncidents = zoneIncidentProd.filter(({ m }) => m.armadorId === armId).length;
                          let armSat: number, armTasks: number, armErr: number;
                          if (armCompleted + armIncidents > 0) {
                            const hoursElapsed = Math.max(1, displayUpToIdx + 1);
                            const expectedTasks = (metaProdHora ?? 3) * hoursElapsed;
                            armSat = blendScore(armCompleted, armIncidents, expectedTasks);
                            armTasks = armCompleted + armIncidents;
                            armErr = armIncidents;
                          } else {
                            // Legacy: sin productos individuales — se estima por duración, sin inventar errores
                            const armAvgTime = armSessions.length > 0
                              ? armSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / armSessions.length / 60
                              : 0;
                            armSat = armAvgTime > 0 ? Math.min(100, Math.round((15 / Math.max(armAvgTime, 1)) * 100)) : 0;
                            armTasks = armSessions.length;
                            armErr = 0;
                          }
                          const armSt = getSatisfactionStatus(armSat);
                          const hot = armTasks > 0 && armErr / Math.max(armTasks, 1) >= 0.15;

                          return (
                            <div key={armId} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 16px", alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                                  <span style={{ fontSize: 14, fontWeight: 600 }}>{arm?.name || "—"}</span>
                                </div>
                                <div style={{ height: 8, background: "var(--paper-2, var(--line))", borderRadius: 999, overflow: "hidden" }}>
                                  <div style={{ width: `${armSat}%`, height: "100%", borderRadius: 999, background: armSt.color, transition: "width 0.4s" }} />
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 16, alignItems: "center", textAlign: "right" }}>
                                <div>
                                  <div style={{ fontSize: 19, fontWeight: 700, color: armSt.color }}>{armSat}%</div>
                                  <div style={{ fontSize: 10, color: "var(--faint)" }}>satisf.</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 16, fontWeight: 700 }}>{armTasks}</div>
                                  <div style={{ fontSize: 10, color: "var(--faint)" }}>tareas</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 16, fontWeight: 700, color: hot ? "#c85c54" : "var(--ink)" }}>{armErr}</div>
                                  <div style={{ fontSize: 10, color: "var(--faint)" }}>errores</div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                      {/* Hour strip — mockup style. minmax(34px,1fr) + scroll horizontal:
                         si el espacio real no alcanza para que las 11 horas se vean
                         legibles, esta franja se desplaza en vez de apretarlas hasta
                         que el texto se encime o desaparezca. */}
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 11, color: "var(--faint)", marginBottom: 8, fontWeight: 600 }}>Satisfacción de la zona hora a hora — toca para ver ese momento</div>
                        <div style={{ overflowX: "auto", paddingBottom: 2, scrollbarWidth: "thin" }}>
                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${SHIFT_HOURS.length}, minmax(34px, 1fr))`, gap: 6 }}>
                          {SHIFT_HOURS.map((label, i) => {
                            const v = hourlyProductivity[selectedZone]?.[i] ?? null;
                            const isEmpty = v === null || i > displayUpToIdx;
                            const isCurrent = i === (hoveredHour ?? displayUpToIdx);
                            const cellColor = !isEmpty ? getSatisfactionStatus(v!).color : undefined;
                            return (
                              <div key={i} onClick={() => { if (!isEmpty) setHoveredHour(hoveredHour === i ? null : i); }}
                                style={{
                                  textAlign: "center", borderRadius: 9, padding: "8px 2px", cursor: isEmpty ? "default" : "pointer",
                                  border: isCurrent ? `2px solid ${zColor}` : "1px solid var(--line)",
                                  background: isEmpty ? "var(--soft, var(--panel2))" : `color-mix(in srgb, ${cellColor || "var(--faint)"} 12%, var(--surface))`,
                                  borderColor: isEmpty ? undefined : "transparent",
                                  transition: "transform 0.1s, box-shadow 0.15s",
                                }}
                                onMouseEnter={(e) => { if (!isEmpty) e.currentTarget.style.transform = "translateY(-2px)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}>
                                <div style={{ fontSize: 10, color: "var(--faint)" }}>{label}</div>
                                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: isEmpty ? "var(--faint)" : cellColor }}>
                                  {isEmpty ? "—" : v}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ANALYSIS SECTION */}
                  <ZoneAnalysis zoneCode={selectedZone} zoneColor={zColor} hourlyData={hourlyProductivity} currentShiftIdx={displayUpToIdx} sessions={sessions} armadores={armadores} membretes={membretes} narrow={zoneNarrow} />
                </div>
                </div>
              );
            })()}

    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SMOOTH PATH — bezier curves matching the HTML prototype
   ═══════════════════════════════════════════════════════════════════════════════ */

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x} ${pts[0].y}` : "";
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  const t = 0.18;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PRODUCTIVITY CHART — Professional SVG with bands, bezier curves, hover, pills
   ═══════════════════════════════════════════════════════════════════════════════ */

function ProductivityChart({
  hourlyData, zoneCodes, zoneAverages: _zoneAverages, selectedZone, onSelectZone,
  hoveredHour, onHoverHour, currentShiftIdx, clock: _clock, shiftHours,
}: {
  hourlyData: Record<string, (number | null)[]>;
  zoneCodes: string[];
  zoneAverages: Record<string, number>;
  selectedZone: string | null;
  onSelectZone: (code: string | null) => void;
  hoveredHour: number | null;
  onHoverHour: (idx: number | null) => void;
  currentShiftIdx: number;
  clock: Date;
  shiftHours: string[];
}) {
  const W = 640;
  const H = 320;
  const pad = { top: 20, right: 68, bottom: 34, left: 36 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const bands = [
    { min: 85, max: 100, color: "rgba(63,157,107,0.10)" },
    { min: 70, max: 85, color: "rgba(62,154,176,0.08)" },
    { min: 55, max: 70, color: "rgba(201,138,46,0.10)" },
    { min: 0, max: 55, color: "rgba(200,92,84,0.08)" },
  ];

  const getX = (i: number) => pad.left + (i / (shiftHours.length - 1)) * plotW;
  const getY = (v: number) => pad.top + plotH - (v / 100) * plotH;

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    const hourIdx = Math.round(((mouseX - pad.left) / plotW) * (shiftHours.length - 1));
    onHoverHour(hourIdx >= 0 && hourIdx < shiftHours.length ? hourIdx : null);
  }, [plotW, onHoverHour, shiftHours.length]);

  /* ─── Compute end labels with collision avoidance ─── */
  const endLabels: { code: string; color: string; x: number; y: number; ly: number; val: number | null }[] = [];
  zoneCodes.forEach((z) => {
    const vals = hourlyData[z] || [];
    let lastIdx: number | null = null;
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i] !== null && i <= currentShiftIdx) { lastIdx = i; break; }
    }
    if (lastIdx === null) return;
    const val = vals[lastIdx];
    if (val === null) return;
    const x = getX(lastIdx);
    const y = getY(val);
    endLabels.push({ code: z, color: colorForZone(z), x, y, ly: y, val });
  });
  endLabels.sort((a, b) => a.y - b.y);
  const gap = 28;
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].ly - endLabels[i - 1].ly < gap) endLabels[i].ly = endLabels[i - 1].ly + gap;
  }
  const botLim = H - pad.bottom - 10;
  if (endLabels.length && endLabels[endLabels.length - 1].ly > botLim) {
    endLabels[endLabels.length - 1].ly = botLim;
    for (let i = endLabels.length - 2; i >= 0; i--) {
      if (endLabels[i].ly > endLabels[i + 1].ly - gap) endLabels[i].ly = endLabels[i + 1].ly - gap;
    }
  }
  const topLim = pad.top + 10;
  if (endLabels.length && endLabels[0].ly < topLim) {
    endLabels[0].ly = topLim;
    for (let i = 1; i < endLabels.length; i++) {
      if (endLabels[i].ly < endLabels[i - 1].ly + gap) endLabels[i].ly = endLabels[i - 1].ly + gap;
    }
  }

  /* ─── Ancla de las etiquetas de fin de línea ───
   * Antes el conector siempre llegaba hasta el borde derecho del gráfico
   * (x = W-8), aunque los datos reales solo llegaran hasta la mitad —
   * eso dibujaba una línea diagonal "fantasma" sugiriendo datos que no
   * existen. Ahora la etiqueta se ancla justo después del último punto
   * real, para que solo se vea lo que realmente ha avanzado el turno. */
  const lastDataX = endLabels.length ? Math.max(...endLabels.map((e) => e.x)) : pad.left;
  const labelAnchorX = Math.min(lastDataX + 26, W - 6);

  /* ─── Area fill for selected zone ─── */
  const selColor = selectedZone ? colorForZone(selectedZone) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", cursor: "crosshair" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHoverHour(null)}>

      <defs>
        {selectedZone && selColor && (
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={selColor} stopOpacity={0.18} />
            <stop offset="100%" stopColor={selColor} stopOpacity={0} />
          </linearGradient>
        )}
      </defs>

      {/* Color-coded bands */}
      {bands.map((band, i) => {
        const y1 = getY(band.max);
        const y2 = getY(band.min);
        return <rect key={i} x={pad.left} y={y1} width={plotW} height={y2 - y1} fill={band.color} />;
      })}

      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map((v) => {
        const y = getY(v);
        return (
          <g key={v}>
            <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="var(--line)" strokeWidth={1} opacity={0.6} />
            <text x={pad.left - 8} y={y + 4} textAnchor="end" fill="var(--faint)" fontSize={12} fontFamily="var(--font)">{v}</text>
          </g>
        );
      })}

      {/* Hour labels */}
      {shiftHours.map((label: string, i: number) => {
        const x = getX(i);
        return (
          <text key={i} x={x} y={H - 10} textAnchor="middle" fill={i <= currentShiftIdx ? "var(--ink)" : "var(--faint)"}
            fontSize={12} fontWeight={i === currentShiftIdx ? 700 : 400} fontFamily="var(--font)">
            {label}
          </text>
        );
      })}

      {/* Hover guide line */}
      {hoveredHour !== null && (
        <line x1={getX(hoveredHour)} y1={pad.top} x2={getX(hoveredHour)} y2={H - pad.bottom}
          stroke="var(--line)" strokeWidth={1.5} opacity={0.6} />
      )}

      {/* Area under selected zone */}
      {selectedZone && (() => {
        const vals = hourlyData[selectedZone] || [];
        const pts: { x: number; y: number }[] = [];
        vals.forEach((v, i) => {
          if (v !== null && i <= currentShiftIdx) pts.push({ x: getX(i), y: getY(v) });
        });
        if (pts.length < 2) return null;
        const line = smoothPath(pts);
        const area = line + ` L${pts[pts.length - 1].x.toFixed(1)} ${getY(0)} L${pts[0].x.toFixed(1)} ${getY(0)} Z`;
        return <path d={area} fill="url(#areaGrad)" />;
      })()}

      {/* Zone lines + hit areas */}
      {zoneCodes.map((z) => {
        const vals = hourlyData[z] || [];
        const color = colorForZone(z);
        const isSel = selectedZone === z;
        const dim = selectedZone && !isSel;

        const pts: { x: number; y: number; idx: number; val: number }[] = [];
        vals.forEach((v, i) => {
          if (v !== null && i <= currentShiftIdx) pts.push({ x: getX(i), y: getY(v), idx: i, val: v });
        });
        if (pts.length === 0) return null;

        const pathD = smoothPath(pts);

        return (
          <g key={z} opacity={dim ? 0.5 : 1} style={{ transition: "opacity 0.18s" }}>
            {/* Invisible wide hit area */}
            <path d={pathD} fill="none" stroke="transparent" strokeWidth={18} style={{ cursor: "pointer" }}
              onClick={() => onSelectZone(isSel ? null : z)} />
            {/* Visible line */}
            <path d={pathD} fill="none" stroke={color} strokeWidth={isSel ? 3.4 : 2.4}
              strokeLinecap="round" strokeLinejoin="round"
              onClick={() => onSelectZone(isSel ? null : z)} style={{ cursor: "pointer" }} />
            {/* Dots at each hour (only for selected zone) */}
            {isSel && pts.map((p) => {
              const isHov = hoveredHour === p.idx;
              return (
                <circle key={p.idx} cx={p.x} cy={p.y} r={isHov ? 6 : 3} fill={isHov ? color : "#fff"}
                  stroke={color} strokeWidth={isHov ? 2.5 : 2} style={{ cursor: "pointer", transition: "r 0.12s" }}
                  onClick={() => onSelectZone(z)} />
              );
            })}
            {/* Active dot for hovered hour on selected zone */}
            {isSel && hoveredHour !== null && hoveredHour <= currentShiftIdx && (() => {
              const v = vals[hoveredHour];
              if (v === null) return null;
              return <circle cx={getX(hoveredHour)} cy={getY(v)} r={6} fill={color} stroke="#fff" strokeWidth={2.5} style={{ pointerEvents: "none" }} />;
            })()}
          </g>
        );
      })}

      {/* End-label connectors + dots — cortos, solo hasta donde llega el dato real */}
      {endLabels.map((e) => (
        <g key={e.code}>
          {Math.abs(labelAnchorX - e.x) > 2 && (
            <line x1={e.x.toFixed(1)} y1={e.y.toFixed(1)} x2={labelAnchorX.toFixed(1)} y2={e.ly.toFixed(1)}
              stroke={e.color} strokeWidth={1.1} strokeDasharray="1 3" opacity={0.35} />
          )}
          <circle cx={e.x.toFixed(1)} cy={e.y.toFixed(1)} r={3.4} fill={e.color} stroke="#fff" strokeWidth={1.5} />
        </g>
      ))}

      {/* Hour hit zones */}
      {shiftHours.map((_: string, i: number) => {
        const hitW = plotW / (shiftHours.length - 1);
        return <rect key={i} x={getX(i) - hitW / 2} y={pad.top} width={hitW} height={plotH} fill="transparent" style={{ cursor: "crosshair" }} />;
      })}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ZONE SPARKLINE — mini area chart for the detail panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function ZoneSparkline({ zoneCode, hourlyData, currentShiftIdx, color, hoveredHour, shiftHours }: {
  zoneCode: string; hourlyData: Record<string, (number | null)[]>; currentShiftIdx: number; color: string; hoveredHour: number | null; shiftHours: string[];
}) {
  const vals = hourlyData[zoneCode] || [];
  const W = 300, H = 64, pad = 6;
  const xs = (i: number) => pad + (i / (shiftHours.length - 1)) * (W - 2 * pad);
  const ys = (v: number) => pad + (1 - v / 100) * (H - 2 * pad);

  const pts: { x: number; y: number }[] = [];
  vals.forEach((v, i) => { if (v !== null && i <= currentShiftIdx) pts.push({ x: xs(i), y: ys(v) }); });

  if (pts.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 64, display: "block" }}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--line)" strokeDasharray="3 4" />
      </svg>
    );
  }

  const line = smoothPath(pts);
  const area = line + ` L${pts[pts.length - 1].x.toFixed(1)} ${H} L${pts[0].x.toFixed(1)} ${H} Z`;

  let marker = null;
  if (hoveredHour !== null && hoveredHour <= currentShiftIdx) {
    const v = vals[hoveredHour];
    if (v !== null) {
      marker = <circle cx={xs(hoveredHour).toFixed(1)} cy={ys(v).toFixed(1)} r={4} fill={color} stroke="#fff" strokeWidth={2} />;
    }
  }

  return (
    // preserveAspectRatio="none": sin esto, cuando el contenedor real es más
    // angosto que los 300 del viewBox, el SVG "letterboxea" (lo encoge
    // entero para que quepa, dejando franjas vacías arriba/abajo) y la
    // curva se ve como un borrón chiquito flotando en el medio en vez de
    // ocupar todo el ancho — con "none" siempre llena su espacio real.
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 64, display: "block" }}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} />
      {marker}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ZONE ANALYSIS — diagnoses zone health and recommends actions
   ═══════════════════════════════════════════════════════════════════════════════ */

function ZoneAnalysis({ zoneCode, zoneColor, hourlyData, currentShiftIdx, sessions, armadores: _armadores, membretes: _membretes, narrow }: {
  zoneCode: string; zoneColor: string; hourlyData: Record<string, (number | null)[]>; currentShiftIdx: number;
  sessions: ScanSession[]; armadores: Armador[]; membretes: Membrete[];
  /** true cuando el panel padre ("Zona seleccionada") está apilado por falta de espacio —
   *  aquí se usa para apilar también "Qué está pasando" / "Qué puedes hacer" en una sola
   *  columna en vez de encimarlas en dos columnas angostas. */
  narrow?: boolean;
}) {
  const vals = hourlyData[zoneCode] || [];
  const completed = vals.map((v, i) => ({ v, i })).filter((e) => e.v !== null && e.i <= currentShiftIdx);
  if (completed.length === 0) return null;

  const last = completed[completed.length - 1];
  const prev = completed.length >= 2 ? completed[completed.length - 2] : null;
  const sat = last.v!;
  const delta = prev ? sat - prev.v! : null;

  // Membretes completados en esta zona (fuente primaria legacy) + productos reales (fuente primaria honesta)
  const todayStr = new Date().toISOString().slice(0, 10);
  const zoneMembretesCompleted = _membretes.filter((m) => {
    if (m.status !== "completed" || m.zonaCode !== zoneCode || !m.finishedAt) return false;
    const d = new Date(m.finishedAt);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return ds === todayStr;
  });
  const zoneSessions = sessions.filter((s) => s.zoneCode === zoneCode && s.endTime);
  const zoneProdToday = _membretes
    .filter((m) => m.zonaCode === zoneCode)
    .flatMap((m) => m.products || [])
    .filter((p) => {
      if (!p.completedAt) return false;
      const d = new Date(p.completedAt);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return ds === todayStr;
    });
  const zoneCompletedProd = zoneProdToday.filter((p) => p.status === "completed").length;
  const zoneIncidentProd = zoneProdToday.filter((p) => p.status === "incident").length;
  const hasProductData = zoneCompletedProd + zoneIncidentProd > 0;
  const totalTasks = hasProductData ? zoneCompletedProd + zoneIncidentProd : Math.max(zoneMembretesCompleted.length, zoneSessions.length);
  const totalErrors = hasProductData ? zoneIncidentProd : 0;
  const errRate = totalTasks > 0 ? (totalErrors / totalTasks) * 100 : 0;

  const declining = completed.length >= 3 && sat < completed[completed.length - 2].v! && completed[completed.length - 2].v! <= completed[completed.length - 3].v!;
  const lateHour = last.i >= 6;

  const findings: { k: string; t: string }[] = [];
  const recs: { level: string; text: string; tag: string }[] = [];

  if (sat < 55) {
    findings.push({ k: "bad", t: `Estado crítico: ${sat}% de satisfacción.` });
    recs.push({ level: "risk", text: `Intervención ahora: envía apoyo y redistribuye las tareas pendientes entre los armadores con mejor ritmo.`, tag: "Urgente" });
  } else if (sat < 70) {
    findings.push({ k: "warn", t: `En atención: ${sat}%, por debajo del objetivo.` });
    recs.push({ level: "watch", text: `Refuerza esta hora antes de que siga bajando: aclara prioridades y quita bloqueos.`, tag: "Prioridad" });
  }

  if (delta != null && delta <= -4) {
    findings.push({ k: "down", t: `Cayó ${Math.abs(delta)} pts vs. la hora anterior.` });
  }

  if (declining) {
    findings.push({ k: "down", t: `Tendencia a la baja sostenida en las últimas horas.` });
    if (lateHour) recs.push({ level: "watch", text: `Es madrugada y el rendimiento suele caer por fatiga: pausa o rotación.`, tag: "Fatiga" });
    else recs.push({ level: "watch", text: `Frena la caída: check-in rápido con el equipo para detectar qué cambió.`, tag: "Tendencia" });
  }

  if (errRate >= 12) {
    findings.push({ k: "bad", t: `Tasa de errores alta: ${errRate.toFixed(0)}% (${totalErrors} en ${totalTasks} tareas).` });
    recs.push({ level: errRate >= 18 ? "risk" : "watch", text: `Prioriza precisión: revisa etiquetado, ubicaciones y procedimiento.`, tag: "Calidad" });
  }

  if (sat >= 85) {
    findings.push({ k: "good", t: `Va excelente: ${sat}%. Mantener el ritmo.` });
    recs.push({ level: "ok", text: `Mantén el ritmo. Anota qué está funcionando para replicarlo.`, tag: "Replicar" });
  } else if (sat >= 70) {
    findings.push({ k: "info", t: `Cumple objetivo: ${sat}%. Sin acción urgente.` });
    recs.push({ level: "ok", text: `Ritmo estable. Vigila que no baje en la madrugada.`, tag: "Sostener" });
  }

  const severity = sat < 55 ? "risk" : sat < 70 ? "watch" : "ok";
  const sevLabel = severity === "risk" ? "Requiere acción" : severity === "watch" ? "Vigilar" : "En buen ritmo";
  const sevColor = severity === "risk" ? "#c85c54" : severity === "watch" ? "#c98a2e" : "#3f9d6b";

  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "20px 24px 22px", background: "var(--panel2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={zoneColor} strokeWidth={1.7}>
          <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4" />
        </svg>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Análisis y recomendaciones</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: sevColor, background: `color-mix(in srgb, ${sevColor} 12%, transparent)` }}>{sevLabel}</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--dim)", margin: "2px 0 14px" }}>
        {zoneCode} está en {sat}%{delta != null && delta !== 0 ? ` · ${delta > 0 ? "+" : ""}${delta} pts vs. hora previa` : ""}.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1.25fr", gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginBottom: 8, fontWeight: 600 }}>Qué está pasando</div>
          {findings.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, padding: "4px 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flexShrink: 0, background: f.k === "bad" || f.k === "down" ? "#c85c54" : f.k === "warn" ? "#c98a2e" : f.k === "good" ? "#3f9d6b" : "#3e9ab0" }} />
              <span>{f.t}</span>
            </div>
          ))}
          {findings.length === 0 && <div style={{ fontSize: 13, color: "var(--dim)" }}>Sin hallazgos.</div>}
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginBottom: 8, fontWeight: 600 }}>Qué puedes hacer</div>
          {recs.map((r, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
              padding: "11px 13px", marginBottom: 8,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontWeight: 700, fontSize: 11, flexShrink: 0,
                background: r.level === "risk" ? "#c85c54" : r.level === "watch" ? "#c98a2e" : "#3f9d6b",
              }}>{i + 1}</span>
              <div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r.text}</div>
                {r.tag && <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, marginTop: 4, padding: "2px 7px", borderRadius: 999, color: "var(--dim)", background: "var(--line)" }}>{r.tag}</span>}
              </div>
            </div>
          ))}
          {recs.length === 0 && <div style={{ fontSize: 13, color: "var(--dim)" }}>Sin acciones sugeridas: la zona va bien.</div>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════════ */

function ProgressRing({ value, size }: { value: number; size: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 100); return () => clearTimeout(t); }, []);
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const deg = (value / 100) * circ;
  const color = value >= 70 ? "#16A34A" : value >= 40 ? "#F59E0B" : "#EF4444";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={mounted ? `${deg} ${circ - deg}` : `0 ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 1s cubic-bezier(.22,1,.36,1)" }} />
    </svg>
  );
}
