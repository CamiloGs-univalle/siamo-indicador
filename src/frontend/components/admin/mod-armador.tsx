/**
 * @file components/admin/mod-armador.tsx
 * @description Módulo unificado "Armador" — Gestión de equipo + Asignación + Jornada.
 *
 * Combina las funcionalidades de los anteriores módulos Equipo y Asignación:
 * 1. Control de jornada (iniciar/pausar/reanudar/finalizar)
 * 2. CRUD de armadores (crear, editar, eliminar)
 * 3. Asignación de armadores a zonas
 * 4. Roster en tiempo real con estado actual
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/frontend/components/icons";
import { useAuth } from "@/frontend/context/auth-context";
import {
  subscribeZones,
  subscribeArmadores,
  subscribeMembretes,
  createArmador,
  updateArmador,
  deleteArmador,
  assignArmadorToZone,
  unassignArmadorFromZone,
  getCompany,
  iniciarJornada,
  pausarJornada,
  reanudarJornada,
  finalizarJornada,
} from "@/frontend/services/firestore";
import type { Zone, Armador, Membrete } from "@/types";

const AVATAR_COLORS = ["#0E7C7B", "#7C3AED", "#D97706", "#DC2626", "#16A34A", "#2563EB"];

interface JornadaState {
  jornadaActiva: boolean;
  jornadaStartedAt?: number;
  jornadaPausedAt?: number | null;
}

type EditingState = Armador | "new" | null;

export function ModArmador() {
  const { user } = useAuth();

  // ─── Data ────────────────────────────────────────────────────────────────
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [armadoresLoaded, setArmadoresLoaded] = useState(false);

  // ─── Jornada ─────────────────────────────────────────────────────────────
  const [jornada, setJornada] = useState<JornadaState>({ jornadaActiva: false });
  const [jornadaLoading, setJornadaLoading] = useState(false);
  const [companyShifts, setCompanyShifts] = useState<{ label: string; inicio: string; fin: string }[]>([]);
  const [selectedShiftIdx, setSelectedShiftIdx] = useState(0);

  // ─── Armador form ────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<EditingState>(null);
  const [formName, setFormName] = useState("");
  const [formCedula, setFormCedula] = useState("");
  const [formCostPerHour, setFormCostPerHour] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ─── Assignment ──────────────────────────────────────────────────────────
  const [pickZoneCode, setPickZoneCode] = useState("");
  const [pickArmadorId, setPickArmadorId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [savingArmadorId, setSavingArmadorId] = useState<string | null>(null);

  // ─── Messages ────────────────────────────────────────────────────────────
  const [msg, setMsg] = useState<string | null>(null);

  // ─── Subscriptions ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.companyId) return;
    const unsubZones = subscribeZones(user.companyId, setZones);
    const unsubArmadores = subscribeArmadores(user.companyId, (a) => {
      setArmadores(a);
      setArmadoresLoaded(true);
    });
    const unsubMembretes = subscribeMembretes(user.companyId, setMembretes);

    getCompany(user.companyId).then((c) => {
      if (c) {
        setJornada({
          jornadaActiva: c.jornadaActiva || false,
          jornadaStartedAt: c.jornadaStartedAt,
          jornadaPausedAt: c.jornadaPausedAt,
        });
        const shifts: { label: string; inicio: string; fin: string }[] = [];
        if (c.turnoMananaInicio && c.turnoMananaFin) shifts.push({ label: "Mañana", inicio: c.turnoMananaInicio, fin: c.turnoMananaFin });
        if (c.turnoTardeInicio && c.turnoTardeFin) shifts.push({ label: "Tarde", inicio: c.turnoTardeInicio, fin: c.turnoTardeFin });
        if (c.turnoNocheInicio && c.turnoNocheFin) shifts.push({ label: "Noche", inicio: c.turnoNocheInicio, fin: c.turnoNocheFin });
        setCompanyShifts(shifts);
        const now = new Date().getHours();
        const matchIdx = shifts.findIndex((s) => {
          const startH = Number(s.inicio.split(":")[0]);
          const endH = Number(s.fin.split(":")[0]);
          if (startH < endH) return now >= startH && now < endH;
          return now >= startH || now < endH;
        });
        if (matchIdx >= 0) setSelectedShiftIdx(matchIdx);
      }
    });

    return () => {
      unsubZones();
      unsubArmadores();
      unsubMembretes();
    };
  }, [user?.companyId]);

  // ─── Computed ────────────────────────────────────────────────────────────
  const armadoresAsignados = armadores.filter((a) => a.zonaAsignadaCode);
  const armadoresActivos = armadores.filter((a) => membretes.some((m) => m.armadorId === a.id && m.status === "active"));
  const membretesPendientes = membretes.filter((m) => m.status === "pending" && !m.armadorId);
  const membretesActivos = membretes.filter((m) => m.status === "active");
  const membretesCompletados = membretes.filter((m) => m.status === "completed");

  const queueByZoneCode: Record<string, number> = {};
  membretes.forEach((m) => {
    if (!m.armadorId && m.status === "pending" && m.zonaCode) {
      queueByZoneCode[m.zonaCode] = (queueByZoneCode[m.zonaCode] || 0) + 1;
    }
  });
  const sortedZonesByQueue = [...zones].sort(
    (a, b) => (queueByZoneCode[b.code] || 0) - (queueByZoneCode[a.code] || 0) || a.code.localeCompare(b.code)
  );

  const sortedArmadores = [...armadores].sort((a, b) => {
    const diff = (a.zonaAsignadaCode ? 0 : 1) - (b.zonaAsignadaCode ? 0 : 1);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  const isPaused = !!jornada.jornadaPausedAt;
  const isActive = jornada.jornadaActiva && !isPaused;

  function activeMembreteOf(armadorId: string): Membrete | undefined {
    return membretes.find((m) => m.armadorId === armadorId && m.status === "active");
  }

  // ─── Jornada handlers ────────────────────────────────────────────────────
  async function handleIniciarJornada() {
    if (!user?.companyId) return;
    if (companyShifts.length === 0) {
      setMsg("No hay turnos configurados. Ve a Configuración para definir los turnos.");
      return;
    }
    setJornadaLoading(true);
    try {
      const shift = companyShifts[selectedShiftIdx];
      await iniciarJornada(user.companyId, { uid: user.uid, name: user.name }, { inicio: shift.inicio, fin: shift.fin });
      setJornada({ jornadaActiva: true, jornadaStartedAt: Date.now(), jornadaPausedAt: null });
      setMsg(`Jornada iniciada en turno ${shift.label} (${shift.inicio} → ${shift.fin}).`);
    } catch {
      setMsg("Error al iniciar la jornada.");
    } finally {
      setJornadaLoading(false);
    }
  }

  async function handlePausarJornada() {
    if (!user?.companyId) return;
    setJornadaLoading(true);
    try {
      await pausarJornada(user.companyId, { uid: user.uid, name: user.name });
      setJornada((prev) => ({ ...prev, jornadaPausedAt: Date.now() }));
      setMsg("Jornada pausada.");
    } catch {
      setMsg("Error al pausar la jornada.");
    } finally {
      setJornadaLoading(false);
    }
  }

  async function handleReanudarJornada() {
    if (!user?.companyId) return;
    setJornadaLoading(true);
    try {
      await reanudarJornada(user.companyId, { uid: user.uid, name: user.name });
      setJornada((prev) => ({ ...prev, jornadaPausedAt: null }));
      setMsg("Jornada reanudada.");
    } catch {
      setMsg("Error al reanudar la jornada.");
    } finally {
      setJornadaLoading(false);
    }
  }

  async function handleFinalizarJornada() {
    if (!user?.companyId) return;
    if (!confirm("¿Estás seguro de finalizar la jornada? Los armadores no podrán tomar más membretes.")) return;
    setJornadaLoading(true);
    try {
      await finalizarJornada(user.companyId, { uid: user.uid, name: user.name });
      setJornada({ jornadaActiva: false, jornadaPausedAt: null });
      setMsg("Jornada finalizada.");
    } catch {
      setMsg("Error al finalizar la jornada.");
    } finally {
      setJornadaLoading(false);
    }
  }

  // ─── Armador CRUD handlers ───────────────────────────────────────────────
  function openNew() {
    setEditing("new");
    setFormName("");
    setFormCedula("");
    setFormCostPerHour("");
    setFormError(null);
  }

  function openEdit(arm: Armador) {
    setEditing(arm);
    setFormName(arm.name);
    setFormCedula(arm.cedula || "");
    setFormCostPerHour(arm.costPerHour ?? "");
    setFormError(null);
  }

  function closeForm() {
    setEditing(null);
    setFormError(null);
  }

  async function handleSave() {
    if (!user?.companyId) return;
    const name = formName.trim();
    if (!name) { setFormError("El nombre es obligatorio."); return; }
    const cedula = formCedula.trim();
    if (!cedula) { setFormError("La cédula es obligatoria."); return; }
    const editingId = editing && editing !== "new" ? editing.id : undefined;
    const existing = armadores.find((a) => a.cedula === cedula && a.id !== editingId);
    if (existing) { setFormError(`Ya existe un armador con la cédula ${cedula} (${existing.name}).`); return; }

    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") {
        const createData: Omit<Armador, "id"> = {
          companyId: user.companyId!,
          name,
          cedula,
          color: AVATAR_COLORS[armadores.length % AVATAR_COLORS.length],
          route: [],
          prodH: 0,
          cumpl: 0,
          inc: 0,
          retrab: 0,
          index: 0,
          trend: "0%",
          badges: [],
        };
        if (formCostPerHour !== "") {
          (createData as Record<string, unknown>).costPerHour = Number(formCostPerHour);
        }
        await createArmador(createData);
        setMsg(`Armador "${name}" creado.`);
      } else if (editing) {
        const updateData: Record<string, unknown> = { name, cedula };
        if (formCostPerHour !== "") updateData.costPerHour = Number(formCostPerHour);
        await updateArmador(editing.id, updateData);
        setMsg(`Armador "${name}" actualizado.`);
      }
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(arm: Armador) {
    if (!user?.companyId) return;
    if (!confirm(`¿Eliminar a ${arm.name} del equipo? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteArmador(arm.id, { companyId: arm.companyId, name: arm.name });
      if (editing !== "new" && editing?.id === arm.id) closeForm();
      setMsg(`Armador "${arm.name}" eliminado.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo eliminar.");
    }
  }

  // ─── Assignment handlers ─────────────────────────────────────────────────
  async function handleAssign() {
    if (!pickZoneCode || !pickArmadorId || !user?.companyId) return;
    const zone = zones.find((z) => z.code === pickZoneCode);
    const armador = armadores.find((a) => a.id === pickArmadorId);
    if (!zone?.id || !armador) return;
    setAssigning(true);
    setMsg(null);
    try {
      await assignArmadorToZone(
        { id: zone.id, code: zone.code },
        user.companyId,
        { id: armador.id, name: armador.name },
        { uid: user.uid, name: user.name }
      );
      setMsg(`${armador.name} → zona ${zone.code}.`);
      setPickZoneCode("");
      setPickArmadorId("");
    } catch {
      setMsg("No se pudo asignar. Intenta de nuevo.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(a: Armador) {
    if (!a.zonaAsignadaCode || !user?.companyId) return;
    setSavingArmadorId(a.id);
    try {
      await unassignArmadorFromZone(
        { id: a.id, name: a.name },
        a.zonaAsignadaCode,
        user.companyId,
        { uid: user.uid, name: user.name }
      );
      setMsg(`${a.name} desasignado de ${a.zonaAsignadaCode}.`);
    } catch {
      setMsg("No se pudo desasignar.");
    } finally {
      setSavingArmadorId(null);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gridTemplateColumns: editing ? "1fr 380px" : "1fr", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ═══ JORNADA BAR ═══════════════════════════════════════════════════ */}
        <div className="panel" style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
                  borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: jornada.jornadaActiva
                    ? isPaused ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)"
                    : "rgba(107,114,128,0.12)",
                  color: jornada.jornadaActiva
                    ? isPaused ? "#F59E0B" : "#10B981"
                    : "#6B7280",
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: "50%", background: "currentColor",
                  animation: isActive ? "pulse 2s infinite" : "none",
                }} />
                {jornada.jornadaActiva ? (isPaused ? "PAUSADA" : "ACTIVA") : "INACTIVA"}
              </div>

              {/* Stats inline */}
              <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
                <span><b style={{ color: "var(--accent)" }}>{armadoresAsignados.length}</b><span style={{ color: "var(--faint)" }}>/{armadores.length} asignados</span></span>
                <span><b style={{ color: "#10B981" }}>{armadoresActivos.length}</b><span style={{ color: "var(--faint)" }}> trabajando</span></span>
                <span><b style={{ color: "#F59E0B" }}>{membretesPendientes.length}</b><span style={{ color: "var(--faint)" }}> en cola</span></span>
                <span><b style={{ color: "#10B981" }}>{membretesCompletados.length}</b><span style={{ color: "var(--faint)" }}> hechos</span></span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {!jornada.jornadaActiva ? (
                <>
                  {companyShifts.length > 0 && (
                    <div style={{ display: "flex", gap: 3, background: "var(--panel)", borderRadius: 8, padding: 2 }}>
                      {companyShifts.map((s, i) => (
                        <button
                          key={s.inicio}
                          onClick={() => setSelectedShiftIdx(i)}
                          style={{
                            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                            border: "none", cursor: "pointer",
                            background: i === selectedShiftIdx ? "#10B981" : "transparent",
                            color: i === selectedShiftIdx ? "#fff" : "var(--faint)",
                            transition: "all .15s",
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    className="btn primary sm"
                    onClick={handleIniciarJornada}
                    disabled={jornadaLoading || companyShifts.length === 0}
                    style={{ background: "#10B981", color: "#fff" }}
                  >
                    {jornadaLoading ? "Iniciando..." : "▶ Iniciar"}
                  </button>
                </>
              ) : isPaused ? (
                <>
                  <button className="btn primary sm" onClick={handleReanudarJornada} disabled={jornadaLoading}
                    style={{ background: "#10B981", color: "#fff" }}>
                    {jornadaLoading ? "..." : "▶ Reanudar"}
                  </button>
                  <button className="btn sm" onClick={handleFinalizarJornada} disabled={jornadaLoading}
                    style={{ background: "#EF4444", color: "#fff" }}>
                    {jornadaLoading ? "..." : "⏹ Finalizar"}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn sm" onClick={handlePausarJornada} disabled={jornadaLoading}
                    style={{ background: "#F59E0B", color: "#fff" }}>
                    {jornadaLoading ? "..." : "⏸ Pausar"}
                  </button>
                  <button className="btn sm" onClick={handleFinalizarJornada} disabled={jornadaLoading}
                    style={{ background: "#EF4444", color: "#fff" }}>
                    {jornadaLoading ? "..." : "⏹ Finalizar"}
                  </button>
                </>
              )}
            </div>
          </div>
          {msg && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--accent)", padding: "5px 10px", background: "rgba(13,148,136,0.08)", borderRadius: 6 }}>
              {msg}
            </div>
          )}
        </div>

        {/* ═══ ASIGNAR A ZONA ═══════════════════════════════════════════════ */}
        <div className="panel" style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--faint)", whiteSpace: "nowrap" }}>Asignar a zona:</span>
            <select
              value={pickArmadorId}
              onChange={(e) => setPickArmadorId(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 12, minWidth: 160 }}
            >
              <option value="">Armador...</option>
              {armadores.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.zonaAsignadaCode ? ` (${a.zonaAsignadaCode})` : ""}
                </option>
              ))}
            </select>
            <span style={{ color: "var(--faint)", fontSize: 12 }}>→</span>
            <select
              value={pickZoneCode}
              onChange={(e) => setPickZoneCode(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 12, minWidth: 180 }}
            >
              <option value="">Zona...</option>
              {sortedZonesByQueue.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.code}{queueByZoneCode[z.code] ? ` (${queueByZoneCode[z.code]} en cola)` : ""}
                </option>
              ))}
            </select>
            <button
              className="btn primary sm"
              disabled={!pickZoneCode || !pickArmadorId || assigning}
              onClick={handleAssign}
            >
              {assigning ? "..." : "Asignar"}
            </button>
          </div>
        </div>

        {/* ═══ ROSTER TABLE ═════════════════════════════════════════════════ */}
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <div className="panel-h">
            <h3>Armadores ({armadores.length})</h3>
            <button className="btn primary sm" onClick={openNew}>+ Nuevo</button>
          </div>
          {!armadoresLoaded ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 12 }}>Cargando...</div>
          ) : armadores.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>👷</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Sin armadores</div>
              <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 16 }}>Agrega armadores para empezar a asignar zonas.</div>
              <button className="btn primary" onClick={openNew}>+ Agregar armador</button>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Armador</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Zona</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Ahora</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Costo/h</th>
                    <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedArmadores.map((a) => {
                    const activeM = activeMembreteOf(a.id);
                    return (
                      <tr key={a.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span className="avatar" style={{ background: a.color || "var(--accent)", width: 26, height: 26, fontSize: 11 }}>
                              {a.name[0]?.toUpperCase()}
                            </span>
                            <div>
                              <div style={{ fontWeight: 500 }}>{a.name}</div>
                              {a.cedula && <div style={{ fontSize: 10, color: "var(--faint)" }}>CC {a.cedula}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          {a.zonaAsignadaCode ? (
                            <span className="mono" style={{ fontWeight: 600, color: "var(--accent)", fontSize: 12 }}>{a.zonaAsignadaCode}</span>
                          ) : (
                            <span style={{ color: "var(--faint)", fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12 }}>
                          {activeM ? (
                            <span style={{ color: "var(--s-active)", fontWeight: 600 }}>● {activeM.code}</span>
                          ) : (
                            <span style={{ color: "var(--faint)" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 14px" }} className="mono">
                          {a.costPerHour ? `$${a.costPerHour.toLocaleString("es-CO")}` : <span style={{ color: "var(--faint)" }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                            <button className="btn ghost sm" onClick={() => openEdit(a)}>Editar</button>
                            {a.zonaAsignadaCode && (
                              <button
                                className="btn ghost sm"
                                style={{ color: "var(--s-not)" }}
                                onClick={() => handleUnassign(a)}
                                disabled={savingArmadorId === a.id}
                              >
                                {savingArmadorId === a.id ? "..." : "Quitar zona"}
                              </button>
                            )}
                            <button className="btn ghost sm" style={{ color: "var(--s-not)" }} onClick={() => handleDelete(a)}>Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══ EQUIPOS POR FAMILIA — RENDIMIENTO SIMULTÁNEO (ADMIN) ═══ */}
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <span style={{ width:28, height:28, borderRadius:8, display:"grid", placeItems:"center", background:"linear-gradient(135deg, #6366f1, #8b5cf6)", color:"#fff" }}><I.users /></span>
          <div>
            <div style={{ fontWeight:800, fontSize:13 }}>Equipos por familia — rendimiento simultáneo</div>
            <div style={{ fontSize:11, color:"var(--faint)" }}>Mismo indicador que ve el armador en “Yo”. Se actualiza en vivo por familia.</div>
          </div>
        </div>
        {(() => {
          const byFamilia = new Map<string, Armador[]>();
          for(const a of armadores){
            const fam = a.zonaAsignadaCode || "Sin familia";
            if(!byFamilia.has(fam)) byFamilia.set(fam, []);
            byFamilia.get(fam)!.push(a);
          }
          if(byFamilia.size===0) return <div style={{ padding:12, textAlign:"center", color:"var(--faint)", fontSize:12 }}>Sin equipos aún</div>;
          return (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:12 }}>
              {Array.from(byFamilia.entries()).sort((a,b)=> a[0].localeCompare(b[0])).map(([fam, equipo])=>{
                const sorted = [...equipo].sort((a,b)=>(b.prodH||0)-(a.prodH||0));
                const maxProd = Math.max(...sorted.map(a=>a.prodH||0),1);
                const famMems = membretes.filter(m=> m.zonaCode===fam);
                const famDone = famMems.filter(m=>m.status==="completed").length;
                const famActive = famMems.filter(m=>m.status==="active").length;
                return (
                  <div key={fam} style={{ border:"1px solid var(--line)", borderRadius:12, padding:12, background:"var(--panel2)" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <div style={{ fontWeight:800, fontSize:12, display:"flex", alignItems:"center", gap:6 }}><span style={{ width:8, height:8, borderRadius:"50%", background:"var(--accent)" }}/>Familia {fam}</div>
                      <span style={{ fontSize:10, padding:"2px 7px", borderRadius:999, background:"var(--accent-soft)", color:"var(--accent)", fontWeight:700 }}>{equipo.length} armadores</span>
                    </div>
                    <div style={{ fontSize:11, color:"var(--faint)", marginBottom:8 }}>{famDone} hechos · {famActive} en curso · {famMems.length} marbetes</div>
                    <div style={{ display:"grid", gap:6 }}>
                      {sorted.map((a,i)=>{
                        const myMems = membretes.filter(m=> m.armadorId===a.id);
                        const done = myMems.filter(m=>m.status==="completed").length;
                        const active = myMems.filter(m=>m.status==="active").length;
                        const isActiveNow = active>0;
                        return (
                          <div key={a.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:10, background: i===0? "linear-gradient(90deg, #f59e0b0f, transparent)" : "var(--panel)", border: i===0? "1px solid #f59e0b22" : "1px solid var(--line)" }}>
                            <div style={{ width:20, textAlign:"center", fontWeight:900, fontSize:11, color: i===0? "#f59e0b": i===1? "#94a3b8": i===2? "#b45309":"var(--faint)" }}>{i+1}</div>
                            <div style={{ width:26, height:26, borderRadius:8, display:"grid", placeItems:"center", background:a.color||"var(--accent)", color:"#fff", fontWeight:800, fontSize:11 }}>{a.name[0]}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontWeight:700, fontSize:11, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.name} {i===0 && <span style={{ fontSize:9, padding:"1px 5px", borderRadius:999, background:"#f59e0b18", color:"#b45309" }}>LÍDER</span>}</div>
                              <div style={{ height:4, borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", overflow:"hidden", marginTop:4 }}>
                                <div style={{ height:"100%", width:`${( (a.prodH||0)/maxProd)*100}%`, background: i===0? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, var(--accent), #34d399)" }}/>
                              </div>
                            </div>
                            <div style={{ textAlign:"right" }}>
                              <div style={{ fontWeight:800, fontSize:11 }} className="mono">{a.prodH||0}<span style={{ fontSize:9, color:"var(--faint)"}}> p/h</span></div>
                              <div style={{ fontSize:9, color: isActiveNow? "var(--s-active)":"var(--faint)", fontWeight:700 }}>{isActiveNow? "● En curso":"○"}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* ═══ SIDE PANEL: Form ═══════════════════════════════════════════════ */}
      {editing && (
        <div className="panel" style={{ position: "sticky", top: 16 }}>
          <div className="panel-h">
            <h3>{editing === "new" ? "Nuevo armador" : "Editar armador"}</h3>
            <button className="btn ghost sm" onClick={closeForm}>✕</button>
          </div>
          <div style={{ padding: 16 }}>
            <div className="field">
              <label>Nombre completo</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ej. Juan Torres" />
            </div>
            <div className="field">
              <label>Cédula de identidad</label>
              <input value={formCedula} onChange={(e) => setFormCedula(e.target.value)} placeholder="Ej. 1234567890" />
            </div>
            <div className="field">
              <label>Costo por hora (opcional)</label>
              <input
                type="number" min={0} step="0.01"
                value={formCostPerHour}
                onChange={(e) => setFormCostPerHour(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="Ej. 6500"
              />
            </div>
            {formError && (
              <div className="alert warn" style={{ marginBottom: 12 }}><I.alert /> {formError}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : editing === "new" ? "Crear armador" : "Guardar"}
              </button>
              <button className="btn" onClick={closeForm}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ SIDE PANEL: Help (when no form) ═══════════════════════════════ */}
      {!editing && (
        <div className="panel" style={{ position: "sticky", top: 16, display: "none" }}>
          {/* Hidden — grid stays 1-column when no form is open */}
        </div>
      )}
    </div>
  );
}
