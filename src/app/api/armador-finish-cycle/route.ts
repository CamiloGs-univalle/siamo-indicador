import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyRequest, AuthError } from "@/lib/api-auth";

/**
 * POST /api/armador-finish-cycle — el armador avisa que terminó TODAS las
 * zonas de su recorrido actual. Usa el Admin SDK para bypassear las reglas
 * de Firestore, porque esto hace dos cosas que un armador normalmente no
 * puede hacer por su cuenta (Zone.armadorId es admin-only):
 *
 *   1. Le quita la asignación (armadorId/estado) a cada zona que tenía —
 *      así el módulo de Asignación del admin deja de mostrarlas como
 *      "asignadas" a este armador apenas termina, en vez de quedarse
 *      pegadas ahí para siempre.
 *   2. Marca Armador.cicloEstado = "completado" y guarda el listado de
 *      zonas que tenía (lastCicloZoneIds), para que el admin pueda usar
 *      "Repetir ciclo" con un clic o armar uno nuevo — y para que el
 *      armador no pueda arrancar de nuevo hasta que el admin confirme el
 *      próximo ciclo con "Listo".
 *
 * El chequeo de identidad es el mismo patrón que /api/armador-session:
 * armadorId es el id del roster (Zone.armadorId -> Armador.id), NO el uid
 * de Firebase Auth, así que se valida por el vínculo real
 * armadores/{armadorId}.authUid, nunca comparando uids directamente.
 */
export async function POST(request: NextRequest) {
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
