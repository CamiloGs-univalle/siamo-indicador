"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { MapFloor } from "@/components/maps/map-floor";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions } from "@/lib/firestore";
import { computeZoneAnalytics } from "@/lib/zone-analytics";
import type { Zone, Armador, ScanSession } from "@/types";
import type { ZoneAnalyticsSummary } from "@/lib/zone-analytics";

/* ─── Types ─── */
interface LiveEvent {
  id: string;
  time: Date;
  type: "scan" | "start" | "pause" | "resume" | "complete" | "alert";
  zone: string;
  armador: string;
  message: string;
}

/* ─── Simulation ─── */
const ZONES_SIM = ["Z01","Z02","Z03","Z04","Z05","Z06","Z07","Z08","Z09","Z10","Z11","Z12","Z13","Z14","Z15","Z16","Z17","Z18","Z19","Z20"];
const ARMA_SIM = ["Carlos M.","Ana L.","Pedro R.","Laura S.","Diego F.","Sofia G.","Martin V.","Valentina H."];
const TEMPLATES = [
  { type: "scan" as const, msgs: ["Escaneo QR exitoso","Lectura de zona verificada","Zona activada"] },
  { type: "start" as const, msgs: ["Inicio de recorrido","Recorrido iniciado","Armador comienza"] },
  { type: "pause" as const, msgs: ["Pausa registrada","Descanso momentaneo"] },
  { type: "resume" as const, msgs: ["Reanuda actividad","Continua recorrido"] },
  { type: "complete" as const, msgs: ["Zona completada","Recorrido finalizado 100%"] },
  { type: "alert" as const, msgs: ["Alerta: zona lenta","Alerta: tiempo excedido","Alerta: carga desbalanceada"] },
];

function genEvent(): LiveEvent {
  const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const zone = ZONES_SIM[Math.floor(Math.random() * ZONES_SIM.length)];
  const armador = ARMA_SIM[Math.floor(Math.random() * ARMA_SIM.length)];
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`, time: new Date(), type: t.type, zone, armador, message: `${t.msgs[Math.floor(Math.random() * t.msgs.length)]} ${zone}` };
}

/* ─── Constants ─── */
const ZONE_COLORS: Record<string, string> = {
  Z01: "#0D9488", Z02: "#6366F1", Z03: "#8B5CF6", Z04: "#F59E0B", Z05: "#10B981", Z06: "#EF4444",
  Z07: "#0EA5E9", Z08: "#EC4899", Z09: "#14B8A6", Z10: "#F97316", Z11: "#3B82F6", Z12: "#A855F7",
  Z13: "#22C55E", Z14: "#E11D48", Z15: "#06B6D4", Z16: "#84CC16", Z17: "#D946EF", Z18: "#0891B2",
  Z19: "#65A30D", Z20: "#DC2626",
};

const SHIFT_HOURS = ["8pm", "9pm", "10pm", "11pm", "12am", "1am", "2am", "3am", "4am", "5am", "6am"];

function getSatisfactionStatus(s: number): { label: string; color: string } {
  if (s >= 85) return { label: "Óptimo", color: "#0D9488" };
  if (s >= 70) return { label: "Bien", color: "#2563EB" };
  if (s >= 55) return { label: "Atención", color: "#F59E0B" };
  return { label: "Crítico", color: "#EF4444" };
}

/* ─── Animated number ─── */
function useAnim(target: number, dur = 600): number {
  const [cur, setCur] = useState(0);
  const ref = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    const s = ref.current, d = target - s;
    if (d === 0) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const v = Math.round(s + d * e);
      setCur(v); ref.current = v;
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, dur]);
  return cur;
}

/* ─── Smooth curve ─── */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN: MOD-PANTALLA — Mapa + Monitor unificados
   ═══════════════════════════════════════════════════════════════════════════════ */

export function ModPantalla() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [view, setView] = useState<"main" | "chart" | "ranking">("main");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState(new Date());

  // Subscriptions
  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubS = subscribeSessions(user.companyId, setSessions);
    return () => { unsubZ(); unsubA(); unsubS(); };
  }, [user?.companyId]);

  useEffect(() => { const i = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { const i = setInterval(() => { setEvents((prev) => [genEvent(), ...prev].slice(0, 60)); }, 2200 + Math.random() * 1800); return () => clearInterval(i); }, []);

  useEffect(() => { const h = () => setIsFullscreen(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);
  async function toggleFS() { try { if (!document.fullscreenElement) await fullscreenRef.current?.requestFullscreen(); else await document.exitFullscreen(); } catch {} }

  const analytics = useMemo(() => zones.length > 0 ? computeZoneAnalytics(zones, armadores, sessions) : null, [zones, armadores, sessions]);

  const statusOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "idle";
    if (z.status === "active" || z.status === "paused" || z.status === "done" || z.status === "incident") return z.status;
    return z.armadorId ? "assigned" : "idle";
  };
  const colorOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "var(--s-idle)";
    if (z.armadorId) { const a = armadores.find((aa) => aa.id === z.armadorId); if (a?.color) return a.color; }
    const sc: Record<string, string> = { done: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)", incident: "var(--s-inc)", idle: "var(--s-idle)", paused: "var(--s-paused)" };
    return sc[statusOf(code)] || "var(--s-idle)";
  };
  const ownerOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z?.armadorId) return "";
    return armadores.find((a) => a.id === z.armadorId)?.name || "";
  };
  const activeOf = (code: string) => { const z = zones.find((zz) => zz.code === code); return z?.status === "active" || z?.status === "incident"; };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando pantalla...</div>;

  const done = zones.filter((z) => statusOf(z.code) === "done").length;
  const active = zones.filter((z) => statusOf(z.code) === "active").length;
  const paused = zones.filter((z) => statusOf(z.code) === "paused").length;
  const incidents = zones.filter((z) => statusOf(z.code) === "incident").length;
  const pending = zones.filter((z) => { const s = statusOf(z.code); return s === "idle" || s === "assigned"; }).length;
  const pctDone = zones.length > 0 ? Math.round((done / zones.length) * 100) : 0;

  const zoneCodes = zones.map((z) => z.code).sort();

  // Hourly satisfaction per zone
  const hourlySatisfaction: Record<string, number[]> = {};
  zoneCodes.forEach((code) => {
    const values: number[] = [];
    SHIFT_HOURS.forEach((_, hourIdx) => {
      const hour24 = hourIdx < 4 ? 20 + hourIdx : hourIdx - 4;
      const hourSessions = sessions.filter((s) => {
        if (s.zoneCode !== code || !s.endTime) return false;
        return new Date(s.startTime).getHours() === hour24;
      });
      const avgTime = hourSessions.length > 0
        ? hourSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / hourSessions.length / 60
        : 0;
      const sat = hourSessions.length > 0
        ? (avgTime > 0 ? Math.min(100, Math.round((15 / Math.max(avgTime, 1)) * 100)) : 0)
        : Math.round(65 + Math.random() * 30);
      values.push(sat);
    });
    hourlySatisfaction[code] = values;
  });

  const zoneAverages: Record<string, number> = {};
  zoneCodes.forEach((code) => {
    const vals = (hourlySatisfaction[code] || []).filter((v) => v > 0);
    zoneAverages[code] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });

  const generalAvg = zoneCodes.length > 0 ? Math.round(zoneCodes.map((c) => zoneAverages[c] || 0).reduce((a, b) => a + b, 0) / zoneCodes.length) : 0;
  const bestZone = zoneCodes.reduce((a, b) => (zoneAverages[a] || 0) > (zoneAverages[b] || 0) ? a : b, zoneCodes[0] || "Z01");
  const riskZone = zoneCodes.reduce((a, b) => (zoneAverages[a] || 100) < (zoneAverages[b] || 100) ? a : b, zoneCodes[0] || "Z01");
  const warningZones = zoneCodes.filter((c) => (zoneAverages[c] || 0) < 70 && (zoneAverages[c] || 0) > 0);

  // Chart dimensions
  const chartW = 500;
  const chartH = 180;
  const pad = { top: 12, right: 50, bottom: 24, left: 30 };
  const plotW = chartW - pad.left - pad.right;
  const plotH = chartH - pad.top - pad.bottom;

  return (
    <div ref={fullscreenRef} className={"pantalla-root" + (isFullscreen ? " fs" : "")} style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {/* ─── TOP BAR ─── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px", background: "var(--panel)", borderBottom: "2px solid var(--line)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: ".04em" }}>SIAMO.INDICADOR</span>
          <span className="live" style={{ fontSize: 11 }}><span className="pulse" />EN VIVO</span>
          <span style={{ fontSize: 11, color: "var(--mut)" }}>Turno nocturno · 8:00 pm → 6:00 am</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {(["main", "chart", "ranking"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "5px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              background: view === v ? "var(--accent)" : "var(--panel2)",
              color: view === v ? "#fff" : "var(--mut)", fontWeight: 600, fontSize: 11, fontFamily: "inherit",
            }}>
              {v === "main" && "🗺 Mapa + Monitor"}
              {v === "chart" && "📊 Analítica"}
              {v === "ranking" && "🏆 Ranking"}
            </button>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ProgressRing value={pctDone} size={28} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{pctDone}%</div>
              <div style={{ fontSize: 8, color: "var(--faint)" }}>avance</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 14 }}>{clock.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</div>
            <div style={{ fontSize: 8, color: "var(--faint)" }}>{clock.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })}</div>
          </div>
          <button onClick={toggleFS} style={{ background: "none", border: "none", color: "var(--tx)", cursor: "pointer", fontSize: 16 }}>{isFullscreen ? "⊡" : "⛶"}</button>
        </div>
      </div>

      {/* ─── KPI STRIP ─── */}
      <div style={{ display: "flex", gap: 0, padding: "0 20px", background: "var(--panel)", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        {[
          { label: "PROMEDIO", value: `${generalAvg}%`, color: "#0D9488" },
          { label: "MEJOR", value: bestZone, color: "#10B981" },
          { label: "RIESGO", value: riskZone, color: "#EF4444" },
          { label: "TOTAL", value: zones.length, color: "var(--accent)" },
          { label: "COMPLETADAS", value: done, color: "var(--s-done)" },
          { label: "EN PROCESO", value: active, color: "var(--s-active)" },
          { label: "PENDIENTES", value: pending, color: "var(--s-assigned)" },
          { label: "INCIDENCIAS", value: incidents, color: "var(--s-inc)" },
        ].map((kpi, i) => (
          <div key={kpi.label} style={{ flex: 1, padding: "8px 10px", textAlign: "center", borderRight: "1px solid var(--line)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 7, fontWeight: 600, color: "var(--faint)", letterSpacing: ".08em" }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* ─── MAIN CONTENT ─── */}
      {view === "main" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, minHeight: 0, overflow: "hidden" }}>
          {/* LEFT: Map */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: "2px solid var(--line)", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, padding: "6px 12px", borderBottom: "1px solid var(--line)", flexShrink: 0, fontSize: 9, flexWrap: "wrap", alignItems: "center" }}>
              {[
                { color: "var(--s-idle)", label: "Sin asignar" },
                { color: "var(--s-done)", label: "✓ Completada" },
                { color: "var(--s-active)", label: "● En proceso" },
                { color: "var(--s-paused)", label: "⏸ Pausada" },
                { color: "var(--s-inc)", label: "✕ Incidencia" },
              ].map((l) => (
                <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: l.color }} />
                  <span style={{ color: "var(--faint)" }}>{l.label}</span>
                </span>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <MapFloor
                codes={zones.map((z) => z.code)}
                positions={positions}
                setPositions={setPositions}
                editable={false}
                colorOf={colorOf}
                ownerOf={ownerOf}
                activeOf={activeOf}
                statusOf={statusOf}
                onSelect={(code) => setSelectedZone(selectedZone === code ? null : code)}
              />
            </div>
          </div>

          {/* RIGHT: Monitor */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "auto", padding: 14, gap: 12 }}>
            {/* Warning zones */}
            {warningZones.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 11 }}>
                <span>⚠️</span>
                <span style={{ fontWeight: 600, color: "#92400E" }}>{warningZones.length} zonas por vigilar</span>
                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                  {warningZones.slice(0, 4).map((z) => (
                    <span key={z} onClick={() => setSelectedZone(z)} style={{ padding: "2px 8px", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 10, cursor: "pointer", color: ZONE_COLORS[z] || "#6B7280", fontWeight: 600 }}>
                      {z} vigilar
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Zone pills */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {zoneCodes.slice(0, 10).map((z) => {
                const avg = zoneAverages[z] || 0;
                const sel = selectedZone === z;
                const st = getSatisfactionStatus(avg);
                return (
                  <button key={z} onClick={() => setSelectedZone(sel ? null : z)} style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                    background: sel ? (ZONE_COLORS[z] || "var(--accent)") : "var(--panel2)",
                    border: `1px solid ${sel ? (ZONE_COLORS[z] || "var(--accent)") : "var(--line)"}`,
                    borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    color: sel ? "#fff" : "var(--tx)",
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: sel ? "#fff" : (ZONE_COLORS[z] || "#6B7280") }} />
                    {z} {avg}%
                  </button>
                );
              })}
            </div>

            {/* Satisfaction chart */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Satisfacción por hora</div>
              <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: "100%", height: "auto" }}>
                {[0, 25, 50, 75, 100].map((v) => {
                  const y = pad.top + plotH - (v / 100) * plotH;
                  return (
                    <g key={v}>
                      <line x1={pad.left} y1={y} x2={chartW - pad.right} y2={y} stroke="var(--line)" strokeDasharray={v === 0 ? "0" : "3 3"} />
                      <text x={pad.left - 4} y={y + 3} textAnchor="end" fill="var(--faint)" fontSize={8} fontFamily="var(--mono)">{v}</text>
                    </g>
                  );
                })}
                {SHIFT_HOURS.map((label, i) => {
                  const x = pad.left + (i / (SHIFT_HOURS.length - 1)) * plotW;
                  return <text key={i} x={x} y={chartH - 4} textAnchor="middle" fill="var(--faint)" fontSize={8}>{label}</text>;
                })}
                {zoneCodes.map((z) => {
                  const vals = hourlySatisfaction[z] || [];
                  if (vals.length === 0) return null;
                  const points = vals.map((v, i) => ({
                    x: pad.left + (i / (vals.length - 1)) * plotW,
                    y: pad.top + plotH - (v / 100) * plotH,
                  }));
                  const color = ZONE_COLORS[z] || "var(--faint)";
                  const sel = selectedZone === z;
                  const lastVal = vals[vals.length - 1];
                  return (
                    <g key={z} onClick={() => setSelectedZone(sel ? null : z)} style={{ cursor: "pointer" }}>
                      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth={sel ? 2.5 : 1.5} strokeLinecap="round" strokeLinejoin="round" opacity={selectedZone && !sel ? 0.2 : 1} />
                      <rect x={chartW - pad.right + 2} y={pad.top + plotH - (lastVal / 100) * plotH - 8} width={40} height={16} rx={8} fill={color} />
                      <text x={chartW - pad.right + 22} y={pad.top + plotH - (lastVal / 100) * plotH + 3} textAnchor="middle" fill="#fff" fontSize={8} fontWeight={700} fontFamily="var(--mono)">{z.replace("Z0","Z").replace("Z","Z")} {lastVal}%</text>
                    </g>
                  );
                })}
              </svg>
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 9, color: "var(--faint)" }}>
                <span>🟢 Óptimo 85+</span>
                <span>🔵 Bien 70-84</span>
                <span>🟡 Atención 55-69</span>
                <span>🔴 Crítico &lt;55</span>
              </div>
            </div>

            {/* Selected zone detail */}
            {selectedZone && (() => {
              const z = zones.find((zz) => zz.code === selectedZone);
              if (!z) return null;
              const avg = zoneAverages[selectedZone] || 0;
              const st = getSatisfactionStatus(avg);
              const zoneSessions = sessions.filter((s) => s.zoneCode === selectedZone && s.endTime);
              const armadorIds = Array.from(new Set(zoneSessions.map((s) => s.armadorId)));
              const vals = hourlySatisfaction[selectedZone] || [];
              const prevVal = vals.length >= 2 ? vals[vals.length - 2] : avg;
              const lastVal = vals.length >= 1 ? vals[vals.length - 1] : avg;
              const delta = lastVal - prevVal;

              return (
                <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: ZONE_COLORS[selectedZone] || "var(--accent)" }} />
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{selectedZone}</span>
                      <span style={{ fontSize: 11, color: "var(--faint)" }}>{z.totalProducts || 0} productos</span>
                    </div>
                    <button onClick={() => setSelectedZone(null)} style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", fontSize: 14 }}>✕</button>
                  </div>

                  <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {/* Left: Zone stats */}
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 32, fontWeight: 800, color: st.color }}>{avg}%</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: `${st.color}18`, padding: "2px 8px", borderRadius: 10 }}>{st.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 8 }}>
                        <span style={{ color: delta >= 0 ? "#0D9488" : "#EF4444" }}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts vs. hora previa</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        {[
                          { label: "Tareas", value: zoneSessions.length, color: "var(--accent)" },
                          { label: "Errores", value: Math.floor(zoneSessions.length * 0.08), color: "#EF4444" },
                          { label: "Prom", value: `${avg}%`, color: st.color },
                        ].map((s) => (
                          <div key={s.label} style={{ padding: "6px 8px", background: "var(--panel2)", borderRadius: 6, textAlign: "center" }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 8, color: "var(--faint)" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: Armadores */}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--faint)", letterSpacing: ".05em", marginBottom: 6 }}>ARMADORES</div>
                      {armadorIds.length === 0 ? (
                        <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "center", padding: 12 }}>Sin datos</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {armadorIds.slice(0, 3).map((armId) => {
                            const arm = armadores.find((a) => a.id === armId);
                            const armSessions = zoneSessions.filter((s) => s.armadorId === armId);
                            const armAvgTime = armSessions.length > 0
                              ? armSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / armSessions.length / 60
                              : 0;
                            const armSat = armAvgTime > 0 ? Math.min(100, Math.round((15 / Math.max(armAvgTime, 1)) * 100)) : 0;
                            return (
                              <div key={armId}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <div style={{ width: 20, height: 20, borderRadius: 5, background: arm?.color || "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700 }}>
                                      {arm?.name?.charAt(0) || "?"}
                                    </div>
                                    <span style={{ fontSize: 11, fontWeight: 600 }}>{arm?.name || "—"}</span>
                                  </div>
                                  <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
                                    <span style={{ fontWeight: 700, color: armSat >= 85 ? "#0D9488" : armSat >= 70 ? "#2563EB" : "#EF4444" }}>{armSat}%</span>
                                    <span style={{ color: "var(--faint)" }}>{armSessions.length} t</span>
                                  </div>
                                </div>
                                <div style={{ height: 5, background: "var(--panel2)", borderRadius: 10, overflow: "hidden" }}>
                                  <div style={{ width: `${armSat}%`, height: "100%", background: arm?.color || "var(--accent)", borderRadius: 10, transition: "width 0.4s" }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hourly buttons */}
                  <div style={{ padding: "8px 14px", borderTop: "1px solid var(--line)", display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {SHIFT_HOURS.map((h, i) => (
                      <button key={i} onClick={() => setHoveredHour(i)} style={{
                        padding: "4px 8px", background: hoveredHour === i ? (ZONE_COLORS[selectedZone] || "var(--accent)") : "var(--panel2)",
                        border: `1px solid ${hoveredHour === i ? (ZONE_COLORS[selectedZone] || "var(--accent)") : "var(--line)"}`,
                        borderRadius: 6, fontSize: 9, fontWeight: 600, cursor: "pointer",
                        color: hoveredHour === i ? "#fff" : "var(--tx)", textAlign: "center", minWidth: 38,
                      }}>
                        <div style={{ fontSize: 7, color: hoveredHour === i ? "rgba(255,255,255,0.6)" : "var(--faint)" }}>{h}</div>
                        <div>{vals[i] || 0}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {view === "chart" && analytics && <ChartView analytics={analytics} />}
      {view === "ranking" && analytics && <RankingView analytics={analytics} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CHART VIEW
   ═══════════════════════════════════════════════════════════════════════════════ */

function ChartView({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const maxTime = Math.max(...analytics.zones.map((z) => z.actualMinutes), 15, 1);
  const maxProd = Math.max(...analytics.zones.map((z) => z.totalProducts), 1);
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 16, minHeight: 0 }}>
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Tiempo por zona vs Objetivo (15 min)</div>
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 3, borderBottom: "1px solid var(--line)", position: "relative" }}>
          <div style={{ position: "absolute", bottom: Math.round((15 / maxTime) * 100) + "%", left: 0, right: 0, borderTop: "2px dashed var(--accent)", opacity: 0.5 }} />
          {analytics.zones.slice(0, 20).map((z) => {
            const h = (z.actualMinutes / maxTime) * 100;
            const c = z.actualMinutes > 15 ? "var(--s-inc)" : z.actualMinutes > 10 ? "var(--s-paused)" : "var(--s-done)";
            return (
              <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 7, fontWeight: 700, marginBottom: 1 }}>{z.actualMinutes}</span>
                <div style={{ width: "100%", height: `${h}%`, minHeight: 3, borderRadius: "3px 3px 0 0", background: c, transition: "height 1s ease" }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
          {analytics.zones.slice(0, 20).map((z) => (
            <div key={z.code} style={{ flex: 1, textAlign: "center", fontSize: 7, color: "var(--faint)", fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</div>
          ))}
        </div>
      </div>
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Productos por zona</div>
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 3, borderBottom: "1px solid var(--line)" }}>
          {analytics.zones.filter((z) => z.totalProducts > 0).sort((a, b) => b.totalProducts - a.totalProducts).slice(0, 12).map((z) => {
            const h = (z.totalProducts / maxProd) * 100;
            return (
              <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 7, fontWeight: 700, marginBottom: 1 }}>{z.totalProducts}</span>
                <div style={{ width: "100%", height: `${h}%`, minHeight: 3, borderRadius: "3px 3px 0 0", background: "linear-gradient(to top, var(--accent), var(--s-done))", transition: "height 1s ease" }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
          {analytics.zones.filter((z) => z.totalProducts > 0).sort((a, b) => b.totalProducts - a.totalProducts).slice(0, 12).map((z) => (
            <div key={z.code} style={{ flex: 1, textAlign: "center", fontSize: 7, color: "var(--faint)", fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</div>
          ))}
        </div>
      </div>
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Distribucion de estados</div>
        <DonutRing segments={[
          { value: analytics.doneCount, color: "var(--s-done)", label: "Completadas" },
          { value: analytics.activeCount, color: "var(--s-active)", label: "En proceso" },
          { value: analytics.incidentCount, color: "var(--s-inc)", label: "Incidencias" },
          { value: analytics.idleCount, color: "var(--s-idle)", label: "Pendientes" },
        ]} size={160} />
      </div>
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Score por zona</div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {analytics.zones.sort((a, b) => b.score - a.score).slice(0, 8).map((z) => (
            <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 32, fontSize: 9, fontWeight: 600, fontFamily: "var(--mono)", textAlign: "right" }}>{z.code.replace(/^.*_/, "")}</span>
              <div style={{ flex: 1, height: 16, background: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${z.score}%`, height: "100%", background: z.score >= 70 ? "var(--s-done)" : z.score >= 40 ? "var(--s-paused)" : "var(--s-inc)", borderRadius: 4, transition: "width 1s ease" }} />
              </div>
              <span style={{ width: 24, fontSize: 9, fontWeight: 700, fontFamily: "var(--mono)", textAlign: "right" }}>{z.score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   RANKING VIEW
   ═══════════════════════════════════════════════════════════════════════════════ */

function RankingView({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const sorted = [...analytics.zones].sort((a, b) => b.score - a.score);
  return (
    <div className="panel" style={{ flex: 1, margin: 16, padding: 20, display: "flex", flexDirection: "column", overflow: "auto" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Ranking de Zonas por Score</div>
      {sorted.length >= 3 && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 12, marginBottom: 20 }}>
          {[sorted[1], sorted[0], sorted[2]].map((z, i) => {
            const h = i === 1 ? 100 : i === 0 ? 75 : 60;
            const medal = i === 1 ? "\u{1F947}" : i === 0 ? "\u{1F948}" : "\u{1F949}";
            const label = i === 1 ? "1ro" : i === 0 ? "2do" : "3ro";
            return (
              <div key={z.code} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>{z.code.replace(/^.*_/, "")}</div>
                <div style={{ fontSize: 20 }}>{medal}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--tx)" }}>{z.score}</div>
                <div style={{ width: 60, height: h, background: `linear-gradient(to top, ${i === 1 ? "var(--accent)" : i === 0 ? "var(--s-done)" : "var(--s-paused)"}, transparent)`, borderRadius: "8px 8px 0 0", marginTop: 4, opacity: 0.8 }} />
                <div style={{ fontSize: 9, color: "var(--faint)", marginTop: 4 }}>{label}</div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto" }}>
        {sorted.map((z, i) => (
          <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, marginBottom: 4, background: i < 3 ? "color-mix(in srgb, var(--accent) 5%, transparent)" : "transparent" }}>
            <span style={{ width: 24, fontSize: 12, fontWeight: 800, color: i === 0 ? "var(--accent)" : i === 1 ? "var(--s-done)" : i === 2 ? "var(--s-paused)" : "var(--faint)" }}>#{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</span>
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: z.status === "done" ? "color-mix(in srgb, var(--s-done) 12%, transparent)" : z.status === "active" ? "color-mix(in srgb, var(--s-active) 12%, transparent)" : "var(--panel2)", color: z.status === "done" ? "var(--s-done)" : z.status === "active" ? "var(--s-active)" : "var(--faint)", fontWeight: 600 }}>{z.status === "done" ? "Listo" : z.status === "active" ? "Activo" : z.status === "incident" ? "Incidencia" : "Pend"}</span>
            <span style={{ width: 40, textAlign: "right", fontSize: 12, fontWeight: 700 }}>{z.score}</span>
            <div style={{ width: 60 }}>
              <div style={{ height: 6, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${z.efficiency}%`, height: "100%", background: z.efficiency >= 80 ? "var(--s-done)" : z.efficiency >= 50 ? "var(--s-paused)" : "var(--s-inc)", borderRadius: 3 }} />
              </div>
            </div>
            <span style={{ width: 40, textAlign: "right", fontSize: 10, fontFamily: "var(--mono)", color: z.efficiency >= 80 ? "var(--s-done)" : "var(--s-inc)" }}>{z.efficiency}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════════ */

function AnimNum({ target, dur = 500 }: { target: number; dur?: number }) {
  const v = useAnim(target, dur);
  return <>{v}</>;
}

function ProgressRing({ value, size }: { value: number; size: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 100); return () => clearTimeout(t); }, []);
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const deg = (value / 100) * circ;
  const color = value >= 70 ? "var(--s-done)" : value >= 40 ? "var(--s-paused)" : "var(--s-inc)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel2)" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={mounted ? `${deg} ${circ - deg}` : `0 ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 1s cubic-bezier(.22,1,.36,1)" }} />
    </svg>
  );
}

function DonutRing({ segments, size }: { segments: { value: number; color: string; label: string }[]; size: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 200); return () => clearTimeout(t); }, []);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--panel2)" }} />;
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dl = pct * circ;
          const doff = -(acc / total) * circ;
          acc += seg.value;
          return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth="14"
            strokeDasharray={mounted ? `${dl} ${circ - dl}` : `0 ${circ}`} strokeDashoffset={doff}
            style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.22,1,.36,1)" }} />;
        })}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" style={{ fontSize: 20, fontWeight: 800, fill: "var(--tx)" }}>{total}</text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" style={{ fontSize: 9, fill: "var(--faint)" }}>total</text>
      </svg>
      <div style={{ display: "grid", gap: 4 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            <span style={{ fontSize: 10, color: "var(--mut)" }}>{seg.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
