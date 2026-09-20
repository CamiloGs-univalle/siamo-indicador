import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/backend/services/firebase-admin";
import { verifyRequest, AuthError } from "@/backend/services/api-auth";

/**
 * Controladores de /api/armador-session — guarda/restaura y borra el estado
 * activo del armador (zona actual, membrete, timer). Usa el Admin SDK para
 * bypassear las reglas de Firestore.
 *
 * OJO: armadorId es el id del documento en el roster "armadores"
 * (Zone.armadorId -> Armador.id), NO el uid de Firebase Auth — son dos
 * espacios de id distintos (ver ARQUITECTURA.md §4.5). Por eso el chequeo de
 * identidad no compara `decoded.uid` contra `armadorId` directamente, sino
 * que verifica el vínculo real `armadores/{armadorId}.authUid`.
 */
export async function saveSession(request: NextRequest) {
  try {
    const decoded = await verifyRequest(request);
    const body = await request.json();
    const { armadorId, state } = body;

    if (!armadorId) {
      return NextResponse.json({ error: "armadorId required" }, { status: 400 });
    }

    const adminDb = getAdminDb();

    const armadorSnap = await adminDb.collection("armadores").doc(armadorId).get();
    if (!armadorSnap.exists || armadorSnap.data()?.authUid !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await adminDb.collection("armadores").doc(armadorId).set(
      { activeSession: state },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("armador-session error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function clearSession(request: NextRequest) {
  try {
    const decoded = await verifyRequest(request);
    const body = await request.json();
    const { armadorId } = body;

    if (!armadorId) {
      return NextResponse.json({ error: "armadorId required" }, { status: 400 });
    }

    const adminDb = getAdminDb();

    const armadorSnap = await adminDb.collection("armadores").doc(armadorId).get();
    if (!armadorSnap.exists || armadorSnap.data()?.authUid !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await adminDb.collection("armadores").doc(armadorId).set(
      { activeSession: null },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("armador-session error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
