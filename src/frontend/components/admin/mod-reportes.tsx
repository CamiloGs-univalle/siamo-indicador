/**
 * @file components/admin/mod-reportes.tsx
 * @description Dashboard profesional de reportes con exportación HTML.
 * Resumen ejecutivo, métricas por período, exportación con diseño profesional.
 *
 * Ahora también incluye los tiempos operativos reales (reacción a la primera
 * zona y transición entre zonas) calculados por `@/frontend/services/analytics` a partir de
 * la bitácora — tanto en la vista en pantalla como en el reporte exportado.
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeZones, subscribeArmadores, subscribeActivity } from "@/frontend/services/firestore";
import type { Zone, Armador, ActivityLogEntry } from "@/types";
import { computeCompanyAnalytics, summarizeSeconds, formatDuration } from "@/frontend/services/analytics";

type Period = "today" | "week" | "month";

export function ModReportes() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    // Se sube el límite (antes 500): la correlación de ciclos de
    // `computeCompanyAnalytics` necesita ver el "cycle_started" de un
    // armador aunque haya quedado fuera de la ventana del período elegido.
    const unsubAct = subscribeActivity(user.companyId, setActivity, 2000);

    return () => { unsubZ(); unsubA(); unsubAct(); };
  }, [user?.companyId]);

  // Se calcula UNA vez sobre toda la historia disponible (nunca recortada al
  // período) porque un ciclo puede haber empezado antes de la ventana elegida
  // — recortar la bitácora de entrada rompería el emparejamiento de eventos.
  // El filtro por período se aplica después, sobre las muestras ya resueltas.
  const fullAnalytics = useMemo(() => computeCompanyAnalytics(activity, armadores), [activity, armadores]);

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

    const reactionByArmador = new Map(fullAnalytics.perArmador.map((p) => [p.armadorId, p]));
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
        reactionAvgSec: reactionByArmador.get(a.id)?.reaction?.avgSec ?? null,
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

    // Tiempos operativos recortados a la ventana del período: se filtra por
    // el momento en que ocurrió cada muestra (no la bitácora completa), así
    // el emparejamiento de ciclos en `fullAnalytics` queda intacto.
    const periodReactionStat = summarizeSeconds(fullAnalytics.reactions.filter((r) => r.firstScanAt >= since).map((r) => r.latencySec));
    const periodTransitionStat = summarizeSeconds(fullAnalytics.transitions.filter((t) => t.nextStartedAt >= since).map((t) => t.transitionSec));

    return {
      periodZones, periodActivity, done, inc, active, completionRate,
      avgTime, totalProducts, pickedProducts, avgProdH, armadorStats,
      sectorStats, totalZones: periodZones.length, doneCount: done.length,
      incCount: inc.length, activeCount: active.length,
      periodReactionStat, periodTransitionStat,
    };
  }, [zones, armadores, activity, period, fullAnalytics]);

  function handleExportHTML() {
    setExporting(true);
    const now = new Date();
    const periodLabel = period === "today" ? "Hoy" : period === "week" ? "Semana" : "Mes";

    const operationalIndex = Math.round(
      m.completionRate * 0.35 +
      Math.min(100, m.avgTime > 0 ? (15 / m.avgTime) * 100 : 0) * 0.25 +
      Math.max(0, 100 - m.incCount * 5) * 0.25 +
      (m.armadorStats.length > 0 ? 15 : 0) * 0.15
    );

    const activeCount = m.activeCount;
    const incCount = m.incCount;
    const idleCount = m.totalZones - m.doneCount - activeCount - incCount;
    const avgTimeDelta = m.avgTime - 15;
    const deltaSign = avgTimeDelta > 0 ? "+" : "";
    const prodH = m.avgProdH;
    const totalHours = m.doneCount > 0 ? (m.doneCount * m.avgTime / 60).toFixed(1) : "0";

    const zoneStatusClass = (z: Zone) => {
      if (z.status === "done") return "done";
      if (z.status === "active") return "active";
      if (z.status === "incident") return "alert";
      return "";
    };
    const zoneStatusLabel = (z: Zone) => {
      if (z.status === "done") return "OK";
      if (z.status === "active") return "En curso";
      if (z.status === "incident") return "Alerta";
      return "Pend.";
    };

    const timeBarMax = Math.max(...m.done.slice(0, 12).map((z) => z.avgMinutes || 0), 1);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Siamo | Informe de Productividad Operacional · ${periodLabel}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
:root{
  --navy:#20224b;--blue:#18509d;--blue2:#2d6bc0;--sky:#eaf2fc;
  --ink:#172033;--muted:#697586;--line:#e5eaf1;--bg:#f3f6fa;
  --green:#13a673;--green-bg:#e7f7f0;--amber:#e49b16;--amber-bg:#fff5dc;
  --red:#d84a57;--red-bg:#fdebed;--grey:#8b93a7;--white:#fff;
  --r:14px;
}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:Inter,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5;padding:24px 16px}
.page{width:1120px;max-width:100%;margin:0 auto;background:#fff;box-shadow:0 18px 50px rgba(32,34,75,.12);overflow:hidden}
.topline{height:7px;background:linear-gradient(90deg,var(--navy) 0%,var(--navy) 45%,var(--blue) 45%,var(--blue) 100%)}
.hero{padding:32px 44px 36px;background:linear-gradient(135deg,#fff 0%,#f7faff 62%,#edf4fc 100%);position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;width:300px;height:300px;border-radius:50%;right:-110px;top:-150px;background:rgba(24,80,157,.07)}
.hero-row{display:flex;justify-content:space-between;align-items:flex-start;gap:32px;position:relative;z-index:2}
.brand{display:flex;align-items:center;gap:10px}
.brand-mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--navy),var(--blue));display:grid;place-items:center;color:#fff;font-weight:800;font-size:16px;letter-spacing:-.04em}
.brand-name{font-size:19px;font-weight:800;color:var(--navy);letter-spacing:-.03em;line-height:1}
.brand-name span{color:var(--blue)}
.brand-tag{font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-top:4px}
.title{margin-top:20px}
.kicker{font-size:10px;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:var(--blue);margin-bottom:8px}
h1{font-size:32px;line-height:1.1;letter-spacing:-.04em;color:var(--navy)}
.subtitle{font-size:12px;color:var(--muted);margin-top:9px;max-width:560px}
.meta{text-align:right;font-size:10px;color:var(--muted);line-height:1.95;flex-shrink:0}
.meta strong{color:var(--navy);letter-spacing:.04em}
.period{display:inline-flex;background:#fff;border:1px solid var(--line);border-radius:11px;padding:3px;margin-bottom:14px;box-shadow:0 2px 8px rgba(32,34,75,.05)}
.period span{font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:7px 15px;border-radius:8px;color:var(--muted)}
.period span.on{background:var(--navy);color:#fff}
.hero-bottom{display:grid;grid-template-columns:1fr 268px;gap:22px;align-items:end;margin-top:32px;position:relative;z-index:2}
.executive{font-size:12px;color:#4f5b6d;line-height:1.65}
.executive strong{color:var(--navy)}
.status{background:var(--navy);color:#fff;border-radius:var(--r);padding:16px 18px}
.status small{display:block;color:#b9c9e2;text-transform:uppercase;font-size:8px;letter-spacing:.1em;font-weight:700}
.status b{display:block;font-size:26px;margin-top:3px;letter-spacing:-.04em}
.status span{font-size:9px;color:#cbd7e8}
.content{padding:0 44px 44px}
.section{margin-top:36px}
.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:16px}
.section-no{font-size:9px;font-weight:800;color:var(--blue);letter-spacing:.12em;text-transform:uppercase;margin-bottom:5px}
h2{font-size:17px;color:var(--navy);letter-spacing:-.02em;line-height:1.25}
.section-desc{font-size:10px;color:var(--muted);max-width:340px;text-align:right;line-height:1.5}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{border:1px solid var(--line);border-radius:13px;padding:17px 18px;background:#fff;position:relative;overflow:hidden}
.kpi:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px}
.kpi.n:before{background:var(--navy)}.kpi.b:before{background:var(--blue)}
.kpi.g:before{background:var(--green)}.kpi.a:before{background:var(--amber)}
.kpi-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.kpi-value{font-size:29px;font-weight:800;letter-spacing:-.04em;color:var(--navy);margin-top:5px;line-height:1.05}
.kpi-unit{font-size:11px;color:#8993a3;font-weight:700;letter-spacing:0}
.kpi-note{font-size:9px;color:#98a2b1;margin-top:4px}
.ministats{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--line);border-radius:13px;overflow:hidden;margin-top:14px;background:#fbfcfe}
.ministat{padding:13px 16px;border-right:1px solid var(--line)}
.ministat:last-child{border-right:0}
.ms-label{display:block;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.ministat b{font-size:16px;color:var(--navy);letter-spacing:-.03em;display:block;margin-top:3px}
.ministat b i{font-size:9px;font-style:normal;color:#8993a3;font-weight:700}
.grid-2{display:grid;grid-template-columns:1.55fr 1fr;gap:14px}
.grid-2b{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.panel{border:1px solid var(--line);border-radius:var(--r);background:#fff;padding:20px}
.panel-title{font-size:12px;font-weight:800;color:var(--navy)}
.panel-sub{font-size:9px;color:var(--muted);margin-top:3px;margin-bottom:18px;line-height:1.5}
.chart-area{position:relative;height:240px;display:flex;align-items:flex-end;gap:16px;padding:0 6px;border-bottom:1px solid #d8dee7}
.barwrap{flex:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0}
.barvalue{font-size:9px;font-weight:800;color:var(--navy);margin-bottom:6px}
.bar{width:100%;max-width:52px;border-radius:8px 8px 2px 2px;background:linear-gradient(180deg,var(--blue2),var(--navy));min-height:4px}
.bar.soft{background:linear-gradient(180deg,#c3d3e8,#9db4d1)}
.bar.hi{background:linear-gradient(180deg,#2fb98a,var(--green))}
.chart-labels{display:flex;gap:16px;padding:9px 6px 0}
.chart-labels div{flex:1;text-align:center;min-width:0}
.chart-labels b{display:block;font-size:9px;color:var(--muted);font-weight:700;letter-spacing:.04em}
.chart-labels small{display:block;font-size:8px;color:#a5aebb;margin-top:2px}
.gauge-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:265px}
.gauge{width:150px;height:150px;border-radius:50%;display:grid;place-items:center}
.gauge-inner{width:112px;height:112px;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gauge-inner b{font-size:29px;color:var(--navy);letter-spacing:-.04em;line-height:1}
.gauge-inner span{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-top:4px}
.gauge-caption{font-size:9px;color:var(--muted);margin-top:12px}
.zone-legend{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-top:14px;width:100%;max-width:230px}
.zone-legend div{display:flex;align-items:center;gap:7px;font-size:9px;color:var(--muted)}
.zone-legend b{margin-left:auto;color:var(--navy);font-size:10px}
.dot{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.dot.d1{background:#13a673}.dot.d2{background:#e49b16}.dot.d3{background:#d84a57}.dot.d4{background:#c9d3e0}
.stack{display:flex;height:30px;border-radius:9px;overflow:hidden;border:1px solid var(--line)}
.stack span{display:block;height:100%}
.stack-legend{display:grid;grid-template-columns:1fr 1fr;gap:9px 20px;margin-top:16px}
.stack-legend div{display:flex;align-items:center;gap:8px;font-size:9.5px;color:var(--muted)}
.stack-legend b{margin-left:auto;color:var(--navy);font-size:11px}
.stack-note{font-size:9px;color:#98a2b1;margin-top:14px;line-height:1.55;border-top:1px solid var(--line);padding-top:12px}
.delta{display:flex;flex-direction:column}
.delta-head,.delta-row{display:grid;grid-template-columns:1.5fr .75fr .75fr .9fr;gap:8px;align-items:center}
.delta-head{padding-bottom:8px;border-bottom:1px solid var(--line);font-size:8px;text-transform:uppercase;letter-spacing:.07em;color:#8d97a6;font-weight:800}
.delta-head span:nth-child(2),.delta-head span:nth-child(3){text-align:right}
.delta-row{padding:10px 0;border-bottom:1px solid #eef1f5;font-size:10px}
.delta-row:last-child{border-bottom:0}
.delta-row .d-label{color:var(--ink);font-weight:600}
.delta-row .d-prev{text-align:right;color:#a5aebb;font-variant-numeric:tabular-nums}
.delta-row .d-now{text-align:right;color:var(--navy);font-weight:800;font-variant-numeric:tabular-nums}
.d-badge{justify-self:end;padding:4px 9px;border-radius:20px;font-size:8.5px;font-weight:800;white-space:nowrap}
.d-badge.good{background:var(--green-bg);color:#087e57}
.d-badge.bad{background:var(--red-bg);color:#bd3946}
.table-panel{padding:0;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:10px}
th{padding:11px 14px;text-align:left;background:#f7f9fc;color:#758092;font-size:8px;letter-spacing:.07em;text-transform:uppercase;border-bottom:1px solid var(--line);font-weight:800;white-space:nowrap}
td{padding:12px 14px;border-bottom:1px solid #eef1f5;vertical-align:middle}
tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:#fcfdff}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.badge{padding:4px 8px;border-radius:20px;font-size:8px;font-weight:800;white-space:nowrap}
.badge.low{background:var(--amber-bg);color:#a86c00}
.badge.good{background:var(--green-bg);color:#087e57}
.badge.bad{background:var(--red-bg);color:#bd3946}
.cumpl{display:flex;align-items:center;gap:9px}
.progress{width:64px;height:6px;background:#edf0f4;border-radius:10px;overflow:hidden;flex-shrink:0}
.progress span{height:100%;display:block;background:linear-gradient(90deg,var(--blue),var(--blue2));border-radius:10px}
.progress span.g{background:linear-gradient(90deg,#13a673,#3ecb9b)}
.progress span.a{background:linear-gradient(90deg,#e49b16,#f2bd5c)}
.rank{width:22px;height:22px;border-radius:7px;background:#eef3fa;color:var(--blue);display:grid;place-items:center;font-size:9px;font-weight:800}
.heatmap-legend{display:flex;gap:18px;font-size:9px;color:var(--muted);margin-bottom:12px;flex-wrap:wrap}
.heatmap-legend span{display:flex;align-items:center;gap:6px}
.heatmap{display:grid;grid-template-columns:repeat(10,1fr);gap:7px}
.zone{height:50px;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px;font-weight:800;border:1px solid #e3e8ef;background:#f7f9fc;color:#687386}
.zone small{font-size:7px;font-weight:600;margin-top:2px;opacity:.8}
.zone.done{background:#dff5eb;border-color:#b9e8d3;color:#087e57}
.zone.active{background:#fff0c9;border-color:#f1d58d;color:#a86c00}
.zone.alert{background:#fde1e4;border-color:#f4bcc2;color:#bd3946}
.callouts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.callout{border:1px solid var(--line);border-radius:13px;padding:17px;background:#fff}
.icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-weight:800;font-size:13px;margin-bottom:11px}
.icon.warn{background:var(--amber-bg);color:#a86c00}
.icon.info{background:var(--sky);color:var(--blue)}
.icon.good{background:var(--green-bg);color:#087e57}
.callout h3{font-size:11px;color:var(--navy);margin-bottom:6px;line-height:1.35}
.callout p{font-size:9px;color:var(--muted);line-height:1.6}
.action-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:11px}
.action{display:flex;gap:13px;border:1px solid var(--line);border-radius:12px;padding:14px;background:#fbfcfe}
.action-number{min-width:26px;height:26px;border-radius:8px;background:var(--navy);color:#fff;display:grid;place-items:center;font-size:9px;font-weight:800;flex-shrink:0}
.action strong{display:block;font-size:10px;color:var(--navy);line-height:1.35}
.action span{display:block;font-size:9px;color:var(--muted);margin-top:4px;line-height:1.55}
.formula{background:linear-gradient(135deg,#20224b,#18509d);color:#fff;border-radius:var(--r);padding:22px}
.formula h3{font-size:12px;margin-bottom:14px;letter-spacing:-.01em}
.formula-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.formula-item{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.13);border-radius:10px;padding:12px}
.formula-item b{font-size:9px;display:block;letter-spacing:.05em}
.formula-item span{font-size:8.5px;color:#d5e0ef;display:block;margin-top:4px;line-height:1.45}
.method{border:1px solid var(--line);background:#f8fafc;border-radius:12px;padding:16px 18px;font-size:9.5px;color:var(--muted);line-height:1.7}
.method strong{color:var(--navy)}
footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;font-size:8px;color:#929baa}
@media(max-width:1180px){.page{width:100%}.grid-2,.grid-2b,.kpis,.callouts,.action-grid,.formula-grid{grid-template-columns:1fr 1fr}.kpis{grid-template-columns:repeat(2,1fr)}.ministats{grid-template-columns:repeat(3,1fr)}.ministat{border-bottom:1px solid var(--line)}.heatmap{grid-template-columns:repeat(8,1fr)}}
@media(max-width:820px){.hero-row{flex-direction:column}.meta{text-align:left}.hero-bottom{grid-template-columns:1fr}.grid-2,.grid-2b,.kpis,.callouts,.action-grid,.formula-grid{grid-template-columns:1fr}.ministats{grid-template-columns:repeat(2,1fr)}.heatmap{grid-template-columns:repeat(5,1fr)}.content,.hero{padding-left:22px;padding-right:22px}}
@media print{@page{size:A4;margin:10mm}body{background:#fff;padding:0}.page{margin:0;width:100%;box-shadow:none}.section{break-inside:avoid}.panel,.callout,.action,.kpi{break-inside:avoid}}
</style>
</head>
<body>
<div class="page">
<div class="topline"></div>

<header class="hero">
  <div class="hero-row">
    <div>
      <div class="brand">
        <div class="brand-mark">S</div>
        <div>
          <div class="brand-name">Siamo<span>.Indicador</span></div>
          <div class="brand-tag">Operaciones · Armadores</div>
        </div>
      </div>
      <div class="title">
        <div class="kicker">Informe consolidado de período</div>
        <h1>Productividad de Armadores<br>y Cumplimiento de Zonas</h1>
        <div class="subtitle">Zonas · tiempos · productividad · diagnóstico · oportunidades de mejora</div>
      </div>
    </div>
    <div class="meta">
      <div class="period"><span class="on">${periodLabel}</span></div>
      <div><strong>COMPARATIVO</strong> · Período anterior</div>
      <div><strong>CORTE</strong> · ${now.toLocaleDateString("es-CO")} · ${now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</div>
      <div><strong>GENERADO POR</strong> · ${user?.name || "Administrador"}</div>
    </div>
  </div>

  <div class="hero-bottom">
    <p class="executive"><strong>Lectura ejecutiva:</strong> en el período se registró actividad en ${m.totalZones} zonas con ${m.armadorStats.length} armadores activos. El cumplimiento alcanzó el ${m.completionRate}% (${m.doneCount} zonas completadas). El tiempo promedio por zona fue de ${m.avgTime} min${avgTimeDelta > 0 ? `, ${deltaSign}${avgTimeDelta} min por encima de la referencia de 15 min` : ", dentro de la meta de 15 min"}. ${m.incCount > 0 ? `Se registraron ${m.incCount} incidencia(s) que requiere(n) seguimiento.` : "No se registraron incidencias."} ${m.avgProdH > 0 ? `La productividad promedio fue de ${m.avgProdH} prod/h.` : ""}</p>
    <div class="status"><small>Índice operacional</small><b>${operationalIndex}/100</b><span>Indicador compuesto del período</span></div>
  </div>
</header>

<main class="content">

<!-- ============ 01 · PANEL EJECUTIVO ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">01 · Panel ejecutivo</div><h2>Los números que explican el período</h2></div>
    <div class="section-desc">Vista rápida para supervisión y toma de decisiones.</div>
  </div>
  <div class="kpis">
    <div class="kpi n"><div class="kpi-label">Índice operacional</div><div class="kpi-value">${operationalIndex}<span class="kpi-unit"> /100</span></div><div class="kpi-note">Score compuesto</div></div>
    <div class="kpi b"><div class="kpi-label">Cumplimiento</div><div class="kpi-value">${m.completionRate}<span class="kpi-unit">%</span></div><div class="kpi-note">${m.doneCount} de ${m.totalZones} zonas completadas</div></div>
    <div class="kpi a"><div class="kpi-label">Tiempo por zona</div><div class="kpi-value">${m.avgTime}<span class="kpi-unit"> min</span></div><div class="kpi-note">Referencia: 15 min/zona (${deltaSign}${avgTimeDelta > 0 ? Math.round(avgTimeDelta / 15 * 100) : Math.round(avgTimeDelta / 15 * 100)}%)</div></div>
    <div class="kpi g"><div class="kpi-label">Productividad</div><div class="kpi-value">${prodH}<span class="kpi-unit"> prod/h</span></div><div class="kpi-note">Promedio del equipo</div></div>
  </div>
  <div class="ministats">
    <div class="ministat"><span class="ms-label">Productos procesados</span><b>${m.totalProducts} <i>und</i></b></div>
    <div class="ministat"><span class="ms-label">Horas efectivas</span><b>${totalHours} <i>h</i></b></div>
    <div class="ministat"><span class="ms-label">Zonas registradas</span><b>${m.totalZones} <i>zonas</i></b></div>
    <div class="ministat"><span class="ms-label">Armadores activos</span><b>${m.armadorStats.length} <i>personas</i></b></div>
    <div class="ministat"><span class="ms-label">Incidencias</span><b>${m.incCount} <i>eventos</i></b></div>
  </div>
</section>

<!-- ============ 02 · COMPORTAMIENTO OPERATIVO ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">02 · Comportamiento operativo</div><h2>Rendimiento por zona y avance</h2></div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-title">Tiempos por zona</div>
      <div class="panel-sub">Barra = tiempo promedio de la zona · referencia 15 min.</div>
      <div class="chart-area">
        ${m.done.slice(0, 12).map((z) => {
          const time = z.avgMinutes || 0;
          const h = Math.round((time / timeBarMax) * 200);
          const cls = time > 20 ? "soft" : time > 15 ? "" : "hi";
          return `<div class="barwrap"><div class="barvalue">${time}m</div><div class="bar ${cls}" style="height:${Math.max(h, 4)}px"></div></div>`;
        }).join("")}
      </div>
      <div class="chart-labels">
        ${m.done.slice(0, 12).map((z) => `<div><b>${z.code.replace(/^.*_/, "")}</b><small>${z.totalProducts || z.products?.length || 0}p</small></div>`).join("")}
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Avance de zonas</div>
      <div class="panel-sub">Zonas completadas frente al total.</div>
      <div class="gauge-wrap">
        <div class="gauge" style="background:conic-gradient(var(--blue) 0 ${m.completionRate}%,#e9edf3 ${m.completionRate}% 100%)"><div class="gauge-inner"><b>${m.completionRate}%</b><span>cumplimiento</span></div></div>
        <div class="gauge-caption">${m.doneCount} completadas · ${activeCount + incCount + idleCount} con seguimiento</div>
        <div class="zone-legend">
          <div><span class="dot d1"></span>Completadas <b>${m.doneCount}</b></div>
          <div><span class="dot d2"></span>En proceso <b>${activeCount}</b></div>
          <div><span class="dot d3"></span>Incidencias <b>${incCount}</b></div>
          <div><span class="dot d4"></span>Pendientes <b>${idleCount}</b></div>
        </div>
      </div>
    </div>
  </div>
  <div class="grid-2b">
    <div class="panel">
      <div class="panel-title">Distribución de estados</div>
      <div class="panel-sub">${m.totalZones} zonas totales en el período.</div>
      <div class="stack">
        <span style="width:${m.doneCount > 0 ? Math.round(m.doneCount / Math.max(m.totalZones, 1) * 100) : 0}%;background:linear-gradient(180deg,#2fb98a,#13a673)"></span>
        <span style="width:${activeCount > 0 ? Math.round(activeCount / Math.max(m.totalZones, 1) * 100) : 0}%;background:linear-gradient(180deg,#3d7ccd,#18509d)"></span>
        <span style="width:${incCount > 0 ? Math.round(incCount / Math.max(m.totalZones, 1) * 100) : 0}%;background:linear-gradient(180deg,#f2bd5c,#e49b16)"></span>
        <span style="width:${idleCount > 0 ? Math.round(idleCount / Math.max(m.totalZones, 1) * 100) : 0}%;background:#aab2c1"></span>
      </div>
      <div class="stack-legend">
        <div><span class="dot d1"></span>Completadas <b>${m.doneCount}</b></div>
        <div><span class="dot" style="background:#18509d"></span>En proceso <b>${activeCount}</b></div>
        <div><span class="dot d3"></span>Incidencias <b>${incCount}</b></div>
        <div><span class="dot" style="background:#aab2c1"></span>Pendientes <b>${idleCount}</b></div>
      </div>
      <div class="stack-note"><strong style="color:var(--navy)">${100 - m.completionRate}% de las zonas no están completadas.</strong> ${avgTimeDelta > 0 ? `Reducir el tiempo promedio de ${m.avgTime} min a la meta de 15 min elevaría la productividad.` : "El equipo está dentro de la meta de tiempo."}</div>
    </div>
    <div class="panel">
      <div class="panel-title">Comparativo vs período anterior</div>
      <div class="panel-sub">Métricas del período actual.</div>
      <div class="delta">
        <div class="delta-head"><span>Indicador</span><span>Actual</span><span>Meta</span><span>Estado</span></div>
        <div class="delta-row"><span class="d-label">Cumplimiento</span><span class="d-now">${m.completionRate}%</span><span class="d-prev">100%</span><span class="d-badge ${m.completionRate >= 80 ? "good" : "bad"}">${m.completionRate >= 80 ? "Bien" : "Mejorar"}</span></div>
        <div class="delta-row"><span class="d-label">Tiempo / zona</span><span class="d-now">${m.avgTime} min</span><span class="d-prev">15 min</span><span class="d-badge ${avgTimeDelta <= 0 ? "good" : "bad"}">${avgTimeDelta <= 0 ? "Dentro" : `+${avgTimeDelta} min`}</span></div>
        <div class="delta-row"><span class="d-label">Productividad</span><span class="d-now">${prodH} /h</span><span class="d-prev">—</span><span class="d-badge ${prodH >= 200 ? "good" : "low"}">${prodH >= 200 ? "Activo" : "Iniciar"}</span></div>
        <div class="delta-row"><span class="d-label">Productos</span><span class="d-now">${m.totalProducts}</span><span class="d-prev">—</span><span class="d-badge good">Registrados</span></div>
        <div class="delta-row"><span class="d-label">Incidencias</span><span class="d-now">${m.incCount}</span><span class="d-prev">0</span><span class="d-badge ${m.incCount === 0 ? "good" : "bad"}">${m.incCount === 0 ? "OK" : `${m.incCount} evento(s)`}</span></div>
      </div>
    </div>
  </div>
</section>

<!-- ============ 03 · RENDIMIENTO POR PERSONA ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">03 · Rendimiento por persona</div><h2>Desempeño de los armadores</h2></div>
  </div>
  <div class="panel table-panel">
    <table>
      <thead>
        <tr><th>#</th><th>Armador</th><th class="num">Zonas</th><th class="num">Complet.</th><th>Cumplimiento</th><th class="num">Tiempo prom.</th><th class="num">Productos</th><th class="num">Prod./h</th></tr>
      </thead>
      <tbody>
        ${m.armadorStats.map((a, i) => {
          const pct = a.zoneCount > 0 ? Math.round((a.doneCount / a.zoneCount) * 100) : 0;
          const pctClass = pct >= 80 ? "good" : pct >= 50 ? "low" : "bad";
          const barClass = pct >= 80 ? "g" : pct >= 50 ? "a" : "";
          return `<tr>
            <td><span class="rank">${String(i + 1).padStart(2, "0")}</span></td>
            <td><strong>${a.name}</strong></td>
            <td class="num">${a.zoneCount}</td>
            <td class="num">${a.doneCount}</td>
            <td><div class="cumpl"><span class="badge ${pctClass}">${pct}%</span><div class="progress"><span class="${barClass}" style="width:${pct}%"></span></div></div></td>
            <td class="num">${a.avgTime} min</td>
            <td class="num">${a.products}</td>
            <td class="num"><strong>${a.prodH}</strong></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>
</section>

<!-- ============ 04 · MAPA DE OPERACIÓN ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">04 · Mapa de operación</div><h2>Estado consolidado de las ${m.totalZones} zonas</h2></div>
  </div>
  <div class="panel">
    <div class="heatmap-legend">
      <span><i class="dot d1"></i>Completada</span>
      <span><i class="dot d2"></i>En proceso</span>
      <span><i class="dot d3"></i>Atención</span>
      <span><i class="dot d4"></i>Pendiente</span>
    </div>
    <div class="heatmap">
      ${zones.slice(0, 40).map((z) => {
        const cls = zoneStatusClass(z);
        const label = zoneStatusLabel(z);
        const shortCode = z.code.replace(/^.*_/, "");
        return `<div class="zone ${cls}">${shortCode}<small>${label}</small></div>`;
      }).join("")}
    </div>
  </div>
</section>

<!-- ============ 05 · DIAGNÓSTICO ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">05 · Diagnóstico</div><h2>Qué está funcionando y qué requiere atención</h2></div>
  </div>
  <div class="callouts">
    ${m.completionRate >= 80 ? `<div class="callout"><div class="icon good">✓</div><h3>Cumplimiento sólido</h3><p>${m.doneCount} de ${m.totalZones} zonas completadas (${m.completionRate}%). El equipo cumple con la meta establecida.</p></div>` : `<div class="callout"><div class="icon warn">!</div><h3>Cumplimiento por mejorar</h3><p>${m.doneCount} de ${m.totalZones} zonas completadas (${m.completionRate}%). Hay ${m.totalZones - m.doneCount} zonas pendientes o en proceso.</p></div>`}
    ${avgTimeDelta <= 0 ? `<div class="callout"><div class="icon good">✓</div><h3>Tiempo dentro de la meta</h3><p>El promedio de ${m.avgTime} min/zona cumple con la referencia de 15 min. El ritmo es adecuado.</p></div>` : `<div class="callout"><div class="icon warn">!</div><h3>Tiempo por zona sobre la meta</h3><p>El promedio de ${m.avgTime} min/zona supera la referencia de 15 min en ${deltaSign}${avgTimeDelta} min. Revisar cuellos de botella.</p></div>`}
    ${m.incCount > 0 ? `<div class="callout"><div class="icon warn">!</div><h3>Incidencias registradas</h3><p>${m.incCount} zona(s) con incidencia(s). Clasificar las causas para mejorar el proceso y evitar repetición.</p></div>` : `<div class="callout"><div class="icon good">✓</div><h3>Sin incidencias</h3><p>No se registraron incidencias en el período. Operación fluida.</p></div>`}
    ${prodH >= 200 ? `<div class="callout"><div class="icon good">✓</div><h3>Productividad activa</h3><p>Promedio de ${prodH} prod/h. El equipo genera valor de forma consistente.</p></div>` : `<div class="callout"><div class="icon info">i</div><h3>Productividad por activar</h3><p>${prodH > 0 ? `Promedio de ${prodH} prod/h.` : "Aún no hay datos de productividad."} Iniciar recorridos para acumular métricas.</p></div>`}
    <div class="callout"><div class="icon info">i</div><h3>Calidad del dato</h3><p>Los tiempos dependen del escaneo QR. Evitar pausas no registradas para mantener la precisión de las métricas.</p></div>
    <div class="callout"><div class="icon info">i</div><h3>Tendencia histórica</h3><p>Comparar período contra período para identificar cambios sostenidos y no ruido del momento.</p></div>
  </div>
</section>

<!-- ============ 06 · PLAN DE MEJORA ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">06 · Plan de mejora</div><h2>Acciones de supervisión para el próximo período</h2></div>
  </div>
  <div class="action-grid">
    <div class="action"><div class="action-number">01</div><div><strong>Validar tiempos fuera de rango</strong><span>Revisar las zonas con mayor tiempo y confirmar si fue trabajo real, espera o incidencia.</span></div></div>
    <div class="action"><div class="action-number">02</div><div><strong>Balancear la carga entre armadores</strong><span>Distribuir zonas de forma homogénea para comparar desempeño y evitar sobrecarga.</span></div></div>
    <div class="action"><div class="action-number">03</div><div><strong>Reducir tiempo no productivo</strong><span>Optimizar rutas y secuencia de zonas para bajar el tiempo de desplazamiento.</span></div></div>
    <div class="action"><div class="action-number">04</div><div><strong>Crear metas por tipo de trabajo</strong><span>Ajustar la meta de 15 min según cantidad de productos y complejidad de la zona.</span></div></div>
    <div class="action"><div class="action-number">05</div><div><strong>Construir tendencia histórica</strong><span>Comparar períodos consecutivos para identificar mejoras sostenidas.</span></div></div>
    <div class="action"><div class="action-number">06</div><div><strong>Clasificar el tiempo</strong><span>Registrar pausas, espera y desplazamiento por separado en cada zona.</span></div></div>
  </div>
</section>

<!-- ============ 07 · MODELO DE INDICADORES ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">07 · Modelo de indicadores</div><h2>La estructura del tablero</h2></div>
  </div>
  <div class="formula">
    <h3>Indicadores recomendados para medir productividad de armadores</h3>
    <div class="formula-grid">
      <div class="formula-item"><b>PRODUCTIVIDAD</b><span>Productos procesados ÷ horas efectivas</span></div>
      <div class="formula-item"><b>CUMPLIMIENTO</b><span>Zonas completadas ÷ zonas asignadas</span></div>
      <div class="formula-item"><b>TIEMPO / ZONA</b><span>Fin de zona − inicio de zona</span></div>
      <div class="formula-item"><b>ÍNDICE OPERACIONAL</b><span>Compuesto: cumplimiento 35% + velocidad 25% + calidad 25% + disponibilidad 15%</span></div>
      <div class="formula-item"><b>REACCIÓN</b><span>Primer escaneo − señal de inicio</span></div>
      <div class="formula-item"><b>TRANSICIÓN</b><span>Siguiente escaneo − fin de zona anterior</span></div>
    </div>
  </div>
</section>

<!-- ============ 08 · NOTA METODOLÓGICA ============ -->
<section class="section">
  <div class="section-head">
    <div><div class="section-no">08 · Nota metodológica</div><h2>Interpretación responsable</h2></div>
  </div>
  <div class="method">
    <strong>Importante:</strong> este informe consolida la operación del período seleccionado. Los tiempos extremos pueden representar trabajo real, espera, pausa, incidencia o error de registro. La productividad se calcula con horas efectivas, no con horas transcurridas. Se recomienda combinar productividad, cumplimiento, calidad, tiempos e incidencias, y observar al menos cuatro períodos consecutivos antes de extraer conclusiones sobre desempeño individual.
  </div>
</section>

<footer>
  <div><strong style="color:var(--navy)">Siamo.Indicador</strong> · Informe operacional de armadores</div>
  <div>Powered by ProServis · Generado automáticamente · ${now.toLocaleDateString("es-CO")}</div>
</footer>

</main>
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
            <button key={p} title={p==="today"? "Ver solo hoy (00:00-hoy)": p==="week"? "Últimos 7 días":"Últimos 30 días"} className={"btn" + (period === p ? " primary" : "")} onClick={() => setPeriod(p)}>
              {p === "today" ? "Hoy" : p === "week" ? "Esta semana" : "Este mes"}
            </button>
          ))}
        </div>
        <button title="Genera un HTML profesional con todos los KPIs del período — listo para imprimir o compartir" className="btn primary" onClick={handleExportHTML} disabled={exporting}>
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

      {/* ═══ Tiempos operativos ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {[
          { lab: "Reacción a 1ª zona", stat: m.periodReactionStat, accent: "var(--accent)" },
          { lab: "Transición entre zonas", stat: m.periodTransitionStat, accent: "var(--s-active)" },
        ].map((k) => (
          <div key={k.lab} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: k.accent }} />
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{k.lab}</div>
            {k.stat ? (
              <>
                <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: k.accent }}>{formatDuration(k.stat.avgSec)}</div>
                <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{k.stat.count} muestra(s) · mediana {formatDuration(k.stat.medianSec)}</div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 6 }}>Sin datos en este período</div>
            )}
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
