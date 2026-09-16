import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebase-admin";
import { verifyRequest, AuthError } from "@/lib/api-auth";
import { FieldValue } from "firebase-admin/firestore";

/** Solo un super_admin puede crear admins o listar admins. */
async function requireSuperAdmin(request: NextRequest) {
  const decoded = await verifyRequest(request);
  const adminDb = getAdminDb();
  const callerSnap = await adminDb.collection("users").doc(decoded.uid).get();
  const callerRole = callerSnap.exists ? callerSnap.data()?.role : null;
  if (callerRole !== "super_admin") {
    throw new AuthError(403, "Solo un super administrador puede realizar esta accion");
  }
  return decoded;
}

/**
 * POST /api/admins
 * Crea un administrador directamente: perfil en Firestore + usuario en Firebase Auth.
 * Body: { name, email, companyId?, color? }
 */
export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const body = await request.json();
    const name = (body?.name || "").toString().trim();
    const email = (body?.email || "").toString().trim().toLowerCase();
    const companyId = body?.companyId ?? null;
    const color = body?.color ?? null;

    if (!email) {
      return NextResponse.json({ error: "El email es requerido" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const adminAuth = getAdminAuth();

    // Verificar que no exista ya un usuario con ese email
    try {
      const existingUser = await adminAuth.getUserByEmail(email);
      // Si existe, verificar si ya es admin en Firestore
      const existingDoc = await adminDb.collection("users").doc(existingUser.uid).get();
      if (existingDoc.exists && existingDoc.data()?.role === "admin") {
        return NextResponse.json({ error: "Ya existe un administrador con este email" }, { status: 409 });
      }
      // Si existe en Auth pero no tiene perfil de admin, lo creamos
      const userRef = adminDb.collection("users").doc(existingUser.uid);
      await userRef.set({
        uid: existingUser.uid,
        email,
        name,
        role: "admin",
        companyId,
        color,
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: null,
      }, { merge: true });

      return NextResponse.json({ ok: true, id: existingUser.uid, email, name, role: "admin" });
    } catch {
      // El usuario no existe en Firebase Auth, lo creamos
    }

    // Crear usuario en Firebase Auth con contraseña temporal
    const tempPassword = `Siamo${Date.now().toString(36)}!`;
    const firebaseUser = await adminAuth.createUser({
      email,
      displayName: name,
      password: tempPassword,
      emailVerified: true,
    });

    // Crear perfil en Firestore
    const userRef = adminDb.collection("users").doc(firebaseUser.uid);
    await userRef.set({
      uid: firebaseUser.uid,
      email,
      name,
      role: "admin",
      companyId,
      color,
      createdAt: FieldValue.serverTimestamp(),
      lastLogin: null,
    });

    return NextResponse.json({
      ok: true,
      id: firebaseUser.uid,
      email,
      name,
      role: "admin",
      tempPassword,
      message: `Administrador creado. Puede acceder con: email "${email}" y contraseña temporal "${tempPassword}". Recomiende cambiar la contraseña en su primer ingreso.`,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("admins POST error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/** GET /api/admins → lista admins ya activos + invitaciones pendientes. */
export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const adminDb = getAdminDb();
    const snap = await adminDb.collection("users").where("role", "==", "admin").get();
    const admins = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const inviteSnap = await adminDb
      .collection("invitations")
      .where("status", "==", "pending")
      .get();
    const pending = inviteSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ admins, pending });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("admins GET error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
