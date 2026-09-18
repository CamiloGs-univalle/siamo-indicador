/**
 * @file types/index.ts
 * @description Definiciones de tipos TypeScript para el dominio Siamo.Indicador.
 *
 * Modelo de datos A → M → Z:
 * - Armador (A): persona que realiza el picking
 * - Membrete (M): lista de tareas/productos asignados a un armador
 * - Zona (Z): espacio físico donde están los productos
 *
 * Relaciones:
 * - A tiene UN solo M (cada armador tiene un membrete activo)
 * - M está asignado a UNA Z (cada membrete pertenece a una zona)
 * - A sabe a qué Z ir (a través del membrete)
 * - Al escanear en Z, se muestra M y comienza el timer
 */

// ─── Posición en el mapa ──────────────────────────────────────────────────────
export interface Pos {
  x: number;
  y: number;
}

// ─── Zona (espacio físico) ────────────────────────────────────────────────────
// Representa un espacio físico en el almacén (ej: Z07, T1-A-D3).
// Es el LUGAR donde están los productos almacenados.
// Una zona puede tener VARIOS membretes (varios pedidos/palets en el mismo espacio).
export type ZoneLiveStatus = "idle" | "assigned" | "active" | "paused" | "done" | "incident";
export type ZonePriority = "alta" | "media" | "baja";

export interface ZoneProduct {
  codigo: string;
  descripcion: string;
  cantidad: number;
}

export interface Zone {
  id?: string;
  companyId: string;
  /** Código único de la zona (ej. "Z07", "T1-A-D3") */
  code: string;
  /** Sector del almacén (A o B) */
  sector: "A" | "B";
  /** Coordenadas en el mapa del almacén */
  position: Pos;
  /** Estado actual de la zona */
  status: ZoneLiveStatus;
  /** Productos almacenados en esta zona (inventario fijo del SAP) */
  products?: ZoneProduct[];
  totalProducts?: number;
  /** Promedio de minutos históricos para esta zona */
  avgMinutes?: number;
  /** Número de sesiones completadas en esta zona */
  completedSessions?: number;
  /** Nota de incidencia (si aplica) */
  incidentNote?: string;
  incidentClass?: IncidentClass;
  prioridad?: ZonePriority;
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditedAt?: number;
  // ─── Campos deprecated (compatibilidad temporal) ─────────────────────────
  // Estos campos pertenecen al Membrete, no a la Zona.
  // Se mantienen para que el código existente no se rompa.
  // Nueva lógica debe usar Membrete para datos de pedido.
  /** @deprecated Usar Membrete.armadorId */
  armadorId?: string | null;
  /** @deprecated Usar Membrete.ruta */
  ruta?: string;
  /** @deprecated Usar Membrete.pallet */
  pallet?: string;
  /** @deprecated Usar Membrete.palletTotal */
  palletTotal?: string;
  /** @deprecated Usar Membrete.familia */
  familia?: string;
  /** @deprecated Usar Membrete.camion */
  camion?: string;
  /** @deprecated Usar Membrete.fechaEntrega */
  fechaEntrega?: string;
  /** @deprecated Usar Membrete.startedAt */
  startedAt?: number;
  /** @deprecated Usar Membrete.finishedAt */
  finishedAt?: number;
}

// ─── Membrete (tarea de picking / orden de trabajo) ───────────────────────────
// Un membrete es una ORDEN DE PICKING que el armador debe realizar.
// Equivale al papelito físico que se impresa con: Ruta, Pallet, Productos, Cantidades.
//
// Ejemplo real del membrete:
//   Ruta/Trans: KA2P33/402507384
//   Pallet: 003
//   Fecha de Entrega: 09.09.2026
//   Familia: TBCOL07
//   Camión: 22144
//   Productos: COCA COLA 1.5LT (8), QUATRO CHOICE (3), etc.
//
// Flujo:
//   1. Admin sube SAP → se crean zonas (espacios) + membretes (tareas)
//   2. Admin asigna membrete al armador
//   3. Armador va a la ZONA (espacio físico)
//   4. Escanea QR → plataforma muestra el MEMBRETE (su tarea)
//   5. Empieza timer → va pickeando según la lista
//   6. Termina → para timer → se registra duración
export type MembreteStatus = "pending" | "active" | "completed" | "cancelled";
export type MembreteProductStatus = "pending" | "completed" | "incident";

export interface MembreteProduct {
  /** Código del producto (SKU) — ej. "135664" */
  codigo: string;
  /** Descripción del producto — ej. "COCA COLA 1.5LT PET(12) Nvo" */
  descripcion: string;
  /** Cantidad a pickear (del pedido) — ej. 8 */
  cantidad: number;
  /** Cantidad realmente pickeada (se llena durante el picking) */
  cantidadReal?: number;
  /** Estado del producto: pending → completed/incident */
  status?: MembreteProductStatus;
  /** Nota de incidencia (si aplica) */
  incidentNote?: string;
  /** Timestamp cuando se marco como completado */
  completedAt?: number;
}

export interface Membrete {
  id?: string;
  companyId: string;
  /** Código del membrete (ej. "M-Z07-001") */
  code: string;
  // ─── Datos del pedido (del Excel SAP — como en el papelito) ────────────
  /** Ruta/Transporte (ej. "KA2P33/402507384") */
  ruta?: string;
  /** Número de pallet (ej. "003") */
  pallet?: string;
  /** Total de pallets del pedido (ej. "004") — para mostrar "Pallet 003 de 004" */
  palletTotal?: string;
  /** Fecha de entrega (ej. "09.09.2026") */
  fechaEntrega?: string;
  /** Familia de producto (ej. "TBCOL07") */
  familia?: string;
  /** Número de camión (ej. "22144") */
  camion?: string;
  // ─── Relaciones ────────────────────────────────────────────────────────
  /** ID de la zona donde están los productos (ESPACIO FÍSICO) */
  zonaId: string;
  /** Código de la zona (ej. "Z07") — para consultas rápidas */
  zonaCode: string;
  /** ID del armador asignado (nullable — se asigna cuando el admin confirma) */
  armadorId?: string | null;
  /** Nombre del armador (para consultas rápidas) */
  armadorName?: string;
  // ─── Estado y productos ────────────────────────────────────────────────
  /** Estado del membrete */
  status: MembreteStatus;
  /** Lista de productos a pickear */
  products: MembreteProduct[];
  /** Total de productos diferentes */
  totalProducts: number;
  /** Total de unidades a pickear */
  totalUnits: number;
  // ─── Timestamps ────────────────────────────────────────────────────────
  createdAt: number;
  assignedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  pauseMs?: number;
  pauseCount?: number;
  // ─── Auditoría ─────────────────────────────────────────────────────────
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditedAt?: number;
}

// ─── Armador ──────────────────────────────────────────────────────────────────
// Representa a un trabajador que realiza el picking.
// Un armador tiene UN membrete activo a la vez.
export interface Armador {
  id: string;
  companyId: string;
  adminId?: string;
  name: string;
  email?: string;
  /** Cédula de identidad — usada como credencial de login del armador. */
  cedula?: string;
  color: string;
  route?: string[];
  prodH: number;
  cumpl: number;
  inc: number;
  retrab: number;
  index: number;
  trend: string;
  badges: string[];
  /** uid de Firebase Auth vinculado cuando el armador inicia sesión con el correo aquí registrado. */
  authUid?: string;
  /** "claimed" una vez que el armador inició sesión al menos una vez. */
  inviteStatus?: "claimed";
  /** Costo por hora de este armador (moneda de la empresa), para calcular el costo real de cada jornada. */
  costPerHour?: number;
  /** ID del membrete actualmente asignado a este armador (nullable) */
  membreteId?: string | null;
  /** Estado activo del armador (zona actual, sesión, timer) — persistido para sobrevivir recargas. */
  activeSession?: {
    active: boolean;
    currentZoneCode: string;
    membreteId: string;
    sessionId: string;
    zoneIndex: number;
    totalStartedAt: number;
    startedAt: number;
  } | null;
  /**
   * Estado del ciclo de trabajo actual del armador:
   * - undefined/null: sin ciclo activo
   * - "listo": el admin ya asignó y confirmó — el armador puede escanear
   * - "completado": el armador terminó todas sus tareas
   */
  cicloEstado?: "listo" | "activo" | "pausado" | "completado" | null;
  /** IDs de los membretes del último ciclo — para "Repetir ciclo" */
  lastCicloMembreteIds?: string[];
  /** @deprecated Usar membreteId. Se mantiene por compatibilidad temporal. */
  lastCicloZoneIds?: string[];
}

// ─── Sesión de escaneo ────────────────────────────────────────────────────────
export interface ScanSession {
  id?: string;
  zoneCode: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  armadorId: string;
  /** Tiempo total en pausa (milisegundos). El tiempo efectivo es duration - pauseMs. */
  pauseMs?: number;
  /** Numero de pausas tomadas en esta zona. */
  pauseCount?: number;
}

// ─── Incidencia ───────────────────────────────────────────────────────────────
export type IncidentClass = "proceso" | "persona" | "mitigada";

// ─── Picking real ─────────────────────────────────────────────────────────────
// Registro real de lo que se recolectó en una zona: cantidad, tiempo y costo.
// Es la fuente de datos reales para producción/tiempo/costo (mod-picking.tsx),
// distinto de ScanSession (que es solo el cronómetro del recorrido del armador).
export type PickingSource = "manual" | "excel";

export interface PickingRecord {
  id?: string;
  companyId: string;
  zoneCode: string;
  armadorId?: string;
  /** Fecha en formato YYYY-MM-DD. */
  fecha: string;
  cantidad: number;
  tiempoMinutos?: number;
  /** Costo calculado: costPerHour del armador × (tiempoMinutos / 60). */
  costo?: number;
  fuente: PickingSource;
  notas?: string;
  createdAt: number;
  createdBy?: string;
}

// ─── Historial de movimiento (bitácora) ────────────────────────────────────────
// Registro de todo lo que pasa en la operación: asignaciones, escaneos,
// picking, cargas de SAP, altas/bajas de armadores. Es append-only (nunca se
// edita ni se borra) y alimenta tanto el módulo de Historial (mod-historial.tsx)
// como el motor de recomendaciones — la fuente de "qué pasó" para poder medir
// y tomar mejores decisiones.
export type ActivityType =
  | "zone_assigned"
  | "zone_unassigned"
  | "zone_paused"
  | "membrete_created"
  | "membrete_assigned"
  | "membrete_started"
  | "membrete_completed"
  | "membrete_cancelled"
  | "membrete_product_completed"
  | "membrete_product_incident"
  | "scan_started"
  | "scan_finished"
  | "picking_manual"
  | "picking_bulk"
  | "sap_import"
  | "armador_created"
  | "armador_deleted"
  | "cycle_started"
  | "cycle_paused"
  | "cycle_resumed"
  | "cycle_completed";

export interface ActivityLogEntry {
  id?: string;
  companyId: string;
  type: ActivityType;
  /** Descripción lista para mostrar, en español (ej. "Z07 asignada a Juan Torres"). */
  message: string;
  zoneCode?: string;
  armadorId?: string;
  armadorName?: string;
  /** Cantidad relevante según el tipo: unidades pickeadas, zonas importadas, segundos de duración, etc. */
  quantity?: number;
  actorId?: string;
  actorName?: string;
  createdAt: number;
}

// ─── Carga SAP ────────────────────────────────────────────────────────────────
// Una fila del Excel exportado de SAP (un marbete tiene varias filas, una
// por código de producto; todas comparten pallet/ruta/familia/camión).
export interface SapRow {
  zona: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  pallet?: string;
  ruta?: string;
  familia?: string;
  camion?: string;
  sector?: "A" | "B";
  /** "Fecha de Entrega" del marbete físico, tal cual viene de SAP (ej. "09.09.2026"). */
  fechaEntrega?: string;
  /** Total de pallets del pedido (ej. "004"), para mostrar "Pallet 003 de 004" como en el marbete impreso. */
  palletTotal?: string;
}

// ─── Props de componentes ─────────────────────────────────────────────────────
export interface KpiProps {
  lab: string;
  val: string | number;
  unit?: string;
  delta?: string;
  up?: boolean;
  down?: boolean;
  icon?: React.ReactNode;
  accent: string;
  small?: boolean;
}

