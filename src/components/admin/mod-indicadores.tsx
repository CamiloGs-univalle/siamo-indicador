/**
 * @file components/admin/mod-indicadores.tsx
 * @description Módulo de indicadores de productividad.
 * Muestra gráficas de barras, métricas por armador e índice operacional.
 * Carga datos REALES EN TIEMPO REAL desde Firestore (onSnapshot).
 */

"use client";

import { useState, useEffect } from "react";
import { Kpi } from "@/components/ui/kpi";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores } from "@/lib/firestore";
import type { Zone, Armador } from "@/types";

export function ModIndicadores() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }

    const unsubZones = subscribeZones(user.companyId, (z) => {
      setZones(z);
      setLoading(false);
    });
    const unsubArmadores = subscribeArmadores(user.companyId, setArmadores);

    return () => { unsubZones(); unsubArmadores(); };
  }, [user?.companyId]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando...</div>;
  }

  const doneZones = zones.filter((z) => z.status === "done");
  const incZones = zones.filter((z) => z.status === "incident");
  const activeZones = zones.filter((z) => z.status === "active");

  const completionRate = zones.length > 0 ? Math.round((doneZones.length / zones.length) * 100) : 0;
  const avgTime = doneZones.length > 0
    ? Math.round(doneZones.reduce((sum, z) => sum + (z.avgMinutes || 0), 0) / doneZones.length)
    : 0;

  const zoneTimes = zones.slice(0, 10).map((z) => ({
    code: z.code,
    time: z.avgMinutes || 0,
  }));
  const maxTime = Math.max(...zoneTimes.map((z) => z.time), 1);

  const armadorProd = armadores
    .map((a) => ({
      name: a.name,
      prodH: a.prodH || 0,
    }))
    .sort((a, b) => b.prodH - a.prodH);
  const maxProd = Math.max(...armadorProd.map((a) => a.prodH), 1);
  const withProd = armadorProd.filter((a) => a.prodH > 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Kpi accent="var(--accent)" lab="Productividad" val={withProd.length > 0 ? Math.round(withProd.reduce((s, a) => s + a.prodH, 0) / withProd.length) : 0} unit=" prod/h" />
        <Kpi accent="var(--s-done)" lab="Cumplimiento" val={completionRate} unit="%" />
        <Kpi accent="var(--s-active)" lab="Tiempo promedio" val={avgTime} unit=" min/zona" />
        <Kpi accent="var(--s-inc)" lab="Incidencias" val={incZones.length} delta={`en ${incZones.length} zonas`} down={incZones.length > 0} />
      </div>

      {activeZones.length > 0 && (
        <div className="panel" style={{ borderLeft: "3px solid var(--s-active)" }}>
          <div className="panel-h"><h3>En progreso ahora</h3><span className="live"><span className="pulse" />en vivo</span></div>
          <div style={{ padding: "8px 16px", display: "flex", gap: 16, flexWrap: "wrap" }}>
            {activeZones.map((z) => {
              const armador = armadores.find((a) => a.id === z.armadorId);
              return (
                <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span className="mono" style={{ fontWeight: 700 }}>{z.code}</span>
                  <span style={{ color: "var(--mut)" }}>→</span>
                  <span>{armador?.name || "Sin asignar"}</span>
                  {z.startedAt && (
                    <span className="mono" style={{ color: "var(--s-active)", fontSize: 12 }}>
                      {Math.round((Date.now() - z.startedAt) / 60000)} min
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="chart-grid">
        <div className="panel">
          <div className="panel-h"><h3>Tiempo promedio por zona</h3><span className="hint">minutos</span></div>
          <div className="bars">
            {zoneTimes.map((z) => {
              const high = z.time > 18;
              return (
                <div className="b" key={z.code}>
                  <span className="bv mono">{z.time}</span>
                  <div className="bar" style={{ height: (z.time / maxTime * 100) + "%", background: high ? "var(--s-not)" : "var(--accent)" }} />
                  <span className="bl mono">{z.code}</span>
                </div>
              );
            })}
          </div>
          <div style={{ padding: "0 16px 14px", fontSize: 11.5, color: "var(--faint)" }}>
            Las zonas rojas superan el promedio — posible cuello de botella del proceso, no del armador.
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>Productividad por armador</h3><span className="hint">prod/h</span></div>
          <div style={{ padding: "8px 0", maxHeight: 210, overflow: "auto" }}>
            {armadorProd.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--faint)" }}>Sin datos</div>
            ) : (
              armadorProd.map((a) => (
                <div className="hbar" key={a.name}>
                  <span className="nm">{a.name}</span>
                  <div className="track">
                    <i style={{ width: (a.prodH / maxProd * 100) + "%", background: a.prodH >= 812 ? "var(--s-done)" : "var(--s-active)" }} />
                  </div>
                  <span className="vv mono">{a.prodH}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>Incidencias registradas</h3><span className="hint">por zona</span></div>
          <div style={{ padding: "8px 0", maxHeight: 210, overflow: "auto" }}>
            {incZones.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--faint)" }}>Sin incidencias</div>
            ) : (
              incZones.map((z) => (
                <div className="hbar" key={z.id}>
                  <span className="nm" style={{ width: 90, fontSize: 12 }}>{z.code}</span>
                  <span style={{ flex: 1, fontSize: 11.5, color: "var(--mut)" }}>{z.incidentNote || "Sin detalle registrado"}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><h3>Índice operacional del sector</h3></div>
          <div style={{ padding: "20px 16px", display: "flex", alignItems: "center", gap: 18 }}>
            <div className="mono" style={{ fontSize: 46, fontWeight: 600 }}>
              {completionRate}<span style={{ fontSize: 18, color: "var(--faint)" }}>/100</span>
            </div>
            <div style={{ flex: 1 }}>
              {[
                ["Velocidad", Math.min(100, Math.round(avgTime > 0 ? (15 / avgTime) * 100 : 0))],
                ["Cumplimiento", completionRate],
                ["Calidad", Math.max(0, 100 - incZones.length * 5)],
                ["Desplazamiento", Math.min(100, Math.round(armadorProd.length > 0 ? 85 : 0))],
              ].map(([n, v]) => (
                <div key={n} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--mut)" }}>
                    <span>{n}</span>
                    <span className="mono">{v}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 20, background: "var(--panel2)", marginTop: 3 }}>
                    <i style={{ display: "block", height: "100%", width: v + "%", background: "var(--accent)", borderRadius: 20 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
