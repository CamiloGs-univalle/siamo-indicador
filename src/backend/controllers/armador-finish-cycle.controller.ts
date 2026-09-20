import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/backend/services/firebase-admin";
import { verifyRequest, AuthError } from "@/backend/services/api-auth";

/**
 * Controlador de POST /api/armador-finish-cycle.
 *
 * @deprecated Código muerto: ningún componente del frontend actual invoca
 * esta ruta (confirmado por búsqueda de referencias en todo `src/`), y su
 * lógica pertenece al modelo de "ciclo" que fue eliminado por completo del
 * resto del sistema (ver ARQUITECTURA.md §4.4 y §5.7) — sigue escribiendo
 * `Zone.armadorId`/`Armador.cicloEstado`/`lastCicloZoneIds`, campos que ya
 * no tienen ningún otro consumidor. Se conserva tal cual durante la
 * reorganización de carpetas para no alterar comportamiento; su eliminación
 * es una decisión de producto pendiente (ver MEJORAS.md), no de esta
 * reorganización.
 */
export async function finishCycle(request: NextRequest) {
  try {
    const decoded = await verifyRequest(request);
    const body = await request.json();
    const { armadorId } = body;

    if (!armadorId) {
      return NextResponse.json({ error: "armadorId required" }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const armadorRef = adminDb.collection("armadores").doc(armadorId);
    const armadorSnap = await armadorRef.get();

    if (!armadorSnap.exists) {
      return NextResponse.json({ error: "Armador no encontrado" }, { status: 404 });
    }
    const armadorData = armadorSnap.data() || {};
    if (armadorData.authUid !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const zonesSnap = await adminDb
      .collection("zones")
      .where("armadorId", "==", armadorId)
      .get();
    const zoneIds = zonesSnap.docs.map((d) => d.id);

    const batch = adminDb.batch();
    zonesSnap.docs.forEach((d) => {
      batch.update(d.ref, {
        armadorId: null,
        status: "idle",
        startedAt: null,
        finishedAt: null,
      });
    });
    batch.update(armadorRef, {
      cicloEstado: "completado",
      lastCicloZoneIds: zoneIds,
      activeSession: null,
    });
    const activityRef = adminDb.collection("activity").doc();
    batch.set(activityRef, {
      companyId: armadorData.companyId ?? null,
      type: "cycle_completed",
      message: `${armadorData.name || "Armador"} completó su ciclo (${zoneIds.length} zona${zoneIds.length === 1 ? "" : "s"})`,
      armadorId,
      armadorName: armadorData.name ?? null,
      quantity: zoneIds.length,
      actorId: decoded.uid,
      actorName: armadorData.name ?? null,
      createdAt: Date.now(),
    });
    await batch.commit();

    return NextResponse.json({ ok: true, zonesCleared: zoneIds.length });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("armador-finish-cycle error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
