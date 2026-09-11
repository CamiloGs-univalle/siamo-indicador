"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { I } from "@/components/icons";

function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    document.body.className = "trazo " + theme;
  }, [theme]);

  //(auth-context resuelve el usuario vía /api/claim-invite).
  // Si hay usuario, redirigimos según su rol real.
  // Si ya intentamos login y no quedó usuario, mostramos error.
  useEffect(() => {
    if (authLoading) return;

    if (user) {
      switch (user.role) {
        case "super_admin": router.replace("/super-admin"); break;
        case "admin": router.replace("/admin"); break;
        case "armador": router.replace("/armador"); break;
      }
      return;
    }

    if (attempted) {
      setError(
        "Tu cuenta de Google no tiene acceso todavía. Pide al super administrador que te invite y vuelve a intentar."
      );
      setLoading(false);
      setAttempted(false);
    }
  }, [user, authLoading, attempted, router]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const token = await result.user.getIdToken();
      document.cookie = `auth-token=${token}; path=/; max-age=3600`;
      setAttempted(true);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "auth/popup-closed-by-user") {
        setError("Se cerró la ventana de inicio de sesión. Intenta de nuevo.");
      } else if (error.code === "auth/cancelled-popup-request") {
        setError("Se canceló el inicio de sesión. Intenta de nuevo.");
      } else {
        setError(error.message || "Error al iniciar sesión con Google");
      }
      setLoading(false);
    }
  };

  const handleDemo = (role: string) => {
    document.cookie = `auth-token=demo-${role}; path=/; max-age=3600`;
    document.cookie = `demo-role=${role}; path=/; max-age=3600`;
    switch (role) {
      case "super-admin": router.push("/super-admin"); break;
      case "admin": router.push("/admin"); break;
      case "armador": router.push("/armador"); break;
    }
  };

  // Mostrar spinner mientras auth-context resuelve el rol
  if (authLoading && attempted) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: "center", padding: "60px 40px" }}>
          <div style={{
            width: 40, height: 40, border: "3px solid rgba(42,179,166,0.2)",
            borderTopColor: "#2AB3A6", borderRadius: "50%", animation: "spin 1s linear infinite",
            margin: "0 auto 16px"
          }} />
          <div style={{ fontSize: 14, color: "var(--mut)" }}>Verificando acceso...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <button className="iconbtn" style={{ position: "fixed", top: 20, right: 20 }}
        onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
        {theme === "light" ? <I.moon /> : <I.sun />}
      </button>
      <div className="login-card">
        <div className="lm"><I.route /></div>
        <h1>Siamo.Indicador</h1>
        <p>Sistema de gestión y medición operacional. Ingresa con la cuenta de tu organización.</p>

        {error && (
          <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--s-not)", background: "color-mix(in srgb, var(--s-not) 10%, transparent)", color: "var(--s-not)", fontSize: 13 }}>
            {error}
          </div>
        )}

        <button className="gbtn" onClick={handleGoogleLogin} disabled={loading}>
          <I.google /> {loading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff", borderRadius: "50%", animation: "spin 1s linear infinite",
                display: "inline-block"
              }} />
              Conectando...
            </span>
          ) : "Continuar con Google"}
        </button>

        {process.env.NEXT_PUBLIC_DEMO_ENABLED === "true" && (
          <>
            <div className="login-hr">demo rápido · entrar como</div>
            <div className="demo-roles">
              <button onClick={() => handleDemo("super-admin")}>Super admin</button>
              <button onClick={() => handleDemo("admin")}>Administrador</button>
              <button onClick={() => handleDemo("armador")}>Armador</button>
            </div>
          </>
        )}

        <div className="login-foot">Acceso restringido a dominios autorizados por el super administrador.</div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-wrap"><div style={{ width: 40, height: 40, border: "3px solid rgba(42,179,166,0.2)", borderTopColor: "#2AB3A6", borderRadius: "50%", animation: "spin 1s linear infinite" }} /></div>}>
      <LoginForm />
    </Suspense>
  );
}
