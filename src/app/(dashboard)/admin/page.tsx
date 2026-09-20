/**
 * @file app/(dashboard)/admin/page.tsx
 * @description Panel del Administrador.
 * Módulos de gestión: jornada, carga SAP, asignación, mapa, indicadores, etc.
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/frontend/components/icons";
import { AdminNav } from "@/frontend/components/admin-nav";
import { useTheme } from "@/frontend/hooks/use-theme";
import { useAuth } from "@/frontend/context/auth-context";
import { UserMenu } from "@/frontend/components/user-menu";
import { ModCarga } from "@/frontend/components/admin/mod-carga";
import { ModAsignacion } from "@/frontend/components/admin/mod-asignacion";
import { ModEquipo } from "@/frontend/components/admin/mod-equipo";
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

      {/* ─── Grid Admin (Nav + Content) ─────────────────────────── */}
      <div className="grid-admin">
        <AdminNav mod={mod} setMod={setMod} />
        <div>
          {mod === "pantalla" && <ModPantalla />}
          {mod === "carga" && <ModCarga />}
          {mod === "asignacion" && <ModAsignacion />}
          {mod === "equipo" && <ModEquipo />}
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

      <div className="footnote">
        Siamo.Indicador · Panel de administrador
      </div>
    </div>
  );
}
