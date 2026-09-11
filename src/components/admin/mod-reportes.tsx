/**
 * @file components/admin/mod-reportes.tsx
 * @description Dashboard profesional de reportes con exportación HTML.
 * Resumen ejecutivo, métricas por período, exportación con diseño profesional.
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { I } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeActivity, getCompany } from "@/lib/firestore";
import type { Zone, Armador, ActivityLogEntry } from "@/types";
import type { Company } from "@/lib/firestore";

type Period = "today" | "week" | "month";

export function ModReportes() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubAct = subscribeActivity(user.companyId, setActivity, 500);
    getCompany(user.companyId).then(setCompany).catch(() => {});
    return () => { unsubZ(); unsubA(); unsubAct(); };
  }, [user?.companyId]);

  const m = useMemo(() => {
    const now = Date.now();
    const periodMs = period === "today" ? 86400000 : period === "week" ? 604800000 : 2592000000;
    const since = now - periodMs;

    const periodZones = zones;
    const periodActivity = activity.filter((a) => a.createdAt >= since);
    const done = periodZones.filter((z) => z.status === "done");
    const inc = periodZones.filter((z) => z.status === "incident");
    const active = periodZones.filter((z) => z.status === "active");

    const completionRate = periodZones.length > 0 ? Math.round((done.length / periodZones.length) * 100) : 0;
    const avgTime = done.length > 0 ? Math.round(done.reduce((s, z) => s + (z.avgMinutes || 0), 0) / done.length) : 0;
    const totalProducts = periodZones.reduce((s, z) => s + (z.totalProducts || z.products?.length || 0), 0);
    const pickedProducts = done.reduce((s, z) => s + (z.totalProducts || z.products?.length || 0), 0);
    const withProd = armadores.filter((a) => a.prodH > 0);
    const avgProdH = withProd.length > 0 ? Math.round(withProd.reduce((s, a) => s + a.prodH, 0) / withProd.length) : 0;

    const armadorStats = armadores.map((a) => {
      const myZones = periodZones.filter((z) => z.armadorId === a.id);
      const myDone = myZones.filter((z) => z.status === "done");
      const totalTime = myDone.reduce((s, z) => s + (z.avgMinutes || 0), 0);
      return {
        name: a.name,
        prodH: a.prodH || 0,
        zoneCount: myZones.length,
        doneCount: myDone.length,
        avgTime: myDone.length > 0 ? Math.round(totalTime / myDone.length) : 0,
        products: myZones.reduce((s, z) => s + (z.totalProducts || z.products?.length || 0), 0),
      };
    }).sort((a, b) => b.prodH - a.prodH);

    const sectorStats = ["A", "B"].map((sec) => {
      const secZones = periodZones.filter((z) => z.sector === sec);
      const secDone = secZones.filter((z) => z.status === "done");
      return {
        sector: sec,
        total: secZones.length,
        done: secDone.length,
        rate: secZones.length > 0 ? Math.round((secDone.length / secZones.length) * 100) : 0,
      };
    });

    return {
      periodZones, periodActivity, done, inc, active, completionRate,
      avgTime, totalProducts, pickedProducts, avgProdH, armadorStats,
      sectorStats, totalZones: periodZones.length, doneCount: done.length,
      incCount: inc.length, activeCount: active.length,
    };
  }, [zones, armadores, activity, period]);

  function handleExportHTML() {
    setExporting(true);
    const companyName = company?.name || "Siamo";
    const now = new Date();
    const periodLabel = period === "today" ? "Hoy" : period === "week" ? "Esta semana" : "Este mes";

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reporte Operacional — ${companyName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
.container{max-width:1000px;margin:0 auto;padding:40px 32px}
.header{display:flex;align-items:center;justify-content:space-between;padding:24px 0;border-bottom:3px solid #e11d48;margin-bottom:32px}
.brand{display:flex;align-items:center;gap:16px}
.brand-icon{width:48px;height:48px;background:#e11d48;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:20px}
.brand-name{font-size:22px;font-weight:700;color:#0f172a}
.brand-sub{font-size:12px;color:#64748b}
.meta{text-align:right;font-size:12px;color:#64748b}
.meta strong{color:#0f172a}
h2{font-size:18px;font-weight:700;margin:28px 0 16px;padding-bottom:8px;border-bottom:1px solid #e2e8f0}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
.kpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;position:relative;overflow:hidden}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.kpi.accent::before{background:#e11d48}
.kpi.done::before{background:#10b981}
.kpi.active::before{background:#f59e0b}
.kpi.info::before{background:#3b82f6}
.kpi-label{font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}
.kpi-value{font-size:32px;font-weight:700;color:#0f172a}
.kpi-value span{font-size:14px;color:#94a3b8}
.kpi-sub{font-size:11px;color:#94a3b8;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th{text-align:left;padding:10px 14px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e2e8f0;background:#f8fafc}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid #f1f5f9}
tr:hover td{background:#f8fafc}
.mono{font-family:'JetBrains Mono',monospace}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.badge.done{background:#d1fae5;color:#059669}
.badge.active{background:#fef3c7;color:#d97706}
.badge.inc{background:#fee2e2;color:#dc2626}
.bar-chart{display:flex;align-items:flex-end;gap:8px;height:120px;padding:0 4px}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.bar-fill{width:100%;border-radius:4px 4px 0 0;transition:height .3s}
.bar-label{font-size:10px;color:#64748b}
.bar-value{font-size:10px;font-weight:600;color:#0f172a}
.footer{margin-top:40px;padding-top:20px;border-top:2px solid #e2e8f0;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8}
.watermark{color:#e11d48;font-weight:700}
@media print{.container{padding:20px}body{background:#fff}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">
      <div class="brand-icon">S</div>
      <div>
        <div class="brand-name">${companyName}</div>
        <div class="brand-sub">Siamo.Indicador — Reporte Operacional</div>
      </div>
    </div>
    <div class="meta">
      <div><strong>Período:</strong> ${periodLabel}</div>
      <div><strong>Fecha:</strong> ${now.toLocaleDateString("es-CO")} ${now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</div>
      <div><strong>Generado por:</strong> ${user?.name || "Administrador"}</div>
    </div>
  </div>

  <h2>Resumen Ejecutivo</h2>
  <div class="kpi-grid">
    <div class="kpi accent"><div class="kpi-label">Índice Operacional</div><div class="kpi-value">${Math.round(m.completionRate * 0.35 + Math.min(100, m.avgTime > 0 ? (15 / m.avgTime) * 100 : 0) * 0.25 + Math.max(0, 100 - m.incCount * 5) * 0.25 + (m.armadorStats.length > 0 ? 15 : 0) * 0.15)}<span>/100</span></div><div class="kpi-sub">Score general</div></div>
    <div class="kpi done"><div class="kpi-label">Cumplimiento</div><div class="kpi-value">${m.completionRate}<span>%</span></div><div class="kpi-sub">${m.doneCount} de ${m.totalZones} zonas</div></div>
    <div class="kpi active"><div class="kpi-label">Tiempo Promedio</div><div class="kpi-value">${m.avgTime}<span> min/zona</span></div><div class="kpi-sub">Meta: 15 min</div></div>
    <div class="kpi info"><div class="kpi-label">Productividad</div><div class="kpi-value">${m.avgProdH}<span> prod/h</span></div><div class="kpi-sub">Promedio del equipo</div></div>
  </div>

  <h2>Rendimiento por Zona</h2>
  <div class="bar-chart">
    ${m.done.slice(0, 12).map((z) => {
      const time = z.avgMinutes || 0;
      const maxT = Math.max(...m.done.slice(0, 12).map((zz) => zz.avgMinutes || 0), 1);
      const pct = (time / maxT) * 100;
      const over = time > 15;
      return `<div class="bar"><div class="bar-value">${time}m</div><div class="bar-fill" style="height:${Math.max(pct, 5)}%;background:${over ? "#ef4444" : "#e11d48"}"></div><div class="bar-label">${z.code.replace(/^.*_/, "")}</div></div>`;
    }).join("")}
  </div>

  <h2>Equipo de Trabajo</h2>
  <table>
    <thead><tr><th>#</th><th>Armador</th><th style="text-align:right">Prod/h</th><th style="text-align:right">Zonas</th><th style="text-align:right">Completadas</th><th style="text-align:right">Tiempo Prom.</th><th style="text-align:right">Productos</th></tr></thead>
    <tbody>
    ${m.armadorStats.map((a, i) => `<tr><td>${i + 1}</td><td><strong>${a.name}</strong></td><td style="text-align:right" class="mono">${a.prodH}</td><td style="text-align:right">${a.zoneCount}</td><td style="text-align:right">${a.doneCount}</td><td style="text-align:right">${a.avgTime} min</td><td style="text-align:right">${a.products}</td></tr>`).join("")}
    </tbody>
  </table>

  ${m.sectorStats.some((s) => s.total > 0) ? `
  <h2>Por Sector</h2>
  <table>
    <thead><tr><th>Sector</th><th style="text-align:right">Zonas</th><th style="text-align:right">Completadas</th><th style="text-align:right">Cumplimiento</th></tr></thead>
    <tbody>
    ${m.sectorStats.filter((s) => s.total > 0).map((s) => `<tr><td><strong>Sector ${s.sector}</strong></td><td style="text-align:right">${s.total}</td><td style="text-align:right">${s.done}</td><td style="text-align:right"><span class="badge ${s.rate >= 70 ? "done" : s.rate >= 40 ? "active" : "inc"}">${s.rate}%</span></td></tr>`).join("")}
    </tbody>
  </table>` : ""}

  <h2>Recomendaciones</h2>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px">
    <ul style="list-style:none;display:grid;gap:10px">
      ${m.avgTime > 15 ? `<li style="padding:10px 14px;background:#fef3c7;border-radius:8px;font-size:13px">⚠️ <strong>Tiempo promedio (${m.avgTime} min) supera la meta (15 min).</strong> Revisar zonas con mayor tiempo para identificar cuellos de botella.</li>` : `<li style="padding:10px 14px;background:#d1fae5;border-radius:8px;font-size:13px">✅ <strong>Tiempo promedio dentro de la meta.</strong> El equipo mantiene un ritmo adecuado.</li>`}
      ${m.incCount > 0 ? `<li style="padding:10px 14px;background:#fee2e2;border-radius:8px;font-size:13px">🚨 <strong>${m.incCount} incidencia(s) requiere(n) atención.</strong> Clasificar las causas para mejorar el proceso.</li>` : `<li style="padding:10px 14px;background:#d1fae5;border-radius:8px;font-size:13px">✅ <strong>Sin incidencias registradas.</strong> Operación fluida.</li>`}
      ${m.completionRate < 50 ? `<li style="padding:10px 14px;background:#fef3c7;border-radius:8px;font-size:13px">⚠️ <strong>Cumplimiento bajo (${m.completionRate}%).</strong> Verificar asignación y disponibilidad del equipo.</li>` : ""}
      ${m.avgProdH < 200 ? `<li style="padding:10px 14px;background:#fef3c7;border-radius:8px;font-size:13px">⚠️ <strong>Productividad promedio (${m.avgProdH} prod/h) por debajo del esperado.</strong> Considerar capacitación o revisar procesos.</li>` : ""}
    </ul>
  </div>

  <div class="footer">
    <div class="watermark">Siamo.Indicador · Powered by ProServis</div>
    <div>Reporte generado automáticamente · ${now.toISOString()}</div>
  </div>
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-siamo-${period}-${now.toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando reportes...</div>;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ═══ Controls ═══ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {(["today", "week", "month"] as Period[]).map((p) => (
            <button key={p} className={"btn" + (period === p ? " primary" : "")} onClick={() => setPeriod(p)}>
              {p === "today" ? "Hoy" : p === "week" ? "Esta semana" : "Este mes"}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={handleExportHTML} disabled={exporting}>
          {exporting ? "Exportando..." : "📄 Exportar reporte HTML"}
        </button>
      </div>

      {/* ═══ Summary ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { lab: "Total zonas", val: m.totalZones, accent: "var(--accent)" },
          { lab: "Completadas", val: m.doneCount, accent: "var(--s-done)" },
          { lab: "Tiempo prom.", val: `${m.avgTime} min`, accent: "var(--s-active)" },
          { lab: "Incidencias", val: m.incCount, accent: "var(--s-inc)" },
        ].map((k) => (
          <div key={k.lab} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: k.accent }} />
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{k.lab}</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* ═══ Charts ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Armador Performance */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>Rendimiento del equipo</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {m.armadorStats.map((a, i) => (
              <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 16, textAlign: "right" }}>{i + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 500, width: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <div style={{ flex: 1, height: 8, background: "var(--panel2)", borderRadius: 20, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: (a.prodH / Math.max(...m.armadorStats.map((x) => x.prodH), 1) * 100) + "%", background: "var(--accent)", borderRadius: 20 }} />
                </div>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, width: 40, textAlign: "right" }}>{a.prodH}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sector Breakdown */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>Por sector</h3>
          {m.sectorStats.filter((s) => s.total > 0).map((s) => (
            <div key={s.sector} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>Sector {s.sector}</span>
                <span className="mono">{s.done}/{s.total} ({s.rate}%)</span>
              </div>
              <div style={{ height: 8, background: "var(--panel2)", borderRadius: 20, overflow: "hidden" }}>
                <div style={{ height: "100%", width: s.rate + "%", background: s.rate >= 70 ? "var(--s-done)" : s.rate >= 40 ? "var(--accent)" : "var(--s-not)", borderRadius: 20, transition: "width .4s" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Activity Log ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>Actividad reciente</h3>
        <div style={{ display: "grid", gap: 6, maxHeight: 200, overflow: "auto" }}>
          {m.periodActivity.slice(0, 20).map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", fontSize: 12, borderRadius: 6 }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--faint)", width: 60, flex: "none" }}>{new Date(a.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
              <span style={{ flex: 1 }}>{a.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
