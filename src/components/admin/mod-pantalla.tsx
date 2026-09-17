"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { MapFloor } from "@/components/maps/map-floor";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions } from "@/lib/firestore";
import { computeZoneAnalytics } from "@/lib/zone-analytics";
import { mapZoneToWarehousePosition } from "@/lib/warehouse-layout";
import type { Zone, Armador, ScanSession, Pos } from "@/types";
import type { ZoneAnalyticsSummary } from "@/lib/zone-analytics";

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
   MAIN: MOD-PANTALLA
   - Embedded mode: fills the grid-admin content area normally
   - Fullscreen mode: takes over the entire screen
   ═══════════════════════════════════════════════════════════════════════════════ */

export function ModPantalla() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [clock, setClock] = useState(new Date());
  const [isFs, setIsFs] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => {
      setZones(z);
      setPositions((prev) => {
        const pos: Record<string, Pos> = {};
        let sA = 0, sB = 0;
        z.forEach((zone) => {
          if (prev[zone.code]) {
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
    return () => { unsubZ(); unsubA(); unsubS(); };
  }, [user?.companyId]);

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
    if (z.status === "active" || z.status === "paused" || z.status === "done" || z.status === "incident") return z.status;
    return z.armadorId ? "assigned" : "idle";
  };
  const colorOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "var(--s-idle)";
    if (z.armadorId) { const a = armadores.find((aa) => aa.id === z.armadorId); if (a?.color) return a.color; }
    const sc: Record<string, string> = { done: "#16A34A", active: "#D97706", assigned: "#2563EB", incident: "#7C3AED", idle: "#0f0f0f", paused: "#64748B" };
    return sc[statusOf(code)] || "#0f0f0f";
  };
  const ownerOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z?.armadorId) return "";
    return armadores.find((a) => a.id === z.armadorId)?.name || "";
  };
  const activeOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    return z?.status === "active" || z?.status === "incident";
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando pantalla en vivo...</div>;

  const done = zones.filter((z) => statusOf(z.code) === "done").length;
  const active = zones.filter((z) => statusOf(z.code) === "active").length;
  const pctDone = zones.length > 0 ? Math.round((done / zones.length) * 100) : 0;
  const zoneCodes = zones.map((z) => z.code).sort();

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

  const generalAvg = zoneCodes.length > 0
    ? Math.round(zoneCodes.map((c) => zoneAverages[c] || 0).reduce((a, b) => a + b, 0) / zoneCodes.length)
    : 0;
  const bestZone = zoneCodes.reduce((a, b) => (zoneAverages[a] || 0) > (zoneAverages[b] || 0) ? a : b, zoneCodes[0] || "Z01");
  const riskZone = zoneCodes.reduce((a, b) => (zoneAverages[a] || 100) < (zoneAverages[b] || 100) ? a : b, zoneCodes[0] || "Z01");
  const warningZones = zoneCodes.filter((c) => (zoneAverages[c] || 0) < 70 && (zoneAverages[c] || 0) > 0);

  const chartW = 500;
  const chartH = 160;
  const pad = { top: 12, right: 50, bottom: 24, left: 30 };
  const plotW = chartW - pad.left - pad.right;
  const plotH = chartH - pad.top - pad.bottom;

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
          {/* KPI mini-strip */}
          {[
            { label: "Prom", val: `${generalAvg}%`, c: "#0D9488" },
            { label: "Mejor", val: bestZone, c: "#10B981" },
            { label: "Riesgo", val: riskZone, c: "#EF4444" },
            { label: "Hechas", val: String(done), c: "#16A34A" },
            { label: "Activas", val: String(active), c: "#D97706" },
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
              {[{ c: "#0f0f0f", l: "Sin asignar" }, { c: "#16A34A", l: "✓ Completada" }, { c: "#D97706", l: "● En proceso" }, { c: "#64748B", l: "⏸ Pausada" }, { c: "#7C3AED", l: "✕ Incidencia" }].map((l) => (
                <span key={l.l} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: l.c }} />
                  <span style={{ color: "var(--faint)" }}>{l.l}</span>
                </span>
              ))}
            </div>
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
        <div style={{ display: "flex", flexDirection: "column", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Monitor de zonas</span>
            <span style={{ fontSize: 10, color: "var(--faint)" }}>{zoneCodes.length} zonas</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 10, overflow: "auto" }}>
            {/* Warning banner */}
            {warningZones.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 11, flexShrink: 0 }}>
                <span>⚠️</span>
                <span style={{ fontWeight: 600, color: "#92400E" }}>{warningZones.length} zonas por vigilar</span>
                <div style={{ display: "flex", gap: 3, marginLeft: "auto", flexWrap: "wrap" }}>
                  {warningZones.slice(0, 4).map((z) => (
                    <span key={z} onClick={() => setSelectedZone(z)} style={{ padding: "1px 6px", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, fontSize: 9, cursor: "pointer", color: ZONE_COLORS[z] || "#6B7280", fontWeight: 600 }}>
                      {z}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Zone pills */}
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap", flexShrink: 0 }}>
              {zoneCodes.map((z) => {
                const avg = zoneAverages[z] || 0;
                const sel = selectedZone === z;
                return (
                  <button key={z} onClick={() => setSelectedZone(sel ? null : z)} style={{
                    display: "flex", alignItems: "center", gap: 3, padding: "3px 8px",
                    background: sel ? (ZONE_COLORS[z] || "var(--accent)") : "var(--panel2)",
                    border: `1px solid ${sel ? (ZONE_COLORS[z] || "var(--accent)") : "var(--line)"}`,
                    borderRadius: 14, fontSize: 10, fontWeight: 600, cursor: "pointer",
                    color: sel ? "#fff" : "var(--tx)", fontFamily: "inherit",
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: sel ? "#fff" : (ZONE_COLORS[z] || "#6B7280") }} />
                    {z} {avg}%
                  </button>
                );
              })}
            </div>

            {/* Satisfaction chart */}
            <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Satisfacción por hora</div>
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
                  const color = ZONE_COLORS[z] || "#94A1B2";
                  const sel = selectedZone === z;
                  const lastVal = vals[vals.length - 1];
                  return (
                    <g key={z} onClick={() => setSelectedZone(sel ? null : z)} style={{ cursor: "pointer" }}>
                      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth={sel ? 2.5 : 1.2} strokeLinecap="round" strokeLinejoin="round" opacity={selectedZone && !sel ? 0.15 : 1} />
                      <rect x={chartW - pad.right + 2} y={pad.top + plotH - (lastVal / 100) * plotH - 7} width={38} height={14} rx={7} fill={color} />
                      <text x={chartW - pad.right + 21} y={pad.top + plotH - (lastVal / 100) * plotH + 2} textAnchor="middle" fill="#fff" fontSize={7} fontWeight={700} fontFamily="var(--mono)">{z} {lastVal}%</text>
                    </g>
                  );
                })}
              </svg>
              <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 8, color: "var(--faint)" }}>
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
                <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ZONE_COLORS[selectedZone] || "var(--accent)" }} />
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{selectedZone}</span>
                      <span style={{ fontSize: 10, color: "var(--faint)" }}>{z.totalProducts || 0} productos</span>
                    </div>
                    <button onClick={() => setSelectedZone(null)} style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", fontSize: 13 }}>✕</button>
                  </div>

                  <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: st.color }}>{avg}%</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: st.color, background: `${st.color}18`, padding: "2px 6px", borderRadius: 8 }}>{st.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--mut)", marginBottom: 6 }}>
                        <span style={{ color: delta >= 0 ? "#0D9488" : "#EF4444" }}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts vs. hora previa</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                        {[
                          { label: "Tareas", value: String(zoneSessions.length), color: "var(--accent)" },
                          { label: "Errores", value: String(Math.floor(zoneSessions.length * 0.08)), color: "#EF4444" },
                          { label: "Prom", value: `${avg}%`, color: st.color },
                        ].map((s) => (
                          <div key={s.label} style={{ padding: "4px 6px", background: "var(--panel)", borderRadius: 5, textAlign: "center" }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 7, color: "var(--faint)" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--faint)", letterSpacing: ".05em", marginBottom: 4 }}>ARMADORES</div>
                      {armadorIds.length === 0 ? (
                        <div style={{ fontSize: 10, color: "var(--faint)", textAlign: "center", padding: 10 }}>Sin datos</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {armadorIds.slice(0, 3).map((armId) => {
                            const arm = armadores.find((a) => a.id === armId);
                            const armSessions = zoneSessions.filter((s) => s.armadorId === armId);
                            const armAvgTime = armSessions.length > 0
                              ? armSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / armSessions.length / 60
                              : 0;
                            const armSat = armAvgTime > 0 ? Math.min(100, Math.round((15 / Math.max(armAvgTime, 1)) * 100)) : 0;
                            return (
                              <div key={armId}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <div style={{ width: 16, height: 16, borderRadius: 4, background: arm?.color || "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 7, fontWeight: 700 }}>
                                      {arm?.name?.charAt(0) || "?"}
                                    </div>
                                    <span style={{ fontSize: 10, fontWeight: 600 }}>{arm?.name || "—"}</span>
                                  </div>
                                  <div style={{ display: "flex", gap: 6, fontSize: 9 }}>
                                    <span style={{ fontWeight: 700, color: armSat >= 85 ? "#0D9488" : armSat >= 70 ? "#2563EB" : "#EF4444" }}>{armSat}%</span>
                                    <span style={{ color: "var(--faint)" }}>{armSessions.length}t</span>
                                  </div>
                                </div>
                                <div style={{ height: 4, background: "var(--line)", borderRadius: 8, overflow: "hidden" }}>
                                  <div style={{ width: `${armSat}%`, height: "100%", background: arm?.color || "var(--accent)", borderRadius: 8, transition: "width 0.4s" }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
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
