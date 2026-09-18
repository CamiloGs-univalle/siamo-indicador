/**
 * @file components/admin/mod-mapa.tsx
 * @description Modulo de mapa en tiempo real — FUENTE DE VERDAD: Membretes.
 *
 * Modelo A → M → Z:
 * - Zone = espacio fisico (code, sector, position, products)
 * - Membrete = orden de picking (ruta, pallet, armador, status)
 * - El mapa muestra el estado REAL derivado de los membretes asignados a cada zona.
 *
 * Layout: mapa a la izquierda, lista de zonas a la derecha.
 * Permite mover zonas en modo edicion. NO edita datos de pedido
 * (pallet, ruta, familia, etc.) — esos viven en el Membrete.
 */

"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Kpi } from "@/components/ui/kpi";
import { I } from "@/components/icons";
import { MapFloor } from "@/components/maps/map-floor";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeMembretes, updateZone, adminPauseZone, adminFinishZone } from "@/lib/firestore";
import { mapZoneToWarehousePosition } from "@/lib/warehouse-layout";
import type { Pos, Zone, Armador, Membrete, ZonePriority } from "@/types";
import { ZONE_PRIORITY_LABEL, ZONE_PRIORITY_COLOR } from "@/lib/zone-priority";
import { ModZonaMonitor } from "@/components/admin/mod-zona-monitor";

export function ModMapa() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [sectorFilter, setSectorFilter] = useState<"all" | "A" | "B">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [armadorFilter, setArmadorFilter] = useState<string>("all");
  const [productSearch, setProductSearch] = useState("");
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "monitor">("map");

  // Edit form — solo sector y prioridad (pertenecen a la Zona)
  const [editSector, setEditSector] = useState<"A" | "B">("A");
  const [editPrioridad, setEditPrioridad] = useState<ZonePriority>("media");
  const [saving, setSaving] = useState(false);
  const [zoneAction, setZoneAction] = useState<"pause" | "finish" | null>(null);

  // ─── Suscripciones en tiempo real ──────────────────────────────────────
  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    setLoading(true);
    let loaded = 0;
    const check = () => { if (loaded >= 3) setLoading(false); };

    const unsubZones = subscribeZones(user.companyId, (z) => {
      setZones(z);
      setPositions((prev) => {
        const pos: Record<string, Pos> = {};
        let sA = 0, sB = 0;
        z.forEach((zone) => {
          if (zone.position && (zone.position.x !== 0 || zone.position.y !== 0)) {
            pos[zone.code] = zone.position;
          } else if (prev[zone.code]) {
            pos[zone.code] = prev[zone.code];
          } else {
            const idx = zone.sector === "A" ? sA : sB;
            const mapped = mapZoneToWarehousePosition(zone.sector, idx);
            pos[zone.code] = { x: mapped.x, y: mapped.y };
            if (zone.sector === "A") sA++; else sB++;
          }
        });
        return pos;
      });
      setSel((prev) => prev ?? (z.length > 0 ? z[0].code : null));
      loaded++; check();
    });

    const unsubArmadores = subscribeArmadores(user.companyId, (a) => {
      setArmadores(a);
      loaded++; check();
    });

    const unsubMembretes = subscribeMembretes(user.companyId, (m) => {
      setMembretes(m);
      loaded++; check();
    });

    return () => { unsubZones(); unsubArmadores(); unsubMembretes(); };
  }, [user?.companyId]);

  // ─── Mapa de membretes por zona ────────────────────────────────────────
  // Para cada zona, encuentra sus membretes asignados
  const membretesByZone = useMemo(() => {
    const m: Record<string, Membrete[]> = {};
    membretes.forEach((mem) => {
      if (mem.zonaId) {
        if (!m[mem.zonaId]) m[mem.zonaId] = [];
        m[mem.zonaId].push(mem);
      }
    });
    return m;
  }, [membretes]);

  // ─── Helpers derivados de Membretes ────────────────────────────────────
  /** Estado REAL de una zona, derivado de sus membretes */
  function displayStatus(zone: Zone): Zone["status"] {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    if (zoneMembretes.length === 0) return "idle";

    // Si algun membrete esta activo → la zona esta activa
    if (zoneMembretes.some((m) => m.status === "active")) return "active";
    // Si todos estan completados → completada
    if (zoneMembretes.every((m) => m.status === "completed")) return "done";
    // Si algun esta cancelado con incidente
    if (zoneMembretes.some((m) => m.status === "cancelled")) return "incident";
    // Si hay al menos uno asignado (pending con armador) → asignada
    if (zoneMembretes.some((m) => m.armadorId)) return "assigned";
    // Pendientes sin asignar
    return "idle";
  }

  /** Armador asignado a la zona (del membrete) */
  function getArmadorForZone(zone: Zone): Armador | null {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    const assigned = zoneMembretes.find((m) => m.armadorId);
    if (!assigned?.armadorId) return null;
    return armadores.find((a) => a.id === assigned.armadorId) || null;
  }

  /** Pallet/Ruta del membrete (no de la zona) */
  function getPedidoForZone(zone: Zone): { pallet?: string; ruta?: string; familia?: string; camion?: string; fechaEntrega?: string } {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    const active = zoneMembretes.find((m) => m.status === "active" || m.status === "pending");
    if (!active) return {};
    return {
      pallet: active.pallet,
      ruta: active.ruta,
      familia: active.familia,
      camion: active.camion,
      fechaEntrega: active.fechaEntrega,
    };
  }

  // ─── Posicion y guardado ───────────────────────────────────────────────
  async function handlePositionChange(code: string, pos: Pos) {
    setPositions((prev) => ({ ...prev, [code]: pos }));
    if (user?.companyId) {
      const zone = zones.find((z) => z.code === code);
      if (zone?.id) {
        try {
          await updateZone(zone.id, { position: pos }, { uid: user.uid, name: user.name });
        } catch (error) {
          console.error("Error saving position:", error);
        }
      }
    }
  }

  // ─── Fullscreen ────────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await fullscreenRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* noop */ }
  }

  // ─── Edit sector/prioridad ─────────────────────────────────────────────
  useEffect(() => {
    if (!sel) return;
    const zone = zones.find((z) => z.code === sel);
    if (zone) {
      setEditSector(zone.sector || "A");
      setEditPrioridad(zone.prioridad || "media");
    }
  }, [sel, zones]);

  async function handleSaveZone() {
    if (!sel || !user) return;
    const zone = zones.find((z) => z.code === sel);
    if (!zone?.id) return;
    setSaving(true);
    try {
      await updateZone(zone.id, {
        sector: editSector,
        prioridad: editPrioridad,
      }, { uid: user.uid, name: user.name });
    } catch (error) {
      console.error("Error saving zone:", error);
    } finally {
      setSaving(false);
    }
  }

  // ─── Pausar / terminar zona (admin) ────────────────────────────────────
  async function handlePauseZone() {
    if (!selectedZone?.id || !user?.companyId) return;
    setZoneAction("pause");
    try {
      const armador = getArmadorForZone(selectedZone);
      await adminPauseZone(
        { id: selectedZone.id, code: selectedZone.code },
        armador ? { id: armador.id, name: armador.name } : undefined,
        user.companyId,
        { uid: user.uid, name: user.name }
      );
    } catch (error) {
      console.error("Error pausing zone:", error);
    } finally {
      setZoneAction(null);
    }
  }

  async function handleFinishZoneAdmin() {
    if (!selectedZone?.id || !user?.companyId) return;
    if (!confirm(`Dar por terminada la zona ${selectedZone.code}?`)) return;
    setZoneAction("finish");
    try {
      const armador = getArmadorForZone(selectedZone);
      await adminFinishZone(
        { id: selectedZone.id, code: selectedZone.code },
        armador ? { id: armador.id, name: armador.name } : undefined,
        user.companyId,
        { uid: user.uid, name: user.name }
      );
    } catch (error) {
      console.error("Error finishing zone:", error);
    } finally {
      setZoneAction(null);
    }
  }

  // ─── Filtros ───────────────────────────────────────────────────────────
  const visibleZones = useMemo(() => {
    let result = zones;
    if (sectorFilter !== "all") result = result.filter((z) => z.sector === sectorFilter);
    if (priorityFilter !== "all") result = result.filter((z) => z.prioridad === priorityFilter);
    if (armadorFilter !== "all") {
      result = result.filter((z) => {
        const arm = getArmadorForZone(z);
        if (armadorFilter === "unassigned") return !arm;
        return arm?.id === armadorFilter;
      });
    }
    if (statusFilter !== "all") result = result.filter((z) => displayStatus(z) === statusFilter);
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      result = result.filter((z) =>
        z.code.toLowerCase().includes(q) ||
        z.products?.some((p) => p.codigo.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q))
      );
    }
    return result;
  }, [zones, sectorFilter, priorityFilter, armadorFilter, statusFilter, productSearch, membretesByZone, armadores]);

  // ─── KPIs ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = zones.length;
    const idle = zones.filter((z) => displayStatus(z) === "idle").length;
    const assigned = zones.filter((z) => displayStatus(z) === "assigned").length;
    const active = zones.filter((z) => displayStatus(z) === "active").length;
    const paused = zones.filter((z) => displayStatus(z) === "paused").length;
    const done = zones.filter((z) => displayStatus(z) === "done").length;
    const incident = zones.filter((z) => displayStatus(z) === "incident").length;
    const sinAsignar = zones.filter((z) => (membretesByZone[z.id || ""] || []).length === 0).length;
    return { total, idle, assigned, active, paused, done, incident, sinAsignar };
  }, [zones, membretesByZone]);

  const selectedZone = sel ? zones.find((z) => z.code === sel) || null : null;
  const selectedArmador = selectedZone ? getArmadorForZone(selectedZone) : null;
  const selectedMembretes = selectedZone ? membretesByZone[selectedZone.id || ""] || [] : [];

  // ─── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando mapa...</div>;
  }

  if (viewMode === "monitor") {
    return <ModZonaMonitor onClose={() => setViewMode("map")} />;
  }

  return (
    <div ref={fullscreenRef} style={isFullscreen ? { position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" } : undefined}>
      {/* ─── KPIs ─────────────────────────────────────────────── */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(8, 1fr)", marginBottom: 12 }}>
        <Kpi small accent="var(--accent)" lab="Total" val={stats.total} />
        <Kpi small accent="var(--s-idle)" lab="Pendientes" val={stats.idle} />
        <Kpi small accent="var(--s-assigned)" lab="Asignadas" val={stats.assigned} />
        <Kpi small accent="var(--s-active)" lab="En proceso" val={stats.active} />
        <Kpi small accent="var(--s-paused)" lab="Pausadas" val={stats.paused} />
        <Kpi small accent="var(--s-done)" lab="Completadas" val={stats.done} />
        <Kpi small accent="var(--s-inc)" lab="Incidencias" val={stats.incident} />
        <Kpi small accent="#94A3B8" lab="Sin asignar" val={stats.sinAsignar} />
      </div>

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        {/* ─── Mapa ──────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
            <div className="panel-h" style={{ flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
              <h3>Plano de zonas</h3>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginLeft: "auto" }}>
                <div className="orgselect">
                  <button className={sectorFilter === "all" ? "on" : ""} onClick={() => setSectorFilter("all")}>Todos</button>
                  <button className={sectorFilter === "A" ? "on" : ""} onClick={() => setSectorFilter("A")}>A</button>
                  <button className={sectorFilter === "B" ? "on" : ""} onClick={() => setSectorFilter("B")}>B</button>
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit", maxWidth: 130 }}>
                  <option value="all">Todos los estados</option>
                  <option value="idle">Pendiente</option>
                  <option value="assigned">Asignada</option>
                  <option value="active">En proceso</option>
                  <option value="paused">Pausada</option>
                  <option value="done">Completada</option>
                  <option value="incident">Incidencia</option>
                </select>
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit", maxWidth: 140 }}>
                  <option value="all">Todas las prioridades</option>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
                <select value={armadorFilter} onChange={(e) => setArmadorFilter(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit", maxWidth: 140 }}>
                  <option value="all">Todos los armadores</option>
                  <option value="unassigned">Sin asignar</option>
                  {armadores.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Buscar producto..." style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit", width: 130 }} />
                <span style={{ fontSize: 11, color: "var(--faint)" }}>{visibleZones.length}/{zones.length} zonas</span>
                <button className="btn sm" onClick={() => setViewMode("monitor")} title="Monitoreo"><I.chart /> Monitoreo</button>
                <button className={"btn sm" + (edit ? " primary" : "")} onClick={() => setEdit(!edit)}>{edit ? "Guardando" : "Mover"}</button>
                <button className="btn sm" onClick={toggleFullscreen} title="Pantalla completa">{isFullscreen ? <I.shrink /> : <I.expand />}</button>
              </div>
            </div>

            {/* Leyenda */}
            <div className="legend" style={{ flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
              <span><i style={{ background: "var(--s-idle)" }} /> Sin asignar</span>
              <span><i style={{ background: "var(--s-done)" }} /> Completada</span>
              <span><i style={{ background: "var(--s-active)" }} /> En proceso</span>
              <span><i style={{ background: "var(--s-paused)" }} /> Pausada</span>
              <span><i style={{ background: "var(--s-inc)" }} /> Incidencia</span>
              <span style={{ marginLeft: 8, borderLeft: "1px solid var(--line)", paddingLeft: 8 }}>Colores = armadores asignados</span>
            </div>

            {/* Mapa */}
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <MapFloor
                codes={visibleZones.map((z) => z.code)}
                positions={positions}
                setPositions={(p) => setPositions(p)}
                colorOf={(code) => {
                  const zone = zones.find((z) => z.code === code);
                  if (!zone) return "var(--s-idle)";
                  const arm = getArmadorForZone(zone);
                  if (arm?.color) return arm.color;
                  const sc: Record<string, string> = { done: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)", incident: "var(--s-inc)", idle: "var(--s-idle)", paused: "var(--s-paused)" };
                  return sc[displayStatus(zone)] || "var(--s-idle)";
                }}
                ownerOf={(code) => {
                  const zone = zones.find((z) => z.code === code);
                  if (!zone) return "Sin asignar";
                  const arm = getArmadorForZone(zone);
                  return arm?.name || "Sin asignar";
                }}
                activeOf={(code) => {
                  const zone = zones.find((z) => z.code === code);
                  return zone ? displayStatus(zone) === "active" : false;
                }}
                statusOf={(code) => { const z = zones.find((zz) => zz.code === code); return z ? displayStatus(z) : "idle"; }}
                priorityOf={(code) => zones.find((z) => z.code === code)?.prioridad}
                selected={sel || undefined}
                onSelect={(code) => setSel(code)}
                editable={edit}
                onPositionCommit={handlePositionChange}
                tooltipOf={(code) => {
                  const zone = zones.find((z) => z.code === code);
                  if (!zone) return null;
                  const pedido = getPedidoForZone(zone);
                  const arm = getArmadorForZone(zone);
                  const statusLabel: Record<string, string> = { done: "Completada", active: "En proceso", assigned: "Asignada", incident: "Incidencia", idle: "Sin asignar", paused: "Pausada" };
                  return (
                    <>
                      <div className="zone-tooltip-row"><span className="k">Encargado</span><span className="v">{arm?.name || "Sin asignar"}</span></div>
                      <div className="zone-tooltip-row"><span className="k">Estado</span><span className="v">{statusLabel[displayStatus(zone)] || zone.status}</span></div>
                      {pedido.pallet && <div className="zone-tooltip-row"><span className="k">Pallet</span><span className="v mono">{pedido.pallet}</span></div>}
                      {pedido.ruta && <div className="zone-tooltip-row"><span className="k">Ruta</span><span className="v mono">{pedido.ruta}</span></div>}
                      <div className="zone-tooltip-row"><span className="k">Productos</span><span className="v">{zone.totalProducts || zone.products?.length || 0}</span></div>
                    </>
                  );
                }}
              />
            </div>
          </div>
        </div>

        {/* ─── Sidebar derecha: Lista de zonas ─────────────── */}
        <div className="zone-sidebar">
          <div className="panel-h" style={{ flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
            <h3>Zonas ({visibleZones.length})</h3>
          </div>
          {visibleZones.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: "var(--faint)" }}>No hay zonas en este sector.</div>
          )}
          {visibleZones.map((z) => {
            const isSelected = sel === z.code;
            const arm = getArmadorForZone(z);
            const pedido = getPedidoForZone(z);
            const status = displayStatus(z);
            const sc: Record<string, string> = { done: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)", incident: "var(--s-inc)", idle: "var(--s-idle)", paused: "var(--s-paused)" };
            const zoneColor = arm?.color || sc[status] || "var(--s-idle)";
            return (
              <div key={z.code} className={"zone-row" + (isSelected ? " selected" : "")} onClick={() => setSel(z.code)}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: zoneColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{z.code}</div>
                  <div style={{ fontSize: 11, color: "var(--mut)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{arm?.name || "Sin asignar"}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {z.prioridad === "alta" && <div style={{ fontSize: 10, fontWeight: 700, color: ZONE_PRIORITY_COLOR.alta }}>¡ALTA!</div>}
                  {pedido.pallet && <div style={{ fontSize: 10, color: "var(--faint)" }}>P:{pedido.pallet}</div>}
                  {pedido.ruta && <div style={{ fontSize: 10, color: "var(--faint)" }}>R:{pedido.ruta}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Panel inferior: detalle de zona seleccionada ──────── */}
      {selectedZone && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h" style={{ flexWrap: "wrap" }}>
            <h3>Zona {selectedZone.code}</h3>
            <span style={{ fontSize: 12, color: "var(--faint)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {selectedZone.prioridad && (
                <span className="chip" style={{ background: "color-mix(in srgb, " + ZONE_PRIORITY_COLOR[selectedZone.prioridad] + " 16%, transparent)", color: ZONE_PRIORITY_COLOR[selectedZone.prioridad] }}>
                  Prioridad {ZONE_PRIORITY_LABEL[selectedZone.prioridad]}
                </span>
              )}
              {selectedArmador && <span className="chip" style={{ background: "color-mix(in srgb, " + (selectedArmador.color || "var(--accent)") + " 16%, transparent)", color: selectedArmador.color || "var(--accent)" }}>{selectedArmador.name}</span>}
              {selectedZone.totalProducts || selectedZone.products?.length || 0} productos
              <button className="btn ghost sm" style={{ marginLeft: 4 }} onClick={() => setSel(null)} title="Cerrar">✕</button>
            </span>
          </div>

          {/* Control admin: pausar/terminar */}
          {(displayStatus(selectedZone) === "active" || displayStatus(selectedZone) === "paused") && (
            <div className="alert warn" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="at">
                <I.alert />
                {displayStatus(selectedZone) === "active"
                  ? `${selectedArmador?.name || "Armador"} está trabajando esta zona.`
                  : `Esta zona está pausada (${selectedArmador?.name || "armador"} sigue siendo el encargado).`}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {displayStatus(selectedZone) === "active" && (
                  <button className="btn sm" onClick={handlePauseZone} disabled={zoneAction !== null}>
                    <I.pause /> {zoneAction === "pause" ? "Pausando..." : "Pausar tiempo"}
                  </button>
                )}
                <button className="btn sm" style={{ color: "var(--s-not)" }} onClick={handleFinishZoneAdmin} disabled={zoneAction !== null}>
                  <I.check /> {zoneAction === "finish" ? "Terminando..." : "Terminar tiempo"}
                </button>
              </div>
            </div>
          )}

          {/* Membretes de esta zona */}
          {selectedMembretes.length > 0 && (
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>
                Membretes ({selectedMembretes.length})
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedMembretes.map((m) => (
                  <div key={m.id} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", background: m.status === "active" ? "color-mix(in srgb, var(--s-active) 8%, transparent)" : "var(--panel2)", fontSize: 12 }}>
                    <div style={{ fontWeight: 600, fontFamily: "var(--mono)" }}>{m.code}</div>
                    {m.pallet && <div style={{ color: "var(--faint)" }}>Pallet: {m.pallet}{m.palletTotal ? `/${m.palletTotal}` : ""}</div>}
                    {m.ruta && <div style={{ color: "var(--faint)" }}>Ruta: {m.ruta}</div>}
                    {m.armadorName && <div style={{ color: "var(--accent)" }}>{m.armadorName}</div>}
                    <div style={{ fontSize: 10, color: m.status === "completed" ? "var(--s-done)" : m.status === "active" ? "var(--s-active)" : "var(--faint)" }}>
                      {m.status === "completed" ? "Hecho" : m.status === "active" ? "Activo" : "Pendiente"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Edit sector/prioridad */}
          <div style={{ padding: "16px 20px", borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
              <div>
                <label className="field-label">Sector</label>
                <select className="field-input" value={editSector} onChange={(e) => setEditSector(e.target.value as "A" | "B")}>
                  <option value="A">Sector A</option>
                  <option value="B">Sector B</option>
                </select>
              </div>
              <div>
                <label className="field-label">Prioridad</label>
                <select className="field-input" value={editPrioridad} onChange={(e) => setEditPrioridad(e.target.value as ZonePriority)}>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </div>
              <div>
                <button className="btn primary" onClick={handleSaveZone} disabled={saving} style={{ height: 36 }}>
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>

          {/* Productos de la zona (inventario) */}
          {selectedZone.products && selectedZone.products.length > 0 && (
            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>Productos ({selectedZone.products.length})</div>
              <div style={{ maxHeight: 180, overflow: "auto" }}>
                <table className="tbl">
                  <thead><tr><th>Código</th><th>Descripción</th><th style={{ textAlign: "right" }}>Cant.</th></tr></thead>
                  <tbody>
                    {selectedZone.products.map((p, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 12 }}>{p.codigo}</td>
                        <td style={{ fontSize: 12 }}>{p.descripcion}</td>
                        <td className="mono" style={{ textAlign: "right", fontSize: 12 }}>{p.cantidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
