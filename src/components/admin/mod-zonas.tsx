/**
 * @file components/admin/mod-zonas.tsx
 * @description Modulo de zonas: vista detallada del contenido de cada zona.
 * Muestra todos los productos asignados a cada zona con busqueda y filtros.
 */

"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import { Kpi } from "@/components/ui/kpi";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores } from "@/lib/firestore";
import type { Zone, Armador } from "@/types";

type SortKey = "code" | "products" | "sector" | "status" | "armador";

export function ModZonas() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<"all" | "A" | "B">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [hasProductsFilter, setHasProductsFilter] = useState<"all" | "yes" | "no">("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    return () => { unsubZ(); unsubA(); };
  }, [user?.companyId]);

  const armadorMap = useMemo(() => {
    const m: Record<string, Armador> = {};
    armadores.forEach((a) => { if (a.id) m[a.id] = a; });
    return m;
  }, [armadores]);

  const filtered = useMemo(() => {
    let result = zones;
    if (sectorFilter !== "all") result = result.filter((z) => z.sector === sectorFilter);
    if (statusFilter !== "all") result = result.filter((z) => z.status === statusFilter);
    if (hasProductsFilter === "yes") result = result.filter((z) => z.products && z.products.length > 0);
    else if (hasProductsFilter === "no") result = result.filter((z) => !z.products || z.products.length === 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((z) => {
        if (z.code.toLowerCase().includes(q)) return true;
        if (z.pallet?.toLowerCase().includes(q)) return true;
        if (z.ruta?.toLowerCase().includes(q)) return true;
        if (z.familia?.toLowerCase().includes(q)) return true;
        if (z.products?.some((p) => p.codigo.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q))) return true;
        const arm = z.armadorId ? armadorMap[z.armadorId] : null;
        if (arm?.name.toLowerCase().includes(q)) return true;
        return false;
      });
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code": cmp = a.code.localeCompare(b.code); break;
        case "products": cmp = (a.products?.length || 0) - (b.products?.length || 0); break;
        case "sector": cmp = a.sector.localeCompare(b.sector); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "armador": {
          const nA = a.armadorId ? armadorMap[a.armadorId]?.name || "" : "";
          const nB = b.armadorId ? armadorMap[b.armadorId]?.name || "" : "";
          cmp = nA.localeCompare(nB);
          break;
        }
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [zones, sectorFilter, statusFilter, hasProductsFilter, search, sortKey, sortAsc, armadorMap]);

  const stats = useMemo(() => {
    const total = zones.length;
    const withProducts = zones.filter((z) => z.products && z.products.length > 0).length;
    const totalProducts = zones.reduce((sum, z) => sum + (z.products?.length || 0), 0);
    const totalCant = zones.reduce((sum, z) => sum + (z.products?.reduce((s, p) => s + p.cantidad, 0) || 0), 0);
    const avg = withProducts > 0 ? Math.round(totalProducts / withProducts) : 0;
    return { total, withProducts, totalProducts, totalCant, avg };
  }, [zones]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return null;
    return sortAsc ? " \u25B2" : " \u25BC";
  }

  const STATUS_LABELS: Record<string, string> = {
    idle: "Pendiente", assigned: "Asignada", active: "En proceso",
    paused: "Pausada", done: "Completada", incident: "Incidencia",
  };
  const STATUS_COLORS: Record<string, string> = {
    idle: "var(--s-idle)", assigned: "var(--s-assigned)", active: "var(--s-active)",
    paused: "var(--s-paused)", done: "var(--s-done)", incident: "var(--s-inc)",
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando zonas...</div>;
  }

  return (
    <div>
      {/* KPIs */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 16 }}>
        <Kpi small accent="var(--accent)" lab="Total zonas" val={stats.total} />
        <Kpi small accent="var(--s-done)" lab="Con productos" val={stats.withProducts} />
        <Kpi small accent="var(--s-active)" lab="Total productos" val={stats.totalProducts} />
        <Kpi small accent="var(--s-assigned)" lab="Unidades totales" val={stats.totalCant} />
        <Kpi small accent="var(--s-paused)" lab="Prom. prod/zona" val={stats.avg} />
      </div>

      {/* Filters */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
          <div className="orgselect">
            <button className={sectorFilter === "all" ? "on" : ""} onClick={() => setSectorFilter("all")}>Todos</button>
            <button className={sectorFilter === "A" ? "on" : ""} onClick={() => setSectorFilter("A")}>A</button>
            <button className={sectorFilter === "B" ? "on" : ""} onClick={() => setSectorFilter("B")}>B</button>
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="field-select">
            <option value="all">Todos los estados</option>
            <option value="idle">Pendiente</option>
            <option value="assigned">Asignada</option>
            <option value="active">En proceso</option>
            <option value="paused">Pausada</option>
            <option value="done">Completada</option>
            <option value="incident">Incidencia</option>
          </select>
          <select value={hasProductsFilter} onChange={(e) => setHasProductsFilter(e.target.value as "all" | "yes" | "no")} className="field-select">
            <option value="all">Con/sin productos</option>
            <option value="yes">Con productos</option>
            <option value="no">Sin productos</option>
          </select>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar zona, producto, armador..." className="field-input" style={{ flex: 1, minWidth: 180 }} />
          <span style={{ fontSize: 11, color: "var(--faint)" }}>{filtered.length} zonas</span>
        </div>
      </div>

      {/* Zone Table */}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("code")}>Zona{sortIcon("code")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("sector")}>Sector{sortIcon("sector")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("status")}>Estado{sortIcon("status")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("armador")}>Armador{sortIcon("armador")}</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("products")}>Prod.{sortIcon("products")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Pallet</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Ruta</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((z) => {
                const arm = z.armadorId ? armadorMap[z.armadorId] : null;
                const prodCount = z.products?.length || 0;
                const isExpanded = expandedZone === z.code;
                return (
                  <Fragment key={z.code}>
                    <tr style={{ borderBottom: "1px solid var(--line)", cursor: "pointer", background: isExpanded ? "color-mix(in srgb, var(--accent) 4%, transparent)" : undefined }} onClick={() => setExpandedZone(isExpanded ? null : z.code)}>
                      <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</td>
                      <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--panel2)", fontWeight: 600 }}>{z.sector}</span></td>
                      <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `color-mix(in srgb, ${STATUS_COLORS[z.status] || "var(--faint)"} 12%, transparent)`, color: STATUS_COLORS[z.status] || "var(--faint)", fontWeight: 600 }}>{STATUS_LABELS[z.status] || z.status}</span></td>
                      <td style={{ padding: "10px 14px" }}>
                        {arm ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 20, height: 20, borderRadius: 5, background: arm.color || "var(--accent)", display: "inline-grid", placeItems: "center", color: "#fff", fontSize: 9, fontWeight: 700 }}>{arm.name[0]}</span>
                            <span style={{ fontSize: 12 }}>{arm.name}</span>
                          </span>
                        ) : <span style={{ fontSize: 12, color: "var(--faint)" }}>&mdash;</span>}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        {prodCount > 0 ? <span style={{ color: "var(--accent)" }}>{prodCount}</span> : <span style={{ color: "var(--faint)" }}>0</span>}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--mut)" }}>{z.pallet || "\u2014"}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--mut)" }}>{z.ruta || "\u2014"}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <span style={{ fontSize: 14, color: isExpanded ? "var(--accent)" : "var(--faint)" }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}><ZoneDetail zone={z} armador={arm} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>No se encontraron zonas con los filtros seleccionados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ZoneDetail({ zone, armador }: { zone: Zone; armador: Armador | null }) {
  const products = zone.products || [];
  const totalCant = products.reduce((sum, p) => sum + p.cantidad, 0);

  return (
    <div style={{ padding: "16px 20px", background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Codigo", zone.code],
          ["Sector", zone.sector],
          ["Pallet", zone.pallet || "\u2014"],
          ["Total Pallets", zone.palletTotal || "\u2014"],
          ["Ruta", zone.ruta || "\u2014"],
          ["Familia", zone.familia || "\u2014"],
          ["Camion", zone.camion || "\u2014"],
          ["Fecha Entrega", zone.fechaEntrega || "\u2014"],
          ["Prioridad", zone.prioridad || "media"],
          ["Armador", armador?.name || "Sin asignar"],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>
        Productos ({products.length} tipos, {totalCant} unidades)
      </div>
      {products.length > 0 ? (
        <div style={{ background: "var(--bg)", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Codigo</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Descripcion</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={`${p.codigo}-${i}`} style={{ borderBottom: i < products.length - 1 ? "1px solid var(--line)" : undefined }}>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--mono)", fontWeight: 500 }}>{p.codigo}</td>
                  <td style={{ padding: "8px 12px", color: "var(--mut)" }}>{p.descripcion}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{p.cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 12, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--line)" }}>
          Esta zona no tiene productos asignados
        </div>
      )}
    </div>
  );
}
