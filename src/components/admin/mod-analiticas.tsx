/**
 * @file components/admin/mod-analiticas.tsx
 * @description Modulo de analitica operacional por zonas.
 * Mide saturacion, productividad, distribucion de armadores,
 * y genera recomendaciones en tiempo real.
 */

"use client";

import { useEffect, useState, useMemo } from "react";
import { Kpi } from "@/components/ui/kpi";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions } from "@/lib/firestore";
import { computeZoneAnalytics } from "@/lib/zone-analytics";
import type { Zone, Armador, ScanSession } from "@/types";
import type { ZoneMetric, ZoneAnalyticsSummary } from "@/lib/zone-analytics";

export function ModAnaliticas() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"resumen" | "zonas" | "alertas" | "recomendaciones">("resumen");

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubS = subscribeSessions(user.companyId, setSessions);
    return () => { unsubZ(); unsubA(); unsubS(); };
  }, [user?.companyId]);

  const analytics = useMemo(() => {
    if (zones.length === 0) return null;
    return computeZoneAnalytics(zones, armadores, sessions);
  }, [zones, armadores, sessions]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando analitica...</div>;
  }

  if (!analytics) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#x1F4CA;</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Sin datos suficientes</div>
        <div style={{ fontSize: 13, color: "var(--mut)" }}>Carga datos desde SAP y asigna zonas para ver la analitica</div>
      </div>
    );
  }

  return (
    <div>
      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--panel2)", borderRadius: 10, padding: 4 }}>
        {(["resumen", "zonas", "alertas", "recomendaciones"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              background: activeTab === tab ? "var(--accent)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--mut)",
              fontWeight: 600, fontSize: 12, fontFamily: "inherit", textTransform: "capitalize",
            }}
          >
            {tab === "resumen" && "Resumen"}
            {tab === "zonas" && `Zonas (${analytics.zones.length})`}
            {tab === "alertas" && `Alertas (${analytics.alerts.length})`}
            {tab === "recomendaciones" && `Recomendaciones (${analytics.recommendations.length})`}
          </button>
        ))}
      </div>

      {/* ══════ TAB: RESUMEN ══════ */}
      {activeTab === "resumen" && (
        <ResumenTab analytics={analytics} />
      )}

      {/* ══════ TAB: ZONAS ══════ */}
      {activeTab === "zonas" && (
        <ZonasTab analytics={analytics} />
      )}

      {/* ══════ TAB: ALERTAS ══════ */}
      {activeTab === "alertas" && (
        <AlertasTab analytics={analytics} />
      )}

      {/* ══════ TAB: RECOMENDACIONES ══════ */}
      {activeTab === "recomendaciones" && (
        <RecomendacionesTab analytics={analytics} />
      )}
    </div>
  );
}

// ─── RESUMEN TAB ────────────────────────────────────────────────────────────

function ResumenTab({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const maxTime = Math.max(...analytics.zones.map((z) => z.actualMinutes), 15);

  return (
    <div>
      {/* KPIs principales */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
        <Kpi small accent="var(--accent)" lab="Eficiencia promedio" val={`${analytics.avgEfficiency}%`} />
        <Kpi small accent="var(--s-done)" lab="Prod/h promedio" val={analytics.avgProductsPerHour} />
        <Kpi small accent="var(--s-active)" lab="Score balance" val={`${analytics.balanceScore}%`} />
        <Kpi small accent="var(--s-assigned)" lab="Zonas activas" val={analytics.activeCount} />
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
        <Kpi small accent="var(--s-inc)" lab="Saturadas" val={analytics.saturatedCount} />
        <Kpi small accent="var(--s-paused)" lab="Subutilizadas" val={analytics.underutilizedCount} />
        <Kpi small accent="var(--s-idle)" lab="Pendientes" val={analytics.idleCount} />
        <Kpi small accent="var(--s-done)" lab="Completadas" val={analytics.doneCount} />
      </div>

      {/* Grafico de barras: Tiempo por zona vs objetivo */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-h">
          <h3>Tiempo por zona vs Objetivo ({analytics.zones[0]?.targetMinutes || 15} min)</h3>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 180, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            {analytics.zones.slice(0, 20).map((z) => {
              const h = Math.round((z.actualMinutes / maxTime) * 150);
              const color = z.actualMinutes > 15 ? "var(--s-inc)" : z.actualMinutes > 10 ? "var(--s-paused)" : "var(--s-done)";
              return (
                <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: "var(--tx)", marginBottom: 4 }}>{z.actualMinutes}m</span>
                  <div style={{ width: "100%", maxWidth: 40, height: Math.max(h, 4), borderRadius: "4px 4px 0 0", background: color }} />
                </div>
              );
            })}
          </div>
          {/* Target line */}
          <div style={{ position: "relative", height: 0 }}>
            <div style={{ position: "absolute", bottom: Math.round((15 / maxTime) * 150) + 8, left: 0, right: 0, borderTop: "2px dashed var(--accent)", opacity: 0.5 }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {analytics.zones.slice(0, 20).map((z) => (
              <div key={z.code} style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--faint)" }}>{z.code.replace(/^.*_/, "")}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Dos columnas: Productos + Distribucion */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Productos por zona */}
        <div className="panel">
          <div className="panel-h"><h3>Productos por zona</h3></div>
          <div style={{ padding: "16px 20px" }}>
            {analytics.zones.filter((z) => z.totalProducts > 0).sort((a, b) => b.totalProducts - a.totalProducts).slice(0, 10).map((z) => {
              const maxProd = Math.max(...analytics.zones.map((zz) => zz.totalProducts), 1);
              const w = Math.round((z.totalProducts / maxProd) * 100);
              return (
                <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 50, fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</span>
                  <div style={{ flex: 1, height: 16, background: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 30, textAlign: "right", fontSize: 11, fontWeight: 600 }}>{z.totalProducts}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Distribucion de armadores */}
        <div className="panel">
          <div className="panel-h"><h3>Distribucion de armadores</h3></div>
          <div style={{ padding: "16px 20px" }}>
            {analytics.zones.filter((z) => z.armadorCount > 0).sort((a, b) => b.armadorCount - a.armadorCount).slice(0, 10).map((z) => {
              const maxArm = Math.max(...analytics.zones.map((zz) => zz.armadorCount), 1);
              const w = Math.round((z.armadorCount / maxArm) * 100);
              return (
                <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 50, fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</span>
                  <div style={{ flex: 1, height: 16, background: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: "var(--s-active)", borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 30, textAlign: "right", fontSize: 11, fontWeight: 600 }}>{z.armadorCount}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mejor y peor zona */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        {analytics.bestZone && (
          <div className="panel" style={{ borderLeft: "4px solid var(--s-done)" }}>
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--s-done)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Zona mas productiva</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{analytics.bestZone.code.replace(/^.*_/, "")}</div>
              <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>
                Score {analytics.bestZone.score} · {analytics.bestZone.actualMinutes} min · {analytics.bestZone.productsPerHour} prod/h · {analytics.bestZone.totalProducts} productos
              </div>
            </div>
          </div>
        )}
        {analytics.worstZone && (
          <div className="panel" style={{ borderLeft: "4px solid var(--s-inc)" }}>
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--s-inc)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Zona con menor desempeno</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{analytics.worstZone.code.replace(/^.*_/, "")}</div>
              <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>
                Score {analytics.worstZone.score} · {analytics.worstZone.actualMinutes} min · {analytics.worstZone.productsPerHour} prod/h · {analytics.worstZone.totalProducts} productos
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ZONAS TAB ──────────────────────────────────────────────────────────────

function ZonasTab({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const [sortKey, setSortKey] = useState<"code" | "actualMinutes" | "efficiency" | "totalProducts" | "armadorCount" | "score">("score");
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const arr = [...analytics.zones];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code": cmp = a.code.localeCompare(b.code); break;
        case "actualMinutes": cmp = a.actualMinutes - b.actualMinutes; break;
        case "efficiency": cmp = a.efficiency - b.efficiency; break;
        case "totalProducts": cmp = a.totalProducts - b.totalProducts; break;
        case "armadorCount": cmp = a.armadorCount - b.armadorCount; break;
        case "score": cmp = a.score - b.score; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [analytics.zones, sortKey, sortAsc]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function sortIcon(key: typeof sortKey) {
    if (sortKey !== key) return null;
    return sortAsc ? " \u25B2" : " \u25BC";
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => toggleSort("code")}>Zona{sortIcon("code")}</th>
              <th style={{ padding: "10px 12px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Estado</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => toggleSort("actualMinutes")}>Tiempo{sortIcon("actualMinutes")}</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Varianza</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => toggleSort("efficiency")}>Eficiencia{sortIcon("efficiency")}</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => toggleSort("totalProducts")}>Prod.{sortIcon("totalProducts")}</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => toggleSort("armadorCount")}>Armadores{sortIcon("armadorCount")}</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => toggleSort("score")}>Score{sortIcon("score")}</th>
              <th style={{ padding: "10px 12px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Carga</th>
              <th style={{ padding: "10px 12px", width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((z) => {
              const isExpanded = expanded === z.code;
              const varianceColor = z.varianceMinutes > 0 ? "var(--s-inc)" : "var(--s-done)";
              return (
                <tr key={z.code} style={{ borderBottom: "1px solid var(--line)", cursor: "pointer", background: isExpanded ? "color-mix(in srgb, var(--accent) 4%, transparent)" : undefined }} onClick={() => setExpanded(isExpanded ? null : z.code)}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 12, background: `color-mix(in srgb, ${statusColor(z.status)} 12%, transparent)`, color: statusColor(z.status), fontWeight: 600 }}>{statusLabel(z.status)}</span>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.actualMinutes}m</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600, color: varianceColor }}>
                    {z.varianceMinutes > 0 ? "+" : ""}{z.varianceMinutes}m
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      <div style={{ width: 50, height: 6, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${z.efficiency}%`, height: "100%", background: z.efficiency >= 80 ? "var(--s-done)" : z.efficiency >= 50 ? "var(--s-paused)" : "var(--s-inc)", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 11 }}>{z.efficiency}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.totalProducts}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.armadorCount}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: z.score >= 70 ? "var(--s-done)" : z.score >= 40 ? "var(--s-paused)" : "var(--s-inc)" }}>{z.score}</span>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 12, background: loadColor(z.loadLevel), fontWeight: 600 }}>{z.loadLevel}</span>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--faint)" }}>{isExpanded ? "\u25BC" : "\u25B6"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <ZoneDetailPanel zone={analytics.zones.find((z) => z.code === expanded)!} />
      )}
    </div>
  );
}

function ZoneDetailPanel({ zone }: { zone: ZoneMetric }) {
  return (
    <div style={{ padding: "16px 20px", background: "var(--panel2)", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
        <DetailItem label="Tiempo real" value={`${zone.actualMinutes} min`} />
        <DetailItem label="Objetivo" value={`${zone.targetMinutes} min`} />
        <DetailItem label="Varianza" value={`${zone.varianceMinutes > 0 ? "+" : ""}${zone.varianceMinutes} min`} color={zone.varianceMinutes > 0 ? "var(--s-inc)" : "var(--s-done)"} />
        <DetailItem label="Eficiencia" value={`${zone.efficiency}%`} color={zone.efficiency >= 80 ? "var(--s-done)" : "var(--s-inc)"} />
        <DetailItem label="Prod/min" value={String(zone.productsPerMinute)} />
        <DetailItem label="Prod/hora" value={String(zone.productsPerHour)} />
        <DetailItem label="Unidades" value={String(zone.totalUnits)} />
        <DetailItem label="Unid/armador" value={String(zone.unitsPerArmador)} />
        <DetailItem label="Sesiones" value={String(zone.sessionsCompleted)} />
        <DetailItem label="Min prom/sesion" value={`${zone.avgSessionMinutes}m`} />
        <DetailItem label="Min min/sesion" value={`${zone.minSessionMinutes}m`} />
        <DetailItem label="Min max/sesion" value={`${zone.maxSessionMinutes}m`} />
      </div>
      {zone.armadorNames.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", marginBottom: 6 }}>Armadores en esta zona:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {zone.armadorNames.map((name) => (
              <span key={name} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, background: "var(--panel)", border: "1px solid var(--line)", fontWeight: 500 }}>{name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || "var(--tx)" }}>{value}</div>
    </div>
  );
}

// ─── ALERTAS TAB ────────────────────────────────────────────────────────────

function AlertasTab({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  if (analytics.alerts.length === 0) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#x2705;</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--s-done)" }}>Sin alertas activas</div>
        <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>Todas las zonas estan operando dentro de parametros normales</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {analytics.alerts.map((alert, i) => (
        <div key={i} className="panel" style={{ borderLeft: `4px solid ${severityColor(alert.severity)}`, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span style={{ fontSize: 18 }}>{alertIcon(alert.type)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: severityBg(alert.severity), color: severityColor(alert.severity), fontWeight: 700, textTransform: "uppercase" }}>{alert.severity}</span>
                <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--mono)" }}>{alert.zoneCode}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{alert.message}</div>
              <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>&#x1F4A1; {alert.recommendation}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── RECOMENDACIONES TAB ────────────────────────────────────────────────────

function RecomendacionesTab({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  if (analytics.recommendations.length === 0) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#x1F3AF;</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Sin recomendaciones pendientes</div>
        <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>La operacion esta equilibrada</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {analytics.recommendations.map((rec, i) => (
        <div key={i} className="panel" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: categoryColor(rec.category), display: "grid", placeItems: "center", color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
              {rec.priority}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{rec.title}</div>
              <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 8, lineHeight: 1.5 }}>{rec.description}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: categoryBg(rec.category), color: categoryColor(rec.category), fontWeight: 700, textTransform: "uppercase" }}>{rec.category}</span>
                <span style={{ fontSize: 11, color: "var(--s-done)", fontWeight: 500 }}>&#x26A1; {rec.impact}</span>
              </div>
              {rec.zones.length > 0 && rec.zones.length <= 5 && (
                <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {rec.zones.map((z) => (
                    <span key={z} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--panel2)", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.replace(/^.*_/, "")}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusLabel(s: string) {
  const m: Record<string, string> = { idle: "Pend", assigned: "Asig", active: "Act", paused: "Paus", done: "Listo", incident: "Incid" };
  return m[s] || s;
}

function statusColor(s: string) {
  const m: Record<string, string> = { idle: "var(--s-idle)", assigned: "var(--s-assigned)", active: "var(--s-active)", paused: "var(--s-paused)", done: "var(--s-done)", incident: "var(--s-inc)" };
  return m[s] || "var(--faint)";
}

function loadColor(l: string) {
  const m: Record<string, string> = { alta: "color-mix(in srgb, var(--s-inc) 15%, transparent)", media: "color-mix(in srgb, var(--s-paused) 15%, transparent)", baja: "color-mix(in srgb, var(--s-done) 15%, transparent)" };
  return m[l] || "transparent";
}

function severityColor(s: string) {
  return s === "high" ? "var(--s-inc)" : s === "medium" ? "var(--s-paused)" : "var(--s-idle)";
}

function severityBg(s: string) {
  return s === "high" ? "color-mix(in srgb, var(--s-inc) 12%, transparent)" : s === "medium" ? "color-mix(in srgb, var(--s-paused) 12%, transparent)" : "color-mix(in srgb, var(--s-idle) 12%, transparent)";
}

function alertIcon(t: string) {
  const m: Record<string, string> = { saturated: "\u26A0\uFE0F", underutilized: "\u2193", slow: "\u23F1", fast: "\u26A1", incident: "\u274C", idle: "\u23F8", unbalanced: "\u2696\uFE0F" };
  return m[t] || "\u2139\uFE0F";
}

function categoryColor(c: string) {
  const m: Record<string, string> = { distribucion: "var(--s-active)", tiempo: "var(--s-paused)", productividad: "var(--s-done)", capacidad: "var(--s-inc)" };
  return m[c] || "var(--accent)";
}

function categoryBg(c: string) {
  const m: Record<string, string> = { distribucion: "color-mix(in srgb, var(--s-active) 12%, transparent)", tiempo: "color-mix(in srgb, var(--s-paused) 12%, transparent)", productividad: "color-mix(in srgb, var(--s-done) 12%, transparent)", capacidad: "color-mix(in srgb, var(--s-inc) 12%, transparent)" };
  return m[c] || "transparent";
}
