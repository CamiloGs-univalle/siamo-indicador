/**
 * @file app/(dashboard)/admin/page.tsx
 * @description Panel del Administrador.
 * Módulos de gestión: jornada, carga SAP, asignación, mapa, indicadores, etc.
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/components/icons";
import { AdminNav } from "@/components/admin-nav";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth-context";
import { UserMenu } from "@/components/user-menu";
import { ModJornada } from "@/components/admin/mod-jornada";
import { ModCarga } from "@/components/admin/mod-carga";
import { ModAsignacion } from "@/components/admin/mod-asignacion";
import { ModEquipo } from "@/components/admin/mod-equipo";
import { ModMapa } from "@/components/admin/mod-mapa";
import { ModIndicadores } from "@/components/admin/mod-indicadores";
import { ModDesempeno } from "@/components/admin/mod-desempeno";
import { ModReportes } from "@/components/admin/mod-reportes";
import { ModQR } from "@/components/admin/mod-qr";
import { ModPicking } from "@/components/admin/mod-picking";
import { ModConfiguracion } from "@/components/admin/mod-configuracion";
import { getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const MODULE_TITLES: Record<string, string> = {
  jornada: "Crear jornada",
  carga: "Carga de trabajo (SAP)",
  asignacion: "Asignación de recorridos",
  equipo: "Gestión de equipo",
  mapa: "Operación en tiempo real",
  indicadores: "Indicadores de productividad",
  desempeno: "Desempeño y reconocimiento",
  reportes: "Reportes",
  qr: "QR de zonas",
  picking: "Picking",
  configuracion: "Configuración",
};

export default function AdminPage() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [mod, setMod] = useState("mapa");
  const [companyName, setCompanyName] = useState<string | null>(null);

  useEffect(() => {
    if (user?.companyId) {
      getDoc(doc(db, "companies", user.companyId)).then((snap) => {
        if (snap.exists()) {
          setCompanyName(snap.data().name || null);
        }
      }).catch(() => {});
    }
  }, [user?.companyId]);

  const displayName = user?.name || "Administrador";
  const displayEmail = user?.email || "";

  return (
    <div className="shell">
      {/* ─── Topbar ─────────────────────────────────────────────── */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark"><I.route /></div>
          <div>
            <div className="brand-name">{companyName || "Siamo.Indicador"}</div>
            <div className="brand-sub">Siamo.Indicador · Medición operacional</div>
          </div>
        </div>
        <div className="top-right">
          <button className="iconbtn" onClick={toggleTheme}>
            {theme === "light" ? <I.moon /> : <I.sun />}
          </button>
          <UserMenu
            name={displayName}
            email={displayEmail}
            role="Administrador"
            color={user?.color || "#7C3AED"}
          />
        </div>
      </div>

      {/* ─── View Header ────────────────────────────────────────── */}
      <div className="viewhead">
        <h1>{MODULE_TITLES[mod]}</h1>
        <span className="who">
                    {companyName || user?.companyId ? (companyName || "Empresa") : "Sin empresa asignada"} · {new Date().toLocaleDateString("es-CO")}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          {mod === "mapa" && (
            <span className="live"><span className="pulse" />En vivo</span>
          )}
        </div>
      </div>

      {/* ─── Grid Admin (Nav + Content) ─────────────────────────── */}
      <div className="grid-admin">
        <AdminNav mod={mod} setMod={setMod} />
        <div>
          {mod === "jornada" && <ModJornada />}
          {mod === "carga" && <ModCarga />}
          {mod === "asignacion" && <ModAsignacion />}
          {mod === "equipo" && <ModEquipo />}
          {mod === "mapa" && <ModMapa />}
          {mod === "indicadores" && <ModIndicadores />}
          {mod === "desempeno" && <ModDesempeno />}
          {mod === "reportes" && <ModReportes />}
          {mod === "qr" && <ModQR />}
          {mod === "picking" && <ModPicking />}
          {mod === "configuracion" && <ModConfiguracion />}
        </div>
      </div>

      <div className="footnote">
        Siamo.Indicador · Panel de administrador
      </div>
    </div>
  );
}
