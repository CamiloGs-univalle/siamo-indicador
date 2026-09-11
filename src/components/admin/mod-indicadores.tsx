/**
 * @file components/admin/mod-indicadores.tsx
 * @description Dashboard profesional de indicadores de productividad.
 * Datos reales en tiempo real, gráficas CSS, análisis de tendencias.
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { I } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeActivity } from "@/lib/firestore";
import type { Zone, Armador, ActivityLogEntry } from "@/types";

export function ModIndicadores() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubAct = subscribeActivity(user.companyId, setActivity, 50);
    return () => { unsubZ(); unsubA(); unsubAct(); };
  }, [user?.companyId]);

  const m = useMemo(() => {
    const done = zones.filter((z) => z.status === "done");
    const inc = zones.filter((z) => z.status === "incident");
    const active = zones.filter((z) => z.status === "active");
    const assigned = zones.filter((z) => z.status === "assigned");
    const idle = zones.filter((z) => z.status === "idle");

    const completionRate = zones.length > 0 ? Math.round((done.length / zones.length) * 100) : 0;
    const avgTime = done.length > 0 ? Math.round(done.reduce((s, z) => s + (z.avgMinutes || 0), 0) / done.length) : 0;
    const totalProducts = zones.reduce((s, z) => s + (z.totalProducts || z.products?.length || 0), 0);
    const pickedProducts = done.reduce((s, z) => s + (z.totalProducts || z.products?.length || 0), 0);
    const withProd = armadores.filter((a) => a.prodH > 0);
    const avgProdH = withProd.length > 0 ? Math.round(withProd.reduce((s, a) => s + a.prodH, 0) / withProd.length) : 0;
    const totalProdH = withProd.reduce((s, a) => s + a.prodH, 0);
    const efficiency = avgTime > 0 ? Math.min(100, Math.round((15 / avgTime) * 100)) : 0;
    const quality = Math.max(0, 100 - inc.length * 5);
    const displacement = armadores.length > 0 ? Math.min(100, Math.round((active.length / Math.max(armadores.length, 1)) * 100 + 30)) : 0;
    const operationalIndex = Math.round((completionRate * 0.35 + efficiency * 0.25 + quality * 0.25 + displacement * 0.15));

    const zoneTimes = zones.filter((z) => z.status === "done" && z.avgMinutes).slice(0, 12).map((z) => ({
      code: z.code.replace(/^.*_/, ""),
      time: z.avgMinutes || 0,
      products: z.totalProducts || z.products?.length || 0,
    }));
    const maxTime = Math.max(...zoneTimes.map((z) => z.time), 1);

    const armadorStats = armadores.map((a) => ({
      name: a.name,
      color: a.color || "var(--accent)",
      prodH: a.prodH || 0,
      cumpl: a.cumpl || 0,
      inc: a.inc || 0,
      index: a.prodH ? Math.round(a.prodH / 10) : 0,
      zoneCount: zones.filter((z) => z.armadorId === a.id).length,
      doneCount: zones.filter((z) => z.armadorId === a.id && z.status === "done").length,
    })).sort((a, b) => b.prodH - a.prodH);
    const maxArmProd = Math.max(...armadorStats.map((a) => a.prodH), 1);

    const recentActivity = activity.slice(0, 8);

    return {
      zones, done, inc, active, assigned, idle, completionRate, avgTime,
      totalProducts, pickedProducts, avgProdH, totalProdH, efficiency,
      quality, displacement, operationalIndex, zoneTimes, maxTime,
      armadorStats, maxArmProd, recentActivity, totalZones: zones.length,
      doneCount: done.length, incCount: inc.length, activeCount: active.length,
      assignedCount: assigned.length, idleCount: idle.length,
    };
  }, [zones, armadores, activity]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando dashboard...</div>;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ═══ Executive Summary ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "20px 24px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Índice Operacional General</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span className="mono" style={{ fontSize: 48, fontWeight: 700, color: m.operationalIndex >= 70 ? "var(--s-done)" : m.operationalIndex >= 40 ? "var(--accent)" : "var(--s-not)" }}>{m.operationalIndex}</span>
            <span style={{ fontSize: 18, color: "var(--faint)" }}>/100</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          {[
            ["Velocidad", m.efficiency, "var(--accent)"],
            ["Cumplimiento", m.completionRate, "var(--s-done)"],
            ["Calidad", m.quality, m.quality >= 80 ? "var(--s-done)" : "var(--s-not)"],
            ["Desplazamiento", m.displacement, "var(--s-active)"],
          ].map(([n, v, c]) => (
            <div key={n} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--mut)", marginBottom: 2 }}>
                <span>{n}</span>
                <span className="mono" style={{ fontWeight: 600 }}>{v}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 20, background: "var(--panel2)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: v + "%", background: c, borderRadius: 20, transition: "width .6s ease" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ KPI Cards ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        {[
          { lab: "Zonas totales", val: m.totalZones, icon: <I.route width={16} height={16} />, accent: "var(--accent)", sub: `${m.doneCount} completadas` },
          { lab: "En progreso", val: m.activeCount, icon: <I.box width={16} height={16} />, accent: "var(--s-active)", sub: `${m.assignedCount} asignadas`, pulse: m.activeCount > 0 },
          { lab: "Productividad", val: m.avgProdH, unit: " p/h", icon: <I.trophy width={16} height={16} />, accent: "var(--gold)", sub: `${m.armadorStats.length} armadores` },
          { lab: "Tiempo promedio", val: m.avgTime, unit: " min", icon: <I.route width={16} height={16} />, accent: m.avgTime <= 15 ? "var(--s-done)" : "var(--s-not)", sub: `meta: 15 min/zona` },
          { lab: "Incidencias", val: m.incCount, icon: <I.route width={16} height={16} />, accent: "var(--s-inc)", sub: m.incCount > 0 ? "Requiere atención" : "Sin incidencias", down: m.incCount > 0 },
        ].map((k) => (
          <div key={k.lab} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: k.accent }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ color: k.accent, display: "grid", placeItems: "center" }}>{k.icon}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em" }}>{k.lab}</span>
              {k.pulse && <span className="live" style={{ marginLeft: "auto" }}><span className="pulse" /></span>}
            </div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: "var(--tx)" }}>{k.val}<span style={{ fontSize: 14, color: "var(--faint)" }}>{k.unit}</span></div>
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ═══ Charts Row ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Zone Performance Chart */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Rendimiento por zona</h3>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>Tiempo promedio (minutos)</span>
            </div>
            <span style={{ fontSize: 11, color: "var(--mut)" }}>Meta: 15 min</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 160, padding: "0 4px" }}>
            {m.zoneTimes.map((z) => {
              const pct = (z.time / m.maxTime) * 100;
              const overMeta = z.time > 15;
              return (
                <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span className="mono" style={{ fontSize: 10, color: overMeta ? "var(--s-not)" : "var(--faint)" }}>{z.time}</span>
                  <div style={{ width: "100%", height: `${Math.max(pct, 4)}%`, background: overMeta ? "linear-gradient(to top, var(--s-not), color-mix(in srgb, var(--s-not) 60%, transparent))" : "linear-gradient(to top, var(--accent), color-mix(in srgb, var(--accent) 60%, transparent))", borderRadius: "4px 4px 0 0", transition: "height .4s ease", minHeight: 4 }} />
                  <span className="mono" style={{ fontSize: 9, color: "var(--faint)" }}>{z.code}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Armador Productivity Chart */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Productividad por armador</h3>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>Unidades / hora</span>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {m.armadorStats.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Sin datos de productividad aún</div>
            ) : m.armadorStats.map((a, i) => (
              <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 16, textAlign: "right" }}>{i + 1}</span>
                <div style={{ width: 24, height: 24, borderRadius: 7, background: a.color, display: "grid", placeItems: "center", color: "#fff", fontSize: 11, fontWeight: 700, flex: "none" }}>{a.name[0]}</div>
                <span style={{ fontSize: 12, fontWeight: 500, width: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <div style={{ flex: 1, height: 8, background: "var(--panel2)", borderRadius: 20, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: (a.prodH / m.maxArmProd * 100) + "%", background: a.prodH >= 500 ? "var(--s-done)" : a.prodH >= 200 ? "var(--accent)" : "var(--s-active)", borderRadius: 20, transition: "width .4s ease" }} />
                </div>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, width: 40, textAlign: "right" }}>{a.prodH}</span>
                <span style={{ fontSize: 10, color: "var(--faint)" }}>p/h</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Zone Status Distribution ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>Distribución de estados</h3>
        <div style={{ display: "flex", gap: 4, height: 32, borderRadius: 8, overflow: "hidden" }}>
          {[
            { label: "Completadas", count: m.doneCount, color: "var(--s-done)" },
            { label: "En progreso", count: m.activeCount, color: "var(--s-active)" },
            { label: "Asignadas", count: m.assignedCount, color: "var(--s-assigned)" },
            { label: "Incidencias", count: m.incCount, color: "var(--s-inc)" },
            { label: "Sin asignar", count: m.idleCount, color: "var(--line)" },
          ].filter((s) => s.count > 0).map((s) => (
            <div key={s.label} style={{ width: (s.count / Math.max(m.totalZones, 1) * 100) + "%", background: s.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#fff", minWidth: s.count > 0 ? 30 : 0, transition: "width .4s ease" }}>
              {s.count}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
          {[
            { label: "Completadas", count: m.doneCount, color: "var(--s-done)" },
            { label: "En progreso", count: m.activeCount, color: "var(--s-active)" },
            { label: "Asignadas", count: m.assignedCount, color: "var(--s-assigned)" },
            { label: "Incidencias", count: m.incCount, color: "var(--s-inc)" },
            { label: "Sin asignar", count: m.idleCount, color: "var(--line)" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--mut)" }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              {s.label}: <span className="mono" style={{ fontWeight: 600 }}>{s.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Live Activity Feed ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Actividad en vivo</h3>
          <span className="live"><span className="pulse" />en vivo</span>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {m.recentActivity.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Sin actividad reciente</div>
          ) : m.recentActivity.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--panel2)", borderRadius: 8, fontSize: 12.5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: a.type.includes("scan") ? "var(--s-active)" : a.type.includes("picking") ? "var(--s-done)" : "var(--accent)", flex: "none" }} />
              <span style={{ flex: 1, color: "var(--tx)" }}>{a.message}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--faint)", flex: "none" }}>{formatTimeAgo(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "ahora";
  if (diff < 3600000) return `hace ${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `hace ${Math.floor(diff / 3600000)}h`;
  return `hace ${Math.floor(diff / 86400000)}d`;
}
