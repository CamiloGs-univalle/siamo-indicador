/**
 * @file components/admin/mod-desempeno.tsx
 * @description Dashboard profesional de desempeño y reconocimiento.
 * Ranking, métricas individuales, incidencias clasificadas — ahora también
 * con el tiempo de reacción real de cada armador (desde "Listo" hasta su
 * primer escaneo), calculado por `@/frontend/services/analytics` a partir de la bitácora.
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

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubA = subscribeArmadores(user.companyId, (a) => { setArmadores(a); setLoading(false); });
    const unsubZ = subscribeZones(user.companyId, setZones);
    const unsubM = subscribeMembretes(user.companyId, setMembretes);
    const unsubAct = subscribeActivity(user.companyId, setActivity, 2000);
    return () => { unsubA(); unsubZ(); unsubM(); unsubAct(); };
  }, [user?.companyId]);

  const analytics = useMemo(() => computeCompanyAnalytics(activity, armadores), [activity, armadores]);

  /**
   * Ranking "¿quién hace más membretes?" — el indicador que pidió el nuevo
   * modelo de cola de zona: ya no importa tanto cuántas ZONAS le tocaron a
   * cada armador (eso dependía de cómo el admin armaba el ciclo), sino
   * cuántos MEMBRETES completó, sin importar si los tomó él mismo de la
   * cola de su zona o si se los asignaron directamente.
   */
  const membreteRanking = useMemo(() => {
    return armadores
      .map((a) => {
        const mine = membretes.filter((m) => m.armadorId === a.id);
        const completados = mine.filter((m) => m.status === "completed");
        const tomadosPorCuenta = completados.filter((m) => m.claimedAt).length;
        const asignadosDirecto = completados.length - tomadosPorCuenta;
        const unidades = completados.reduce((s, m) => s + (m.totalUnits || 0), 0);
        return {
          armador: a,
          completados: completados.length,
          enProceso: mine.filter((m) => m.status === "active" || m.status === "pending").length,
          tomadosPorCuenta,
          asignadosDirecto,
          unidades,
        };
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

      return {
        ...a,
        myZoneCount: myZones.length,
        myDoneCount: myDone.length,
        myIncCount: myInc.length,
        totalProducts,
        avgTime,
        efficiency,
        completion,
        quality,
        operationalIndex,
        reactionAvgSec,
        reactionSamples,
      };
    }).sort((a, b) => b.operationalIndex - a.operationalIndex);

    const incidents = zones.filter((z) => z.status === "incident").map((z) => ({
      id: z.id,
      zone: z.code,
      armador: armadores.find((a) => a.id === z.armadorId)?.name || "Sin asignar",
      description: z.incidentNote || "Sin descripción registrada",
      classification: z.incidentClass,
    }));

    const todayKey = new Date().toISOString().slice(0, 10);
    const RECO_PREFIX = "reconocido:";
    const recognizedToday = armadores.filter((a) => (a.badges || []).some((b) => b === RECO_PREFIX + todayKey));

    // El armador con la reacción promedio más rápida (mínimo 2 muestras para que no sea ruido de un solo caso).
    const fastestReactor = ranked
      .filter((a) => a.reactionAvgSec !== null && a.reactionSamples >= 2)
      .sort((a, b) => (a.reactionAvgSec ?? Infinity) - (b.reactionAvgSec ?? Infinity))[0] || null;

    return { ranked, incidents, recognizedToday, fastestReactor };
  }, [armadores, zones, analytics]);

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const RECO_PREFIX = "reconocido:";
  const isRecognizedToday = (a: Armador) => (a.badges || []).includes(RECO_PREFIX + todayKey());

  async function handleReconocer(a: Armador) {
    if (isRecognizedToday(a) || savingReco[a.id]) return;
    setSavingReco((s) => ({ ...s, [a.id]: true }));
    const badges = [...(a.badges || []), RECO_PREFIX + todayKey()];
    try {
      await updateArmador(a.id, { badges });
      setArmadores((prev) => prev.map((x) => (x.id === a.id ? { ...x, badges } : x)));
    } finally { setSavingReco((s) => ({ ...s, [a.id]: false })); }
  }

  async function handleClassify(zoneId: string | undefined, value: IncidentClass) {
    if (!zoneId || savingClass[zoneId]) return;
    setSavingClass((s) => ({ ...s, [zoneId]: true }));
    try {
      await updateZone(zoneId, { incidentClass: value });
      setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, incidentClass: value } : z)));
    } finally { setSavingClass((s) => ({ ...s, [zoneId]: false })); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando desempeño...</div>;

  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
  const medalColor = (i: number) => i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "var(--faint)";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ═══ Top Performers Podium ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Top Performers del Turno</h3>
          {data.fastestReactor && (
            <span style={{ fontSize: 11.5, padding: "5px 12px", borderRadius: 20, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", fontWeight: 600 }}>
              ⚡ Reacción más rápida: {data.fastestReactor.name} · {formatDuration(data.fastestReactor.reactionAvgSec || 0)}
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {data.ranked.slice(0, 3).map((a, i) => (
            <div key={a.id} style={{ background: "var(--panel2)", border: `2px solid ${medalColor(i)}`, borderRadius: 12, padding: "20px 16px", textAlign: "center", position: "relative" }}>
              <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", fontSize: 28 }}>{medal(i)}</div>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: a.color || "var(--accent)", display: "grid", placeItems: "center", margin: "8px auto 10px", color: "#fff", fontSize: 20, fontWeight: 700 }}>{a.name[0]}</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{a.name}</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>{a.operationalIndex}<span style={{ fontSize: 12, color: "var(--faint)" }}>/100</span></div>
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{a.prodH} prod/h · {a.myDoneCount}/{a.myZoneCount} zonas</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: a.efficiency >= 80 ? "color-mix(in srgb, var(--s-done) 15%, transparent)" : "color-mix(in srgb, var(--s-not) 15%, transparent)", color: a.efficiency >= 80 ? "var(--s-done)" : "var(--s-not)" }}>Vel: {a.efficiency}%</span>
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>Cal: {a.quality}%</span>
                {a.reactionAvgSec !== null && (
                  <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: "color-mix(in srgb, var(--s-active) 15%, transparent)", color: "var(--s-active)" }}>Reac: {formatDuration(a.reactionAvgSec)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Full Ranking Table ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Ranking completo</h3>
          <span style={{ fontSize: 11, color: "var(--faint)" }}>{data.ranked.length} armadores</span>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--panel2)" }}>
              <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em" }}>#</th>
              <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Armador</th>
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Índice</th>
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Prod/h</th>
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Zonas</th>
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Velocidad</th>
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Calidad</th>
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }} title="Tiempo desde 'Listo' hasta el primer escaneo">Reacción</th>
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}></th>
            </tr>
          </thead>
          <tbody>
            {data.ranked.map((a, i) => (
              <tr key={a.id} title={`${a.name} — Índice ${a.operationalIndex}/100, ${a.prodH} prod/h, ${a.myDoneCount}/${a.myZoneCount} familias, Vel ${a.efficiency}%, Cal ${a.quality}%, Reacción ${a.reactionAvgSec!==null? formatDuration(a.reactionAvgSec):"—"} — clic para ver detalle`} style={{ borderBottom: "1px solid var(--line)", background: i < 3 ? "color-mix(in srgb, var(--gold) 4%, transparent)" : undefined, cursor:"help" }}>
                <td style={{ padding: "12px 16px" }}><span style={{ fontSize: 16 }} title={`Puesto #${i+1} — ${medal(i)}`}>{medal(i)}</span></td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: a.color || "var(--accent)", display: "grid", placeItems: "center", color: "#fff", fontSize: 12, fontWeight: 700 }} title={`${a.name} — ${a.prodH} prod/h`}>{a.name[0]}</div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--faint)" }}>{a.companyId || "Siamo"}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: a.operationalIndex >= 70 ? "var(--s-done)" : a.operationalIndex >= 40 ? "var(--accent)" : "var(--s-not)" }}>{a.operationalIndex}</span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}><span className="mono" style={{ fontWeight: 600 }}>{a.prodH}</span></td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}><span className="mono">{a.myDoneCount}/{a.myZoneCount}</span></td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: a.efficiency >= 80 ? "color-mix(in srgb, var(--s-done) 15%, transparent)" : "color-mix(in srgb, var(--s-not) 15%, transparent)", color: a.efficiency >= 80 ? "var(--s-done)" : "var(--s-not)" }}>{a.efficiency}%</span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: a.quality >= 80 ? "color-mix(in srgb, var(--s-done) 15%, transparent)" : "color-mix(in srgb, var(--s-not) 15%, transparent)", color: a.quality >= 80 ? "var(--s-done)" : "var(--s-not)" }}>{a.quality}%</span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  {a.reactionAvgSec === null ? (
                    <span style={{ fontSize: 12, color: "var(--faint)" }}>—</span>
                  ) : (
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tx)" }}>{formatDuration(a.reactionAvgSec)}</span>
                  )}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  {isRecognizedToday(a) ? (
                    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: "color-mix(in srgb, var(--gold) 16%, transparent)", color: "var(--gold)", fontWeight: 600 }}>⭐ Reconocido</span>
                  ) : (
                    <button className="btn sm" disabled={!!savingReco[a.id]} onClick={() => handleReconocer(a)}>
                      {savingReco[a.id] ? "..." : "⭐ Reconocer"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* ═══ ¿Quién hace más membretes? ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>¿Quién hace más membretes?</h3>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Membretes completados — tomados de la cola de zona o asignados directo, todos cuentan igual.</span>
        </div>
        {membreteRanking.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Todavía no hay membretes completados ni en proceso.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--panel2)" }}>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em" }}>#</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Armador</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Completados</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }} title="Membretes que el armador tomó por su cuenta de la cola de su zona">Tomados en cola</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }} title="Membretes que el supervisor le asignó directamente">Asignados directo</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>Unidades</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}>En proceso</th>
                </tr>
              </thead>
              <tbody>
                {membreteRanking.map((r, i) => (
                  <tr key={r.armador.id} title={`${r.armador.name} — ${r.completados} marbetes completados (${r.tomadosPorCuenta} en cola + ${r.asignadosDirecto} asignados), ${r.unidades} unidades, ${r.enProceso} en curso`} style={{ borderBottom: "1px solid var(--line)", background: i < 3 ? "color-mix(in srgb, var(--gold) 4%, transparent)" : undefined, cursor:"help" }}>
                    <td style={{ padding: "12px 16px" }}><span style={{ fontSize: 16 }} title={`Puesto #${i+1}`}>{medal(i)}</span></td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: r.armador.color || "var(--accent)", display: "grid", placeItems: "center", color: "#fff", fontSize: 12, fontWeight: 700 }} title={`${r.armador.name} — ${r.completados} hechos`}>{r.armador.name[0]}</div>
                        <div style={{ fontWeight: 600 }}>{r.armador.name}</div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}><span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>{r.completados}</span></td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}><span className="mono">{r.tomadosPorCuenta}</span></td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}><span className="mono">{r.asignadosDirecto}</span></td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}><span className="mono">{r.unidades}</span></td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      {r.enProceso > 0 ? (
                        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: "color-mix(in srgb, var(--s-active) 15%, transparent)", color: "var(--s-active)" }}>{r.enProceso} en curso</span>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--faint)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ Incidents ═══ */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 20px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>Incidencias a revisar</h3>
        {data.incidents.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>✅ Sin incidencias — excelente desempeño del equipo</div>
        ) : data.incidents.map((it) => (
          <div key={it.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span className="mono" style={{ fontWeight: 700, fontSize: 14 }}>{it.zone}</span>
              <span style={{ color: "var(--mut)", fontSize: 13 }}>{it.description}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>{it.armador}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["proceso", "persona", "mitigada"] as IncidentClass[]).map((cls) => (
                <button key={cls} disabled={!it.id || !!savingClass[it.id]} className={"btn sm" + (it.classification === cls ? " primary" : "")} onClick={() => it.id && handleClassify(it.id, cls)} style={cls === "mitigada" && it.classification === "mitigada" ? { background: "var(--s-done)", borderColor: "var(--s-done)", color: "#fff" } : undefined}>
                  {cls === "proceso" ? "⚙️ Proceso" : cls === "persona" ? "👤 Persona" : "✅ Mitigada"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
