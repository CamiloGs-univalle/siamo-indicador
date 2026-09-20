/**
 * @file lib/excel-utils.ts
 * @description Utilidades compartidas para leer Excel de origen externo
 * (SAP, picking). Antes normalizeHeader estaba copiado y pegado igual en
 * mod-carga.tsx y mod-picking.tsx — ahora vive en un solo lugar.
 */

/** "Código", "codigo", "CÓDIGO" → "codigo": minúsculas, sin tildes, recortado. */
export function normalizeHeader(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
