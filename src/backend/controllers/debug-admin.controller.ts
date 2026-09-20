import { NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/backend/services/firebase-admin";

/**
 * Controlador de GET /api/debug-admin — endpoint de diagnóstico.
 *
 * ⚠ SIN AUTENTICACIÓN — ver ERRORES.md §1.4. No requiere sesión ni rol de
 * ningún tipo; expone si las variables de entorno de Firebase Admin están
 * configuradas y datos de un usuario específico (UID hardcodeado). Se
 * conserva tal cual durante la reorganización de carpetas; su eliminación o
 * protección es una decisión de producto pendiente, no de esta reorganización.
 */
export async function getDebugInfo() {
  const debug: Record<string, unknown> = {};

  try {
    debug.adminApp = "initializing...";
    const adminDb = getAdminDb();
    debug.adminDb = "ok";

    const adminAuth = getAdminAuth();
    debug.adminAuth = "ok";

    const userSnap = await adminDb.collection("users").doc("ipCVCsAWgbWoTp6gz14ruUQ1nyt2").get();
    debug.userDocExists = userSnap.exists;
    if (userSnap.exists) {
      const d = userSnap.data()!;
      debug.userRole = d.role;
      debug.userEmail = d.email;
    }

    try {
      await adminAuth.verifyIdToken("fake-token-for-test");
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      debug.verifyTokenError = err.code || err.message || "unknown";
    }

    debug.envProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID || "MISSING";
    debug.envClientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL ? "SET" : "MISSING";
    debug.envPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ? `SET (len=${process.env.FIREBASE_ADMIN_PRIVATE_KEY.length})` : "MISSING";
    debug.envSuperAdmin = process.env.SUPER_ADMIN_EMAILS || "MISSING";

    return NextResponse.json(debug);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    debug.error = msg;
    return NextResponse.json(debug, { status: 500 });
  }
}
