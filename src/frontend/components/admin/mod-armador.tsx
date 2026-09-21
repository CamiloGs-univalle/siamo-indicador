/**
 * @file components/admin/mod-armador.tsx
 * @description Módulo "Armador" — Combina Control de Jornada + Gestión de Equipo.
 *
 * Sub-módulos:
 * 1. Jornada: Control de jornada, asignación de armadores a zonas, roster.
 * 2. Equipo: CRUD de armadores (crear, editar, eliminar).
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/frontend/components/icons";
import { useAuth } from "@/frontend/context/auth-context";
import {
  subscribeZones,
  subscribeArmadores,
  subscribeMembretes,
  assignArmadorToZone,
  unassignArmadorFromZone,
  getCompany,
  getArmadores,
  createArmador,
  updateArmador,
  deleteArmador,
  iniciarJornada,
  pausarJornada,
  reanudarJornada,
  finalizarJornada,
} from "@/frontend/services/firestore";
import type { Zone, Armador, Membrete } from "@/types";

/* ─── Types ────────────────────────────────────────────────────────────────── */

type Tab = "jornada" | "equipo";
type EditingState = Armador | "new" | null;

interface JornadaState {
  jornadaActiva: boolean;
  jornadaStartedAt?: number;
  jornadaPausedAt?: number | null;
}

const AVATAR_COLORS = ["#0E7C7B", "#7C3AED", "#D97706", "#DC2626", "#16A34A", "#2563EB"];

/* ─── Component ────────────────────────────────────────────────────────────── */

export function ModArmador() {
  const { user } = useAuth();
  const companyId = user?.companyId;
  const [tab, setTab] = useState<Tab>("jornada");

  /* ── Shared state ──────────────────────────────────────────────────────── */
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [armadoresLoaded, setArmadoresLoaded] = useState(false);

  /* ── Jornada state ─────────────────────────────────────────────────────── */
  const [jornada, setJornada] = useState<JornadaState>({ jornadaActiva: false });
  const [jornadaLoading, setJornadaLoading] = useState(false);
  const [companyShifts, setCompanyShifts] = useState<{ label: string; inicio: string; fin: string }[]>([]);
  const [selectedShiftIdx, setSelectedShiftIdx] = useState(0);
  const [pickZoneCode, setPickZoneCode] = useState("");
  const [pickArmadorId, setPickArmadorId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [savingArmadorId, setSavingArmadorId] = useState<string | null>(null);

  /* ── Equipo state ──────────────────────────────────────────────────────── */
  const [eqLoading, setEqLoading] = useState(true);
  const [eqLoadError, setEqLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [formName, setFormName] = useState("");
  const [formCedula, setFormCedula] = useState("");
  const [formCostPerHour, setFormCostPerHour] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ── Subscriptions ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!companyId) return;
    const unsubZones = subscribeZones(companyId, setZones);
    const unsubArmadores = subscribeArmadores(companyId, (a) => {
      setArmadores(a);
      setArmadoresLoaded(true);
    });
    const unsubMembretes = subscribeMembretes(companyId, setMembretes);
    getCompany(companyId).then((c) => {
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
  }, [companyId]);

  /* ── Equipo: load armadores ────────────────────────────────────────────── */
  useEffect(() => {
    if (companyId) loadArmadores(companyId);
    else setEqLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function loadArmadores(cid: string) {
    setEqLoading(true);
    setEqLoadError(null);
    try {
      const list = await getArmadores(cid);
      list.sort((a, b) => a.name.localeCompare(b.name));
      setArmadores(list);
    } catch (err) {
      setEqLoadError(err instanceof Error ? err.message : "No se pudo cargar el equipo.");
    } finally {
      setEqLoading(false);
    }
  }

  /* ── Jornada stats ─────────────────────────────────────────────────────── */
  const armadoresAsignados = armadores.filter((a) => a.zonaAsignadaCode);
  const armadoresActivos = armadores.filter((a) =>
    membretes.some((m) => m.armadorId === a.id && m.status === "active")
  );
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

  function activeMembreteOf(armadorId: string): Membrete | undefined {
    return membretes.find((m) => m.armadorId === armadorId && m.status === "active");
  }

  const isPaused = !!jornada.jornadaPausedAt;
  const isActive = jornada.jornadaActiva && !isPaused;

  /* ── Jornada handlers ──────────────────────────────────────────────────── */
  async function handleIniciarJornada() {
    if (!companyId) return;
    if (companyShifts.length === 0) {
      setMsg("No hay turnos configurados. Ve a Configuración para definir los turnos.");
      return;
    }
    setJornadaLoading(true);
    try {
      const shift = companyShifts[selectedShiftIdx];
      await iniciarJornada(companyId, { uid: user!.uid, name: user!.name }, { inicio: shift.inicio, fin: shift.fin });
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
    if (!companyId) return;
    setJornadaLoading(true);
    try {
      await pausarJornada(companyId, { uid: user!.uid, name: user!.name });
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
    if (!companyId) return;
    setJornadaLoading(true);
    try {
      await reanudarJornada(companyId, { uid: user!.uid, name: user!.name });
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
    if (!companyId) return;
    if (!confirm("¿Estás seguro de finalizar la jornada? Los armadores no podrán tomar más membretes.")) return;
    setJornadaLoading(true);
    try {
      await finalizarJornada(companyId, { uid: user!.uid, name: user!.name });
      setJornada({ jornadaActiva: false, jornadaPausedAt: null });
      setMsg("Jornada finalizada.");
    } catch (e) {
      console.error("Error finishing jornada:", e);
      setMsg("Error al finalizar la jornada.");
    } finally {
      setJornadaLoading(false);
    }
  }

  /* ── Assign / Unassign ─────────────────────────────────────────────────── */
  async function handleAssign() {
    if (!pickZoneCode || !pickArmadorId || !companyId) return;
    const zone = zones.find((z) => z.code === pickZoneCode);
    const armador = armadores.find((a) => a.id === pickArmadorId);
    if (!zone?.id || !armador) return;
    setAssigning(true);
    setMsg(null);
    try {
      await assignArmadorToZone(
        { id: zone.id, code: zone.code },
        companyId,
        { id: armador.id, name: armador.name },
        { uid: user!.uid, name: user!.name }
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
    if (!a.zonaAsignadaCode || !companyId) return;
    setSavingArmadorId(a.id);
    try {
      await unassignArmadorFromZone(
        { id: a.id, name: a.name },
        a.zonaAsignadaCode,
        companyId,
        { uid: user!.uid, name: user!.name }
      );
    } catch (error) {
      console.error("Error unassigning armador from zone:", error);
    } finally {
      setSavingArmadorId(null);
    }
  }

  /* ── Equipo handlers ───────────────────────────────────────────────────── */
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
    if (!companyId) return;
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
          companyId: companyId!,
          name, cedula,
          color: AVATAR_COLORS[armadores.length % AVATAR_COLORS.length],
          route: [], prodH: 0, cumpl: 0, inc: 0, retrab: 0, index: 0, trend: "0%", badges: [],
        };
        if (formCostPerHour !== "") (createData as Record<string, unknown>).costPerHour = Number(formCostPerHour);
        await createArmador(createData);
      } else if (editing) {
        const updateData: Record<string, unknown> = { name, cedula };
        if (formCostPerHour !== "") updateData.costPerHour = Number(formCostPerHour);
        await updateArmador(editing.id, updateData);
      }
      closeForm();
      await loadArmadores(companyId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el armador.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(arm: Armador) {
    if (!companyId) return;
    if (!confirm(`¿Eliminar a ${arm.name} del equipo? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteArmador(arm.id, { companyId: arm.companyId, name: arm.name });
      if (editing !== "new" && editing?.id === arm.id) closeForm();
      await loadArmadores(companyId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo eliminar el armador.");
    }
  }

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Header + Tabs ──────────────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 0, flexShrink: 0 }}>
        <div style={{ padding: "14px 20px 0" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>Armador</h2>
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--line)" }}>
            {([["jornada", "Jornada & Asignación"], ["equipo", "Gestión de Equipo"]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  borderBottom: `2px solid ${tab === id ? "var(--accent)" : "transparent"}`,
                  background: "transparent",
                  color: tab === id ? "var(--accent)" : "var(--faint)",
                  cursor: "pointer",
                  transition: "all .15s",
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab Content ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 0 0" }}>
        {tab === "jornada" && (
          <JornadaTab
            jornada={jornada}
            jornadaLoading={jornadaLoading}
            isPaused={isPaused}
            isActive={isActive}
            companyShifts={companyShifts}
            selectedShiftIdx={selectedShiftIdx}
            setSelectedShiftIdx={setSelectedShiftIdx}
            msg={msg}
            armadoresAsignados={armadoresAsignados}
            armadoresActivos={armadoresActivos}
            membretesPendientes={membretesPendientes}
            membretesActivos={membretesActivos}
            membretesCompletados={membretesCompletados}
            handleIniciarJornada={handleIniciarJornada}
            handlePausarJornada={handlePausarJornada}
            handleReanudarJornada={handleReanudarJornada}
            handleFinalizarJornada={handleFinalizarJornada}
            zones={zones}
            armadores={armadores}
            sortedZonesByQueue={sortedZonesByQueue}
            queueByZoneCode={queueByZoneCode}
            pickArmadorId={pickArmadorId}
            setPickArmadorId={setPickArmadorId}
            pickZoneCode={pickZoneCode}
            setPickZoneCode={setPickZoneCode}
            assigning={assigning}
            handleAssign={handleAssign}
            armadoresLoaded={armadoresLoaded}
            sortedArmadores={sortedArmadores}
            activeMembreteOf={activeMembreteOf}
            savingArmadorId={savingArmadorId}
            handleUnassign={handleUnassign}
          />
        )}

        {tab === "equipo" && (
          <EquipoTab
            companyId={companyId!}
            armadores={armadores}
            loading={eqLoading}
            loadError={eqLoadError}
            editing={editing}
            formName={formName}
            setFormName={setFormName}
            formCedula={formCedula}
            setFormCedula={setFormCedula}
            formCostPerHour={formCostPerHour}
            setFormCostPerHour={setFormCostPerHour}
            saving={saving}
            formError={formError}
            openNew={openNew}
            openEdit={openEdit}
            closeForm={closeForm}
            handleSave={handleSave}
            handleDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SUB-TAB: Jornada & Asignación
   ═══════════════════════════════════════════════════════════════════════════════ */

interface JornadaTabProps {
  jornada: JornadaState;
  jornadaLoading: boolean;
  isPaused: boolean;
  isActive: boolean;
  companyShifts: { label: string; inicio: string; fin: string }[];
  selectedShiftIdx: number;
  setSelectedShiftIdx: (i: number) => void;
  msg: string | null;
  armadoresAsignados: Armador[];
  armadoresActivos: Armador[];
  membretesPendientes: Membrete[];
  membretesActivos: Membrete[];
  membretesCompletados: Membrete[];
  handleIniciarJornada: () => void;
  handlePausarJornada: () => void;
  handleReanudarJornada: () => void;
  handleFinalizarJornada: () => void;
  zones: Zone[];
  armadores: Armador[];
  sortedZonesByQueue: Zone[];
  queueByZoneCode: Record<string, number>;
  pickArmadorId: string;
  setPickArmadorId: (v: string) => void;
  pickZoneCode: string;
  setPickZoneCode: (v: string) => void;
  assigning: boolean;
  handleAssign: () => void;
  armadoresLoaded: boolean;
  sortedArmadores: Armador[];
  activeMembreteOf: (id: string) => Membrete | undefined;
  savingArmadorId: string | null;
  handleUnassign: (a: Armador) => void;
}

function JornadaTab(props: JornadaTabProps) {
  const {
    jornada, jornadaLoading, isPaused, isActive,
    companyShifts, selectedShiftIdx, setSelectedShiftIdx,
    msg, armadores, armadoresAsignados, armadoresActivos,
    membretesPendientes, membretesActivos, membretesCompletados,
    handleIniciarJornada, handlePausarJornada, handleReanudarJornada, handleFinalizarJornada,
    zones, sortedZonesByQueue, queueByZoneCode,
    pickArmadorId, setPickArmadorId, pickZoneCode, setPickZoneCode,
    assigning, handleAssign, armadoresLoaded,
    sortedArmadores, activeMembreteOf, savingArmadorId, handleUnassign,
  } = props;

  return (
    <>
      {/* ── Control de Jornada ──────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Control de Jornada</h3>
            <p style={{ margin: 0, fontSize: 12, color: "var(--faint)" }}>
              Inicia la jornada para que los armadores puedan escanear y tomar membretes.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: jornada.jornadaActiva
                  ? isPaused ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)"
                  : "rgba(107,114,128,0.12)",
                color: jornada.jornadaActiva
                  ? isPaused ? "#F59E0B" : "#10B981"
                  : "#6B7280",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor", animation: isActive ? "pulse 2s infinite" : "none" }} />
              {jornada.jornadaActiva ? (isPaused ? "PAUSADA" : "ACTIVA") : "INACTIVA"}
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
                          padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                          background: i === selectedShiftIdx ? "#10B981" : "transparent",
                          color: i === selectedShiftIdx ? "#fff" : "var(--faint)",
                          transition: "all .15s",
                        }}
                      >
                        {s.label}
                        <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4, opacity: 0.8 }}>{s.inicio}→{s.fin}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button className="btn primary" onClick={handleIniciarJornada} disabled={jornadaLoading || companyShifts.length === 0} style={{ background: "#10B981", color: "#fff" }}>
                  {jornadaLoading ? "Iniciando..." : "▶ Iniciar labores"}
                </button>
              </>
            ) : isPaused ? (
              <>
                <button className="btn primary" onClick={handleReanudarJornada} disabled={jornadaLoading} style={{ background: "#10B981", color: "#fff" }}>
                  {jornadaLoading ? "Reanudando..." : "▶ Reanudar"}
                </button>
                <button className="btn" onClick={handleFinalizarJornada} disabled={jornadaLoading} style={{ background: "#EF4444", color: "#fff" }}>
                  {jornadaLoading ? "Finalizando..." : "⏹ Finalizar"}
                </button>
              </>
            ) : (
              <>
                <button className="btn" onClick={handlePausarJornada} disabled={jornadaLoading} style={{ background: "#F59E0B", color: "#fff" }}>
                  {jornadaLoading ? "Pausando..." : "⏸ Pausar"}
                </button>
                <button className="btn" onClick={handleFinalizarJornada} disabled={jornadaLoading} style={{ background: "#EF4444", color: "#fff" }}>
                  {jornadaLoading ? "Finalizando..." : "⏹ Finalizar"}
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          {[
            { label: "Asignados", value: armadoresAsignados.length, color: "var(--accent)" },
            { label: "Trabajando", value: armadoresActivos.length, color: "#10B981" },
            { label: "En cola", value: membretesPendientes.length, color: "#F59E0B" },
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
          Selecciona el armador y la zona donde trabajará.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={pickArmadorId} onChange={(e) => setPickArmadorId(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, minWidth: 180 }}>
            <option value="">Selecciona un armador...</option>
            {armadores.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.zonaAsignadaCode ? ` (${a.zonaAsignadaCode})` : ""}</option>
            ))}
          </select>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>→</span>
          <select value={pickZoneCode} onChange={(e) => setPickZoneCode(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, minWidth: 200 }}>
            <option value="">Selecciona una zona...</option>
            {sortedZonesByQueue.map((z) => (
              <option key={z.code} value={z.code}>{z.code}{queueByZoneCode[z.code] ? ` — ${queueByZoneCode[z.code]} en cola` : ""}</option>
            ))}
          </select>
          <button className="btn sm primary" disabled={!pickZoneCode || !pickArmadorId || assigning} onClick={handleAssign}>
            {assigning ? "Asignando..." : "Asignar"}
          </button>
        </div>
      </div>

      {/* ── Roster ──────────────────────────────────────────────────────── */}
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
            No hay armadores registrados. Crea uno en la pestaña &quot;Gestión de Equipo&quot;.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
                  {["Armador", "Zona asignada", "Ahora mismo", "Acciones"].map((h) => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: h === "Acciones" ? "center" : "left", fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".04em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedArmadores.map((a) => {
                  const activeMembrete = activeMembreteOf(a.id);
                  return (
                    <tr key={a.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 24, height: 24, borderRadius: 6, background: a.color || "var(--accent)", display: "inline-grid", placeItems: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                            {a.name[0]}
                          </span>
                          {a.name}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {a.zonaAsignadaCode ? (
                          <span className="mono" style={{ fontWeight: 600, color: "var(--accent)" }}>{a.zonaAsignadaCode}</span>
                        ) : (
                          <span style={{ color: "var(--faint)" }}>Sin zona</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>
                        {activeMembrete ? (
                          <span style={{ color: "var(--s-active)", fontWeight: 600 }}>● {activeMembrete.code} en {activeMembrete.zonaCode}</span>
                        ) : (
                          <span style={{ color: "var(--faint)" }}>Sin tarea</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        {a.zonaAsignadaCode && (
                          <button className="btn ghost sm" style={{ color: "var(--s-not)" }} onClick={() => handleUnassign(a)} disabled={savingArmadorId === a.id}>
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
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SUB-TAB: Gestión de Equipo
   ═══════════════════════════════════════════════════════════════════════════════ */

interface EquipoTabProps {
  companyId: string;
  armadores: Armador[];
  loading: boolean;
  loadError: string | null;
  editing: EditingState;
  formName: string;
  setFormName: (v: string) => void;
  formCedula: string;
  setFormCedula: (v: string) => void;
  formCostPerHour: number | "";
  setFormCostPerHour: (v: number | "") => void;
  saving: boolean;
  formError: string | null;
  openNew: () => void;
  openEdit: (arm: Armador) => void;
  closeForm: () => void;
  handleSave: () => void;
  handleDelete: (arm: Armador) => void;
}

function EquipoTab(props: EquipoTabProps) {
  const {
    companyId, armadores, loading, loadError,
    editing, formName, setFormName, formCedula, setFormCedula,
    formCostPerHour, setFormCostPerHour, saving, formError,
    openNew, openEdit, closeForm, handleSave, handleDelete,
  } = props;

  return (
    <div style={{ display: "grid", gridTemplateColumns: editing ? "1fr 340px" : "1fr", gap: 16, alignItems: "start" }}>
      <div className="panel">
        <div className="panel-h">
          <h3>Armadores ({armadores.length})</h3>
          <button className="btn primary sm" onClick={openNew}>+ Agregar armador</button>
        </div>

        {!companyId ? (
          <div style={{ padding: 16 }}>
            <div className="alert warn"><I.alert /> Tu usuario no tiene una empresa asociada.</div>
          </div>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando…</div>
        ) : loadError ? (
          <div style={{ padding: 16 }}><div className="alert warn"><I.alert /> {loadError}</div></div>
        ) : armadores.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👷</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Sin armadores todavía</div>
            <div style={{ fontSize: 13, color: "var(--mut)", marginBottom: 20 }}>Agrega a las personas que van a escanear los QR de las zonas.</div>
            <button className="btn primary" onClick={openNew}>+ Agregar armador</button>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Armador</th>
                <th>Costo/hora</th>
                <th>Índice</th>
                <th>Acceso</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {armadores.map((arm) => (
                <tr key={arm.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="avatar" style={{ background: arm.color || "var(--s-inc)", width: 28, height: 28, fontSize: 11 }}>
                        {arm.name[0]?.toUpperCase()}
                      </span>
                      <div>
                        <div style={{ fontWeight: 500 }}>{arm.name}</div>
                        {arm.cedula && <div style={{ fontSize: 11, color: "var(--faint)" }}>CC: {arm.cedula}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="mono">{arm.costPerHour ? `$${arm.costPerHour.toLocaleString("es-CO")}` : "—"}</td>
                  <td className="mono">{arm.index ? arm.index : "—"}</td>
                  <td>
                    {arm.authUid ? (
                      <span className="chip" style={{ background: "color-mix(in srgb,var(--s-done) 16%,transparent)", color: "var(--s-done)" }}>Ya inició sesión</span>
                    ) : arm.cedula ? (
                      <span style={{ fontSize: 11.5, color: "var(--mut)" }}>Puede entrar con CC {arm.cedula}</span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Sin cédula</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn sm" onClick={() => openEdit(arm)} style={{ marginRight: 6 }}>Editar</button>
                    <button className="btn sm" style={{ color: "var(--s-not)" }} onClick={() => handleDelete(arm)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="panel">
          <div className="panel-h"><h3>{editing === "new" ? "Nuevo armador" : "Editar armador"}</h3></div>
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
            {formError && <div className="alert warn" style={{ marginBottom: 12 }}><I.alert /> {formError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
                {saving ? "Guardando…" : editing === "new" ? "Agregar armador" : "Guardar cambios"}
              </button>
              <button className="btn" onClick={closeForm}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
