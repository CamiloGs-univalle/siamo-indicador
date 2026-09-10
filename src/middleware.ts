import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rutas que requieren autenticación
const PROTECTED_ROUTES = ["/super-admin", "/admin", "/armador"];

// Rutas públicas (login)
const PUBLIC_ROUTES = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Verificar si es ruta protegida
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  // Si es ruta protegida, verificar token en cookies
  if (isProtected) {
    const token = request.cookies.get("auth-token")?.value;
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Si está en login y ya tiene token, redirigir según el rol
  if (isPublic) {
    const token = request.cookies.get("auth-token")?.value;
    if (token) {
      // Check demo role first
      const demoRole = request.cookies.get("demo-role")?.value;
      if (demoRole) {
        switch (demoRole) {
          case "super-admin":
            return NextResponse.redirect(new URL("/super-admin", request.url));
          case "admin":
            return NextResponse.redirect(new URL("/admin", request.url));
          case "armador":
            return NextResponse.redirect(new URL("/armador", request.url));
        }
      }
      // For real tokens, default to super-admin (client-side will correct)
      return NextResponse.redirect(new URL("/super-admin", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
