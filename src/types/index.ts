/**
 * @file types/index.ts
 * @description Definiciones de tipos TypeScript para el dominio Siamo.Indicador.
 * Modelo de datos centralizado para empresas, zonas, armadores y sesiones.
 */

// ─── Posición en el mapa ──────────────────────────────────────────────────────
export interface Pos {
  x: number;
  y: number;
}

// ─── Armador ──────────────────────────────────────────────────────────────────
export interface Armador {
  id: string;
  companyId: string;
  adminId?: string;
  name: string;
  email?: string;
  sector: "A" | "B";
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
  /** Estado activo del armador (zona actual, sesión, timer) — persistido para sobrevivir recargas. */
  activeSession?: {
    active: boolean;
    currentZoneCode: string;
    sessionId: string;
    zoneIndex: number;
    totalStartedAt: number;
    startedAt: number;
  } | null;
  /**
   * Estado del ciclo de trabajo actual del armador:
   * - undefined/null: sin ciclo activo (el admin todavia esta armando la
   *   asignacion, o el armador no tiene nada asignado). El armador NO puede
   *   iniciar su recorrido aunque ya tenga zonas asignadas -- espera a que
   *   el admin de click en "Listo".
   * - "listo": el admin ya asigno zonas y confirmo -- el armador puede
   *   escanear e iniciar su recorrido.
   * - "completado": el armador termino todas sus zonas asignadas. En este
   *   momento el servidor ya le quito todas las zonas (Zone.armadorId) --
   *   el admin debe iniciar un ciclo nuevo ("Repetir ciclo" o "Nuevo ciclo")
   *   para que el armador vuelva a tener trabajo.
   */
  cicloEstado?: "listo" | "completado" | null;
  /** Ids de las zonas que tenia asignadas cuando termino su ultimo ciclo -- para que "Repetir ciclo" las vuelva a asignar con un clic. */
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
  | "scan_started"
  | "scan_finished"
  | "picking_manual"
  | "picking_bulk"
  | "sap_import"
  | "armador_created"
  | "armador_deleted"
  | "cycle_started"
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

// ─── Zona real (Firestore) ─────────────────────────────────────────────────────
// Esquema real que usan firestore.ts y los módulos conectados a la base de
// datos (Equipo, Mapa en vivo, Carga SAP).
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
  code: string;
  sector: "A" | "B";
  position: Pos;
  status: ZoneLiveStatus;
  armadorId?: string | null;
  pallet?: string;
  ruta?: string;
  familia?: string;
  camion?: string;
  /** "Fecha de Entrega" del marbete físico (ej. "09.09.2026"). */
  fechaEntrega?: string;
  /** Total de pallets del pedido, para mostrar "Pallet 003 de 004" como en el marbete impreso. */
  palletTotal?: string;
  products?: ZoneProduct[];
  totalProducts?: number;
  startedAt?: number;
  finishedAt?: number;
  avgMinutes?: number;
  completedSessions?: number;
  incidentNote?: string;
  incidentClass?: IncidentClass;
  prioridad?: ZonePriority;
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditedAt?: number;
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

