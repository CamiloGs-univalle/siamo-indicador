/**
 * @file components/admin/mod-desempeno.tsx
 * @description Módulo de desempeño y reconocimiento.
 * Ranking de armadores, clasificación de incidencias y reconocimientos.
 * Carga datos reales desde Firestore.
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/components/icons";
import { Kpi } from "@/components/ui/kpi";
import { useAuth } from "@/lib/auth-context";
import { getArmadores, getZones, updateArmador, updateZone } from "@/lib/firestore";
import type { Armador, Zone, IncidentClass } from "@/types";

export function ModDesempeno() {
  const { user } = useAuth();
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingReco, setSavingReco] = useState<Record<string, boolean>>({});
  const [savingClass, setSavingClass] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId]);

  async function loadData() {
    if (!user?.companyId) {
      setLoading(false);
      return;
    }
    try {
      const [a, z] = await Promise.all([
        getArmadores(user.companyId),
        getZones(user.companyId),
      ]);
      setArmadores(a);
      setZones(z);
    } catch (error) {
      console.error("Error loading performance data:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando...</div>;
  }

  // Calculate rankings
  const ranked = [...armadores]
    .map((a) => ({
      ...a,
      index: a.prodH ? Math.round(a.prodH / 10) : 0,
    }))
    .sort((a, b) => b.index - a.index);

  // Get incident zones
  const incidents = zones
    .filter((z) => z.status === "incident")
    .map((z) => ({
      id: z.id,
      zone: z.code,
      armador: armadores.find((a) => a.id === z.armadorId)?.name || "Sin asignar",
      description: z.incidentNote || "Sin descripción",
      classification: z.incidentClass,
    }));

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
    } catch (error) {
      console.error("Error saving recognition:", error);
    } finally {
      setSavingReco((s) => ({ ...s, [a.id]: false }));
    }
  }

  async function handleClassify(zoneId: string | undefined, value: IncidentClass) {
    if (!zoneId || savingClass[zoneId]) return;
    setSavingClass((s) => ({ ...s, [zoneId]: true }));
    try {
      await updateZone(zoneId, { incidentClass: value });
      setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, incidentClass: value } : z)));
    } catch (error) {
      console.error("Error saving incident classification:", error);
    } finally {
      setSavingClass((s) => ({ ...s, [zoneId]: false }));
    }
  }

  const medal = (i: number) =>
    i === 0
      ? { bg: "color-mix(in srgb,var(--gold) 20%,transparent)", c: "var(--gold)" }
      : i === 1
        ? { bg: "var(--panel2)", c: "var(--mut)" }
        : i === 2
          ? { bg: "color-mix(in srgb,#CD7F32 22%,transparent)", c: "#CD7F32" }
          : { bg: "transparent", c: "var(--faint)" };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <Kpi
          accent="var(--gold)"
          icon={<I.trophy />}
          lab="Mejor del turno"
          val={ranked.length > 0 ? ranked[0].name : "Sin datos"}
          delta={ranked.length > 0 ? `${ranked[0].prodH || 0} prod/h · índice ${ranked[0].index}` : ""}
        />
        <Kpi
          accent="var(--s-done)"
          lab="Reconocimientos hoy"
          val={armadores.filter(isRecognizedToday).length}
          delta="premiar refuerza el hábito"
        />
        <Kpi
          accent="var(--s-inc)"
          lab="Incidencias a revisar"
          val={incidents.length}
          delta="clasifícalas para no penalizar"
        />
      </div>

      <div className="panel">
        <div className="panel-h"><h3>Ranking del sector</h3><span className="hint">ordenado por índice operacional</span></div>
        {ranked.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Sin armadores registrados</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Armador</th>
                <th style={{ textAlign: "right" }}>prod/h</th>
                <th style={{ textAlign: "right" }}>Índice</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a, i) => (
                <tr key={a.id}>
                  <td><span className="rank" style={{ background: medal(i).bg, color: medal(i).c }}>{i + 1}</span></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span className="avatar" style={{ background: a.color || "var(--accent)", width: 26, height: 26, borderRadius: 7, fontSize: 11 }}>{a.name[0]}</span>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                    </div>
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>{a.prodH || 0}</td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>{a.index}</td>
                  <td style={{ textAlign: "right" }}>
                    {isRecognizedToday(a) ? (
                      <span className="pill" style={{ background: "color-mix(in srgb,var(--gold) 16%,transparent)", color: "var(--gold)" }}>
                        <I.trophy width={12} height={12} /> Reconocido
                      </span>
                    ) : (
                      <button className="btn sm" disabled={!!savingReco[a.id]} onClick={() => handleReconocer(a)}>
                        <I.trophy width={13} height={13} /> {savingReco[a.id] ? "Guardando..." : "Reconocer"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="panel">
          <div className="panel-h"><h3>Reconocimientos de la semana</h3></div>
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            {ranked.slice(0, 3).map((a, i) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span className="avatar" style={{ background: a.color || "var(--accent)", width: 30, height: 30, fontSize: 12 }}>{a.name[0]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
                  <div className="badges" style={{ marginTop: 5 }}>
                    <span className={"badge" + (i === 0 ? " gold" : "")}>
                      {i === 0 ? <I.trophy width={12} height={12} /> : <I.check width={12} height={12} />}
                      {i === 0 ? "Top performer" : "Buen desempeño"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {ranked.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--faint)" }}>Sin reconocimientos aún</div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>Incidencias del turno</h3><span className="hint">clasificar es acompañar, no castigar</span></div>
          {incidents.length ? (
            incidents.map((it) => {
              const cl = it.classification;
              const busy = it.id ? !!savingClass[it.id] : false;
              return (
                <div key={it.id || it.zone} style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
                    <span className="mono" style={{ fontWeight: 700 }}>{it.zone}</span>
                    <span style={{ color: "var(--mut)" }}>{it.description}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>{it.armador}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
                    <button disabled={busy} className={"btn sm" + (cl === "proceso" ? " primary" : "")} onClick={() => handleClassify(it.id, "proceso")}>
                      Causa: proceso
                    </button>
                    <button disabled={busy} className={"btn sm" + (cl === "persona" ? " primary" : "")} onClick={() => handleClassify(it.id, "persona")}>
                      Causa: persona
                    </button>
                    <button
                      disabled={busy}
                      className={"btn sm" + (cl === "mitigada" ? " primary" : "")}
                      onClick={() => handleClassify(it.id, "mitigada")}
                      style={cl === "mitigada" ? { background: "var(--s-done)", borderColor: "var(--s-done)", color: "#fff" } : undefined}
                    >
                      No afecta desempeño
                    </button>
                  </div>
                  {cl && (
                    <div style={{ marginTop: 9, fontSize: 11.5, color: cl === "mitigada" ? "var(--s-done)" : "var(--mut)" }}>
                      {cl === "mitigada"
                        ? "Registrada sin impacto en el índice del armador."
                        : cl === "proceso"
                          ? "Atribuida al proceso — no afecta al armador."
                          : "Se comparte como retroalimentación para acompañamiento."}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ padding: 16, fontSize: 13, color: "var(--faint)" }}>Sin incidencias en el turno.</div>
          )}
          <div style={{ padding: 14, fontSize: 11.5, color: "var(--faint)" }}>
            El sistema nunca marca &ldquo;incumplimiento&rdquo; automáticamente. La causa la define el supervisor.
          </div>
        </div>
      </div>
    </div>
  );
}
