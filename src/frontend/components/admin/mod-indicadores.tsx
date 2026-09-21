/**
 * @file components/admin/mod-indicadores.tsx
 * @description Dashboard de indicadores de productividad — diseño operacional profesional.
 * Gauge chart SVG, factores del índice, recomendaciones, KPIs, tiempos
 * operativos con distribuciones, tendencias, rendimiento por zona/armador,
 * y distribución de estados. Todos los datos son reales (Firestore).
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeZones, subscribeArmadores, subscribeActivity } from "@/frontend/services/firestore";
import type { Zone, Armador, ActivityLogEntry } from "@/types";
import { computeCompanyAnalytics, formatDuration, formatDayLabel } from "@/frontend/services/analytics";

export function ModIndicadores() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [recExpanded, setRecExpanded] = useState(false);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubAct = subscribeActivity(user.companyId, setActivity, 2000);
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
    const withProd = armadores.filter((a) => a.prodH > 0);
    const avgProdH = withProd.length > 0 ? Math.round(withProd.reduce((s, a) => s + a.prodH, 0) / withProd.length) : 0;
    const efficiency = avgTime > 0 ? Math.min(100, Math.round((15 / avgTime) * 100)) : 0;
    const quality = Math.max(0, 100 - inc.length * 5);
    const displacement = armadores.length > 0 ? Math.min(100, Math.round((active.length / Math.max(armadores.length, 1)) * 100 + 30)) : 0;
    const operationalIndex = Math.round(completionRate * 0.35 + efficiency * 0.25 + quality * 0.25 + displacement * 0.15);

    const armadorStats = armadores.map((a) => ({
      name: a.name,
      color: a.color || "var(--accent)",
      prodH: a.prodH || 0,
      zoneCount: zones.filter((z) => z.armadorId === a.id).length,
      doneCount: zones.filter((z) => z.armadorId === a.id && z.status === "done").length,
    })).sort((a, b) => b.prodH - a.prodH);
    const maxArmProd = Math.max(...armadorStats.map((a) => a.prodH), 1);

    return {
      zones, done, inc, active, assigned, idle, completionRate, avgTime,
      avgProdH, efficiency, quality, displacement, operationalIndex,
      armadorStats, maxArmProd, totalZones: zones.length,
      doneCount: done.length, incCount: inc.length, activeCount: active.length,
      assignedCount: assigned.length, idleCount: idle.length,
    };
  }, [zones, armadores]);

  const analytics = useMemo(() => computeCompanyAnalytics(activity, armadores), [activity, armadores]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando dashboard...</div>;

  const idx = m.operationalIndex;
  const idxColor = idx >= 70 ? "var(--green)" : idx >= 40 ? "var(--amber)" : "var(--red)";
  const idxLabel = idx >= 70 ? "Rendimiento alto" : idx >= 40 ? "Rendimiento medio" : "Rendimiento bajo";
  const idxStatusClass = idx >= 70 ? "ok" : idx >= 40 ? "warn" : "bad";

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* ═══ HERO: Gauge + Drivers ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18 }}>
        {/* Gauge Card */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: ".02em" }}>Índice operacional general</div>
          <div style={{ position: "relative", width: 220, height: 150, marginTop: 2 }}>
            <svg width="220" height="150" viewBox="0 0 220 150">
              <path d="M18 138 A92 92 0 0 1 202 138" fill="none" stroke="var(--inset)" strokeWidth="16" strokeLinecap="round" />
              <path d="M18 138 A92 92 0 0 1 202 138" fill="none" stroke="var(--red)" strokeWidth="4" strokeLinecap="round" opacity=".25" strokeDasharray="115.6 289.1" />
              <path d="M18 138 A92 92 0 0 1 202 138" fill="none" stroke="var(--amber)" strokeWidth="4" strokeLinecap="round" opacity=".25" strokeDasharray="86.7 289.1" strokeDashoffset="-115.6" />
              <path d="M18 138 A92 92 0 0 1 202 138" fill="none" stroke="var(--green)" strokeWidth="4" strokeLinecap="round" opacity=".25" strokeDasharray="86.7 289.1" strokeDashoffset="-202.4" />
              <path d="M18 138 A92 92 0 0 1 202 138" fill="none" stroke={idxColor} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${(idx / 100) * 289.1} 289.1`} style={{ transition: "stroke-dasharray 1.3s cubic-bezier(.16,1,.3,1)" }} />
            </svg>
            <div style={{ position: "absolute", left: 0, right: 0, top: 56, textAlign: "center" }}>
              <div className="num" style={{ fontSize: 52, fontWeight: 700, lineHeight: 1, letterSpacing: "-.03em" }}>{idx}</div>
              <div className="num" style={{ fontSize: 15, color: "var(--muted)", fontWeight: 600 }}>/ 100</div>
            </div>
          </div>
          <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 999, color: idxColor, background: idx >= 70 ? "rgba(31,157,84,.13)" : idx >= 40 ? "rgba(239,154,21,.15)" : "rgba(226,60,88,.12)" }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              {idx < 40 ? <><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z"/></> :
               idx < 70 ? <><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></> :
               <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></>}
            </svg>
            {idxLabel}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 12, fontSize: 10.5, color: "var(--muted)" }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 5, verticalAlign: "middle", background: "var(--red)" }} />0–40</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 5, verticalAlign: "middle", background: "var(--amber)" }} />40–70</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 5, verticalAlign: "middle", background: "var(--green)" }} />70–100</span>
          </div>
          <div style={{ marginTop: 14, background: "var(--inset)", border: "1px solid var(--line)", borderRadius: 11, padding: "11px 13px", textAlign: "left", width: "100%" }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>Qué frena el índice</div>
            <p style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45 }}>
              {m.efficiency < 30 && m.completionRate < 30 ? (
                <><b style={{ color: "var(--red)" }}>Velocidad y Cumplimiento bajos.</b> Suben en cuanto el equipo empiece a cerrar zonas. Calidad ya está en meta.</>
              ) : m.efficiency < 50 ? (
                <><b style={{ color: "var(--red)" }}>Velocidad baja.</b> El tiempo promedio por zona está por encima de la meta de 15 min.</>
              ) : m.completionRate < 50 ? (
                <><b style={{ color: "var(--red)" }}>Cumplimiento bajo.</b> Solo {m.doneCount} de {m.totalZones} zonas completadas.</>
              ) : m.incCount > 0 ? (
                <><b style={{ color: "var(--amber)" }}>{m.incCount} incidencias</b> reducen la calidad. Revisar para mejorar el índice.</>
              ) : (
                <><b style={{ color: "var(--green)" }}>Todos los factores en rango saludable.</b> Mantener el estándar actual.</>
              )}
            </p>
          </div>
        </div>

        {/* Drivers Card */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 2 }}>Factores del índice</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginBottom: 12 }}>Cada factor pondera el puntaje general. El color indica si aporta o resta.</div>
          {([
            { name: "Velocidad", val: m.efficiency, icon: "⚡", color: "var(--red)", softBg: "rgba(226,60,88,.12)" },
            { name: "Cumplimiento", val: m.completionRate, icon: "✓", color: "var(--red)", softBg: "rgba(226,60,88,.12)" },
            { name: "Calidad", val: m.quality, icon: "★", color: "var(--green)", softBg: "rgba(31,157,84,.13)" },
            { name: "Desplazamiento", val: m.displacement, icon: "📍", color: "var(--amber-deep)", softBg: "rgba(239,154,21,.15)" },
          ]).map((d) => {
            const badge = d.val >= 70 ? { label: "En meta", cls: "ok", color: "var(--green)" } :
                          d.val >= 40 ? { label: "Mejorable", cls: "warn", color: "var(--amber-deep)" } :
                          { label: "Crítico", cls: "bad", color: "var(--red)" };
            return (
              <div key={d.name} style={{ padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 600, fontSize: 13 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: d.softBg, color: d.color, fontSize: 14 }}>{d.icon}</span>
                    {d.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: badge.color, background: badge.cls === "ok" ? "rgba(31,157,84,.13)" : badge.cls === "warn" ? "rgba(239,154,21,.15)" : "rgba(226,60,88,.12)" }}>{badge.label}</span>
                    <span className="num" style={{ fontWeight: 700, fontSize: 15, color: badge.color }}>{d.val}%</span>
                  </div>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "var(--inset)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${d.val}%`, background: `linear-gradient(90deg, ${badge.color}, ${badge.color}dd)`, transition: "width 1.1s cubic-bezier(.16,1,.3,1)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ RECOMENDACIONES ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
        <div
          onClick={() => setRecExpanded(!recExpanded)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRecExpanded(!recExpanded); } }}
          role="button"
          tabIndex={0}
          aria-expanded={recExpanded}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: recExpanded ? "1px solid var(--line)" : "none", cursor: "pointer", userSelect: "none" }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em", display: "flex", alignItems: "center", gap: 9 }}>
              <svg width="18" height="18" fill="none" stroke="var(--teal)" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></svg>
              Acciones recomendadas
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Priorizadas según los datos del período. Resuelve de arriba hacia abajo.</div>
            {!recExpanded && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 6 }}>
                <span style={{ display: "inline-flex", gap: 4 }}>
                  {m.incCount > 0 && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)" }} />}
                  {m.efficiency < 50 && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)" }} />}
                  {m.completionRate < 70 && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--amber)" }} />}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>Toca para ver el detalle</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, flex: "none" }}>
            {(m.incCount > 0 || m.efficiency < 50 || m.completionRate < 70) ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--amber-deep)", background: "rgba(239,154,21,.15)", padding: "5px 11px", borderRadius: 999, whiteSpace: "nowrap" }}>
                {(m.incCount > 0 ? 1 : 0) + (m.efficiency < 50 ? 1 : 0) + (m.completionRate < 70 ? 1 : 0)} pendientes
              </span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", background: "rgba(31,157,84,.13)", padding: "5px 11px", borderRadius: 999 }}>Todo al día</span>
            )}
            <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", color: "var(--muted)", background: "var(--inset)", transition: "transform .3s ease", transform: recExpanded ? "rotate(0deg)" : "rotate(-90deg)" }}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
            </span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateRows: recExpanded ? "1fr" : "0fr", transition: "grid-template-rows .35s cubic-bezier(.16,1,.3,1)" }}>
          <div style={{ overflow: "hidden", minHeight: 0 }}>
            {/* Recommendation items */}
            {m.efficiency < 50 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "15px 18px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", marginTop: 5, flex: "none", background: "var(--red)", boxShadow: "0 0 0 4px rgba(226,60,88,.12)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Mejora la velocidad <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, color: "var(--red)", background: "rgba(226,60,88,.12)", marginLeft: 9 }}>Alta</span></div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>El tiempo promedio de <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>{m.avgTime} min/zona</b> supera la meta de 15 min. Revisar flujo de zonas con más tiempo.</div>
                </div>
              </div>
            )}
            {m.completionRate < 70 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "15px 18px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", marginTop: 5, flex: "none", background: m.completionRate < 40 ? "var(--red)" : "var(--amber)", boxShadow: m.completionRate < 40 ? "0 0 0 4px rgba(226,60,88,.12)" : "0 0 0 4px rgba(239,154,21,.15)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Aumenta el cumplimiento <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, color: m.completionRate < 40 ? "var(--red)" : "var(--amber-deep)", background: m.completionRate < 40 ? "rgba(226,60,88,.12)" : "rgba(239,154,21,.15)", marginLeft: 9 }}>{m.completionRate < 40 ? "Alta" : "Media"}</span></div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>Solo <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>{m.doneCount} de {m.totalZones} zonas</b> completadas ({m.completionRate}%). Asegúrate de que todos los armadores estén trabajando.</div>
                </div>
              </div>
            )}
            {m.incCount > 0 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "15px 18px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", marginTop: 5, flex: "none", background: "var(--red)", boxShadow: "0 0 0 4px rgba(226,60,88,.12)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Revisa las incidencias <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, color: "var(--red)", background: "rgba(226,60,88,.12)", marginLeft: 9 }}>Alta</span></div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}><b style={{ color: "var(--ink-2)", fontWeight: 600 }}>{m.incCount} incidencias</b> detectadas. Cada una reduce la calidad en 5 puntos.</div>
                </div>
              </div>
            )}
            {m.efficiency >= 50 && m.completionRate >= 70 && m.incCount === 0 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "15px 18px" }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", marginTop: 5, flex: "none", background: "var(--green)", boxShadow: "0 0 0 4px rgba(31,157,84,.13)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Todo dentro de meta <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, color: "var(--green)", background: "rgba(31,157,84,.13)", marginLeft: 9 }}>Sin acción</span></div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>Todos los indicadores están dentro del rango saludable. Mantén el estándar actual.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ KPI STRIP ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        {[
          { lab: "Zonas totales", val: m.totalZones, accent: "var(--teal)", sub: `${m.doneCount} completadas`, topColor: "var(--teal)" },
          { lab: "En progreso", val: m.activeCount, accent: "var(--amber)", sub: `${m.assignedCount} asignadas`, topColor: "var(--amber)" },
          { lab: "Productividad", val: m.avgProdH, unit: " p/h", accent: "var(--green)", sub: `${m.armadorStats.length} armadores`, topColor: "var(--green)" },
          { lab: "Tiempo promedio", val: m.avgTime, unit: " min", accent: "var(--sky)", sub: `meta 15 min/zona`, topColor: "var(--sky)" },
          { lab: "Incidencias", val: m.incCount, accent: "var(--violet)", sub: m.incCount > 0 ? "Requiere atención" : "Sin incidencias", topColor: "var(--violet)" },
        ].map((k) => (
          <div key={k.lab} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 14px 30px -18px rgba(16,24,40,.20)", padding: "15px 16px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: 3, width: "100%", opacity: 0.9, background: k.topColor }} />
            <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500, marginTop: 12 }}>{k.lab}</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1.05, marginTop: 1 }}>{k.val}<small style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)", marginLeft: 3 }}>{k.unit}</small></div>
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 5 }}><span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 999, background: "var(--inset)", color: "var(--muted)" }}>{k.sub}</span></div>
          </div>
        ))}
      </div>

      {/* ═══ TIEMPOS OPERATIVOS ═══ */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 14px", flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em", display: "flex", alignItems: "center", gap: 9, margin: 0 }}>
            <svg width="18" height="18" fill="none" stroke="var(--teal)" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>
            Tiempos operativos
          </h2>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", background: "var(--inset)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 13px", marginBottom: 16, display: "flex", gap: 9, alignItems: "flex-start" }}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ flex: "none", marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
          <span><b style={{ color: "var(--ink-2)", fontWeight: 600 }}>Reacción:</b> desde que confirma el ciclo (&ldquo;Listo&rdquo;) hasta que el armador escanea su primera zona. <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>Transición:</b> desde que termina una zona hasta que escanea la siguiente. Medido con datos reales de la bitácora.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          {/* Reacción */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 14px 30px -18px rgba(16,24,40,.20)", padding: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.01em", display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 8v4l3 2M12 3a9 9 0 109 9" /></svg>
                  Reacción a primera zona
                </div>
                <div style={{ fontSize: 11, color: "var(--faint)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 18h6M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" /></svg>
                  Detecta arranques lentos de ciclo
                </div>
              </div>
              {analytics.reactionStat && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", color: "var(--teal-deep)", background: "rgba(14,163,148,.12)" }}>{analytics.reactionStat.count} muestras</span>
              )}
            </div>
            {analytics.reactionStat ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginTop: 16 }}>
                  <div className="num" style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1, color: "var(--teal-deep)" }}>{formatDuration(analytics.reactionStat.avgSec)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>promedio del período</div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <div style={{ flex: 1, background: "var(--inset)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase" }}>Mediana</div>
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 2, letterSpacing: "-.02em" }}>{formatDuration(analytics.reactionStat.medianSec)}</div>
                  </div>
                  <div style={{ flex: 1, background: "var(--inset)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase" }}>P90</div>
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 2, letterSpacing: "-.02em" }}>{formatDuration(analytics.reactionStat.p90Sec)}</div>
                  </div>
                </div>
                {analytics.reactionStat.avgSec > analytics.reactionStat.medianSec * 3 && (
                  <div style={{ marginTop: 16, borderRadius: 11, padding: "11px 13px", display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(239,154,21,.15)", border: "1px solid rgba(239,154,21,.3)" }}>
                    <svg width="16" height="16" fill="none" stroke="var(--amber-deep)" strokeWidth="2" viewBox="0 0 24 24" style={{ flex: "none", marginTop: 1 }}><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z" /></svg>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>Un <b style={{ color: "var(--amber-deep)", fontWeight: 700 }}>caso atípico</b> infla el promedio. La mediana ({formatDuration(analytics.reactionStat.medianSec)}) refleja mejor la operación real.</p>
                    </div>
                  </div>
                )}
                {/* Distribution bars */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, marginBottom: 10 }}>Distribución por rango</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 104, paddingTop: 14 }}>
                    {analytics.reactionHistogram.map((b) => {
                      const max = Math.max(...analytics.reactionHistogram.map((x) => x.count), 1);
                      const h = b.count === 0 ? 3 : Math.max(10, Math.round((b.count / max) * 74));
                      return (
                        <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                          <div className="num" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)", marginBottom: 5, opacity: b.count > 0 ? 1 : 0.5 }}>{b.count || ""}</div>
                          <div style={{ width: "100%", maxWidth: 34, borderRadius: "7px 7px 3px 3px", height: h, background: b.count > 0 ? "linear-gradient(180deg, var(--teal), var(--teal-deep))" : "var(--inset)", transition: "height 1s cubic-bezier(.16,1,.3,1)" }} />
                          <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 8, textAlign: "center", whiteSpace: "nowrap" }}>{b.label}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ borderTop: "1px dashed var(--line-2)", marginTop: 2 }} />
                </div>
              </>
            ) : (
              <div style={{ padding: "28px 0", textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Sin datos de reacción todavía</div>
            )}
          </div>

          {/* Transición */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 14px 30px -18px rgba(16,24,40,.20)", padding: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.01em", display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 12h16M14 6l6 6-6 6" /></svg>
                  Transición entre zonas
                </div>
                <div style={{ fontSize: 11, color: "var(--faint)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 18h6M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" /></svg>
                  Mide el ritmo entre zonas seguidas
                </div>
              </div>
              {analytics.transitionStat && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", color: "var(--amber-deep)", background: "rgba(239,154,21,.15)" }}>{analytics.transitionStat.count} muestras</span>
              )}
            </div>
            {analytics.transitionStat ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginTop: 16 }}>
                  <div className="num" style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1, color: "var(--amber-deep)" }}>{formatDuration(analytics.transitionStat.avgSec)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>promedio del período</div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <div style={{ flex: 1, background: "var(--inset)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase" }}>Mediana</div>
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 2, letterSpacing: "-.02em" }}>{formatDuration(analytics.transitionStat.medianSec)}</div>
                  </div>
                  <div style={{ flex: 1, background: "var(--inset)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase" }}>P90</div>
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 2, letterSpacing: "-.02em" }}>{formatDuration(analytics.transitionStat.p90Sec)}</div>
                  </div>
                </div>
                {analytics.transitionStat.p90Sec <= 300 && (
                  <div style={{ marginTop: 16, borderRadius: 11, padding: "11px 13px", display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(31,157,84,.13)", border: "1px solid rgba(31,157,84,.3)" }}>
                    <svg width="16" height="16" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24" style={{ flex: "none", marginTop: 1 }}><path d="M20 6L9 17l-5-5" /></svg>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>Dentro del rango saludable: el <b style={{ color: "var(--green)", fontWeight: 700 }}>P90 ({formatDuration(analytics.transitionStat.p90Sec)})</b> está por debajo de la meta operativa.</p>
                    </div>
                  </div>
                )}
                {/* Distribution bars */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, marginBottom: 10 }}>Distribución por rango</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 104, paddingTop: 14 }}>
                    {analytics.transitionHistogram.map((b) => {
                      const max = Math.max(...analytics.transitionHistogram.map((x) => x.count), 1);
                      const h = b.count === 0 ? 3 : Math.max(10, Math.round((b.count / max) * 74));
                      return (
                        <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                          <div className="num" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)", marginBottom: 5, opacity: b.count > 0 ? 1 : 0.5 }}>{b.count || ""}</div>
                          <div style={{ width: "100%", maxWidth: 34, borderRadius: "7px 7px 3px 3px", height: h, background: b.count > 0 ? "linear-gradient(180deg, var(--amber), var(--amber-deep))" : "var(--inset)", transition: "height 1s cubic-bezier(.16,1,.3,1)" }} />
                          <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 8, textAlign: "center", whiteSpace: "nowrap" }}>{b.label}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ borderTop: "1px dashed var(--line-2)", marginTop: 2 }} />
                </div>
              </>
            ) : (
              <div style={{ padding: "28px 0", textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Sin datos de transición todavía</div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TENDENCIAS ═══ */}
      {!analytics.isEmpty && analytics.dailyTrend.length >= 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <TrendCard title="Tendencia diaria · reacción" subtitle="promedio por día" data={analytics.dailyTrend} metric="avgLatencySec" color="var(--teal)" />
          <TrendCard title="Tendencia diaria · transición" subtitle="promedio por día" data={analytics.dailyTrend} metric="avgTransitionSec" color="var(--amber)" />
        </div>
      )}

      {/* ═══ RENDIMIENTO POR ZONA + PRODUCTIVIDAD POR ARMADOR ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* Zona Performance */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 5h16v6H4zM4 15h9v4H4z" /></svg>
                Rendimiento por zona
              </div>
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Compara cada zona contra la meta</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, color: "var(--teal-deep)", background: "rgba(14,163,148,.12)" }}>meta 15 min</span>
          </div>
          {m.doneCount === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "30px 20px", color: "var(--muted)" }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--inset)", display: "grid", placeItems: "center", marginBottom: 14, color: "var(--faint)" }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M4 5h16v6H4zM4 15h9v4H4z" /><path d="M17 17l2 2 3-3" /></svg>
              </div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>Aún no hay tiempos por zona</h4>
              <p style={{ fontSize: 12, maxWidth: 280, lineHeight: 1.5 }}>Asigna zonas a tu equipo para empezar a medir el tiempo promedio de cada una frente a la meta.</p>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {m.zones.filter((z) => z.status === "done" && z.avgMinutes).slice(0, 8).map((z) => {
                const pct = Math.min(100, Math.round(((z.avgMinutes || 0) / 20) * 100));
                const overMeta = (z.avgMinutes || 0) > 15;
                return (
                  <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ width: 16, fontSize: 11, fontWeight: 600, color: "var(--faint)", textAlign: "center" }}>{z.code.slice(-2)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{z.code}</div>
                      <div style={{ height: 7, borderRadius: 999, background: "var(--inset)", marginTop: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 999, width: `${pct}%`, background: overMeta ? "linear-gradient(90deg, var(--red), var(--red))" : "linear-gradient(90deg, var(--teal), var(--teal-deep))", transition: "width 1s ease" }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>
                      <span className="num">{z.avgMinutes}</span> <small style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>min</small>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Armador Productivity */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9.5" cy="7" r="3.5" /></svg>
                Productividad por armador
              </div>
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Identifica quién necesita apoyo</div>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            {m.armadorStats.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "30px 20px", color: "var(--muted)" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--inset)", display: "grid", placeItems: "center", marginBottom: 14, color: "var(--faint)" }}>
                  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M17 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9.5" cy="7" r="3.5" /></svg>
                </div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>Sin datos de productividad</h4>
                <p style={{ fontSize: 12, maxWidth: 280, lineHeight: 1.5 }}>Empieza a medir productividad cuando los armadores empiecen a cerrar zonas.</p>
              </div>
            ) : m.armadorStats.map((a, i) => (
              <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
                <div className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--faint)", width: 16, textAlign: "center" }}>{i + 1}</div>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: a.color, display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 13, flex: "none" }}>{a.name[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 1 }}>{a.doneCount} zonas completadas</div>
                  <div style={{ height: 7, borderRadius: 999, background: "var(--inset)", marginTop: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 999, width: `${(a.prodH / m.maxArmProd) * 100}%`, background: "linear-gradient(90deg, var(--teal), var(--teal-deep))", transition: "width 1s ease" }} />
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>
                  <span className="num">{a.prodH}</span> <small style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>p/h</small>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", background: "var(--inset)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 13px", marginTop: 16, display: "flex", gap: 9, alignItems: "flex-start" }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ flex: "none", marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
            <span>La productividad se calcula al cerrar las primeras zonas de cada armador.</span>
          </div>
        </div>
      </div>

      {/* ═══ DISTRIBUCIÓN DE ESTADOS ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" fill="none" stroke="var(--muted)" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" /></svg>
              Distribución de estados
            </div>
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Muestra dónde está atascado el flujo</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, color: "var(--teal-deep)", background: "rgba(14,163,148,.12)" }}>{m.totalZones} zonas</span>
        </div>
        <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", background: "var(--inset)", marginTop: 14 }}>
          {[
            { label: "Pendiente", count: m.idleCount, color: "var(--faint)" },
            { label: "Asignada", count: m.assignedCount, color: "var(--sky)" },
            { label: "En progreso", count: m.activeCount, color: "var(--amber)" },
            { label: "Completada", count: m.doneCount, color: "var(--green)" },
          ].filter((s) => s.count > 0).map((s) => (
            <div key={s.label} style={{ width: (s.count / Math.max(m.totalZones, 1) * 100) + "%", background: s.color, transition: "width 1s ease", display: "flex", alignItems: "center", justifyContent: "center" }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 18 }}>
          {[
            { label: "Pendiente", count: m.idleCount, color: "var(--faint)" },
            { label: "Asignada", count: m.assignedCount, color: "var(--sky)" },
            { label: "En progreso", count: m.activeCount, color: "var(--amber)" },
            { label: "Completada", count: m.doneCount, color: "var(--green)" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 3, padding: 12, borderRadius: 11, background: "var(--inset)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ink-2)", fontWeight: 500 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none", background: s.color }} />
                {s.label}
              </div>
              <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em", color: s.count === 0 ? "var(--muted)" : "var(--ink)" }}>{s.count}</div>
            </div>
          ))}
        </div>
        {m.idleCount > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}><b style={{ color: "var(--ink-2)", fontWeight: 600 }}>{m.idleCount} zonas pendientes.</b> Asignar mueve el flujo al siguiente estado.</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Sub-components ═══ */

function TrendCard({ title, subtitle, data, metric, color }: {
  title: string; subtitle: string;
  data: { day: string; avgLatencySec: number | null; avgTransitionSec: number | null }[];
  metric: "avgLatencySec" | "avgTransitionSec"; color: string;
}) {
  const points = data.filter((d) => d[metric] !== null);
  if (points.length < 2) return null;

  const max = Math.max(...points.map((d) => d[metric]!));
  const min = Math.min(...points.map((d) => d[metric]!));
  const range = max - min || 1;

  const coords = points.map((d, i) => ({
    x: (i / (points.length - 1)) * 400,
    y: 10 + ((max - d[metric]!) / range) * 120,
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const fillD = `${pathD} L400 140 L0 140 Z`;
  const last = coords[coords.length - 1];

  const trend = points[points.length - 1][metric]! < points[0][metric]!;
  const firstDay = formatDayLabel(points[0].day);
  const lastDay = formatDayLabel(points[points.length - 1].day);

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: color, display: "inline-block" }} />
            {title}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{subtitle} · últimos {points.length} días</div>
        </div>
      </div>
      <svg width="100%" height="140" viewBox="0 0 400 140" preserveAspectRatio="none" style={{ display: "block", marginTop: 8, overflow: "visible" }}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[35, 70, 105].map((y) => (
          <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="var(--line)" strokeDasharray="3 5" />
        ))}
        <path d={fillD} fill={`url(#fill-${metric})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 4.5 : 4} fill={i === coords.length - 1 ? color : "var(--panel)"} stroke={color} strokeWidth="2.5" />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--faint)", marginTop: 6 }}>
        <span>{firstDay}</span><span>{lastDay}</span>
      </div>
      <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="15" height="15" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24" style={{ flex: "none" }}><path d="M22 17l-8.5-8.5-5 5L2 7" /><path d="M16 17h6v-6" /></svg>
          {trend ? "En tendencia a la baja — mejora sostenida." : "Tendencia estable o ascendente."}
        </div>
      </div>
    </div>
  );
}
