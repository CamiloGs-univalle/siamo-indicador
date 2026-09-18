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
import { Zone, ZoneProduct, Armador, ScanSession, SapRow, PickingRecord, ActivityLogEntry, Membrete, MembreteProduct } from "@/types";

// ==================== ARMADOR SESSION STATE ====================
// Persiste el estado activo del armador (zona actual, membrete, timer)
// para que al recargar la página se restaure el progreso.

export interface ArmadorSessionState {
  active: boolean;
  finished: boolean;
  currentZoneCode: string;
  membreteId: string;
  sessionId: string;
  zoneIndex: number;
  totalStartedAt: number;
  startedAt: number;
  finishedAt?: number;
  totalElapsed?: number;
  zonesCompleted?: number;
  totalZones?: number;
  /** Si el armador esta en pausa. */
  paused?: boolean;
  /** Timestamp de cuando se pauso (Date.now()). */
  pausedAt?: number;
  /** Milisegundos acumulados de pausa en esta zona. */
  pausedMs?: number;
  /** Numero total de pausas en esta sesion. */
  pauseCount?: number;
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

// ==================== MEMBRETES ====================
// CRUD para la colección "membretes" — listas de picking que conectan
// un armador con una zona y sus productos.

/**
 * Crea un nuevo membrete. Retorna el ID del documento creado.
 */
export async function createMembrete(membrete: Omit<Membrete, "id">): Promise<string> {
  const ref = doc(collection(db, "membretes"));
  await setDoc(ref, membrete);
  await logActivity({
    companyId: membrete.companyId,
    type: "membrete_created",
    message: `Membrete ${membrete.code} creado para zona ${membrete.zonaCode}`,
    zoneCode: membrete.zonaCode,
    armadorId: membrete.armadorId || undefined,
    armadorName: membrete.armadorName || undefined,
    createdAt: Date.now(),
  });
  return ref.id;
}

/**
 * Actualiza un membrete existente.
 */
export async function updateMembrete(
  membreteId: string,
  data: Partial<Membrete>,
  editor?: { uid: string; name: string }
) {
  const payload: Partial<Membrete> = { ...data };
  if (editor) {
    payload.lastEditedBy = editor.uid;
    payload.lastEditedByName = editor.name;
    payload.lastEditedAt = Date.now();
  }
  await updateDoc(doc(db, "membretes", membreteId), payload);
}

/**
 * Elimina un membrete.
 */
export async function deleteMembrete(membreteId: string) {
  await deleteDoc(doc(db, "membretes", membreteId));
}

/**
 * Marca un producto del membrete como completado o con incidencia.
 * Actualiza el status del producto dentro del array products del membrete.
 * Si todos los productos se completan, marca el membrete como "completed".
 */
export async function markMembreteProduct(
  membreteId: string,
  productIndex: number,
  productStatus: "completed" | "incident",
  incidentNote?: string,
  cantidadReal?: number
): Promise<void> {
  const membreteSnap = await getDoc(doc(db, "membretes", membreteId));
  if (!membreteSnap.exists()) return;
  const membrete = membreteSnap.data() as Membrete;

  const products = [...(membrete.products || [])];
  if (productIndex < 0 || productIndex >= products.length) return;

  products[productIndex] = {
    ...products[productIndex],
    status: productStatus,
    incidentNote: productStatus === "incident" ? incidentNote : undefined,
    completedAt: Date.now(),
    cantidadReal: cantidadReal ?? products[productIndex].cantidadReal,
  };

  // Verificar si todos los productos estan completados o con incidencia
  const allDone = products.every((p) => p.status === "completed" || p.status === "incident");
  const hasIncidents = products.some((p) => p.status === "incident");

  const updates: Partial<Membrete> = {
    products,
    totalProducts: products.length,
    totalUnits: products.reduce((sum, p) => sum + (p.cantidad || 0), 0),
  };

  if (allDone) {
    updates.status = "completed";
    updates.finishedAt = Date.now();
    updates.durationMs = membrete.startedAt ? Date.now() - membrete.startedAt : undefined;
  }

  await updateDoc(doc(db, "membretes", membreteId), updates);

  // Log de actividad
  await logActivity({
    companyId: membrete.companyId,
    type: productStatus === "completed" ? "membrete_product_completed" : "membrete_product_incident",
    message: productStatus === "completed"
      ? `Producto ${products[productIndex].codigo} completado en ${membrete.code}`
      : `Incidencia en ${products[productIndex].codigo}: ${incidentNote || "sin detalle"}`,
    zoneCode: membrete.zonaCode,
    armadorId: membrete.armadorId || undefined,
    armadorName: membrete.armadorName || undefined,
    createdAt: Date.now(),
  });
}

/**
 * Cancela un membrete.
 */
export async function cancelMembrete(membreteId: string, reason?: string): Promise<void> {
  const membreteSnap = await getDoc(doc(db, "membretes", membreteId));
  if (!membreteSnap.exists()) return;
  const membrete = membreteSnap.data() as Membrete;

  await updateDoc(doc(db, "membretes", membreteId), {
    status: "cancelled",
    finishedAt: Date.now(),
  });

  await logActivity({
    companyId: membrete.companyId,
    type: "membrete_cancelled",
    message: `Membrete ${membrete.code} cancelado${reason ? `: ${reason}` : ""}`,
    zoneCode: membrete.zonaCode,
    createdAt: Date.now(),
  });
}

/**
 * Obtiene todos los membretes de una empresa.
 */
export async function getMembretes(companyId: string): Promise<Membrete[]> {
  const q = query(
    collection(db, "membretes"),
    where("companyId", "==", companyId)
  );
  const snap = await getDocs(q);
  const membretes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Membrete));
  membretes.sort((a, b) => a.code.localeCompare(b.code));
  return membretes;
}

/**
 * Suscripción en tiempo real a los membretes de una empresa.
 */
export function subscribeMembretes(companyId: string, cb: (membretes: Membrete[]) => void): Unsubscribe {
  const q = query(collection(db, "membretes"), where("companyId", "==", companyId));
  return onSnapshot(
    q,
    (snap) => {
      const membretes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Membrete));
      membretes.sort((a, b) => a.code.localeCompare(b.code));
      cb(membretes);
    },
    (error) => console.error("subscribeMembretes error:", error)
  );
}

/**
 * Obtiene membretes por zona (una zona puede tener varios membretes).
 */
export async function getMembretesByZona(zonaId: string): Promise<Membrete[]> {
  const q = query(
    collection(db, "membretes"),
    where("zonaId", "==", zonaId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Membrete));
}

/**
 * Obtiene membretes por armador.
 */
export async function getMembretesByArmador(armadorId: string): Promise<Membrete[]> {
  const q = query(
    collection(db, "membretes"),
    where("armadorId", "==", armadorId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Membrete));
}

/**
 * Asigna un membrete a un armador. Actualiza el membrete y el armador.
 */
export async function assignMembreteToArmador(
  membreteId: string,
  armador: { id: string; name: string },
  companyId: string,
  editor?: { uid: string; name: string }
) {
  // Actualizar el membrete
  await updateMembrete(membreteId, {
    armadorId: armador.id,
    armadorName: armador.name,
    status: "pending",
    assignedAt: Date.now(),
  }, editor);

  // Actualizar el armador con el membreteId
  await updateArmador(armador.id, { membreteId });

  // Buscar el membrete para obtener el zonaCode
  const membreteSnap = await getDoc(doc(db, "membretes", membreteId));
  const membreteData = membreteSnap.data() as Membrete;

  await logActivity({
    companyId,
    type: "membrete_assigned",
    message: `Membrete ${membreteData.code} asignado a ${armador.name} → Zona ${membreteData.zonaCode}`,
    zoneCode: membreteData.zonaCode,
    armadorId: armador.id,
    armadorName: armador.name,
    actorId: editor?.uid,
    actorName: editor?.name,
    createdAt: Date.now(),
  });
}

/**
 * Desasigna un membrete de un armador.
 */
export async function unassignMembreteFromArmador(
  membreteId: string,
  armadorId: string,
  companyId: string,
  editor?: { uid: string; name: string }
) {
  // Obtener datos del membrete
  const membreteSnap = await getDoc(doc(db, "membretes", membreteId));
  const membreteData = membreteSnap.data() as Membrete;

  // Actualizar el membrete
  await updateMembrete(membreteId, {
    armadorId: null,
    armadorName: undefined,
    status: "pending",
    assignedAt: undefined,
  }, editor);

  // Quitar el membreteId del armador
  await updateArmador(armadorId, { membreteId: null });

  await logActivity({
    companyId,
    type: "membrete_cancelled",
    message: `Membrete ${membreteData.code} desasignado de ${membreteData.armadorName || "armador"}`,
    zoneCode: membreteData.zonaCode,
    armadorId,
    armadorName: membreteData.armadorName,
    actorId: editor?.uid,
    actorName: editor?.name,
    createdAt: Date.now(),
  });
}

/**
 * Inicia un membrete (al escanear el QR de la zona). Marca status "active" y startedAt.
 */
export async function startMembrete(
  membreteId: string,
  companyId: string,
  editor?: { uid: string; name: string }
) {
  await updateMembrete(membreteId, {
    status: "active",
    startedAt: Date.now(),
  }, editor);

  const membreteSnap = await getDoc(doc(db, "membretes", membreteId));
  const membreteData = membreteSnap.data() as Membrete;

  await logActivity({
    companyId,
    type: "membrete_started",
    message: `Membrete ${membreteData.code} iniciado por ${membreteData.armadorName || "armador"} en zona ${membreteData.zonaCode}`,
    zoneCode: membreteData.zonaCode,
    armadorId: membreteData.armadorId || undefined,
    armadorName: membreteData.armadorName || undefined,
    createdAt: Date.now(),
  });
}

/**
 * Completa un membrete. Marca status "completed" y finishedAt.
 */
export async function completeMembrete(
  membreteId: string,
  durationMs: number,
  companyId: string,
  editor?: { uid: string; name: string }
) {
  await updateMembrete(membreteId, {
    status: "completed",
    finishedAt: Date.now(),
    durationMs,
  }, editor);

  const membreteSnap = await getDoc(doc(db, "membretes", membreteId));
  const membreteData = membreteSnap.data() as Membrete;

  await logActivity({
    companyId,
    type: "membrete_completed",
    message: `Membrete ${membreteData.code} completado por ${membreteData.armadorName || "armador"} en zona ${membreteData.zonaCode} (${Math.round(durationMs / 60000)} min)`,
    zoneCode: membreteData.zonaCode,
    armadorId: membreteData.armadorId || undefined,
    armadorName: membreteData.armadorName || undefined,
    quantity: membreteData.totalUnits,
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

// ==================== CICLOS DE TRABAJO ====================
// Un "ciclo" es la tanda de zonas que un armador recorre de principio a
// fin. El admin la arma (asigna zonas con assignZone/unassignZone como
// siempre), y con estas tres funciones controla cuando el armador puede
// arrancar y que pasa despues de que termina. Ver Armador.cicloEstado en
// types/index.ts para el detalle del estado.

/** El admin confirma la asignacion actual: el armador ya puede escanear e iniciar su recorrido. */
export async function activarCiclo(
  armador: { id: string; name: string },
  companyId: string,
  editor: { uid: string; name: string }
): Promise<void> {
  await updateArmador(armador.id, { cicloEstado: "listo" });
  await logActivity({
    companyId,
    type: "cycle_started",
    message: `${editor.name} activó el ciclo de ${armador.name}`,
    armadorId: armador.id,
    armadorName: armador.name,
    actorId: editor.uid,
    actorName: editor.name,
    createdAt: Date.now(),
  });
}

/** Pausa el ciclo activo de un armador. El armador no puede escanear hasta que se reanude. */
export async function pausarCiclo(
  armador: { id: string; name: string },
  companyId: string,
  editor: { uid: string; name: string }
): Promise<void> {
  await updateArmador(armador.id, { cicloEstado: "pausado" });
  await logActivity({
    companyId,
    type: "cycle_paused",
    message: `${editor.name} pausó el ciclo de ${armador.name}`,
    armadorId: armador.id,
    armadorName: armador.name,
    actorId: editor.uid,
    actorName: editor.name,
    createdAt: Date.now(),
  });
}

/** Reanuda un ciclo pausado. */
export async function reanudarCiclo(
  armador: { id: string; name: string },
  companyId: string,
  editor: { uid: string; name: string }
): Promise<void> {
  await updateArmador(armador.id, { cicloEstado: "listo" });
  await logActivity({
    companyId,
    type: "cycle_resumed",
    message: `${editor.name} reanudó el ciclo de ${armador.name}`,
    armadorId: armador.id,
    armadorName: armador.name,
    actorId: editor.uid,
    actorName: editor.name,
    createdAt: Date.now(),
  });
}

/**
 * Vuelve a asignar al armador las mismas zonas de su último ciclo
 * (Armador.lastCicloZoneIds), saltando cualquiera que ya no exista o que
 * otro armador haya tomado mientras tanto. Deja el ciclo SIN confirmar
 * (cicloEstado se limpia) -- el admin todavía debe darle a "Listo" para
 * que el armador arranque, así puede revisar/ajustar antes de avisarle.
 * Devuelve cuántas zonas quedaron reasignadas y cuántas se saltaron.
 */
export async function repetirCiclo(
  armador: Armador,
  allZones: Zone[],
  companyId: string,
  editor: { uid: string; name: string }
): Promise<{ reasignadas: number; saltadas: number }> {
  const ids = armador.lastCicloZoneIds || [];
  const disponibles = allZones.filter((z) => ids.includes(z.id!) && !z.armadorId);
  for (const z of disponibles) {
    await assignZone(z.id!, z.code, companyId, { id: armador.id, name: armador.name }, editor);
  }
  await updateArmador(armador.id, { cicloEstado: null });
  return { reasignadas: disponibles.length, saltadas: ids.length - disponibles.length };
}

/** Empieza un ciclo en blanco: solo baja el aviso de "completado" para que el admin arme la asignación desde cero con el panel de siempre. */
export async function nuevoCiclo(armadorId: string): Promise<void> {
  await updateArmador(armadorId, { cicloEstado: null });
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

export async function getScanSessionsByArmador(armadorAuthUid: string): Promise<ScanSession[]> {
  const q = query(
    collection(db, "sessions"),
    where("armadorId", "==", armadorAuthUid)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ScanSession))
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

/**
 * Suscripción en tiempo real a todas las sesiones de escaneo de la empresa.
 * Filtra por los authUid de los armadores de la empresa.
 */
export function subscribeSessions(companyId: string, cb: (sessions: ScanSession[]) => void): Unsubscribe {
  // Get armador authUids for this company
  const armadorQ = query(collection(db, "armadores"), where("companyId", "==", companyId));
  return onSnapshot(armadorQ, (armadorSnap) => {
    const authUids = armadorSnap.docs
      .map((d) => d.data().authUid)
      .filter(Boolean);

    if (authUids.length === 0) {
      cb([]);
      return;
    }

    // Firestore 'in' query supports max 30 items
    const chunks: string[][] = [];
    for (let i = 0; i < authUids.length; i += 30) {
      chunks.push(authUids.slice(i, i + 30));
    }

    const allSessions: ScanSession[] = [];
    let loaded = 0;

    chunks.forEach((chunk) => {
      const sessionsQ = query(collection(db, "sessions"), where("armadorId", "in", chunk));
      onSnapshot(sessionsQ, (snap) => {
        const chunkSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScanSession));
        // Merge: remove old sessions from this chunk, add new ones
        const otherChunks = allSessions.filter((s) => !chunk.includes(s.armadorId));
        allSessions.length = 0;
        allSessions.push(...otherChunks, ...chunkSessions);
        loaded++;
        if (loaded === chunks.length) {
          cb([...allSessions].sort((a, b) => (b.startTime || 0) - (a.startTime || 0)));
        }
      });
    });
  }, (error) => console.error("subscribeSessions error:", error));
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
/**
 * Importa datos de SAP y crea zonas + membretes.
 *
 * Por cada zona en el Excel:
 * 1. Crea la ZONA (espacio físico) — solo si no existe, con productos del inventario
 * 2. Crea un MEMBRETE (orden de picking) — UNO POR CADA FILA de pallet/ruta diferente
 *
 * Ejemplo:
 *   Excel tiene Z07 con pallet 003 (ruta KA2P33) y pallet 005 (ruta XB1234)
 *   → Se crea 1 Zona Z07 (espacio físico)
 *   → Se crean 2 Membretes: M-Z07-001 (pallet 003) y M-Z07-002 (pallet 005)
 */
export async function importSapData(
  data: SapRow[],
  companyId: string,
  editor?: { uid: string; name: string }
): Promise<ImportSapResult> {
  const batch = writeBatch(db);

  // Agrupar filas por zona
  const byZone = new Map<string, SapRow[]>();
  data.forEach((row) => {
    if (!byZone.has(row.zona)) byZone.set(row.zona, []);
    byZone.get(row.zona)!.push(row);
  });

  const zonasNuevas: string[] = [];
  const zonasActualizadas: string[] = [];

  const entries = Array.from(byZone.entries());
  for (const [zona, rows] of entries) {
    const first = rows[0];

    // ── 1. Crear/actualizar la ZONA (espacio físico) ──────────────────────
    // La zona es el espacio donde están los productos — NO tiene datos del pedido
    const zoneRef = doc(db, "zones", `${companyId}_${zona}`);
    const zoneSnap = await getDoc(zoneRef);

    // Productos del inventario de esta zona (todos los productos únicos)
    const products: ZoneProduct[] = [];
    const seenSkus = new Set<string>();
    for (const r of rows) {
      if (!seenSkus.has(r.codigo)) {
        seenSkus.add(r.codigo);
        products.push({
          codigo: r.codigo,
          descripcion: r.descripcion,
          cantidad: r.cantidad,
        });
      }
    }

    if (!zoneSnap.exists()) {
      // Crear zona nueva — espacio físico con su inventario
      batch.set(zoneRef, {
        code: zona,
        companyId,
        sector: first.sector || "A",
        status: "idle",
        position: { x: 0, y: 0 },
        products,
        totalProducts: products.length,
        lastEditedBy: editor?.uid,
        lastEditedByName: editor?.name,
        lastEditedAt: Date.now(),
      });
      zonasNuevas.push(zona);
    } else {
      // Actualizar inventario de la zona
      batch.update(zoneRef, {
        products,
        totalProducts: products.length,
        lastEditedBy: editor?.uid,
        lastEditedByName: editor?.name,
        lastEditedAt: Date.now(),
      });
      zonasActualizadas.push(zona);
    }

    // ── 2. Crear MEMBRETES (ordenes de picking) ──────────────────────────
    // Agrupar por pallet/ruta para crear un membrete por cada orden
    const byPallet = new Map<string, SapRow[]>();
    for (const r of rows) {
      const key = `${r.pallet || "sin-pallet"}_${r.ruta || "sin-ruta"}`;
      if (!byPallet.has(key)) byPallet.set(key, []);
      byPallet.get(key)!.push(r);
    }

    let membreteIdx = 1;
    for (const [, palletRows] of Array.from(byPallet.entries())) {
      const palletFirst = palletRows[0];
      const membreteProducts: MembreteProduct[] = palletRows.map((r: SapRow) => ({
        codigo: r.codigo,
        descripcion: r.descripcion,
        cantidad: r.cantidad,
      }));
      const totalUnits = palletRows.reduce((acc: number, r: SapRow) => acc + (r.cantidad || 0), 0);

      const membreteRef = doc(collection(db, "membretes"));
      batch.set(membreteRef, {
        code: `M-${zona}-${String(membreteIdx).padStart(3, "0")}`,
        companyId,
        // Datos del pedido (del membrete físico)
        ruta: palletFirst.ruta || null,
        pallet: palletFirst.pallet || null,
        palletTotal: palletFirst.palletTotal || null,
        fechaEntrega: palletFirst.fechaEntrega || null,
        familia: palletFirst.familia || null,
        camion: palletFirst.camion || null,
        // Relación con zona
        zonaId: `${companyId}_${zona}`,
        zonaCode: zona,
        // Sin asignar
        armadorId: null,
        armadorName: null,
        status: "pending",
        // Productos
        products: membreteProducts,
        totalProducts: membreteProducts.length,
        totalUnits,
        // Timestamps
        createdAt: Date.now(),
        lastEditedBy: editor?.uid,
        lastEditedByName: editor?.name,
        lastEditedAt: Date.now(),
      });
      membreteIdx++;
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
  /** Turno noche (warehouse). Ej. 20:00-06:00. */
  turnoNocheInicio?: string;
  turnoNocheFin?: string;
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
 * Crea un administrador directamente llamando a POST /api/admins.
 * Crea el perfil en Firestore + usuario en Firebase Auth con contraseña temporal.
 */
export async function createAdmin(admin: {
  name: string;
  email: string;
  companyId?: string;
  color?: string;
}): Promise<{ ok: boolean; id?: string; error?: string; tempPassword?: string; message?: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { ok: false, error: "No hay sesion activa" };
  }
  const token = await currentUser.getIdToken();

  const res = await fetch("/api/admins", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: admin.name,
      email: admin.email,
      companyId: admin.companyId,
      color: admin.color,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data.error || "Error al crear el administrador" };
  }
  return { ok: true, id: data.id, tempPassword: data.tempPassword, message: data.message };
}
