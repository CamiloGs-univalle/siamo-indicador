/**
 * @file lib/warehouse-layout.ts
 * @description Layout fisico real de la bodega (Tuneles 1 y 2).
 * Generado a partir del Excel "Layout tuneles Cali2.xlsx.xlsm".
 * Cada posicion fisica (D1, D2, ...) tiene sus coordenadas en el mapa.
 *
 * Tuneles: 2 tuneles de armado, cada uno con 2 lados (A/B o Izq/Der),
 * posiciones D1-D12+ separadas por pasillos.
 */

export type TunnelSide = "A" | "B";
export type TunnelId = 1 | 2;

export interface TunnelPosition {
  /** Codigo visual en el mapa, ej. "T1-D3" */
  code: string;
  /** Tunnel number */
  tunnel: TunnelId;
  /** Lado del tunel */
  side: TunnelSide;
  /** Posicion fisica (D1, D2, ...) */
  position: string;
  /** Coordenada X en el mapa (unidades arbitrarias) */
  x: number;
  /** Coordenada Y en el mapa (unidades arbitrarias) */
  y: number;
  /** Ancho de la celda */
  w: number;
  /** Alto de la celda */
  h: number;
}

const CELL_W = 120;
const CELL_H = 72;
const PASS_H = 30; // altura del pasillo
const SIDE_GAP = 60; // separacion entre lados

function tunnelPositions(
  tunnel: TunnelId,
  side: TunnelSide,
  startY: number,
  xBase: number,
): TunnelPosition[] {
  const positions: TunnelPosition[] = [];
  const sideOffset = side === "B" ? CELL_H + PASS_H : 0;

  for (let i = 1; i <= 12; i++) {
    const y = startY + sideOffset + (i - 1) * (CELL_H + 4);
    positions.push({
      code: `T${tunnel}-${side}-D${i}`,
      tunnel,
      side,
      position: `D${i}`,
      x: xBase,
      y,
      w: CELL_W,
      h: CELL_H,
    });
  }
  return positions;
}

/**
 * Genera las posiciones del tunel 1 (Lados A y B, D1-D12).
 * Tunel 1: columnas iniciales en x=20
 */
export function tunnel1Layout(): TunnelPosition[] {
  const xA = 20;
  const xB = 20 + CELL_W + SIDE_GAP;
  const startY = 20;
  return [
    ...tunnelPositions(1, "A", startY, xA),
    ...tunnelPositions(1, "B", startY, xB),
  ];
}

/**
 * Genera las posiciones del tunel 2 (Lados Izquierdo/Derecho, D1-D12).
 * Tunel 2: despues del tunel 1 con separacion
 */
export function tunnel2Layout(): TunnelPosition[] {
  const xA = 20 + 2 * (CELL_W + SIDE_GAP) + 80; // separacion entre tuneles
  const xB = xA + CELL_W + SIDE_GAP;
  const startY = 20;
  return [
    ...tunnelPositions(2, "A", startY, xA),
    ...tunnelPositions(2, "B", startY, xB),
  ];
}

/**
 * Layout completo: ambos tuneles combinados.
 */
export function fullWarehouseLayout(): TunnelPosition[] {
  return [...tunnel1Layout(), ...tunnel2Layout()];
}

/**
 * Mapea un codigo de zona (ej. "gVmsANoC4vApIGRw7sWL_Z01") a una posicion
 * del tunel basandose en el sector y el indice.
 *
 * Esto es un mapping por defecto — el admin puede reorganizar manualmente
 * las posiciones en el mapa despues.
 */
export function mapZoneToTunnelPosition(
  zoneCode: string,
  sector: string,
  zoneIndex: number,
  totalZones: number,
): { x: number; y: number } {
  const layout = fullWarehouseLayout();
  const tunnelId: TunnelId = sector === "A" ? 1 : 2;
  const side: TunnelSide = "A";

  // Posiciones disponibles para este tunel/lado
  const available = layout.filter((p) => p.tunnel === tunnelId && p.side === side);
  const posIdx = Math.min(zoneIndex, available.length - 1);
  const pos = available[posIdx];

  if (pos) return { x: pos.x, y: pos.y };

  // Fallback: grid automatica
  const col = zoneIndex % 5;
  const row = Math.floor(zoneIndex / 5);
  return { x: 20 + col * (CELL_W + 16), y: 20 + row * (CELL_H + 16) };
}

/**
 * Layout optimizado para mapa del armador (un solo tunel, un solo lado).
 * Muestra solo las zonas del tunel asignado al armador.
 */
export function armadorLayout(
  armadorZones: Array<{ code: string; sector: string }>,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};

  // Separar por sector
  const sectorA = armadorZones.filter((z) => z.sector === "A");
  const sectorB = armadorZones.filter((z) => z.sector === "B");

  // Tunel 1, Lado A: zonas de sector A
  sectorA.forEach((z, i) => {
    const y = 20 + i * (CELL_H + 4);
    positions[z.code] = { x: 20, y };
  });

  // Tunel 1, Lado B: zonas de sector B
  sectorB.forEach((z, i) => {
    const y = 20 + i * (CELL_H + 4);
    positions[z.code] = { x: 20 + CELL_W + SIDE_GAP, y };
  });

  return positions;
}
