import { NextRequest, NextResponse } from "next/server";

/**
 * Controlador de /api/auth — establece o borra la cookie httpOnly de sesión.
 *
 * @deprecated Este endpoint no es invocado por ningún componente del
 * frontend actual (el mecanismo de sesión real usa una cookie no-httpOnly
 * establecida directamente en `login/page.tsx`, ver ARQUITECTURA.md §5.3–5.4).
 * Se conserva tal cual durante la reorganización de carpetas para no alterar
 * comportamiento; su reconexión (o eliminación) es una decisión de producto,
 * no de esta reorganización.
 */
export async function setAuthCookie(request: NextRequest) {
  const { token } = await request.json();

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60, // 1 hora
    path: "/",
  });

  return response;
}

export async function clearAuthCookie() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("auth-token");
  return response;
}
