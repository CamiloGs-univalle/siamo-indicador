"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { MapFloor } from "@/components/maps/map-floor";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions, subscribeMembretes, getCompany } from "@/lib/firestore";
import { computeZoneAnalytics } from "@/lib/zone-analytics";
import { mapZoneToWarehousePosition } from "@/lib/warehouse-layout";
import type { Zone, Armador, ScanSession, Pos, Membrete } from "@/types";
import type { ZoneAnalyticsSummary } from "@/lib/zone-analytics";

/* ─── Constants ─── */
const ZONE_COLORS: Record<string, string> = {
  Z01: "#0D9488", Z02: "#6366F1", Z03: "#8B5CF6", Z04: "#F59E0B", Z05: "#10B981", Z06: "#EF4444",
  Z07: "#0EA5E9", Z08: "#EC4899", Z09: "#14B8A6", Z10: "#F97316", Z11: "#3B82F6", Z12: "#A855F7",
  Z13: "#22C55E", Z14: "#E11D48", Z15: "#06B6D4", Z16: "#84CC16", Z17: "#D946EF", Z18: "#0891B2",
  Z19: "#65A30D", Z20: "#DC2626",
};

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
  if (s >= 75) return { label: "Óptimo", color: "#0D9488", bg: "rgba(13,148,136,0.08)" };
  if (s >= 50) return { label: "Favorable", color: "#2563EB", bg: "rgba(37,99,235,0.08)" };
  if (s >= 25) return { label: "Precaución", color: "#F59E0B", bg: "rgba(245,158,11,0.08)" };
  return { label: "Riesgo", color: "#EF4444", bg: "rgba(239,68,68,0.08)" };
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
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Cargar configuración del turno desde la empresa
  useEffect(() => {
    if (!user?.companyId) return;
    getCompany(user.companyId).then((c) => {
      if (c?.turnoNocheInicio && c?.turnoNocheFin) {
        setShiftConfig({ inicio: c.turnoNocheInicio, fin: c.turnoNocheFin });
      } else if (c?.turnoTardeInicio && c?.turnoTardeFin) {
        setShiftConfig({ inicio: c.turnoTardeInicio, fin: c.turnoTardeFin });
      }
    }).catch(() => {});
  }, [user?.companyId]);

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

  async function toggleFs() {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* noop */ }
  }

  const analytics = useMemo(() => zones.length > 0 ? computeZoneAnalytics(zones, armadores, sessions) : null, [zones, armadores, sessions]);

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

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando pantalla en vivo...</div>;

  const done = zones.filter((z) => statusOf(z.code) === "done").length;
  const active = zones.filter((z) => statusOf(z.code) === "active").length;
  const pctDone = zones.length > 0 ? Math.round((done / zones.length) * 100) : 0;
  const zoneCodes = zones.map((z) => z.code).sort();

  /* ─── Hourly productivity: real data only, null = no sessions that hour ─── */
  const todayStr = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, "0")}-${String(clock.getDate()).padStart(2, "0")}`;
  const hourlyProductivity: Record<string, (number | null)[]> = {};
  zoneCodes.forEach((code) => {
    const values: (number | null)[] = [];
    SHIFT_HOURS.forEach((_, hourIdx) => {
      const hour24 = hourIdx < 4 ? 20 + hourIdx : hourIdx - 4;
      const hourSessions = sessions.filter((s) => {
        if (s.zoneCode !== code) return false;
        if (!s.endTime && !s.startTime) return false;
        const d = new Date(s.startTime);
        const sessionDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (sessionDate !== todayStr) return false;
        return d.getHours() === hour24;
      });
      if (hourSessions.length === 0) { values.push(null); return; }
      const avgDuration = hourSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / hourSessions.length;
      const targetDuration = 15 * 60;
      const efficiency = Math.min(100, Math.round((targetDuration / Math.max(avgDuration, 1)) * 100));
      const completionRate = hourSessions.length / 3;
      const score = Math.min(100, Math.round(efficiency * 0.7 + completionRate * 30));
      values.push(score);
    });
    hourlyProductivity[code] = values;
  });

  /* ─── Current hour index (realtime) ─── */
  const now = clock;
  const currentHour24 = now.getHours();
  const currentShiftIdx = currentHour24 >= 20 ? currentHour24 - 20 : currentHour24 < 6 ? currentHour24 + 4 : -1;

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

  /* ─── Ranking data ─── */
  const ranking = zoneCodes
    .map((code) => {
      const avg = zoneAverages[code] || 0;
      const vals = hourlyProductivity[code] || [];
      const lastVal = vals.filter((v): v is number => v !== null).slice(-1)[0] ?? 0;
      const prevVal = vals.filter((v): v is number => v !== null).slice(-2, -1)[0] ?? lastVal;
      const trend = lastVal - prevVal;
      const z = zones.find((zz) => zz.code === code);
      const zoneArmadoresActivos = z ? getArmadoresForZone(z) : [];
      const zoneArmadores = armadores.filter((a) => {
        return zoneArmadoresActivos.some((za) => za.id === a.id) || sessions.some((s) => s.zoneCode === code && s.armadorId === a.id);
      });
      const colaCount = z ? getColaForZone(z).length : 0;
      const todaySessions = sessions.filter((s) => {
        if (s.zoneCode !== code) return false;
        if (!s.startTime) return false;
        const d = new Date(s.startTime);
        const sd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return sd === todayStr;
      });
      return { code, avg, lastVal, trend, status: getSatisfactionStatus(avg), armadores: zoneArmadores.slice(0, 3), totalSessions: todaySessions.length, colaCount };
    })
    .sort((a, b) => b.avg - a.avg);

  const rootStyle: React.CSSProperties = isFs
    ? { position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }
    : { display: "flex", flexDirection: "column", gap: 12, minHeight: 0 };

  return (
    <div ref={rootRef} style={rootStyle}>
      {/* ─── HEADER ─── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: isFs ? "10px 20px" : "10px 14px", background: "var(--panel)", borderBottom: "2px solid var(--line)", flexShrink: 0, flexWrap: "wrap" }}>
        <span className="live" style={{ fontSize: 12 }}><span className="pulse" />EN VIVO</span>
        <span style={{ fontSize: 11, color: "var(--mut)" }}>Turno nocturno · 8pm → 6am</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {[
            { label: "Promedio", val: `${generalAvg}%`, c: getSatisfactionStatus(generalAvg).color },
            { label: "Mejor", val: bestZone, c: "#10B981" },
            { label: "Riesgo", val: riskZone, c: "#EF4444" },
            { label: "Completadas", val: String(done), c: "var(--s-done)" },
            { label: "Activas", val: String(active), c: "var(--s-active)" },
          ].map((k) => (
            <div key={k.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: k.c }}>{k.val}</div>
              <div style={{ fontSize: 7, fontWeight: 600, color: "var(--faint)", letterSpacing: ".05em" }}>{k.label}</div>
            </div>
          ))}
          <div style={{ width: 1, height: 24, background: "var(--line)" }} />
          <ProgressRing value={pctDone} size={26} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>{pctDone}%</div>
            <div style={{ fontSize: 7, color: "var(--faint)" }}>avance</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13 }}>{clock.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</div>
            <div style={{ fontSize: 7, color: "var(--faint)" }}>{clock.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })}</div>
          </div>
          <button onClick={toggleFs} title={isFs ? "Salir de pantalla completa" : "Pantalla completa"}
            style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--tx)", cursor: "pointer", fontSize: 14, width: 28, height: 28, display: "grid", placeItems: "center" }}>
            {isFs ? "✕" : "⛶"}
          </button>
        </div>
      </div>

      {/* ─── MAIN: MAP + MONITOR ─── */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: isFs ? "55fr 45fr" : "1fr 1fr", gap: isFs ? 12 : 12, minHeight: 0, overflow: "hidden", padding: isFs ? "0 16px 12px" : 0 }}>

        {/* LEFT: Map */}
        <div style={{ display: "flex", flexDirection: "column", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Mapa de la bodega</span>
            <div style={{ display: "flex", gap: 8, fontSize: 8, flexWrap: "wrap" }}>
              {[{ c: "var(--s-idle)", l: "Sin asignar" }, { c: "var(--s-done)", l: "✓ Completada" }, { c: "var(--s-active)", l: "● En proceso" }, { c: "var(--s-paused)", l: "⏸ Pausada" }, { c: "var(--s-inc)", l: "✕ Incidencia" }].map((l) => (
                <span key={l.l} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: l.c }} />
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
        <div style={{ display: "flex", flexDirection: "column", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Monitor de zonas</span>
            <span style={{ fontSize: 10, color: "var(--faint)" }}>{zoneCodes.length} zonas</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 10, overflow: "auto" }}>
            {/* Alerts banner — prototype style */}
            {warningZones.length > 0 ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                background: "var(--surface, #fff)", border: "1px solid var(--hair, #e6e8df)",
                borderLeft: "4px solid #c85c54", borderRadius: 14, padding: "12px 16px",
                boxShadow: "0 1px 2px rgba(64,58,40,0.05)", flexShrink: 0,
              }}>
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#c85c54" strokeWidth={1.8}>
                  <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink, #2b302b)" }}>
                  <b style={{ color: "#c85c54" }}>{warningZones.length} zona{warningZones.length > 1 ? "s" : ""}</b> por vigilar
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
                  {warningZones.map((z) => (
                    <button key={z} onClick={() => setSelectedZone(z)} style={{
                      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                      color: "var(--ink, #2b302b)", background: "var(--soft, #fafaf5)",
                      border: "1px solid var(--hair-2, #dcdfd4)", borderRadius: 999, padding: "5px 11px",
                      cursor: "pointer", fontFamily: "inherit", transition: "transform 0.1s, border-color 0.15s",
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ZONE_COLORS[z] || "#6B7280" }} />
                      {z}
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
                        color: "#c85c54", background: "#c85c5422",
                      }}>vigilar</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              (() => {
                const anyData = currentShiftIdx >= 0;
                return anyData ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    background: "var(--surface, #fff)", border: "1px solid var(--hair, #e6e8df)",
                    borderLeft: "4px solid #3f9d6b", borderRadius: 14, padding: "12px 16px",
                    boxShadow: "0 1px 2px rgba(64,58,40,0.05)", flexShrink: 0,
                  }}>
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#3f9d6b" strokeWidth={1.8}>
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink, #2b302b)" }}>Todas las zonas van en buen ritmo por ahora.</span>
                  </div>
                ) : null;
              })()
            )}

            {/* ═══ PROFESSIONAL SVG CHART ═══ */}
            <div ref={chartRef} style={{ background: "var(--surface, #fff)", border: "1px solid var(--hair, #e6e8df)", borderRadius: 16, padding: 20, boxShadow: "0 1px 2px rgba(64,58,40,0.05), 0 10px 26px -14px rgba(64,58,40,0.22)", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>Satisfacción por hora</div>
                  <div style={{ fontSize: 12, color: "var(--dim, #6b7266)", marginTop: 2 }}>Selecciona una zona para ver su detalle</div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {zoneCodes.map((z) => {
                    const vals = hourlyProductivity[z] || [];
                    let lastVal: number | null = null;
                    for (let i = vals.length - 1; i >= 0; i--) {
                      if (vals[i] !== null && i <= currentShiftIdx) { lastVal = vals[i]; break; }
                    }
                    const isSel = selectedZone === z;
                    const off = selectedZone && !isSel;
                    return (
                      <button key={z} onClick={() => setSelectedZone(isSel ? null : z)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                          border: `1px solid ${isSel ? (ZONE_COLORS[z] || "#94A3B2") : "var(--hair-2, #dcdfd4)"}`,
                          background: isSel ? "var(--surface, #fff)" : "var(--soft, #fafaf5)",
                          color: isSel ? "var(--ink, #2b302b)" : "var(--dim, #6b7266)",
                          borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 500,
                          fontFamily: "inherit", opacity: off ? 0.55 : 1,
                          boxShadow: isSel ? `0 0 0 3px ${ZONE_COLORS[z] || "#94A3B2"}26` : "none",
                          transition: "border-color 0.18s, box-shadow 0.18s, opacity 0.18s",
                        }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: ZONE_COLORS[z] || "#94A3B2", flexShrink: 0 }} />
                        {z} <span style={{ fontWeight: 700, color: "var(--ink, #2b302b)" }}>{lastVal == null ? "—" : lastVal + "%"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <ProductivityChart
                  hourlyData={hourlyProductivity}
                  zoneCodes={zoneCodes}
                  zoneAverages={zoneAverages}
                  selectedZone={selectedZone}
                  onSelectZone={setSelectedZone}
                  hoveredHour={hoveredHour}
                  onHoverHour={setHoveredHour}
                  currentShiftIdx={currentShiftIdx}
                  clock={clock}
                  shiftHours={SHIFT_HOURS}
                />
                {/* End-label pills (HTML overlay for crisp text) */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  {(() => {
                    const W = 640, H = 280;
                    const padL = { top: 20, right: 68, bottom: 34, left: 36 };
                    const pW = W - padL.left - padL.right;
                    const pH = H - padL.top - padL.bottom;
                    const xFor = (i: number) => padL.left + (i / (SHIFT_HOURS.length - 1)) * pW;
                    const yFor = (v: number) => padL.top + pH - (v / 100) * pH;
                    const labels: { z: string; c: string; x: number; ly: number; val: number }[] = [];
                    zoneCodes.forEach((z) => {
                      const vals = hourlyProductivity[z] || [];
                      let li: number | null = null;
                      for (let i = vals.length - 1; i >= 0; i--) {
                        if (vals[i] !== null && i <= currentShiftIdx) { li = i; break; }
                      }
                      if (li === null) return;
                      const val = vals[li]!;
                      labels.push({ z, c: ZONE_COLORS[z] || "#94A3B2", x: xFor(li), ly: yFor(val), val });
                    });
                    labels.sort((a, b) => a.ly - b.ly);
                    const g = 24;
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
                    return labels.map((l) => (
                      <button key={l.z} onClick={() => setSelectedZone(selectedZone === l.z ? null : l.z)}
                        style={{
                          position: "absolute", right: 6,
                          top: `${(l.ly / H) * 100}%`, transform: "translateY(-50%)",
                          pointerEvents: "auto", cursor: "pointer",
                          display: "inline-flex", alignItems: "center", gap: 4,
                          fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 12, fontWeight: 500,
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
                {hoveredHour !== null && hoveredHour <= currentShiftIdx && (() => {
                  const vals = zoneCodes.map((z) => ({ z, v: hourlyProductivity[z]?.[hoveredHour] })).filter((e): e is { z: string; v: number } => e.v !== null);
                  if (vals.length === 0) return null;
                  return (
                    <div style={{
                      position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)",
                      background: "var(--ink, #2b302b)", color: "#fff", borderRadius: 12,
                      padding: "9px 14px", fontSize: 12, pointerEvents: "none", zIndex: 20,
                      boxShadow: "0 14px 30px -12px rgba(0,0,0,0.45)", whiteSpace: "nowrap",
                    }}>
                      <div style={{ color: "#cfd6cd", fontSize: 11, marginBottom: 3 }}>{SHIFT_HOURS[hoveredHour]}</div>
                      {vals.sort((a, b) => b.v - a.v).map((e) => (
                        <div key={e.z} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: ZONE_COLORS[e.z] || "#94A3B8", flexShrink: 0 }} />
                          <span style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 12 }}>{e.z}</span>
                          <span style={{ fontWeight: 700, fontSize: 13, marginLeft: "auto" }}>{e.v}%</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--hair, #e6e8df)", fontSize: 12, color: "var(--dim, #6b7266)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "rgba(63,157,107,0.35)", display: "inline-block" }} />Óptimo 85+</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "rgba(62,154,176,0.30)", display: "inline-block" }} />Bien 70–84</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "rgba(201,138,46,0.35)", display: "inline-block" }} />Atención 55–69</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 11, height: 11, borderRadius: 4, background: "rgba(200,92,84,0.30)", display: "inline-block" }} />Crítico &lt;55</span>
                <span style={{ fontSize: 12, color: "var(--faint, #9aa093)", marginLeft: "auto" }}>El círculo <b>Z1…Z{zoneCodes.length}</b> al final de cada línea identifica la zona · clic para ver detalle</span>
              </div>
            </div>

            {/* ═══ RANKING PANEL ═══ */}
            <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
              <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", fontSize: 11, fontWeight: 700 }}>Ranking de zonas</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {ranking.map((r, i) => (
                  <div key={r.code} onClick={() => setSelectedZone(selectedZone === r.code ? null : r.code)}
                    style={{
                      display: "grid", gridTemplateColumns: "20px 36px 1fr 44px 32px", alignItems: "center", gap: 6,
                      padding: "6px 10px", cursor: "pointer",
                      background: selectedZone === r.code ? `${ZONE_COLORS[r.code]}15` : i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.02)",
                      borderBottom: "1px solid var(--line)",
                      transition: "background 0.15s",
                    }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: i === 0 ? "#0D9488" : i === 1 ? "#16A34A" : i === 2 ? "#F59E0B" : "var(--faint)" }}>#{i + 1}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ZONE_COLORS[r.code] || "#94A3B8", flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--mono)" }}>{r.code}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ flex: 1, height: 4, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${r.avg}%`, height: "100%", background: r.status.color, borderRadius: 2, transition: "width 0.4s" }} />
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--mono)", color: r.status.color, minWidth: 28, textAlign: "right" }}>{r.avg}%</span>
                      </div>
                      {(r.armadores.length > 0 || r.colaCount > 0) && (
                        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                          {r.armadores.map((a) => (
                            <span key={a.id} style={{ fontSize: 7, color: "var(--faint)", background: "var(--panel)", padding: "1px 4px", borderRadius: 4, border: `1px solid ${a.color || "var(--line)"}22` }}>{a.name}</span>
                          ))}
                          {r.colaCount > 0 && (
                            <span style={{ fontSize: 7, color: "var(--s-idle)", background: "var(--panel)", padding: "1px 4px", borderRadius: 4, border: "1px solid var(--s-idle)44", fontWeight: 700 }}>{r.colaCount} en cola</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 600, color: r.status.color, background: `${r.status.color}12`, padding: "2px 5px", borderRadius: 6, textAlign: "center" }}>{r.status.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.trend > 0 ? "#0D9488" : r.trend < 0 ? "#EF4444" : "var(--faint)", textAlign: "right" }}>
                      {r.trend > 0 ? "▲" : r.trend < 0 ? "▼" : "—"}{r.trend !== 0 ? Math.abs(r.trend) : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Selected zone detail — prototype style */}
            {selectedZone && (() => {
              const z = zones.find((zz) => zz.code === selectedZone);
              if (!z) return null;
              const avg = zoneAverages[selectedZone] || 0;
              const st = getSatisfactionStatus(avg);
              const zoneSessions = sessions.filter((s) => s.zoneCode === selectedZone && s.endTime);
              const armadorIds = Array.from(new Set(zoneSessions.map((s) => s.armadorId)));
              const vals = hourlyProductivity[selectedZone] || [];
              const completedVals = vals.filter((v): v is number => v !== null);
              const prevVal = completedVals.length >= 2 ? completedVals[completedVals.length - 2] : avg;
              const lastVal = completedVals.length >= 1 ? completedVals[completedVals.length - 1] : avg;
              const delta = lastVal - prevVal;
              const totalTasks = zoneSessions.length;
              const totalErrors = Math.floor(totalTasks * 0.08);
              const errRate = totalTasks > 0 ? ((totalErrors / totalTasks) * 100).toFixed(1) : "0";
              const zColor = ZONE_COLORS[selectedZone] || "#94A3B2";
              const colaActual = getColaForZone(z).length;
              const armadoresActuales = getArmadoresForZone(z).length;

              return (
                <div style={{
                  marginTop: 12,
                  background: `radial-gradient(600px 300px at 100% 0%, ${zColor}16, transparent 60%), var(--surface, #fff)`,
                  border: "1px solid var(--hair, #e6e8df)", borderRadius: 20,
                  boxShadow: "0 2px 4px rgba(64,58,40,0.05), 0 22px 46px -20px rgba(64,58,40,0.30)",
                  overflow: "hidden",
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", minHeight: 0 }}>
                    {/* LEFT: Zone identity */}
                    <div style={{ padding: 24, borderRight: "1px solid var(--hair, #e6e8df)" }}>
                      <div style={{ fontSize: 12, color: "var(--faint, #9aa093)", marginBottom: 8 }}>Zona seleccionada</div>
                      <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 22, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 14, height: 14, borderRadius: "50%", background: zColor, flexShrink: 0 }} />
                        {selectedZone}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "14px 0 4px" }}>
                        <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 52, fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.02em", color: zColor }}>
                          {avg}<span style={{ fontSize: 20, color: "var(--faint, #9aa093)", fontWeight: 500 }}>%</span>
                        </span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
                            color: st.color, background: `${st.color}20`, padding: "4px 10px", borderRadius: 999,
                          }}>{st.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: delta > 0 ? "#3f9d6b" : delta < 0 ? "#c85c54" : "var(--faint, #9aa093)" }}>
                            {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} pts vs. hora previa` : "estable"}
                          </span>
                        </div>
                      </div>
                      {/* Mini sparkline */}
                      <div style={{ margin: "14px 0 12px" }}>
                        <ZoneSparkline zoneCode={selectedZone} hourlyData={hourlyProductivity} currentShiftIdx={currentShiftIdx} color={zColor} hoveredHour={hoveredHour} shiftHours={SHIFT_HOURS} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
                        {[
                          { k: "Tareas turno", v: String(totalTasks) },
                          { k: "Errores", v: `${totalErrors} `, sub: `(${errRate}%)` },
                          { k: "Prom. turno", v: `${avg}`, sub: "%" },
                          { k: "En cola ahora", v: String(colaActual) },
                          { k: "Armadores ahora", v: String(armadoresActuales) },
                        ].map((s) => (
                          <div key={s.k} style={{ background: "var(--soft, #fafaf5)", border: "1px solid var(--hair, #e6e8df)", borderRadius: 11, padding: "10px 11px" }}>
                            <div style={{ fontSize: 11, color: "var(--faint, #9aa093)" }}>{s.k}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 3 }}>{s.v}{s.sub && <small style={{ fontSize: 11, color: "var(--faint, #9aa093)", fontWeight: 500 }}>{s.sub}</small>}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* RIGHT: Armadores */}
                    <div style={{ padding: "22px 24px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                        <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 15, fontWeight: 600 }}>Armadores</span>
                        <span style={{ fontSize: 12, color: "var(--dim, #6b7266)" }}>mostrando <b style={{ color: zColor }}>{SHIFT_HOURS[hoveredHour ?? currentShiftIdx]}</b></span>
                      </div>
                      {armadorIds.length === 0 ? (
                        <div style={{ fontSize: 13, color: "var(--faint, #9aa093)", textAlign: "center", padding: 30 }}>Sin datos de armadores para esta zona</div>
                      ) : (
                        armadorIds.slice(0, 3).map((armId) => {
                          const arm = armadores.find((a) => a.id === armId);
                          const armSessions = zoneSessions.filter((s) => s.armadorId === armId);
                          const armAvgTime = armSessions.length > 0
                            ? armSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / armSessions.length / 60
                            : 0;
                          const armSat = armAvgTime > 0 ? Math.min(100, Math.round((15 / Math.max(armAvgTime, 1)) * 100)) : 0;
                          const armErr = Math.floor(armSessions.length * 0.08);
                          const armSt = getSatisfactionStatus(armSat);
                          return (
                            <div key={armId} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 14px", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--hair, #e6e8df)" }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                  <div style={{ width: 28, height: 28, borderRadius: 8, background: arm?.color || "var(--accent, #0D9488)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                                    {arm?.name?.charAt(0) || "?"}
                                  </div>
                                  <span style={{ fontSize: 14, fontWeight: 600 }}>{arm?.name || "—"}</span>
                                </div>
                                <div style={{ height: 8, background: "var(--paper-2, #eef1ea)", borderRadius: 999, overflow: "hidden" }}>
                                  <div style={{ width: `${armSat}%`, height: "100%", borderRadius: 999, background: armSt.color, transition: "width 0.4s" }} />
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 14, alignItems: "center", textAlign: "right" }}>
                                <div>
                                  <div style={{ fontSize: 18, fontWeight: 700, color: armSt.color }}>{armSat}%</div>
                                  <div style={{ fontSize: 10, color: "var(--faint, #9aa093)" }}>satisf.</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 16, fontWeight: 700 }}>{armSessions.length}</div>
                                  <div style={{ fontSize: 10, color: "var(--faint, #9aa093)" }}>tareas</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 16, fontWeight: 700, color: armErr > 2 ? "#c85c54" : "var(--ink, #2b302b)" }}>{armErr}</div>
                                  <div style={{ fontSize: 10, color: "var(--faint, #9aa093)" }}>errores</div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                      {/* Hour strip */}
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 11, color: "var(--faint, #9aa093)", marginBottom: 8 }}>Satisfacción hora a hora</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(11, 1fr)", gap: 5 }}>
                          {SHIFT_HOURS.map((label, i) => {
                            const v = hourlyProductivity[selectedZone]?.[i] ?? null;
                            const isEmpty = v === null || i > currentShiftIdx;
                            const isCurrent = i === (hoveredHour ?? currentShiftIdx);
                            return (
                              <div key={i} style={{
                                textAlign: "center", borderRadius: 9, padding: "7px 2px", cursor: isEmpty ? "default" : "pointer",
                                border: isCurrent ? `2px solid ${zColor}` : "1px solid var(--hair, #e6e8df)",
                                background: isEmpty ? "var(--soft, #fafaf5)" : `${st.color}18`,
                                transition: "transform 0.1s, box-shadow 0.15s",
                              }}>
                                <div style={{ fontSize: 9, color: "var(--faint, #9aa093)" }}>{label}</div>
                                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: isEmpty ? "var(--faint, #9aa093)" : st.color }}>
                                  {isEmpty ? "—" : v}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ANALYSIS SECTION */}
                  <ZoneAnalysis zoneCode={selectedZone} zoneColor={zColor} hourlyData={hourlyProductivity} currentShiftIdx={currentShiftIdx} sessions={sessions} armadores={armadores} />
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ─── BOTTOM: Charts + Ranking (only in fullscreen) ─── */}
      {isFs && analytics && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 16px 12px", flexShrink: 0 }}>
          <ChartView analytics={analytics} />
          <RankingView analytics={analytics} />
        </div>
      )}
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
  const H = 280;
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
    endLabels.push({ code: z, color: ZONE_COLORS[z] || "#94A3B2", x, y, ly: y, val });
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

  /* ─── Area fill for selected zone ─── */
  const selColor = selectedZone ? ZONE_COLORS[selectedZone] || "#94A3B2" : null;

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
            <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="var(--hair, #e6e8df)" strokeWidth={1} opacity={0.6} />
            <text x={pad.left - 8} y={y + 4} textAnchor="end" fill="var(--faint, #9aa093)" fontSize={11} fontFamily="var(--font, 'DM Sans', sans-serif)">{v}</text>
          </g>
        );
      })}

      {/* Hour labels */}
      {shiftHours.map((label: string, i: number) => {
        const x = getX(i);
        return (
          <text key={i} x={x} y={H - 10} textAnchor="middle" fill={i <= currentShiftIdx ? "var(--ink, #2b302b)" : "var(--faint, #9aa093)"}
            fontSize={11} fontWeight={i === currentShiftIdx ? 700 : 400} fontFamily="var(--font, 'DM Sans', sans-serif)">
            {label}
          </text>
        );
      })}

      {/* Hover guide line */}
      {hoveredHour !== null && (
        <line x1={getX(hoveredHour)} y1={pad.top} x2={getX(hoveredHour)} y2={H - pad.bottom}
          stroke="var(--hair-2, #dcdfd4)" strokeWidth={1.5} opacity={0.6} />
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
        const color = ZONE_COLORS[z] || "#94A3B2";
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

      {/* End-label connectors + dots */}
      {endLabels.map((e) => (
        <g key={e.code}>
          <line x1={e.x.toFixed(1)} y1={e.y.toFixed(1)} x2={(W - 8).toFixed(1)} y2={e.ly.toFixed(1)}
            stroke={e.color} strokeWidth={1.6} opacity={0.45} />
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
   CHART VIEW
   ═══════════════════════════════════════════════════════════════════════════════ */

function ChartView({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const maxTime = Math.max(...analytics.zones.map((z) => z.actualMinutes), 15, 1);
  const maxProd = Math.max(...analytics.zones.map((z) => z.totalProducts), 1);
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Análítica por zona</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, marginBottom: 4 }}>Tiempo vs Objetivo (15 min)</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, borderBottom: "1px solid var(--line)", position: "relative", height: 80 }}>
            <div style={{ position: "absolute", bottom: Math.round((15 / maxTime) * 100) + "%", left: 0, right: 0, borderTop: "2px dashed var(--accent)", opacity: 0.5 }} />
            {analytics.zones.slice(0, 20).map((z) => {
              const h = (z.actualMinutes / maxTime) * 100;
              const c = z.actualMinutes > 15 ? "#EF4444" : z.actualMinutes > 10 ? "#F59E0B" : "#16A34A";
              return (
                <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 6, fontWeight: 700 }}>{z.actualMinutes}</span>
                  <div style={{ width: "100%", height: `${h}%`, minHeight: 2, borderRadius: "2px 2px 0 0", background: c }} />
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, marginBottom: 4 }}>Productos por zona</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, borderBottom: "1px solid var(--line)", height: 80 }}>
            {analytics.zones.filter((z) => z.totalProducts > 0).sort((a, b) => b.totalProducts - a.totalProducts).slice(0, 12).map((z) => {
              const h = (z.totalProducts / maxProd) * 100;
              return (
                <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 6, fontWeight: 700 }}>{z.totalProducts}</span>
                  <div style={{ width: "100%", height: `${h}%`, minHeight: 2, borderRadius: "2px 2px 0 0", background: "linear-gradient(to top, #0E7C7B, #16A34A)" }} />
                </div>
              );
            })}
          </div>
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
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Ranking de zonas</div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {sorted.map((z, i) => (
          <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, marginBottom: 2, background: i < 3 ? "color-mix(in srgb, var(--accent) 5%, transparent)" : "transparent" }}>
            <span style={{ width: 20, fontSize: 10, fontWeight: 800, color: i === 0 ? "var(--accent)" : i === 1 ? "#16A34A" : i === 2 ? "#F59E0B" : "var(--faint)" }}>#{i + 1}</span>
            <span style={{ flex: 1, fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</span>
            <span style={{ width: 40, textAlign: "right", fontSize: 11, fontWeight: 700 }}>{z.score}</span>
            <div style={{ width: 50 }}>
              <div style={{ height: 4, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${z.efficiency}%`, height: "100%", background: z.efficiency >= 80 ? "#16A34A" : z.efficiency >= 50 ? "#F59E0B" : "#EF4444", borderRadius: 2 }} />
              </div>
            </div>
            <span style={{ width: 32, textAlign: "right", fontSize: 9, fontFamily: "var(--mono)", color: z.efficiency >= 80 ? "#16A34A" : "#EF4444" }}>{z.efficiency}%</span>
          </div>
        ))}
      </div>
    </div>
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
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 64, display: "block" }}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--hair-2, #dcdfd4)" strokeDasharray="3 4" />
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
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 64, display: "block" }}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} />
      {marker}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ZONE ANALYSIS — diagnoses zone health and recommends actions
   ═══════════════════════════════════════════════════════════════════════════════ */

function ZoneAnalysis({ zoneCode, zoneColor, hourlyData, currentShiftIdx, sessions, armadores: _armadores }: {
  zoneCode: string; zoneColor: string; hourlyData: Record<string, (number | null)[]>; currentShiftIdx: number;
  sessions: ScanSession[]; armadores: Armador[];
}) {
  const vals = hourlyData[zoneCode] || [];
  const completed = vals.map((v, i) => ({ v, i })).filter((e) => e.v !== null && e.i <= currentShiftIdx);
  if (completed.length === 0) return null;

  const last = completed[completed.length - 1];
  const prev = completed.length >= 2 ? completed[completed.length - 2] : null;
  const sat = last.v!;
  const delta = prev ? sat - prev.v! : null;

  const zoneSessions = sessions.filter((s) => s.zoneCode === zoneCode && s.endTime);
  const totalTasks = zoneSessions.length;
  const totalErrors = Math.floor(totalTasks * 0.08);
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
    <div style={{ borderTop: "1px solid var(--hair, #e6e8df)", padding: "20px 24px 22px", background: "var(--soft, #fafaf5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={zoneColor} strokeWidth={1.7}>
          <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4" />
        </svg>
        <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 16, fontWeight: 600 }}>Análisis y recomendaciones</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: sevColor, background: `${sevColor}22` }}>{sevLabel}</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--dim, #6b7266)", margin: "2px 0 14px" }}>
        {zoneCode} está en {sat}%{delta != null && delta !== 0 ? ` · ${delta > 0 ? "+" : ""}${delta} pts vs. hora previa` : ""}.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--faint, #9aa093)", marginBottom: 8 }}>Qué está pasando</div>
          {findings.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, padding: "4px 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flexShrink: 0, background: f.k === "bad" || f.k === "down" ? "#c85c54" : f.k === "warn" ? "#c98a2e" : f.k === "good" ? "#3f9d6b" : "#3e9ab0" }} />
              <span>{f.t}</span>
            </div>
          ))}
          {findings.length === 0 && <div style={{ fontSize: 13, color: "var(--dim, #6b7266)" }}>Sin hallazgos.</div>}
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--faint, #9aa093)", marginBottom: 8 }}>Qué puedes hacer</div>
          {recs.map((r, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              background: "var(--surface, #fff)", border: "1px solid var(--hair, #e6e8df)", borderRadius: 12,
              padding: "11px 13px", marginBottom: 8,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontWeight: 700, fontSize: 11, flexShrink: 0,
                background: r.level === "risk" ? "#c85c54" : r.level === "watch" ? "#c98a2e" : "#3f9d6b",
              }}>{i + 1}</span>
              <div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r.text}</div>
                {r.tag && <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, marginTop: 4, padding: "2px 7px", borderRadius: 999, color: "var(--dim, #6b7266)", background: "var(--paper-2, #eef1ea)" }}>{r.tag}</span>}
              </div>
            </div>
          ))}
          {recs.length === 0 && <div style={{ fontSize: 13, color: "var(--dim, #6b7266)" }}>Sin acciones sugeridas: la zona va bien.</div>}
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
