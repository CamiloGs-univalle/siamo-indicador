/**
 * @file components/admin/mod-zonas.tsx
 * @description Modulo de ZONAS: espacios fisicos del almacen.
 * Una zona es un estante/ubicacion donde estan los productos.
 *
 * Un zona puede tener VARIOS membretes (ordenes de picking) asignados.
 * Un membrete pertenece a UNA sola zona.
 */

"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import { Kpi } from "@/components/ui/kpi";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeMembretes, updateZone, deleteZone } from "@/lib/firestore";
import type { Zone, Membrete, ZonePriority } from "@/types";

type SortKey = "code" | "products" | "sector" | "status" | "membretes";

export function ModZonas() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<"all" | "A" | "B">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [hasProductsFilter, setHasProductsFilter] = useState<"all" | "yes" | "no">("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [editForm, setEditForm] = useState({ sector: "A", prioridad: "media" as ZonePriority });
  const [deletingZone, setDeletingZone] = useState<Zone | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubM = subscribeMembretes(user.companyId, setMembretes);
    return () => { unsubZ(); unsubM(); };
  }, [user?.companyId]);

  // Agrupar membretes por zona
  const membretesByZona = useMemo(() => {
    const m: Record<string, Membrete[]> = {};
    membretes.forEach((mem) => {
      if (mem.zonaId) {
        if (!m[mem.zonaId]) m[mem.zonaId] = [];
        m[mem.zonaId].push(mem);
      }
    });
    return m;
  }, [membretes]);

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
        if (z.products?.some((p) => p.codigo.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q))) return true;
        const zMembretes = membretesByZona[z.id || ""] || [];
        if (zMembretes.some((mem) => mem.code.toLowerCase().includes(q) || mem.ruta?.toLowerCase().includes(q) || mem.pallet?.toLowerCase().includes(q))) return true;
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
        case "membretes": cmp = (membretesByZona[a.id || ""]?.length || 0) - (membretesByZona[b.id || ""]?.length || 0); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [zones, sectorFilter, statusFilter, hasProductsFilter, search, sortKey, sortAsc, membretesByZona]);

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

  function startEdit(zone: Zone) {
    setEditingZone(zone);
    setEditForm({
      sector: zone.sector,
      prioridad: zone.prioridad || "media",
    });
  }

  function cancelEdit() {
    setEditingZone(null);
  }

  async function handleSaveEdit() {
    if (!editingZone?.id || !user) return;
    setSaving(true);
    try {
      await updateZone(editingZone.id, {
        sector: editForm.sector as "A" | "B",
        prioridad: editForm.prioridad,
      }, { uid: user.uid, name: user.name });
      setEditingZone(null);
    } catch (e) {
      console.error("Error updating zone:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteZone() {
    if (!deletingZone?.id) return;
    setSaving(true);
    try {
      await deleteZone(deletingZone.id);
      setDeletingZone(null);
      if (expandedZone === deletingZone.code) setExpandedZone(null);
    } catch (e) {
      console.error("Error deleting zone:", e);
    } finally {
      setSaving(false);
    }
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
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar zona, producto, membrete..." className="field-input" style={{ flex: 1, minWidth: 180 }} />
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
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("products")}>Prod.{sortIcon("products")}</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("membretes")}>Membretes{sortIcon("membretes")}</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((z) => {
                const zMembretes = membretesByZona[z.id || ""] || [];
                const prodCount = z.products?.length || 0;
                const isExpanded = expandedZone === z.code;
                return (
                  <Fragment key={z.code}>
                    <tr style={{ borderBottom: "1px solid var(--line)", cursor: "pointer", background: isExpanded ? "color-mix(in srgb, var(--accent) 4%, transparent)" : undefined }} onClick={() => setExpandedZone(isExpanded ? null : z.code)}>
                      <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</td>
                      <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--panel2)", fontWeight: 600 }}>{z.sector}</span></td>
                      <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `color-mix(in srgb, ${STATUS_COLORS[z.status] || "var(--faint)"} 12%, transparent)`, color: STATUS_COLORS[z.status] || "var(--faint)", fontWeight: 600 }}>{STATUS_LABELS[z.status] || z.status}</span></td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        {prodCount > 0 ? <span style={{ color: "var(--accent)" }}>{prodCount}</span> : <span style={{ color: "var(--faint)" }}>0</span>}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        {zMembretes.length > 0 ? <span style={{ color: "var(--accent)" }}>{zMembretes.length}</span> : <span style={{ color: "var(--faint)" }}>0</span>}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); startEdit(z); }}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", color: "var(--accent)" }}
                            title="Editar zona"
                          >&#9998;</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingZone(z); }}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", color: "var(--s-inc)" }}
                            title="Eliminar zona"
                          >&#10005;</button>
                          <span style={{ fontSize: 14, color: isExpanded ? "var(--accent)" : "var(--faint)", cursor: "pointer", padding: "3px 4px" }} onClick={() => setExpandedZone(isExpanded ? null : z.code)}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0 }}><ZoneDetail zone={z} membretes={zMembretes} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>No se encontraron zonas con los filtros seleccionados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal — solo sector y prioridad */}
      {editingZone && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={cancelEdit}>
          <div style={{ background: "var(--panel)", borderRadius: 12, padding: 24, width: 360, maxWidth: "90vw", border: "1px solid var(--line)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Editar Zona {editingZone.code.replace(/^.*_/, "")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Sector</label>
                <select value={editForm.sector} onChange={(e) => setEditForm({ ...editForm, sector: e.target.value })} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }}>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Prioridad</label>
                <select value={editForm.prioridad} onChange={(e) => setEditForm({ ...editForm, prioridad: e.target.value as ZonePriority })} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }}>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={cancelEdit} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
              <button onClick={handleSaveEdit} disabled={saving} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deletingZone && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setDeletingZone(null)}>
          <div style={{ background: "var(--panel)", borderRadius: 12, padding: 24, width: 360, maxWidth: "90vw", border: "1px solid var(--line)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "var(--s-inc)" }}>Eliminar Zona</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--mut)" }}>
              Se eliminara permanentemente la zona <strong>{deletingZone.code.replace(/^.*_/, "")}</strong> y todos sus datos asociados. Esta accion no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setDeletingZone(null)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
              <button onClick={handleDeleteZone} disabled={saving} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--s-inc)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "Eliminando..." : "Eliminar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detalle de la Zona (expandido) ────────────────────────────────────────
function ZoneDetail({ zone, membretes }: { zone: Zone; membretes: Membrete[] }) {
  const products = zone.products || [];
  const totalCant = products.reduce((sum, p) => sum + p.cantidad, 0);

  return (
    <div style={{ padding: "16px 20px", background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
      {/* Info basica de la zona */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Codigo", zone.code.replace(/^.*_/, "")],
          ["Sector", zone.sector],
          ["Estado", zone.status],
          ["Prioridad", zone.prioridad || "media"],
          ["Productos", `${products.length} tipos`],
          ["Unidades", `${totalCant} uds`],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Membretes de esta zona */}
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>
        Membretes asignados ({membretes.length})
      </div>
      {membretes.length > 0 ? (
        <div style={{ background: "var(--bg)", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden", marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Codigo</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Ruta</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Pallet</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Familia</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Camion</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Unids.</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {membretes.map((mem) => (
                <tr key={mem.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--mono)", fontWeight: 500 }}>{mem.code}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--mono)" }}>{mem.ruta || "\u2014"}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--mono)" }}>{mem.pallet || "\u2014"}</td>
                  <td style={{ padding: "8px 12px" }}>{mem.familia || "\u2014"}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--mono)" }}>{mem.camion || "\u2014"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{mem.totalUnits}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: `color-mix(in srgb, ${mem.status === "completed" ? "var(--s-done)" : mem.status === "active" ? "var(--s-active)" : "var(--s-idle)"} 12%, transparent)` }}>
                      {mem.status === "completed" ? "Hecho" : mem.status === "active" ? "Activo" : "Pendiente"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 12, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--line)", marginBottom: 16 }}>
          Esta zona no tiene membretes asignados. Vaya a &quot;Membretes&quot; para crear o asignar.
        </div>
      )}

      {/* Productos de la zona (inventario) */}
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>
        Productos en esta zona ({products.length} tipos, {totalCant} unidades)
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
          Esta zona no tiene productos. Cargue datos desde SAP.
        </div>
      )}
    </div>
  );
}
