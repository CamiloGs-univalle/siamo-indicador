/**
 * @file components/admin/mod-picking.tsx
 * @description Módulo "Picking" — captura de datos reales de producción.
 *
 * A diferencia de ScanSession (que solo mide el recorrido del armador por el
 * QR de cada zona), aquí se registra lo que realmente se recolectó: cantidad,
 * tiempo y costo por zona/armador/fecha. Es la fuente de "datos reales" que
 * el administrador pidió para poder ver producción en tiempo, en costo y
 * mantener un historial — a mano (una zona a la vez) o de forma masiva
 * (importando un Excel), ambas guardadas en la misma colección `pickings`.
 *
 * El costo de cada registro se calcula con el costo por hora del armador
 * (Armador.costPerHour); si el armador no tiene uno propio, se usa el costo
 * por hora por defecto configurado en el módulo de Configuración
 * (Company.costoHoraDefault).
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { I } from "@/components/icons";
import { Panel } from "@/components/ui/panel";
import { useAuth } from "@/lib/auth-context";
import { normalizeHeader } from "@/lib/excel-utils";
import {
  getZones,
  getArmadores,
  getCompany,
  getPickings,
  createPickingRecord,
  bulkCreatePickingRecords,
  deletePickingRecord,
} from "@/lib/firestore";
import type { Zone, Armador, PickingRecord } from "@/types";

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

interface BulkRow {
  zoneCode: string;
  /** false si zoneCode no coincide con ninguna zona real de la empresa (posible error de tipeo en el Excel). */
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

export function ModPicking() {
  const { user } = useAuth();
  const companyId = user?.companyId;

  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [costoHoraDefault, setCostoHoraDefault] = useState(0);
  const [pickings, setPickings] = useState<PickingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ─── Formulario manual ──────────────────────────────────────────────────
  const [formZona, setFormZona] = useState("");
  const [formArmadorId, setFormArmadorId] = useState("");
  const [formFecha, setFormFecha] = useState(todayISO());
  const [formCantidad, setFormCantidad] = useState<number | "">("");
  const [formTiempo, setFormTiempo] = useState<number | "">("");
  const [formNotas, setFormNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ─── Carga masiva (Excel) ───────────────────────────────────────────────
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
      setLoadError(err instanceof Error ? err.message : "No se pudo cargar la información de picking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (companyId) loadAll(companyId);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const armadorById = useMemo(() => new Map(armadores.map((a) => [a.id, a])), [armadores]);
  const zoneByCode = useMemo(() => new Map(zones.map((z) => [z.code, z])), [zones]);
  const zonaSeleccionada = formZona ? zoneByCode.get(formZona) : undefined;

  function costoDe(armadorId: string | undefined, tiempoMinutos: number | undefined): number {
    if (!tiempoMinutos) return 0;
    const rate = (armadorId ? armadorById.get(armadorId)?.costPerHour : undefined) ?? costoHoraDefault;
    return Math.round(rate * (tiempoMinutos / 60) * 100) / 100;
  }

  // ─── Guardar registro manual ────────────────────────────────────────────
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

  // ─── Carga masiva: parseo del Excel ─────────────────────────────────────
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
    const warning = invalidas > 0 ? `\n\n${invalidas} fila(s) tienen una zona que no existe en el sistema — se guardarán igual, pero revisa si fue un error de tipeo.` : "";
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

  // ─── Resumen: datos reales de producción, tiempo y costo ───────────────
  const totalCantidad = pickings.reduce((acc, p) => acc + (p.cantidad || 0), 0);
  const totalCosto = pickings.reduce((acc, p) => acc + (p.costo || 0), 0);
  const totalMinutos = pickings.reduce((acc, p) => acc + (p.tiempoMinutos || 0), 0);
  const prodPorHora = totalMinutos > 0 ? Math.round((totalCantidad / (totalMinutos / 60)) * 10) / 10 : 0;

  const noCompany = !companyId;

  if (noCompany) {
    return (
      <div className="panel">
        <div style={{ padding: 16 }}>
          <div className="alert warn">
            <I.alert /> Tu usuario no tiene una empresa asociada, así que el picking no se puede registrar en este modo.
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
      {/* ─── Resumen de datos reales ─────────────────────────────── */}
      <div className="summary-chips">
        <div className="schip"><div className="n mono">{pickings.length}</div><div className="l">Registros de picking</div></div>
        <div className="schip"><div className="n mono">{totalCantidad.toLocaleString("es-CO")}</div><div className="l">Unidades recolectadas</div></div>
        <div className="schip"><div className="n mono">{prodPorHora || "—"}</div><div className="l">Producción real (uds/hora)</div></div>
        <div className="schip"><div className="n mono">${totalCosto.toLocaleString("es-CO", { maximumFractionDigits: 0 })}</div><div className="l">Costo total de mano de obra</div></div>
      </div>

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

      {/* ─── Historial ───────────────────────────────────────────── */}
      <Panel title={`Historial de picking (${pickings.length})`}>
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
  );
}
