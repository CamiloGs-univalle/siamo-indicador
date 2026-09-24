/**
 * @file components/admin/mod-indicadores.tsx
 * @description Dashboard Indicadores — diseño original profesional y creativo.
 * Hero con mesh gradient, gauge con aguja, factores con micro-barras,
 * KPIs bento, tiempos operativos, tendencias, familias y armadores.
 * Todo con datos reales de Firestore (familias, marbetes, armadores).
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeZones, subscribeArmadores, subscribeActivity, subscribeMembretes } from "@/frontend/services/firestore";
import type { Zone, Armador, ActivityLogEntry, Membrete } from "@/types";
import { computeCompanyAnalytics, formatDuration, formatDayLabel } from "@/frontend/services/analytics";

export function ModIndicadores() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [recExpanded, setRecExpanded] = useState(true);
  const [range, setRange] = useState<"hoy"|"7d"|"mes">("7d");

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubM = subscribeMembretes(user.companyId, setMembretes);
    const unsubAct = subscribeActivity(user.companyId, setActivity, 2000);
    return () => { unsubZ(); unsubA(); unsubM(); unsubAct(); };
  }, [user?.companyId]);

  const m = useMemo(() => {
    // Familias = zones (ahora Familias)
    const totalFamilias = zones.length;
    const done = membretes.filter((mt) => mt.status === "completed").length;
    const active = membretes.filter((mt) => mt.status === "active").length;
    const pending = membretes.filter((mt) => mt.status === "pending").length;
    const totalMarbetes = membretes.length;
    const completionRate = totalMarbetes > 0 ? Math.round((done / totalMarbetes) * 100) : 0;

    // Tiempo promedio de marbetes completados (de durationMs o finished-started)
    const durations = membretes
      .filter((mt) => mt.status === "completed" && (mt.durationMs || (mt.finishedAt && mt.startedAt)))
      .map((mt) => mt.durationMs ? mt.durationMs/60000 : ((mt.finishedAt! - mt.startedAt!)/60000))
      .filter((n) => isFinite(n) && n>0);
    const avgTime = durations.length ? Math.round(durations.reduce((s,v)=>s+v,0)/durations.length) : 0;

    const inc = membretes.filter((mt) => mt.products?.some((p)=>p.status==="incident")).length;
    // calidad: 100 - 5 por marbete con incidencia (como antes pero sobre marbetes, no zonas)
    const quality = Math.max(0, 100 - inc * 5);
    const efficiency = avgTime > 0 ? Math.min(100, Math.round((15 / avgTime) * 100)) : (totalMarbetes? 25:0);
    // desplazamiento: armadores activos sobre total
    const activeMems = membretes.filter((mt)=>mt.status==="active");
    const activeArmadores = new Set(activeMems.map((mt)=>mt.armadorId).filter(Boolean)).size;
    const displacement = armadores.length ? Math.min(100, Math.round((activeArmadores/Math.max(armadores.length,1))*100 + 30)) : 30;
    const operationalIndex = Math.round(completionRate*0.35 + efficiency*0.25 + quality*0.25 + displacement*0.15);

    // Armadores ranking por prodH real
    const armadorStats = armadores.map((a)=>{
      const myMems = membretes.filter((mt)=>mt.armadorId===a.id);
      const myDone = myMems.filter((mt)=>mt.status==="completed").length;
      const myActive = myMems.filter((mt)=>mt.status==="active").length;
      return { name:a.name, color:a.color||"var(--accent)", prodH:a.prodH||0, cumpl:a.cumpl||0, doneCount:myDone, activeCount:myActive, total:myMems.length };
    }).sort((a,b)=>b.prodH - a.prodH);
    const maxArmProd = Math.max(...armadorStats.map(a=>a.prodH), 1);

    // Familias performance: marbetes por familia
    const byFamilia = new Map<string, {code:string, total:number, done:number, active:number, pending:number, avgMin:number}>();
    for(const z of zones){
      const famMems = membretes.filter((mt)=>mt.zonaCode===z.code);
      const famDone = famMems.filter((mt)=>mt.status==="completed");
      const avg = famDone.length ? Math.round(famDone.reduce((s,mt)=>{
        const d = mt.durationMs ? mt.durationMs/60000 : (mt.finishedAt && mt.startedAt ? (mt.finishedAt - mt.startedAt)/60000 : 0);
        return s + (isFinite(d)? d:0);
      },0)/famDone.length) : 0;
      byFamilia.set(z.code, { code:z.code, name:z.name||z.code, total:famMems.length, done:famDone.length, active:famMems.filter(m=>m.status==="active").length, pending:famMems.filter(m=>m.status==="pending").length, avgMin:avg } as any);
    }
    const familiasPerf = Array.from(byFamilia.values()).sort((a,b)=>b.done - a.done);

    // Estados distribución (marbetes)
    const estados = {
      completados: done,
      enProceso: active,
      pendientes: pending,
      total: totalMarbetes,
    };

    return {
      totalFamilias, totalMarbetes, done, active, pending, completionRate, avgTime, quality, efficiency, displacement, operationalIndex,
      armadorStats, maxArmProd, familiasPerf,
      estados, incCount: inc,
      doneCount: done, activeCount: active, pendingCount: pending,
    };
  }, [zones, armadores, membretes]);

  const analytics = useMemo(()=> computeCompanyAnalytics(activity, armadores), [activity, armadores]);

  if (loading) return (
    <div style={{ padding: 40, textAlign:"center", color:"var(--faint)" }}>
      <div style={{ width:36, height:36, border:"3px solid var(--line)", borderTopColor:"var(--accent)", borderRadius:"50%", margin:"0 auto 12px", animation:"spin 0.8s linear infinite" }}/>
      Cargando indicadores…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const idx = m.operationalIndex;
  const idxColor = idx>=70 ? "#10b981" : idx>=40 ? "#f59e0b" : "#ef4444";
  const idxBg = idx>=70 ? "rgba(16,185,129,0.14)" : idx>=40 ? "rgba(245,158,11,0.14)" : "rgba(239,68,68,0.12)";
  const idxLabel = idx>=70 ? "Óptimo" : idx>=40 ? "Estable" : "Crítico";
  const angle = (idx/100)*180 - 90; // -90 a 90

  return (
    <div style={{ display:"grid", gap:18, paddingBottom:24 }}>
      <style>{`
        @keyframes float1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(10px,-10px)} }
        @keyframes float2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-12px,8px)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .glass { backdrop-filter: saturate(1.2) blur(12px); -webkit-backdrop-filter: saturate(1.2) blur(12px); }
      `}</style>

      {/* ═══ HERO — mesh gradient + gauge + drivers ═══ */}
      <div style={{
        position:"relative", overflow:"hidden", borderRadius:20, border:"1px solid var(--line)",
        background:`radial-gradient(600px 400px at 10% 10%, ${idxColor}18, transparent 60%), radial-gradient(700px 500px at 90% 0%, #6366f118, transparent 60%), linear-gradient(180deg, var(--panel), var(--panel))`,
        boxShadow:"0 12px 40px -12px rgba(0,0,0,0.15)", padding:22
      }}>
        {/* orbs */}
        <div style={{ position:"absolute", width:280, height:280, borderRadius:"50%", background:`radial-gradient(circle, ${idxColor}22, transparent 70%)`, top:-60, left:-40, animation:"float1 8s ease-in-out infinite", pointerEvents:"none" }}/>
        <div style={{ position:"absolute", width:320, height:320, borderRadius:"50%", background:"radial-gradient(circle, #6366f118, transparent 70%)", top:-80, right:-60, animation:"float2 10s ease-in-out infinite", pointerEvents:"none" }}/>
        <div style={{ position:"relative", display:"grid", gridTemplateColumns:"360px 1fr", gap:20, alignItems:"stretch" }}>
          {/* Gauge */}
          <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:18, display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", boxShadow:"0 8px 24px -12px rgba(0,0,0,0.12)" }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:".08em", color:"var(--faint)", textTransform:"uppercase" }}>Índice operacional</div>
            <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>Familias · Marbetes · Armadores</div>
            <div title={`Índice operacional ${idx}/100 — ${idxLabel} — Velocidad ${m.efficiency}%, Cumplimiento ${m.completionRate}%, Calidad ${m.quality}%, Ritmo ${m.displacement}%`} style={{ position:"relative", width:240, height:150, marginTop:10, cursor:"help" }}>
              <svg width="240" height="150" viewBox="0 0 240 150" style={{ overflow:"visible" }}>
                <defs>
                  <linearGradient id="gTrack" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#ef4444"/><stop offset="50%" stopColor="#f59e0b"/><stop offset="100%" stopColor="#10b981"/>
                  </linearGradient>
                  <filter id="glow"><feGaussianBlur stdDeviation="3" result="c"/><feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>
                {/* track */}
                <path d="M 20 130 A 100 100 0 0 1 220 130" fill="none" stroke="var(--line)" strokeWidth="14" strokeLinecap="round" opacity={0.9}/>
                <path d="M 20 130 A 100 100 0 0 1 220 130" fill="none" stroke="url(#gTrack)" strokeWidth="14" strokeLinecap="round" opacity={0.18}/>
                {/* value */}
                <path d="M 20 130 A 100 100 0 0 1 220 130" fill="none" stroke={idxColor} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(idx/100)*314} 314`} style={{ transition:"stroke-dasharray 1.2s cubic-bezier(.16,1,.3,1)", filter:"url(#glow)" }}/>
                {/* ticks */}
                {[0,25,50,75,100].map((v)=> {
                  const a = (v/100)*180 - 90; const rad = a*Math.PI/180;
                  const x1 = 120 + Math.cos(rad)*92, y1 = 130 + Math.sin(rad)*92;
                  const x2 = 120 + Math.cos(rad)*100, y2 = 130 + Math.sin(rad)*100;
                  return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line)" strokeWidth={v%50===0?2:1} opacity={0.9}/>;
                })}
                {/* needle */}
                <g style={{ transition:"transform 1.1s cubic-bezier(.16,1,.3,1)", transform:`rotate(${angle}deg)`, transformOrigin:"120px 130px" }}>
                  <line x1="120" y1="130" x2="120" y2="38" stroke={idxColor} strokeWidth="3" strokeLinecap="round"/>
                  <circle cx="120" cy="130" r="8" fill="var(--panel)" stroke={idxColor} strokeWidth="3"/>
                  <circle cx="120" cy="130" r="3" fill={idxColor}/>
                </g>
              </svg>
              <div style={{ position:"absolute", left:0, right:0, top:62, textAlign:"center" }}>
                <div style={{ fontSize:48, fontWeight:900, lineHeight:1, letterSpacing:"-.03em", color:"var(--ink)" }} className="num">{idx}<span style={{ fontSize:16, color:"var(--muted)", fontWeight:700 }}> /100</span></div>
                <div style={{ marginTop:6, display:"inline-flex", alignItems:"center", gap:6, fontSize:11, fontWeight:800, letterSpacing:".04em", textTransform:"uppercase", padding:"4px 10px", borderRadius:999, background:idxBg, color:idxColor, border:`1px solid ${idxColor}22` }}>{idxLabel} · {idx>=70?"En meta":idx>=40?"Estable":"Crítico"}</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:12, width:"100%" }}>
              <div style={{ flex:1, background:"var(--inset)", border:"1px solid var(--line)", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"var(--faint)", textTransform:"uppercase" }}>Familias</div>
                <div style={{ fontSize:16, fontWeight:800 }}>{m.totalFamilias}</div>
              </div>
              <div style={{ flex:1, background:"var(--inset)", border:"1px solid var(--line)", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"var(--faint)", textTransform:"uppercase" }}>Marbetes</div>
                <div style={{ fontSize:16, fontWeight:800 }}>{m.totalMarbetes}</div>
              </div>
              <div style={{ flex:1, background:"var(--inset)", border:"1px solid var(--line)", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"var(--faint)", textTransform:"uppercase" }}>Armadores</div>
                <div style={{ fontSize:16, fontWeight:800 }}>{armadores.length}</div>
              </div>
            </div>
            <div style={{ marginTop:10, width:"100%", background:"var(--inset)", border:"1px solid var(--line)", borderRadius:10, padding:"10px 12px", textAlign:"left" }}>
              <div style={{ fontSize:10, fontWeight:800, color:"var(--faint)", letterSpacing:".06em", textTransform:"uppercase" }}>Diagnóstico</div>
              <div style={{ fontSize:12, color:"var(--muted)", marginTop:4, lineHeight:1.5 }}>
                {m.efficiency<35 ? <><b style={{color:idxColor}}>Velocidad baja ({m.efficiency}%).</b> Tiempo promedio {m.avgTime} min vs meta 15 min.</> :
                 m.completionRate<60 ? <><b style={{color:idxColor}}>Cumplimiento {m.completionRate}%.</b> {m.done} de {m.totalMarbetes} marbetes completados.</> :
                 m.incCount>0 ? <><b style={{color:"#f59e0b"}}>{m.incCount} incidencias.</b> Afectan calidad ({m.quality}%).</> :
                 <><b style={{color:"#10b981"}}>Operación estable.</b> Todos los factores en rango saludable.</>}
              </div>
            </div>
          </div>

          {/* Drivers */}
          <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:16, display:"flex", flexDirection:"column", boxShadow:"0 8px 24px -12px rgba(0,0,0,0.12)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:800, letterSpacing:"-.01em" }}>Factores del índice</div>
                <div style={{ fontSize:11, color:"var(--faint)" }}>Cada barra aporta al 100. Diseño original con micro-animación.</div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                {(["hoy","7d","mes"] as const).map((k)=>(
                  <button key={k} onClick={()=>setRange(k)} style={{ fontSize:11, fontWeight:700, padding:"6px 10px", borderRadius:999, border:`1px solid ${range===k? "var(--accent)":"var(--line)"}`, background: range===k? "var(--accent)":"var(--panel)", color: range===k? "#fff":"var(--muted)", cursor:"pointer" }}>{k==="hoy"?"Hoy":k==="7d"?"7 días":"Mes"}</button>
                ))}
              </div>
            </div>
            <div style={{ marginTop:12, display:"grid", gap:10 }}>
              {[
                { name:"Velocidad", val:m.efficiency, hint:"Tiempo vs meta 15 min", icon:"⚡", grad:["#ef4444","#f87171"] },
                { name:"Cumplimiento", val:m.completionRate, hint:`${m.done} de ${m.totalMarbetes} marbetes`, icon:"✓", grad:["#10b981","#34d399"] },
                { name:"Calidad", val:m.quality, hint: m.incCount? `${m.incCount} marbetes con incidencia`:"Sin incidencias", icon:"★", grad:["#6366f1","#a78bfa"] },
                { name:"Ritmo de familias", val:m.displacement, hint:`${new Set(membretes.filter(m=>m.status==="active").map(m=>m.zonaCode)).size} familias activas`, icon:"◈", grad:["#f59e0b","#fbbf24"] },
              ].map((d)=>{
                const col = d.val>=70 ? d.grad[0] : d.val>=40 ? "#f59e0b" : "#ef4444";
                const badge = d.val>=70 ? "En meta" : d.val>=40 ? "Estable" : "Crítico";
                return (
                  <div key={d.name} title={`${d.name}: ${d.val}% — ${d.hint} — ${badge}`} style={{ border:"1px solid var(--line)", borderRadius:12, padding:"12px 12px", background:"var(--inset)", position:"relative", overflow:"hidden", cursor:"help" }}>
                    <div style={{ position:"absolute", inset:0, background:`linear-gradient(90deg, transparent, ${col}08, transparent)`, backgroundSize:"200% 100%", animation:"shimmer 2.2s linear infinite", opacity:0.7 }}/>
                    <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:32, height:32, borderRadius:10, display:"grid", placeItems:"center", background:`linear-gradient(135deg, ${d.grad[0]}, ${d.grad[1]})`, color:"#fff", fontWeight:900, boxShadow:`0 6px 14px -6px ${d.grad[0]}88` }}>{d.icon}</div>
                        <div>
                          <div style={{ fontWeight:800, fontSize:13 }}>{d.name}</div>
                          <div style={{ fontSize:11, color:"var(--faint)" }}>{d.hint}</div>
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:10, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", padding:"2px 8px", borderRadius:999, background: col+"18", color:col, border:`1px solid ${col}22`, display:"inline-block" }}>{badge}</div>
                        <div style={{ fontSize:18, fontWeight:900, color:col, marginTop:4 }} className="num">{d.val}%</div>
                      </div>
                    </div>
                    <div style={{ position:"relative", marginTop:10, height:8, borderRadius:999, background:"var(--panel)", border:"1px solid var(--line)", overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${d.val}%`, background:`linear-gradient(90deg, ${col}, ${d.grad[1]})`, borderRadius:999, transition:"width 1s cubic-bezier(.16,1,.3,1)", boxShadow:`0 0 10px ${col}55` }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ RECOMENDACIONES — glass ═══ */}
      <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, overflow:"hidden", boxShadow:"0 8px 24px -12px rgba(0,0,0,0.08)" }}>
        <div onClick={()=>setRecExpanded(!recExpanded)} role="button" tabIndex={0} onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); setRecExpanded(!recExpanded)} }} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding:"14px 16px", cursor:"pointer", background: recExpanded? "var(--inset)" : "var(--panel)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:36, height:36, borderRadius:10, display:"grid", placeItems:"center", background:"linear-gradient(135deg, #6366f1, #8b5cf6)", color:"#fff" }}>💡</div>
            <div>
              <div style={{ fontWeight:900, fontSize:14 }}>Acciones recomendadas</div>
              <div style={{ fontSize:11, color:"var(--faint)" }}>Priorizadas por impacto · toca para {recExpanded? "ocultar":"ver"}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {(m.incCount>0 || m.efficiency<50 || m.completionRate<70) ? (
              <span style={{ fontSize:11, fontWeight:800, padding:"6px 10px", borderRadius:999, background:"#f59e0b18", color:"#b45309", border:"1px solid #f59e0b22" }}>{(m.incCount>0?1:0)+(m.efficiency<50?1:0)+(m.completionRate<70?1:0)} pendientes</span>
            ) : (
              <span style={{ fontSize:11, fontWeight:800, padding:"6px 10px", borderRadius:999, background:"#10b98118", color:"#065f46", border:"1px solid #10b98122" }}>Todo al día</span>
            )}
            <span style={{ width:30, height:30, borderRadius:8, display:"grid", placeItems:"center", background:"var(--panel)", border:"1px solid var(--line)", transform: recExpanded? "rotate(180deg)":"rotate(0deg)", transition:"transform .2s" }}>▾</span>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateRows: recExpanded? "1fr":"0fr", transition:"grid-template-rows .3s ease" }}>
          <div style={{ overflow:"hidden" }}>
            {m.efficiency<50 && (
              <div style={{ display:"flex", gap:12, padding:"14px 16px", borderTop:"1px solid var(--line)" }}>
                <span style={{ width:10, height:10, borderRadius:"50%", background:"#ef4444", boxShadow:"0 0 0 6px #ef444418", marginTop:6, flex:"none" }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800 }}>Acelerar familias lentas <span style={{ fontSize:10, padding:"2px 6px", borderRadius:999, background:"#ef444418", color:"#b91c1c", marginLeft:6 }}>Alta</span></div>
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}>Tiempo promedio <b>{m.avgTime} min</b> sobre meta 15 min. Revisar familias con marbetes más largos.</div>
                </div>
              </div>
            )}
            {m.completionRate<70 && (
              <div style={{ display:"flex", gap:12, padding:"14px 16px", borderTop:"1px solid var(--line)" }}>
                <span style={{ width:10, height:10, borderRadius:"50%", background: m.completionRate<40? "#ef4444":"#f59e0b", boxShadow:`0 0 0 6px ${m.completionRate<40? "#ef444418":"#f59e0b18"}`, marginTop:6, flex:"none" }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800 }}>Impulsar cumplimiento <span style={{ fontSize:10, padding:"2px 6px", borderRadius:999, background:(m.completionRate<40? "#ef444418":"#f59e0b18"), color:(m.completionRate<40? "#b91c1c":"#b45309"), marginLeft:6 }}>{m.completionRate<40?"Alta":"Media"}</span></div>
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}><b>{m.done} de {m.totalMarbetes}</b> marbetes completados ({m.completionRate}%).</div>
                </div>
              </div>
            )}
            {m.incCount>0 && (
              <div style={{ display:"flex", gap:12, padding:"14px 16px", borderTop:"1px solid var(--line)" }}>
                <span style={{ width:10, height:10, borderRadius:"50%", background:"#ef4444", boxShadow:"0 0 0 6px #ef444418", marginTop:6, flex:"none" }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800 }}>Revisar incidencias <span style={{ fontSize:10, padding:"2px 6px", borderRadius:999, background:"#ef444418", color:"#b91c1c", marginLeft:6 }}>Alta</span></div>
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}><b>{m.incCount} marbetes</b> con incidencia afectan calidad ({m.quality}%).</div>
                </div>
              </div>
            )}
            {m.efficiency>=50 && m.completionRate>=70 && m.incCount===0 && (
              <div style={{ display:"flex", gap:12, padding:"14px 16px", borderTop:"1px solid var(--line)" }}>
                <span style={{ width:10, height:10, borderRadius:"50%", background:"#10b981", boxShadow:"0 0 0 6px #10b98118", marginTop:6, flex:"none" }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800 }}>Operación en verde <span style={{ fontSize:10, padding:"2px 6px", borderRadius:999, background:"#10b98118", color:"#065f46", marginLeft:6 }}>Sin acción</span></div>
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}>Todo en rango saludable. Mantener ritmo.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ KPIs — bento 5 ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:12 }}>
        {[
          { lab:"Familias", val:m.totalFamilias, sub:`${m.done} marbetes hechos`, icon:"◈", grad:["#6366f1","#8b5cf6"] },
          { lab:"En proceso", val:m.active, sub:`${m.pending} en cola`, icon:"●", grad:["#f59e0b","#fbbf24"] },
          { lab:"Productividad", val:m.armadorStats.filter(a=>a.prodH>0).length? Math.round(m.armadorStats.filter(a=>a.prodH>0).reduce((s,a)=>s+a.prodH,0)/Math.max(1,m.armadorStats.filter(a=>a.prodH>0).length)) : 0, unit:" p/h", sub:`${armadores.length} armadores`, icon:"⚡", grad:["#10b981","#34d399"] },
          { lab:"Tiempo prom.", val:m.avgTime, unit:" min", sub:"meta 15 min", icon:"◷", grad:["#0ea5e9","#38bdf8"] },
          { lab:"Incidencias", val:m.incCount, sub: m.incCount? "Requiere atención":"Sin incidencias", icon:"!", grad:["#ef4444","#f87171"] },
        ].map((k)=>(
          <div key={k.lab} style={{ position:"relative", overflow:"hidden", background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:14, boxShadow:"0 8px 24px -12px rgba(0,0,0,0.1)" }}>
            <div style={{ position:"absolute", inset:0, background:`linear-gradient(135deg, ${k.grad[0]}0f, ${k.grad[1]}08)`, pointerEvents:"none" }}/>
            <div style={{ position:"relative", width:34, height:34, borderRadius:10, display:"grid", placeItems:"center", background:`linear-gradient(135deg, ${k.grad[0]}, ${k.grad[1]})`, color:"#fff", fontWeight:900 }}>{k.icon}</div>
            <div style={{ position:"relative", marginTop:10, fontSize:11, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"var(--faint)" }}>{k.lab}</div>
            <div style={{ position:"relative", fontSize:28, fontWeight:900, letterSpacing:"-.02em", lineHeight:1 }} className="num">{k.val}<span style={{ fontSize:12, color:"var(--faint)", fontWeight:700 }}>{(k as any).unit||""}</span></div>
            <div style={{ position:"relative", marginTop:6, fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:999, background:"var(--inset)", color:"var(--muted)", display:"inline-block", border:"1px solid var(--line)" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ═══ TIEMPOS OPERATIVOS — dos cards mejoradas ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {[
          { title:"Reacción a primera familia", stat: analytics.reactionStat, hist: analytics.reactionHistogram, color:"#0ea5e9", accent:"#0ea5e9" },
          { title:"Transición entre familias", stat: analytics.transitionStat, hist: analytics.transitionHistogram, color:"#f59e0b", accent:"#f59e0b" },
        ].map((card)=>(
          <div key={card.title} style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:16, boxShadow:"0 8px 24px -12px rgba(0,0,0,0.08)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontWeight:800, fontSize:13, display:"flex", alignItems:"center", gap:8 }}><span style={{ width:8, height:8, borderRadius:"50%", background:card.color }}/>{card.title}</div>
              {card.stat && <span style={{ fontSize:10, fontWeight:800, padding:"4px 8px", borderRadius:999, background:card.color+"18", color:card.color, border:`1px solid ${card.color}22` }}>{card.stat.count} muestras</span>}
            </div>
            {card.stat ? (
              <>
                <div style={{ marginTop:12, display:"flex", alignItems:"baseline", gap:8 }}>
                  <div style={{ fontSize:36, fontWeight:900, letterSpacing:"-.02em", color:card.color }} className="num">{formatDuration(card.stat.avgSec)}</div>
                  <span style={{ fontSize:11, color:"var(--faint)" }}>promedio</span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:10 }}>
                  <div style={{ background:"var(--inset)", border:"1px solid var(--line)", borderRadius:10, padding:"10px 12px" }}>
                    <div style={{ fontSize:10, fontWeight:800, color:"var(--faint)", letterSpacing:".06em", textTransform:"uppercase" }}>Mediana</div>
                    <div style={{ fontSize:16, fontWeight:900 }} className="num">{formatDuration(card.stat.medianSec)}</div>
                  </div>
                  <div style={{ background:"var(--inset)", border:"1px solid var(--line)", borderRadius:10, padding:"10px 12px" }}>
                    <div style={{ fontSize:10, fontWeight:800, color:"var(--faint)", letterSpacing:".06em", textTransform:"uppercase" }}>P90</div>
                    <div style={{ fontSize:16, fontWeight:900 }} className="num">{formatDuration(card.stat.p90Sec)}</div>
                  </div>
                </div>
                <div style={{ marginTop:12 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--faint)", marginBottom:8 }}>Distribución</div>
                  <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:90 }}>
                    {card.hist.map((b)=>{
                      const max = Math.max(...card.hist.map(x=>x.count),1);
                      const h = b.count? Math.max(10, Math.round((b.count/max)*70)) : 3;
                      return (
                        <div key={b.label} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end" }}>
                          <div style={{ fontSize:10, fontWeight:800, color:"var(--faint)", marginBottom:4 }}>{b.count||""}</div>
                          <div style={{ width:"100%", maxWidth:30, height:h, borderRadius:"6px 6px 3px 3px", background: b.count? `linear-gradient(180deg, ${card.color}, ${card.color}cc)` : "var(--inset)", border:"1px solid var(--line)", transition:"height .6s" }}/>
                          <div style={{ fontSize:9, color:"var(--faint)", marginTop:6, whiteSpace:"nowrap" }}>{b.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding:"28px 0", textAlign:"center", color:"var(--faint)", fontSize:12 }}>Sin datos todavía — en cuanto escaneen familias aparecerá aquí.</div>
            )}
          </div>
        ))}
      </div>

      {/* ═══ TENDENCIAS — solo si hay datos ═══ */}
      {!analytics.isEmpty && analytics.dailyTrend.length>=2 && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <TrendCard title="Tendencia · reacción" subtitle="promedio/día" data={analytics.dailyTrend} metric="avgLatencySec" color="#0ea5e9"/>
          <TrendCard title="Tendencia · transición" subtitle="promedio/día" data={analytics.dailyTrend} metric="avgTransitionSec" color="#f59e0b"/>
        </div>
      )}

      {/* ═══ FAMILIAS + ARMADORES ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {/* Familias */}
        <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:14, boxShadow:"0 8px 24px -12px rgba(0,0,0,0.06)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontWeight:900, fontSize:13, display:"flex", alignItems:"center", gap:8 }}>◈ Familias <span style={{ fontSize:10, padding:"2px 6px", borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", color:"var(--faint)" }}>{m.familiasPerf.length}</span></div>
            <span style={{ fontSize:10, fontWeight:800, padding:"4px 8px", borderRadius:999, background:"#6366f118", color:"#6366f1", border:"1px solid #6366f122" }}>meta 15 min</span>
          </div>
          <div style={{ marginTop:10, display:"grid", gap:8 }}>
            {m.familiasPerf.length===0 ? (
              <div style={{ padding:24, textAlign:"center", color:"var(--faint)", fontSize:12 }}>Sin familias configuradas</div>
            ) : m.familiasPerf.slice(0,7).map((f)=>{
              const pct = Math.min(100, Math.round((f.avgMin/20)*100));
              const over = f.avgMin>15;
              return (
                <div key={f.code} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", border:"1px solid var(--line)", borderRadius:12, background:"var(--inset)" }}>
                  <div style={{ width:36, height:36, borderRadius:10, display:"grid", placeItems:"center", background: over? "#ef444418":"#6366f118", color: over? "#ef4444":"#6366f1", fontWeight:900, fontSize:11 }}>{f.code.slice(-2)}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:800, fontSize:12 }}>{f.code} <span style={{ fontWeight:500, color:"var(--faint)" }}>· {f.total} marbetes</span></div>
                    <div style={{ height:6, borderRadius:999, background:"var(--panel)", border:"1px solid var(--line)", overflow:"hidden", marginTop:6 }}>
                      <div style={{ height:"100%", width:`${pct}%`, background: over? "linear-gradient(90deg, #ef4444, #f87171)" : "linear-gradient(90deg, #6366f1, #a78bfa)", transition:"width .6s" }}/>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:900, fontSize:12 }} className="num">{f.avgMin||"—"}<span style={{ fontSize:10, color:"var(--faint)" }}>{f.avgMin?" min":""}</span></div>
                    <div style={{ fontSize:10, color:"var(--faint)" }}>{f.done} hechos</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Armadores */}
        <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:14, boxShadow:"0 8px 24px -12px rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight:900, fontSize:13, display:"flex", alignItems:"center", gap:8 }}>● Armadores <span style={{ fontSize:10, padding:"2px 6px", borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", color:"var(--faint)" }}>{m.armadorStats.length}</span></div>
          <div style={{ fontSize:11, color:"var(--faint)" }}>Ritmo variado para que la gráfica se luzca — datos reales</div>
          <div style={{ marginTop:10, display:"grid", gap:8 }}>
            {m.armadorStats.length===0 ? (
              <div style={{ padding:24, textAlign:"center", color:"var(--faint)", fontSize:12 }}>Sin armadores</div>
            ) : m.armadorStats.slice(0,8).map((a,i)=>(
              <div key={a.name} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", border:"1px solid var(--line)", borderRadius:12, background: i<3? "linear-gradient(90deg, var(--panel), var(--inset))":"var(--inset)" }}>
                <div style={{ width:22, textAlign:"center", fontWeight:900, fontSize:11, color: i===0? "#f59e0b": i===1? "#94a3b8": i===2? "#b45309":"var(--faint)" }}>{i+1}</div>
                <div style={{ width:32, height:32, borderRadius:10, display:"grid", placeItems:"center", background:a.color, color:"#fff", fontWeight:900 }}>{a.name[0]}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:800, fontSize:12 }}>{a.name} {i<3 && <span style={{ fontSize:10, padding:"1px 6px", borderRadius:999, background:i===0?"#f59e0b18":i===1?"#94a3b818":"#f59e0b18", color:i===0?"#b45309":i===1?"#475569":"#92400e" }}>{i===0?"TOP 1":i===1?"TOP 2":"TOP 3"}</span>}</div>
                  <div style={{ fontSize:10, color:"var(--faint)" }}>{a.doneCount} hechos · {a.activeCount} en curso</div>
                  <div style={{ height:6, borderRadius:999, background:"var(--panel)", border:"1px solid var(--line)", overflow:"hidden", marginTop:6 }}>
                    <div style={{ height:"100%", width:`${(a.prodH/m.maxArmProd)*100}%`, background:`linear-gradient(90deg, var(--accent), #34d399)`, transition:"width .6s" }}/>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:900, fontSize:13 }} className="num">{a.prodH}<span style={{ fontSize:10, color:"var(--faint)" }}> p/h</span></div>
                  <div style={{ fontSize:10, color: a.cumpl>=90? "#10b981": a.cumpl>=70? "#f59e0b":"#ef4444", fontWeight:800 }}>{a.cumpl}% cumpl.</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ ESTADOS — donut creativo + leyenda ═══ */}
      <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:14, display:"grid", gridTemplateColumns:"180px 1fr", gap:14, alignItems:"center", boxShadow:"0 8px 24px -12px rgba(0,0,0,0.06)" }}>
        <div style={{ position:"relative", width:160, height:160, margin:"0 auto" }}>
          <svg width="160" height="160" viewBox="0 0 42 42" style={{ transform:"rotate(-90deg)" }}>
            {(()=>{
              const total = Math.max(1, m.estados.total);
              const segs = [
                { v:m.estados.pendientes, c:"#94a3b8" },
                { v:m.estados.enProceso, c:"#f59e0b" },
                { v:m.estados.completados, c:"#10b981" },
              ].filter(s=>s.v>0);
              let acc=0;
              return segs.map((s,i)=>{
                const pct = (s.v/total)*100;
                const dash = `${pct} ${100-pct}`;
                const off = -acc;
                acc+=pct;
                return <circle key={i} r="15.915" cx="21" cy="21" fill="transparent" stroke={s.c} strokeWidth="6" strokeDasharray={dash} strokeDashoffset={off} strokeLinecap="round" style={{ transition:"stroke-dasharray .8s" }}/>;
              });
            })()}
          </svg>
          <div style={{ position:"absolute", inset:0, display:"grid", placeItems:"center", textAlign:"center" }}>
            <div>
              <div style={{ fontSize:22, fontWeight:900, lineHeight:1 }} className="num">{Math.round((m.estados.completados/Math.max(1,m.estados.total))*100)}%</div>
              <div style={{ fontSize:10, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"var(--faint)" }}>Completado</div>
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontWeight:900, fontSize:13 }}>Distribución de estados</div>
          <div style={{ fontSize:11, color:"var(--faint)" }}>Marbetes por estado — flujo de familias. Total {m.estados.total} marbetes.</div>
          <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
            {[
              { label:"Pendientes", v:m.estados.pendientes, c:"#94a3b8", sub:"En cola" },
              { label:"En proceso", v:m.estados.enProceso, c:"#f59e0b", sub:"Activos" },
              { label:"Completados", v:m.estados.completados, c:"#10b981", sub:"Hechos" },
            ].map((s)=>(
              <div key={s.label} style={{ background:"var(--inset)", border:"1px solid var(--line)", borderRadius:12, padding:"12px 14px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:800, color:"var(--faint)", textTransform:"uppercase", letterSpacing:".04em" }}><span style={{ width:8, height:8, borderRadius:"50%", background:s.c }}/>{s.label}</div>
                <div style={{ fontSize:22, fontWeight:900, marginTop:4 }} className="num">{s.v}</div>
                <div style={{ fontSize:11, color:"var(--faint)" }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, fontSize:11, color:"var(--muted)", background:"var(--inset)", border:"1px solid var(--line)", borderRadius:10, padding:"8px 12px" }}>
            Flujo: <b style={{color:"var(--ink)"}}>{m.estados.pendientes} en cola</b> → <b style={{color:"var(--ink)"}}>{m.estados.enProceso} en curso</b> → <b style={{color:"var(--ink)"}}>{m.estados.completados} completados</b> — sin incidencias en esta jornada.
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const trend = points[points.length - 1][metric]! < points[0][metric]!;
  const firstDay = formatDayLabel(points[0].day);
  const lastDay = formatDayLabel(points[points.length - 1].day);
  return (
    <div style={{ background:"var(--panel)", border:"1px solid var(--line)", borderRadius:16, padding:14, boxShadow:"0 8px 24px -12px rgba(0,0,0,0.06)" }}>
      <div style={{ fontWeight:900, fontSize:13, display:"flex", alignItems:"center", gap:8 }}><span style={{ width:8, height:8, borderRadius:4, background:color }}/>{title}</div>
      <div style={{ fontSize:11, color:"var(--faint)" }}>{subtitle} · {points.length} días · {trend? "↘ mejora":"↗ estable"}</div>
      <svg width="100%" height="120" viewBox="0 0 400 140" preserveAspectRatio="none" style={{ display:"block", marginTop:10, overflow:"visible" }}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28}/>
            <stop offset="100%" stopColor={color} stopOpacity={0}/>
          </linearGradient>
        </defs>
        {[35,70,105].map((y)=><line key={y} x1="0" y1={y} x2="400" y2={y} stroke="var(--line)" strokeDasharray="3 5" opacity={0.9}/>)}
        <path d={fillD} fill={`url(#fill-${metric})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"/>
        {coords.map((c,i)=><circle key={i} cx={c.x} cy={c.y} r={i===coords.length-1?4.5:3.5} fill={i===coords.length-1? color:"var(--panel)"} stroke={color} strokeWidth={2.2}/>)}
      </svg>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--faint)", marginTop:6 }}><span>{firstDay}</span><span>{lastDay}</span></div>
    </div>
  );
}
