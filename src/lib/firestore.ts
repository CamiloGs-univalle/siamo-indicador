import { auth, db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { AppUser, UserRole } from "./auth-context";
import { Zone, ZoneProduct, Armador, ScanSession, SapRow, PickingRecord, ActivityLogEntry } from "@/types";

// ==================== ARMADOR SESSION STATE ====================
// Persiste el estado activo del armador (zona actual, sesión, timer)
// para que al recargar la página se restaure el progreso.

export interface ArmadorSessionState {
  active: boolean;
  currentZoneCode: string;
  sessionId: string;
  zoneIndex: number;
  totalStartedAt: number;
  startedAt: number;
}

export async function saveArmadorSessionState(
  armadorId: string,
  state: ArmadorSessionState | null
): Promise<void> {
  await updateDoc(doc(db, "armadores", armadorId), {
    activeSession: state,
  });
}

export async function getArmadorSessionState(
  armadorId: string
): Promise<ArmadorSessionState | null> {
  const snap = await getDoc(doc(db, "armadores", armadorId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return (data.activeSession as ArmadorSessionState) || null;
}

// ==================== USERS ====================

export async function getUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() } as AppUser;
}

export async function getUsersByRole(role: UserRole): Promise<AppUser[]> {
  const q = query(collection(db, "users"), where("role", "==", role));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as AppUser));
}

export async function updateUser(uid: string, data: Partial<AppUser>) {
  await updateDoc(doc(db, "users", uid), data);
}

// ==================== ACTIVITY LOG (bitácora de movimiento) ====================
// Registro append-only de todo lo que pasa en la operación: asignaciones,
// escaneos, picking, cargas de SAP, altas/bajas de armadores. Alimenta el
// módulo de Historial y su motor de recomendaciones — es la fuente real de
// "qué pasó" que antes no existía en ningún lado de la app.

/**
 * Registra un evento. Se traga los errores (ej. sin conexión): un fallo al
 * escribir la bitácora nunca debe tumbar la operación principal que la llama.
 */
async function logActivity(entry: Omit<ActivityLogEntry, "id">): Promise<void> {
  try {
    const ref = doc(collection(db, "activity"));
    await setDoc(ref, entry);
  } catch (error) {
    console.error("logActivity error:", error);
  }
}

export async function getActivity(companyId: string, max = 300): Promise<ActivityLogEntry[]> {
  const q = query(collection(db, "activity"), where("companyId", "==", companyId));
  const snap = await getDocs(q);
  const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLogEntry));
  entries.sort((a, b) => b.createdAt - a.createdAt);
  return entries.slice(0, max);
}

/** Suscripción en tiempo real a la bitácora, para un feed que se actualiza solo. */
export function subscribeActivity(companyId: string, cb: (entries: ActivityLogEntry[]) => void, max = 300): Unsubscribe {
  const q = query(collection(db, "activity"), where("companyId", "==", companyId));
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLogEntry));
      entries.sort((a, b) => b.createdAt - a.createdAt);
      cb(entries.slice(0, max));
    },
    (error) => console.error("subscribeActivity error:", error)
  );
}

// ==================== ZONES ====================

export async function getZones(companyId: string): Promise<Zone[]> {
  const q = query(
    collection(db, "zones"),
    where("companyId", "==", companyId)
  );
  const snap = await getDocs(q);
  const zones = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Zone));
  zones.sort((a, b) => a.code.localeCompare(b.code));
  return zones;
}

/**
 * Suscripción en tiempo real a las zonas de una empresa (Firestore onSnapshot).
 * A diferencia de getZones (una sola lectura), esta función llama a `cb` cada
 * vez que algo cambia en la colección — así el módulo de mapa ("Operación en
 * tiempo real") de verdad refleja cambios en vivo, sin recargar la página.
 * Devuelve la función de unsubscribe: llámala al desmontar el componente.
 */
export function subscribeZones(companyId: string, cb: (zones: Zone[]) => void): Unsubscribe {
  const q = query(collection(db, "zones"), where("companyId", "==", companyId));
  return onSnapshot(
    q,
    (snap) => {
      const zones = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Zone));
      zones.sort((a, b) => a.code.localeCompare(b.code));
      cb(zones);
    },
    (error) => console.error("subscribeZones error:", error)
  );
}

export async function getZonesBySector(companyId: string, sector: string): Promise<Zone[]> {
  const q = query(
    collection(db, "zones"),
    where("companyId", "==", companyId),
    where("sector", "==", sector)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Zone));
}

export async function createZone(zone: Omit<Zone, "id">) {
  const ref = doc(collection(db, "zones"));
  await setDoc(ref, zone);
  return ref.id;
}

/**
 * Actualiza una zona y deja constancia de quién y cuándo la editó por
 * última vez (lastEditedBy/lastEditedByName/lastEditedAt) — así el mapa
 * puede mostrar "Z07 reubicada por Camilo Andrade · hace 2 min".
 */
export async function updateZone(
  zoneId: string,
  data: Partial<Zone>,
  editor?: { uid: string; name: string }
) {
  const payload: Partial<Zone> = { ...data };
  if (editor) {
    payload.lastEditedBy = editor.uid;
    payload.lastEditedByName = editor.name;
    payload.lastEditedAt = Date.now();
  }
  await updateDoc(doc(db, "zones", zoneId), payload);
}

export async function deleteZone(zoneId: string) {
  await deleteDoc(doc(db, "zones", zoneId));
}

export async function bulkCreateZones(zones: Omit<Zone, "id">[]) {
  const batch = writeBatch(db);
  zones.forEach((zone) => {
    const ref = doc(collection(db, "zones"));
    batch.set(ref, zone);
  });
  await batch.commit();
}

/**
 * Asigna una zona a un armador y deja constancia en la bitácora — reemplaza
 * la llamada directa a updateZone() que usaba mod-asignacion.tsx, que asignaba
 * la zona pero no dejaba ningún rastro de "quién se la dio a quién y cuándo".
 */
export async function assignZone(
  zoneId: string,
  zoneCode: string,
  companyId: string,
  armador: { id: string; name: string },
  editor?: { uid: string; name: string }
) {
  await updateZone(zoneId, { armadorId: armador.id, status: "assigned" }, editor);
  await logActivity({
    companyId,
    type: "zone_assigned",
    message: `${zoneCode} asignada a ${armador.name}`,
    zoneCode,
    armadorId: armador.id,
    armadorName: armador.name,
    actorId: editor?.uid,
    actorName: editor?.name,
    createdAt: Date.now(),
  });
}

/** Quita la asignación de una zona y deja constancia en la bitácora. */
export async function unassignZone(
  zoneId: string,
  zoneCode: string,
  companyId: string,
  previousArmador: { id: string; name: string } | undefined,
  editor?: { uid: string; name: string }
) {
  await updateZone(zoneId, { armadorId: null, status: "idle" }, editor);
  await logActivity({
    companyId,
    type: "zone_unassigned",
    message: previousArmador ? `${zoneCode} se quitó de ${previousArmador.name}` : `${zoneCode} quedó sin asignar`,
    zoneCode,
    armadorId: previousArmador?.id,
    armadorName: previousArmador?.name,
    actorId: editor?.uid,
    actorName: editor?.name,
    createdAt: Date.now(),
  });
}

// ==================== ARMADORES ====================

export async function getArmadores(companyId: string): Promise<Armador[]> {
  const q = query(
    collection(db, "armadores"),
    where("companyId", "==", companyId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Armador));
}

/**
 * Suscripción en tiempo real al roster de armadores de una empresa
 * (Firestore onSnapshot) — mismo propósito que subscribeZones.
 */
export function subscribeArmadores(companyId: string, cb: (armadores: Armador[]) => void): Unsubscribe {
  const q = query(collection(db, "armadores"), where("companyId", "==", companyId));
  return onSnapshot(
    q,
    (snap) => {
      const armadores = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Armador));
      cb(armadores);
    },
    (error) => console.error("subscribeArmadores error:", error)
  );
}

export async function getArmadoresByAdmin(adminId: string): Promise<Armador[]> {
  const q = query(collection(db, "armadores"), where("adminId", "==", adminId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Armador));
}

export async function createArmador(armador: Omit<Armador, "id">) {
  const ref = doc(collection(db, "armadores"));
  await setDoc(ref, armador);
  await logActivity({
    companyId: armador.companyId,
    type: "armador_created",
    message: `${armador.name} se agregó al equipo`,
    armadorId: ref.id,
    armadorName: armador.name,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function updateArmador(id: string, data: Partial<Armador>) {
  await updateDoc(doc(db, "armadores", id), data);
}

/** Elimina un armador. `context` es opcional para no romper llamadas viejas, pero sin él no queda rastro en la bitácora. */
export async function deleteArmador(id: string, context?: { companyId: string; name: string }) {
  await deleteDoc(doc(db, "armadores", id));
  if (context) {
    await logActivity({
      companyId: context.companyId,
      type: "armador_deleted",
      message: `${context.name} se eliminó del equipo`,
      armadorId: id,
      armadorName: context.name,
      createdAt: Date.now(),
    });
  }
}

// ==================== SESSIONS ====================
// ScanSession mide el recorrido del armador por el QR de cada zona (cuándo
// empezó y cuándo terminó cada una) — es, junto con PickingRecord, la otra
// mitad del historial real de movimiento de la operación.

export async function getScanSessions(armadorId: string, date: string): Promise<ScanSession[]> {
  const q = query(
    collection(db, "sessions"),
    where("armadorId", "==", armadorId),
    where("date", "==", date)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScanSession));
}

export async function createScanSession(
  session: Omit<ScanSession, "id">,
  context?: { companyId: string }
) {
  const ref = doc(collection(db, "sessions"));
  await setDoc(ref, session);
  if (context) {
    await logActivity({
      companyId: context.companyId,
      type: "scan_started",
      message: `Escaneo iniciado en ${session.zoneCode}`,
      zoneCode: session.zoneCode,
      armadorId: session.armadorId,
      createdAt: Date.now(),
    });
  }
  return ref.id;
}

export async function updateScanSession(
  sessionId: string,
  data: Partial<ScanSession>,
  context?: { companyId: string; zoneCode: string; armadorId: string }
) {
  await updateDoc(doc(db, "sessions", sessionId), data);
  if (context && data.endTime !== undefined) {
    await logActivity({
      companyId: context.companyId,
      type: "scan_finished",
      message: `Zona ${context.zoneCode} terminada en ${Math.round((data.duration || 0) / 60)} min`,
      zoneCode: context.zoneCode,
      armadorId: context.armadorId,
      quantity: data.duration,
      createdAt: Date.now(),
    });
  }
}

/**
 * Actualiza el avgMinutes de una zona basándose en la duración de la sesión
 * completada. Si ya hay un promedio previo, hace un promedio ponderado.
 */
export async function updateZoneAvgMinutes(
  zoneId: string,
  durationSeconds: number
): Promise<void> {
  const zoneSnap = await getDoc(doc(db, "zones", zoneId));
  if (!zoneSnap.exists()) return;
  const zone = zoneSnap.data() as Zone;
  const newMinutes = Math.round(durationSeconds / 60);
  const prevAvg = zone.avgMinutes || 0;
  const prevCount = zone.completedSessions || 0;
  const newCount = prevCount + 1;
  const updatedAvg = prevCount > 0
    ? Math.round((prevAvg * prevCount + newMinutes) / newCount)
    : newMinutes;
  await updateDoc(doc(db, "zones", zoneId), {
    avgMinutes: updatedAvg,
    completedSessions: newCount,
  });
}

/**
 * Recalcula el prodH (productos por hora) de un armador basándose en todas
 * sus sesiones completadas y los productos de las zonas asociadas.
 */
export async function recalcArmadorProdH(
  armadorId: string,
  companyId: string
): Promise<void> {
  // Get all completed sessions for this armador
  const sessionsSnap = await getDocs(
    query(
      collection(db, "sessions"),
      where("armadorId", "==", armadorId),
      where("endTime", "!=", null)
    )
  );

  let totalSeconds = 0;
  const zoneCodes = new Set<string>();
  sessionsSnap.docs.forEach((d) => {
    const s = d.data() as ScanSession;
    totalSeconds += s.duration || 0;
    zoneCodes.add(s.zoneCode);
  });

  if (totalSeconds === 0) {
    await updateDoc(doc(db, "armadores", armadorId), { prodH: 0 });
    return;
  }

  // Get products from completed zones
  let totalProducts = 0;
  for (const code of Array.from(zoneCodes)) {
    const zoneId = `${companyId}_${code}`;
    const zoneSnap = await getDoc(doc(db, "zones", zoneId));
    if (zoneSnap.exists()) {
      const z = zoneSnap.data() as Zone;
      totalProducts += z.totalProducts || z.products?.length || 0;
    }
  }

  const hours = totalSeconds / 3600;
  const prodH = hours > 0 ? Math.round(totalProducts / hours) : 0;
  await updateDoc(doc(db, "armadores", armadorId), { prodH });
}

/**
 * Busca la sesión de escaneo abierta (sin endTime) de una zona, si hay una.
 * Se usa para las acciones manuales del admin (pausar/terminar) — así puede
 * cerrar el cronómetro real del armador sin necesitar el sessionId, que solo
 * vive en el estado del celular del armador.
 */
async function findOpenSession(zoneCode: string): Promise<{ id: string; data: ScanSession } | null> {
  const q = query(collection(db, "sessions"), where("zoneCode", "==", zoneCode));
  const snap = await getDocs(q);
  const open = snap.docs.find((d) => (d.data() as ScanSession).endTime === undefined);
  return open ? { id: open.id, data: open.data() as ScanSession } : null;
}

/**
 * El admin pausa manualmente el trabajo de un armador en una zona activa:
 * cierra la sesión de escaneo abierta con la duración real transcurrida y
 * deja la zona en estado "paused" (sigue siendo del mismo armador — solo se
 * detiene el cronómetro). El armador puede reanudarla más tarde volviendo a
 * escanear el QR de la zona, igual que si la empezara de cero.
 */
export async function adminPauseZone(
  zone: { id: string; code: string },
  armador: { id: string; name: string } | undefined,
  companyId: string,
  editor: { uid: string; name: string }
): Promise<void> {
  const open = await findOpenSession(zone.code);
  let duration: number | undefined;
  if (open) {
    duration = Math.round((Date.now() - open.data.startTime) / 1000);
    await updateDoc(doc(db, "sessions", open.id), { endTime: Date.now(), duration });
  }
  await updateZone(zone.id, { status: "paused" }, editor);
  await logActivity({
    companyId,
    type: "zone_paused",
    message: `${zone.code} pausada por ${editor.name}` + (armador ? ` (trabajo de ${armador.name})` : ""),
    zoneCode: zone.code,
    armadorId: armador?.id,
    armadorName: armador?.name,
    quantity: duration,
    actorId: editor.uid,
    actorName: editor.name,
    createdAt: Date.now(),
  });
}

/**
 * El admin da por terminada — manualmente — la zona activa de un armador:
 * cierra la sesión abierta con su duración real y marca la zona como
 * completada ("done"), igual que si el armador la hubiera terminado desde
 * su celular. Útil cuando el armador no puede terminarla él mismo.
 */
export async function adminFinishZone(
  zone: { id: string; code: string },
  armador: { id: string; name: string } | undefined,
  companyId: string,
  editor: { uid: string; name: string }
): Promise<void> {
  const open = await findOpenSession(zone.code);
  let duration: number | undefined;
  if (open) {
    duration = Math.round((Date.now() - open.data.startTime) / 1000);
    await updateDoc(doc(db, "sessions", open.id), { endTime: Date.now(), duration });
  }
  await updateZone(zone.id, { status: "done", finishedAt: Date.now() }, editor);
  await logActivity({
    companyId,
    type: "scan_finished",
    message: `${zone.code} finalizada manualmente por ${editor.name}` + (armador ? ` (trabajo de ${armador.name})` : "") + (duration ? ` · ${Math.round(duration / 60)} min` : ""),
    zoneCode: zone.code,
    armadorId: armador?.id,
    armadorName: armador?.name,
    quantity: duration,
    actorId: editor.uid,
    actorName: editor.name,
    createdAt: Date.now(),
  });
}

// ==================== PICKING (datos reales de producción) ====================

export async function getPickings(companyId: string): Promise<PickingRecord[]> {
  const q = query(collection(db, "pickings"), where("companyId", "==", companyId));
  const snap = await getDocs(q);
  const pickings = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PickingRecord));
  pickings.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.createdAt - a.createdAt);
  return pickings;
}

export async function createPickingRecord(record: Omit<PickingRecord, "id">): Promise<string> {
  const ref = doc(collection(db, "pickings"));
  await setDoc(ref, record);
  await logActivity({
    companyId: record.companyId,
    type: "picking_manual",
    message: `${record.cantidad} unidades registradas en ${record.zoneCode}`,
    zoneCode: record.zoneCode,
    armadorId: record.armadorId,
    quantity: record.cantidad,
    actorId: record.createdBy,
    createdAt: Date.now(),
  });
  return ref.id;
}

/** Carga masiva de picking (import de Excel). Se parte en lotes de 400 por el límite de writeBatch. */
export async function bulkCreatePickingRecords(records: Omit<PickingRecord, "id">[]): Promise<void> {
  const CHUNK = 400;
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = writeBatch(db);
    records.slice(i, i + CHUNK).forEach((record) => {
      const ref = doc(collection(db, "pickings"));
      batch.set(ref, record);
    });
    await batch.commit();
  }
  if (records.length > 0) {
    const totalCantidad = records.reduce((acc, r) => acc + (r.cantidad || 0), 0);
    await logActivity({
      companyId: records[0].companyId,
      type: "picking_bulk",
      message: `Carga masiva: ${records.length} registros de picking (${totalCantidad} unidades)`,
      quantity: totalCantidad,
      actorId: records[0].createdBy,
      createdAt: Date.now(),
    });
  }
}

export async function deletePickingRecord(id: string) {
  await deleteDoc(doc(db, "pickings", id));
}

// ==================== SAP IMPORT ====================

export interface ImportSapResult {
  zonasNuevas: string[];
  zonasActualizadas: string[];
}

/**
 * Agrupa las filas del Excel de SAP por zona (cada zona = un marbete/pallet)
 * y crea o actualiza el documento de esa zona en Firestore. El documento
 * usa un ID determinístico (`${companyId}_${zona}`) para que reimportar el
 * mismo Excel actualice la zona en vez de duplicarla. La posición en el
 * mapa NO se toca si la zona ya existía (para no perder el acomodo manual
 * del administrador); las zonas nuevas entran en (0,0) para que el admin
 * las ubique la primera vez.
 */
export async function importSapData(
  data: SapRow[],
  companyId: string,
  editor?: { uid: string; name: string }
): Promise<ImportSapResult> {
  const batch = writeBatch(db);

  const byZone = new Map<string, SapRow[]>();
  data.forEach((row) => {
    if (!byZone.has(row.zona)) byZone.set(row.zona, []);
    byZone.get(row.zona)!.push(row);
  });

  const zonasNuevas: string[] = [];
  const zonasActualizadas: string[] = [];

  const entries = Array.from(byZone.entries());
  for (const [zona, rows] of entries) {
    const zoneRef = doc(db, "zones", `${companyId}_${zona}`);
    const zoneSnap = await getDoc(zoneRef);
    const first = rows[0];

    const products: ZoneProduct[] = rows.map((r) => ({
      codigo: r.codigo,
      descripcion: r.descripcion,
      cantidad: r.cantidad,
    }));
    const totalProducts = rows.reduce((acc, r) => acc + (r.cantidad || 0), 0);

    const baseData: Record<string, unknown> = {
      code: zona,
      companyId,
      sector: first.sector || "A",
      products,
      totalProducts,
      pallet: first.pallet || null,
      ruta: first.ruta || null,
      familia: first.familia || null,
      camion: first.camion || null,
      fechaEntrega: first.fechaEntrega || null,
      palletTotal: first.palletTotal || null,
    };
    if (editor) {
      baseData.lastEditedBy = editor.uid;
      baseData.lastEditedByName = editor.name;
      baseData.lastEditedAt = Date.now();
    }

    if (zoneSnap.exists()) {
      batch.update(zoneRef, baseData);
      zonasActualizadas.push(zona);
    } else {
      batch.set(zoneRef, {
        ...baseData,
        status: "idle",
        position: { x: 0, y: 0 },
        armadorId: null,
      });
      zonasNuevas.push(zona);
    }
  }

  await batch.commit();

  const totalUnidades = data.reduce((acc, r) => acc + (r.cantidad || 0), 0);
  await logActivity({
    companyId,
    type: "sap_import",
    message: `Carga SAP: ${zonasNuevas.length} zonas nuevas, ${zonasActualizadas.length} actualizadas (${totalUnidades} unidades)`,
    quantity: totalUnidades,
    actorId: editor?.uid,
    actorName: editor?.name,
    createdAt: Date.now(),
  });

  return { zonasNuevas, zonasActualizadas };
}

// ==================== COMPANIES ====================

export interface Company {
  id?: string;
  name: string;
  address?: string;
  createdAt?: unknown;
  createdBy?: string;
  // ─── Configuración operativa (mod-configuracion.tsx) ──────────────────────
  /** Hora de inicio del turno mañana, "HH:MM". */
  turnoMananaInicio?: string;
  turnoMananaFin?: string;
  turnoTardeInicio?: string;
  turnoTardeFin?: string;
  /** Hora de inicio del almuerzo, "HH:MM" — pausa el cronómetro del armador. */
  almuerzoInicio?: string;
  /** Duración del almuerzo en minutos. */
  almuerzoDuracionMin?: number;
  /** Meta de productividad, en productos por hora. */
  metaProdHora?: number;
  /** Meta de tiempo por zona, en minutos. */
  metaMinutosZona?: number;
  /** Costo por hora por defecto (fallback) para armadores sin costPerHour propio. */
  costoHoraDefault?: number;
}

export async function getCompany(companyId: string): Promise<Company | null> {
  const snap = await getDoc(doc(db, "companies", companyId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Company;
}

export async function getCompanies(): Promise<Company[]> {
  const q = query(collection(db, "companies"));
  const snap = await getDocs(q);
  const companies = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Company));
  companies.sort((a, b) => {
    const aTime = a.createdAt ? (a.createdAt as { toMillis?: () => number }).toMillis?.() || 0 : 0;
    const bTime = b.createdAt ? (b.createdAt as { toMillis?: () => number }).toMillis?.() || 0 : 0;
    return bTime - aTime;
  });
  return companies;
}

export async function createCompany(company: Omit<Company, "id">): Promise<string> {
  const ref = doc(collection(db, "companies"));
  const data: Record<string, unknown> = {
    name: company.name,
    createdAt: serverTimestamp(),
  };
  if (company.address) data.address = company.address;
  if (company.createdBy) data.createdBy = company.createdBy;
  await setDoc(ref, data);
  return ref.id;
}

export async function updateCompany(companyId: string, data: Partial<Company>) {
  await updateDoc(doc(db, "companies", companyId), data);
}

export async function deleteCompany(companyId: string) {
  await deleteDoc(doc(db, "companies", companyId));
}

/**
 * Elimina una empresa y todos sus datos relacionados (cascade delete):
 * zonas, armadores, usuarios de la empresa, sesiones y jornadas.
 */
export async function deleteCompanyCascade(companyId: string) {
  const batch = writeBatch(db);

  // Delete zones
  const zonesSnap = await getDocs(query(collection(db, "zones"), where("companyId", "==", companyId)));
  zonesSnap.docs.forEach((d) => batch.delete(d.ref));

  // Delete armadores
  const armadoresSnap = await getDocs(query(collection(db, "armadores"), where("companyId", "==", companyId)));
  armadoresSnap.docs.forEach((d) => batch.delete(d.ref));

  // Delete users (admins and armadores of this company)
  const usersSnap = await getDocs(query(collection(db, "users"), where("companyId", "==", companyId)));
  usersSnap.docs.forEach((d) => batch.delete(d.ref));

  // Delete jornadas
  const jornadasSnap = await getDocs(query(collection(db, "jornadas"), where("companyId", "==", companyId)));
  jornadasSnap.docs.forEach((d) => batch.delete(d.ref));

  // Delete sessions (by armador IDs from this company)
  const armadorIds = armadoresSnap.docs.map((d) => d.id);
  for (const armadorId of armadorIds) {
    const sessionsSnap = await getDocs(query(collection(db, "sessions"), where("armadorId", "==", armadorId)));
    sessionsSnap.docs.forEach((d) => batch.delete(d.ref));
  }

  // Delete the company itself
  batch.delete(doc(db, "companies", companyId));

  await batch.commit();
}

// ==================== ADMINS ====================

export async function getAdminsByCompany(companyId: string): Promise<AppUser[]> {
  const q = query(
    collection(db, "users"),
    where("role", "==", "admin"),
    where("companyId", "==", companyId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as AppUser));
}

/**
 * Crea una INVITACIÓN de administrador llamando a POST /api/admins
 * (requiere ser super_admin; la ruta corre con el Admin SDK y bypassa las
 * reglas de Firestore). El usuario real se crea solo hasta que esa persona
 * hace login con Google y /api/claim-invite encuentra la invitación.
 * Reemplaza al antiguo createAdmin, que escribía el doc "users" directamente
 * desde el cliente con un ID aleatorio (nunca el uid real de Google).
 */
export async function inviteAdmin(admin: {
  email: string;
  companyId?: string;
  sector?: string;
  color?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { ok: false, error: "No hay sesión activa" };
  }
  const token = await currentUser.getIdToken();

  const res = await fetch("/api/admins", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: admin.email,
      companyId: admin.companyId,
      sector: admin.sector,
      color: admin.color,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data.error || "Error al crear la invitación" };
  }
  return { ok: true, id: data.id };
}
