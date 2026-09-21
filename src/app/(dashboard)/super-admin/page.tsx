/**
 * @file app/(dashboard)/super-admin/page.tsx
 * @description Panel del Super Administrador.
 * Gestión de empresas y administradores.
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/frontend/components/icons";
import { useTheme } from "@/frontend/hooks/use-theme";
import { useAuth } from "@/frontend/context/auth-context";
import { UserMenu } from "@/frontend/components/user-menu";
import {
  getCompanies,
  createCompany,
  deleteCompanyCascade,
  getAdminsByCompany,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  type Company,
} from "@/frontend/services/firestore";
import type { AppUser } from "@/frontend/context/auth-context";

export default function SuperAdminPage() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [admins, setAdmins] = useState<Record<string, AppUser[]>>({});
  const [loading, setLoading] = useState(true);

  const [showNewCompany, setShowNewCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyAddress, setNewCompanyAddress] = useState("");
  const [showNewAdmin, setShowNewAdmin] = useState<string | null>(null);
  const [newAdminName, setNewAdminName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");

  const [editingAdmin, setEditingAdmin] = useState<AppUser | null>(null);
  const [editAdminName, setEditAdminName] = useState("");
  const [editAdminEmail, setEditAdminEmail] = useState("");

  const [demoUser, setDemoUser] = useState<{ name: string; email: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Auto-clear toast after 4 seconds
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    const demoRole = document.cookie.split("; ").find(row => row.startsWith("demo-role="))?.split("=")[1];
    if (demoRole === "super-admin" && !user) {
      setDemoUser({ name: "Super Administrador", email: "demo@siamo.com" });
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const comps = await getCompanies();
      setCompanies(comps);
      const adminsMap: Record<string, AppUser[]> = {};
      for (const comp of comps) {
        if (comp.id) {
          adminsMap[comp.id] = await getAdminsByCompany(comp.id);
        }
      }
      setAdmins(adminsMap);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCompany() {
    if (!newCompanyName.trim()) return;
    try {
      const companyData: { name: string; address?: string; createdBy?: string } = {
        name: newCompanyName.trim(),
      };
      if (newCompanyAddress.trim()) companyData.address = newCompanyAddress.trim();
      if (user?.uid) companyData.createdBy = user.uid;
      await createCompany(companyData);
      setNewCompanyName("");
      setNewCompanyAddress("");
      setShowNewCompany(false);
      setToast({ message: "Empresa creada exitosamente", type: "success" });
      await loadData();
    } catch (error) {
      console.error("Error creating company:", error);
      setToast({ message: "No se pudo crear la empresa", type: "error" });
    }
  }

  async function handleCreateAdmin(companyId: string) {
    const email = newAdminEmail.trim();
    const name = newAdminName.trim();
    if (!email || !name) return;
    try {
      const adminCount = admins[companyId]?.length || 0;
      const result = await createAdmin({
        name,
        email,
        companyId,
        color: ["#0E7C7B", "#7C3AED", "#D97706", "#DC2626", "#16A34A"][adminCount % 5],
      });
      if (!result.ok) {
        console.error("Error creating admin:", result.error);
        setToast({ message: result.error || "No se pudo crear el administrador", type: "error" });
        return;
      }
      setToast({
        message: result.message || `Administrador ${name} creado exitosamente`,
        type: "success",
      });
      setNewAdminName("");
      setNewAdminEmail("");
      setShowNewAdmin(null);
      await loadData();
    } catch (error) {
      console.error("Error creating admin:", error);
    }
  }

  async function handleDeleteCompany(companyId: string) {
    if (!window.confirm("¿Eliminar esta empresa y todos sus datos?")) return;
    try {
      await deleteCompanyCascade(companyId);
      setToast({ message: "Empresa eliminada correctamente", type: "success" });
      await loadData();
    } catch (error) {
      console.error("Error deleting company:", error);
      setToast({ message: "No se pudo eliminar la empresa", type: "error" });
    }
  }

  function startEditAdmin(admin: AppUser) {
    setEditingAdmin(admin);
    setEditAdminName(admin.name || "");
    setEditAdminEmail(admin.email || "");
  }

  async function handleUpdateAdmin() {
    if (!editingAdmin?.uid) return;
    const name = editAdminName.trim();
    const email = editAdminEmail.trim();
    if (!name || !email) return;
    try {
      const result = await updateAdmin(editingAdmin.uid, { name, email });
      if (!result.ok) {
        setToast({ message: result.error || "No se pudo actualizar el administrador", type: "error" });
        return;
      }
      setToast({ message: "Administrador actualizado correctamente", type: "success" });
      setEditingAdmin(null);
      setEditAdminName("");
      setEditAdminEmail("");
      await loadData();
    } catch (error) {
      console.error("Error updating admin:", error);
      setToast({ message: "No se pudo actualizar el administrador", type: "error" });
    }
  }

  async function handleDeleteAdmin(uid: string, name: string) {
    if (!window.confirm(`¿Eliminar al administrador "${name}"? Esta acción no se puede deshacer.`)) return;
    try {
      const result = await deleteAdmin(uid);
      if (!result.ok) {
        setToast({ message: result.error || "No se pudo eliminar el administrador", type: "error" });
        return;
      }
      setToast({ message: "Administrador eliminado correctamente", type: "success" });
      await loadData();
    } catch (error) {
      console.error("Error deleting admin:", error);
      setToast({ message: "No se pudo eliminar el administrador", type: "error" });
    }
  }

  const totalAdmins = Object.values(admins).flat().length;
  const displayName = user?.name || demoUser?.name || "Super Administrador";
  const displayEmail = user?.email || demoUser?.email || "";

  return (
    <div className="shell">
      {/* ─── Toast ──────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: toast.type === "success" ? "color-mix(in srgb, var(--s-done) 15%, var(--panel))" : "color-mix(in srgb, var(--s-not) 15%, var(--panel))",
          color: toast.type === "success" ? "var(--s-done)" : "var(--s-not)",
          border: `1px solid ${toast.type === "success" ? "var(--s-done)" : "var(--s-not)"}`,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        }}>
          {toast.message}
        </div>
      )}

      {/* ─── Topbar ─────────────────────────────────────────────── */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark"><I.route /></div>
          <div>
            <div className="brand-name">Siamo.Indicador</div>
            <div className="brand-sub">Medición operacional</div>
          </div>
        </div>
        <div className="top-right">
          <button className="iconbtn" onClick={toggleTheme}>
            {theme === "light" ? <I.moon /> : <I.sun />}
          </button>
          <UserMenu
            name={displayName}
            email={displayEmail}
            role="Super Administrador"
            color="#0E7C7B"
          />
        </div>
      </div>

      {/* ─── View Header ────────────────────────────────────────── */}
      <div className="viewhead">
        <h1>Panel de plataforma</h1>
        <span className="who">Super administrador · todas las operaciones</span>
        <span className="live"><span className="pulse" />En vivo</span>
      </div>

      {/* ─── KPIs ───────────────────────────────────────────────── */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
        <Kpi accent="var(--accent)" icon={<I.map />} lab="Empresas activas" val={companies.length} />
        <Kpi accent="var(--s-assigned)" icon={<I.users />} lab="Administradores" val={totalAdmins} />
        <Kpi accent="var(--s-done)" icon={<I.box />} lab="Sesiones hoy" val="--" />
        <Kpi accent="var(--s-inc)" icon={<I.alert />} lab="Pendientes" val="0" />
      </div>

      {/* ─── Contenido ──────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
        {/* Lista de empresas */}
        <div className="panel">
          <div className="panel-h">
            <h3>Empresas</h3>
            <button className="btn primary sm" onClick={() => setShowNewCompany(true)}>
              + Nueva empresa
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando...</div>
          ) : companies.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🏭</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Sin empresas registradas</div>
              <div style={{ fontSize: 13, color: "var(--mut)", marginBottom: 20 }}>Crea la primera empresa para comenzar</div>
              <button className="btn primary" onClick={() => setShowNewCompany(true)}>
                + Crear empresa
              </button>
            </div>
          ) : (
            companies.map((comp, i) => (
              <div key={comp.id} style={{ padding: "16px", borderBottom: i < companies.length - 1 ? "1px solid var(--line)" : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <span className="avatar" style={{ background: "var(--accent)", width: 40, height: 40, fontSize: 16 }}>
                    {comp.name[0]}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{comp.name}</div>
                    <div style={{ fontSize: 12, color: "var(--faint)" }}>{comp.address || "Sin dirección"}</div>
                  </div>
                  <button className="btn sm" style={{ color: "var(--s-not)" }} onClick={() => handleDeleteCompany(comp.id!)}>
                    Eliminar
                  </button>
                </div>

                {/* Administradores */}
                <div style={{ marginLeft: 52 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--faint)", marginBottom: 8 }}>
                    Administradores ({admins[comp.id!]?.length || 0})
                  </div>
                  {admins[comp.id!]?.map((admin) => (
                    <div key={admin.uid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                      <span className="avatar" style={{ background: admin.color || "var(--s-inc)", width: 28, height: 28, fontSize: 11 }}>
                        {admin.name[0]}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{admin.name}</div>
                        <div style={{ fontSize: 11, color: "var(--faint)" }}>{admin.email}</div>
                      </div>
                      <button
                        className="btn sm"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                        onClick={() => startEditAdmin(admin)}
                        title="Editar administrador"
                      >
                        Editar
                      </button>
                      <button
                        className="btn sm"
                        style={{ fontSize: 11, padding: "3px 8px", color: "var(--s-not)" }}
                        onClick={() => handleDeleteAdmin(admin.uid!, admin.name)}
                        title="Eliminar administrador"
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                  <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setShowNewAdmin(comp.id!)}>
                    + Agregar administrador
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: "grid", gap: 16 }}>
          {showNewCompany && (
            <div className="panel">
              <div className="panel-h"><h3>Nueva empresa</h3></div>
              <div style={{ padding: 16 }}>
                <div className="field">
                  <label>Nombre de la empresa</label>
                  <input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Ej. Coca Cola FEMSA" />
                </div>
                <div className="field">
                  <label>Dirección (opcional)</label>
                  <input value={newCompanyAddress} onChange={(e) => setNewCompanyAddress(e.target.value)} placeholder="Ej. Funza, Cundinamarca" />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" style={{ flex: 1 }} onClick={handleCreateCompany}>Crear empresa</button>
                  <button className="btn" onClick={() => setShowNewCompany(false)}>Cancelar</button>
                </div>
              </div>
            </div>
          )}

          {showNewAdmin && (
            <div className="panel">
              <div className="panel-h"><h3>Nuevo administrador</h3></div>
              <div style={{ padding: 16 }}>
                <div className="field">
                  <label>Nombre completo</label>
                  <input value={newAdminName} onChange={(e) => setNewAdminName(e.target.value)} placeholder="Ej. María García" />
                </div>
                <div className="field">
                  <label>Correo electrónico</label>
                  <input type="email" value={newAdminEmail} onChange={(e) => setNewAdminEmail(e.target.value)} placeholder="Ej. maria@empresa.co" />
                </div>
                <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12, padding: "8px 12px", background: "var(--panel2)", borderRadius: 8 }}>
                  Se creará la cuenta directamente. El administrador accede con su email y una contraseña temporal que se le mostrará.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" style={{ flex: 1 }} onClick={() => handleCreateAdmin(showNewAdmin)}>Crear administrador</button>
                  <button className="btn" onClick={() => setShowNewAdmin(null)}>Cancelar</button>
                </div>
              </div>
            </div>
          )}

          {editingAdmin && (
            <div className="panel">
              <div className="panel-h"><h3>Editar administrador</h3></div>
              <div style={{ padding: 16 }}>
                <div className="field">
                  <label>Nombre completo</label>
                  <input value={editAdminName} onChange={(e) => setEditAdminName(e.target.value)} placeholder="Nombre del administrador" />
                </div>
                <div className="field">
                  <label>Correo electrónico</label>
                  <input type="email" value={editAdminEmail} onChange={(e) => setEditAdminEmail(e.target.value)} placeholder="correo@empresa.co" />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary" style={{ flex: 1 }} onClick={handleUpdateAdmin}>Guardar cambios</button>
                  <button className="btn" onClick={() => setEditingAdmin(null)}>Cancelar</button>
                </div>
              </div>
            </div>
          )}

          {!showNewCompany && !showNewAdmin && !editingAdmin && (
            <div className="panel">
              <div className="panel-h"><h3>¿Cómo funciona?</h3></div>
              <div style={{ padding: 16, fontSize: 12.5, color: "var(--mut)", lineHeight: 1.7 }}>
                <p><b>1.</b> Crea una empresa (ej. Coca Cola FEMSA)</p>
                <p><b>2.</b> Agrega administradores con su correo</p>
                <p><b>3.</b> Cada admin crea sus zonas y gestiona su equipo</p>
                <p><b>4.</b> Los armadores escanean QR en sus zonas</p>
                <p><b>5.</b> El sistema mide productividad en tiempo real</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="footnote">Siamo.Indicador · Panel de administración de plataforma</div>
    </div>
  );
}

function Kpi({ lab, val, unit, icon, accent }: {
  lab: string; val: string | number; unit?: string; icon?: React.ReactNode; accent: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-accent" style={{ background: accent }} />
      <div className="lab">
        {icon && <span style={{ color: accent, display: "grid", placeItems: "center" }}>{icon}</span>}
        {lab}
      </div>
      <div className="val mono">{val}{unit && <span className="u">{unit}</span>}</div>
    </div>
  );
}
