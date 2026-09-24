import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/backend/services/firebase-admin";
import { verifyRequest, AuthError } from "@/backend/services/api-auth";
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
export async function createAdmin(request: NextRequest) {
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

    // — Validación global: email único en TODAS las empresas (admin y armador) —
    const existingAdminSnap = await adminDb.collection("users").where("email", "==", email).where("role", "==", "admin").limit(1).get();
    if (!existingAdminSnap.empty) {
      const existing = existingAdminSnap.docs[0].data();
      return NextResponse.json({ error: `Ya existe un administrador con el email ${email} en la empresa ${existing.companyId} (${existing.name})` }, { status: 409 });
    }
    const existingArmadorSnap = await adminDb.collection("armadores").where("email", "==", email).limit(1).get();
    if (!existingArmadorSnap.empty) {
      const existing = existingArmadorSnap.docs[0].data();
      return NextResponse.json({ error: `Ya existe un armador con el email ${email} en la empresa ${existing.companyId} (${existing.name})` }, { status: 409 });
    }

    try {
      const existingUser = await adminAuth.getUserByEmail(email);
      const existingDoc = await adminDb.collection("users").doc(existingUser.uid).get();
      if (existingDoc.exists && existingDoc.data()?.role === "admin") {
        return NextResponse.json({ error: "Ya existe un administrador con este email" }, { status: 409 });
      }
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

    const tempPassword = `Siamo${Date.now().toString(36)}!`;
    const firebaseUser = await adminAuth.createUser({
      email,
      displayName: name,
      password: tempPassword,
      emailVerified: true,
    });

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
export async function listAdmins(request: NextRequest) {
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

/**
 * PUT /api/admins
 * Actualiza nombre y/o email de un administrador.
 * Body: { uid, name?, email? }
 */
export async function updateAdmin(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const body = await request.json();
    const uid = (body?.uid || "").toString().trim();
    const name = body?.name !== undefined ? (body.name || "").toString().trim() : undefined;
    const email = body?.email !== undefined ? (body.email || "").toString().trim().toLowerCase() : undefined;

    if (!uid) {
      return NextResponse.json({ error: "El UID del administrador es requerido" }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const adminAuth = getAdminAuth();

    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      return NextResponse.json({ error: "Administrador no encontrado" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;

    await userRef.update(updates);

    // Actualizar en Firebase Auth también
    try {
      const authUpdates: Record<string, string> = {};
      if (name !== undefined) authUpdates.displayName = name;
      if (email !== undefined) authUpdates.email = email;
      if (Object.keys(authUpdates).length > 0) {
        await adminAuth.updateUser(uid, authUpdates);
      }
    } catch {
      // Si el usuario no existe en Auth, solo actualizamos Firestore
    }

    return NextResponse.json({ ok: true, uid, ...updates });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("admins PUT error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/**
 * DELETE /api/admins
 * Elimina un administrador de Firestore y Firebase Auth.
 * Body: { uid }
 */
export async function deleteAdmin(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const body = await request.json();
    const uid = (body?.uid || "").toString().trim();

    if (!uid) {
      return NextResponse.json({ error: "El UID del administrador es requerido" }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const adminAuth = getAdminAuth();

    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      return NextResponse.json({ error: "Administrador no encontrado" }, { status: 404 });
    }

    // Eliminar de Firestore
    await userRef.delete();

    // Eliminar de Firebase Auth
    try {
      await adminAuth.deleteUser(uid);
    } catch {
      // Si no existe en Auth, continuamos
    }

    return NextResponse.json({ ok: true, uid, message: "Administrador eliminado correctamente" });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("admins DELETE error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
