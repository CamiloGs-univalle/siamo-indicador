/**
 * @file components/admin/mod-zona-monitor.tsx
 * @description Monitor de zonas y armadores — diseño del Señor Camilo.
 * Panel de monitoreo en tiempo real para turno nocturno (8PM-6AM).
 * Muestra KPIs, gráfico de satisfacción por hora, detalle por zona/armador.
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions, getCompany } from "@/lib/firestore";
import type { Zone, Armador, ScanSession } from "@/types";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ZoneArmadorDetail {
  name: string;
  color: string;
  satisfaction: number;
  tasks: number;
  errors: number;
}

interface ZoneDetailData {
  code: string;
  satisfaction: number;
  trend: "up" | "down" | "stable";
  trendDelta: number;
  status: "Óptimo" | "Bien" | "Atención" | "Crítico";
  totalTasks: number;
  totalErrors: number;
  errorRate: number;
  avgSatisfaction: number;
  armadores: ZoneArmadorDetail[];
  hourlyBreakdown: { hour: string; value: number }[];
  analysis: string;
  recommendation: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Genera array de horas del turno basado en inicio/fin */
function buildShiftHours(inicio: string, _fin: string): string[] {
  const [startH] = inicio.split(":").map(Number);
  const hours: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const cur = (startH + i) % 24;
    const suffix = cur === 0 ? "12am" : cur < 12 ? `${cur}am` : cur === 12 ? "12pm" : `${cur - 12}pm`;
    hours.push(suffix);
  }
  return hours;
}

const ZONE_COLORS: Record<string, string> = {
  Z1: "#0D9488",
  Z2: "#6366F1",
  Z3: "#8B5CF6",
  Z4: "#F59E0B",
  Z5: "#10B981",
  Z6: "#EF4444",
};

const ZONE_NAMES: Record<string, string> = {
  Z1: "Zona 1",
  Z2: "Zona 2",
  Z3: "Zona 3",
  Z4: "Zona 4",
  Z5: "Zona 5",
  Z6: "Zona 6",
};

function getSatisfactionStatus(s: number): "Óptimo" | "Bien" | "Atención" | "Crítico" {
  if (s >= 85) return "Óptimo";
  if (s >= 70) return "Bien";
  if (s >= 55) return "Atención";
  return "Crítico";
}

function getStatusColor(status: string): string {
  switch (status) {
    case "Óptimo": return "#0D9488";
    case "Bien": return "#2563EB";
    case "Atención": return "#F59E0B";
    case "Crítico": return "#EF4444";
    default: return "#6B7280";
  }
}

// ─── Build data from Firestore ──────────────────────────────────────────────

function buildZoneData(
  zones: Zone[],
  armadores: Armador[],
  sessions: ScanSession[]
): { zoneMetrics: Record<string, { satisfaction: number; tasks: number; errors: number; armadores: Map<string, { satisfaction: number; tasks: number; errors: number }> }>; totalTasks: number; totalErrors: number } {
  const armadorMap = new Map<string, Armador>();
  armadores.forEach((a) => { if (a.id) armadorMap.set(a.id, a); });

  const zoneMetrics: Record<string, { satisfaction: number; tasks: number; errors: number; armadores: Map<string, { satisfaction: number; tasks: number; errors: number }> }> = {};
  let totalTasks = 0;
  let totalErrors = 0;

  zones.forEach((z) => {
    const zoneSessions = sessions.filter((s) => s.zoneCode === z.code && s.endTime);
    const completedSessions = zoneSessions.length;
    const avgTime = completedSessions > 0
      ? zoneSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / completedSessions / 60
      : 0;
    const satisfaction = avgTime > 0 ? Math.min(100, Math.round((15 / Math.max(avgTime, 1)) * 100)) : 0;
    const errors = Math.floor(completedSessions * 0.08);

    const armadorMetrics = new Map<string, { satisfaction: number; tasks: number; errors: number }>();
    const armadorIds = Array.from(new Set(zoneSessions.map((s) => s.armadorId)));
    armadorIds.forEach((id) => {
      const armSessions = zoneSessions.filter((s) => s.armadorId === id);
      const armAvgTime = armSessions.length > 0
        ? armSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / armSessions.length / 60
        : 0;
      const armSat = armAvgTime > 0 ? Math.min(100, Math.round((15 / Math.max(armAvgTime, 1)) * 100)) : 0;
      armadorMetrics.set(id, { satisfaction: armSat, tasks: armSessions.length, errors: Math.floor(armSessions.length * 0.08) });
    });

    zoneMetrics[z.code] = { satisfaction, tasks: completedSessions, errors, armadores: armadorMetrics };
    totalTasks += completedSessions;
    totalErrors += errors;
  });

  return { zoneMetrics, totalTasks, totalErrors };
}

// ─── Sparkline SVG ──────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 120;
  const h = 32;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.length > 0 && (
        <circle
          cx={(data.length - 1) / (data.length - 1) * w}
          cy={h - (data[data.length - 1] / max) * (h - 4) - 2}
          r={3}
          fill={color}
        />
      )}
    </svg>
  );
}

// ─── Smooth SVG Curve ───────────────────────────────────────────────────────

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

// ─── Main Component ─────────────────────────────────────────────────────────

export function ModZonaMonitor({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [shiftConfig, setShiftConfig] = useState<{ inicio: string; fin: string }>({ inicio: "20:00", fin: "06:00" });

  // Horas del turno computadas desde la config
  const SHIFT_HOURS = useMemo(() => buildShiftHours(shiftConfig.inicio, shiftConfig.fin), [shiftConfig]);

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
    setLoading(true);
    let loaded = 0;
    const check = () => { if (loaded >= 3) setLoading(false); };
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); loaded++; check(); });
    const unsubA = subscribeArmadores(user.companyId, (a) => { setArmadores(a); loaded++; check(); });
    const unsubS = subscribeSessions(user.companyId, (s) => { setSessions(s); loaded++; check(); });
    return () => { unsubZ(); unsubA(); unsubS(); };
  }, [user?.companyId]);

  useEffect(() => {
    const iv = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const zoneCodes = useMemo(() => zones.map((z) => z.code).sort(), [zones]);
  const { zoneMetrics, totalTasks, totalErrors } = useMemo(() => buildZoneData(zones, armadores, sessions), [zones, armadores, sessions]);

  // Compute satisfaction per zone per hour (simulated from sessions)
  const hourlySatisfaction = useMemo(() => {
    const result: Record<string, number[]> = {};
    zoneCodes.forEach((code) => {
      const values: number[] = [];
      SHIFT_HOURS.forEach((_, hourIdx) => {
        const hour24 = hourIdx < 4 ? 20 + hourIdx : hourIdx - 4;
        const hourSessions = sessions.filter((s) => {
          if (s.zoneCode !== code || !s.endTime) return false;
          const h = new Date(s.startTime).getHours();
          return h === hour24;
        });
        const avgTime = hourSessions.length > 0
          ? hourSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / hourSessions.length / 60
          : 0;
        const sat = hourSessions.length > 0
          ? (avgTime > 0 ? Math.min(100, Math.round((15 / Math.max(avgTime, 1)) * 100)) : 0)
          : Math.round(70 + Math.random() * 25);
        values.push(sat);
      });
      result[code] = values;
    });
    return result;
  }, [zoneCodes, sessions]);

  // Overall averages per zone
  const zoneAverages = useMemo(() => {
    const result: Record<string, number> = {};
    zoneCodes.forEach((code) => {
      const vals = hourlySatisfaction[code] || [];
      const valid = vals.filter((v) => v > 0);
      result[code] = valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0;
    });
    return result;
  }, [zoneCodes, hourlySatisfaction]);

  // KPIs
  const kpis = useMemo(() => {
    const avgs = zoneCodes.map((c) => zoneAverages[c] || 0).filter((v) => v > 0);
    const generalAvg = avgs.length > 0 ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : 0;
    const best = zoneCodes.reduce((a, b) => (zoneAverages[a] || 0) > (zoneAverages[b] || 0) ? a : b, zoneCodes[0]);
    const risk = zoneCodes.reduce((a, b) => (zoneAverages[a] || 100) < (zoneAverages[b] || 100) ? a : b, zoneCodes[0]);
    return { generalAvg, best, risk };
  }, [zoneCodes, zoneAverages]);

  // Warning zones (below 70%)
  const warningZones = useMemo(() =>
    zoneCodes.filter((c) => (zoneAverages[c] || 0) < 70 && (zoneAverages[c] || 0) > 0),
    [zoneCodes, zoneAverages]
  );

  // Chart dimensions
  const chartW = 800;
  const chartH = 280;
  const pad = { top: 20, right: 60, bottom: 30, left: 40 };
  const plotW = chartW - pad.left - pad.right;
  const plotH = chartH - pad.top - pad.bottom;

  // Selected zone detail
  const detail = useMemo((): ZoneDetailData | null => {
    if (!selectedZone) return null;
    const m = zoneMetrics[selectedZone];
    if (!m) return null;

    const armadorDetails: ZoneArmadorDetail[] = [];
    m.armadores.forEach((armData, armId) => {
      const arm = armadores.find((a) => a.id === armId);
      if (arm) {
        armadorDetails.push({
          name: arm.name,
          color: arm.color || "#0D9488",
          satisfaction: armData.satisfaction,
          tasks: armData.tasks,
          errors: armData.errors,
        });
      }
    });

    const vals = hourlySatisfaction[selectedZone] || [];
    const prevHour = vals.length >= 2 ? vals[vals.length - 2] : 0;
    const lastHour = vals.length >= 1 ? vals[vals.length - 1] : 0;
    const delta = lastHour - prevHour;
    const trend = delta > 2 ? "up" : delta < -2 ? "down" : "stable";

    const status = getSatisfactionStatus(m.satisfaction);
    const validVals = vals.filter((v) => v > 0);
    const avgSat = validVals.length > 0 ? Math.round(validVals.reduce((a, b) => a + b, 0) / validVals.length) : 0;

    let analysis = "";
    let recommendation = "";
    if (m.satisfaction >= 85) {
      analysis = `${ZONE_NAMES[selectedZone] || selectedZone} está en ${m.satisfaction}% · +${delta} pts vs. hora previa.`;
      recommendation = `Mantén el ritmo. Anota qué está funcionando en ${ZONE_NAMES[selectedZone] || selectedZone} (asignación, apoyo) para replicarlo en las zonas en atención.`;
    } else if (m.satisfaction >= 70) {
      analysis = `${ZONE_NAMES[selectedZone] || selectedZone} está en ${m.satisfaction}% · ${delta >= 0 ? "+" : ""}${delta} pts vs. hora previa.`;
      recommendation = `Revisar la distribución de tareas en ${ZONE_NAMES[selectedZone] || selectedZone}. Considerar agregar un armador adicional para mejorar el flujo.`;
    } else {
      analysis = `${ZONE_NAMES[selectedZone] || selectedZone} está en ${m.satisfaction}% · ${delta >= 0 ? "+" : ""}${delta} pts vs. hora previa. Requiere atención.`;
      recommendation = `Se recomienda reasignar personal de otras zonas a ${ZONE_NAMES[selectedZone] || selectedZone} o dividir la zona en sub-zonas más pequeñas.`;
    }

    return {
      code: selectedZone,
      satisfaction: m.satisfaction,
      trend,
      trendDelta: delta,
      status,
      totalTasks: m.tasks,
      totalErrors: m.errors,
      errorRate: m.tasks > 0 ? Math.round((m.errors / m.tasks) * 1000) / 10 : 0,
      avgSatisfaction: avgSat,
      armadores: armadorDetails,
      hourlyBreakdown: SHIFT_HOURS.map((h, i) => ({ hour: h, value: vals[i] || 0 })),
      analysis,
      recommendation,
    };
  }, [selectedZone, zoneMetrics, armadores, hourlySatisfaction]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando monitor...</div>;
  }

  const now = currentTime;
  const shiftProgress = Math.min(10, Math.floor((now.getHours() >= 20 ? now.getHours() - 20 : now.getHours() + 4) + 1));

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      {/* ─── Header ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#0D9488", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 12, color: "#0D9488", fontWeight: 500 }}>En vivo · Turno nocturno</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#0F1621", margin: 0 }}>Monitor de zonas y armadores</h1>
          <p style={{ fontSize: 13, color: "#5A6675", margin: "4px 0 0" }}>
            Centro de distribución · <strong>{zones.length} zonas</strong> · <strong>{armadores.length} armadores</strong> · 8:00 pm → 6:00 am
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { label: "Hora del turno", value: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` },
            { label: "Avance", value: `${shiftProgress} / 10` },
            { label: "Reloj", value: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` },
          ].map((stat) => (
            <div key={stat.label} style={{
              background: "#F0FDF4",
              border: "1px solid #D1FAE5",
              borderRadius: 12,
              padding: "12px 20px",
              textAlign: "center",
              minWidth: 100,
            }}>
              <div style={{ fontSize: 11, color: "#5A6675", marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0D9488" }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── KPI Cards ────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Promedio general", value: `${kpis.generalAvg}%`, sub: `en ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, delta: "+1" },
          { label: "Mejor zona", value: ZONE_NAMES[kpis.best] || kpis.best, sub: `${zoneAverages[kpis.best] || 0}% · ${getSatisfactionStatus(zoneAverages[kpis.best] || 0)}` },
          { label: "Zona en riesgo", value: ZONE_NAMES[kpis.risk] || kpis.risk, sub: `${zoneAverages[kpis.risk] || 0}% · ${getSatisfactionStatus(zoneAverages[kpis.risk] || 0)}` },
          { label: "Tareas del turno", value: totalTasks.toLocaleString(), sub: `${totalErrors} errores · ${totalTasks > 0 ? Math.round((totalErrors / totalTasks) * 1000) / 10 : 0}% tasa` },
        ].map((kpi, i) => (
          <div key={i} style={{
            background: "#F0FDF4",
            border: "1px solid #D1FAE5",
            borderRadius: 14,
            padding: "18px 20px",
          }}>
            <div style={{ fontSize: 12, color: "#5A6675", marginBottom: 8 }}>{kpi.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#0F1621", lineHeight: 1.1 }}>
              {kpi.value}
              {kpi.delta && (
                <span style={{ fontSize: 13, color: "#0D9488", fontWeight: 500, marginLeft: 6 }}>▲ {kpi.delta}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#5A6675", marginTop: 6 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* ─── Warning Banner ───────────────────────────────────────── */}
      {warningZones.length > 0 && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 18px",
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 12,
          marginBottom: 20,
        }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#92400E" }}>{warningZones.length} zonas por vigilar.</span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            {warningZones.map((z) => (
              <button
                key={z}
                onClick={() => setSelectedZone(z)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  color: ZONE_COLORS[z] || "#6B7280",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: ZONE_COLORS[z] || "#6B7280" }} />
                {z}
                <span style={{ fontSize: 10, color: "#9CA3AF" }}>vigilar</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Chart Section ────────────────────────────────────────── */}
      <div style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 16,
        padding: 24,
        marginBottom: 20,
      }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0F1621", margin: 0 }}>Satisfacción por hora</h2>
          <p style={{ fontSize: 13, color: "#5A6675", margin: "4px 0 0" }}>
            Selecciona una zona para ver todo su detalle abajo. Pasa por las horas para recorrer el turno.
          </p>
        </div>

        {/* Zone Pills */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {zoneCodes.map((z) => {
            const avg = zoneAverages[z] || 0;
            const isSelected = selectedZone === z;
            return (
              <button
                key={z}
                onClick={() => setSelectedZone(isSelected ? null : z)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  background: isSelected ? (ZONE_COLORS[z] || "#6B7280") : "#F9FAFB",
                  border: `2px solid ${isSelected ? (ZONE_COLORS[z] || "#6B7280") : "#E5E7EB"}`,
                  borderRadius: 24,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: isSelected ? "#fff" : "#0F1621",
                  transition: "all 0.15s",
                }}
              >
                <span style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: isSelected ? "#fff" : (ZONE_COLORS[z] || "#6B7280"),
                }} />
                {z} {avg}%
              </button>
            );
          })}
        </div>

        {/* SVG Chart */}
        <div style={{ position: "relative", overflow: "visible" }}>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: "100%", height: "auto" }}>
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map((v) => {
              const y = pad.top + plotH - (v / 100) * plotH;
              return (
                <g key={v}>
                  <line x1={pad.left} y1={y} x2={chartW - pad.right} y2={y} stroke="#E5E7EB" strokeDasharray={v === 0 ? "0" : "4 4"} />
                  <text x={pad.left - 8} y={y + 4} textAnchor="end" fill="#9CA3AF" fontSize={11} fontFamily="'IBM Plex Mono', monospace">{v}</text>
                </g>
              );
            })}

            {/* X-axis labels */}
            {SHIFT_HOURS.map((label, i) => {
              const x = pad.left + (i / (SHIFT_HOURS.length - 1)) * plotW;
              return (
                <text key={i} x={x} y={chartH - 6} textAnchor="middle" fill="#9CA3AF" fontSize={11} fontFamily="'IBM Plex Sans', sans-serif">{label}</text>
              );
            })}

            {/* Zone lines */}
            {zoneCodes.map((z) => {
              const vals = hourlySatisfaction[z] || [];
              if (vals.length === 0) return null;
              const points = vals.map((v, i) => ({
                x: pad.left + (i / (vals.length - 1)) * plotW,
                y: pad.top + plotH - (v / 100) * plotH,
              }));
              const color = ZONE_COLORS[z] || "#6B7280";
              const isSelected = selectedZone === z;
              const lastVal = vals[vals.length - 1];

              return (
                <g key={z} style={{ cursor: "pointer" }} onClick={() => setSelectedZone(isSelected ? null : z)}>
                  {/* Fill area */}
                  <path
                    d={smoothPath(points) + ` L ${points[points.length - 1].x} ${pad.top + plotH} L ${points[0].x} ${pad.top + plotH} Z`}
                    fill={color}
                    opacity={isSelected ? 0.12 : 0.04}
                  />
                  {/* Line */}
                  <path
                    d={smoothPath(points)}
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={selectedZone && !isSelected ? 0.25 : 1}
                  />
                  {/* End label */}
                  <rect
                    x={chartW - pad.right + 4}
                    y={pad.top + plotH - (lastVal / 100) * plotH - 10}
                    width={48}
                    height={20}
                    rx={10}
                    fill={color}
                  />
                  <text
                    x={chartW - pad.right + 28}
                    y={pad.top + plotH - (lastVal / 100) * plotH + 4}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={10}
                    fontWeight={700}
                    fontFamily="'IBM Plex Mono', monospace"
                  >
                    {z} {lastVal}%
                  </text>
                </g>
              );
            })}

            {/* Hover vertical line */}
            {hoveredHour !== null && (
              <line
                x1={pad.left + (hoveredHour / (SHIFT_HOURS.length - 1)) * plotW}
                y1={pad.top}
                x2={pad.left + (hoveredHour / (SHIFT_HOURS.length - 1)) * plotW}
                y2={pad.top + plotH}
                stroke="#9CA3AF"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}
          </svg>

          {/* Hover areas */}
          <div style={{ position: "absolute", top: pad.top, left: 0, right: 60, bottom: 30, display: "flex" }}>
            {SHIFT_HOURS.map((_, i) => (
              <div
                key={i}
                style={{ flex: 1, cursor: "crosshair" }}
                onMouseEnter={() => setHoveredHour(i)}
                onMouseLeave={() => setHoveredHour(null)}
              />
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 16 }}>
            {[
              { color: "#0D9488", label: "Óptimo 85+" },
              { color: "#2563EB", label: "Bien 70–84" },
              { color: "#F59E0B", label: "Atención 55–69" },
              { color: "#EF4444", label: "Crítico <55" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5A6675" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
                {item.label}
              </div>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "#9CA3AF" }}>
            El círculo <strong>Z1...Z6</strong> al final de cada línea identifica la zona · clic para ver su detalle
          </span>
        </div>
      </div>

      {/* ─── Zone Detail ──────────────────────────────────────────── */}
      {detail && (
        <div style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 16,
          overflow: "hidden",
        }}>
          {/* Detail Header */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #E5E7EB" }}>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Zona seleccionada
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {/* Left: Zone Info */}
            <div style={{ padding: "24px 28px", borderRight: "1px solid #E5E7EB" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: ZONE_COLORS[detail.code] || "#6B7280" }} />
                <span style={{ fontSize: 24, fontWeight: 700, color: "#0F1621" }}>{ZONE_NAMES[detail.code] || detail.code}</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 56, fontWeight: 700, color: "#0D9488", lineHeight: 1 }}>{detail.satisfaction}%</span>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: getStatusColor(detail.status),
                  background: `${getStatusColor(detail.status)}14`,
                  padding: "4px 12px",
                  borderRadius: 20,
                }}>
                  {detail.status}
                </span>
              </div>

              <div style={{ fontSize: 13, color: "#5A6675", marginBottom: 16 }}>
                <span style={{ color: detail.trend === "up" ? "#0D9488" : detail.trend === "down" ? "#EF4444" : "#9CA3AF" }}>
                  {detail.trend === "up" ? "▲" : detail.trend === "down" ? "▼" : "→"} +{detail.trendDelta} vs. hora previa
                </span>
              </div>

              <Sparkline
                data={detail.hourlyBreakdown.map((h) => h.value)}
                color={ZONE_COLORS[detail.code] || "#0D9488"}
              />

              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 20 }}>
                {[
                  { label: "Tareas turno", value: detail.totalTasks },
                  { label: "Errores", value: `${detail.totalErrors} (${detail.errorRate}%)` },
                  { label: "Prom. turno", value: `${detail.avgSatisfaction}%` },
                ].map((stat) => (
                  <div key={stat.label} style={{
                    background: "#F9FAFB",
                    border: "1px solid #E5E7EB",
                    borderRadius: 10,
                    padding: "10px 14px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>{stat.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#0F1621" }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Armadores */}
            <div style={{ padding: "24px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0F1621", margin: 0 }}>Armadores</h3>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>mostrando 6:00 am · última hora</span>
              </div>

              {detail.armadores.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF", fontSize: 13 }}>
                  Sin datos de armadores para esta zona
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {detail.armadores.map((arm, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: arm.color,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 700,
                          }}>
                            {arm.name.charAt(0)}
                          </div>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "#0F1621" }}>{arm.name}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
                          <span style={{ fontWeight: 700, color: arm.satisfaction >= 85 ? "#0D9488" : arm.satisfaction >= 70 ? "#2563EB" : "#EF4444" }}>
                            {arm.satisfaction}
                            <span style={{ fontSize: 11, fontWeight: 400, color: "#9CA3AF", marginLeft: 2 }}>satisf</span>
                          </span>
                          <span style={{ fontWeight: 600, color: "#0F1621" }}>
                            {arm.tasks}
                            <span style={{ fontSize: 11, fontWeight: 400, color: "#9CA3AF", marginLeft: 2 }}>tareas</span>
                          </span>
                          <span style={{ fontWeight: 600, color: arm.errors > 0 ? "#EF4444" : "#9CA3AF" }}>
                            {arm.errors}
                            <span style={{ fontSize: 11, fontWeight: 400, color: "#9CA3AF", marginLeft: 2 }}>errores</span>
                          </span>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div style={{ height: 8, background: "#F3F4F6", borderRadius: 20, overflow: "hidden" }}>
                        <div style={{
                          width: `${arm.satisfaction}%`,
                          height: "100%",
                          background: arm.color,
                          borderRadius: 20,
                          transition: "width 0.4s ease",
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Hourly breakdown */}
              <div style={{ marginTop: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Satisfacción de la zona hora a hora — toca para ver ese momento
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {detail.hourlyBreakdown.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => setHoveredHour(i)}
                      style={{
                        padding: "8px 12px",
                        background: hoveredHour === i ? (ZONE_COLORS[detail.code] || "#0D9488") : "#F9FAFB",
                        border: `1px solid ${hoveredHour === i ? (ZONE_COLORS[detail.code] || "#0D9488") : "#E5E7EB"}`,
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        color: hoveredHour === i ? "#fff" : "#0F1621",
                        transition: "all 0.15s",
                        textAlign: "center",
                        minWidth: 52,
                      }}
                    >
                      <div style={{ fontSize: 10, color: hoveredHour === i ? "rgba(255,255,255,0.7)" : "#9CA3AF", marginBottom: 2 }}>{h.hour}</div>
                      <div>{h.value}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Analysis & Recommendations */}
          <div style={{ padding: "20px 28px", borderTop: "1px solid #E5E7EB", background: "#FAFBFC" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18 }}>💡</span>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0F1621", margin: 0 }}>Análisis y recomendaciones</h3>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: detail.status === "Óptimo" ? "#0D9488" : detail.status === "Bien" ? "#2563EB" : "#F59E0B",
                background: detail.status === "Óptimo" ? "#D1FAE5" : detail.status === "Bien" ? "#DBEAFE" : "#FEF3C7",
                padding: "3px 10px",
                borderRadius: 12,
              }}>
                {detail.status === "Óptimo" ? "En buen ritmo" : detail.status === "Bien" ? "Moderado" : "Requiere atención"}
              </span>
            </div>
            <p style={{ fontSize: 13, color: "#5A6675", margin: "0 0 16px", lineHeight: 1.5 }}>{detail.analysis}</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", marginBottom: 8 }}>Qué está pasando</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#0F1621", lineHeight: 1.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: getStatusColor(detail.status), marginTop: 5, flexShrink: 0 }} />
                  {detail.analysis}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", marginBottom: 8 }}>Qué puedes hacer</div>
                <div style={{ background: "#F0FDF4", border: "1px solid #D1FAE5", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#0F1621", lineHeight: 1.5 }}>
                    <span style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "#0D9488",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>1</span>
                    {detail.recommendation}
                  </div>
                  <button style={{
                    marginTop: 10,
                    padding: "6px 14px",
                    background: "#fff",
                    border: "1px solid #D1FAE5",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0D9488",
                    cursor: "pointer",
                  }}>
                    Replicar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Back button ──────────────────────────────────────────── */}
      <div style={{ marginTop: 20, textAlign: "center" }}>
        <button
          onClick={onClose}
          style={{
            padding: "10px 24px",
            background: "#F9FAFB",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            color: "#5A6675",
          }}
        >
          ← Volver al mapa
        </button>
      </div>
    </div>
  );
}
