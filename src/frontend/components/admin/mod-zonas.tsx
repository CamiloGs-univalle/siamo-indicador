"use client";

import { useEffect, useState, useMemo } from "react";
import { Kpi } from "@/frontend/components/ui/kpi";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeZones, subscribeMembretes, updateZone, deleteZone, importWarehouseFloorplanZones } from "@/frontend/services/firestore";
import type { Zone, Membrete, ZonePriority } from "@/types";

type SortKey = "code" | "products" | "sector" | "status" | "membretes" | "cola" | "armadores";

const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const badgeStyle: React.CSSProperties = { fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--panel2)", fontWeight: 600 };
const actionBtn: React.CSSProperties = { fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", color: "var(--accent)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 };
const selectStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 };
const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const modalStyle: React.CSSProperties = { background: "var(--panel)", borderRadius: 12, padding: 24, width: 360, maxWidth: "90vw", border: "1px solid var(--line)" };
const btnCancel: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", fontSize: 13 };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 };
const slideOverStyle: React.CSSProperties = {
  position: "fixed", top: 0, right: 0, bottom: 0, width: 440, maxWidth: "90vw",
  background: "var(--panel)", borderLeft: "1px solid var(--line)",
  boxShadow: "-8px 0 30px rgba(0,0,0,0.12)", zIndex: 900,
  display: "flex", flexDirection: "column", overflow: "hidden",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Pendiente", assigned: "Asignada", active: "En proceso",
  paused: "Pausada", done: "Completada", incident: "Incidencia",
};
const STATUS_COLORS: Record<string, string> = {
  idle: "var(--s-idle)", assigned: "var(--s-assigned)", active: "var(--s-active)",
  paused: "var(--s-paused)", done: "var(--s-done)", incident: "var(--s-inc)",
};

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
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [editForm, setEditForm] = useState({ sector: "A", prioridad: "media" as ZonePriority });
  const [deletingZone, setDeletingZone] = useState<Zone | null>(null);
  const [saving, setSaving] = useState(false);
  const [importingFloorplan, setImportingFloorplan] = useState(false);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubM = subscribeMembretes(user.companyId, setMembretes);
    return () => { unsubZ(); unsubM(); };
  }, [user?.companyId]);

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

  const zoneQueueStats = useMemo(() => {
    const s: Record<string, { enCola: number; armadores: Map<string, string> }> = {};
    membretes.forEach((mem) => {
      if (!mem.zonaId) return;
      if (!s[mem.zonaId]) s[mem.zonaId] = { enCola: 0, armadores: new Map() };
      if (!mem.armadorId && mem.status === "pending") s[mem.zonaId].enCola++;
      if (mem.armadorId && mem.status === "active") s[mem.zonaId].armadores.set(mem.armadorId, mem.armadorName || "?");
    });
    return s;
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
        case "cola": cmp = (zoneQueueStats[a.id || ""]?.enCola || 0) - (zoneQueueStats[b.id || ""]?.enCola || 0); break;
        case "armadores": cmp = (zoneQueueStats[a.id || ""]?.armadores.size || 0) - (zoneQueueStats[b.id || ""]?.armadores.size || 0); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [zones, sectorFilter, statusFilter, hasProductsFilter, search, sortKey, sortAsc, membretesByZona, zoneQueueStats]);

  const stats = useMemo(() => {
    const total = zones.length;
    const withProducts = zones.filter((z) => z.products && z.products.length > 0).length;
    const totalProducts = zones.reduce((sum, z) => sum + (z.products?.length || 0), 0);
    const totalCant = zones.reduce((sum, z) => sum + (z.products?.reduce((s, p) => s + p.cantidad, 0) || 0), 0);
    const avg = withProducts > 0 ? Math.round(totalProducts / withProducts) : 0;
    const enCola = Object.values(zoneQueueStats).reduce((sum, s) => sum + s.enCola, 0);
    const zonasConArmadores = Object.values(zoneQueueStats).filter((s) => s.armadores.size > 0).length;
    return { total, withProducts, totalProducts, totalCant, avg, enCola, zonasConArmadores };
  }, [zones, zoneQueueStats]);

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
    setEditForm({ sector: zone.sector, prioridad: zone.prioridad || "media" });
  }

  function cancelEdit() { setEditingZone(null); }

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

  async function handleImportFloorplan() {
    if (!user?.companyId) return;
    setImportingFloorplan(true);
    try {
      const res = await importWarehouseFloorplanZones(user.companyId, { uid: user.uid, name: user.name });
      if (res.created > 0) {
        alert(`Se importaron ${res.created} zona${res.created > 1 ? "s" : ""} del plano real de la bodega.` + (res.skipped > 0 ? ` (${res.skipped} ya existían.)` : ""));
      } else {
        alert("Las zonas del plano real ya estaban todas importadas.");
      }
    } catch (e) {
      console.error("Error importing floorplan zones:", e);
      alert("No se pudieron importar las zonas del plano. Intenta de nuevo.");
    } finally {
      setImportingFloorplan(false);
    }
  }

  async function handleDeleteZone() {
    if (!deletingZone?.id) return;
    setSaving(true);
    try {
      await deleteZone(deletingZone.id);
      setDeletingZone(null);
      if (selectedZone === deletingZone.code) setSelectedZone(null);
    } catch (e) {
      console.error("Error deleting zone:", e);
    } finally {
      setSaving(false);
    }
  }

  const detailZone = selectedZone ? zones.find((z) => z.code === selectedZone) : null;
  const detailMembretes = detailZone ? membretesByZona[detailZone.id || ""] || [] : [];

  if (loading) {
    return <div style={{ padding: 10, textAlign: "center", color: "var(--faint)" }}>Cargando zonas...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        <Kpi small accent="var(--accent)" lab="Total zonas" val={stats.total} />
        <Kpi small accent="var(--s-idle)" lab="En cola" val={stats.enCola} />
        <Kpi small accent="var(--s-active)" lab="Zonas c/armadores" val={stats.zonasConArmadores} />
        <Kpi small accent="var(--s-done)" lab="Con productos" val={stats.withProducts} />
        <Kpi small accent="var(--s-active)" lab="Total productos" val={stats.totalProducts} />
        <Kpi small accent="var(--s-assigned)" lab="Unidades totales" val={stats.totalCant} />
        <Kpi small accent="var(--s-paused)" lab="Prom. prod/zona" val={stats.avg} />
      </div>

      <div className="panel">
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
          <button
            className="btn sm"
            onClick={handleImportFloorplan}
            disabled={importingFloorplan}
            title="Crea, como zonas reales, las áreas del plano físico de la bodega (túneles de armado, racks, líneas, ZNC, etc.) que todavía no existan"
          >
            {importingFloorplan ? "Importando..." : "Importar zonas del plano"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, position: "relative", minHeight: 400 }}>
        <div className="panel" style={{ padding: 0, overflow: "hidden", flex: 1, minWidth: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
                  <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("code")}>Zona{sortIcon("code")}</th>
                  <th style={thStyle}>Nombre</th>
                  <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("sector")}>Sector{sortIcon("sector")}</th>
                  <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("status")}>Estado{sortIcon("status")}</th>
                  <th style={{ ...thStyle, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("products")}>Prod.{sortIcon("products")}</th>
                  <th style={{ ...thStyle, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("membretes")}>Membretes{sortIcon("membretes")}</th>
                  <th style={{ ...thStyle, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("cola")} title="Membretes pendientes que aun no ha tomado ningun armador">En cola{sortIcon("cola")}</th>
                  <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("armadores")} title="Armadores trabajando en esta zona en este momento">Armadores{sortIcon("armadores")}</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((z) => {
                  const zMembretes = membretesByZona[z.id || ""] || [];
                  const qStats = zoneQueueStats[z.id || ""] || { enCola: 0, armadores: new Map<string, string>() };
                  const prodCount = z.products?.length || 0;
                  const isSelected = selectedZone === z.code;
                  return (
                    <tr
                      key={z.code}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        cursor: "pointer",
                        background: isSelected ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
                      }}
                      onClick={() => setSelectedZone(isSelected ? null : z.code)}
                    >
                      <td style={{ ...tdStyle, fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</td>
                      <td style={{ ...tdStyle, color: "var(--mut)" }}>{z.name || "\u2014"}</td>
                      <td style={tdStyle}><span style={badgeStyle}>{z.sector}</span></td>
                      <td style={tdStyle}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `color-mix(in srgb, ${STATUS_COLORS[z.status] || "var(--faint)"} 12%, transparent)`, color: STATUS_COLORS[z.status] || "var(--faint)", fontWeight: 600 }}>{STATUS_LABELS[z.status] || z.status}</span></td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        {prodCount > 0 ? <span style={{ color: "var(--accent)" }}>{prodCount}</span> : <span style={{ color: "var(--faint)" }}>0</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        {zMembretes.length > 0 ? <span style={{ color: "var(--accent)" }}>{zMembretes.length}</span> : <span style={{ color: "var(--faint)" }}>0</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        {qStats.enCola > 0 ? <span style={{ color: "var(--s-idle)" }}>{qStats.enCola}</span> : <span style={{ color: "var(--faint)" }}>0</span>}
                      </td>
                      <td style={tdStyle}>
                        {qStats.armadores.size > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {Array.from(qStats.armadores.values()).map((name, i) => (
                              <span key={i} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "color-mix(in srgb, var(--s-active) 12%, transparent)", color: "var(--s-active)", fontWeight: 600 }}>{name}</span>
                            ))}
                          </div>
                        ) : <span style={{ color: "var(--faint)", fontSize: 12 }}>{"\u2014"}</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); startEdit(z); }}
                            style={{ ...actionBtn, color: "var(--accent)" }}
                            title="Editar zona"
                          >&#9998;</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingZone(z); }}
                            style={{ ...actionBtn, color: "var(--s-inc)" }}
                            title="Eliminar zona"
                          >&#10005;</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>No se encontraron zonas con los filtros seleccionados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {detailZone && (
          <>
            <div
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 899 }}
              onClick={() => setSelectedZone(null)}
            />
            <div style={slideOverStyle}>
              <ZoneDetail zone={detailZone} membretes={detailMembretes} onClose={() => setSelectedZone(null)} />
            </div>
          </>
        )}
      </div>

      {editingZone && (
        <div style={overlayStyle} onClick={cancelEdit}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Editar Zona {editingZone.code.replace(/^.*_/, "")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Sector</label>
                <select value={editForm.sector} onChange={(e) => setEditForm({ ...editForm, sector: e.target.value })} style={selectStyle}>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Prioridad</label>
                <select value={editForm.prioridad} onChange={(e) => setEditForm({ ...editForm, prioridad: e.target.value as ZonePriority })} style={selectStyle}>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={cancelEdit} style={btnCancel}>Cancelar</button>
              <button onClick={handleSaveEdit} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
            </div>
          </div>
        </div>
      )}

      {deletingZone && (
        <div style={overlayStyle} onClick={() => setDeletingZone(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "var(--s-inc)" }}>Eliminar Zona</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--mut)" }}>
              Se eliminara permanentemente la zona <strong>{deletingZone.code.replace(/^.*_/, "")}</strong> y todos sus datos asociados. Esta accion no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setDeletingZone(null)} style={btnCancel}>Cancelar</button>
              <button onClick={handleDeleteZone} disabled={saving} style={{ ...btnPrimary, background: "var(--s-inc)", opacity: saving ? 0.6 : 1 }}>{saving ? "Eliminando..." : "Eliminar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneDetail({ zone, membretes, onClose }: { zone: Zone; membretes: Membrete[]; onClose: () => void }) {
  const products = zone.products || [];
  const totalCant = products.reduce((sum, p) => sum + p.cantidad, 0);

  const ordered = [...membretes].sort((a, b) => {
    const rank = (m: Membrete) => (!m.armadorId && m.status === "pending" ? 0 : m.status === "active" ? 1 : 2);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  let colaIdx = 0;

  return (
    <>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{zone.code.replace(/^.*_/, "")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: `color-mix(in srgb, ${STATUS_COLORS[zone.status] || "var(--faint)"} 12%, transparent)`, color: STATUS_COLORS[zone.status] || "var(--faint)", fontWeight: 600 }}>
              {STATUS_LABELS[zone.status] || zone.status}
            </span>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>{products.length} productos &middot; {membretes.length} membretes</span>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--faint)", padding: 4, lineHeight: 1 }} title="Cerrar panel">&#10005;</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 20 }}>
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

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>
          Membretes asignados ({membretes.length})
        </div>
        {membretes.length > 0 ? (
          <div style={{ background: "var(--bg)", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["#Cola", "Codigo", "Ruta", "Pallet", "Familia", "Camion", "Unids.", "Armador", "Origen", "Estado"].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Unids." ? "right" : "left", fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((mem) => {
                  const esColaPendiente = !mem.armadorId && mem.status === "pending";
                  const numCola = esColaPendiente ? ++colaIdx : null;
                  const origen = mem.claimedAt ? "Tomado por el armador" : mem.armadorId ? "Asignado por supervisor" : "En cola (sin tomar)";
                  return (
                    <tr key={mem.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "var(--mono)", fontWeight: 600, color: numCola ? "var(--s-idle)" : "var(--faint)" }}>{numCola ? `#${numCola}` : "\u2014"}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "var(--mono)", fontWeight: 500 }}>{mem.code}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "var(--mono)" }}>{mem.ruta || "\u2014"}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "var(--mono)" }}>{mem.pallet || "\u2014"}</td>
                      <td style={{ padding: "8px 12px" }}>{mem.familia || "\u2014"}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "var(--mono)" }}>{mem.camion || "\u2014"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{mem.totalUnits}</td>
                      <td style={{ padding: "8px 12px" }}>{mem.armadorName || <span style={{ color: "var(--faint)" }}>{"\u2014"}</span>}</td>
                      <td style={{ padding: "8px 12px", fontSize: 11, color: mem.claimedAt ? "var(--s-active)" : mem.armadorId ? "var(--accent)" : "var(--faint)" }}>{origen}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: `color-mix(in srgb, ${mem.status === "completed" ? "var(--s-done)" : mem.status === "active" ? "var(--s-active)" : "var(--s-idle)"} 12%, transparent)` }}>
                          {mem.status === "completed" ? "Hecho" : mem.status === "active" ? "Activo" : "Pendiente"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 12, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--line)", marginBottom: 20 }}>
            Esta zona no tiene membretes asignados. Vaya a &quot;Membretes&quot; para crear o asignar.
          </div>
        )}

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
    </>
  );
}
