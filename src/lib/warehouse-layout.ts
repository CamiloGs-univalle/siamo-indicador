/**
 * @file lib/warehouse-layout.ts
 * @description Layout fisico REAL de la bodega de Cali.
 * Datos extraidos del Excel "Layout tuneles Cali2.xlsx.xlsm" (ACTUALIZADO JUL2026).
 *
 * Estructura del CD Cali:
 * ─────────────────────────────────────────────────────────────────────────────
 * TUNEL 1 (OW - Order Picking):
 *   • 2 Niveles: Lado A (8 posiciones) + Lado B (7-8 posiciones)
 *   • 3 Niveles: Lado A (8 posiciones) + Lado B (8 posiciones)
 *   • Productos: TETRA, FUZE, VALLEFRUT, C.C., BRISA, MANANTIAL
 *
 * TUNEL 2 (RET - Retornable):
 *   • 2 Niveles: Lado A (8 posiciones) + Lado B (7-8 posiciones)
 *   • 3 Niveles: Lado A (8 posiciones) + Lado B (8 posiciones)
 *   • Productos: RETORNABLE FAMILIAR, PERSONAL, MULTIPACKS
 *
 * Buffers de Cargue: ANDEN 1, 2, 3 + PICK'N
 * Tipos de Almacenamiento: PISO ONE WAY, RACKS DRIVE IN, SELECTIVAS,
 *                          PUSH BACK, DOUBLE DEEP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada posicion tiene: codigo fisico, SKU, productos, tipo (TUNEL/CELULA/PASILLO),
 * y coordenadas en el mapa.
 *
 * NOTA (sept. 2026): estas coordenadas ya NO se usan como fondo visual del
 * mapa — el fondo real es `@/lib/warehouse-floorplan`, que recrea el plano
 * físico completo de la bodega (no solo los túneles de picking). Este
 * archivo sigue siendo la fuente de datos de SKU/producto por posición de
 * túnel (usada por `findBySku`/`findByProduct`/tooltips de posición) y de la
 * posición de "aterrizaje" por defecto de una zona nueva sin posición guardada
 * — ver `mapZoneToWarehousePosition`, que ahora delega en
 * `defaultZoneSpot()` del plano real en lugar de estas coordenadas de Excel.
 *
 * @see public/layout-tuneles-cali.json - Resumen del layout en JSON
 */

import { defaultZoneSpot } from "./warehouse-floorplan";

export type PositionType = "TUNEL" | "CELULA" | "PASILLO" | "CF";
export type TunnelSide = "A" | "B";
export type TunnelId = 1 | 2;

export interface WarehousePosition {
  /** Codigo visual: "T1-A-D1", "T2-B-I3", etc. */
  code: string;
  /** Tunel 1 o 2 */
  tunnel: TunnelId;
  /** Lado del tunel */
  side: TunnelSide;
  /** Posicion fisica: D1, D2, I1, I2, etc. */
  position: string;
  /** Tipo de ubicacion */
  type: PositionType;
  /** SKU principal (columna B en Excel) */
  sku: string | null;
  /** Productos principales de esta posicion */
  products: string[];
  /** Todos los productos posibles (incluye variantes) */
  allProducts: string[];
  /** Coordenada X en el mapa */
  x: number;
  /** Coordenada Y en el mapa */
  y: number;
  /** Ancho de la celda */
  w: number;
  /** Alto de la celda */
  h: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIMENSIONES DEL MAPA
// ═══════════════════════════════════════════════════════════════════════════════

const CELL_W = 120;
const CELL_H = 72;
const PASS_H = 28;
const SIDE_GAP = 40;
const TUNNEL_GAP = 80;

// ═══════════════════════════════════════════════════════════════════════════════
// TUNEL 1 — LADO A (Sector A)
// Datos reales del Excel TUNEL1
// ═══════════════════════════════════════════════════════════════════════════════

const TUNEL1_A: WarehousePosition[] = [
  { code: "T1-A-D1",  tunnel: 1, side: "A", position: "D1",  type: "TUNEL",  sku: "6002",  products: ["CC 1.5LTS ESPEJO"], allProducts: ["CC 1.5LTS ESPEJO"], x: 20, y: 20, w: CELL_W, h: CELL_H },
  { code: "T1-A-D2",  tunnel: 1, side: "A", position: "D2",  type: "TUNEL",  sku: "60021", products: ["CC 1.5LTS (39)"], allProducts: ["CC 1.5LTS (39)"], x: 20, y: 20 + (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T1-A-PA1", tunnel: 1, side: "A", position: "PA1", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20, y: 20 + 2 * (CELL_H + PASS_H), w: CELL_W, h: PASS_H },
  { code: "T1-A-D3",  tunnel: 1, side: "A", position: "D3",  type: "CELULA", sku: "2476", products: ["MANDARINA 1.5"], allProducts: ["MANDARINA 1.5", "GINGER 1.5 LTS", "SODA 1.5 LTS"], x: 20, y: 20 + 2 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-A-D4",  tunnel: 1, side: "A", position: "D4",  type: "TUNEL",  sku: "2473", products: ["FRESH CITRUS 1.5 LTS"], allProducts: ["FRESH CITRUS 1.5 LTS"], x: 20, y: 20 + 3 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-A-D5",  tunnel: 1, side: "A", position: "D5",  type: "TUNEL",  sku: "1008", products: ["CC SA 1.5LTS"], allProducts: ["CC SA 1.5LTS"], x: 20, y: 20 + 4 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-A-D6",  tunnel: 1, side: "A", position: "D6",  type: "TUNEL",  sku: "2479", products: ["CC SO 2.5 LTS"], allProducts: ["CC SO 2.5 LTS"], x: 20, y: 20 + 5 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-A-D7",  tunnel: 1, side: "A", position: "D7",  type: "TUNEL",  sku: "2487", products: ["FRESH CITRUS 2.5 LTS"], allProducts: ["FRESH CITRUS 2.5 LTS"], x: 20, y: 20 + 6 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-A-D8",  tunnel: 1, side: "A", position: "D8",  type: "TUNEL",  sku: "7426", products: ["CC SO 1 LT"], allProducts: ["CC SO 1 LT"], x: 20, y: 20 + 7 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-A-D9",  tunnel: 1, side: "A", position: "D9",  type: "CELULA", sku: "2489", products: ["CC SO 3 LTS"], allProducts: ["CC SO 3 LTS"], x: 20, y: 20 + 8 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-A-PA2", tunnel: 1, side: "A", position: "PA2", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20, y: 20 + 9 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: PASS_H },
  { code: "T1-A-D10", tunnel: 1, side: "A", position: "D10", type: "CELULA", sku: "2490", products: ["AGUA BRISA ECOFLEX 1 LT"], allProducts: ["AGUA BRISA ECOFLEX 1 LT"], x: 20, y: 20 + 9 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-A-D11", tunnel: 1, side: "A", position: "D11", type: "TUNEL",  sku: "2495", products: ["MANANTIAL GAS 600ML"], allProducts: ["MANANTIAL GAS 600ML"], x: 20, y: 20 + 10 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-A-D12", tunnel: 1, side: "A", position: "D12", type: "TUNEL",  sku: "2742", products: ["MANANTIAL 600ML"], allProducts: ["MANANTIAL 600ML"], x: 20, y: 20 + 11 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-A-D13", tunnel: 1, side: "A", position: "D13", type: "TUNEL",  sku: "2819", products: ["BRISA 600ML"], allProducts: ["BRISA 600ML"], x: 20, y: 20 + 12 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-A-D14", tunnel: 1, side: "A", position: "D14", type: "TUNEL",  sku: "3527", products: ["BRISA GAS 600ML"], allProducts: ["BRISA GAS 600ML"], x: 20, y: 20 + 13 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-A-D15", tunnel: 1, side: "A", position: "D15", type: "TUNEL",  sku: "3528", products: ["CC SO 20ONZ"], allProducts: ["CC SO 20ONZ"], x: 20, y: 20 + 14 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-A-D16", tunnel: 1, side: "A", position: "D16", type: "TUNEL",  sku: "3529", products: ["CC SA 20ONZ"], allProducts: ["CC SA 20ONZ"], x: 20, y: 20 + 15 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-A-D17", tunnel: 1, side: "A", position: "D17", type: "TUNEL",  sku: "3530", products: ["MANANTIAL GAS VID 300ML"], allProducts: ["MANANTIAL GAS VID 300ML"], x: 20, y: 20 + 16 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TUNEL 1 — LADO B (Sector B)
// ═══════════════════════════════════════════════════════════════════════════════

const TUNEL1_B: WarehousePosition[] = [
  { code: "T1-B-I1",  tunnel: 1, side: "B", position: "I1",  type: "TUNEL",  sku: "1004", products: ["CC 1.5LTS (65)"], allProducts: ["CC 1.5LTS (65)"], x: 20 + CELL_W + SIDE_GAP, y: 20, w: CELL_W, h: CELL_H },
  { code: "T1-B-I2",  tunnel: 1, side: "B", position: "I2",  type: "TUNEL",  sku: "6001", products: ["CC 1.5LTS (26)"], allProducts: ["CC 1.5LTS (26)"], x: 20 + CELL_W + SIDE_GAP, y: 20 + (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T1-B-I3",  tunnel: 1, side: "B", position: "I3",  type: "TUNEL",  sku: "1003", products: ["PREMIO 1.5LTS"], allProducts: ["PREMIO 1.5LTS"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 2 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T1-B-I4",  tunnel: 1, side: "B", position: "I4",  type: "TUNEL",  sku: "3001", products: ["QUATRO 1.5 LTS"], allProducts: ["QUATRO 1.5 LTS"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 3 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T1-B-I5",  tunnel: 1, side: "B", position: "I5",  type: "TUNEL",  sku: "2473", products: ["SPRITE 1.5LTS"], allProducts: ["SPRITE 1.5LTS"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 4 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T1-B-I6",  tunnel: 1, side: "B", position: "I6",  type: "CELULA", sku: "1005", products: ["KOLA ROMAN 1.5 LTS"], allProducts: ["KOLA ROMAN 1.5 LTS", "BRISA GAS LIMON 1.5 LTS", "BRISA GAS MANZANA 1.5 LTS", "BRISA MARACUYA 1.5 LTS"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 5 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T1-B-PB1", tunnel: 1, side: "B", position: "PB1", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + CELL_W + SIDE_GAP, y: 20 + 6 * (CELL_H + PASS_H), w: CELL_W, h: PASS_H },
  { code: "T1-B-I7",  tunnel: 1, side: "B", position: "I7",  type: "CELULA", sku: "1007", products: ["QUATRO SA 1.5LTS"], allProducts: ["QUATRO SA 1.5LTS", "KOLA ROMAN SA 1.5 LTS", "GINGER SA 1.5LTS", "SPRITE SA 1.5 LTS", "KOLA ROMAN 1.75LTS"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 6 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-B-I8",  tunnel: 1, side: "B", position: "I8",  type: "TUNEL",  sku: "2489", products: ["CC SO 3LTS (30)"], allProducts: ["CC SO 3LTS (30)"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 7 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-B-I9",  tunnel: 1, side: "B", position: "I9",  type: "CELULA", sku: "1009", products: ["SPRITE 3 LTS"], allProducts: ["SPRITE 3 LTS", "QUATRO 3 LTS", "PREMIO FTA 3 LTS", "AGUA BRISA 3 LTS", "MANANTIAL 1LIT"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 8 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T1-B-PB2", tunnel: 1, side: "B", position: "PB2", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + CELL_W + SIDE_GAP, y: 20 + 9 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: PASS_H },
  { code: "T1-B-I10", tunnel: 1, side: "B", position: "I10", type: "CELULA", sku: "2518", products: ["FUZE TEA LIMON 1.2 LTS"], allProducts: ["FUZE TEA LIMON 1.2 LTS", "FUZE TEA DURAZNO 1.2 LTS", "FRUTAL 1LTS MANGO", "FRUTAL 1LTS MGNFRESA", "FRUTAL 1LTS MORA"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 9 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-B-I11", tunnel: 1, side: "B", position: "I11", type: "TUNEL",  sku: "2029", products: ["BRISA GAS 600ML"], allProducts: ["BRISA GAS 600ML"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 10 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-B-I12", tunnel: 1, side: "B", position: "I12", type: "TUNEL",  sku: "5029", products: ["BRISA 600ML"], allProducts: ["BRISA 600ML"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 11 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-B-I13", tunnel: 1, side: "B", position: "I13", type: "CELULA", sku: "5352", products: ["BRISA GAS LIMON 600ML"], allProducts: ["BRISA GAS LIMON 600ML", "BRISA GAS MANZANA 600ML", "BRISA GAS MARACUYA 600ML"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 12 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T1-B-PB3", tunnel: 1, side: "B", position: "PB3", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + CELL_W + SIDE_GAP, y: 20 + 13 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: PASS_H },
  { code: "T1-B-I14", tunnel: 1, side: "B", position: "I14", type: "TUNEL",  sku: "1031", products: ["TETRA MORA 188ML"], allProducts: ["TETRA MORA 188ML", "TETRA PINA MDNA 188ML", "TETRA MANGO 188ML", "TETRA MANGO FRESA 188ML", "TETRA SALPICON 188"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 13 * (CELL_H + PASS_H) + 3 * PASS_H + 12, w: CELL_W, h: CELL_H },
  { code: "T1-B-I15", tunnel: 1, side: "B", position: "I15", type: "TUNEL",  sku: "7824", products: ["MANANTIAL 500ML VID"], allProducts: ["MANANTIAL 500ML VID"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 14 * (CELL_H + PASS_H) + 3 * PASS_H + 12, w: CELL_W, h: CELL_H },
  { code: "T1-B-I16", tunnel: 1, side: "B", position: "I16", type: "TUNEL",  sku: "1014", products: ["MANANTIAL 300ML VID"], allProducts: ["MANANTIAL 300ML VID"], x: 20 + CELL_W + SIDE_GAP, y: 20 + 15 * (CELL_H + PASS_H) + 3 * PASS_H + 12, w: CELL_W, h: CELL_H },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TUNEL 2 — LADO IZQUIERDO (Sector A)
// ═══════════════════════════════════════════════════════════════════════════════

const TUNEL2_IZQ: WarehousePosition[] = [
  { code: "T2-A-D2",  tunnel: 2, side: "A", position: "D2",  type: "TUNEL",  sku: "7834", products: ["PREMIO ROJO 400 PET"], allProducts: ["PREMIO ROJO 400 PET"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20, w: CELL_W, h: CELL_H },
  { code: "T2-A-D3",  tunnel: 2, side: "A", position: "D3",  type: "TUNEL",  sku: "1041", products: ["CCSO 400 PET"], allProducts: ["CCSO 400 PET"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 4 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T2-A-D4",  tunnel: 2, side: "A", position: "D4",  type: "TUNEL",  sku: "1040", products: ["QUATRO 400 PET"], allProducts: ["QUATRO 400 PET"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 8 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T2-A-D5",  tunnel: 2, side: "A", position: "D5",  type: "TUNEL",  sku: "1042", products: ["POWER FT", "POWER MB"], allProducts: ["POWER FT", "POWER MB", "MAND 400ML", "KOLA ROMAN 400ML"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 12 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T2-A-PA1", tunnel: 2, side: "A", position: "PA1", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 16 * (CELL_H + PASS_H), w: CELL_W, h: PASS_H },
  { code: "T2-A-D6",  tunnel: 2, side: "A", position: "D6",  type: "TUNEL",  sku: "1043", products: ["FRUTAL SALPICON 500ML"], allProducts: ["FRUTAL SALPICON 500ML", "FRUTAL PINA MANDARINA 500ML", "FRUTAL MORA 500ML", "FRUTAL MANGO FRESA 500ML", "FRUTAL MANGO 500ML"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 16 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T2-A-D7",  tunnel: 2, side: "A", position: "D7",  type: "TUNEL",  sku: "1044", products: ["SPRITE 250ML"], allProducts: ["SPRITE 250ML", "SODA 400ML", "CCSA 400ML", "PREMIO ROJO 400 PET"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 17 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T2-A-PA2", tunnel: 2, side: "A", position: "PA2", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 18 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: PASS_H },
  { code: "T2-A-D8",  tunnel: 2, side: "A", position: "D8",  type: "TUNEL",  sku: "1245", products: [], allProducts: [], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 18 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T2-A-D9",  tunnel: 2, side: "A", position: "D9",  type: "TUNEL",  sku: "2491", products: ["CCSA 235ML"], allProducts: ["CCSA 235ML", "LATA BRISA MZNA 235ML", "LATA QUATRO 235"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 19 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T2-A-PA3", tunnel: 2, side: "A", position: "PA3", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 20 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: PASS_H },
  { code: "T2-A-D10", tunnel: 2, side: "A", position: "D10", type: "TUNEL",  sku: "3216", products: ["FANTA LATA ROJO 235"], allProducts: ["FANTA LATA ROJO 235", "FANTA NARANJA 235", "KOLA ROMAN 250", "QUATRO 250", "SPRITE 250"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 20 * (CELL_H + PASS_H) + 3 * PASS_H + 12, w: CELL_W, h: CELL_H },
  { code: "T2-A-D11", tunnel: 2, side: "A", position: "D11", type: "TUNEL",  sku: "3319", products: ["CCSO 250"], allProducts: ["CCSO 250"], x: 20 + 2 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 21 * (CELL_H + PASS_H) + 3 * PASS_H + 12, w: CELL_W, h: CELL_H },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TUNEL 2 — LADO DERECHO (Sector B)
// ═══════════════════════════════════════════════════════════════════════════════

const TUNEL2_DER: WarehousePosition[] = [
  { code: "T2-B-I2",  tunnel: 2, side: "B", position: "I2",  type: "TUNEL",  sku: "3247", products: ["CC SA 400ML"], allProducts: ["CC SA 400ML"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20, w: CELL_W, h: CELL_H },
  { code: "T2-B-I3",  tunnel: 2, side: "B", position: "I3",  type: "TUNEL",  sku: "5892", products: ["FRESH CITRUS 400ML"], allProducts: ["FRESH CITRUS 400ML"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 4 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T2-B-I4",  tunnel: 2, side: "B", position: "I4",  type: "TUNEL",  sku: "4225", products: ["CC SO 400ML (112)"], allProducts: ["CC SO 400ML (112)"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 8 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T2-B-PB1", tunnel: 2, side: "B", position: "PB1", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 12 * (CELL_H + PASS_H), w: CELL_W, h: PASS_H },
  { code: "T2-B-I6",  tunnel: 2, side: "B", position: "I6",  type: "TUNEL",  sku: "1040", products: ["SPRITE 400ML"], allProducts: ["SPRITE 400ML", "SODA 400", "SPITE 400"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 16 * (CELL_H + PASS_H), w: CELL_W, h: CELL_H },
  { code: "T2-B-I7",  tunnel: 2, side: "B", position: "I7",  type: "TUNEL",  sku: "9135", products: ["CCSO 400"], allProducts: ["CCSO 400"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 17 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T2-B-I8",  tunnel: 2, side: "B", position: "I8",  type: "CELULA", sku: "1936", products: ["CCSA 10ONZ"], allProducts: ["CCSA 10ONZ", "GINGER 10 ONZ", "SODA 10 ONZ", "TONICA 10 ONZ", "CCSO 10 ONZ"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 18 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: CELL_H },
  { code: "T2-B-PB2", tunnel: 2, side: "B", position: "PB2", type: "PASILLO", sku: null, products: [], allProducts: [], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 19 * (CELL_H + PASS_H) + PASS_H + 4, w: CELL_W, h: PASS_H },
  { code: "T2-B-I9",  tunnel: 2, side: "B", position: "I9",  type: "TUNEL",  sku: "1237", products: [], allProducts: [], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 19 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T2-B-I10", tunnel: 2, side: "B", position: "I10", type: "TUNEL",  sku: null, products: [], allProducts: [], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 20 * (CELL_H + PASS_H) + 2 * PASS_H + 8, w: CELL_W, h: CELL_H },
  { code: "T2-B-I11", tunnel: 2, side: "B", position: "I11", type: "TUNEL",  sku: "6229", products: ["CCSO LATA 330"], allProducts: ["CCSO LATA 330"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 21 * (CELL_H + PASS_H) + 3 * PASS_H + 12, w: CELL_W, h: CELL_H },
  { code: "T2-B-I12", tunnel: 2, side: "B", position: "I12", type: "TUNEL",  sku: "4222", products: ["BRISA PET 280"], allProducts: ["BRISA PET 280"], x: 20 + 3 * (CELL_W + SIDE_GAP) + TUNNEL_GAP, y: 20 + 22 * (CELL_H + PASS_H) + 3 * PASS_H + 12, w: CELL_W, h: CELL_H },
];

// ═══════════════════════════════════════════════════════════════════════════════
// RESUMEN DEL LAYOUT (JSON)
// ═══════════════════════════════════════════════════════════════════════════════

export interface TunnelSummary {
  id: string;
  name: string;
  levels: number;
  type: string;
  sides: {
    A: { positions: number; rows: Array<{ row: number; positions: number }> };
    B: { positions: number; rows: Array<{ row: number; positions: number }> };
  };
}

export interface WarehouseLayoutSummary {
  name: string;
  location: string;
  tunnels: TunnelSummary[];
  buffers: string[];
  storageTypes: string[];
  zones: Array<{
    id: string;
    name: string;
    type: string;
    tunnel?: number;
    side?: string;
    andock?: number;
  }>;
  products: string[];
}

/**
 * Resumen del layout del CD Cali (carga desde JSON estatico).
 * Incluye: tuneles, niveles, productos, tipos de almacenamiento, zonas.
 */
export function getWarehouseLayoutSummary(): WarehouseLayoutSummary {
  return {
    name: "Layout Tuneles Cali",
    location: "Centro de Distribución Cali",
    tunnels: [
      {
        id: "TUNEL_1_2NIV",
        name: "Túnel 1",
        levels: 2,
        type: "OW (Order Picking)",
        sides: {
          A: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 8 })) },
          B: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 7 })) },
        },
      },
      {
        id: "TUNEL_1_3NIV",
        name: "Túnel 1",
        levels: 3,
        type: "OW (Order Picking)",
        sides: {
          A: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 8 })) },
          B: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 7 })) },
        },
      },
      {
        id: "TUNEL_2_2NIV",
        name: "Túnel 2",
        levels: 2,
        type: "RET (Retornable)",
        sides: {
          A: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 8 })) },
          B: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 7 })) },
        },
      },
      {
        id: "TUNEL_2_3NIV",
        name: "Túnel 2",
        levels: 3,
        type: "RET (Retornable)",
        sides: {
          A: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 8 })) },
          B: { positions: 8, rows: Array.from({ length: 10 }, (_, i) => ({ row: i + 2, positions: 8 })) },
        },
      },
    ],
    buffers: ["ANDEN 1", "PICK'N", "ANDEN 2", "ANDEN 3"],
    storageTypes: [
      "PISO ONE WAY TIPO A",
      "PISO ONE WAY TIPO B Y C",
      "RACKS DRIVE IN TIPO B Y C",
      "RACKS DRIVE IN MULTIPACKS",
      "SELECTIVAS TIPO C",
      "PUSH BACK TIPO B Y C",
      "RACKS DOUBLE DEEP",
    ],
    zones: [
      { id: "Z01", name: "Túnel 1 - Lado A", type: "tunnel", tunnel: 1, side: "A" },
      { id: "Z02", name: "Túnel 1 - Lado B", type: "tunnel", tunnel: 1, side: "B" },
      { id: "Z03", name: "Túnel 2 - Lado A", type: "tunnel", tunnel: 2, side: "A" },
      { id: "Z04", name: "Túnel 2 - Lado B", type: "tunnel", tunnel: 2, side: "B" },
      { id: "Z05", name: "Buffer Andén 1", type: "buffer", andock: 1 },
      { id: "Z06", name: "Buffer Andén 2", type: "buffer", andock: 2 },
      { id: "Z07", name: "Buffer Andén 3", type: "buffer", andock: 3 },
      { id: "Z08", name: "Puesto Verificación", type: "verification" },
      { id: "Z09", name: "Pulmón", type: "storage" },
      { id: "Z10", name: "Pista Armado Múltiple", type: "assembly" },
    ],
    products: [
      "BRISA 600", "BRISA GAS",
      "C.C. 1.5 PET", "C.C. 1.75 PET", "C.C. 20 oz PET",
      "FUZE DURAZNO 400", "FUZE MANZANA 400", "FUZE TEA LIMON",
      "MANANTIAL 600", "MANANTIAL GAS",
      "TETRA", "TETRA FUZE", "TETRA MANDARINA", "TETRA NARANJA",
      "VALLEFRUT 300",
    ],
  };
}

/**
 * Obtiene los productos de un tunel especifico.
 */
export function getTunnelProducts(tunnel: TunnelId): string[] {
  const layout = getWarehouseLayoutSummary();
  const tunnelData = layout.tunnels.find((t) => t.name === `Túnel ${tunnel}`);
  if (!tunnelData) return [];

  // Productos por tunel basado en el Excel
  if (tunnel === 1) {
    return ["CC 1.5LTS", "CC SA 1.5LTS", "CC SO", "MANDARINA 1.5", "FRESH CITRUS",
            "BRISA 600ML", "BRISA GAS", "MANANTIAL", "TETRA", "FUZE"];
  }
  return ["RETORNABLE FAMILIAR", "RETORNABLE PERSONAL", "MULTIPACKS",
          "CC 400ML", "SPRITE 400ML", "FRUTAL 500ML", "POWER"];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNCIONES PUBLICAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Layout completo de la bodega (todos los tuneles y lados).
 */
export function fullWarehouseLayout(): WarehousePosition[] {
  return [...TUNEL1_A, ...TUNEL1_B, ...TUNEL2_IZQ, ...TUNEL2_DER];
}

/**
 * Posiciones de un tunel especifico.
 */
export function tunnelLayout(tunnel: TunnelId): WarehousePosition[] {
  return fullWarehouseLayout().filter((p) => p.tunnel === tunnel);
}

/**
 * Posiciones de un lado especifico.
 */
export function sideLayout(tunnel: TunnelId, side: TunnelSide): WarehousePosition[] {
  return fullWarehouseLayout().filter((p) => p.tunnel === tunnel && p.side === side);
}

/**
 * Busca una posicion por su codigo fisico (ej. "D1", "I6").
 * Retorna la primera coincidencia (el Tunel 1 tiene prioridad).
 */
export function findByPosition(position: string): WarehousePosition | undefined {
  return fullWarehouseLayout().find((p) => p.position === position);
}

/**
 * Busca posiciones por SKU.
 */
export function findBySku(sku: string): WarehousePosition[] {
  return fullWarehouseLayout().filter((p) => p.sku === sku);
}

/**
 * Busca posiciones que contengan un producto por nombre (busqueda parcial).
 */
export function findByProduct(query: string): WarehousePosition[] {
  const q = query.toLowerCase();
  return fullWarehouseLayout().filter((p) =>
    p.allProducts.some((prod) => prod.toLowerCase().includes(q)) ||
    p.products.some((prod) => prod.toLowerCase().includes(q))
  );
}

/**
 * Posición de "aterrizaje" por defecto para una zona de Siamo que todavía no
 * tiene una posición propia guardada en Firestore (zone.position === undefined
 * o {0,0}). Antes se calculaba a partir de las coordenadas de picking del
 * Excel de Cali (TUNEL1_A/TUNEL1_B, siempre devolviendo Tunel 1 sin importar
 * el sector — ver ERRORES.md) — ahora delega en `defaultZoneSpot()` del plano
 * real (`@/lib/warehouse-floorplan`), que ubica la zona nueva dentro del
 * Túnel de Armado que le corresponde según su sector (A → Túnel de Armado 1,
 * B → Túnel de Armado 2), que son las áreas físicas reales donde se arma.
 *
 * El administrador siempre puede arrastrar la zona a su posición exacta
 * después — esto solo evita que una zona nueva aparezca en un punto
 * arbitrario del plano antes de esa primera ubicación manual.
 */
export function mapZoneToWarehousePosition(
  sector: "A" | "B",
  zoneIndex: number,
): { x: number; y: number; tunnel: TunnelId; side: TunnelSide; position: string } {
  const spot = defaultZoneSpot(sector, zoneIndex);
  return {
    x: spot.x,
    y: spot.y,
    tunnel: sector === "A" ? 1 : 2,
    side: sector,
    position: `AR${zoneIndex + 1}`,
  };
}

/**
 * Tooltip content para una posicion del tunel.
 * Muestra SKU, productos y tipo de ubicacion.
 */
export function positionTooltip(pos: WarehousePosition): string {
  const lines = [
    `${pos.code}`,
    `Tipo: ${pos.type}`,
    pos.sku ? `SKU: ${pos.sku}` : null,
    ...pos.products.map((p) => `• ${p}`),
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Colores por tipo de posicion.
 */
export function positionTypeColor(type: PositionType): string {
  switch (type) {
    case "TUNEL": return "var(--accent)";
    case "CELULA": return "var(--s-done)";
    case "PASILLO": return "var(--faint)";
    case "CF": return "var(--s-paused)";
    default: return "var(--faint)";
  }
}

/**
 * Labels por tipo de posicion.
 */
export function positionTypeLabel(type: PositionType): string {
  switch (type) {
    case "TUNEL": return "Tunel";
    case "CELULA": return "Celula";
    case "PASILLO": return "Pasillo";
    case "CF": return "CF";
    default: return type;
  }
}
