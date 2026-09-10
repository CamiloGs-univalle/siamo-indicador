import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
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
 *      Basta con que el admin haya puesto ese correo al crear el armador;
 *      no hace falta ningún paso extra de invitación.
 *   4. Si hay una invitación pendiente para ese email (admins) → crea el
 *      perfil con el rol/empresa de la invitación y la marca como reclamada.
 *   5. Si nada de lo anterior aplica → 403 (no autorizado).
 */
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyRequest(request);
    const { uid, email } = decoded;

    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      await userRef.set({ lastLogin: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true });
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
      return NextResponse.json({ ok: true });
    }

    if (!email) {
      return NextResponse.json({ error: "Cuenta sin email" }, { status: 403 });
    }

    const normalizedEmail = email.toLowerCase();

    // Acceso directo de armador: si el correo ya está en el roster, con eso
    // basta para dar de alta la cuenta — sin invitación aparte.
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

      return NextResponse.json({ ok: true });
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

    await userRef.set({
      uid,
      email: normalizedEmail,
      name: decoded.name || "",
      role: inviteData.role || "admin",
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

    // Si la invitación viene de un roster de armador, vincula el uid real de
    // vuelta al documento armadores/{armadorId} (best-effort: si el armador
    // fue borrado mientras tanto, no debe romper el login).
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("claim-invite error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
