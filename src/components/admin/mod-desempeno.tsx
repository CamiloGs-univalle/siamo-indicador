/**
 * @file components/admin/mod-desempeno.tsx
 * @description Dashboard profesional de desempeño y reconocimiento.
 * Ranking, métricas individuales, incidencias clasificadas.
 */

"use client";

import { useState, useEffect, useMemo } from "react";
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
    if (!user?.companyId) { setLoading(false); return; }
    Promise.all([getArmadores(user.companyId), getZones(user.companyId)])
      .then(([a, z]) => { setArmadores(a); setZones(z); })
      .finally(() => setLoading(false));
  }, [user?.companyId]);

  const data = useMemo(() => {
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

    return { ranked, incidents, recognizedToday };
  }, [armadores, zones]);

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
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px" }}>Top Performers del Turno</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {data.ranked.slice(0, 3).map((a, i) => (
            <div key={a.id} style={{ background: "var(--panel2)", border: `2px solid ${medalColor(i)}`, borderRadius: 12, padding: "20px 16px", textAlign: "center", position: "relative" }}>
              <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", fontSize: 28 }}>{medal(i)}</div>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: a.color || "var(--accent)", display: "grid", placeItems: "center", margin: "8px auto 10px", color: "#fff", fontSize: 20, fontWeight: 700 }}>{a.name[0]}</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{a.name}</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>{a.operationalIndex}<span style={{ fontSize: 12, color: "var(--faint)" }}>/100</span></div>
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{a.prodH} prod/h · {a.myDoneCount}/{a.myZoneCount} zonas</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 10 }}>
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: a.efficiency >= 80 ? "color-mix(in srgb, var(--s-done) 15%, transparent)" : "color-mix(in srgb, var(--s-not) 15%, transparent)", color: a.efficiency >= 80 ? "var(--s-done)" : "var(--s-not)" }}>Vel: {a.efficiency}%</span>
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>Cal: {a.quality}%</span>
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
              <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" }}></th>
            </tr>
          </thead>
          <tbody>
            {data.ranked.map((a, i) => (
              <tr key={a.id} style={{ borderBottom: "1px solid var(--line)", background: i < 3 ? "color-mix(in srgb, var(--gold) 4%, transparent)" : undefined }}>
                <td style={{ padding: "12px 16px" }}><span style={{ fontSize: 16 }}>{medal(i)}</span></td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: a.color || "var(--accent)", display: "grid", placeItems: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>{a.name[0]}</div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--faint)" }}>{a.sector || "Sin sector"}</div>
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
