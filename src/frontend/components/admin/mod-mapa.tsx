/**
 * @file components/admin/mod-mapa.tsx
 * @description Modulo de mapa en tiempo real — FUENTE DE VERDAD: Membretes.
 *
 * Modelo A → M → Z (cola de zona, por defecto):
 * - Zone = espacio fisico (code, sector, position, products)
 * - Membrete = orden de picking (ruta, pallet, armador, status) — vive en
 *   SU zona esperando (`zonaId`, sin `armadorId`) hasta que un armador lo
 *   toma él mismo por su cuenta al llegar ahí (`claimedAt`), o el
 *   supervisor lo asigna directo a alguien puntual (versatilidad).
 * - El mapa muestra el estado REAL derivado de los membretes de cada zona:
 *   cuántos hay en cola esperando, quién(es) la están trabajando ahora, y
 *   permite asignar directo desde aquí mismo.
 *
 * Layout: mapa a la izquierda, lista de zonas a la derecha.
 * Permite mover zonas en modo edicion. NO edita datos de pedido
 * (pallet, ruta, familia, etc.) — esos viven en el Membrete.
 */

"use client";

import { useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import { Kpi } from "@/frontend/components/ui/kpi";
import { I } from "@/frontend/components/icons";
import { MapFloor } from "@/frontend/components/maps/map-floor";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeZones, subscribeArmadores, subscribeMembretes, updateZone, adminPauseZone, adminFinishZone, resolveMembreteProductIncident, importWarehouseFloorplanZones, assignArmadorToZone, unassignArmadorFromZone } from "@/frontend/services/firestore";
import { mapZoneToWarehousePosition } from "@/frontend/services/warehouse-layout";
import type { Pos, Zone, Armador, Membrete, ZonePriority } from "@/types";
import { ZONE_PRIORITY_LABEL, ZONE_PRIORITY_COLOR } from "@/frontend/services/zone-priority";
import { ModZonaMonitor } from "@/frontend/components/admin/mod-zona-monitor";

// Canvas editor — lazy loaded (konva needs window)
const WarehouseCanvasEditor = lazy(() =>
  import("@/frontend/components/maps/canvas-editor").then((m) => ({ default: m.WarehouseCanvasEditor }))
);

const ZONE_COLORS: Record<string, string> = {
  Z01: "#0D9488", Z02: "#6366F1", Z03: "#8B5CF6", Z04: "#F59E0B", Z05: "#10B981", Z06: "#EF4444",
  Z07: "#0EA5E9", Z08: "#EC4899", Z09: "#14B8A6", Z10: "#F97316", Z11: "#3B82F6", Z12: "#A855F7",
  Z13: "#22C55E", Z14: "#E11D48", Z15: "#06B6D4", Z16: "#84CC16", Z17: "#D946EF", Z18: "#0891B2",
  Z19: "#65A30D", Z20: "#DC2626",
};

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
  const [viewMode, setViewMode] = useState<"map" | "monitor" | "editor">("map");
  // Mapa de calor: tiñe cada zona según cuánto trabajo pendiente tiene
  // (ver zoneLoad/heatBucket). Encendido por defecto — es lo que se pidió;
  // el botón en la barra de herramientas lo apaga si distrae.
  const [heatMode, setHeatMode] = useState(true);

  // Edit form — solo sector y prioridad (pertenecen a la Zona)
  const [editSector, setEditSector] = useState<"A" | "B">("A");
  const [editPrioridad, setEditPrioridad] = useState<ZonePriority>("media");
  const [saving, setSaving] = useState(false);
  const [zoneAction, setZoneAction] = useState<"pause" | "finish" | null>(null);
  const [importingFloorplan, setImportingFloorplan] = useState(false);
  // Asignación directa desde el mapa (versatilidad): a quién se le está
  // asignando algo en este momento — un membrete puntual de la cola, o
  // toda la zona seleccionada de una vez.
  const [showRosterPicker, setShowRosterPicker] = useState(false);
  const [assigningRoster, setAssigningRoster] = useState(false);
  const [unassigningRosterId, setUnassigningRosterId] = useState<string | null>(null);

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
  /** Incidencias ABIERTAS (reportadas por un armador y aún sin marcar como
   *  resueltas por el admin) dentro de una lista de membretes. */
  function incidentsOf(list: Membrete[]) {
    const out: {
      membreteId: string;
      zonaCode: string;
      productIndex: number;
      codigo: string;
      descripcion: string;
      nota?: string;
      armadorName?: string;
      reportedAt?: number;
    }[] = [];
    list.forEach((m) => {
      (m.products || []).forEach((p, idx) => {
        if (p.status === "incident" && !p.incidentResolvedAt) {
          out.push({
            membreteId: m.id || "",
            zonaCode: m.zonaCode,
            productIndex: idx,
            codigo: p.codigo,
            descripcion: p.descripcion,
            nota: p.incidentNote,
            armadorName: m.armadorName,
            reportedAt: p.completedAt,
          });
        }
      });
    });
    return out;
  }

  /** Incidencias abiertas de una zona puntual (para el panel de detalle). */
  function zoneOpenIncidents(zone: Zone) {
    return incidentsOf(membretesByZone[zone.id || ""] || []);
  }

  /** Estado REAL de una zona, derivado de sus membretes */
  function displayStatus(zone: Zone): Zone["status"] {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    if (zoneMembretes.length === 0) return "idle";

    // Incidencia ABIERTA (el armador reportó un problema y el admin todavía
    // no la marca como resuelta) manda sobre cualquier otro estado — es lo
    // más urgente y no debe quedar tapada por "en proceso" solo porque el
    // armador sigue pickeando el resto del pedido.
    if (incidentsOf(zoneMembretes).length > 0) return "incident";
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

  /** Armador asignado a la zona (del membrete) — el PRIMERO que se encuentre.
   *  Se mantiene por compatibilidad (colores del mapa, filtros); para saber
   *  TODOS los que están trabajando una zona (varios pueden tomar membretes
   *  distintos de la misma cola al mismo tiempo) usar `getArmadoresForZone`. */
  function getArmadorForZone(zone: Zone): Armador | null {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    const assigned = zoneMembretes.find((m) => m.armadorId);
    if (!assigned?.armadorId) return null;
    return armadores.find((a) => a.id === assigned.armadorId) || null;
  }

  /**
   * TODOS los armadores con trabajo vivo (activo o pendiente) en la zona —
   * en el modelo de cola de zona, más de uno puede estar tomando membretes
   * distintos de la misma zona al mismo tiempo, así que ya no basta con
   * "el encargado".
   */
  function getArmadoresForZone(zone: Zone): Armador[] {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    const ids = Array.from(new Set(zoneMembretes.filter((m) => m.armadorId && m.status !== "completed" && m.status !== "cancelled").map((m) => m.armadorId as string)));
    return ids.map((id) => armadores.find((a) => a.id === id)).filter((a): a is Armador => !!a);
  }

  /** Membretes esperando en la cola de la zona (sin tomar, listos para que
   *  cualquier armador los reclame) — el más antiguo primero. */
  function getColaForZone(zone: Zone): Membrete[] {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    return zoneMembretes
      .filter((m) => !m.armadorId && m.status === "pending")
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.code.localeCompare(b.code));
  }

  /** Carga de trabajo real de la zona: membretes esperando en cola +
   *  membretes que se están trabajando ahora mismo. Es la métrica que
   *  alimenta el mapa de calor — cuenta trabajo pendiente, no gente. */
  function zoneLoad(zone: Zone): number {
    const zoneMembretes = membretesByZone[zone.id || ""] || [];
    return zoneMembretes.filter((m) => m.status === "pending" || m.status === "active").length;
  }

  /** Convierte la carga en un bucket 0-4 para el mapa de calor (0 = sin
   *  carga, 4 = crítica). Los cortes son deliberadamente bajos — en este
   *  modelo cada membrete ya es una orden de picking completa, así que
   *  4+ esperando en una sola zona es en efecto "carga crítica". */
  function heatBucket(load: number): number {
    if (load <= 0) return 0;
    if (load === 1) return 1;
    if (load <= 3) return 2;
    if (load <= 6) return 3;
    return 4;
  }

  /** ROSTER — armadores que el supervisor postuló para trabajar en esta zona
   *  (`Armador.zonaAsignadaCode`). Es solo organización: no les entrega
   *  ninguna tarea puntual, sólo les dice dónde deben pararse a tomar la
   *  cola por su cuenta. */
  function getPostedArmadoresForZone(zone: Zone): Armador[] {
    return armadores.filter((a) => a.zonaAsignadaCode === zone.code);
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

  // ─── Importar zonas reales del plano físico ────────────────────────────
  // Crea, como zonas de Firestore de verdad, las áreas del plano real de la
  // bodega (túneles de armado, racks, líneas, ZNC, etc. — ver
  // @/frontend/services/warehouse-floorplan) que la empresa todavía no tenga. Es seguro
  // llamarlo varias veces: solo crea las que falten, nunca duplica.
  async function handleImportFloorplanZones() {
    if (!user?.companyId) return;
    setImportingFloorplan(true);
    try {
      const res = await importWarehouseFloorplanZones(user.companyId, { uid: user.uid, name: user.name });
      if (res.created > 0) {
        alert(`Se importaron ${res.created} zona${res.created > 1 ? "s" : ""} del plano real de la bodega.` + (res.skipped > 0 ? ` (${res.skipped} ya existían y no se tocaron.)` : ""));
      } else {
        alert("Las zonas del plano real ya estaban todas importadas — no había ninguna nueva por crear.");
      }
    } catch (error) {
      console.error("Error importing floorplan zones:", error);
      alert("No se pudieron importar las zonas del plano. Intenta de nuevo.");
    } finally {
      setImportingFloorplan(false);
    }
  }

  // ─── Roster: postular armadores a esta zona (versatilidad) ─────────────
  /** Postula a un armador para trabajar en la zona seleccionada — no le
   *  entrega ninguna tarea, solo lo "pone por zona"; él toma sus membretes
   *  al escanear, por su cuenta. */
  async function handleAssignArmadorToZone(armadorId: string) {
    if (!selectedZone?.id || !user?.companyId) return;
    const armador = armadores.find((a) => a.id === armadorId);
    if (!armador) return;
    setAssigningRoster(true);
    try {
      await assignArmadorToZone({ id: selectedZone.id, code: selectedZone.code }, user.companyId, { id: armador.id, name: armador.name }, { uid: user.uid, name: user.name });
      setShowRosterPicker(false);
    } catch (error) {
      console.error("Error assigning armador to zone from map:", error);
    } finally {
      setAssigningRoster(false);
    }
  }

  /** Quita a un armador del roster de la zona seleccionada. */
  async function handleUnassignArmadorFromZone(armador: Armador) {
    if (!selectedZone || !user?.companyId) return;
    setUnassigningRosterId(armador.id);
    try {
      await unassignArmadorFromZone({ id: armador.id, name: armador.name }, selectedZone.code, user.companyId, { uid: user.uid, name: user.name });
    } catch (error) {
      console.error("Error unassigning armador from zone:", error);
    } finally {
      setUnassigningRosterId(null);
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

  // ─── Incidencias abiertas (todas las zonas) ─────────────────────────────
  const openIncidents = useMemo(() => {
    const list = incidentsOf(membretes);
    list.sort((a, b) => (b.reportedAt || 0) - (a.reportedAt || 0));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membretes]);

  /** El administrador marca una incidencia como resuelta ("ya se solucionó"). */
  async function handleResolveIncident(inc: { membreteId: string; productIndex: number; codigo: string }) {
    if (!user || !inc.membreteId) return;
    const note = window.prompt(`¿Cómo se resolvió la incidencia en ${inc.codigo}? (opcional, puedes dejarlo vacío)`);
    if (note === null) return; // el admin canceló el diálogo
    try {
      await resolveMembreteProductIncident(inc.membreteId, inc.productIndex, note.trim() || undefined, { uid: user.uid, name: user.name });
    } catch (error) {
      console.error("Error resolving incident:", error);
    }
  }

  // ─── Filtros ───────────────────────────────────────────────────────────
  const visibleZones = useMemo(() => {
    let result = zones;
    if (sectorFilter !== "all") result = result.filter((z) => z.sector === sectorFilter);
    if (priorityFilter !== "all") result = result.filter((z) => z.prioridad === priorityFilter);
    if (armadorFilter !== "all") {
      result = result.filter((z) => {
        const arms = getArmadoresForZone(z);
        if (armadorFilter === "unassigned") return arms.length === 0;
        return arms.some((a) => a.id === armadorFilter);
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
    const enCola = membretes.filter((m) => !m.armadorId && m.status === "pending").length;
    return { total, idle, assigned, active, paused, done, incident, sinAsignar, enCola };
  }, [zones, membretesByZone, membretes]);

  const selectedZone = sel ? zones.find((z) => z.code === sel) || null : null;
  const selectedArmador = selectedZone ? getArmadorForZone(selectedZone) : null;
  const selectedArmadores = selectedZone ? getArmadoresForZone(selectedZone) : [];
  const selectedMembretes = selectedZone
    ? [...(membretesByZone[selectedZone.id || ""] || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.code.localeCompare(b.code))
    : [];
  const selectedCola = selectedZone ? getColaForZone(selectedZone) : [];
  const selectedZoneRoster = selectedZone ? getPostedArmadoresForZone(selectedZone) : [];

  // ─── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando mapa...</div>;
  }

  if (viewMode === "monitor") {
    return <ModZonaMonitor onClose={() => setViewMode("map")} />;
  }

  if (viewMode === "editor") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button className="btn sm" onClick={() => setViewMode("map")}>← Volver al mapa</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dim)" }}>Editor de plano — dibuja las zonas del almacén</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando editor...</div>}>
            <WarehouseCanvasEditor
              initialShapes={[]}
              zoneColors={Object.fromEntries(zones.map((z) => [z.code, ZONE_COLORS[z.code] || "#94A3B8"]))}
              width={1400}
              height={800}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div ref={fullscreenRef} style={isFullscreen ? { position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" } : undefined}>
      {/* ─── KPIs ─────────────────────────────────────────────── */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(9, 1fr)", marginBottom: 12 }}>
        <Kpi small accent="var(--accent)" lab="Total" val={stats.total} />
        <Kpi small accent="var(--s-idle)" lab="Pendientes" val={stats.idle} />
        <Kpi small accent="var(--accent)" lab="En cola" val={stats.enCola} />
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
                <button className="btn sm" onClick={() => setViewMode("editor")} title="Editor de plano — dibuja zonas visualmente">✏️ Editor</button>
                <button className={"btn sm" + (edit ? " primary" : "")} onClick={() => setEdit(!edit)}>{edit ? "Guardando" : "Mover"}</button>
                <button
                  className={"btn sm" + (heatMode ? " primary" : "")}
                  onClick={() => setHeatMode((v) => !v)}
                  title="Tiñe cada zona según los membretes en cola + en proceso que tiene"
                >
                  🔥 Mapa de calor
                </button>
                <button
                  className="btn sm"
                  onClick={handleImportFloorplanZones}
                  disabled={importingFloorplan}
                  title="Crea, como zonas reales, las áreas del plano físico de la bodega que todavía no existan (no duplica las que ya tienes)"
                >
                  {importingFloorplan ? "Importando..." : "Importar zonas del plano"}
                </button>
                <button className="btn sm" onClick={toggleFullscreen} title="Pantalla completa">{isFullscreen ? <I.shrink /> : <I.expand />}</button>
              </div>
            </div>

            {/* Incidencias abiertas: esto es lo que "le llega" al administrador —
                se ve apenas entra al mapa (y como badge en el menú desde
                cualquier módulo), con un botón para decirle al sistema que ya
                se solucionó. */}
            {openIncidents.length > 0 && (
              <div className="alert inc" style={{ flexShrink: 0, margin: "10px 16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="at">
                  <I.alert /> {openIncidents.length} incidencia{openIncidents.length > 1 ? "s" : ""} abierta{openIncidents.length > 1 ? "s" : ""} — necesita{openIncidents.length > 1 ? "n" : ""} que el administrador la{openIncidents.length > 1 ? "s" : ""} resuelva{openIncidents.length > 1 ? "n" : ""}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {openIncidents.map((inc) => (
                    <div
                      key={inc.membreteId + "-" + inc.productIndex}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, fontSize: 12.5, background: "var(--panel)", borderRadius: 8, padding: "8px 10px" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <b className="mono">{inc.zonaCode}</b> · {inc.codigo} — {inc.descripcion}
                        {inc.nota && <div style={{ color: "var(--faint)", marginTop: 2 }}>&ldquo;{inc.nota}&rdquo;</div>}
                        <div style={{ color: "var(--faint)", fontSize: 11, marginTop: 2 }}>
                          {inc.armadorName || "Armador"}{inc.reportedAt ? " · " + new Date(inc.reportedAt).toLocaleString("es-CO") : ""}
                        </div>
                      </div>
                      <button className="btn sm" style={{ flexShrink: 0 }} onClick={() => handleResolveIncident(inc)}>
                        <I.check /> Marcar resuelta
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leyenda */}
            <div className="legend" style={{ flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
              <span><i style={{ background: "var(--s-idle)" }} /> Sin asignar</span>
              <span><i style={{ background: "var(--s-done)" }} /> Completada</span>
              <span><i style={{ background: "var(--s-active)" }} /> En proceso</span>
              <span><i style={{ background: "var(--s-paused)" }} /> Pausada</span>
              <span><i style={{ background: "var(--s-inc)" }} /> Incidencia</span>
              <span style={{ marginLeft: 8, borderLeft: "1px solid var(--line)", paddingLeft: 8 }}>Colores = armador que la está trabajando (si hay varios, el primero)</span>
            </div>

            {/* Leyenda del mapa de calor — solo visible con el toggle activo.
                Es una capa aparte: el color de fondo de la ficha dice "cuánta
                carga tiene la zona", nunca reemplaza la bolita (estado) ni la
                franja (armador) de arriba. */}
            {heatMode && (
              <div className="legend heat-legend" style={{ flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
                <span className="heat-legend-label">Mapa de calor — carga (membretes en cola + en proceso):</span>
                <span><i className="heat-swatch heat-0" /> Sin carga</span>
                <span><i className="heat-swatch heat-1" /> Baja (1)</span>
                <span><i className="heat-swatch heat-2" /> Media (2-3)</span>
                <span><i className="heat-swatch heat-3" /> Alta (4-6)</span>
                <span><i className="heat-swatch heat-4" /> Crítica (7+)</span>
              </div>
            )}

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
                heatOf={(code) => {
                  const zone = zones.find((z) => z.code === code);
                  return zone ? heatBucket(zoneLoad(zone)) : 0;
                }}
                heatEnabled={heatMode}
                sizeOf={(code) => {
                  const zone = zones.find((z) => z.code === code);
                  return zone?.w && zone?.h ? { w: zone.w, h: zone.h } : undefined;
                }}
                selected={sel || undefined}
                onSelect={(code) => setSel(code)}
                editable={edit}
                onPositionCommit={handlePositionChange}
                tooltipOf={(code) => {
                  const zone = zones.find((z) => z.code === code);
                  if (!zone) return null;
                  const pedido = getPedidoForZone(zone);
                  const arms = getArmadoresForZone(zone);
                  const cola = getColaForZone(zone);
                  const roster = getPostedArmadoresForZone(zone);
                  const statusLabel: Record<string, string> = { done: "Completada", active: "En proceso", assigned: "Asignada", incident: "Incidencia", idle: "Sin asignar", paused: "Pausada" };
                  return (
                    <>
                      {zone.name && <div className="zone-tooltip-row"><span className="k">Zona</span><span className="v">{zone.name}</span></div>}
                      <div className="zone-tooltip-row">
                        <span className="k">{arms.length > 1 ? "Trabajando" : "Encargado"}</span>
                        <span className="v">{arms.length > 0 ? arms.map((a) => a.name).join(", ") : "Sin asignar"}</span>
                      </div>
                      {roster.length > 0 && <div className="zone-tooltip-row"><span className="k">Postulados</span><span className="v">{roster.map((a) => a.name).join(", ")}</span></div>}
                      <div className="zone-tooltip-row"><span className="k">Estado</span><span className="v">{statusLabel[displayStatus(zone)] || zone.status}</span></div>
                      {cola.length > 0 && <div className="zone-tooltip-row"><span className="k">En cola</span><span className="v">{cola.length} membrete{cola.length === 1 ? "" : "s"} esperando</span></div>}
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
        <div className="zsb">
          <div className="zsb-h">
            <h3>Zonas</h3>
            <span className="zsb-count">{visibleZones.length}{visibleZones.length !== zones.length ? ` / ${zones.length}` : ""}</span>
          </div>
          <div className="zsb-list">
            {visibleZones.length === 0 && (
              <div className="zsb-empty">No hay zonas en este sector.</div>
            )}
            {visibleZones.map((z) => {
              const isSelected = sel === z.code;
              const arm = getArmadorForZone(z);
              const arms = getArmadoresForZone(z);
              const cola = getColaForZone(z);
              const roster = getPostedArmadoresForZone(z);
              const pedido = getPedidoForZone(z);
              const status = displayStatus(z);
              const sc: Record<string, string> = { done: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)", incident: "var(--s-inc)", idle: "var(--s-idle)", paused: "var(--s-paused)" };
              const zoneColor = arm?.color || sc[status] || "var(--s-idle)";
              const heatB = heatMode ? heatBucket(zoneLoad(z)) : 0;
              const pedidoLine = [pedido.pallet && `P: ${pedido.pallet}`, pedido.ruta && `R: ${pedido.ruta}`].filter(Boolean).join("  ·  ");
              return (
                <div
                  key={z.code}
                  className={"zsb-row" + (isSelected ? " sel" : "")}
                  onClick={() => setSel(z.code)}
                  style={{ borderLeftColor: isSelected ? undefined : heatB > 0 ? `var(--heat-${heatB})` : undefined }}
                >
                  <span className="zsb-avatar" style={{ background: `color-mix(in srgb, ${zoneColor} 14%, var(--panel))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${zoneColor} 38%, transparent)` }}>
                    <i style={{ background: zoneColor }} />
                  </span>
                  <div className="zsb-body">
                    <div className="zsb-code mono">{z.code}</div>
                    <div className="zsb-owner">
                      {arms.length > 0
                        ? arms.map((a) => a.name).join(", ")
                        : roster.length > 0
                          ? `${roster.map((a) => a.name).join(", ")} (postulado${roster.length === 1 ? "" : "s"})`
                          : "Sin asignar"}
                    </div>
                    {pedidoLine && <div className="zsb-sub mono">{pedidoLine}</div>}
                  </div>
                  <div className="zsb-tags">
                    {z.prioridad === "alta" && (
                      <span className="chip" style={{ background: `color-mix(in srgb, ${ZONE_PRIORITY_COLOR.alta} 16%, transparent)`, color: ZONE_PRIORITY_COLOR.alta }}>¡Alta!</span>
                    )}
                    {cola.length > 0 && (
                      <span className="chip" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{cola.length} en cola</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
              {selectedArmadores.map((a) => (
                <span key={a.id} className="chip" style={{ background: "color-mix(in srgb, " + (a.color || "var(--accent)") + " 16%, transparent)", color: a.color || "var(--accent)" }}>{a.name}</span>
              ))}
              {selectedCola.length > 0 && (
                <span className="chip" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}>{selectedCola.length} en cola</span>
              )}
              {selectedZone.totalProducts || selectedZone.products?.length || 0} productos
              <button className="btn ghost sm" style={{ marginLeft: 4 }} onClick={() => setSel(null)} title="Cerrar">✕</button>
            </span>
          </div>

          {/* Incidencia(s) abierta(s) de esta zona en particular */}
          {displayStatus(selectedZone) === "incident" && (
            <div className="alert inc" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="at">
                <I.alert /> Esta zona tiene incidencia(s) sin resolver.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {zoneOpenIncidents(selectedZone).map((inc) => (
                  <div key={inc.membreteId + "-" + inc.productIndex} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, fontSize: 12.5 }}>
                    <div>
                      <b>{inc.codigo}</b> — {inc.descripcion}
                      {inc.nota && <div style={{ color: "var(--faint)" }}>&ldquo;{inc.nota}&rdquo;</div>}
                    </div>
                    <button className="btn sm" onClick={() => handleResolveIncident(inc)}>
                      <I.check /> Resolver
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Control admin: pausar/terminar */}
          {(displayStatus(selectedZone) === "active" || displayStatus(selectedZone) === "paused") && (
            <div className="alert warn" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="at">
                <I.alert />
                {displayStatus(selectedZone) === "active"
                  ? (selectedArmadores.length > 1
                      ? `${selectedArmadores.map((a) => a.name).join(", ")} están trabajando esta zona.`
                      : `${selectedArmador?.name || "Un armador"} está trabajando esta zona.`)
                  : `Esta zona está pausada (${selectedArmador?.name || "el armador"} sigue con la tarea).`}
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

          {/* Roster — qué armadores están postulados a esta zona (versatilidad) */}
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: selectedZoneRoster.length > 0 ? 8 : 0 }}>
              <span style={{ fontSize: 12.5 }}>
                {selectedCola.length > 0
                  ? <>Hay <b>{selectedCola.length}</b> membrete{selectedCola.length === 1 ? "" : "s"} esperando en <b className="mono">{selectedZone.code}</b> — los toma quien esté postulado aquí, por su cuenta, al escanear.</>
                  : <>Postula armadores a <b className="mono">{selectedZone.code}</b> para que sepan que deben trabajar ahí — ellos toman los membretes al escanear.</>}
              </span>
              {showRosterPicker ? (
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 12 }}
                    defaultValue=""
                    onChange={(e) => e.target.value && handleAssignArmadorToZone(e.target.value)}
                    disabled={assigningRoster}
                  >
                    <option value="" disabled>Elegir armador...</option>
                    {armadores.filter((a) => a.zonaAsignadaCode !== selectedZone.code).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button className="btn ghost sm" onClick={() => setShowRosterPicker(false)}>Cancelar</button>
                </span>
              ) : (
                <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setShowRosterPicker(true)}>
                  Postular armador a esta zona
                </button>
              )}
            </div>
            {selectedZoneRoster.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {selectedZoneRoster.map((a) => (
                  <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "4px 8px", borderRadius: 20, background: "var(--panel2)", border: "1px solid var(--line)" }}>
                    {a.name}
                    <button
                      className="btn ghost sm"
                      style={{ padding: "0 2px", lineHeight: 1 }}
                      onClick={() => handleUnassignArmadorFromZone(a)}
                      disabled={unassigningRosterId === a.id}
                      title="Quitar de esta zona"
                    >✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Membretes de esta zona — en orden de cola */}
          {selectedMembretes.length > 0 && (
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>
                Membretes ({selectedMembretes.length}) — orden de cola
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedMembretes.map((m) => {
                  const enCola = !m.armadorId && m.status === "pending";
                  const posEnCola = enCola ? selectedCola.findIndex((c) => c.id === m.id) + 1 : 0;
                  const origen = m.claimedAt ? "Tomado por el armador" : m.armadorId ? "Asignado directo" : null;
                  return (
                    <div key={m.id} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", background: m.status === "active" ? "color-mix(in srgb, var(--s-active) 8%, transparent)" : "var(--panel2)", fontSize: 12, minWidth: 160 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600, fontFamily: "var(--mono)" }}>{m.code}</span>
                        {enCola && <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>#{posEnCola} en cola</span>}
                      </div>
                      {m.pallet && <div style={{ color: "var(--faint)" }}>Pallet: {m.pallet}{m.palletTotal ? `/${m.palletTotal}` : ""}</div>}
                      {m.ruta && <div style={{ color: "var(--faint)" }}>Ruta: {m.ruta}</div>}
                      {m.armadorName && <div style={{ color: "var(--accent)" }}>{m.armadorName}</div>}
                      <div style={{ fontSize: 10, color: m.status === "completed" ? "var(--s-done)" : m.status === "active" ? "var(--s-active)" : "var(--faint)" }}>
                        {m.status === "completed" ? "Hecho" : m.status === "active" ? "Activo" : "Pendiente"}
                        {origen && <span style={{ color: "var(--faint)" }}> · {origen}</span>}
                      </div>
                    </div>
                  );
                })}
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
