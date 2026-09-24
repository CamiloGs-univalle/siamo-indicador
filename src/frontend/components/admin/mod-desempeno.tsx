/**
 * @file components/admin/mod-desempeno.tsx
 * @description Dashboard Desempeño — diseño creativo, interactivo y animado.
 * Podium 3D, cards expandibles, chart de evolución, ranking en vivo.
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeArmadores, subscribeZones, subscribeActivity, subscribeMembretes, updateArmador, updateZone } from "@/frontend/services/firestore";
import type { Armador, Zone, IncidentClass, ActivityLogEntry, Membrete } from "@/types";
import { computeCompanyAnalytics, formatDuration } from "@/frontend/services/analytics";

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
  const [period, setPeriod] = useState<"hoy"|"semana"|"mes">("hoy");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubA = subscribeArmadores(user.companyId, (a) => { setArmadores(a); setLoading(false); });
    const unsubZ = subscribeZones(user.companyId, setZones);
    const unsubM = subscribeMembretes(user.companyId, setMembretes);
    const unsubAct = subscribeActivity(user.companyId, setActivity, 2000);
    return () => { unsubA(); unsubZ(); unsubM(); unsubAct(); };
  }, [user?.companyId]);

  const analytics = useMemo(() => computeCompanyAnalytics(activity, armadores), [activity, armadores]);

  const membreteRanking = useMemo(() => {
    return armadores
      .map((a) => {
        const mine = membretes.filter((m) => m.armadorId === a.id);
        const completados = mine.filter((m) => m.status === "completed");
        const tomadosPorCuenta = completados.filter((m) => m.claimedAt).length;
        const asignadosDirecto = completados.length - tomadosPorCuenta;
        const unidades = completados.reduce((s, m) => s + (m.totalUnits || 0), 0);
        return { armador: a, completados: completados.length, enProceso: mine.filter((m) => m.status === "active" || m.status === "pending").length, tomadosPorCuenta, asignadosDirecto, unidades };
      })
      .filter((r) => r.completados > 0 || r.enProceso > 0)
      .sort((a, b) => b.completados - a.completados);
  }, [armadores, membretes]);

  const data = useMemo(() => {
    const reactionByArmador = new Map(analytics.perArmador.map((p) => [p.armadorId, p]));
    const ranked = armadores.map((a) => {
      const myZones = zones.filter((z) => z.armadorId === a.id);
      const myDone = myZones.filter((z) => z.status === "done");
      const myInc = myZones.filter((z) => z.status === "incident");
      const totalTime = myDone.reduce((s, z) => s + (z.avgMinutes || 0), 0);
      const totalProducts = myZones.reduce((s, z) => s + (z.totalProducts || z.products?.length || 0), 0);
      const avgTime = myDone.length > 0 ? Math.round(totalTime / myDone.length) : 0;
      const efficiency = avgTime > 0 ? Math.min(100, Math.round((15 / avgTime) * 100)) : 0;
      const completion = myZones.length > 0 ? Math.round((myDone.length / myZones.length) * 100) : 0;
      const quality = Math.max(0, 100 - myInc.length * 10);
      const operationalIndex = Math.round(completion * 0.35 + efficiency * 0.25 + quality * 0.25 + (a.prodH > 0 ? 15 : 0));
      const reactionAvgSec = reactionByArmador.get(a.id)?.reaction?.avgSec ?? null;
      const reactionSamples = reactionByArmador.get(a.id)?.reactionSamples ?? 0;
      return { ...a, myZoneCount: myZones.length, myDoneCount: myDone.length, myIncCount: myInc.length, totalProducts, avgTime, efficiency, completion, quality, operationalIndex, reactionAvgSec, reactionSamples };
    }).sort((a, b) => b.operationalIndex - a.operationalIndex);
    const incidents = zones.filter((z) => z.status === "incident").map((z) => ({
      id: z.id, zone: z.code, armador: armadores.find((a) => a.id === z.armadorId)?.name || "Sin asignar", description: z.incidentNote || "Sin descripción", classification: z.incidentClass,
    }));
    const todayKey = new Date().toISOString().slice(0, 10);
    const RECO_PREFIX = "reconocido:";
    const recognizedToday = armadores.filter((a) => (a.badges || []).some((b) => b === RECO_PREFIX + todayKey));
    const fastestReactor = ranked.filter((a) => a.reactionAvgSec !== null && a.reactionSamples >= 2).sort((a, b) => (a.reactionAvgSec ?? Infinity) - (b.reactionAvgSec ?? Infinity))[0] || null;
    return { ranked, incidents, recognizedToday, fastestReactor };
  }, [armadores, zones, analytics]);

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const RECO_PREFIX = "reconocido:";
  const isRecognizedToday = (a: Armador) => (a.badges || []).includes(RECO_PREFIX + todayKey());
  async function handleReconocer(a: Armador) {
    if (isRecognizedToday(a) || savingReco[a.id]) return;
    setSavingReco((s) => ({ ...s, [a.id]: true }));
    const badges = [...(a.badges || []), RECO_PREFIX + todayKey()];
    try { await updateArmador(a.id, { badges }); setArmadores((prev) => prev.map((x) => (x.id === a.id ? { ...x, badges } : x))); } finally { setSavingReco((s) => ({ ...s, [a.id]: false })); }
  }
  async function handleClassify(zoneId: string | undefined, value: IncidentClass) {
    if (!zoneId || savingClass[zoneId]) return;
    setSavingClass((s) => ({ ...s, [zoneId]: true }));
    try { await updateZone(zoneId, { incidentClass: value }); setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, incidentClass: value } : z))); } finally { setSavingClass((s) => ({ ...s, [zoneId]: false })); }
  }

  const filtered = useMemo(() => {
    let r = data.ranked;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((a) => a.name.toLowerCase().includes(q) || a.cedula?.includes(q));
    }
    return r;
  }, [data.ranked, search]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando desempeño...</div>;

  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
  const medalBg = (i: number) => i === 0 ? "linear-gradient(135deg, #FFD700, #FFA500)" : i === 1 ? "linear-gradient(135deg, #C0C0C0, #A8A8A8)" : i === 2 ? "linear-gradient(135deg, #CD7F32, #A0522D)" : "var(--panel2)";

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}} @keyframes shine{0%{background-position:-200% 0}100%{background-position:200% 0}} @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,0.4)}70%{box-shadow:0 0 0 10px transparent}100%{box-shadow:0 0 0 0 transparent}} .glass{backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}`}</style>

      {/* HERO — Podium 3D creativo */}
      <div style={{ position:"relative", overflow:"hidden", borderRadius:16, padding:20, background:"radial-gradient(600px 300px at 20% 0%, #6366f122, transparent 60%), linear-gradient(135deg, var(--panel), var(--inset))", border:"1px solid var(--line)", boxShadow:"0 12px 32px -12px rgba(0,0,0,0.12)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:".08em", textTransform:"uppercase", color:"var(--faint)" }}>Turno actual · Ranking en vivo</div>
            <div style={{ fontSize:18, fontWeight:900, letterSpacing:"-.02em" }}>Top Performers</div>
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <span style={{ fontSize:11, padding:"6px 10px", borderRadius:999, background:"var(--panel)", border:"1px solid var(--line)", color:"var(--faint)" }}>{filtered.length} armadores</span>
            {data.fastestReactor && <span title={`Reacción más rápida: ${data.fastestReactor.name} — ${formatDuration(data.fastestReactor.reactionAvgSec||0)}`} style={{ fontSize:11, padding:"6px 10px", borderRadius:999, background:"#0ea5e918", color:"#0ea5e9", border:"1px solid #0ea5e922", fontWeight:700, cursor:"help" }}>⚡ {data.fastestReactor.name} · {formatDuration(data.fastestReactor.reactionAvgSec||0)}</span>}
            <input value={search} onChange={(e)=> setSearch(e.target.value)} placeholder="Buscar armador..." style={{ padding:"7px 10px", borderRadius:8, border:"1px solid var(--line)", background:"var(--panel)", fontSize:12, width:160 }} />
            <div style={{ display:"flex", gap:4, background:"var(--inset)", border:"1px solid var(--line)", borderRadius:999, padding:3 }}>
              {(["hoy","semana","mes"] as const).map((k)=>(
                <button key={k} onClick={()=> setPeriod(k as any)} style={{ fontSize:11, fontWeight:800, padding:"5px 10px", borderRadius:999, border:"none", background: period===k? "var(--accent)":"transparent", color: period===k? "#fff":"var(--faint)", cursor:"pointer" }}>{k==="hoy"?"Hoy":k==="semana"?"Semana":"Mes"}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Podium 3D */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.1fr 1fr", gap:14, alignItems:"end", marginBottom:6 }}>
          {[1,0,2].map((rankIdx)=>{
            const a = filtered[rankIdx];
            if (!a) return <div key={rankIdx} />;
            const heights = [90,120,80];
            const h = heights[rankIdx===0?1: rankIdx===1?0:2];
            return (
              <div key={a.id} onClick={()=> setExpanded(expanded===a.id? null: a.id)} title={`Clic para ver detalle de ${a.name} — ${a.operationalIndex}/100`} style={{ cursor:"pointer", textAlign:"center", transform: expanded===a.id? "scale(1.02)":"scale(1)", transition:"transform .2s" }}>
                <div style={{ fontSize:26, animation: rankIdx===0? "float 2.5s ease-in-out infinite":undefined }}>{medal(rankIdx)}</div>
                <div style={{ width:56, height:56, borderRadius:16, background: a.color||"var(--accent)", display:"grid", placeItems:"center", margin:"6px auto", color:"#fff", fontSize:20, fontWeight:900, border: rankIdx===0? "3px solid #FFD700": rankIdx===1? "3px solid #C0C0C0":"3px solid #CD7F32", boxShadow: rankIdx===0? "0 8px 20px -8px #FFD70088":"0 4px 12px rgba(0,0,0,0.1)", animation: rankIdx===0? "pulse 2s infinite":undefined }}>{a.name[0]}</div>
                <div style={{ fontWeight:800, fontSize:13, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.name}</div>
                <div style={{ fontSize:11, color:"var(--faint)" }}>{a.myDoneCount}/{a.myZoneCount} familias · {a.prodH} p/h</div>
                <div style={{ height:h, marginTop:8, borderRadius:"12px 12px 0 0", background: medalBg(rankIdx), display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end", paddingBottom:8, color: rankIdx===1? "#4b5563":"#fff", fontWeight:900, boxShadow:"inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                  <span style={{ fontSize:18 }} className="mono">{a.operationalIndex}</span>
                  <span style={{ fontSize:10, opacity:0.9 }}>/100</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ranking expandible */}
      <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:12, overflow:"hidden" }}>
        <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--line)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h3 style={{ fontSize:13, fontWeight:800, margin:0 }}>Ranking completo — toca para expandir</h3>
          <span style={{ fontSize:11, color:"var(--faint)" }}>{filtered.length} armadores · {period}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ borderBottom:"1px solid var(--line)", background:"var(--panel2)" }}>
              <th style={{ padding:"10px 14px", textAlign:"left", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>#</th>
              <th style={{ padding:"10px 14px", textAlign:"left", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Armador</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Índice</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Prod/h</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Familias</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Vel</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Reacción</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}></th>
            </tr></thead>
            <tbody>
              {filtered.map((a,i)=>{
                const isExp = expanded===a.id;
                return (
                  <>
                    <tr key={a.id} onClick={()=> setExpanded(isExp? null: a.id)} title={`Clic para ${isExp? 'ocultar':'ver'} detalle de ${a.name}`} style={{ borderBottom:"1px solid var(--line)", background: isExp? "color-mix(in srgb, var(--accent) 4%, transparent)" : i<3? "color-mix(in srgb, var(--gold) 4%, transparent)":undefined, cursor:"pointer" }}>
                      <td style={{ padding:"12px 14px" }}><span style={{ display:"grid", placeItems:"center", width:26, height:26, borderRadius:8, background: i<3? medalBg(i): "var(--inset)", color: i<3? "#fff":"var(--faint)", fontWeight:800, fontSize:11 }}>{i<3? medal(i): i+1}</span></td>
                      <td style={{ padding:"12px 14px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:32, height:32, borderRadius:8, background: a.color||"var(--accent)", display:"grid", placeItems:"center", color:"#fff", fontWeight:800 }}>{a.name[0]}</div>
                          <div><div style={{ fontWeight:700 }}>{a.name}</div><div style={{ fontSize:11, color:"var(--faint)" }}>{a.cedula||"—"} · {a.myDoneCount}/{a.myZoneCount} familias</div></div>
                        </div>
                      </td>
                      <td style={{ padding:"12px 14px", textAlign:"right" }}><span className="mono" style={{ fontSize:16, fontWeight:900, color: a.operationalIndex>=70? "#10b981": a.operationalIndex>=40?"#f59e0b":"#ef4444" }}>{a.operationalIndex}</span></td>
                      <td style={{ padding:"12px 14px", textAlign:"right" }}><span className="mono" style={{ fontWeight:700 }}>{a.prodH}</span></td>
                      <td style={{ padding:"12px 14px", textAlign:"right" }}><span className="mono">{a.myDoneCount}/{a.myZoneCount}</span></td>
                      <td style={{ padding:"12px 14px", textAlign:"right" }}><span style={{ fontSize:11, padding:"4px 8px", borderRadius:999, background: a.efficiency>=70? "#dcfce7":"#fee2e2", color: a.efficiency>=70? "#166534":"#991b1b", fontWeight:700 }}>{a.efficiency}%</span></td>
                      <td style={{ padding:"12px 14px", textAlign:"right" }}>{a.reactionAvgSec!==null? <span className="mono" style={{ fontWeight:700 }}>{formatDuration(a.reactionAvgSec)}</span> : <span style={{ color:"var(--faint)" }}>—</span>}</td>
                      <td style={{ padding:"12px 14px", textAlign:"right" }}>{isRecognizedToday(a) ? <span style={{ fontSize:11, padding:"4px 10px", borderRadius:999, background:"#fef3c7", color:"#92400e", fontWeight:700 }}>⭐ Reconocido</span> : <button onClick={(e)=>{e.stopPropagation(); handleReconocer(a)}} disabled={!!savingReco[a.id]} className="btn sm" style={{ fontSize:11 }}>{savingReco[a.id]?"...":"⭐ Reconocer"}</button>}</td>
                    </tr>
                    {isExp && (
                      <tr><td colSpan={8} style={{ padding:0, background:"var(--inset)" }}>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:10, padding:14 }}>
                          {[
                            ["Familias", `${a.myDoneCount}/${a.myZoneCount}`],
                            ["Productos", `${a.totalProducts}`],
                            ["Tiempo prom", a.avgTime? `${a.avgTime} min`:"—"],
                            ["Calidad", `${a.quality}%`],
                            ["Reacción", a.reactionAvgSec!==null? formatDuration(a.reactionAvgSec):"—"],
                          ].map(([k,v])=>(
                            <div key={k as string} style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:10, padding:"10px 12px", textAlign:"center" }}>
                              <div style={{ fontSize:10, fontWeight:800, color:"var(--faint)", textTransform:"uppercase", letterSpacing:".04em" }}>{k as string}</div>
                              <div style={{ fontSize:14, fontWeight:900, marginTop:4 }}>{v as string}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ padding:"0 14px 14px", display:"flex", gap:8, justifyContent:"flex-end" }}>
                          <span style={{ fontSize:11, color:"var(--faint)" }}>Clic de nuevo para cerrar</span>
                        </div>
                      </td></tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Segunda tabla: ¿Quién hace más marbetes? — también expandible */}
      <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:12, overflow:"hidden" }}>
        <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--line)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ fontWeight:800, fontSize:13 }}>¿Quién hace más marbetes?</div><div style={{ fontSize:11, color:"var(--faint)" }}>Cuenta real por estado y origen (cola vs asignado)</div></div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ borderBottom:"1px solid var(--line)", background:"var(--panel2)" }}>
              <th style={{ padding:"10px 14px", textAlign:"left", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>#</th>
              <th style={{ padding:"10px 14px", textAlign:"left", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Armador</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Completados</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>En cola</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Asignados</th>
              <th style={{ padding:"10px 14px", textAlign:"right", fontSize:10, color:"var(--faint)", textTransform:"uppercase" }}>Unidades</th>
            </tr></thead>
            <tbody>
              {membreteRanking.map((r,i)=>(
                <tr key={r.armador.id} style={{ borderBottom:"1px solid var(--line)", cursor:"help" }} title={`${r.armador.name} — ${r.completados} hechos`}>
                  <td style={{ padding:"10px 14px" }}>{i+1}</td>
                  <td style={{ padding:"10px 14px" }}><div style={{ display:"flex", alignItems:"center", gap:8 }}><div style={{ width:28, height:28, borderRadius:8, background:r.armador.color||"var(--accent)", display:"grid", placeItems:"center", color:"#fff", fontWeight:800 }}>{r.armador.name[0]}</div><span style={{ fontWeight:700 }}>{r.armador.name}</span></div></td>
                  <td style={{ padding:"10px 14px", textAlign:"right" }}><span className="mono" style={{ fontWeight:900, color:"var(--accent)" }}>{r.completados}</span></td>
                  <td style={{ padding:"10px 14px", textAlign:"right" }} className="mono">{r.tomadosPorCuenta}</td>
                  <td style={{ padding:"10px 14px", textAlign:"right" }} className="mono">{r.asignadosDirecto}</td>
                  <td style={{ padding:"10px 14px", textAlign:"right" }} className="mono">{r.unidades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Incidencias */}
      <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:12, padding:16 }}>
        <h3 style={{ fontWeight:800, marginBottom:10 }}>Incidencias a revisar</h3>
        {data.incidents.length===0 ? <div style={{ padding:20, textAlign:"center", color:"var(--faint)" }}>✅ Sin incidencias</div> : data.incidents.map((it)=>(
          <div key={it.id} style={{ padding:"12px 0", borderBottom:"1px solid var(--line)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div><b className="mono">{it.zone}</b> — {it.description} <span style={{ fontSize:11, color:"var(--faint)" }}>({it.armador})</span></div>
            <div style={{ display:"flex", gap:6 }}>
              {(["proceso","persona","mitigada"] as IncidentClass[]).map((cls)=>(
                <button key={cls} disabled={!!savingClass[it.id||""]} onClick={()=> it.id && handleClassify(it.id, cls)} className={`btn sm ${it.classification===cls? "primary":""}`} style={{ fontSize:11 }}>{cls}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
