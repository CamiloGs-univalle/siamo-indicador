import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebase-admin";

/**
 * POST /api/cedula-login
 * Permite a un armador iniciar sesión con su cédula (sin Google).
 *
 * Flujo:
 *   1. Busca el armador por cédula en la colección `armadores`.
 *   2. Si no existe → 404.
 *   3. Genera un email sintético: `{cedula}@siamo.local`
 *   4. Crea o busca el usuario de Firebase Auth con ese email.
 *   5. Genera un custom token y lo devuelve al cliente.
 *   6. El cliente usa signInWithCustomToken para autenticarse.
 *
 * Esto permite que el armador NO necesite cuenta de Google — solo su cédula.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cedula } = body;

    if (!cedula || typeof cedula !== "string" || cedula.trim().length < 3) {
      return NextResponse.json(
        { error: "Cédula inválida" },
        { status: 400 }
      );
    }

    const normalizedCedula = cedula.trim();
    const adminDb = getAdminDb();
    const adminAuth = getAdminAuth();

    // Buscar armador por cédula
    const armadorSnap = await adminDb
      .collection("armadores")
      .where("cedula", "==", normalizedCedula)
      .limit(1)
      .get();

    if (armadorSnap.empty) {
      return NextResponse.json(
        { error: "No se encontró un armador con esa cédula. Verifica con tu administrador." },
        { status: 404 }
      );
    }

    const armadorDoc = armadorSnap.docs[0];
    const armador = armadorDoc.data();
    const syntheticEmail = `${normalizedCedula}@siamo.local`;

    // Buscar si ya existe un usuario de Auth con ese email
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.getUserByEmail(syntheticEmail);
    } catch {
      // No existe — crearlo
      firebaseUser = await adminAuth.createUser({
        email: syntheticEmail,
        displayName: armador.name || `Armador ${normalizedCedula}`,
        emailVerified: true,
      });
    }

    // Vincular el uid al armador si no estaba vinculado
    if (!armador.authUid || armador.authUid !== firebaseUser.uid) {
      await armadorDoc.ref.set(
        { authUid: firebaseUser.uid, inviteStatus: "claimed" },
        { merge: true }
      );
    }

    // Crear custom token
    const customToken = await adminAuth.createCustomToken(firebaseUser.uid, {
      armador: true,
      cedula: normalizedCedula,
    });

    return NextResponse.json({
      ok: true,
      customToken,
      armador: {
        id: armadorDoc.id,
        name: armador.name || "",
        cedula: normalizedCedula,
        sector: armador.sector || "A",
        companyId: armador.companyId || null,
      },
    });
  } catch (err) {
    console.error("cedula-login error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
