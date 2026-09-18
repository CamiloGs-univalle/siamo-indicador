/**
 * @file components/admin/mod-membretes.tsx
 * @description Modulo de Membretes: ORDENES DE PICKING (listas de recorrido).
 * Cada membrete es un "papelito" fisico con ruta, pallet, productos, etc.
 * Un membrete esta ASIGNADO a una ZONA (espacio fisico).
 *
 * Flujo:
 *   SAP crea membretes → Admin asigna a zona → Admin asigna a armador → Armador recoge
 */

"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import { Kpi } from "@/components/ui/kpi";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeMembretes,
  subscribeZones,
  subscribeArmadores,
  createMembrete,
  updateMembrete,
  deleteMembrete,
  assignMembreteToArmador,
  unassignMembreteFromArmador,
} from "@/lib/firestore";
import type { Membrete, MembreteStatus, Zone, Armador } from "@/types";

type SortKey = "code" | "zona" | "armador" | "status" | "pallet" | "ruta" | "totalUnits";

const STATUS_LABELS: Record<MembreteStatus, string> = {
  pending: "Pendiente",
  active: "En proceso",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<MembreteStatus, string> = {
  pending: "var(--s-idle)",
  active: "var(--s-active)",
  completed: "var(--s-done)",
  cancelled: "var(--s-inc)",
};

export function ModMembretes() {
  const { user } = useAuth();
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MembreteStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedMembrete, setExpandedMembrete] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    code: "",
    zonaCode: "",
    ruta: "",
    pallet: "",
    palletTotal: "",
    fechaEntrega: "",
    familia: "",
    camion: "",
  });

  // Assign to armador
  const [assigningMembrete, setAssigningMembrete] = useState<Membrete | null>(null);
  const [selectedArmadorId, setSelectedArmadorId] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubM = subscribeMembretes(user.companyId, (m) => { setMembretes(m); setLoading(false); });
    const unsubZ = subscribeZones(user.companyId, setZones);
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    return () => { unsubM(); unsubZ(); unsubA(); };
  }, [user?.companyId]);

  const zoneMap = useMemo(() => {
    const m: Record<string, Zone> = {};
    zones.forEach((z) => { if (z.id) m[z.id] = z; });
    return m;
  }, [zones]);

  const armadorMap = useMemo(() => {
    const m: Record<string, Armador> = {};
    armadores.forEach((a) => { if (a.id) m[a.id] = a; });
    return m;
  }, [armadores]);

  const filtered = useMemo(() => {
    let result = membretes;
    if (statusFilter !== "all") result = result.filter((m) => m.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((m) => {
        if (m.code.toLowerCase().includes(q)) return true;
        if (m.ruta?.toLowerCase().includes(q)) return true;
        if (m.pallet?.toLowerCase().includes(q)) return true;
        if (m.familia?.toLowerCase().includes(q)) return true;
        if (m.zonaCode?.toLowerCase().includes(q)) return true;
        if (m.armadorName?.toLowerCase().includes(q)) return true;
        if (m.products?.some((p) => p.codigo.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "code": cmp = a.code.localeCompare(b.code); break;
        case "zona": cmp = (a.zonaCode || "").localeCompare(b.zonaCode || ""); break;
        case "armador": cmp = (a.armadorName || "").localeCompare(b.armadorName || ""); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "pallet": cmp = (a.pallet || "").localeCompare(b.pallet || ""); break;
        case "ruta": cmp = (a.ruta || "").localeCompare(b.ruta || ""); break;
        case "totalUnits": cmp = (a.totalUnits || 0) - (b.totalUnits || 0); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [membretes, statusFilter, search, sortKey, sortAsc]);

  const stats = useMemo(() => {
    const total = membretes.length;
    const pending = membretes.filter((m) => m.status === "pending").length;
    const active = membretes.filter((m) => m.status === "active").length;
    const completed = membretes.filter((m) => m.status === "completed").length;
    const cancelled = membretes.filter((m) => m.status === "cancelled").length;
    return { total, pending, active, completed, cancelled };
  }, [membretes]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return null;
    return sortAsc ? " \u25B2" : " \u25BC";
  }

  // ── Create Membrete ────────────────────────────────────────────────────
  async function handleCreate() {
    if (!user?.companyId || !createForm.code.trim()) return;
    setSaving(true);
    try {
      const zona = zones.find((z) => z.code === createForm.zonaCode);
      await createMembrete({
        companyId: user.companyId,
        code: createForm.code.trim(),
        ruta: createForm.ruta || undefined,
        pallet: createForm.pallet || undefined,
        palletTotal: createForm.palletTotal || undefined,
        fechaEntrega: createForm.fechaEntrega || undefined,
        familia: createForm.familia || undefined,
        camion: createForm.camion || undefined,
        zonaId: zona?.id || "",
        zonaCode: createForm.zonaCode,
        armadorId: null,
        armadorName: undefined,
        status: "pending",
        products: [],
        totalProducts: 0,
        totalUnits: 0,
        createdAt: Date.now(),
        lastEditedBy: user.uid,
        lastEditedByName: user.name,
        lastEditedAt: Date.now(),
      });
      setShowCreate(false);
      setCreateForm({ code: "", zonaCode: "", ruta: "", pallet: "", palletTotal: "", fechaEntrega: "", familia: "", camion: "" });
    } catch (e) {
      console.error("Error creating membrete:", e);
    } finally {
      setSaving(false);
    }
  }

  // ── Assign to Armador ──────────────────────────────────────────────────
  async function handleAssign() {
    if (!assigningMembrete?.id || !selectedArmadorId || !user?.companyId) return;
    setSaving(true);
    try {
      const armador = armadores.find((a) => a.id === selectedArmadorId);
      await assignMembreteToArmador(assigningMembrete.id, { id: selectedArmadorId, name: armador?.name || "" }, user.companyId, { uid: user.uid, name: user.name });
      setAssigningMembrete(null);
      setSelectedArmadorId("");
    } catch (e) {
      console.error("Error assigning membrete:", e);
    } finally {
      setSaving(false);
    }
  }

  // ── Unassign from Armador ──────────────────────────────────────────────
  async function handleUnassign(membreteId: string, armadorId: string) {
    if (!user?.companyId) return;
    setSaving(true);
    try {
      await unassignMembreteFromArmador(membreteId, armadorId, user.companyId, { uid: user.uid, name: user.name });
    } catch (e) {
      console.error("Error unassigning membrete:", e);
    } finally {
      setSaving(false);
    }
  }

  // ── Delete Membrete ────────────────────────────────────────────────────
  async function handleDelete(membreteId: string) {
    if (!confirm("Eliminar este membrete permanentemente?")) return;
    setSaving(true);
    try {
      await deleteMembrete(membreteId);
    } catch (e) {
      console.error("Error deleting membrete:", e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando membretes...</div>;
  }

  return (
    <div>
      {/* KPIs */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 16 }}>
        <Kpi small accent="var(--accent)" lab="Total" val={stats.total} />
        <Kpi small accent="var(--s-idle)" lab="Pendientes" val={stats.pending} />
        <Kpi small accent="var(--s-active)" lab="En proceso" val={stats.active} />
        <Kpi small accent="var(--s-done)" lab="Completados" val={stats.completed} />
        <Kpi small accent="var(--s-inc)" lab="Cancelados" val={stats.cancelled} />
      </div>

      {/* Toolbar */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
          <div className="orgselect">
            {(["all", "pending", "active", "completed", "cancelled"] as const).map((s) => (
              <button key={s} className={statusFilter === s ? "on" : ""} onClick={() => setStatusFilter(s)}>
                {s === "all" ? "Todos" : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar membrete, ruta, pallet, armador..."
            className="field-input"
            style={{ flex: 1, minWidth: 180 }}
          />
          <span style={{ fontSize: 11, color: "var(--faint)" }}>{filtered.length} membretes</span>
          <button
            onClick={() => setShowCreate(true)}
            style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            + Nuevo Membrete
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("code")}>Codigo{sortIcon("code")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("zona")}>Zona{sortIcon("zona")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("armador")}>Armador{sortIcon("armador")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("status")}>Estado{sortIcon("status")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("pallet")}>Pallet{sortIcon("pallet")}</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("ruta")}>Ruta{sortIcon("ruta")}</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em", cursor: "pointer" }} onClick={() => handleSort("totalUnits")}>Unids.{sortIcon("totalUnits")}</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const arm = m.armadorId ? armadorMap[m.armadorId] : null;
                const zona = m.zonaId ? zoneMap[m.zonaId] : null;
                const isExpanded = expandedMembrete === m.id;
                return (
                  <Fragment key={m.id}>
                    <tr
                      style={{
                        borderBottom: "1px solid var(--line)",
                        cursor: "pointer",
                        background: isExpanded ? "color-mix(in srgb, var(--accent) 4%, transparent)" : undefined,
                      }}
                      onClick={() => setExpandedMembrete(isExpanded ? null : m.id || null)}
                    >
                      <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "var(--mono)" }}>{m.code}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--mono)", fontSize: 12 }}>{m.zonaCode || "\u2014"}</td>
                      <td style={{ padding: "10px 14px" }}>
                        {arm ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 20, height: 20, borderRadius: 5, background: arm.color || "var(--accent)", display: "inline-grid", placeItems: "center", color: "#fff", fontSize: 9, fontWeight: 700 }}>{arm.name[0]}</span>
                            <span style={{ fontSize: 12 }}>{arm.name}</span>
                          </span>
                        ) : <span style={{ fontSize: 12, color: "var(--faint)" }}>&mdash;</span>}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `color-mix(in srgb, ${STATUS_COLORS[m.status]} 12%, transparent)`, color: STATUS_COLORS[m.status], fontWeight: 600 }}>
                          {STATUS_LABELS[m.status]}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--mono)", fontSize: 12 }}>
                        {m.pallet ? `${m.pallet}${m.palletTotal ? `/${m.palletTotal}` : ""}` : "\u2014"}
                      </td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--mono)", fontSize: 12 }}>{m.ruta || "\u2014"}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        {m.totalUnits > 0 ? <span style={{ color: "var(--accent)" }}>{m.totalUnits}</span> : <span style={{ color: "var(--faint)" }}>0</span>}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          {m.status === "pending" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setAssigningMembrete(m); }}
                              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", color: "var(--accent)" }}
                              title="Asignar a armador"
                            >Asignar</button>
                          )}
                          {m.armadorId && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleUnassign(m.id!, m.armadorId!); }}
                              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", color: "var(--s-inc)" }}
                              title="Desasignar"
                            >Quitar</button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(m.id!); }}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", color: "var(--s-inc)" }}
                            title="Eliminar"
                          >&#10005;</button>
                          <span
                            style={{ fontSize: 14, color: isExpanded ? "var(--accent)" : "var(--faint)", cursor: "pointer", padding: "3px 4px" }}
                            onClick={() => setExpandedMembrete(isExpanded ? null : m.id || null)}
                          >{isExpanded ? "\u25BC" : "\u25B6"}</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <MembreteDetail membrete={m} zona={zona || undefined} armador={arm} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>No se encontraron membretes</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowCreate(false)}>
          <div style={{ background: "var(--panel)", borderRadius: 12, padding: 24, width: 500, maxWidth: "90vw", border: "1px solid var(--line)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Nuevo Membrete</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Codigo *</label>
                <input type="text" value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} placeholder="M-Z07-001" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Zona (espacio fisico)</label>
                <select value={createForm.zonaCode} onChange={(e) => setCreateForm({ ...createForm, zonaCode: e.target.value })} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }}>
                  <option value="">Sin zona</option>
                  {zones.map((z) => <option key={z.id} value={z.code}>{z.code} — {z.sector}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Ruta</label>
                <input type="text" value={createForm.ruta} onChange={(e) => setCreateForm({ ...createForm, ruta: e.target.value })} placeholder="KA2P33" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Pallet</label>
                <input type="text" value={createForm.pallet} onChange={(e) => setCreateForm({ ...createForm, pallet: e.target.value })} placeholder="003" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Total Pallets</label>
                <input type="text" value={createForm.palletTotal} onChange={(e) => setCreateForm({ ...createForm, palletTotal: e.target.value })} placeholder="004" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Familia</label>
                <input type="text" value={createForm.familia} onChange={(e) => setCreateForm({ ...createForm, familia: e.target.value })} placeholder="TBCOL07" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Camion</label>
                <input type="text" value={createForm.camion} onChange={(e) => setCreateForm({ ...createForm, camion: e.target.value })} placeholder="22144" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Fecha Entrega</label>
                <input type="text" value={createForm.fechaEntrega} onChange={(e) => setCreateForm({ ...createForm, fechaEntrega: e.target.value })} placeholder="09.09.2026" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13 }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
              <button onClick={handleCreate} disabled={saving || !createForm.code.trim()} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving || !createForm.code.trim() ? 0.6 : 1 }}>{saving ? "Creando..." : "Crear Membrete"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign to Armador Modal ──────────────────────────────────── */}
      {assigningMembrete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setAssigningMembrete(null)}>
          <div style={{ background: "var(--panel)", borderRadius: 12, padding: 24, width: 360, maxWidth: "90vw", border: "1px solid var(--line)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>Asignar Membrete</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>
              Membrete <strong>{assigningMembrete.code}</strong> (Zona {assigningMembrete.zonaCode})
            </p>
            <select
              value={selectedArmadorId}
              onChange={(e) => setSelectedArmadorId(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, marginBottom: 16 }}
            >
              <option value="">Seleccionar armador...</option>
              {armadores.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setAssigningMembrete(null)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
              <button onClick={handleAssign} disabled={saving || !selectedArmadorId} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving || !selectedArmadorId ? 0.6 : 1 }}>{saving ? "Asignando..." : "Asignar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detalle del Membrete ──────────────────────────────────────────────────
function MembreteDetail({ membrete, zona, armador }: { membrete: Membrete; zona: Zone | undefined; armador: Armador | null }) {
  const products = membrete.products || [];
  const totalCant = products.reduce((sum, p) => sum + p.cantidad, 0);

  return (
    <div style={{ padding: "16px 20px", background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Codigo", membrete.code],
          ["Zona", membrete.zonaCode || "\u2014"],
          ["Ruta", membrete.ruta || "\u2014"],
          ["Pallet", membrete.pallet ? `${membrete.pallet}${membrete.palletTotal ? ` de ${membrete.palletTotal}` : ""}` : "\u2014"],
          ["Familia", membrete.familia || "\u2014"],
          ["Camion", membrete.camion || "\u2014"],
          ["Fecha Entrega", membrete.fechaEntrega || "\u2014"],
          ["Armador", armador?.name || "Sin asignar"],
          ["Estado", STATUS_LABELS[membrete.status]],
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
          Este membrete no tiene productos. Cargue datos desde SAP o agregue manualmente.
        </div>
      )}
    </div>
  );
}
