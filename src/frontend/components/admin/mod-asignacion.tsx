/**
 * @file components/admin/mod-asignacion.tsx
 * @description Módulo de Asignación — Control de jornada + Roster de armadores.
 *
 * El admin usa este módulo para:
 * 1. INICIAR la jornada (botón "Iniciar labores") — solo entonces los
 *    armadores pueden escanear QR y tomar membretes.
 * 2. ASIGNAR armadores a zonas (roster) — les dice dónde trabajar.
 * 3. PAUSAR / REANUDAR la jornada si es necesario.
 * 4. FINALIZAR la jornada al terminar el turno — MANUAL o AUTOMÁTICO
 *    cuando pasa la hora fin del turno: quita a todos de zona, archiva
 *    marbetes y reporta faltantes.
 *
 * Flujo:
 *   Admin sube SAP → Asigna armadores a zonas → Iniciar labores
 *   → Armadores escanean QR → Toman membretes secuencialmente
 *   → Si pasa hora fin → auto-cierre + reporte (o admin finaliza manual)
 */

"use client";

import { useState, useEffect, useRef } from "react";
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
  getShiftEndTimestamp,
  type JornadaCierreReport,
} from "@/frontend/services/firestore";
import type { Zone, Armador, Membrete } from "@/types";

interface JornadaState {
  jornadaActiva: boolean;
  jornadaStartedAt?: number;
  jornadaPausedAt?: number | null;
  jornadaShiftInicio?: string;
  jornadaShiftFin?: string;
}

function buildCierreReport(membretes: Membrete[], zones: Zone[], armadores: Armador[]): JornadaCierreReport {
  const pending = membretes.filter((m) => !m.archived && m.status === "pending" && !m.armadorId);
  const active = membretes.filter((m) => !m.archived && m.status === "active");
  const completed = membretes.filter((m) => !m.archived && m.status === "completed");
  const byZone: Record<string, number> = {};
  pending.forEach((m) => { if (m.zonaCode) byZone[m.zonaCode] = (byZone[m.zonaCode] || 0) + 1; });
  const pendingByZone = Object.entries(byZone).map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
  const activeByArmador = active.map((m) => {
    const a = armadores.find((x) => x.id === m.armadorId);
    return { name: a?.name || m.armadorId || "—", membreteCode: m.code, zonaCode: m.zonaCode || "—" };
  });
  const pendingMembretes = pending.slice(0, 80).map((m) => ({ code: m.code, zonaCode: m.zonaCode || "—" }));
  // armadores que tenían zona asignada pero no completaron nada
  const doneByArmador: Record<string, number> = {};
  completed.forEach((m) => { if (m.armadorId) doneByArmador[m.armadorId] = (doneByArmador[m.armadorId] || 0) + 1; });
  const armadoresSinCompletar = armadores
    .filter((a) => a.zonaAsignadaCode)
    .map((a) => ({ name: a.name, zonaCode: a.zonaAsignadaCode || null, completados: doneByArmador[a.id] || 0 }))
    .filter((x) => x.completados === 0);
  // zonas sin terminar: total vs done (solo del turno actual, no archivadas)
  const zonasSinTerminar = zones.map((z) => {
    const total = membretes.filter((m) => !m.archived && m.zonaCode === z.code).length;
    const done = membretes.filter((m) => !m.archived && m.zonaCode === z.code && m.status === "completed").length;
    return { code: z.code, total, done };
  }).filter((z) => z.total > 0 && z.done < z.total).sort((a, b) => (a.done / a.total) - (b.done / b.total));

  return { completed: completed.length, pending: pending.length, active: active.length, pendingByZone, activeByArmador, pendingMembretes, armadoresSinCompletar, zonasSinTerminar };
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

  // Auto-cierre
  const [cierreReport, setCierreReport] = useState<(JornadaCierreReport & { auto: boolean; turnoLabel: string }) | null>(null);
  const [autoClosing, setAutoClosing] = useState(false);
  const autoClosingRef = useRef(false);

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
          jornadaShiftInicio: c.jornadaShiftInicio,
          jornadaShiftFin: c.jornadaShiftFin,
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

  // ── Auto-cierre cuando pasa la hora fin del turno ───────────────────────
  useEffect(() => {
    if (!jornada.jornadaActiva || !!jornada.jornadaPausedAt || autoClosingRef.current) return;
    if (!jornada.jornadaShiftInicio || !jornada.jornadaShiftFin || !jornada.jornadaStartedAt) return;

    const checkAndClose = async () => {
      if (autoClosingRef.current) return;
      const endTs = getShiftEndTimestamp(jornada.jornadaStartedAt!, jornada.jornadaShiftInicio!, jornada.jornadaShiftFin!);
      if (Date.now() <= endTs) return;
      if (!user?.companyId) return;
      autoClosingRef.current = true;
      setAutoClosing(true);
      const report = buildCierreReport(membretes, zones, armadores);
      const turnoLabel = `${jornada.jornadaShiftInicio} → ${jornada.jornadaShiftFin}`;
      try {
        await finalizarJornada(user.companyId, { uid: user.uid, name: user.name || "Sistema" });
        setJornada({ jornadaActiva: false, jornadaPausedAt: null });
        setCierreReport({ ...report, auto: true, turnoLabel });
        setMsg(`Turno cerrado automáticamente al vencer ${turnoLabel}. Se quitaron ${armadores.filter(a=>a.zonaAsignadaCode).length} armadores de zona — ${report.pending} marbetes quedaron pendientes.`);
      } catch (e) {
        console.error("Auto-cierre jornada error:", e);
        autoClosingRef.current = false;
        setAutoClosing(false);
      } finally {
        setAutoClosing(false);
      }
    };

    // Chequear al montar y cada 30s
    checkAndClose();
    const id = setInterval(checkAndClose, 30_000);
    return () => clearInterval(id);
  }, [jornada.jornadaActiva, jornada.jornadaPausedAt, jornada.jornadaShiftInicio, jornada.jornadaShiftFin, jornada.jornadaStartedAt, membretes, zones, armadores, user?.companyId, user?.uid, user?.name]);

  // Stats
  const armadoresAsignados = armadores.filter((a) => a.zonaAsignadaCode);
  const armadoresActivos = armadores.filter((a) => {
    const m = membretes.find((mm) => mm.armadorId === a.id && mm.status === "active");
    return !!m;
  });
  const membretesPendientes = membretes.filter((m) => !m.archived && m.status === "pending" && !m.armadorId);
  const membretesActivos = membretes.filter((m) => !m.archived && m.status === "active");
  const membretesCompletados = membretes.filter((m) => !m.archived && m.status === "completed");

  const queueByZoneCode: Record<string, number> = {};
  membretes.forEach((m) => {
    if (!m.archived && !m.armadorId && m.status === "pending" && m.zonaCode) {
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
    return membretes.find((m) => !m.archived && m.armadorId === armadorId && m.status === "active");
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
      const now = Date.now();
      setJornada({ jornadaActiva: true, jornadaStartedAt: now, jornadaPausedAt: null, jornadaShiftInicio: shift.inicio, jornadaShiftFin: shift.fin });
      autoClosingRef.current = false;
      setMsg(`Jornada iniciada en turno ${shift.label} (${shift.inicio} → ${shift.fin}). Los armadores ya pueden escanear.`);
    } catch (e: any) {
      console.error("Error starting jornada:", e);
      setMsg(e?.message || "Error al iniciar la jornada.");
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
    const report = buildCierreReport(membretes, zones, armadores);
    const preview = `¿Finalizar jornada? Quedarán ${report.pending} pendientes y ${report.active} activos. Se quitará a todos de su zona y se archivará el turno.`;
    if (!confirm(preview)) return;
    setJornadaLoading(true);
    try {
      const turnoLabel = jornada.jornadaShiftInicio && jornada.jornadaShiftFin ? `${jornada.jornadaShiftInicio} → ${jornada.jornadaShiftFin}` : "turno actual";
      await finalizarJornada(user.companyId, { uid: user.uid, name: user.name });
      setJornada({ jornadaActiva: false, jornadaPausedAt: null });
      setCierreReport({ ...report, auto: false, turnoLabel });
      setMsg(`Jornada finalizada — ${report.completed} hechos, ${report.pending} pendientes.`);
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
  const turnoLabel = jornada.jornadaShiftInicio && jornada.jornadaShiftFin ? `${jornada.jornadaShiftInicio} → ${jornada.jornadaShiftFin}` : null;
  const endTs = jornada.jornadaStartedAt && jornada.jornadaShiftInicio && jornada.jornadaShiftFin
    ? getShiftEndTimestamp(jornada.jornadaStartedAt, jornada.jornadaShiftInicio, jornada.jornadaShiftFin)
    : null;
  const minutosRestantes = endTs ? Math.max(0, Math.round((endTs - Date.now()) / 60000)) : null;

  return (
    <div>
      {/* ── Control de Jornada ──────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Control de Jornada</h3>
            <p style={{ margin: 0, fontSize: 12, color: "var(--faint)" }}>
              {turnoLabel ? <>Turno <b className="mono">{turnoLabel}</b> — se cierra solo al vencer la hora.</> : "El admin inicia la jornada para que los armadores puedan escanear y tomar membretes."}
              {minutosRestantes !== null && isActive && <span style={{ marginLeft: 8, fontSize: 11, padding: "3px 8px", borderRadius: 999, background: minutosRestantes < 15 ? "#fee2e2" : "var(--inset)", color: minutosRestantes < 15 ? "#991b1b" : "var(--faint)", fontWeight: 700 }}>{minutosRestantes < 1 ? "vence ahora" : `${minutosRestantes} min restantes`}</span>}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
              {jornada.jornadaActiva ? (isPaused ? "PAUSADA" : autoClosing ? "CERRANDO..." : "ACTIVA") : "INACTIVA"}
            </div>

            {!jornada.jornadaActiva ? (
              <>
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
                  disabled={jornadaLoading || autoClosing}
                  style={{ background: "#EF4444", color: "#fff" }}
                >
                  {jornadaLoading || autoClosing ? "Finalizando..." : "⏹ Finalizar"}
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={handlePausarJornada}
                  disabled={jornadaLoading || autoClosing}
                  style={{ background: "#F59E0B", color: "#fff" }}
                >
                  {jornadaLoading ? "Pausando..." : "⏸ Pausar"}
                </button>
                <button
                  className="btn"
                  onClick={handleFinalizarJornada}
                  disabled={jornadaLoading || autoClosing}
                  style={{ background: "#EF4444", color: "#fff" }}
                >
                  {jornadaLoading || autoClosing ? "Finalizando..." : "⏹ Finalizar"}
                </button>
              </>
            )}
          </div>
        </div>

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

      {/* ── Modal Reporte de Cierre ─────────────────────────────────────── */}
      {cierreReport && (
        <div onClick={() => setCierreReport(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.52)", display: "grid", placeItems: "center", zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 96vw)", maxHeight: "90vh", overflow: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 20px 60px -12px rgba(0,0,0,0.3)" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", position: "sticky", top: 0, background: "var(--panel)", borderRadius: "16px 16px 0 0", zIndex: 1 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: cierreReport.auto ? "#f59e0b" : "var(--faint)" }}>{cierreReport.auto ? "⏰ Cierre automático — venció el turno" : "⏹ Jornada finalizada"}</div>
                <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2 }}>Turno {cierreReport.turnoLabel} — reporte de faltantes</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{cierreReport.completed} hechos · {cierreReport.pending} pendientes · {cierreReport.active} activos interrumpidos · Se quitó el roster automáticamente</div>
              </div>
              <button onClick={() => setCierreReport(null)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--inset)", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>

            <div style={{ padding: 16, display: "grid", gap: 14 }}>
              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {[
                  { k: "Completados", v: cierreReport.completed, bg: "#ecfdf5", fg: "#065f46" },
                  { k: "Pendientes", v: cierreReport.pending, bg: cierreReport.pending ? "#fee2e2" : "#f3f4f6", fg: cierreReport.pending ? "#991b1b" : "var(--faint)" },
                  { k: "Activos (cortados)", v: cierreReport.active, bg: cierreReport.active ? "#fef3c7" : "#f3f4f6", fg: cierreReport.active ? "#92400e" : "var(--faint)" },
                ].map((c) => (
                  <div key={c.k} style={{ background: c.bg, borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: c.fg }} className="mono">{c.v}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: c.fg, opacity: 0.8, textTransform: "uppercase", letterSpacing: ".04em" }}>{c.k}</div>
                  </div>
                ))}
              </div>

              {cierreReport.pendingByZone.length > 0 && (
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 800, background: "var(--inset)", borderBottom: "1px solid var(--line)" }}>Pendientes por familia (zona)</div>
                  <div style={{ maxHeight: 140, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <tbody>
                        {cierreReport.pendingByZone.map((r) => (
                          <tr key={r.code} style={{ borderBottom: "1px solid var(--line)" }}><td style={{ padding: "8px 14px" }} className="mono">{r.code}</td><td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 700 }}>{r.count} pendientes</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {cierreReport.zonasSinTerminar.length > 0 && (
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 800, background: "var(--inset)", borderBottom: "1px solid var(--line)" }}>Familias sin terminar</div>
                  <div style={{ maxHeight: 140, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}><th style={{ padding: "7px 10px", textAlign: "left" }}>Zona</th><th style={{ padding: "7px 10px", textAlign: "right" }}>Avance</th></tr></thead>
                      <tbody>
                        {cierreReport.zonasSinTerminar.map((z) => (
                          <tr key={z.code} style={{ borderBottom: "1px solid var(--line)" }}><td style={{ padding: "7px 10px" }} className="mono">{z.code}</td><td style={{ padding: "7px 10px", textAlign: "right" }}>{z.done}/{z.total} · {z.total ? Math.round(z.done/z.total*100) : 0}%</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {cierreReport.activeByArmador.length > 0 && (
                <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 800, color: "#92400e" }}>⚠️ Activos interrumpidos — quedaron a medias al vencer el turno</div>
                  <div style={{ maxHeight: 120, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <tbody>
                        {cierreReport.activeByArmador.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #fde68a" }}><td style={{ padding: "8px 14px" }}>{r.name}</td><td style={{ padding: "8px 14px" }} className="mono">{r.membreteCode}</td><td style={{ padding: "8px 14px" }} className="mono">{r.zonaCode}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {cierreReport.armadoresSinCompletar.length > 0 && (
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 800, background: "var(--inset)", borderBottom: "1px solid var(--line)" }}>Armadores con zona asignada pero 0 completados en el turno</div>
                  <div style={{ maxHeight: 120, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <tbody>
                        {cierreReport.armadoresSinCompletar.map((a, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}><td style={{ padding: "7px 10px" }}>{a.name}</td><td style={{ padding: "7px 10px" }} className="mono">{a.zonaCode || "—"}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button onClick={() => setCierreReport(null)} className="btn primary" style={{ background: "var(--accent)", color: "#fff" }}>Entendido</button>
              </div>
              <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>El turno se archivó y el roster se limpió — queda todo en Historial/Reportes. El próximo turno inicia familias en 0.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
