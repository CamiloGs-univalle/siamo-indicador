import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyRequest, AuthError } from "@/lib/api-auth";
import { FieldValue } from "firebase-admin/firestore";

/** Solo un super_admin puede crear invitaciones o listar admins. */
async function requireSuperAdmin(request: NextRequest) {
  const decoded = await verifyRequest(request);
  const callerSnap = await adminDb.collection("users").doc(decoded.uid).get();
  const callerRole = callerSnap.exists ? callerSnap.data()?.role : null;
  if (callerRole !== "super_admin") {
    throw new AuthError(403, "Solo un super administrador puede realizar esta acción");
  }
  return decoded;
}

/**
 * POST /api/admins
 * Crea una INVITACIÓN (no un usuario) para el email indicado. El usuario
 * real se crea recién cuando esa persona inicia sesión y /api/claim-invite
 * encuentra la invitación pendiente.
 * Body: { email, companyId?, sector?, color? }
 */
export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const body = await request.json();
    const email = (body?.email || "").toString().trim().toLowerCase();
    const companyId = body?.companyId ?? null;
    const sector = body?.sector ?? null;
    const color = body?.color ?? null;

    if (!email) {
      return NextResponse.json({ error: "El email es requerido" }, { status: 400 });
    }

    const existing = await adminDb
      .collection("invitations")
      .where("email", "==", email)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json(
        { error: "Ya existe una invitación pendiente para este correo" },
        { status: 409 }
      );
    }

    const inviteRef = await adminDb.collection("invitations").add({
      email,
      role: "admin",
      companyId,
      sector,
      color,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: inviteRef.id });
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
