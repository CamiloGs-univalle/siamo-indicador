import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyRequest, AuthError } from "@/lib/api-auth";

/**
 * POST /api/armador-session — Guarda/restaura el estado activo del armador.
 * PUT /api/armador-session — Borra el estado activo.
 * Usa el Admin SDK para bypassear las reglas de Firestore.
 */
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyRequest(request);
    const body = await request.json();
    const { armadorId, state } = body;

    if (!armadorId) {
      return NextResponse.json({ error: "armadorId required" }, { status: 400 });
    }

    const adminDb = getAdminDb();

    // Solo el armador dueno de este armadorId puede tocar su propio estado.
    // OJO: armadorId es el id del documento en el roster "armadores"
    // (Zone.armadorId -> Armador.id), NO el uid de Firebase Auth -- son dos
    // espacios de id distintos. Antes se comparaba "decoded.uid !== armadorId"
    // directamente, lo cual casi nunca coincide y devolvia 403 siempre; como
    // el fetch en el cliente no revisaba el status de la respuesta, el error
    // quedaba invisible y el progreso nunca se guardaba (se "reseteaba" al
    // recargar). Ahora se verifica el vinculo real: armadores/{armadorId}.authUid.
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

export async function PUT(request: NextRequest) {
  try {
    const decoded = await verifyRequest(request);
    const body = await request.json();
    const { armadorId } = body;

    if (!armadorId) {
      return NextResponse.json({ error: "armadorId required" }, { status: 400 });
    }

    const adminDb = getAdminDb();

    // Mismo chequeo de vinculo real que en POST (ver comentario ahi arriba).
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
