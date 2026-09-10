import { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import type { DecodedIdToken } from "firebase-admin/auth";

/**
 * Error tipado para respuestas de las rutas API: incluye el status HTTP
 * que debe devolverse (401 sin token / token inválido, 403 sin permiso).
 */
export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Extrae y verifica el ID token de Firebase enviado como
 * `Authorization: Bearer <token>`. Lanza AuthError(401, ...) si falta
 * o no es válido. Usa el Admin SDK, por lo que corre solo en servidor.
 */
export async function verifyRequest(request: NextRequest): Promise<DecodedIdToken> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    throw new AuthError(401, "Falta el token de autenticación");
  }

  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    throw new AuthError(401, "Token inválido o expirado");
  }
}

/** Lista de emails de super admin configurados vía SUPER_ADMIN_EMAILS (separados por coma). */
export function getSuperAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return getSuperAdminEmails().includes(email.toLowerCase());
}
