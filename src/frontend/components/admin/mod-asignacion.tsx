/**
 * @file components/admin/mod-asignacion.tsx
 * @description Módulo de Asignación — Control de jornada + Roster de armadores.
 *
 * El admin usa este módulo para:
 * 1. INICIAR la jornada (botón "Iniciar labores") — solo entonces los
 *    armadores pueden escanear QR y tomar membretes.
 * 2. ASIGNAR armadores a zonas (roster) — les dice dónde trabajar.
 * 3. PAUSAR / REANUDAR la jornada si es necesario.
 * 4. FINALIZAR la jornada al terminar el turno.
 *
 * Flujo:
 *   Admin sube SAP → Asigna armadores a zonas → Iniciar labores
 *   → Armadores escanean QR → Toman membretes secuencialmente
 *   → Admin pausa/reanuda/finaliza según necesidad
 */

"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/frontend/context/auth-context";
import {
  subscribeZones,
  subscribeArmadores,
  subscribeMembretes,
  assignArmadorToZone,
  unassignArmadorFromZone,
  getCompany,
  iniciarJornada,
  pausarJornada,
  reanudarJornada,
  finalizarJornada,
} from "@/frontend/services/firestore";
import type { Zone, Armador, Membrete } from "@/types";

interface JornadaState {
  jornadaActiva: boolean;
  jornadaStartedAt?: number;
  jornadaPausedAt?: number | null;
}

export function ModAsignacion() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [armadoresLoaded, setArmadoresLoaded] = useState(false);
  const [jornada, setJornada] = useState<JornadaState>({ jornadaActiva: false });
  const [jornadaLoading, setJornadaLoading] = useState(false);
  const [companyShifts, setCompanyShifts] = useState<{ label: string; inicio: string; fin: string }[]>([]);
  const [selectedShiftIdx, setSelectedShiftIdx] = useState(0);

  const [pickZoneCode, setPickZoneCode] = useState("");
  const [pickArmadorId, setPickArmadorId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [savingArmadorId, setSavingArmadorId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId) return;
    const unsubZones = subscribeZones(user.companyId, setZones);
    const unsubArmadores = subscribeArmadores(user.companyId, (a) => {
      setArmadores(a);
      setArmadoresLoaded(true);
    });
    const unsubMembretes = subscribeMembretes(user.companyId, setMembretes);
    // Load jornada state + available shifts
    getCompany(user.companyId).then((c) => {
      if (c) {
        setJornada({
          jornadaActiva: c.jornadaActiva || false,
          jornadaStartedAt: c.jornadaStartedAt,
          jornadaPausedAt: c.jornadaPausedAt,
        });
        // Build available shifts from company config
        const shifts: { label: string; inicio: string; fin: string }[] = [];
        if (c.turnoMananaInicio && c.turnoMananaFin) shifts.push({ label: "Mañana", inicio: c.turnoMananaInicio, fin: c.turnoMananaFin });
        if (c.turnoTardeInicio && c.turnoTardeFin) shifts.push({ label: "Tarde", inicio: c.turnoTardeInicio, fin: c.turnoTardeFin });
        if (c.turnoNocheInicio && c.turnoNocheFin) shifts.push({ label: "Noche", inicio: c.turnoNocheInicio, fin: c.turnoNocheFin });
        setCompanyShifts(shifts);
        // Auto-select the shift that matches current time
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

  // Stats
  const armadoresAsignados = armadores.filter((a) => a.zonaAsignadaCode);
  const armadoresActivos = armadores.filter((a) => {
    const m = membretes.find((mm) => mm.armadorId === a.id && mm.status === "active");
    return !!m;
  });
  const membretesPendientes = membretes.filter((m) => m.status === "pending" && !m.armadorId);
  const membretesActivos = membretes.filter((m) => m.status === "active");
  const membretesCompletados = membretes.filter((m) => m.status === "completed");

  // Queue by zone
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

  function activeMembreteOf(armadorId: string): Membrete | undefined {
    return membretes.find((m) => m.armadorId === armadorId && m.status === "active");
  }

  // ─── Jornada controls ──────────────────────────────────────────────────
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
      setMsg(`Jornada iniciada en turno ${shift.label} (${shift.inicio} → ${shift.fin}). Los armadores ya pueden escanear.`);
    } catch (e) {
      console.error("Error starting jornada:", e);
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
      setMsg("Jornada pausada. Los armadores no pueden tomar nuevos membretes.");
    } catch (e) {
      console.error("Error pausing jornada:", e);
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
    } catch (e) {
      console.error("Error resuming jornada:", e);
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
    } catch (e) {
      console.error("Error finishing jornada:", e);
      setMsg("Error al finalizar la jornada.");
    } finally {
      setJornadaLoading(false);
    }
  }

  // ─── Assign / Unassign ─────────────────────────────────────────────────
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
      setMsg(`${armador.name} quedó asignado a la zona ${zone.code}.`);
      setPickZoneCode("");
      setPickArmadorId("");
    } catch (error) {
      console.error("Error assigning armador to zone:", error);
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
    } catch (error) {
      console.error("Error unassigning armador from zone:", error);
    } finally {
      setSavingArmadorId(null);
    }
  }

  const isPaused = !!jornada.jornadaPausedAt;
  const isActive = jornada.jornadaActiva && !isPaused;

  return (
    <div>
      {/* ── Control de Jornada ──────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Control de Jornada</h3>
            <p style={{ margin: 0, fontSize: 12, color: "var(--faint)" }}>
              El admin inicia la jornada para que los armadores puedan escanear y tomar membretes.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Status indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                background: jornada.jornadaActiva
                  ? isPaused
                    ? "rgba(245,158,11,0.12)"
                    : "rgba(16,185,129,0.12)"
                  : "rgba(107,114,128,0.12)",
                color: jornada.jornadaActiva
                  ? isPaused
                    ? "#F59E0B"
                    : "#10B981"
                  : "#6B7280",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "currentColor",
                  animation: isActive ? "pulse 2s infinite" : "none",
                }}
              />
              {jornada.jornadaActiva ? (isPaused ? "PAUSADA" : "ACTIVA") : "INACTIVA"}
            </div>

            {/* Action buttons */}
            {!jornada.jornadaActiva ? (
              <>
                {/* Shift selector — REQUIRED before starting */}
                {companyShifts.length > 0 && (
                  <div style={{ display: "flex", gap: 4, background: "var(--panel)", borderRadius: 8, padding: 3 }}>
                    {companyShifts.map((s, i) => (
                      <button
                        key={s.inicio}
                        onClick={() => setSelectedShiftIdx(i)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          border: "none",
                          cursor: "pointer",
                          background: i === selectedShiftIdx ? "#10B981" : "transparent",
                          color: i === selectedShiftIdx ? "#fff" : "var(--faint)",
                          transition: "all .15s",
                        }}
                      >
                        {s.label}
                        <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4, opacity: 0.8 }}>
                          {s.inicio}→{s.fin}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="btn primary"
                  onClick={handleIniciarJornada}
                  disabled={jornadaLoading || companyShifts.length === 0}
                  style={{ background: "#10B981", color: "#fff" }}
                >
                  {jornadaLoading ? "Iniciando..." : "▶ Iniciar labores"}
                </button>
              </>
            ) : isPaused ? (
              <>
                <button
                  className="btn primary"
                  onClick={handleReanudarJornada}
                  disabled={jornadaLoading}
                  style={{ background: "#10B981", color: "#fff" }}
                >
                  {jornadaLoading ? "Reanudando..." : "▶ Reanudar"}
                </button>
                <button
                  className="btn"
                  onClick={handleFinalizarJornada}
                  disabled={jornadaLoading}
                  style={{ background: "#EF4444", color: "#fff" }}
                >
                  {jornadaLoading ? "Finalizando..." : "⏹ Finalizar"}
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={handlePausarJornada}
                  disabled={jornadaLoading}
                  style={{ background: "#F59E0B", color: "#fff" }}
                >
                  {jornadaLoading ? "Pausando..." : "⏸ Pausar"}
                </button>
                <button
                  className="btn"
                  onClick={handleFinalizarJornada}
                  disabled={jornadaLoading}
                  style={{ background: "#EF4444", color: "#fff" }}
                >
                  {jornadaLoading ? "Finalizando..." : "⏹ Finalizar"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          {[
            { label: "Armadores asignados", value: armadoresAsignados.length, color: "var(--accent)" },
            { label: "Trabajando ahora", value: armadoresActivos.length, color: "#10B981" },
            { label: "Membretes en cola", value: membretesPendientes.length, color: "#F59E0B" },
            { label: "Activos", value: membretesActivos.length, color: "#3B82F6" },
            { label: "Completados", value: membretesCompletados.length, color: "#10B981" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: s.color, fontSize: 16 }}>{s.value}</span>
              <span style={{ color: "var(--faint)" }}>{s.label}</span>
            </div>
          ))}
        </div>

        {msg && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--accent)", padding: "6px 10px", background: "rgba(13,148,136,0.08)", borderRadius: 6 }}>
            {msg}
          </div>
        )}
      </div>

      {/* ── Asignar armador a zona ──────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Asignar armador a zona</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--faint)" }}>
          Selecciona el armador y la zona donde trabajará. Él llega, escanea el QR y toma los membretes por su cuenta.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={pickArmadorId}
            onChange={(e) => setPickArmadorId(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, minWidth: 180 }}
          >
            <option value="">Selecciona un armador...</option>
            {armadores.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.zonaAsignadaCode ? ` (${a.zonaAsignadaCode})` : ""}
              </option>
            ))}
          </select>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>→</span>
          <select
            value={pickZoneCode}
            onChange={(e) => setPickZoneCode(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, minWidth: 200 }}
          >
            <option value="">Selecciona una zona...</option>
            {sortedZonesByQueue.map((z) => (
              <option key={z.code} value={z.code}>
                {z.code}
                {queueByZoneCode[z.code] ? ` — ${queueByZoneCode[z.code]} en cola` : ""}
              </option>
            ))}
          </select>
          <button
            className="btn sm primary"
            disabled={!pickZoneCode || !pickArmadorId || assigning}
            onClick={handleAssign}
          >
            {assigning ? "Asignando..." : "Asignar"}
          </button>
        </div>
      </div>

      {/* ── Roster actual ────────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="panel-h">
          <h3>Roster de armadores</h3>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
            {armadoresLoaded ? `${armadoresAsignados.length}/${armadores.length} asignados` : "..."}
          </span>
        </div>
        {!armadoresLoaded ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 12 }}>Cargando armadores...</div>
        ) : armadores.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
            No hay armadores registrados. Crea uno en el módulo de Equipo.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Armador</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Zona asignada</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Ahora mismo</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sortedArmadores.map((a) => {
                  const activeMembrete = activeMembreteOf(a.id);
                  return (
                    <tr key={a.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 6,
                              background: a.color || "var(--accent)",
                              display: "inline-grid",
                              placeItems: "center",
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {a.name[0]}
                          </span>
                          {a.name}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {a.zonaAsignadaCode ? (
                          <span className="mono" style={{ fontWeight: 600, color: "var(--accent)" }}>
                            {a.zonaAsignadaCode}
                          </span>
                        ) : (
                          <span style={{ color: "var(--faint)" }}>Sin zona asignada</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>
                        {activeMembrete ? (
                          <span style={{ color: "var(--s-active)", fontWeight: 600 }}>
                            ● {activeMembrete.code} en {activeMembrete.zonaCode}
                          </span>
                        ) : (
                          <span style={{ color: "var(--faint)" }}>Sin tarea activa</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        {a.zonaAsignadaCode && (
                          <button
                            className="btn ghost sm"
                            style={{ color: "var(--s-not)" }}
                            onClick={() => handleUnassign(a)}
                            disabled={savingArmadorId === a.id}
                          >
                            {savingArmadorId === a.id ? "Quitando..." : "Quitar"}
                          </button>
                        )}
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
  );
}
