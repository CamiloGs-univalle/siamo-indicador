/**
 * @file components/admin/mod-mapa.tsx
 * @description Módulo de mapa en tiempo real.
 * Layout: mapa a la izquierda, lista de zonas a la derecha.
 * Auto-distribuye zonas en cuadrícula si están en (0,0).
 * Permite editar detalles de zona y arrastrar en modo edición.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Kpi } from "@/components/ui/kpi";
import { I } from "@/components/icons";
import { MapFloor } from "@/components/maps/map-floor";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, updateZone, adminPauseZone, adminFinishZone } from "@/lib/firestore";
import { mapZoneToWarehousePosition, fullWarehouseLayout, positionTooltip, positionTypeColor, positionTypeLabel } from "@/lib/warehouse-layout";
import type { Pos, Zone, Armador, ZonePriority } from "@/types";
import { ZONE_PRIORITY_LABEL, ZONE_PRIORITY_COLOR } from "@/lib/zone-priority";

const TILE_W = 124;
const TILE_H = 76;
const COLS = 5;

function autoGridPosition(index: number): Pos {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return { x: 20 + col * (TILE_W + 16), y: 20 + row * (TILE_H + 16) };
}

export function ModMapa() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
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

  // Edit form
  const [editPallet, setEditPallet] = useState("");
  const [editRuta, setEditRuta] = useState("");
  const [editFamilia, setEditFamilia] = useState("");
  const [editCamion, setEditCamion] = useState("");
  const [editSector, setEditSector] = useState<"A" | "B">("A");
  const [editPrioridad, setEditPrioridad] = useState<ZonePriority>("media");
  const [editFechaEntrega, setEditFechaEntrega] = useState("");
  const [editPalletTotal, setEditPalletTotal] = useState("");
  const [saving, setSaving] = useState(false);
  const [zoneAction, setZoneAction] = useState<"pause" | "finish" | null>(null);

  // Suscripción en tiempo real: el plano refleja cambios de Firestore al
  // instante (otro admin editando, o el estado de una zona cambiando),
  // sin necesidad de recargar la página — antes era una sola lectura y
  // el rótulo "Operación en tiempo real" no era honesto.
  useEffect(() => {
    if (!user?.companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let zonesLoaded = false;
    let armadoresLoaded = false;
    const maybeStopLoading = () => {
      if (zonesLoaded && armadoresLoaded) setLoading(false);
    };

    const unsubZones = subscribeZones(user.companyId, (z) => {
      setZones(z);

      setPositions((prevPositions) => {
        const pos: Record<string, Pos> = {};
        let sectorAIndex = 0;
        let sectorBIndex = 0;
        z.forEach((zone) => {
          if (zone.position && (zone.position.x !== 0 || zone.position.y !== 0)) {
            pos[zone.code] = zone.position;
          } else if (prevPositions[zone.code]) {
            pos[zone.code] = prevPositions[zone.code];
          } else {
            // Use warehouse tunnel layout for initial positioning
            const idx = zone.sector === "A" ? sectorAIndex : sectorBIndex;
            const mapped = mapZoneToWarehousePosition(zone.sector, idx);
            pos[zone.code] = { x: mapped.x, y: mapped.y };
            if (zone.sector === "A") sectorAIndex++;
            else sectorBIndex++;
          }
        });
        return pos;
      });

      setSel((prevSel) => prevSel ?? (z.length > 0 ? z[0].code : null));
      zonesLoaded = true;
      maybeStopLoading();
    });

    const unsubArmadores = subscribeArmadores(user.companyId, (a) => {
      setArmadores(a);
      armadoresLoaded = true;
      maybeStopLoading();
    });

    return () => {
      unsubZones();
      unsubArmadores();
    };
  }, [user?.companyId]);

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

  // ─── Pantalla completa: para dejar el mapa en un televisor de la empresa ──
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await fullscreenRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Error toggling fullscreen:", error);
    }
  }

  useEffect(() => {
    if (!sel) return;
    const zone = zones.find((z) => z.code === sel);
    if (zone) {
      setEditPallet(zone.pallet || "");
      setEditRuta(zone.ruta || "");
      setEditFamilia(zone.familia || "");
      setEditCamion(zone.camion || "");
      setEditSector(zone.sector || "A");
      setEditPrioridad(zone.prioridad || "media");
      setEditFechaEntrega(zone.fechaEntrega || "");
      setEditPalletTotal(zone.palletTotal || "");
    }
  }, [sel, zones]);

  async function handleSaveZone() {
    if (!sel || !user) return;
    const zone = zones.find((z) => z.code === sel);
    if (!zone?.id) return;
    setSaving(true);
    try {
      await updateZone(zone.id, {
        pallet: editPallet || undefined,
        ruta: editRuta || undefined,
        familia: editFamilia || undefined,
        camion: editCamion || undefined,
        sector: editSector,
        prioridad: editPrioridad,
        fechaEntrega: editFechaEntrega || undefined,
        palletTotal: editPalletTotal || undefined,
      }, { uid: user.uid, name: user.name });
      // No hace falta recargar a mano: la suscripción en tiempo real ya trae el cambio.
    } catch (error) {
      console.error("Error saving zone:", error);
    } finally {
      setSaving(false);
    }
  }

  // ─── Pausar / terminar manualmente el tiempo de una zona activa ────────
  // Control del admin, sin intervención del armador: cierra la sesión de
  // escaneo real que esté abierta y deja constancia en el historial.
  async function handlePauseZone() {
    if (!selectedZone?.id || !user?.companyId) return;
    setZoneAction("pause");
    try {
      const armador = selectedZone.armadorId ? armadores.find((a) => a.id === selectedZone.armadorId) : undefined;
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
    if (!confirm(`¿Dar por terminada la zona ${selectedZone.code}? Esto cierra el tiempo del armador, igual que si él mismo la hubiera terminado.`)) return;
    setZoneAction("finish");
    try {
      const armador = selectedZone.armadorId ? armadores.find((a) => a.id === selectedZone.armadorId) : undefined;
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

  /**
   * Estado real que se muestra para una zona. Las zonas que ya se asignaron
   * ANTES de este arreglo se quedaron con status:"idle" en Firestore (el
   * código viejo solo guardaba el armadorId, nunca actualizaba el status) —
   * en vez de exigir una migración de datos, esta función lo corrige al
   * vuelo: si el status guardado no es uno de los que se manejan a propósito
   * (activa/pausada/completada/incidencia), manda el armadorId: con dueño es
   * "Asignada", sin dueño es "Sin asignar". Así el color/leyenda siempre
   * coincide con la realidad, tenga o no el dato viejo el status correcto.
   */
  const displayStatus = (zone: Zone): Zone["status"] => {
    if (zone.status === "active" || zone.status === "paused" || zone.status === "done" || zone.status === "incident") {
      return zone.status;
    }
    return zone.armadorId ? "assigned" : "idle";
  };

  const zColor = (code: string) => {
    const zone = zones.find((z) => z.code === code);
    if (!zone) return "var(--s-idle)";
    // If assigned to an armador, use THEIR color (not status color)
    if (zone.armadorId) {
      const armador = armadores.find((a) => a.id === zone.armadorId);
      if (armador?.color) return armador.color;
    }
    // Fallback to status color for unassigned zones
    const statusColors: Record<string, string> = {
      done: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)",
      incident: "var(--s-inc)", idle: "var(--s-idle)", paused: "var(--s-paused)",
    };
    return statusColors[displayStatus(zone)] || "var(--s-idle)";
  };

  const ownerOf = (code: string) => {
    const zone = zones.find((z) => z.code === code);
    if (!zone?.armadorId) return "Sin asignar";
    return armadores.find((a) => a.id === zone.armadorId)?.name || "—";
  };

  const activeOf = (code: string) => {
    const zone = zones.find((z) => z.code === code);
    return zone?.status === "active" || zone?.status === "incident";
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando mapa...</div>;
  }

  if (zones.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Sin zonas configuradas</div>
        <div style={{ fontSize: 13, color: "var(--mut)" }}>Importa datos desde SAP en el módulo de carga</div>
      </div>
    );
  }

  const selectedZone = sel ? zones.find((z) => z.code === sel) : null;

  // Multi-filter logic
  const visibleZones = zones.filter((z) => {
    if (sectorFilter !== "all" && z.sector !== sectorFilter) return false;
    if (statusFilter !== "all" && displayStatus(z) !== statusFilter) return false;
    if (priorityFilter !== "all" && (z.prioridad || "media") !== priorityFilter) return false;
    if (armadorFilter !== "all") {
      if (armadorFilter === "unassigned") {
        if (z.armadorId) return false;
      } else {
        if (z.armadorId !== armadorFilter) return false;
      }
    }
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      const hasProduct = z.products?.some(
        (p) => p.codigo.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q)
      );
      if (!hasProduct) return false;
    }
    return true;
  });

  return (
    <div ref={fullscreenRef} className={"mapa-fullscreen-root" + (isFullscreen ? " is-fullscreen" : "")}>
      {/* ─── KPIs compactos ──────────────────────────────────── */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 16 }}>
        <Kpi small accent="var(--accent)" lab="Total" val={zones.length} />
        <Kpi small accent="var(--s-done)" lab="Completadas" val={zones.filter((z) => displayStatus(z) === "done").length} />
        <Kpi small accent="var(--s-active)" lab="En proceso" val={zones.filter((z) => displayStatus(z) === "active").length} />
        <Kpi small accent="var(--s-paused)" lab="Pausadas" val={zones.filter((z) => displayStatus(z) === "paused").length} />
        <Kpi small accent="var(--s-assigned)" lab="Pendientes" val={zones.filter((z) => { const s = displayStatus(z); return s === "idle" || s === "assigned"; }).length} />
        <Kpi small accent="var(--s-inc)" lab="Incidencias" val={zones.filter((z) => displayStatus(z) === "incident").length} />
        <Kpi small accent="var(--s-idle)" lab="Sin asignar" val={zones.filter((z) => !z.armadorId).length} />
      </div>

      {/* ─── Layout principal: Mapa + Sidebar ───────────────── */}
      <div className="map-layout">
        {/* Mapa — flex column fills height */}
        <div className="panel" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Toolbar */}
          <div className="panel-h" style={{ flexShrink: 0 }}>
            <h3>Plano de zonas</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div className="orgselect">
                <button className={sectorFilter === "all" ? "on" : ""} onClick={() => setSectorFilter("all")}>Todos</button>
                <button className={sectorFilter === "A" ? "on" : ""} onClick={() => setSectorFilter("A")}>A</button>
                <button className={sectorFilter === "B" ? "on" : ""} onClick={() => setSectorFilter("B")}>B</button>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit" }}
              >
                <option value="all">Todos los estados</option>
                <option value="idle">Pendiente</option>
                <option value="assigned">Asignada</option>
                <option value="active">En proceso</option>
                <option value="paused">Pausada</option>
                <option value="done">Completada</option>
                <option value="incident">Incidencia</option>
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit" }}
              >
                <option value="all">Todas las prioridades</option>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
              <select
                value={armadorFilter}
                onChange={(e) => setArmadorFilter(e.target.value)}
                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit", maxWidth: 140 }}
              >
                <option value="all">Todos los armadores</option>
                <option value="unassigned">Sin asignar</option>
                {armadores.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Buscar producto..."
                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--tx)", fontSize: 11, fontFamily: "inherit", width: 130 }}
              />
              <span style={{ fontSize: 11, color: "var(--faint)" }}>
                {visibleZones.length}/{zones.length} zonas · {edit ? "Edición" : "Lectura"}
              </span>
              <button className={"btn sm" + (edit ? " primary" : "")} onClick={() => setEdit(!edit)}>
                {edit ? "✓ Guardando" : "✎ Mover"}
              </button>
              <button className="btn sm" onClick={toggleFullscreen} title="Pantalla completa">
                {isFullscreen ? <I.shrink /> : <I.expand />}
              </button>
            </div>
          </div>

          {/* Leyenda de colores */}
          <div className="legend" style={{ flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
            <span><i style={{ background: "var(--s-idle)" }} /> Sin asignar</span>
            <span><i style={{ background: "var(--s-done)" }} /> ✓ Completada</span>
            <span><i style={{ background: "var(--s-active)" }} /> ● En proceso</span>
            <span><i style={{ background: "var(--s-paused)" }} /> ⏸ Pausada</span>
            <span><i style={{ background: "var(--s-inc)" }} /> ✕ Incidencia</span>
            <span style={{ marginLeft: 8, borderLeft: "1px solid var(--line)", paddingLeft: 8 }}>Colores = armadores asignados</span>
          </div>

          {/* Floor — fills remaining space */}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <MapFloor
              codes={visibleZones.map((z) => z.code)}
              positions={positions}
              setPositions={(p) => setPositions(p)}
              colorOf={zColor}
              ownerOf={ownerOf}
              activeOf={activeOf}
              statusOf={(code) => { const z = zones.find((zz) => zz.code === code); return z ? displayStatus(z) : "idle"; }}
              priorityOf={(code) => zones.find((z) => z.code === code)?.prioridad}
              selected={sel || undefined}
              onSelect={(code) => setSel(code)}
              editable={edit}
              onPositionCommit={handlePositionChange}
              tooltipOf={(code) => {
                const zone = zones.find((z) => z.code === code);
                if (!zone) return null;
                const statusLabel: Record<string, string> = {
                  done: "Completada", active: "En proceso", assigned: "Asignada",
                  incident: "Incidencia", idle: "Sin asignar", paused: "Pausada",
                };
                return (
                  <>
                    <div className="zone-tooltip-row">
                      <span className="k">Encargado</span>
                      <span className="v">{ownerOf(code)}</span>
                    </div>
                    <div className="zone-tooltip-row">
                      <span className="k">Estado</span>
                      <span className="v">{statusLabel[displayStatus(zone)] || zone.status}</span>
                    </div>
                    {(zone.pallet || zone.palletTotal) && (
                      <div className="zone-tooltip-row">
                        <span className="k">Pallet</span>
                        <span className="v mono">{zone.pallet}{zone.palletTotal ? ` de ${zone.palletTotal}` : ""}</span>
                      </div>
                    )}
                    {zone.ruta && (
                      <div className="zone-tooltip-row">
                        <span className="k">Ruta</span>
                        <span className="v mono">{zone.ruta}</span>
                      </div>
                    )}
                    {zone.fechaEntrega && (
                      <div className="zone-tooltip-row">
                        <span className="k">Entrega</span>
                        <span className="v">{zone.fechaEntrega}</span>
                      </div>
                    )}
                    <div className="zone-tooltip-row">
                      <span className="k">Productos</span>
                      <span className="v">{zone.totalProducts || zone.products?.length || 0} · {zone.avgMinutes || 0} min prom.</span>
                    </div>
                  </>
                );
              }}
            />
          </div>
        </div>

        {/* ─── Sidebar derecha: Lista de zonas ─────────────── */}
        <div className="zone-sidebar">
          <div className="panel-h" style={{ flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
            <h3>Zonas ({visibleZones.length})</h3>
          </div>
          {visibleZones.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: "var(--faint)" }}>
              No hay zonas en este sector.
            </div>
          )}
          {visibleZones.map((z) => {
            const isSelected = sel === z.code;
            const zoneColor = zColor(z.code);
            const owner = ownerOf(z.code);
            return (
              <div
                key={z.code}
                className={"zone-row" + (isSelected ? " selected" : "")}
                onClick={() => setSel(z.code)}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: zoneColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{z.code}</div>
                  <div style={{ fontSize: 11, color: "var(--mut)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{owner}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {z.prioridad === "alta" && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: ZONE_PRIORITY_COLOR.alta }}>¡ALTA!</div>
                  )}
                  {z.pallet && <div style={{ fontSize: 10, color: "var(--faint)" }}>P:{z.pallet}</div>}
                  {z.ruta && <div style={{ fontSize: 10, color: "var(--faint)" }}>R:{z.ruta}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Edición de zona (debajo del mapa) ──────────── */}
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
              {selectedZone.totalProducts || selectedZone.products?.length || 0} productos · {selectedZone.avgMinutes || 0} min promedio
              <button
                className="btn ghost sm"
                style={{ marginLeft: 4 }}
                onClick={() => setSel(null)}
                title="Cerrar"
              >
                ✕
              </button>
            </span>
          </div>
          {/* ─── Control manual del admin: pausar o terminar el tiempo de un armador ─── */}
          {(selectedZone.status === "active" || selectedZone.status === "paused") && (
            <div className="alert warn" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="at">
                <I.alert />
                {selectedZone.status === "active"
                  ? `${ownerOf(selectedZone.code)} está trabajando esta zona ahora mismo.`
                  : `Esta zona está pausada (${ownerOf(selectedZone.code)} sigue siendo el encargado).`}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedZone.status === "active" && (
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
          {/* ─── Marbete real: igual a la información del ticket físico de SAP ─── */}
          {(selectedZone.pallet || selectedZone.ruta || selectedZone.fechaEntrega || selectedZone.familia || selectedZone.camion) && (
            <div className="marbete-strip">
              {selectedZone.ruta && <span><b>Ruta/Trans:</b> <span className="mono">{selectedZone.ruta}</span></span>}
              {selectedZone.pallet && (
                <span>
                  <b>Pallet:</b> <span className="mono">{selectedZone.pallet}{selectedZone.palletTotal ? ` de ${selectedZone.palletTotal}` : ""}</span>
                </span>
              )}
              {selectedZone.fechaEntrega && <span><b>Fecha de Entrega:</b> {selectedZone.fechaEntrega}</span>}
              {selectedZone.familia && <span><b>Familia:</b> {selectedZone.familia}</span>}
              {selectedZone.camion && <span><b>Camión:</b> <span className="mono">{selectedZone.camion}</span></span>}
            </div>
          )}
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, alignItems: "end", marginBottom: 12 }}>
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
                <label className="field-label">Pallet / Marbete</label>
                <input className="field-input" value={editPallet} onChange={(e) => setEditPallet(e.target.value)} placeholder="Ej. 003" />
              </div>
              <div>
                <label className="field-label">Total pallets del pedido</label>
                <input className="field-input" value={editPalletTotal} onChange={(e) => setEditPalletTotal(e.target.value)} placeholder="Ej. 004" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
              <div>
                <label className="field-label">Ruta / Trans</label>
                <input className="field-input" value={editRuta} onChange={(e) => setEditRuta(e.target.value)} placeholder="Ej. KA2P33/402507384" />
              </div>
              <div>
                <label className="field-label">Familia</label>
                <input className="field-input" value={editFamilia} onChange={(e) => setEditFamilia(e.target.value)} placeholder="Ej. TBCOL07" />
              </div>
              <div>
                <label className="field-label">Camión</label>
                <input className="field-input" value={editCamion} onChange={(e) => setEditCamion(e.target.value)} placeholder="Ej. 22144" />
              </div>
              <div>
                <label className="field-label">Fecha de entrega</label>
                <input className="field-input" value={editFechaEntrega} onChange={(e) => setEditFechaEntrega(e.target.value)} placeholder="Ej. 09.09.2026" />
              </div>
              <div>
                <button className="btn primary" onClick={handleSaveZone} disabled={saving} style={{ height: 36 }}>
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>

            {/* Products */}
            {selectedZone.products && selectedZone.products.length > 0 && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>Productos</div>
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
        </div>
      )}
    </div>
  );
}
