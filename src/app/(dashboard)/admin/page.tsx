/**
 * @file app/(dashboard)/admin/page.tsx
 * @description Panel del Administrador.
 * Módulos de gestión: jornada, carga SAP, asignación, mapa, indicadores, etc.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { I } from "@/frontend/components/icons";
import { NavRail } from "@/frontend/components/nav-rail";
import { useTheme } from "@/frontend/hooks/use-theme";
import { useAuth } from "@/frontend/context/auth-context";
import { UserMenu } from "@/frontend/components/user-menu";
import { ModCarga } from "@/frontend/components/admin/mod-carga";
import { ModArmador } from "@/frontend/components/admin/mod-armador";
import { ModMapa } from "@/frontend/components/admin/mod-mapa";
import { ModIndicadores } from "@/frontend/components/admin/mod-indicadores";
import { ModDesempeno } from "@/frontend/components/admin/mod-desempeno";
import { ModReportes } from "@/frontend/components/admin/mod-reportes";
import { ModZonas } from "@/frontend/components/admin/mod-zonas";
import { ModMembretes } from "@/frontend/components/admin/mod-membretes";
import { ModAnaliticas } from "@/frontend/components/admin/mod-analiticas";
import { ModPantalla } from "@/frontend/components/admin/mod-pantalla";
import { ModQR } from "@/frontend/components/admin/mod-qr";
import { ModHistorial } from "@/frontend/components/admin/mod-historial";
import { ModConfiguracion } from "@/frontend/components/admin/mod-configuracion";
import { getDoc, doc } from "firebase/firestore";
import { db } from "@/frontend/services/firebase";

export default function AdminPage() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [mod, setMod] = useState("mapa");
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

  // ─── RBAC: solo admin y super_admin pueden ver este panel ────────────
  const router = useRouter();
  const { loading: authLoading } = useAuth();
  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // middleware ya redirige a /login si no hay token
    if (user.role !== "admin" && user.role !== "super_admin") {
      const target = user.role === "armador" ? "/armador" : "/login";
      router.replace(target);
    }
  }, [user, authLoading, router]);

  // Alto real del topbar, medido en vivo — la barra lateral lo usa para
  // saber dónde empezar sin taparlo, incluso si se envuelve en dos líneas
  // en pantallas angostas.
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const [topbarH, setTopbarH] = useState(60);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setTopbarH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (user?.companyId) {
      getDoc(doc(db, "companies", user.companyId)).then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          setCompanyName(data.name || null);
          setCompanyLogoUrl(data.logoUrl || null);
        }
      }).catch(() => {});
    }
  }, [user?.companyId]);

  const displayName = user?.name || "Administrador";
  const displayEmail = user?.email || "";

  return (
    <div
      className="shell"
      style={{
        ["--navrail-w" as string]: navCollapsed ? "80px" : "238px",
        ["--topbar-h" as string]: `${topbarH}px`,
      } as React.CSSProperties}
    >
      <NavRail mod={mod} setMod={setMod} onCollapsedChange={setNavCollapsed} />

      {/* ─── Topbar ─────────────────────────────────────────────── */}
      <div className="topbar" ref={topbarRef}>
        <div className="brand">
          {companyLogoUrl ? (
            <img src={companyLogoUrl} alt={companyName || "Empresa"} style={{ width:56, height:38, borderRadius:10, objectFit:"contain", background:"#fff", border:"1px solid var(--line)", padding:"4px 6px", boxShadow:"var(--shadow)", flex:"none" }} />
          ) : (
            <div className="brand-mark"><I.route /></div>
          )}
          <div>
            <div className="brand-name">{companyName || "Siamo.Indicador"}</div>
            <div className="brand-sub">Sistema de Gestión Operativa</div>
          </div>
        </div>
        <div className="top-right">
          <button className="iconbtn" onClick={toggleTheme}>
            {theme === "light" ? <I.moon /> : <I.sun />}
          </button>
          <UserMenu
            name={displayName}
            email={displayEmail}
            role={user?.role === "super_admin" ? "Super Administrador" : user?.role === "admin" ? "Administrador" : user?.role === "armador" ? "Armador" : "Administrador"}
            color={user?.color || "#7C3AED"}
            showSettings
            onSettings={() => setMod("configuracion")}
          />
        </div>
      </div>

      {/* ─── Contenido (la barra ahora es <NavRail>, flotante) ──── */}
      <div className="grid-admin">
        <div style={{ minWidth: 0, overflowY: "auto", maxHeight: "calc(100vh - 52px)" }}>
          {mod === "pantalla" && <ModPantalla />}
          {mod === "carga" && <ModCarga />}
          {mod === "armador" && <ModArmador />}
          {mod === "mapa" && <ModMapa />}
          {mod === "zonas" && <ModZonas />}
          {mod === "membretes" && <ModMembretes />}
          {mod === "analiticas" && <ModAnaliticas />}
          {mod === "indicadores" && <ModIndicadores />}
          {mod === "desempeno" && <ModDesempeno />}
          {mod === "reportes" && <ModReportes />}
          {mod === "qr" && <ModQR />}
          {mod === "historial" && <ModHistorial />}
          {mod === "configuracion" && <ModConfiguracion />}
        </div>
      </div>

    </div>
  );
}
