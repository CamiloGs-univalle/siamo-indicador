"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup, signInWithCustomToken, signInWithEmailAndPassword } from "firebase/auth";
import { auth, googleProvider } from "@/frontend/services/firebase";
import { useAuth } from "@/frontend/context/auth-context";
import { I } from "@/frontend/components/icons";

function LoginForm() {
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [activeTab, setActiveTab] = useState<"admin" | "cedula">("admin");
  const [cedula, setCedula] = useState("");
  const [cedulaLoading, setCedulaLoading] = useState(false);
  const [cedulaError, setCedulaError] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminLoginLoading, setAdminLoginLoading] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState("");
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    document.body.className = "trazo " + theme;
  }, [theme]);

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
        "Tu cuenta no tiene acceso todavía. Pide al super administrador que te invite y vuelve a intentar."
      );
      setAttempted(false);
    }
  }, [user, authLoading, attempted, router]);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
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
      setGoogleLoading(false);
    }
  };

  const handleCedulaLogin = async () => {
    if (!cedula.trim()) {
      setCedulaError("Ingresa tu cedula.");
      return;
    }
    setCedulaLoading(true);
    setCedulaError("");
    setError("");
    try {
      const res = await fetch("/api/cedula-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cedula: cedula.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCedulaError(data.error || "Error al iniciar sesion.");
        setCedulaLoading(false);
        return;
      }

      await signInWithCustomToken(auth, data.customToken);
      const firebaseUser = auth.currentUser;
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        document.cookie = `auth-token=${token}; path=/; max-age=3600`;
      }
      setAttempted(true);
    } catch (err: unknown) {
      console.error("Cedula login error:", err);
      setCedulaError("Error al conectar con el servidor. Intenta de nuevo.");
      setCedulaLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    if (!adminEmail.trim() || !adminPassword.trim()) {
      setAdminLoginError("Ingresa tu email y contrasena.");
      return;
    }
    setAdminLoginLoading(true);
    setAdminLoginError("");
    setError("");
    try {
      const result = await signInWithEmailAndPassword(auth, adminEmail.trim(), adminPassword);
      const token = await result.user.getIdToken();
      document.cookie = `auth-token=${token}; path=/; max-age=3600`;
      setAttempted(true);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        setAdminLoginError("Email o contrasena incorrectos.");
      } else {
        setAdminLoginError(error.message || "Error al iniciar sesion.");
      }
      setAdminLoginLoading(false);
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

  if (authLoading && attempted) {
    return (
      <div className="login-shell">
        <div className="login-box" style={{ gridTemplateColumns: "1fr" }}>
          <div className="login-panel" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{
              width: 40, height: 40, border: "3px solid rgba(37,99,235,0.2)",
              borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin 1s linear infinite",
              margin: "0 auto 16px"
            }} />
            <div style={{ fontSize: 14, color: "var(--mut)" }}>Verificando acceso...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <button className="iconbtn" style={{ position: "fixed", top: 20, right: 20, zIndex: 5 }}
        onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
        {theme === "light" ? <I.moon /> : <I.sun />}
      </button>

      <div className="login-box">
        {/* ══════ Decorative brand hero ══════ */}
        <div className="login-hero">
          <div className="login-hero-blob3" />
          <div className="login-hero-top">
            <div className="login-hero-mark"><I.route width={28} height={28} /></div>
            <span className="login-hero-word">Siamo Tools</span>
          </div>
          <div className="login-hero-mid">
            <h2>Gestión y medición operacional, en un solo lugar.</h2>
            <p>Controla zonas, productividad y satisfacción de tu operación en tiempo real.</p>
          </div>
          <div className="login-hero-foot">Acceso restringido a personal autorizado.</div>
        </div>

        {/* ══════ Form panel ══════ */}
        <div className="login-panel">
        <div className="login-panel-inner">
          <div className="login-panel-head">
            <h1>Bienvenido de nuevo</h1>
            <p>Ingresa con tu método de acceso.</p>
          </div>

          {error && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--s-not)", background: "color-mix(in srgb, var(--s-not) 10%, transparent)", color: "var(--s-not)", fontSize: 13 }}>
              {error}
            </div>
          )}

          <div className="login-tabs">
            <button
              type="button"
              className={activeTab === "admin" ? "active" : ""}
              onClick={() => setActiveTab("admin")}
            >
              Administrador
            </button>
            <button
              type="button"
              className={activeTab === "cedula" ? "active" : ""}
              onClick={() => setActiveTab("cedula")}
            >
              Armador
            </button>
          </div>

          {activeTab === "admin" ? (
            <div>
              <div className="login-field">
                <label htmlFor="admin-email">Email</label>
                <input
                  id="admin-email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => { setAdminEmail(e.target.value); setAdminLoginError(""); }}
                  placeholder="tu@correo.com"
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  disabled={adminLoginLoading}
                />
              </div>
              <div className="login-field">
                <label htmlFor="admin-password">Contraseña</label>
                <input
                  id="admin-password"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => { setAdminPassword(e.target.value); setAdminLoginError(""); }}
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  disabled={adminLoginLoading}
                />
              </div>
              {adminLoginError && (
                <div style={{ marginTop: -2, marginBottom: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--s-not)", background: "color-mix(in srgb, var(--s-not) 10%, transparent)", color: "var(--s-not)", fontSize: 12 }}>
                  {adminLoginError}
                </div>
              )}
              <button
                className="login-submit"
                onClick={handleAdminLogin}
                disabled={adminLoginLoading || !adminEmail.trim() || !adminPassword.trim()}
              >
                {adminLoginLoading ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff", borderRadius: "50%", animation: "spin 1s linear infinite",
                      display: "inline-block"
                    }} />
                    Ingresando...
                  </span>
                ) : "Entrar como administrador"}
              </button>

              <div className="login-or">o continúa con</div>
              <button
                type="button"
                className="login-google"
                onClick={handleGoogleLogin}
                disabled={googleLoading}
              >
                <I.google width={18} height={18} />
                {googleLoading ? "Conectando..." : "Google"}
              </button>
            </div>
          ) : (
            <div>
              <div className="login-field">
                <label htmlFor="cedula">Número de cédula</label>
                <input
                  id="cedula"
                  type="text"
                  value={cedula}
                  onChange={(e) => { setCedula(e.target.value); setCedulaError(""); }}
                  placeholder="Ej. 1020304050"
                  onKeyDown={(e) => e.key === "Enter" && handleCedulaLogin()}
                  disabled={cedulaLoading}
                />
              </div>
              {cedulaError && (
                <div style={{ marginTop: -2, marginBottom: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--s-not)", background: "color-mix(in srgb, var(--s-not) 10%, transparent)", color: "var(--s-not)", fontSize: 12 }}>
                  {cedulaError}
                </div>
              )}
              <button
                className="login-submit"
                onClick={handleCedulaLogin}
                disabled={cedulaLoading || !cedula.trim()}
              >
                {cedulaLoading ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff", borderRadius: "50%", animation: "spin 1s linear infinite",
                      display: "inline-block"
                    }} />
                    Ingresando...
                  </span>
                ) : "Entrar con cédula"}
              </button>
            </div>
          )}

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

          <div className="login-foot">Los armadores usan su cédula, los administradores su email y contraseña.</div>
        </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 40, height: 40, border: "3px solid rgba(37,99,235,0.2)", borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin 1s linear infinite" }} /></div>}>
      <LoginForm />
    </Suspense>
  );
}
