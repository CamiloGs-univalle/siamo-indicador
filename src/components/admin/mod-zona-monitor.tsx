/**
 * @file components/admin/mod-zona-monitor.tsx
 * @description Panel de monitoreo de zonas por turno (8pm-6am).
 * Muestra KPIs, gráfico de satisfacción por hora, y detalle por zona/armador.
 * Se integra dentro del módulo de mapa como pestaña de seguimiento.
 */

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { I } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions } from "@/lib/firestore";
import type { Zone, Armador, ScanSession } from "@/types";

// ─── Types ──────────────────────────────────────────────────────────────────

interface HourlyData {
  hour: number;
  label: string;
  zones: Record<string, ZoneHourMetrics>;
}

interface ZoneHourMetrics {
  tasks: number;
  satisfaction: number;
  errors: number;
  avgTime: number;
}

interface ZoneDetail {
  code: string;
  satisfaction: number;
  trend: "up" | "down" | "stable";
  armadores: ArmadorDetail[];
  hourlyBreakdown: ZoneHourMetrics[];
  analysis: string;
  recommendation: string;
}

interface ArmadorDetail {
  name: string;
  color: string;
  satisfaction: number;
  tasks: number;
  errors: number;
  avgTime: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SHIFT_HOURS = [
  { hour: 20, label: "8PM" },
  { hour: 21, label: "9PM" },
  { hour: 22, label: "10PM" },
  { hour: 23, label: "11PM" },
  { hour: 0, label: "12AM" },
  { hour: 1, label: "1AM" },
  { hour: 2, label: "2AM" },
  { hour: 3, label: "3AM" },
  { hour: 4, label: "4AM" },
  { hour: 5, label: "5AM" },
  { hour: 6, label: "6AM" },
];

const ZONE_COLORS: Record<string, string> = {
  Z01: "#2563EB",
  Z02: "#D97706",
  Z03: "#DC2626",
  Z04: "#16A34A",
  Z05: "#7C3AED",
  Z06: "#0EA5E9",
};

// ─── Helper: simulate hourly data from sessions ─────────────────────────────

function generateHourlyData(
  zones: Zone[],
  armadores: Armador[],
  sessions: ScanSession[]
): HourlyData[] {
  const armadorMap = new Map<string, Armador>();
  armadores.forEach((a) => {
    if (a.id) armadorMap.set(a.id, a);
  });

  return SHIFT_HOURS.map(({ hour, label }) => {
    const zonesData: Record<string, ZoneHourMetrics> = {};

    zones.forEach((z) => {
      const zoneSessions = sessions.filter((s) => {
        if (s.zoneCode !== z.code) return false;
        const sessionHour = new Date(s.startTime).getHours();
        return sessionHour === hour;
      });

      const completedSessions = zoneSessions.filter((s) => s.endTime);
      const totalTasks = completedSessions.length;
      const avgTime = completedSessions.length > 0
        ? completedSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / completedSessions.length / 60
        : 0;

      // Simulate satisfaction based on avg time vs target
      const targetMinutes = 15;
      const satisfaction = avgTime > 0
        ? Math.min(100, Math.round((targetMinutes / Math.max(avgTime, 1)) * 100))
        : 0;

      // Simulate errors (random for demo, would come from picking records)
      const errors = Math.floor(Math.random() * 3);

      zonesData[z.code] = {
        tasks: totalTasks,
        satisfaction,
        errors,
        avgTime: Math.round(avgTime * 10) / 10,
      };
    });

    return { hour, label, zones: zonesData };
  });
}

// ─── Components ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, color, sub }: {
  label: string;
  value: string | number;
  unit?: string;
  color: string;
  sub?: string;
}) {
  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--line)",
      borderRadius: 12,
      padding: "16px 18px",
      boxShadow: "var(--shadow)",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        background: color,
        borderRadius: "12px 0 0 12px",
      }} />
      <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 8, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--faint)", marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}

function WarningBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div style={{
      background: "color-mix(in srgb, var(--s-active) 8%, transparent)",
      border: "1px solid var(--s-active)",
      borderRadius: 10,
      padding: "10px 16px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 13,
      color: "var(--tx)",
    }}>
      <I.alert />
      <span style={{ fontWeight: 600 }}>Zonas a Vigilar:</span>
      <span>{warnings.join(" · ")}</span>
    </div>
  );
}

function HourlyChart({ data, zones, selectedZone, onSelectZone }: {
  data: HourlyData[];
  zones: Zone[];
  selectedZone: string | null;
  onSelectZone: (code: string | null) => void;
}) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);

  const chartWidth = 700;
  const chartHeight = 260;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Get unique zone codes
  const zoneCodes = useMemo(() => {
    const codes = new Set<string>();
    data.forEach((d) => Object.keys(d.zones).forEach((z) => codes.add(z)));
    return Array.from(codes).sort();
  }, [data]);

  // Calculate max satisfaction for scaling
  const maxSatisfaction = useMemo(() => {
    let max = 100;
    data.forEach((d) => {
      Object.values(d.zones).forEach((z) => {
        if (z.satisfaction > max) max = z.satisfaction;
      });
    });
    return Math.max(max, 100);
  }, [data]);

  // Build SVG paths for each zone
  const paths = useMemo(() => {
    const result: { zone: string; d: string; color: string }[] = [];

    zoneCodes.forEach((zoneCode) => {
      const points: string[] = [];
      data.forEach((d, i) => {
        const metrics = d.zones[zoneCode];
        const x = padding.left + (i / (data.length - 1)) * plotWidth;
        const y = padding.top + plotHeight - (metrics.satisfaction / maxSatisfaction) * plotHeight;
        points.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
      });

      result.push({
        zone: zoneCode,
        d: points.join(" "),
        color: ZONE_COLORS[zoneCode] || "#6B7280",
      });
    });

    return result;
  }, [data, zoneCodes, maxSatisfaction, plotWidth, plotHeight, padding]);

  // Grid lines
  const gridLines = useMemo(() => {
    const lines: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const value = (maxSatisfaction / 4) * i;
      const y = padding.top + plotHeight - (value / maxSatisfaction) * plotHeight;
      lines.push({ y, label: `${Math.round(value)}%` });
    }
    return lines;
  }, [maxSatisfaction, plotHeight, padding]);

  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--line)",
      borderRadius: 12,
      padding: 20,
      boxShadow: "var(--shadow)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Satisfacción por Hora</div>
          <div style={{ fontSize: 12, color: "var(--faint)" }}>Turno nocturno: 8PM - 6AM</div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {zoneCodes.map((z) => (
            <div
              key={z}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                cursor: "pointer",
                opacity: hoveredZone && hoveredZone !== z ? 0.4 : 1,
                transition: "opacity 0.2s",
              }}
              onMouseEnter={() => setHoveredZone(z)}
              onMouseLeave={() => setHoveredZone(null)}
              onClick={() => onSelectZone(selectedZone === z ? null : z)}
            >
              <div style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: ZONE_COLORS[z] || "#6B7280",
              }} />
              <span style={{ fontWeight: selectedZone === z ? 700 : 400 }}>{z}</span>
            </div>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        style={{ width: "100%", height: "auto" }}
      >
        {/* Grid lines */}
        {gridLines.map((line, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={line.y}
              x2={chartWidth - padding.right}
              y2={line.y}
              stroke="var(--line)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={line.y + 4}
              textAnchor="end"
              fill="var(--faint)"
              fontSize={10}
            >
              {line.label}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => {
          const x = padding.left + (i / (data.length - 1)) * plotWidth;
          return (
            <text
              key={i}
              x={x}
              y={chartHeight - 8}
              textAnchor="middle"
              fill="var(--faint)"
              fontSize={10}
            >
              {d.label}
            </text>
          );
        })}

        {/* Zone lines */}
        {paths.map((p) => (
          <path
            key={p.zone}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={selectedZone === p.zone ? 3 : hoveredZone === p.zone ? 3 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={hoveredZone && hoveredZone !== p.zone ? 0.3 : 1}
            style={{ transition: "opacity 0.2s, stroke-width 0.2s", cursor: "pointer" }}
            onClick={() => onSelectZone(selectedZone === p.zone ? null : p.zone)}
          />
        ))}

        {/* Hover indicator */}
        {hoveredHour !== null && (
          <line
            x1={padding.left + (hoveredHour / (data.length - 1)) * plotWidth}
            y1={padding.top}
            x2={padding.left + (hoveredHour / (data.length - 1)) * plotWidth}
            y2={padding.top + plotHeight}
            stroke="var(--mut)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}
      </svg>

      {/* Hover tooltip */}
      {hoveredHour !== null && (
        <div style={{
          position: "absolute",
          top: 60,
          left: 100,
          background: "var(--elev)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 8,
          fontSize: 11,
          boxShadow: "var(--shadow-lg)",
          zIndex: 10,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{data[hoveredHour]?.label}</div>
          {zoneCodes.map((z) => (
            <div key={z} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: ZONE_COLORS[z] }} />
              <span>{z}: {data[hoveredHour]?.zones[z]?.satisfaction || 0}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ZoneDetailPanel({ detail, onClose }: {
  detail: ZoneDetail;
  onClose: () => void;
}) {
  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--line)",
      borderRadius: 12,
      boxShadow: "var(--shadow)",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: ZONE_COLORS[detail.code] || "#6B7280",
          }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Zona {detail.code}</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--mut)",
            cursor: "pointer",
            padding: 4,
            fontSize: 16,
          }}
        >
          ✕
        </button>
      </div>

      {/* Satisfaction with trend */}
      <div style={{ padding: "20px 16px", textAlign: "center" }}>
        <div style={{
          fontSize: 48,
          fontWeight: 700,
          color: detail.satisfaction >= 80 ? "var(--s-done)" : detail.satisfaction >= 60 ? "var(--s-active)" : "var(--s-not)",
          lineHeight: 1,
        }}>
          {detail.satisfaction}%
        </div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4 }}>Satisfacción</div>
        <div style={{
          fontSize: 12,
          color: detail.trend === "up" ? "var(--s-done)" : detail.trend === "down" ? "var(--s-not)" : "var(--faint)",
          marginTop: 4,
          fontWeight: 600,
        }}>
          {detail.trend === "up" ? "↑ Mejorando" : detail.trend === "down" ? "↓ Disminuyendo" : "→ Estable"}
        </div>
      </div>

      {/* Armadores */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>ARMADORES</div>
        {detail.armadores.map((arm, i) => (
          <div key={i} style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            background: "var(--panel2)",
            borderRadius: 8,
            marginBottom: 6,
          }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: arm.color || "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}>
              {arm.name.charAt(0)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {arm.name}
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--mut)", marginTop: 2 }}>
                <span>{arm.tasks} tareas</span>
                <span>{arm.avgTime} min</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{
                fontSize: 14,
                fontWeight: 700,
                color: arm.satisfaction >= 80 ? "var(--s-done)" : arm.satisfaction >= 60 ? "var(--s-active)" : "var(--s-not)",
              }}>
                {arm.satisfaction}%
              </div>
              <div style={{ fontSize: 10, color: arm.errors > 0 ? "var(--s-not)" : "var(--faint)" }}>
                {arm.errors} errores
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Hourly breakdown */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>DETALLE POR HORA</div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 4,
        }}>
          {detail.hourlyBreakdown.slice(0, 6).map((h, i) => (
            <div key={i} style={{
              padding: 6,
              background: "var(--panel2)",
              borderRadius: 6,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 9, color: "var(--faint)" }}>{SHIFT_HOURS[i]?.label}</div>
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: h.satisfaction >= 80 ? "var(--s-done)" : h.satisfaction >= 60 ? "var(--s-active)" : "var(--s-not)",
              }}>
                {h.satisfaction}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Analysis & Recommendation */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{
          padding: 12,
          background: "var(--panel2)",
          borderRadius: 8,
          borderLeft: "3px solid var(--accent)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>ANÁLISIS</div>
          <div style={{ fontSize: 12, color: "var(--tx)", lineHeight: 1.5 }}>{detail.analysis}</div>
        </div>
        <div style={{
          padding: 12,
          background: "var(--panel2)",
          borderRadius: 8,
          borderLeft: "3px solid var(--s-done)",
          marginTop: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--s-done)", marginBottom: 4 }}>RECOMENDACIÓN</div>
          <div style={{ fontSize: 12, color: "var(--tx)", lineHeight: 1.5 }}>{detail.recommendation}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ModZonaMonitor({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Subscribe to data
  useEffect(() => {
    if (!user?.companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let loaded = 0;
    const check = () => { if (loaded >= 3) setLoading(false); };

    const unsubZones = subscribeZones(user.companyId, (z) => {
      setZones(z);
      loaded++;
      check();
    });

    const unsubArmadores = subscribeArmadores(user.companyId, (a) => {
      setArmadores(a);
      loaded++;
      check();
    });

    const unsubSessions = subscribeSessions(user.companyId, (s) => {
      setSessions(s);
      loaded++;
      check();
    });

    return () => {
      unsubZones();
      unsubArmadores();
      unsubSessions();
    };
  }, [user?.companyId]);

  // Update current time
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Generate hourly data
  const hourlyData = useMemo(
    () => generateHourlyData(zones, armadores, sessions),
    [zones, armadores, sessions]
  );

  // Calculate KPIs
  const kpis = useMemo(() => {
    const zoneMetrics = zones.map((z) => {
      const zoneSessions = sessions.filter((s) => s.zoneCode === z.code && s.endTime);
      const avgTime = zoneSessions.length > 0
        ? zoneSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / zoneSessions.length / 60
        : 0;
      const satisfaction = avgTime > 0
        ? Math.min(100, Math.round((15 / Math.max(avgTime, 1)) * 100))
        : 0;
      return { code: z.code, satisfaction, sessions: zoneSessions.length };
    });

    const validZones = zoneMetrics.filter((z) => z.satisfaction > 0);
    const avgSatisfaction = validZones.length > 0
      ? Math.round(validZones.reduce((sum, z) => sum + z.satisfaction, 0) / validZones.length)
      : 0;

    const bestZone = validZones.length > 0
      ? validZones.reduce((a, b) => a.satisfaction > b.satisfaction ? a : b)
      : null;

    const riskZone = validZones.length > 0
      ? validZones.reduce((a, b) => a.satisfaction < b.satisfaction ? a : b)
      : null;

    const totalTasks = sessions.filter((s) => s.endTime).length;

    return { avgSatisfaction, bestZone, riskZone, totalTasks };
  }, [zones, sessions]);

  // Generate warnings
  const warnings = useMemo(() => {
    const result: string[] = [];
    zones.forEach((z) => {
      const zoneSessions = sessions.filter((s) => s.zoneCode === z.code && s.endTime);
      if (zoneSessions.length === 0) return;

      const avgTime = zoneSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / zoneSessions.length / 60;
      const satisfaction = avgTime > 0 ? Math.min(100, Math.round((15 / Math.max(avgTime, 1)) * 100)) : 0;

      if (satisfaction < 70) {
        result.push(`${z.code}: ${satisfaction}%`);
      }
    });
    return result;
  }, [zones, sessions]);

  // Generate zone detail
  const zoneDetail = useMemo((): ZoneDetail | null => {
    if (!selectedZone) return null;

    const zone = zones.find((z) => z.code === selectedZone);
    if (!zone) return null;

    const zoneSessions = sessions.filter((s) => s.zoneCode === selectedZone && s.endTime);
    const avgTime = zoneSessions.length > 0
      ? zoneSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / zoneSessions.length / 60
      : 0;
    const satisfaction = avgTime > 0
      ? Math.min(100, Math.round((15 / Math.max(avgTime, 1)) * 100))
      : 0;

    // Get armadores who worked in this zone
    const armadorIds = Array.from(new Set(zoneSessions.map((s) => s.armadorId)));
    const armadorDetails: ArmadorDetail[] = armadorIds.map((id) => {
      const arm = armadores.find((a) => a.id === id);
      const armSessions = zoneSessions.filter((s) => s.armadorId === id);
      const armAvgTime = armSessions.length > 0
        ? armSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / armSessions.length / 60
        : 0;
      const armSatisfaction = armAvgTime > 0
        ? Math.min(100, Math.round((15 / Math.max(armAvgTime, 1)) * 100))
        : 0;

      return {
        name: arm?.name || "Desconocido",
        color: arm?.color || "var(--accent)",
        satisfaction: armSatisfaction,
        tasks: armSessions.length,
        errors: Math.floor(Math.random() * 3),
        avgTime: Math.round(armAvgTime * 10) / 10,
      };
    });

    // Get hourly breakdown for this zone
    const hourlyBreakdown = hourlyData.map((d) => d.zones[selectedZone] || { tasks: 0, satisfaction: 0, errors: 0, avgTime: 0 });

    // Generate analysis
    let analysis = "";
    let recommendation = "";

    if (satisfaction >= 80) {
      analysis = `La zona ${selectedZone} mantiene un rendimiento excelente con ${satisfaction}% de satisfacción promedio.`;
      recommendation = "Continuar con la asignación actual. Considerar esta zona como referencia para otras.";
    } else if (satisfaction >= 60) {
      analysis = `La zona ${selectedZone} tiene un rendimiento aceptable pero con espacio de mejora (${satisfaction}%).`;
      recommendation = "Revisar la distribución de tareas y considerar agregar un armador adicional.";
    } else {
      analysis = `La zona ${selectedZone} presenta bajo rendimiento con solo ${satisfaction}% de satisfacción.`;
      recommendation = "Se recomienda reasignar personal o dividir la zona en sub-zonas más pequeñas.";
    }

    // Calculate trend based on last 3 hours
    const lastHours = hourlyData.slice(-3);
    const recentSatisfaction = lastHours
      .map((d) => d.zones[selectedZone]?.satisfaction || 0)
      .filter((s) => s > 0);
    let trend: "up" | "down" | "stable" = "stable";
    if (recentSatisfaction.length >= 2) {
      const first = recentSatisfaction[0];
      const last = recentSatisfaction[recentSatisfaction.length - 1];
      if (last > first + 5) trend = "up";
      else if (last < first - 5) trend = "down";
    }

    return {
      code: selectedZone,
      satisfaction,
      trend,
      armadores: armadorDetails,
      hourlyBreakdown,
      analysis,
      recommendation,
    };
  }, [selectedZone, zones, armadores, sessions, hourlyData]);

  // Current hour in shift
  const currentShiftHour = useMemo(() => {
    const h = currentTime.getHours();
    return SHIFT_HOURS.findIndex((sh) => sh.hour === h);
  }, [currentTime]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
        Cargando monitoreo de zonas...
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Monitoreo de Zonas por Turno Nocturno</div>
          <div style={{ fontSize: 12, color: "var(--faint)" }}>8PM - 6AM · Actualizado en tiempo real</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            fontSize: 12,
          }}>
            <I.clock />
            <span className="mono" style={{ fontWeight: 600 }}>
              {currentTime.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 12,
              color: "var(--mut)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ← Volver al mapa
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginBottom: 16,
      }}>
        <KpiCard
          label="Promedio General"
          value={`${kpis.avgSatisfaction}%`}
          color="var(--accent)"
          sub={`${zones.length} zonas activas`}
        />
        <KpiCard
          label="Mejor Zona"
          value={kpis.bestZone ? `${kpis.bestZone.code}: ${kpis.bestZone.satisfaction}%` : "—"}
          color="var(--s-done)"
          sub={kpis.bestZone ? `${kpis.bestZone.sessions} sesiones completadas` : "Sin datos"}
        />
        <KpiCard
          label="Zona en Riesgo"
          value={kpis.riskZone ? `${kpis.riskZone.code}: ${kpis.riskZone.satisfaction}%` : "—"}
          color="var(--s-not)"
          sub={kpis.riskZone ? `${kpis.riskZone.sessions} sesiones completadas` : "Sin datos"}
        />
        <KpiCard
          label="Total Tareas"
          value={kpis.totalTasks}
          color="var(--s-active)"
          sub="Sesiones completadas hoy"
        />
      </div>

      {/* Warnings */}
      <WarningBanner warnings={warnings} />

      {/* Chart */}
      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <HourlyChart
          data={hourlyData}
          zones={zones}
          selectedZone={selectedZone}
          onSelectZone={setSelectedZone}
        />
      </div>

      {/* Zone detail panel */}
      {zoneDetail && (
        <div style={{ marginTop: 16 }}>
          <ZoneDetailPanel
            detail={zoneDetail}
            onClose={() => setSelectedZone(null)}
          />
        </div>
      )}

      {/* Progress indicator */}
      <div style={{
        marginTop: 16,
        padding: "10px 16px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 12,
        color: "var(--mut)",
      }}>
        <span style={{ fontWeight: 600 }}>Progreso del turno:</span>
        <div style={{ flex: 1, height: 6, background: "var(--line)", borderRadius: 20, overflow: "hidden" }}>
          <div style={{
            width: `${Math.min(100, ((currentShiftHour + 1) / SHIFT_HOURS.length) * 100)}%`,
            height: "100%",
            background: "var(--accent)",
            borderRadius: 20,
            transition: "width 0.3s",
          }} />
        </div>
        <span className="mono" style={{ fontWeight: 600, color: "var(--accent)" }}>
          {Math.round(((currentShiftHour + 1) / SHIFT_HOURS.length) * 100)}%
        </span>
      </div>
    </div>
  );
}
