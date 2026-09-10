import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyRequest, isSuperAdminEmail, AuthError } from "@/lib/api-auth";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/claim-invite
 * Se llama en cada login (desde auth-context) con el ID token del usuario.
 * Usa el Admin SDK (bypassa las reglas de Firestore) para:
 *   1. Si ya existe users/{uid} → refresca lastLogin y deja pasar.
 *   2. Si el email está en SUPER_ADMIN_EMAILS → crea el perfil de super_admin.
 *   3. Si el email coincide con un armador ya registrado en el roster
 *      (colección `armadores`) → crea el perfil de armador directamente.
 *   4. Si hay una invitación pendiente para ese email (admins) → crea el
 *      perfil con el rol/empresa de la invitación y la marca como reclamada.
 *   5. Si nada de lo anterior aplica → 403 (no autorizado).
 *
 * Devuelve { ok: true, user: {...} } con los datos del perfil para que
 * el cliente NO necesite leer Firestore directamente (evita problemas de
 * reglas de seguridad sin desplegar).
 */
export async function POST(request: NextRequest) {
  try {
    console.log("claim-invite: starting, method=", request.method);
    const authHeader = request.headers.get("authorization");
    console.log("claim-invite: auth header present=", !!authHeader, "length=", authHeader?.length);
    const decoded = await verifyRequest(request);
    console.log("claim-invite: token verified, uid=", decoded.uid, "email=", decoded.email);
    const { uid, email } = decoded;

    const adminDb = getAdminDb();
    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      await userRef.set({ lastLogin: FieldValue.serverTimestamp() }, { merge: true });
      const data = userSnap.data()!;
      return NextResponse.json({
        ok: true,
        user: {
          uid: userSnap.id,
          email: data.email || "",
          name: data.name || "",
          role: data.role,
          companyId: data.companyId || null,
          adminId: data.adminId || null,
          sector: data.sector || null,
          color: data.color || null,
          armadorId: data.armadorId || null,
        },
      });
    }

    if (isSuperAdminEmail(email)) {
      await userRef.set({
        uid,
        email: email || "",
        name: decoded.name || "",
        role: "super_admin",
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({
        ok: true,
        user: {
          uid,
          email: email || "",
          name: decoded.name || "",
          role: "super_admin",
          companyId: null,
          adminId: null,
          sector: null,
          color: null,
          armadorId: null,
        },
      });
    }

    if (!email) {
      return NextResponse.json({ error: "Cuenta sin email" }, { status: 403 });
    }

    const normalizedEmail = email.toLowerCase();

    const armadorSnap = await adminDb
      .collection("armadores")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (!armadorSnap.empty) {
      const armadorDoc = armadorSnap.docs[0];
      const armador = armadorDoc.data();

      await userRef.set({
        uid,
        email: normalizedEmail,
        name: decoded.name || armador.name || "",
        role: "armador",
        companyId: armador.companyId ?? null,
        sector: armador.sector ?? null,
        color: armador.color ?? null,
        armadorId: armadorDoc.id,
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: FieldValue.serverTimestamp(),
      });

      await armadorDoc.ref.set(
        { authUid: uid, inviteStatus: "claimed" },
        { merge: true }
      );

      return NextResponse.json({
        ok: true,
        user: {
          uid,
          email: normalizedEmail,
          name: decoded.name || armador.name || "",
          role: "armador",
          companyId: armador.companyId ?? null,
          adminId: null,
          sector: armador.sector ?? null,
          color: armador.color ?? null,
          armadorId: armadorDoc.id,
        },
      });
    }

    const inviteSnap = await adminDb
      .collection("invitations")
      .where("email", "==", normalizedEmail)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (inviteSnap.empty) {
      return NextResponse.json(
        { error: "No hay invitación pendiente para este correo" },
        { status: 403 }
      );
    }

    const invite = inviteSnap.docs[0];
    const inviteData = invite.data();

    const userRole = inviteData.role || "admin";

    await userRef.set({
      uid,
      email: normalizedEmail,
      name: decoded.name || "",
      role: userRole,
      companyId: inviteData.companyId ?? null,
      sector: inviteData.sector ?? null,
      color: inviteData.color ?? null,
      armadorId: inviteData.armadorId ?? null,
      createdAt: FieldValue.serverTimestamp(),
      lastLogin: FieldValue.serverTimestamp(),
    });

    await invite.ref.set(
      { status: "claimed", claimedAt: FieldValue.serverTimestamp(), claimedUid: uid },
      { merge: true }
    );

    if (inviteData.armadorId) {
      try {
        await adminDb.collection("armadores").doc(inviteData.armadorId).set(
          { authUid: uid, inviteStatus: "claimed" },
          { merge: true }
        );
      } catch (linkErr) {
        console.error("claim-invite: no se pudo vincular armadorId:", linkErr);
      }
    }

    return NextResponse.json({
      ok: true,
      user: {
        uid,
        email: normalizedEmail,
        name: decoded.name || "",
        role: userRole,
        companyId: inviteData.companyId ?? null,
        adminId: null,
        sector: inviteData.sector ?? null,
        color: inviteData.color ?? null,
        armadorId: inviteData.armadorId ?? null,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : "unknown";
    console.error(`claim-invite error [${errName}]: ${errMsg}`);
    return NextResponse.json({ error: "Error interno", detail: errMsg }, { status: 500 });
  }
}
