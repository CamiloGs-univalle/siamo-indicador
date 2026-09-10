import { NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const debug: Record<string, unknown> = {};

  try {
    debug.adminApp = "initializing...";
    const adminDb = getAdminDb();
    debug.adminDb = "ok";

    const adminAuth = getAdminAuth();
    debug.adminAuth = "ok";

    // Test: try to get the super admin user doc
    const userSnap = await adminDb.collection("users").doc("ipCVCsAWgbWoTp6gz14ruUQ1nyt2").get();
    debug.userDocExists = userSnap.exists;
    if (userSnap.exists) {
      const d = userSnap.data()!;
      debug.userRole = d.role;
      debug.userEmail = d.email;
    }

    // Test: verifyIdToken with a dummy token to see if the SDK is functional
    try {
      await adminAuth.verifyIdToken("fake-token-for-test");
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      debug.verifyTokenError = err.code || err.message || "unknown";
    }

    // Test: check env vars exist
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
