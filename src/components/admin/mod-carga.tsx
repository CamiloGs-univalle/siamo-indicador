/**
 * @file components/admin/mod-carga.tsx
 * @description Módulo de carga de datos desde SAP.
 *
 * El administrador sube el Excel de marbetes que se descarga de SAP
 * (una fila por producto, agrupada por zona/pallet). Este módulo:
 *  1. Lee el archivo en el navegador con la librería `xlsx` (sin backend).
 *  2. Normaliza encabezados y arma una vista previa tipada (`SapRow[]`).
 *  3. Al confirmar, agrupa por zona y llama a `importSapData()`, que crea
 *     o actualiza cada zona en Firestore (ID determinístico
 *     `${companyId}_${zona}` → reimportar el mismo Excel actualiza, no duplica).
 *  4. Ofrece una plantilla `.xlsx` descargable con las columnas esperadas.
 */

"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { I } from "@/components/icons";
import { Panel } from "@/components/ui/panel";
import { useAuth } from "@/lib/auth-context";
import { importSapData, ImportSapResult } from "@/lib/firestore";
import { normalizeHeader } from "@/lib/excel-utils";
import { SapRow } from "@/types";

// ─── Columnas esperadas y sus posibles encabezados en el Excel ────────────
// Se normaliza el encabezado (minúsculas, sin tildes) antes de comparar,
// así "Código", "codigo" o "CÓDIGO" apuntan al mismo campo.
const HEADER_MAP: Record<string, keyof SapRow> = {
  zona: "zona",
  codigo: "codigo",
  descripcion: "descripcion",
  cantidad: "cantidad",
  pallet: "pallet",
  ruta: "ruta",
  "ruta/trans": "ruta",
  familia: "familia",
  camion: "camion",
  sector: "sector",
  "fecha de entrega": "fechaEntrega",
  fechaentrega: "fechaEntrega",
  fecha: "fechaEntrega",
  "total pallets": "palletTotal",
  "pallet total": "palletTotal",
  "pallets total": "palletTotal",
  totalpallets: "palletTotal",
};

interface ParsedResult {
  rows: SapRow[];
  skipped: number;
}

/** Convierte las filas crudas del sheet en SapRow[], descartando filas sin zona/código. */
function parseSheetRows(raw: Record<string, unknown>[]): ParsedResult {
  const rows: SapRow[] = [];
  let skipped = 0;

  for (const rawRow of raw) {
    const mapped: Partial<SapRow> = {};
    for (const [key, value] of Object.entries(rawRow)) {
      const field = HEADER_MAP[normalizeHeader(key)];
      if (!field) continue;
      (mapped as Record<string, unknown>)[field] = value;
    }

    const zona = String(mapped.zona ?? "").trim();
    const codigo = String(mapped.codigo ?? "").trim();
    const descripcion = String(mapped.descripcion ?? "").trim();
    const cantidad = Number(mapped.cantidad ?? 0);

    if (!zona || !codigo || !Number.isFinite(cantidad)) {
      skipped++;
      continue;
    }

    const sectorRaw = String(mapped.sector ?? "").trim().toUpperCase();

    rows.push({
      zona,
      codigo,
      descripcion: descripcion || codigo,
      cantidad,
      pallet: mapped.pallet ? String(mapped.pallet).trim() : undefined,
      ruta: mapped.ruta ? String(mapped.ruta).trim() : undefined,
      familia: mapped.familia ? String(mapped.familia).trim() : undefined,
      camion: mapped.camion ? String(mapped.camion).trim() : undefined,
      sector: sectorRaw === "A" || sectorRaw === "B" ? (sectorRaw as "A" | "B") : undefined,
      fechaEntrega: mapped.fechaEntrega ? String(mapped.fechaEntrega).trim() : undefined,
      palletTotal: mapped.palletTotal ? String(mapped.palletTotal).trim() : undefined,
    });
  }

  return { rows, skipped };
}

/** Genera y descarga la plantilla .xlsx con las columnas que espera la carga. */
function downloadTemplate() {
  const headers = ["Zona", "Código", "Descripción", "Cantidad", "Pallet", "Ruta", "Familia", "Camión", "Sector", "Fecha de Entrega", "Total Pallets"];
  const example = ["Z07", "135664", "COCA COLA 1.5LT PET (12)", 8, "003", "KA2P33/402507384", "TBCOL07", "22144", "A", "09.09.2026", "004"];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Marbetes SAP");
  XLSX.writeFile(wb, "plantilla_carga_sap_siamo.xlsx");
}

export function ModCarga() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<SapRow[]>([]);
  const [skippedRows, setSkippedRows] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ImportSapResult | null>(null);

  const zonasUnicas = new Set(rows.map((r) => r.zona)).size;
  const totalUnidades = rows.reduce((acc, r) => acc + (r.cantidad || 0), 0);

  async function handleFile(file: File) {
    setParsing(true);
    setParseError(null);
    setConfirmResult(null);
    setConfirmError(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("El archivo no tiene hojas legibles.");
      const sheet = workbook.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (raw.length === 0) throw new Error("La hoja está vacía.");

      const { rows: parsed, skipped } = parseSheetRows(raw);
      if (parsed.length === 0) {
        throw new Error(
          "No se reconoció ninguna fila válida. Verifica que el Excel tenga columnas Zona, Código, Descripción y Cantidad."
        );
      }
      setRows(parsed);
      setSkippedRows(skipped);
    } catch (err) {
      setRows([]);
      setSkippedRows(0);
      setParseError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setParsing(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ""; // permite volver a elegir el mismo archivo
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleConfirm() {
    if (!user?.companyId || rows.length === 0) return;
    if (!window.confirm("¿Confirmar carga? Las zonas existentes serán actualizadas con los nuevos datos.")) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const result = await importSapData(rows, user.companyId, { uid: user.uid, name: user.name });
      setConfirmResult(result);
      setRows([]);
      setFileName(null);
      setSkippedRows(0);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "No se pudo confirmar la carga.");
    } finally {
      setConfirming(false);
    }
  }

  const noCompany = !user?.companyId;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Importar desde SAP" hint="Excel (.xlsx) · una fila por producto">
        <div style={{ padding: 16 }}>
          {noCompany && (
            <div className="alert warn" style={{ marginBottom: 14 }}>
              <I.alert /> Tu usuario no tiene una empresa asociada, así que la carga no se puede confirmar en este
              modo. Contacta al super administrador.
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
            onChange={handleInputChange}
          />

          <div
            className="drop"
            style={dragOver ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="di"><I.upload /></div>
            <h4>{fileName ? fileName : "Arrastra el Excel de marbetes aquí"}</h4>
            <p>
              {parsing
                ? "Leyendo archivo…"
                : "Zona · Código · Descripción · Cantidad. El QR de cada zona se genera una sola vez."}
            </p>
            <div className="btns">
              <button className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
                <I.file /> Seleccionar archivo
              </button>
              <button className="btn" onClick={downloadTemplate}>
                <I.upload style={{ transform: "rotate(180deg)" }} /> Descargar plantilla
              </button>
            </div>
          </div>

          {parseError && (
            <div className="alert warn" style={{ marginTop: 14 }}>
              <I.alert /> {parseError}
            </div>
          )}

          {confirmError && (
            <div className="alert warn" style={{ marginTop: 14 }}>
              <I.alert /> {confirmError}
            </div>
          )}

          {confirmResult && (
            <div className="summary-chips" style={{ marginTop: 14 }}>
              <div className="schip">
                <div className="n mono" style={{ color: "var(--s-active)" }}>{confirmResult.zonasNuevas.length}</div>
                <div className="l">Zonas nuevas{confirmResult.zonasNuevas.length ? `: ${confirmResult.zonasNuevas.join(", ")}` : ""}</div>
              </div>
              <div className="schip">
                <div className="n mono" style={{ color: "var(--s-done)" }}>{confirmResult.zonasActualizadas.length}</div>
                <div className="l">Zonas actualizadas</div>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="summary-chips">
              <div className="schip"><div className="n mono">{zonasUnicas}</div><div className="l">Zonas del pedido</div></div>
              <div className="schip"><div className="n mono">{rows.length}</div><div className="l">Líneas</div></div>
              <div className="schip"><div className="n mono">{totalUnidades.toLocaleString("es-CO")}</div><div className="l">Unidades</div></div>
              {skippedRows > 0 && (
                <div className="schip"><div className="n mono" style={{ color: "var(--s-not)" }}>{skippedRows}</div><div className="l">Filas ignoradas (sin zona/código)</div></div>
              )}
            </div>
          )}
        </div>
      </Panel>

      {rows.length > 0 && (
        <Panel
          title={`Vista previa — ${rows.length} filas reconocidas`}
          action={
            <button className="btn primary" onClick={handleConfirm} disabled={confirming || noCompany}>
              {confirming ? "Guardando…" : "Confirmar carga"}
            </button>
          }
        >
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: "right" }}>Cantidad</th>
                  <th>Pallet</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontWeight: 600 }}>{r.zona}</td>
                    <td className="mono">{r.codigo}</td>
                    <td>{r.descripcion}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{r.cantidad}</td>
                    <td className="mono">{r.pallet || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
