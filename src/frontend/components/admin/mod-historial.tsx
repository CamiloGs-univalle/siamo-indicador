/**
 * @file components/admin/mod-historial.tsx
 * @description Módulo "Historial" — el registro de todo lo que pasa en la
 * operación, para poder medir y tomar mejores decisiones. Reemplaza al
 * antiguo módulo "Picking" (esa captura de datos reales sigue aquí, en la
 * pestaña Picking) y lo amplía con dos piezas que antes no existían en
 * ningún lado de la app:
 *
 *  - "Resumen": KPIs reales + un motor de recomendaciones basado en reglas
 *    (no es IA — son alertas honestas calculadas a partir de las zonas,
 *    armadores y registros de picking reales).
 *  - "Actividad": la bitácora completa de movimiento (asignaciones,
 *    escaneos, picking, cargas de SAP, altas/bajas de equipo), en vivo.
 *
 * La pestaña "Picking" conserva el registro manual/masivo de producción
 * real (cantidad, tiempo, costo), que es la fuente de datos que alimenta
 * el resumen y las recomendaciones.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { I } from "@/frontend/components/icons";
import { Panel } from "@/frontend/components/ui/panel";
import { useAuth } from "@/frontend/context/auth-context";
import { normalizeHeader } from "@/frontend/services/excel-utils";
import {
  getZones,
  getArmadores,
  getCompany,
  getPickings,
  createPickingRecord,
  bulkCreatePickingRecords,
  deletePickingRecord,
  subscribeActivity,
} from "@/frontend/services/firestore";
import type { Zone, Armador, PickingRecord, ActivityLogEntry, ActivityType } from "@/types";

type Tab = "resumen" | "actividad" | "picking";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Convierte un valor de celda de Excel (texto, "DD/MM/YYYY" o número serial) a "YYYY-MM-DD". */
function normalizeFecha(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

/** "hace 3 min", "hace 2 h", "hace 5 d" — para la bitácora de actividad. */
function relTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "justo ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

const ACTIVITY_ICON: Record<ActivityType, React.FC<Record<string, unknown>>> = {
  zone_assigned: I.users,
  zone_unassigned: I.users,
  zone_paused: I.pause,
  membrete_created: I.box,
  membrete_assigned: I.users,
  membrete_started: I.qr,
  membrete_completed: I.check,
  membrete_cancelled: I.users,
  membrete_product_completed: I.check,
  membrete_product_incident: I.alert,
  membrete_product_incident_resolved: I.check,
  scan_started: I.qr,
  scan_finished: I.check,
  picking_manual: I.box,
  picking_bulk: I.upload,
  sap_import: I.upload,
  armador_created: I.users,
  armador_deleted: I.users,
  zones_imported: I.upload,
  armador_zona_asignada: I.users,
  armador_zona_desasignada: I.users,
  membrete_claimed: I.qr,
  cycle_started: I.check,
  cycle_paused: I.pause,
  cycle_resumed: I.check,
  cycle_completed: I.check,
};

const ACTIVITY_CATEGORY: Record<ActivityType, string> = {
  zone_assigned: "Asignaciones",
  zone_unassigned: "Asignaciones",
  zone_paused: "Asignaciones",
  membrete_created: "Membretes",
  membrete_assigned: "Membretes",
  membrete_claimed: "Membretes",
  membrete_started: "Membretes",
  membrete_completed: "Membretes",
  membrete_cancelled: "Membretes",
  membrete_product_completed: "Membretes",
  membrete_product_incident: "Membretes",
  membrete_product_incident_resolved: "Membretes",
  scan_started: "Escaneos",
  scan_finished: "Escaneos",
  picking_manual: "Picking",
  picking_bulk: "Picking",
  sap_import: "Carga SAP",
  armador_created: "Equipo",
  armador_deleted: "Equipo",
  zones_imported: "Asignaciones",
  armador_zona_asignada: "Asignaciones",
  armador_zona_desasignada: "Asignaciones",
  cycle_started: "Asignaciones",
  cycle_paused: "Asignaciones",
  cycle_resumed: "Asignaciones",
  cycle_completed: "Asignaciones",
};

const ACTIVITY_CATEGORIES = ["Asignaciones", "Escaneos", "Picking", "Carga SAP", "Equipo", "Membretes"];

interface BulkRow {
  zoneCode: string;
  zonaValida: boolean;
  armadorNombre: string;
  armadorId?: string;
  fecha: string;
  cantidad: number;
  tiempoMinutos?: number;
  notas?: string;
  costo?: number;
}

function downloadTemplate() {
  const headers = ["Zona", "Armador", "Fecha", "Cantidad", "Tiempo (min)", "Notas"];
  const example = ["Z07", "Juan Torres", todayISO(), 24, 18, ""];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Picking");
  XLSX.writeFile(wb, "plantilla_picking_siamo.xlsx");
}

interface Recommendation {
  level: "warn" | "info" | "good";
  text: string;
}

const LEVEL_COLOR: Record<Recommendation["level"], string> = {
  warn: "var(--s-inc)",
  info: "var(--s-active)",
  good: "var(--s-done)",
};

export function ModHistorial() {
  const { user } = useAuth();
  const companyId = user?.companyId;

  const [tab, setTab] = useState<Tab>("resumen");

  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [costoHoraDefault, setCostoHoraDefault] = useState(0);
  const [pickings, setPickings] = useState<PickingRecord[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>("Todos");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ─── Formulario manual de picking ───────────────────────────────────────
  const [formZona, setFormZona] = useState("");
  const [formArmadorId, setFormArmadorId] = useState("");
  const [formFecha, setFormFecha] = useState(todayISO());
  const [formCantidad, setFormCantidad] = useState<number | "">("");
  const [formTiempo, setFormTiempo] = useState<number | "">("");
  const [formNotas, setFormNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ─── Carga masiva de picking (Excel) ────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [skippedRows, setSkippedRows] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);

  async function loadAll(cid: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const [z, a, company, p] = await Promise.all([
        getZones(cid),
        getArmadores(cid),
        getCompany(cid),
        getPickings(cid),
      ]);
      setZones(z);
      setArmadores(a);
      setCostoHoraDefault(company?.costoHoraDefault || 0);
      setPickings(p);
      if (!formZona && z.length > 0) setFormZona(z[0].code);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudo cargar la información.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (companyId) loadAll(companyId);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // La bitácora de actividad sí es en vivo: es lo que hace que "Historial" se
  // sienta como un feed real y no como una foto vieja de lo que pasó.
  useEffect(() => {
    if (!companyId) return;
    const unsub = subscribeActivity(companyId, setActivity);
    return unsub;
  }, [companyId]);

  const armadorById = useMemo(() => new Map(armadores.map((a) => [a.id, a])), [armadores]);
  const zoneByCode = useMemo(() => new Map(zones.map((z) => [z.code, z])), [zones]);
  const zonaSeleccionada = formZona ? zoneByCode.get(formZona) : undefined;

  function costoDe(armadorId: string | undefined, tiempoMinutos: number | undefined): number {
    if (!tiempoMinutos) return 0;
    const rate = (armadorId ? armadorById.get(armadorId)?.costPerHour : undefined) ?? costoHoraDefault;
    return Math.round(rate * (tiempoMinutos / 60) * 100) / 100;
  }

  // ─── Resumen: datos reales de producción, tiempo y costo ───────────────
  const totalCantidad = pickings.reduce((acc, p) => acc + (p.cantidad || 0), 0);
  const totalCosto = pickings.reduce((acc, p) => acc + (p.costo || 0), 0);
  const totalMinutos = pickings.reduce((acc, p) => acc + (p.tiempoMinutos || 0), 0);
  const prodPorHora = totalMinutos > 0 ? Math.round((totalCantidad / (totalMinutos / 60)) * 10) / 10 : 0;

  // ─── Motor de recomendaciones (reglas honestas sobre datos reales) ──────
  const recommendations = useMemo<Recommendation[]>(() => {
    const recs: Recommendation[] = [];

    const incidentZones = zones.filter((z) => z.status === "incident");
    if (incidentZones.length > 0) {
      recs.push({
        level: "warn",
        text: `${incidentZones.length} zona(s) con incidencia sin resolver: ${incidentZones.map((z) => z.code).join(", ")}.`,
      });
    }

    const altaPendientes = zones.filter((z) => z.prioridad === "alta" && z.status !== "done");
    if (altaPendientes.length > 0) {
      recs.push({
        level: "warn",
        text: `${altaPendientes.length} zona(s) de prioridad alta todavía sin completar: ${altaPendientes.map((z) => z.code).join(", ")}.`,
      });
    }

    const sinAsignar = zones.filter((z) => !z.armadorId && z.status !== "done");
    if (sinAsignar.length > 0) {
      recs.push({
        level: "info",
        text: `${sinAsignar.length} zona(s) sin asignar todavía. Revisa el módulo de Asignación.`,
      });
    }

    const conProd = armadores.filter((a) => a.prodH > 0);
    if (conProd.length > 0) {
      const ordenado = [...conProd].sort((a, b) => b.prodH - a.prodH);
      const mejor = ordenado[0];
      recs.push({ level: "good", text: `${mejor.name} tiene la mejor productividad del equipo (${mejor.prodH} u/h).` });
      const peor = ordenado[ordenado.length - 1];
      if (peor.id !== mejor.id && peor.prodH < mejor.prodH * 0.6) {
        recs.push({
          level: "info",
          text: `${peor.name} tiene una productividad bastante menor al resto (${peor.prodH} u/h) — podría necesitar apoyo o revisión de su ruta.`,
        });
      }
    }

    if (pickings.length === 0) {
      recs.push({
        level: "info",
        text: "Todavía no hay registros de picking. Regístralos en la pestaña Picking para empezar a ver recomendaciones basadas en datos reales.",
      });
    } else {
      const byZone = new Map<string, { qty: number; cost: number }>();
      pickings.forEach((p) => {
        const cur = byZone.get(p.zoneCode) || { qty: 0, cost: 0 };
        cur.qty += p.cantidad || 0;
        cur.cost += p.costo || 0;
        byZone.set(p.zoneCode, cur);
      });
      const porUnidad = Array.from(byZone.entries())
        .map(([code, v]) => ({ code, perUnit: v.qty > 0 ? v.cost / v.qty : 0 }))
        .filter((z) => z.perUnit > 0);
      if (porUnidad.length > 1) {
        const promedio = porUnidad.reduce((a, b) => a + b.perUnit, 0) / porUnidad.length;
        const peor = [...porUnidad].sort((a, b) => b.perUnit - a.perUnit)[0];
        if (promedio > 0 && peor.perUnit > promedio * 1.4) {
          recs.push({
            level: "warn",
            text: `La zona ${peor.code} tiene el costo por unidad más alto del grupo ($${Math.round(peor.perUnit).toLocaleString("es-CO")} vs. un promedio de $${Math.round(promedio).toLocaleString("es-CO")}) — revisa cuánto tiempo está tomando.`,
          });
        }
      }
    }

    if (recs.length === 0) {
      recs.push({
        level: "good",
        text: "Todo se ve en orden: sin incidencias abiertas, sin zonas prioritarias pendientes y sin desbalances importantes de productividad.",
      });
    }
    return recs;
  }, [zones, armadores, pickings]);

  const filteredActivity =
    activityFilter === "Todos" ? activity : activity.filter((e) => ACTIVITY_CATEGORY[e.type] === activityFilter);

  // ─── Guardar registro manual de picking ─────────────────────────────────
  async function handleSaveManual() {
    if (!companyId) return;
    if (!formZona) {
      setFormError("Selecciona una zona.");
      return;
    }
    const cantidad = Number(formCantidad);
    if (!cantidad || cantidad <= 0) {
      setFormError("La cantidad debe ser mayor a cero.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const tiempoMinutos = formTiempo === "" ? undefined : Number(formTiempo);
      await createPickingRecord({
        companyId,
        zoneCode: formZona,
        armadorId: formArmadorId || undefined,
        fecha: formFecha,
        cantidad,
        tiempoMinutos,
        costo: costoDe(formArmadorId || undefined, tiempoMinutos),
        fuente: "manual",
        notas: formNotas.trim() || undefined,
        createdAt: Date.now(),
        createdBy: user?.uid,
      });
      setFormCantidad("");
      setFormTiempo("");
      setFormNotas("");
      await loadAll(companyId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el registro.");
    } finally {
      setSaving(false);
    }
  }

  // ─── Carga masiva: parseo del Excel ──────────────────────────────────────
  async function handleFile(file: File) {
    setParsing(true);
    setParseError(null);
    setConfirmCount(null);
    setConfirmError(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("El archivo no tiene hojas legibles.");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" });
      if (raw.length === 0) throw new Error("La hoja está vacía.");

      const armadorByName = new Map(armadores.map((a) => [a.name.trim().toLowerCase(), a.id]));
      const armadorByEmail = new Map(
        armadores.filter((a) => a.email).map((a) => [a.email!.trim().toLowerCase(), a.id])
      );
      const validZoneCodes = new Set(zones.map((z) => z.code));

      const rows: BulkRow[] = [];
      let skipped = 0;

      for (const rawRow of raw) {
        const mapped: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rawRow)) {
          const h = normalizeHeader(key);
          if (h === "zona") mapped.zona = value;
          else if (h === "armador") mapped.armador = value;
          else if (h === "fecha") mapped.fecha = value;
          else if (h === "cantidad") mapped.cantidad = value;
          else if (h === "tiempo" || h === "tiempomin" || h === "tiempominutos" || h === "minutos") mapped.tiempo = value;
          else if (h === "notas") mapped.notas = value;
        }

        const zoneCode = String(mapped.zona ?? "").trim();
        const cantidad = Number(mapped.cantidad ?? 0);
        if (!zoneCode || !Number.isFinite(cantidad) || cantidad <= 0) {
          skipped++;
          continue;
        }

        const armadorNombre = String(mapped.armador ?? "").trim();
        const armadorId =
          armadorByName.get(armadorNombre.toLowerCase()) || armadorByEmail.get(armadorNombre.toLowerCase());
        const tiempoMinutos = mapped.tiempo !== undefined && mapped.tiempo !== "" ? Number(mapped.tiempo) : undefined;

        rows.push({
          zoneCode,
          zonaValida: validZoneCodes.has(zoneCode),
          armadorNombre,
          armadorId,
          fecha: mapped.fecha ? normalizeFecha(mapped.fecha) : todayISO(),
          cantidad,
          tiempoMinutos: Number.isFinite(tiempoMinutos as number) ? tiempoMinutos : undefined,
          notas: mapped.notas ? String(mapped.notas).trim() : undefined,
          costo: costoDe(armadorId, tiempoMinutos),
        });
      }

      if (rows.length === 0) {
        throw new Error("No se reconoció ninguna fila válida. Verifica columnas Zona, Armador, Fecha y Cantidad.");
      }
      setBulkRows(rows);
      setSkippedRows(skipped);
    } catch (err) {
      setBulkRows([]);
      setSkippedRows(0);
      setParseError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setParsing(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  async function handleConfirmBulk() {
    if (!companyId || bulkRows.length === 0) return;
    const invalidas = bulkRows.filter((r) => !r.zonaValida).length;
    const warning =
      invalidas > 0
        ? `\n\n${invalidas} fila(s) tienen una zona que no existe en el sistema — se guardarán igual, pero revisa si fue un error de tipeo.`
        : "";
    if (!window.confirm(`¿Confirmar carga de ${bulkRows.length} registros de picking?${warning}`)) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await bulkCreatePickingRecords(
        bulkRows.map((r) => ({
          companyId,
          zoneCode: r.zoneCode,
          armadorId: r.armadorId,
          fecha: r.fecha,
          cantidad: r.cantidad,
          tiempoMinutos: r.tiempoMinutos,
          costo: r.costo,
          fuente: "excel" as const,
          notas: r.notas,
          createdAt: Date.now(),
          createdBy: user?.uid,
        }))
      );
      setConfirmCount(bulkRows.length);
      setBulkRows([]);
      setFileName(null);
      setSkippedRows(0);
      await loadAll(companyId);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "No se pudo confirmar la carga.");
    } finally {
      setConfirming(false);
    }
  }

  async function handleDelete(p: PickingRecord) {
    if (!p.id || !companyId) return;
    if (!window.confirm(`¿Eliminar el registro de ${p.zoneCode} del ${p.fecha}?`)) return;
    try {
      await deletePickingRecord(p.id);
      await loadAll(companyId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo eliminar el registro.");
    }
  }

  const noCompany = !companyId;

  if (noCompany) {
    return (
      <div className="panel">
        <div style={{ padding: 16 }}>
          <div className="alert warn">
            <I.alert /> Tu usuario no tiene una empresa asociada, así que el historial no se puede cargar en este modo.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando…</div>;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="historial-tabs">
        <button className={tab === "resumen" ? "on" : ""} onClick={() => setTab("resumen")}>
          <I.bulb /> Resumen y recomendaciones
        </button>
        <button className={tab === "actividad" ? "on" : ""} onClick={() => setTab("actividad")}>
          <I.history /> Actividad ({activity.length})
        </button>
        <button className={tab === "picking" ? "on" : ""} onClick={() => setTab("picking")}>
          <I.box /> Registrar picking
        </button>
      </div>

      {tab === "resumen" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="summary-chips">
            <div className="schip"><div className="n mono">{pickings.length}</div><div className="l">Registros de picking</div></div>
            <div className="schip"><div className="n mono">{totalCantidad.toLocaleString("es-CO")}</div><div className="l">Unidades recolectadas</div></div>
            <div className="schip"><div className="n mono">{prodPorHora || "—"}</div><div className="l">Producción real (uds/hora)</div></div>
            <div className="schip"><div className="n mono">${totalCosto.toLocaleString("es-CO", { maximumFractionDigits: 0 })}</div><div className="l">Costo total de mano de obra</div></div>
          </div>

          <Panel title="Recomendaciones" hint="Alertas calculadas a partir de tus datos reales, no son adivinanzas">
            <div>
              {recommendations.map((r, i) => (
                <div key={i} className="rec-card">
                  <span className="rec-dot" style={{ background: LEVEL_COLOR[r.level] }} />
                  <span className="rec-text">{r.text}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Actividad reciente" hint="Los últimos movimientos" action={
            <button className="btn sm" onClick={() => setTab("actividad")}>Ver todo</button>
          }>
            {activity.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: "var(--faint)", fontSize: 12.5 }}>
                Todavía no hay actividad registrada.
              </div>
            ) : (
              <div className="activity-feed" style={{ maxHeight: 260 }}>
                {activity.slice(0, 8).map((e) => {
                  const Icon = ACTIVITY_ICON[e.type];
                  return (
                    <div key={e.id} className="activity-item">
                      <span className="activity-icon"><Icon /></span>
                      <div className="activity-body">
                        <div className="activity-msg">{e.message}</div>
                        <div className="activity-meta">{relTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "actividad" && (
        <Panel title={`Bitácora de actividad (${filteredActivity.length})`} hint="En vivo — se actualiza sola">
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
            {["Todos", ...ACTIVITY_CATEGORIES].map((cat) => (
              <button
                key={cat}
                className={"btn sm" + (activityFilter === cat ? " primary" : "")}
                onClick={() => setActivityFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          {filteredActivity.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
              Sin actividad en esta categoría todavía.
            </div>
          ) : (
            <div className="activity-feed">
              {filteredActivity.map((e) => {
                const Icon = ACTIVITY_ICON[e.type];
                return (
                  <div key={e.id} className="activity-item">
                    <span className="activity-icon"><Icon /></span>
                    <div className="activity-body">
                      <div className="activity-msg">{e.message}</div>
                      <div className="activity-meta">{relTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {tab === "picking" && (
        <div style={{ display: "grid", gap: 16 }}>
          {/* ─── Registro manual ────────────────────────────────────── */}
          <Panel title="Registrar picking (manual)" hint="Zona por zona, con costo calculado automáticamente">
            <div style={{ padding: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label>Zona</label>
                  <select value={formZona} onChange={(e) => setFormZona(e.target.value)}>
                    {zones.length === 0 && <option value="">Sin zonas</option>}
                    {zones.map((z) => (
                      <option key={z.code} value={z.code}>
                        {z.code}{z.pallet ? ` — Pallet ${z.pallet}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Armador (opcional)</label>
                  <select value={formArmadorId} onChange={(e) => setFormArmadorId(e.target.value)}>
                    <option value="">Sin asignar</option>
                    {armadores.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Fecha del picking</label>
                  <input type="date" value={formFecha} onChange={(e) => setFormFecha(e.target.value)} />
                </div>
                <div className="field">
                  <label>Cantidad</label>
                  <input
                    type="number"
                    min={0}
                    value={formCantidad}
                    onChange={(e) => setFormCantidad(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="Ej. 24"
                  />
                </div>
                <div className="field">
                  <label>Tiempo (minutos)</label>
                  <input
                    type="number"
                    min={0}
                    value={formTiempo}
                    onChange={(e) => setFormTiempo(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="Ej. 18"
                  />
                </div>
                <div className="field">
                  <label>Notas (opcional)</label>
                  <input value={formNotas} onChange={(e) => setFormNotas(e.target.value)} placeholder="Observaciones" />
                </div>
              </div>

              {zonaSeleccionada && (zonaSeleccionada.ruta || zonaSeleccionada.fechaEntrega || zonaSeleccionada.familia || zonaSeleccionada.camion) && (
                <div className="marbete-strip" style={{ margin: "0 0 14px", borderRadius: 10, border: "1px solid var(--line)" }}>
                  {zonaSeleccionada.ruta && <span><b>Ruta/Trans:</b> <span className="mono">{zonaSeleccionada.ruta}</span></span>}
                  {zonaSeleccionada.pallet && (
                    <span><b>Pallet:</b> <span className="mono">{zonaSeleccionada.pallet}{zonaSeleccionada.palletTotal ? ` de ${zonaSeleccionada.palletTotal}` : ""}</span></span>
                  )}
                  {zonaSeleccionada.fechaEntrega && <span><b>Fecha de entrega:</b> {zonaSeleccionada.fechaEntrega}</span>}
                  {zonaSeleccionada.familia && <span><b>Familia:</b> {zonaSeleccionada.familia}</span>}
                  <span><b>Total SAP:</b> {zonaSeleccionada.totalProducts || zonaSeleccionada.products?.length || 0} unidades</span>
                </div>
              )}

              {formTiempo !== "" && (
                <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 12 }}>
                  Costo estimado: <b className="mono">${costoDe(formArmadorId || undefined, Number(formTiempo)).toLocaleString("es-CO")}</b>
                  {" "}({(formArmadorId ? armadorById.get(formArmadorId)?.costPerHour : undefined) ?? costoHoraDefault}/hora)
                </div>
              )}

              {formError && <div className="alert warn" style={{ marginBottom: 12 }}><I.alert /> {formError}</div>}

              <button className="btn primary" onClick={handleSaveManual} disabled={saving || zones.length === 0}>
                {saving ? "Guardando…" : "Guardar registro"}
              </button>
            </div>
          </Panel>

          {/* ─── Carga masiva ───────────────────────────────────────── */}
          <Panel title="Carga masiva (Excel)" hint="Zona · Armador · Fecha · Cantidad · Tiempo (min)">
            <div style={{ padding: 16 }}>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleInputChange} />
              <div className="drop">
                <div className="di"><I.upload /></div>
                <h4>{fileName ? fileName : "Sube el Excel con el historial de picking"}</h4>
                <p>{parsing ? "Leyendo archivo…" : "El nombre del armador se compara con el roster de Equipo."}</p>
                <div className="btns">
                  <button className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
                    <I.file /> Seleccionar archivo
                  </button>
                  <button className="btn" onClick={downloadTemplate}>
                    <I.upload style={{ transform: "rotate(180deg)" }} /> Descargar plantilla
                  </button>
                </div>
              </div>

              {parseError && <div className="alert warn" style={{ marginTop: 14 }}><I.alert /> {parseError}</div>}
              {confirmError && <div className="alert warn" style={{ marginTop: 14 }}><I.alert /> {confirmError}</div>}
              {confirmCount != null && (
                <div className="alert" style={{ marginTop: 14, border: "1px solid var(--s-done)", background: "color-mix(in srgb, var(--s-done) 9%, transparent)" }}>
                  <I.check /> Se guardaron {confirmCount} registros de picking.
                </div>
              )}

              {bulkRows.length > 0 && (
                <>
                  <div className="summary-chips">
                    <div className="schip"><div className="n mono">{bulkRows.length}</div><div className="l">Filas reconocidas</div></div>
                    {skippedRows > 0 && (
                      <div className="schip"><div className="n mono" style={{ color: "var(--s-not)" }}>{skippedRows}</div><div className="l">Filas ignoradas (sin zona/cantidad)</div></div>
                    )}
                    {bulkRows.some((r) => !r.zonaValida) && (
                      <div className="schip">
                        <div className="n mono" style={{ color: "var(--s-not)" }}>{bulkRows.filter((r) => !r.zonaValida).length}</div>
                        <div className="l">Zona no encontrada en el sistema</div>
                      </div>
                    )}
                  </div>
                  <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 12 }}>
                    <table className="tbl">
                      <thead>
                        <tr><th>Zona</th><th>Pallet</th><th>Armador</th><th>Fecha</th><th style={{ textAlign: "right" }}>Cant.</th><th style={{ textAlign: "right" }}>Min.</th><th style={{ textAlign: "right" }}>Costo</th></tr>
                      </thead>
                      <tbody>
                        {bulkRows.map((r, i) => (
                          <tr key={i}>
                            <td className="mono">
                              {r.zoneCode}
                              {!r.zonaValida && <span style={{ color: "var(--s-not)", fontSize: 11 }}> (zona no existe)</span>}
                            </td>
                            <td className="mono">{zoneByCode.get(r.zoneCode)?.pallet || "—"}</td>
                            <td>{r.armadorNombre || "—"}{r.armadorNombre && !r.armadorId && <span style={{ color: "var(--s-not)", fontSize: 11 }}> (no encontrado)</span>}</td>
                            <td className="mono">{r.fecha}</td>
                            <td className="mono" style={{ textAlign: "right" }}>{r.cantidad}</td>
                            <td className="mono" style={{ textAlign: "right" }}>{r.tiempoMinutos ?? "—"}</td>
                            <td className="mono" style={{ textAlign: "right" }}>{r.costo ? `$${r.costo.toLocaleString("es-CO")}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="btn primary" onClick={handleConfirmBulk} disabled={confirming}>
                    {confirming ? "Guardando…" : `Confirmar carga de ${bulkRows.length} registros`}
                  </button>
                </>
              )}
            </div>
          </Panel>

          {/* ─── Historial de picking ────────────────────────────────── */}
          <Panel title={`Registros de picking (${pickings.length})`}>
            {loadError && <div className="alert warn"><I.alert /> {loadError}</div>}
            {pickings.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
                Aún no hay registros de picking. Agrega uno arriba o importa un Excel.
              </div>
            ) : (
              <div style={{ maxHeight: 460, overflowY: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Zona</th><th>Armador</th>
                      <th style={{ textAlign: "right" }}>Cant.</th>
                      <th style={{ textAlign: "right" }}>Tiempo</th>
                      <th style={{ textAlign: "right" }}>Costo</th>
                      <th>Fuente</th>
                      <th style={{ textAlign: "right" }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pickings.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.fecha}</td>
                        <td className="mono" style={{ fontWeight: 600 }}>{p.zoneCode}</td>
                        <td>{(p.armadorId && armadorById.get(p.armadorId)?.name) || "—"}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{p.cantidad}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{p.tiempoMinutos ? `${p.tiempoMinutos} min` : "—"}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{p.costo ? `$${p.costo.toLocaleString("es-CO")}` : "—"}</td>
                        <td>
                          <span className="chip" style={{ background: "var(--panel2)", color: "var(--tx)" }}>
                            {p.fuente === "manual" ? "Manual" : "Excel"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn sm" style={{ color: "var(--s-not)" }} onClick={() => handleDelete(p)}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
