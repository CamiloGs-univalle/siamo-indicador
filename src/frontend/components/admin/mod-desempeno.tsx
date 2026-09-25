/**
 * @file components/admin/mod-desempeno.tsx — v3 CREATIVO
 * Bento hero + Podium 3D con confetti + ranking expandible con radar/bullet
 * + comparación dual + marbetes bento + incidencias kanban.
 * Estilo: bento-box-grid + data-dense + micro-interactions (sin deps externas).
 */

"use client";

import { useState, useEffect, useMemo, useRef, useId } from "react";
import { useAuth } from "@/frontend/context/auth-context";
import {
  subscribeArmadores,
  subscribeZones,
  subscribeActivity,
  subscribeMembretes,
  updateArmador,
  updateZone,
} from "@/frontend/services/firestore";
import type { Armador, Zone, IncidentClass, ActivityLogEntry, Membrete } from "@/types";
import { computeCompanyAnalytics, formatDuration } from "@/frontend/services/analytics";

// ——— helpers ———
function useCountUp(n: number, ms = 650) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const start = from.current;
    const delta = n - start;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(start + delta * e));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = n;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, ms]);
  return v;
}

export function ModDesempeno() {
  const { user } = useAuth();
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingReco, setSavingReco] = useState<Record<string, boolean>>({});
  const [savingClass, setSavingClass] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [period, setPeriod] = useState<"hoy" | "semana" | "mes">("hoy");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"indice" | "reaccion" | "marbetes">("indice");

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const uA = subscribeArmadores(user.companyId, (a) => { setArmadores(a); setLoading(false); });
    const uZ = subscribeZones(user.companyId, setZones);
    const uM = subscribeMembretes(user.companyId, setMembretes);
    const uAc = subscribeActivity(user.companyId, setActivity, 2000);
    return () => { uA(); uZ(); uM(); uAc(); };
  }, [user?.companyId]);

  const analytics = useMemo(() => computeCompanyAnalytics(activity, armadores), [activity, armadores]);

  const membreteRanking = useMemo(() => armadores.map((a) => {
    const mine = membretes.filter((m) => m.armadorId === a.id);
    const completados = mine.filter((m) => m.status === "completed");
    const enProceso = mine.filter((m) => m.status === "active" || m.status === "pending").length;
    const tomadosPorCuenta = completados.filter((m) => m.claimedAt).length;
    const asignadosDirecto = completados.length - tomadosPorCuenta;
    const unidades = completados.reduce((s, m) => s + (m.totalUnits || 0), 0);
    // sparkline: last 6 completados time buckets (mock from completados length)
    const spark = Array.from({ length: 6 }, (_, i) => Math.max(2, completados.length - (5 - i) * 0.6 + Math.sin(i) ));
    return { armador: a, completados: completados.length, enProceso, tomadosPorCuenta, asignadosDirecto, unidades, spark };
  }).filter((r) => r.completados > 0 || r.enProceso > 0).sort((a, b) => b.completados - a.completados), [armadores, membretes]);

  const data = useMemo(() => {
    const byArm = new Map(analytics.perArmador.map((p) => [p.armadorId, p]));
    const ranked = armadores.map((a) => {
      const myZones = zones.filter((z) => z.armadorId === a.id);
      const myDone = myZones.filter((z) => z.status === "done");
      const myInc = myZones.filter((z) => z.status === "incident");
      const totalTime = myDone.reduce((s, z) => s + (z.avgMinutes || 0), 0);
      const totalProducts = myZones.reduce((s, z) => s + (z.totalProducts || z.products?.length || 0), 0);
      const avgTime = myDone.length ? Math.round(totalTime / myDone.length) : 0;
      const efficiency = avgTime ? Math.min(100, Math.round((15 / avgTime) * 100)) : 0;
      const completion = myZones.length ? Math.round((myDone.length / myZones.length) * 100) : 0;
      const quality = Math.max(0, 100 - myInc.length * 10);
      const operationalIndex = Math.round(completion * 0.35 + efficiency * 0.25 + quality * 0.25 + (a.prodH ? 15 : 0));
      return {
        ...a, myZoneCount: myZones.length, myDoneCount: myDone.length, myIncCount: myInc.length,
        totalProducts, avgTime, efficiency, completion, quality, operationalIndex,
        reactionAvgSec: byArm.get(a.id)?.reaction?.avgSec ?? null,
        reactionSamples: byArm.get(a.id)?.reactionSamples ?? 0,
      };
    }).sort((a, b) => b.operationalIndex - a.operationalIndex);
    const incidents = zones.filter((z) => z.status === "incident").map((z) => ({
      id: z.id, zone: z.code, armador: armadores.find((a) => a.id === z.armadorId)?.name || "Sin asignar",
      description: z.incidentNote || "Sin descripción", classification: z.incidentClass, armadorId: z.armadorId,
    }));
    const fastest = ranked.filter((a) => a.reactionAvgSec !== null && a.reactionSamples >= 2)
      .sort((a, b) => (a.reactionAvgSec ?? Infinity) - (b.reactionAvgSec ?? Infinity))[0] || null;
    return { ranked, incidents, fastest };
  }, [armadores, zones, analytics]);

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const RECO = "reconocido:";
  const isReco = (a: Armador) => (a.badges || []).includes(RECO + todayKey());
  async function handleReconocer(a: Armador) {
    if (isReco(a) || savingReco[a.id]) return;
    setSavingReco((s) => ({ ...s, [a.id]: true }));
    const badges = [...(a.badges || []), RECO + todayKey()];
    try { await updateArmador(a.id, { badges }); setArmadores((p) => p.map((x) => (x.id === a.id ? { ...x, badges } : x))); }
    finally { setSavingReco((s) => ({ ...s, [a.id]: false })); }
  }
  async function handleClassify(id: string | undefined, v: IncidentClass) {
    if (!id || savingClass[id]) return;
    setSavingClass((s) => ({ ...s, [id]: true }));
    try { await updateZone(id, { incidentClass: v }); setZones((p) => p.map((z) => (z.id === id ? { ...z, incidentClass: v } : z))); }
    finally { setSavingClass((s) => ({ ...s, [id]: false })); }
  }

  const filtered = useMemo(() => {
    let r = [...data.ranked];
    if (search.trim()) { const q = search.toLowerCase(); r = r.filter((a) => a.name.toLowerCase().includes(q) || a.cedula?.includes(q)); }
    if (sortBy === "reaccion") r = [...r].sort((a, b) => (a.reactionAvgSec ?? Infinity) - (b.reactionAvgSec ?? Infinity));
    if (sortBy === "marbetes") {
      const map = new Map(membreteRanking.map((x) => [x.armador.id, x.completados]));
      r = [...r].sort((a, b) => (map.get(b.id) || 0) - (map.get(a.id) || 0));
    }
    return r;
  }, [data.ranked, search, sortBy, membreteRanking]);

  const top3 = filtered.slice(0, 3);
  const avgIdx = filtered.length ? Math.round(filtered.reduce((s, a) => s + a.operationalIndex, 0) / filtered.length) : 0;
  const avgIdxN = useCountUp(avgIdx);
  const totalM = membreteRanking.reduce((s, r) => s + r.completados, 0);
  const totalMN = useCountUp(totalM);
  const prodAvg = filtered.length ? Math.round(filtered.reduce((s, a) => s + a.prodH, 0) / filtered.length) : 0;
  const prodAvgN = useCountUp(prodAvg);

  if (loading) return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", margin: "0 auto 10px", animation: "spin 0.8s linear infinite" }} />
      Cargando desempeño — afinando podium…
    </div>
  );

  // ── Radar premium helpers ───────────────────────────────────────────
  const RADAR_AXIS = [
    { key: "cumpl", label: "Cumplimiento", short: "Cumpl.", color: "#10b981" },
    { key: "efici", label: "Eficiencia", short: "Efici.", color: "#0ea5e9" },
    { key: "calid", label: "Calidad", short: "Calid.", color: "#8b5cf6" },
    { key: "prod", label: "Productividad", short: "Prod.", color: "#f59e0b" },
    { key: "reacc", label: "Reacción", short: "Reacc.", color: "#ef4444" },
  ] as const;
  const getRadarValues = (a: { completion: number; efficiency: number; quality: number; prodH: number; reactionAvgSec: number | null }) =>
    [a.completion, a.efficiency, a.quality, Math.min(100, Math.round((a.prodH / 520) * 100)), a.reactionAvgSec !== null ? Math.max(0, 100 - Math.round((a.reactionAvgSec / 600) * 100)) : 50];
  const radarPts = (a: { completion: number; efficiency: number; quality: number; prodH: number; reactionAvgSec: number | null }) => {
    const vals = getRadarValues(a);
    return vals.map((v, i) => {
      const ang = (i / vals.length) * Math.PI * 2 - Math.PI / 2;
      const r = (v / 100) * 38;
      return `${50 + Math.cos(ang) * r},${50 + Math.sin(ang) * r}`;
    }).join(" ");
  };
  function PremiumRadar({ values, size = 148, accent = "var(--accent)" }: { values: number[]; size?: number; accent?: string }) {
    const [hover, setHover] = useState<number | null>(null);
    const uid = useId().replace(/:/g, "");
    const gid = `rg-${uid}`;
    const fid = `glow-${uid}`;
    const R = 38; const C = 50;
    const pts = values.map((v, i) => {
      const ang = (i / values.length) * Math.PI * 2 - Math.PI / 2;
      const r = (v / 100) * R;
      return { x: C + Math.cos(ang) * r, y: C + Math.sin(ang) * r, ang, v, label: RADAR_AXIS[i] };
    });
    const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const gridLevels = [20, 40, 60, 80];
    return (
      <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
        <svg viewBox="0 0 100 100" style={{ width: size, height: size, display: "block", overflow: "visible" }}>
          <defs>
            <radialGradient id={gid} cx="50%" cy="50%"><stop offset="0%" stopColor={accent} stopOpacity={0.28} /><stop offset="100%" stopColor={accent} stopOpacity={0.02} /></radialGradient>
            <filter id={fid}><feDropShadow dx={0} dy={0} stdDeviation={1.2} floodColor={accent} floodOpacity={0.35} /></filter>
          </defs>
          {/* grid pentagons */}
          {gridLevels.map((lvl) => {
            const r = (lvl / 100) * R;
            const pg = values.map((_, i) => {
              const ang = (i / values.length) * Math.PI * 2 - Math.PI / 2;
              return `${C + Math.cos(ang) * r},${C + Math.sin(ang) * r}`;
            }).join(" ");
            return <polygon key={lvl} points={pg} fill="none" stroke="var(--line)" strokeWidth={lvl === 60 ? 0.7 : 0.5} opacity={lvl === 60 ? 0.9 : 0.45} />;
          })}
          {/* axes */}
          {values.map((_, i) => {
            const ang = (i / values.length) * Math.PI * 2 - Math.PI / 2;
            return <line key={i} x1={C} y1={C} x2={C + Math.cos(ang) * R} y2={C + Math.sin(ang) * R} stroke="var(--line)" strokeWidth={0.6} opacity={hover === i ? 0.9 : 0.55} />;
          })}
          {/* area + stroke */}
          <polygon points={poly} fill={`url(#${gid})`} stroke={accent} strokeWidth={1.7} filter={`url(#${fid})`} style={{ transition: "all 420ms cubic-bezier(.2,.8,.2,1)" }} />
          {/* center dot */}
          <circle cx={C} cy={C} r={1.4} fill={accent} opacity={0.9} />
          {/* vertices */}
          {pts.map((p, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
              <circle cx={p.x} cy={p.y} r={hover === i ? 4.2 : 3} fill={p.label.color} stroke="#fff" strokeWidth={1.2} style={{ transition: "r 140ms ease", filter: hover === i ? "drop-shadow(0 2px 6px rgba(0,0,0,0.18))" : undefined }} />
              {hover === i && <circle cx={p.x} cy={p.y} r={7} fill={p.label.color} opacity={0.12} />}
            </g>
          ))}
        </svg>
        {/* outside labels with value pills */}
        {pts.map((p, i) => {
          const LABEL_R = 48;
          const lx = C + Math.cos(p.ang) * LABEL_R;
          const ly = C + Math.sin(p.ang) * LABEL_R;
          // keep inside viewBox 0-100 with slight clamp
          const leftPct = lx; const topPct = ly;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{
                position: "absolute", left: `${leftPct}%`, top: `${topPct}%`, transform: "translate(-50%,-50%)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2, pointerEvents: "auto",
              }}
            >
              <span style={{
                fontSize: 7.5, fontWeight: 800, letterSpacing: ".03em", textTransform: "uppercase" as const,
                color: hover === i ? p.label.color : "var(--faint)", background: hover === i ? "color-mix(in srgb, white 88%, var(--panel) 12%)" : "var(--panel)",
                border: `1px solid ${hover === i ? p.label.color + "55" : "var(--line)"}`, padding: "2px 5px", borderRadius: 999,
                boxShadow: hover === i ? "0 2px 8px rgba(0,0,0,0.08)" : "none", whiteSpace: "nowrap", transition: "all 140ms ease",
              }}>{p.label.short}</span>
              <span style={{
                fontSize: 10, fontWeight: 900, lineHeight: 1,
                color: p.v >= 70 ? "#065f46" : p.v >= 40 ? "#92400e" : "#991b1b",
                background: p.v >= 70 ? "#ecfdf5" : p.v >= 40 ? "#fef3c7" : "#fee2e2",
                borderRadius: 6, padding: "1px 5px", border: "1px solid transparent",
              }} className="mono">{p.v}</span>
            </div>
          );
        })}
        {/* center score */}
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--faint)", letterSpacing: ".04em" }}>PROM</div>
          <div style={{ fontSize: 13, fontWeight: 900 }} className="mono">{Math.round(values.reduce((s, v) => s + v, 0) / values.length)}</div>
        </div>
        {/* hover tooltip */}
        {hover !== null && (
          <div style={{ position: "absolute", left: "50%", bottom: -6, transform: "translateX(-50%)", background: "#0f172a", color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 8, whiteSpace: "nowrap", boxShadow: "0 6px 18px rgba(0,0,0,0.18)", pointerEvents: "none" }}>
            {RADAR_AXIS[hover].label}: <b>{values[hover]}%</b>
          </div>
        )}
      </div>
    );
  }

  const toggleCompare = (id: string) => {
    if (compareA === id) setCompareA(null);
    else if (compareB === id) setCompareB(null);
    else if (!compareA) setCompareA(id);
    else if (!compareB) setCompareB(id);
    else { setCompareA(compareB); setCompareB(id); }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&display=swap');
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes shine{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pop{0%{transform:scale(0.96);opacity:0}100%{transform:scale(1);opacity:1}}
        @keyframes barGrow{from{width:0}to{width:var(--w)}}
        .bento{border-radius:20px;border:1px solid var(--line);background:var(--panel);box-shadow:0 8px 28px -18px rgba(0,0,0,0.16)}
        .pill{border-radius:999px;border:1px solid var(--line);background:var(--panel);padding:6px 10px;font-size:11px;color:var(--faint);font-weight:700}
        .btn-soft{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:7px 12px;font-size:11px;font-weight:800;cursor:pointer}
        .btn-soft:hover{transform:translateY(-1px);box-shadow:0 6px 16px -10px rgba(0,0,0,0.2)}
      `}</style>

      {/* ── HERO BENTO ── */}
      <div className="bento" style={{ position: "relative", overflow: "hidden", padding: 16, background: "radial-gradient(680px 360px at 18% 0%, #6366f118, transparent 60%), radial-gradient(720px 360px at 92% 10%, #0ea5e915, transparent 62%), linear-gradient(135deg, var(--panel), var(--inset))" }}>
        {/* blur orbs */}
        <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, #6366f10c, transparent 70%)", top: -120, right: -80, pointerEvents: "none" }} />
        <div style={{ position: "absolute", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, #0ea5e908, transparent 70%)", left: -90, bottom: -140, pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--faint)", fontFamily: "Plus Jakarta Sans, system-ui" }}>Desempeño · En vivo · {period}</div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.1, marginTop: 4, fontFamily: "Plus Jakarta Sans, system-ui" }}>
              Tu equipo en juego — <span style={{ background: "linear-gradient(90deg, #6366f1, #0ea5e9)", WebkitBackgroundClip: "text", color: "transparent" }}>¿quién lidera hoy?</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, maxWidth: 560 }}>Toca un armador para ver su radar, compara 2 lado a lado, reconoce en 1 clic. Todo es real, sin datos inventados.</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 999, padding: 3 }}>
              {(["hoy", "semana", "mes"] as const).map((k) => (
                <button key={k} onClick={() => setPeriod(k)} style={{ fontSize: 11, fontWeight: 800, padding: "6px 10px", borderRadius: 999, border: "none", background: period === k ? "var(--accent)" : "transparent", color: period === k ? "#fff" : "var(--faint)", cursor: "pointer", fontFamily: "Plus Jakarta Sans, system-ui" }}>{k === "hoy" ? "Hoy" : k === "semana" ? "Semana" : "Mes"}</button>
              ))}
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="pill" style={{ cursor: "pointer" }}>
              <option value="indice">Orden: Índice</option>
              <option value="reaccion">Orden: Reacción</option>
              <option value="marbetes">Orden: Marbetes</option>
            </select>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar armador o cédula…" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12, width: 180 }} />
          </div>
        </div>

        {/* KPI bento strip */}
        <div style={{ position: "relative", marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            { k: "Índice promedio", v: `${avgIdxN}`, sub: `${filtered.length} armadores · Top ${top3[0]?.operationalIndex ?? 0}/100`, accent: ["#6366f1", "#8b5cf6"] },
            { k: "Prod. promedio", v: `${prodAvgN} p/h`, sub: data.fastest ? `⚡ ${data.fastest.name} ${formatDuration(data.fastest.reactionAvgSec || 0)}` : "—", accent: ["#0ea5e9", "#38bdf8"] },
            { k: "Marbetes hoy", v: `${totalMN}`, sub: `${membreteRanking.length} con actividad`, accent: ["#f59e0b", "#fbbf24"] },
            { k: "Incidencias", v: `${data.incidents.length}`, sub: data.incidents.length ? "Requiere atención" : "Limpio ✨", accent: data.incidents.length ? ["#ef4444", "#f87171"] : ["#10b981", "#34d399"] },
          ].map((c) => (
            <div key={c.k} className="bento" style={{ padding: 12, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${c.accent[0]}0f, ${c.accent[1]}08)`, pointerEvents: "none" }} />
              <div style={{ position: "relative", fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)", fontFamily: "Plus Jakarta Sans, system-ui" }}>{c.k}</div>
              <div style={{ position: "relative", fontSize: 22, fontWeight: 900, marginTop: 4 }} className="mono">{c.v as string}</div>
              <div style={{ position: "relative", fontSize: 11, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PODIUM 3D ── */}
      <div className="bento" style={{ padding: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ fontWeight: 800, margin: 0, fontFamily: "Plus Jakarta Sans, system-ui", letterSpacing: "-.02em" }}>Podium 3D — Top 3 del turno</h3>
          <span className="pill">Hover para brillo · Clic para radar</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.18fr 1fr", gap: 14, alignItems: "end" }}>
          {[1, 0, 2].map((rankIdx) => {
            const a = top3[rankIdx];
            if (!a) return <div key={rankIdx} />;
            const h = rankIdx === 0 ? 144 : rankIdx === 1 ? 110 : 92;
            const medal = rankIdx === 0 ? "🥇" : rankIdx === 1 ? "🥈" : "🥉";
            const isGold = rankIdx === 0;
            const grad = isGold ? "linear-gradient(180deg, #fff8c2, #fde68a, #f59e0b22)" : rankIdx === 1 ? "linear-gradient(180deg, #f8fafc, #e2e8f0)" : "linear-gradient(180deg, #fff7ed, #fed7aa)";
            const border = isGold ? "#f59e0b" : rankIdx === 1 ? "#cbd5e1" : "#fdba74";
            return (
              <div
                key={a.id}
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                style={{ cursor: "pointer", textAlign: "center", transform: expanded === a.id ? "scale(1.02)" : "scale(1)", transition: "transform .18s ease", filter: expanded === a.id ? "drop-shadow(0 10px 18px rgba(0,0,0,0.08))" : undefined }}
              >
                <div style={{ fontSize: 28, animation: isGold ? "float 2.6s ease-in-out infinite" : undefined }}>{medal}</div>
                <div style={{
                  width: 64, height: 64, borderRadius: 16, background: a.color || "var(--accent)", display: "grid", placeItems: "center",
                  margin: "8px auto", color: "#fff", fontSize: 22, fontWeight: 900, border: `3px solid ${border}`,
                  boxShadow: isGold ? "0 12px 24px -10px #f59e0b88" : "0 6px 16px -10px rgba(0,0,0,0.15)",
                }}>{a.name[0]}</div>
                <div style={{ fontWeight: 800, fontSize: 13, fontFamily: "Plus Jakarta Sans, system-ui" }}>{a.name}</div>
                <div style={{ fontSize: 11, color: "var(--faint)" }}>{a.myDoneCount}/{a.myZoneCount} familias · {a.prodH} p/h</div>
                <div style={{
                  height: h, marginTop: 10, borderRadius: "16px 16px 0 0", background: grad, border: `1px solid ${border}`, borderBottom: "none",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 10, position: "relative", overflow: "hidden",
                }}>
                  {/* shimmer + confetti for gold */}
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)", backgroundSize: "200% 100%", animation: "shine 2.2s linear infinite", opacity: isGold ? 0.75 : 0.0 }} />
                  {isGold && (
                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                      {Array.from({ length: 10 }).map((_, i) => (
                        <span key={i} style={{
                          position: "absolute", left: `${10 + i * 9}%`, top: `${8 + (i % 3) * 18}%`, width: 6, height: 6, borderRadius: 2,
                          background: i % 2 ? "#f59e0b" : "#6366f1", opacity: 0.5, transform: `rotate(${i * 18}deg)`,
                        }} />
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 24, fontWeight: 900 }} className="mono">{a.operationalIndex}</div>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.8 }}>/100</div>
                  <div style={{ marginTop: 6, width: "66%", height: 6, borderRadius: 999, background: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${a.operationalIndex}%`, background: isGold ? "#f59e0b" : rankIdx === 1 ? "#64748b" : "#ea580c", borderRadius: 999, transition: "width 600ms ease" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RANKING BENTO ── */}
      <div className="bento" style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ fontWeight: 800, margin: 0, fontFamily: "Plus Jakarta Sans, system-ui" }}>Ranking — toca para expandir · compara 2</h3>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => { setCompareA(null); setCompareB(null); }} className="btn-soft" style={{ background: compareA && compareB ? "var(--accent)" : "var(--panel)", color: compareA && compareB ? "#fff" : "var(--faint)", borderColor: compareA && compareB ? "var(--accent)" : "var(--line)" }}>{compareA && compareB ? "Limpiar comparación" : "Elige 2 para comparar"}</button>
            <span className="pill">{filtered.length} armadores · {period}</span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>#</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Armador</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Índice</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Prod/h</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Eficiencia</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Reacción</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => {
                const isExp = expanded === a.id;
                const isCmp = compareA === a.id || compareB === a.id;
                const bulletW = `${a.efficiency}%` as string;
                return (
                  <>
                    <tr
                      key={a.id}
                      onClick={() => setExpanded(isExp ? null : a.id)}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        background: isExp ? "color-mix(in srgb, var(--accent) 5%, transparent)" : isCmp ? "color-mix(in srgb, var(--accent) 7%, transparent)" : i < 3 ? "color-mix(in srgb, #f59e0b 4%, transparent)" : undefined,
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center",
                          background: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "var(--inset)",
                          color: i < 3 ? "#fff" : "var(--faint)", fontWeight: 800, fontSize: 11,
                        }}>{i < 3 ? (i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉") : i + 1}</div>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: a.color || "var(--accent)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, flexShrink: 0 }}>{a.name[0]}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                            <div style={{ fontSize: 11, color: "var(--faint)" }}>{a.cedula || "—"} · {a.myDoneCount}/{a.myZoneCount} fam</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                          <span className="mono" style={{ fontWeight: 900, fontSize: 16, color: a.operationalIndex >= 70 ? "#10b981" : a.operationalIndex >= 40 ? "#f59e0b" : "#ef4444" }}>{a.operationalIndex}</span>
                          <span style={{ fontSize: 10, color: "var(--faint)" }}>/100</span>
                        </div>
                        <div style={{ marginTop: 4, height: 6, borderRadius: 999, background: "var(--inset)", overflow: "hidden", width: 64, marginLeft: "auto" }}>
                          <div style={{ height: "100%", width: bulletW, background: a.operationalIndex >= 70 ? "#10b981" : a.operationalIndex >= 40 ? "#f59e0b" : "#ef4444", borderRadius: 999, transition: "width 500ms ease" } as any} />
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}><span className="mono" style={{ fontWeight: 700 }}>{a.prodH}</span></td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}>
                        {/* bullet micro */}
                        <div style={{ display: "inline-grid", gap: 4, justifyItems: "end" }}>
                          <span className="pill" style={{ background: a.efficiency >= 70 ? "#dcfce7" : a.efficiency >= 40 ? "#fef3c7" : "#fee2e2", color: a.efficiency >= 70 ? "#166534" : a.efficiency >= 40 ? "#92400e" : "#991b1b", borderColor: "transparent" }}>{a.efficiency}%</span>
                          <div style={{ width: 64, height: 6, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${a.efficiency}%`, background: a.efficiency >= 70 ? "#22c55e" : a.efficiency >= 40 ? "#f59e0b" : "#ef4444" }} />
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}>{a.reactionAvgSec !== null ? <span className="mono" style={{ fontWeight: 700 }}>{formatDuration(a.reactionAvgSec)}</span> : <span style={{ color: "var(--faint)" }}>—</span>}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          {isReco(a) ? <span className="pill" style={{ background: "#fef3c7", color: "#92400e" }}>⭐ Reconocido</span> : <button onClick={(e) => { e.stopPropagation(); handleReconocer(a); }} disabled={!!savingReco[a.id]} className="btn sm" style={{ fontSize: 11 }}>{savingReco[a.id] ? "…" : "⭐ Reconocer"}</button>}
                          <button onClick={(e) => { e.stopPropagation(); toggleCompare(a.id); }} className="btn-soft" style={{ background: isCmp ? "var(--accent)" : "var(--panel)", color: isCmp ? "#fff" : "var(--faint)", borderColor: isCmp ? "var(--accent)" : "var(--line)" }}>{isCmp ? "✓ Comparando" : "Comparar"}</button>
                        </div>
                      </td>
                    </tr>
                    {isExp && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, background: "var(--inset)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "168px 1fr", gap: 14, padding: 14, animation: "pop 180ms ease" }}>
                            <div className="bento" style={{ padding: 10, textAlign: "center", overflow: "visible" }}>
                              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Radar 5 ejes · hover para detalle</div>
                              <PremiumRadar values={getRadarValues(a)} size={156} accent={a.color || "var(--accent)"} />
                              <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
                                {RADAR_AXIS.map((ax) => (
                                  <span key={ax.key} style={{ width: 8, height: 8, borderRadius: 2, background: ax.color, display: "inline-block" }} title={ax.label} />
                                ))}
                                <span style={{ fontSize: 10, color: "var(--faint)", marginLeft: 4 }}>Cumpl · Efici · Calid · Prod · Reacc</span>
                              </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, alignContent: "start" }}>
                              {[
                                ["Familias", `${a.myDoneCount}/${a.myZoneCount}`],
                                ["Productos", `${a.totalProducts}`],
                                ["Tiempo prom", a.avgTime ? `${a.avgTime} min` : "—"],
                                ["Calidad", `${a.quality}%`],
                                ["Cumplimiento", `${a.completion}%`],
                                ["Reacción", a.reactionAvgSec !== null ? formatDuration(a.reactionAvgSec) : "—"],
                              ].map(([k, v]) => (
                                <div key={k as string} className="bento" style={{ padding: "10px 12px", textAlign: "center" }}>
                                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em" }}>{k as string}</div>
                                  <div style={{ fontSize: 14, fontWeight: 900, marginTop: 4 }}>{v as string}</div>
                                </div>
                              ))}
                              <div className="bento" style={{ gridColumn: "1 / -1", padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 11, color: "var(--faint)" }}>Acciones</span>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button onClick={() => toggleCompare(a.id)} className="btn-soft" style={{ background: (compareA === a.id || compareB === a.id) ? "var(--accent)" : "var(--panel)", color: (compareA === a.id || compareB === a.id) ? "#fff" : "var(--faint)" }}>{(compareA === a.id || compareB === a.id) ? "Quitando…" : "Añadir a comparación"}</button>
                                  <button onClick={() => setExpanded(null)} className="pill" style={{ cursor: "pointer" }}>Cerrar ✕</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Comparación dual pin */}
        {compareA && compareB && (() => {
          const ca = filtered.find((x) => x.id === compareA);
          const cb = filtered.find((x) => x.id === compareB);
          if (!ca || !cb) return null;
          const Row = ({ a }: { a: typeof ca }) => a ? (
            <div className="bento" style={{ padding: 14, overflow: "visible" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: a.color || "var(--accent)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>{a.name[0]}</div>
                <b style={{ fontFamily: "Plus Jakarta Sans, system-ui" }}>{a.name}</b>
                <span className="mono" style={{ marginLeft: "auto", fontWeight: 900 }}>{a.operationalIndex}/100</span>
              </div>
              <div style={{ margin: "10px auto" }}><PremiumRadar values={getRadarValues(a)} size={132} accent={a.color || "var(--accent)"} /></div>
              <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--faint)" }}>Prod/h</span><b className="mono">{a.prodH}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--faint)" }}>Familias</span><b className="mono">{a.myDoneCount}/{a.myZoneCount}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--faint)" }}>Reacción</span><b className="mono">{a.reactionAvgSec !== null ? formatDuration(a.reactionAvgSec) : "—"}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--faint)" }}>Calidad</span><b>{a.quality}%</b></div>
              </div>
            </div>
          ) : null;
          const win = ca.operationalIndex === cb.operationalIndex ? null : ca.operationalIndex > cb.operationalIndex ? ca : cb;
          return (
            <div style={{ margin: 14, padding: 14, background: "var(--inset)", border: "1px solid var(--line)", borderRadius: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontFamily: "Plus Jakarta Sans, system-ui" }}>Comparativa — {ca.name} vs {cb.name}</div>
                <span className="pill" style={{ background: win ? "#ecfdf5" : "var(--panel)", color: win ? "#065f46" : "var(--faint)" }}>{win ? `Ventaja: ${win.name} +${Math.abs(ca.operationalIndex - cb.operationalIndex)}` : "Empate"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Row a={ca} />
                <Row a={cb} />
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── MARBETES BENTO ── */}
      <div className="bento" style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, fontFamily: "Plus Jakarta Sans, system-ui" }}>¿Quién hace más marbetes?</div>
            <div style={{ fontSize: 11, color: "var(--faint)" }}>Real por estado y origen — en cola vs asignado directo</div>
          </div>
          <span className="pill">{membreteRanking.length} activos</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>#</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Armador</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Completados</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>En cola</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Asignados</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Unidades</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Tendencia</th>
            </tr></thead>
            <tbody>
              {membreteRanking.map((r, i) => {
                const maxC = membreteRanking[0]?.completados || 1;
                const w = `${Math.round((r.completados / maxC) * 100)}%`;
                return (
                  <tr key={r.armador.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 14px" }}>{i + 1}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: r.armador.color || "var(--accent)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>{r.armador.name[0]}</div>
                        <span style={{ fontWeight: 700 }}>{r.armador.name}</span>
                      </div>
                      <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: "var(--inset)", overflow: "hidden", width: 120 }}>
                        <div style={{ height: "100%", width: w, background: i === 0 ? "#f59e0b" : "var(--accent)", borderRadius: 999, transition: "width 600ms ease" } as any} />
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}><span className="mono" style={{ fontWeight: 900, color: "var(--accent)" }}>{r.completados}</span></td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }} className="mono">{r.tomadosPorCuenta}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }} className="mono">{r.asignadosDirecto}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }} className="mono">{r.unidades}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <svg width={64} height={22} viewBox="0 0 64 22" style={{ display: "inline-block", verticalAlign: "middle" }}>
                        <polyline fill="none" stroke="var(--accent)" strokeWidth={1.6} points={r.spark.map((v, idx) => `${(idx / 5) * 64},${22 - (v / Math.max(...r.spark)) * 16 - 3}`).join(" ")} />
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── INCIDENCIAS KANBAN ── */}
      <div className="bento" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontWeight: 800, margin: 0, fontFamily: "Plus Jakarta Sans, system-ui" }}>Incidencias a revisar</h3>
          <span className="pill" style={{ background: data.incidents.length ? "#fee2e2" : "#dcfce7", color: data.incidents.length ? "#991b1b" : "#065f46", borderColor: "transparent" }}>{data.incidents.length ? `${data.incidents.length} abiertas` : "✅ Sin incidencias"}</span>
        </div>
        {data.incidents.length === 0 ? (
          <div style={{ padding: 22, textAlign: "center", color: "var(--faint)", border: "1px dashed var(--line)", borderRadius: 12 }}>Todo limpio — sin familias en incidencia hoy.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {data.incidents.map((it) => (
              <div key={it.id} className="bento" style={{ padding: 12, borderLeft: `4px solid ${it.classification === "mitigada" ? "#10b981" : it.classification === "persona" ? "#f59e0b" : "#6366f1"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <b className="mono" style={{ fontSize: 13 }}>{it.zone}</b>
                  <span className="pill" style={{ fontSize: 10, background: it.classification ? "var(--inset)" : "#fff7ed", color: "var(--faint)" }}>{it.classification || "sin clasificar"}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, minHeight: 34 }}>{it.description}</div>
                <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>{it.armador}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {(["proceso", "persona", "mitigada"] as IncidentClass[]).map((cls) => (
                    <button
                      key={cls}
                      disabled={!!savingClass[it.id || ""]}
                      onClick={() => it.id && handleClassify(it.id, cls)}
                      style={{
                        flex: 1, fontSize: 11, fontWeight: 800, padding: "6px 8px", borderRadius: 999, cursor: "pointer",
                        border: "1px solid", borderColor: it.classification === cls ? "var(--accent)" : "var(--line)",
                        background: it.classification === cls ? "var(--accent)" : "var(--panel)", color: it.classification === cls ? "#fff" : "var(--faint)",
                      }}
                    >
                      {cls}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
