/**
 * @file lib/warehouse-floorplan.ts
 * @description Plano REAL de la bodega (CD), recreado a partir del layout físico
 * entregado por el cliente ("mapa de la zona"). Este archivo reemplaza, como
 * fondo visual del mapa, al antiguo grid abstracto de posiciones de túnel de
 * `warehouse-layout.ts` — ahora el fondo del mapa se ve como el edificio real
 * (zonas de carga, túneles de armado, racks, líneas de producción, zonas de
 * no conformes, etc.), no como una cuadrícula genérica.
 *
 * Es un plano ESTÁTICO y de solo lectura: se dibuja detrás de las fichas de
 * zona (que sí son arrastrables y sí vienen de Firestore). El administrador
 * arrastra cada ficha de zona sobre este plano hasta la posición real que le
 * corresponde — el plano le da la referencia visual para hacerlo bien.
 *
 * Las coordenadas son aproximadas (reconstruidas a partir del plano entregado,
 * no son un plano CAD a escala): el objetivo es que el conjunto se "sienta"
 * igual al espacio real — mismas zonas, mismos nombres, mismas posiciones
 * relativas — no un calco pixel-perfecto.
 */

export type FloorplanBlockKind =
  | "charge"    // Zona de carga de equipos eléctricos
  | "rack"      // Racks / piso de almacenamiento genérico (numerados 1-14)
  | "bay"       // Piso one way (bahías tipo B/C, tipo A)
  | "assembly"  // Túneles y pistas de armado
  | "sugar"     // Almacenamiento de azúcar
  | "office"    // Oficina de operaciones / puestos de verificación
  | "buffer"    // Pulmón
  | "nc"        // Zonas de producto no conforme (ZNC)
  | "line"      // Líneas de producción / accesos
  | "hazard";   // Franja de seguridad (separador peatonal/vehicular)

export interface FloorplanBlock {
  id: string;
  /** Texto a mostrar dentro del bloque. "" para bloques puramente decorativos. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: FloorplanBlockKind;
}

/** Tamaño total del plano (coordenadas en las mismas unidades que las fichas de zona). */
export const WAREHOUSE_FLOORPLAN_SIZE = { width: 1190, height: 940 };

/**
 * Leyenda numerada del plano — corresponde exactamente a la tabla de 17
 * ítems del plano físico entregado por el cliente.
 */
export const WAREHOUSE_FLOORPLAN_LEGEND: Array<{ num: number; label: string }> = [
  { num: 1, label: "Producto y envase retornable familiar" },
  { num: 2, label: "Envase no conforme y estibas vacías" },
  { num: 3, label: "Piso one way tipo B y C" },
  { num: 4, label: "Racks drive in tipo B y C" },
  { num: 5, label: "Racks drive in tipo B y C" },
  { num: 6, label: "Producto retornable personal" },
  { num: 7, label: "Envase retornable personal" },
  { num: 8, label: "Selectivas tipo C" },
  { num: 9, label: "Racks drive in tipo B y C" },
  { num: 10, label: "Piso one way tipo A línea 3" },
  { num: 11, label: "Racks drive in multipacks" },
  { num: 12, label: "Push back tipo B y C" },
  { num: 13, label: "Drive in tipo B y C" },
  { num: 14, label: "Racks double deep" },
  { num: 15, label: "Almacenamiento azúcar" },
  { num: 16, label: "Pista de armado múltiple (bot, ret y mulpacks)" },
  { num: 17, label: "Túneles de almacenamiento y armado 1 y 2" },
];

/**
 * Bloques del plano físico. Ver el número de cada bloque en su `label`
 * (coincide con `WAREHOUSE_FLOORPLAN_LEGEND`) para ubicarlo en la leyenda.
 */
export const WAREHOUSE_FLOORPLAN_BLOCKS: FloorplanBlock[] = [
  // ── Franja izquierda: carga de equipos, envases y producto retornable ──
  { id: "chg", label: "Zona de carga de\nequipos eléctricos", x: 24, y: 60, w: 86, h: 420, kind: "charge" },
  { id: "z2", label: "2", x: 24, y: 490, w: 86, h: 130, kind: "rack" },
  { id: "z1", label: "1", x: 24, y: 630, w: 86, h: 160, kind: "rack" },
  { id: "linea1", label: "Línea 1", x: 24, y: 800, w: 270, h: 140, kind: "line" },

  // ── Fila superior: bahías de piso one way (3) ──
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `bay3-${i}`,
    label: i === 4 ? "3" : "",
    x: 130 + i * 50,
    y: 64,
    w: 42,
    h: 170,
    kind: "bay" as const,
  })),

  { id: "vtm", label: "Armado VTM", x: 660, y: 64, w: 140, h: 110, kind: "assembly" },
  { id: "z15", label: "15 · Azúcar", x: 810, y: 64, w: 90, h: 110, kind: "sugar" },

  { id: "verif1", label: "Puesto de\nverificación", x: 170, y: 250, w: 110, h: 50, kind: "office" },
  { id: "verif2", label: "Puesto de\nverificación", x: 430, y: 250, w: 110, h: 50, kind: "office" },

  // ── Túneles de armado (17) ──
  { id: "tunel2", label: "Túnel de Armado 2 · 17", x: 130, y: 370, w: 210, h: 150, kind: "assembly" },
  { id: "tunel1", label: "Túnel de Armado 1 · 17", x: 360, y: 370, w: 210, h: 150, kind: "assembly" },
  { id: "z5", label: "5", x: 130, y: 530, w: 210, h: 40, kind: "rack" },
  { id: "z10a", label: "10", x: 590, y: 370, w: 100, h: 150, kind: "bay" },
  { id: "z16", label: "16 · Armado\nofertas", x: 700, y: 460, w: 100, h: 60, kind: "assembly" },
  { id: "z9", label: "9", x: 700, y: 530, w: 100, h: 40, kind: "rack" },

  // ── Oficina, ZNC y columna derecha (racks 12/13/14, pulmón) ──
  { id: "oficina", label: "Oficina\nOperaciones", x: 815, y: 250, w: 100, h: 140, kind: "office" },
  { id: "znc-c", label: "ZNC C · 11", x: 815, y: 400, w: 100, h: 50, kind: "nc" },
  { id: "znc-b", label: "ZNC B · 11", x: 815, y: 580, w: 100, h: 40, kind: "nc" },

  { id: "z13", label: "13", x: 930, y: 250, w: 60, h: 90, kind: "rack" },
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `z12-${i}`,
    label: i === 1 ? "12" : "",
    x: 930,
    y: 350 + i * 45,
    w: 150,
    h: 38,
    kind: "rack" as const,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `z14-${i}`,
    label: i === 2 ? "14" : "",
    x: 1010,
    y: 64 + i * 40,
    w: 70,
    h: 34,
    kind: "rack" as const,
  })),
  { id: "pulmon", label: "Pulmón", x: 1100, y: 64, w: 90, h: 90, kind: "buffer" },

  // ── Banda media: racks 3/4, selectivas 8, retornable personal 6/7 ──
  { id: "z4", label: "4", x: 130, y: 580, w: 150, h: 38, kind: "rack" },
  { id: "z3", label: "3", x: 130, y: 626, w: 150, h: 38, kind: "rack" },
  { id: "z8a", label: "8", x: 300, y: 580, w: 110, h: 170, kind: "rack" },
  { id: "z8b", label: "8", x: 430, y: 580, w: 110, h: 170, kind: "rack" },
  { id: "z6", label: "6", x: 300, y: 760, w: 110, h: 60, kind: "rack" },
  { id: "z7", label: "7", x: 430, y: 760, w: 110, h: 60, kind: "rack" },
  { id: "linea3a", label: "Línea 3", x: 550, y: 580, w: 70, h: 170, kind: "line" },

  ...Array.from({ length: 3 }, (_, i) => ({
    id: `z11-${i}`,
    label: i === 1 ? "11" : "",
    x: 815,
    y: 630 + i * 42,
    w: 60,
    h: 36,
    kind: "rack" as const,
  })),
  { id: "linea-brisa", label: "Línea Brisa", x: 930, y: 580, w: 180, h: 60, kind: "line" },
  { id: "zona-nc", label: "Zona producto\nno conforme", x: 930, y: 650, w: 180, h: 60, kind: "nc" },

  // ── Banda inferior: líneas de producción y accesos ──
  { id: "linea2", label: "Línea 2", x: 340, y: 850, w: 190, h: 90, kind: "line" },
  { id: "linea3b", label: "Línea 3", x: 560, y: 850, w: 190, h: 90, kind: "line" },
  { id: "zona-nc-a", label: "Zona no\nconforme A", x: 815, y: 800, w: 100, h: 90, kind: "nc" },
  { id: "superpack", label: "Acceso\nSuperpack", x: 930, y: 800, w: 100, h: 90, kind: "line" },

  // ── Franjas de seguridad (separador peatonal/vehicular) ──
  { id: "hz1", label: "", x: 120, y: 236, w: 520, h: 8, kind: "hazard" },
  { id: "hz2", label: "", x: 120, y: 308, w: 520, h: 8, kind: "hazard" },
];

/**
 * Área de "aterrizaje" por defecto para una zona nueva sin posición guardada
 * (antes de que el administrador la arrastre a su lugar exacto): sector A
 * cae dentro del Túnel de Armado 1, sector B dentro del Túnel de Armado 2 —
 * son las dos áreas reales de armado del plano, así que una zona nueva
 * aparece siempre cerca de donde físicamente se trabaja, nunca en un punto
 * arbitrario del plano.
 */
const STAGING_AREA: Record<"A" | "B", { x: number; y: number; w: number; h: number }> = {
  A: { x: 360, y: 370, w: 210, h: 150 }, // Túnel de Armado 1
  B: { x: 130, y: 370, w: 210, h: 150 }, // Túnel de Armado 2
};

const STAGING_TILE_W = 128;
const STAGING_TILE_H = 80;

export function defaultZoneSpot(sector: "A" | "B", index: number): { x: number; y: number } {
  const area = STAGING_AREA[sector] ?? STAGING_AREA.A;
  const cols = Math.max(1, Math.floor(area.w / STAGING_TILE_W));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: area.x + col * STAGING_TILE_W,
    y: area.y + row * STAGING_TILE_H,
  };
}

/** Color de fondo por tipo de bloque (usa las variables de tema existentes). */
export function floorplanBlockColor(kind: FloorplanBlockKind): { bg: string; border: string; text: string } {
  switch (kind) {
    case "charge":
      return { bg: "#2f6fed", border: "#1d4fbf", text: "#fff" };
    case "assembly":
      return { bg: "#c9a876", border: "#a9885c", text: "#3a2c14" };
    case "sugar":
      return { bg: "#d8c49a", border: "#b39c6d", text: "#3a2c14" };
    case "bay":
      return { bg: "#efe7d8", border: "#c0392b", text: "#5c4326" };
    case "office":
      return { bg: "#ffffff", border: "#8a8f98", text: "#333" };
    case "buffer":
      return { bg: "#dfe3e8", border: "#8a8f98", text: "#333" };
    case "nc":
      return { bg: "#ffffff", border: "#c0392b", text: "#8a2c22" };
    case "line":
      return { bg: "#ffffff", border: "#8a8f98", text: "#333" };
    case "hazard":
      return { bg: "hazard", border: "transparent", text: "transparent" };
    case "rack":
    default:
      return { bg: "#8a8f98", border: "#6b7078", text: "#fff" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZONAS REALES DEL PLANO (import a Firestore)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Lo de arriba (`WAREHOUSE_FLOORPLAN_BLOCKS`) es solo dibujo de fondo. Esto de
// aquí es la lista de zonas REALES que ese plano representa — cada una se
// convierte en un documento `Zone` de verdad en Firestore (mismo tipo, mismas
// reglas, misma lógica de estado/asignación que cualquier otra zona del
// sistema), con el `code`, `sector` y el tamaño/posición real de esa área
// física. Así cada recuadro del plano deja de ser decoración y pasa a ser una
// zona con la que se puede trabajar: asignarle un membrete, verla cambiar de
// color según su estado, aparecer en "Zonas" y en "Asignación", etc.
//
// Los recuadros puramente repetidos que en el plano físico son UNA sola área
// dibujada como varios segmentos (la fila de 10 bahías del ítem "3", los 3
// tramos de push back del ítem "12", los 6 estantes del ítem "14", los 3
// tramos de racks multipacks del ítem "11") se representan aquí como UNA sola
// zona por área (el rectángulo que las contiene a todas) — igual que en la
// bodega real, donde esa fila completa es un solo espacio de trabajo, no
// varias zonas independientes. Las franjas de seguridad (`hazard`) no son un
// espacio de trabajo, así que no generan zona.
//
// El código de estas zonas usa un prefijo claramente distinto ("RACK-",
// nombres descriptivos) para NO chocar con los códigos que ya pueda tener
// una empresa de su carga SAP habitual (tipo "Z07").

export interface FloorplanZoneSeed {
  code: string;
  name: string;
  sector: "A" | "B";
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WAREHOUSE_FLOORPLAN_ZONE_SEEDS: FloorplanZoneSeed[] = [
  { code: "CARGA-ELECTRICOS", name: "Zona de carga de equipos eléctricos", sector: "A", x: 24, y: 60, w: 86, h: 420 },
  { code: "RACK-02", name: "Envase no conforme y estibas vacías", sector: "A", x: 24, y: 490, w: 86, h: 130 },
  { code: "RACK-01", name: "Producto y envase retornable familiar", sector: "A", x: 24, y: 630, w: 86, h: 160 },
  { code: "LINEA-1", name: "Línea 1", sector: "A", x: 24, y: 800, w: 270, h: 140 },

  { code: "RACK-03A", name: "Piso one way tipo B y C (fila superior)", sector: "A", x: 130, y: 64, w: 492, h: 170 },
  { code: "ARMADO-VTM", name: "Armado VTM", sector: "A", x: 660, y: 64, w: 140, h: 110 },
  { code: "AZUCAR-15", name: "Almacenamiento azúcar", sector: "B", x: 810, y: 64, w: 90, h: 110 },

  { code: "VERIFICACION-1", name: "Puesto de verificación", sector: "A", x: 170, y: 250, w: 110, h: 50 },
  { code: "VERIFICACION-2", name: "Puesto de verificación", sector: "A", x: 430, y: 250, w: 110, h: 50 },

  { code: "TUNEL-ARMADO-2", name: "Túnel de Armado 2", sector: "B", x: 130, y: 370, w: 210, h: 150 },
  { code: "TUNEL-ARMADO-1", name: "Túnel de Armado 1", sector: "A", x: 360, y: 370, w: 210, h: 150 },
  { code: "RACK-05", name: "Racks drive in tipo B y C", sector: "B", x: 130, y: 530, w: 210, h: 40 },
  { code: "RACK-10", name: "Piso one way tipo A línea 3", sector: "A", x: 590, y: 370, w: 100, h: 150 },
  { code: "ARMADO-OFERTAS", name: "Armado ofertas (pista de armado múltiple)", sector: "A", x: 700, y: 460, w: 100, h: 60 },
  { code: "RACK-09", name: "Racks drive in tipo B y C", sector: "A", x: 700, y: 530, w: 100, h: 40 },

  { code: "OFICINA-OPERACIONES", name: "Oficina de Operaciones", sector: "B", x: 815, y: 250, w: 100, h: 140 },
  { code: "ZNC-C", name: "Zona no conforme C", sector: "B", x: 815, y: 400, w: 100, h: 50 },
  { code: "ZNC-B", name: "Zona no conforme B", sector: "B", x: 815, y: 580, w: 100, h: 40 },

  { code: "RACK-13", name: "Drive in tipo B y C", sector: "B", x: 930, y: 250, w: 60, h: 90 },
  { code: "RACK-12", name: "Push back tipo B y C", sector: "B", x: 930, y: 350, w: 150, h: 128 },
  { code: "RACK-14", name: "Racks double deep", sector: "B", x: 1010, y: 64, w: 70, h: 234 },
  { code: "PULMON", name: "Pulmón", sector: "B", x: 1100, y: 64, w: 90, h: 90 },

  { code: "RACK-04", name: "Racks drive in tipo B y C", sector: "B", x: 130, y: 580, w: 150, h: 38 },
  { code: "RACK-03B", name: "Piso one way tipo B y C", sector: "B", x: 130, y: 626, w: 150, h: 38 },
  { code: "RACK-08A", name: "Selectivas tipo C", sector: "A", x: 300, y: 580, w: 110, h: 170 },
  { code: "RACK-08B", name: "Selectivas tipo C", sector: "A", x: 430, y: 580, w: 110, h: 170 },
  { code: "RACK-06", name: "Producto retornable personal", sector: "A", x: 300, y: 760, w: 110, h: 60 },
  { code: "RACK-07", name: "Envase retornable personal", sector: "A", x: 430, y: 760, w: 110, h: 60 },
  { code: "LINEA-3A", name: "Línea 3", sector: "A", x: 550, y: 580, w: 70, h: 170 },

  { code: "RACK-11", name: "Racks drive in multipacks", sector: "B", x: 815, y: 630, w: 60, h: 120 },
  { code: "LINEA-BRISA", name: "Línea Brisa", sector: "B", x: 930, y: 580, w: 180, h: 60 },
  { code: "ZONA-NC-GENERAL", name: "Zona producto no conforme", sector: "B", x: 930, y: 650, w: 180, h: 60 },

  { code: "LINEA-2", name: "Línea 2", sector: "A", x: 340, y: 850, w: 190, h: 90 },
  { code: "LINEA-3B", name: "Línea 3", sector: "A", x: 560, y: 850, w: 190, h: 90 },
  { code: "ZONA-NC-A", name: "Zona no conforme A", sector: "B", x: 815, y: 800, w: 100, h: 90 },
  { code: "ACCESO-SUPERPACK", name: "Acceso Superpack", sector: "B", x: 930, y: 800, w: 100, h: 90 },
];

/**
 * Convierte la lista de zonas del plano real en documentos `Zone` listos
 * para crear en Firestore (usada por `importWarehouseFloorplanZones` en
 * `@/lib/firestore`). No incluye `id` — Firestore lo asigna al crear.
 */
export function buildFloorplanZoneDocs(companyId: string): Array<{
  companyId: string;
  code: string;
  name: string;
  sector: "A" | "B";
  position: { x: number; y: number };
  w: number;
  h: number;
  status: "idle";
  prioridad: "media";
  products: never[];
}> {
  return WAREHOUSE_FLOORPLAN_ZONE_SEEDS.map((z) => ({
    companyId,
    code: z.code,
    name: z.name,
    sector: z.sector,
    position: { x: z.x, y: z.y },
    w: z.w,
    h: z.h,
    status: "idle" as const,
    prioridad: "media" as const,
    products: [],
  }));
}
