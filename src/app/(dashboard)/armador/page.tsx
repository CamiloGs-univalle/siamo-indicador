/**
 * @file app/(dashboard)/armador/page.tsx
 * @description Panel del Armador — vista móvil optimizada.
 * Mapa interactivo con zonas asignadas, escaneo QR y temporizador.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { Scanner, type IDetectedBarcode, type IScannerError } from "@yudiel/react-qr-scanner";
import { I } from "@/components/icons";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth-context";
import { UserMenu } from "@/components/user-menu";
import { getZones, getArmadores, createScanSession, updateScanSession, updateZone, updateZoneAvgMinutes, recalcArmadorProdH, getArmadorSessionState, getScanSessionsByArmador } from "@/lib/firestore";
import { getDoc, doc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import type { Zone, Armador, Pos, ScanSession } from "@/types";
import { ZONE_PRIORITY_LABEL, ZONE_PRIORITY_COLOR } from "@/lib/zone-priority";
import { MapFloor } from "@/components/maps/map-floor";

/** Guarda el estado activo del armador en Firestore vía Admin SDK */
async function persistSession(armadorId: string, state: { active: boolean; finished: boolean; currentZoneCode: string; sessionId: string; zoneIndex: number; totalStartedAt: number; startedAt: number; finishedAt?: number; totalElapsed?: number; zonesCompleted?: number; totalZones?: number } | null) {
  const user = auth.currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  const method = state === null ? "PUT" : "POST";
  const res = await fetch("/api/armador-session", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ armadorId, state }),
  });
  if (!res.ok) {
    console.error("persistSession: fallo al guardar el estado", res.status, await res.text().catch(() => ""));
  }
}

/** ¿Cae "now" dentro de la ventana de almuerzo configurada por el admin? */
function isLunchTime(almuerzoInicio: string | null, almuerzoDuracionMin: number, now: Date = new Date()): boolean {
  if (!almuerzoInicio || !almuerzoDuracionMin) return false;
  const [h, m] = almuerzoInicio.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + almuerzoDuracionMin * 60000);
  return now >= start && now < end;
}

type View = "mapa" | "zona" | "yo";
type FlowState = "idle" | "active" | "scan" | "done-zone" | "finish";

export default function ArmadorPage() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armador, setArmador] = useState<Armador | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [almuerzoInicio, setAlmuerzoInicio] = useState<string | null>(null);
  const [almuerzoDuracionMin, setAlmuerzoDuracionMin] = useState(0);
  const [onLunch, setOnLunch] = useState(false);

  // Navigation
  const [view, setView] = useState<View>("mapa");
  const [flow, setFlow] = useState<FlowState>("idle");
  const [currentZoneIndex, setCurrentZoneIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const zoneStartRef = useRef<number>(Date.now());
  const totalStartRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Selected zone for detail view
  const [selectedZoneCode, setSelectedZoneCode] = useState<string | null>(null);

  // Escaneo de QR
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastZoneDuration, setLastZoneDuration] = useState(0);

  // Finish state (persisted)
  const [finishData, setFinishData] = useState<{ totalElapsed: number; zonesCompleted: number; totalZones: number; finishedAt: number } | null>(null);

  // "Yo" view — historical stats
  const [historySessions, setHistorySessions] = useState<ScanSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  async function loadData() {
    if (!user?.companyId || !user?.uid) { setLoading(false); return; }
    try {
      const [z, armadores] = await Promise.all([
        getZones(user.companyId),
        getArmadores(user.companyId),
      ]);
      setZones(z);
      const currentArmador = user.armadorId
        ? armadores.find((a) => a.id === user.armadorId) || null
        : null;
      setArmador(currentArmador);
      getDoc(doc(db, "companies", user.companyId)).then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setCompanyName(data.name || null);
          setAlmuerzoInicio(data.almuerzoInicio || null);
          setAlmuerzoDuracionMin(data.almuerzoDuracionMin || 0);
        }
      }).catch(() => {});

      // Restore active session from Firestore
      if (user.armadorId) {
        const sessionState = await getArmadorSessionState(user.armadorId);
        if (sessionState) {
          if (sessionState.finished && sessionState.finishedAt) {
            // Armador finished all zones — show finish screen, NOT idle
            setFinishData({
              totalElapsed: sessionState.totalElapsed || 0,
              zonesCompleted: sessionState.zonesCompleted || 0,
              totalZones: sessionState.totalZones || 0,
              finishedAt: sessionState.finishedAt,
            });
            setTotalSeconds(sessionState.totalElapsed || 0);
            setFlow("finish");
          } else if (sessionState.active && sessionState.sessionId) {
            // Armador has an active session in progress
            const assigned = z.filter((zz) => zz.armadorId === user.armadorId);
            const idx = assigned.findIndex((zz) => zz.code === sessionState.currentZoneCode);
            if (idx >= 0) {
              setSessionId(sessionState.sessionId);
              setCurrentZoneIndex(idx);
              setFlow("active");
              totalStartRef.current = sessionState.totalStartedAt;
              zoneStartRef.current = sessionState.startedAt;
              setSelectedZoneCode(sessionState.currentZoneCode);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error loading armador data:", error);
    } finally {
      setLoading(false);
    }
  }

  const assignedZones = zones.filter((z) => armador?.id && z.armadorId === armador.id);
  const activeZone = assignedZones[currentZoneIndex];
  const completedCount = currentZoneIndex;
  const totalCount = assignedZones.length;

  // Timer — se pausa durante la ventana de almuerzo
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const lunchNow = isLunchTime(almuerzoInicio, almuerzoDuracionMin);
      setOnLunch(lunchNow);
      if (lunchNow) {
        zoneStartRef.current += 1000;
        totalStartRef.current += 1000;
        return;
      }
      if (flow === "active") {
        setElapsedSeconds(Math.floor((Date.now() - zoneStartRef.current) / 1000));
      }
      setTotalSeconds(Math.floor((Date.now() - totalStartRef.current) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [flow, almuerzoInicio, almuerzoDuracionMin]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const zoneStatus = (code: string): "completed" | "active" | "assigned" | "idle" => {
    const idx = assignedZones.findIndex((z) => z.code === code);
    if (idx < 0) return "idle";
    if (idx < currentZoneIndex) return "completed";
    if (idx === currentZoneIndex && flow === "active") return "active";
    return "assigned";
  };

  const FLOOR_STATUS_COLOR: Record<string, string> = {
    completed: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)", idle: "var(--s-idle)",
  };
  const floorColorOf = (code: string) => FLOOR_STATUS_COLOR[zoneStatus(code)] || "var(--s-idle)";
  const floorOwnerOf = (code: string) => {
    if (assignedZones.some((z) => z.code === code)) return "Tú";
    const zone = zones.find((z) => z.code === code);
    return zone?.armadorId ? "Otro armador" : "Sin asignar";
  };
  const floorPositions: Record<string, Pos> = {};
  zones.forEach((z) => { floorPositions[z.code] = z.position || { x: 0, y: 0 }; });

  function handleStart() {
    if (!armador?.id || assignedZones.length === 0) return;
    setScanError(null);
    setFlow("scan");
  }

  async function handleScanDetected(detected: IDetectedBarcode[]) {
    if (flow !== "scan") return;
    const raw = detected[0]?.rawValue;
    const expected = assignedZones[currentZoneIndex];
    if (!raw || !expected || !user?.uid) return;

    const expectedValue = `TRZ://zona/${expected.code}`;
    if (raw !== expectedValue) {
      setScanError(`Ese código no es el de la zona ${expected.code}. Escanea el QR físico pegado en esa zona.`);
      return;
    }

    setScanError(null);
    try {
      const newSessionId = await createScanSession(
        {
          armadorId: user.uid,
          zoneCode: expected.code,
          startTime: Date.now(),
        },
        user.companyId ? { companyId: user.companyId } : undefined
      );
      setSessionId(newSessionId);
      if (expected.id) {
        await updateZone(expected.id, { status: "active", startedAt: Date.now() }, { uid: user.uid, name: user.name });
      }
      if (user?.armadorId) {
        await persistSession(user.armadorId, {
          active: true,
          finished: false,
          currentZoneCode: expected.code,
          sessionId: newSessionId,
          zoneIndex: currentZoneIndex,
          totalStartedAt: currentZoneIndex === 0 ? Date.now() : totalStartRef.current,
          startedAt: Date.now(),
        });
      }
    } catch (e) {
      console.error("Error creating scan session:", e);
    }

    zoneStartRef.current = Date.now();
    setElapsedSeconds(0);
    if (currentZoneIndex === 0) {
      totalStartRef.current = Date.now();
      setTotalSeconds(0);
    }
    setFlow("active");
    setSelectedZoneCode(expected.code);
    setView("zona");
  }

  function handleScanError(error: IScannerError) {
    const messages: Record<string, string> = {
      "permission-denied": "No diste permiso de cámara. Actívalo en los ajustes del navegador para poder escanear.",
      "no-camera": "No se encontró una cámara en este dispositivo.",
      "in-use": "La cámara está siendo usada por otra app. Ciérrala e inténtalo de nuevo.",
      "insecure-context": "El escaneo requiere una conexión segura (HTTPS).",
    };
    setScanError(messages[error.kind] || "No se pudo abrir la cámara. Inténtalo de nuevo.");
  }

  function handleCancelScan() {
    setScanError(null);
    setFlow(sessionId ? "done-zone" : "idle");
  }

  async function handleFinishZone() {
    if (flow !== "active" || !activeZone) return;
    if (sessionId) {
      try {
        await updateScanSession(
          sessionId,
          { endTime: Date.now(), duration: elapsedSeconds },
          user?.companyId && activeZone ? { companyId: user.companyId, zoneCode: activeZone.code, armadorId: user.uid } : undefined
        );
        if (activeZone.id && user?.companyId) {
          await updateZoneAvgMinutes(activeZone.id, elapsedSeconds);
          if (user.armadorId) {
            await recalcArmadorProdH(user.armadorId, user.companyId);
          }
        }
      } catch (e) {
        console.error("Error saving zone session:", e);
      }
    }
    if (activeZone.id && user) {
      try {
        await updateZone(activeZone.id, { status: "done", finishedAt: Date.now() }, { uid: user.uid, name: user.name });
      } catch (e) {
        console.error("Error updating zone status:", e);
      }
    }
    setLastZoneDuration(elapsedSeconds);

    if (currentZoneIndex >= assignedZones.length - 1) {
      // ALL ZONES DONE — save "finished" state (NOT cleared)
      const now = Date.now();
      const total = Math.floor((now - totalStartRef.current) / 1000);
      setTotalSeconds(total);
      setFinishData({
        totalElapsed: total,
        zonesCompleted: assignedZones.length,
        totalZones: assignedZones.length,
        finishedAt: now,
      });
      setFlow("finish");
      if (user?.armadorId) {
        await persistSession(user.armadorId, {
          active: false,
          finished: true,
          currentZoneCode: activeZone.code,
          sessionId: sessionId || "",
          zoneIndex: currentZoneIndex,
          totalStartedAt: totalStartRef.current,
          startedAt: zoneStartRef.current,
          finishedAt: now,
          totalElapsed: total,
          zonesCompleted: assignedZones.length,
          totalZones: assignedZones.length,
        });
      }
      return;
    }
    setCurrentZoneIndex((i) => i + 1);
    setFlow("done-zone");
  }

  function handleSelectZone(code: string) {
    setSelectedZoneCode(code);
    setView("zona");
  }

  // NO MORE MANUAL RESET — armador waits for admin to assign new zones.
  // The finish screen stays until new zones appear or admin clears the session.

  // Load history for "Yo" view
  async function loadHistory() {
    if (!user?.uid || !user?.companyId || historyLoading) return;
    setHistoryLoading(true);
    try {
      const sessions = await getScanSessionsByArmador(user.uid);
      setHistorySessions(sessions);
    } catch (e) {
      console.error("Error loading history:", e);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (view === "yo" && user?.uid) {
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, user?.uid]);

  const displayName = user?.name || "Armador";
  const initial = displayName[0] || "A";
  const selectedZone = selectedZoneCode ? zones.find((z) => z.code === selectedZoneCode) : null;
  const justFinishedZone = assignedZones[currentZoneIndex - 1];
  const nextZoneToScan = assignedZones[currentZoneIndex];

  // "Yo" view stats from history
  const yoStats = (() => {
    const done = historySessions.filter((s) => s.endTime && s.duration);
    const totalTime = done.reduce((sum, s) => sum + (s.duration || 0), 0);
    const avgTime = done.length > 0 ? Math.round(totalTime / done.length) : 0;
    const zonesToday = done.filter((s) => {
      if (!s.startTime) return false;
      const d = new Date(s.startTime);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    });
    const todayTime = zonesToday.reduce((sum, s) => sum + (s.duration || 0), 0);
    return {
      totalSessions: done.length,
      totalTime,
      avgTime,
      todayZones: zonesToday.length,
      todayTime,
      prodH: armador?.prodH || 0,
      cumpl: armador?.cumpl || 0,
      inc: armador?.inc || 0,
      sector: armador?.sector || "—",
      badges: armador?.badges || [],
    };
  })();

  if (loading) {
    return (
      <div className="arm-loading">
        <div className="arm-loading-spinner" />
        <span>Cargando...</span>
      </div>
    );
  }

  return (
    <div className="arm-shell">
      {/* ─── Top Bar ──────────────────────────────────────── */}
      <header className="arm-topbar">
        <div className="arm-topbar-left">
          <div className="arm-avatar" style={{ background: armador?.color || "var(--accent)" }}>
            {initial}
          </div>
          <div>
            <div className="arm-name">{displayName}</div>
            <div className="arm-sector">{armador?.sector || "Sin sector"} · {companyName || "Siamo"}</div>
          </div>
        </div>
        <div className="arm-topbar-right">
          <button className="arm-icon-btn" onClick={toggleTheme}>
            {theme === "light" ? <I.moon /> : <I.sun />}
          </button>
          <UserMenu
            name={displayName}
            email={user?.email || ""}
            role="Armador"
            color={armador?.color || "var(--accent)"}
          />
        </div>
      </header>

      {/* ─── Main Content ─────────────────────────────────── */}
      <main className="arm-main">

        {/* ══════ VIEW: MAPA ══════ */}
        {view === "mapa" && (
          <div className="arm-map-view">
            <div className="arm-map-header">
              <h2>Mapa de la bodega</h2>
              <span className="arm-zone-count">{totalCount} zonas tuyas</span>
            </div>

            <div className="arm-map-grid">
              {assignedZones.length === 0 ? (
                <div className="arm-empty-map">
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin zonas asignadas</div>
                  <div style={{ fontSize: 12, color: "var(--faint)" }}>Tu administrador aún no te ha asignado zonas</div>
                </div>
              ) : (
                <>
                  {(() => {
                    const allCodes = zones.map((z) => z.code);
                    // Responsive columns: 4 on mobile, 5 on wider
                    return (
                      <div className="arm-zone-grid">
                        {allCodes.map((code) => {
                          const status = zoneStatus(code);
                          const isAssigned = assignedZones.some((z) => z.code === code);
                          const zone = zones.find((z) => z.code === code);
                          return (
                            <button
                              key={code}
                              className={`arm-zone-tile ${status} ${isAssigned ? "mine" : "other"}`}
                              onClick={() => isAssigned && handleSelectZone(code)}
                              disabled={!isAssigned}
                            >
                              <span className="arm-zone-code mono">{code.replace(/^.*_/, "")}</span>
                              {isAssigned && zone && (
                                <span className="arm-zone-sub">{zone.totalProducts || zone.products?.length || 0}p</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            <div className="arm-legend">
              <span><i style={{ background: "var(--s-done)" }} /> Completada</span>
              <span><i style={{ background: "var(--s-active)" }} /> En curso</span>
              <span><i style={{ background: "var(--s-assigned)" }} /> Asignada</span>
              <span><i style={{ background: "var(--s-not)", opacity: 0.5 }} /> Otra</span>
            </div>

            {/* Active Zone Card */}
            {flow === "active" && activeZone && (
              <div className="arm-active-card">
                <div className="arm-active-header">
                  <span className="arm-active-label">{onLunch ? "EN ALMUERZO" : "EN CURSO"}</span>
                  <span className="arm-active-timer mono">{onLunch ? "⏸" : fmt(elapsedSeconds)}</span>
                </div>
                {onLunch && (
                  <div className="arm-lunch-banner">🍽 Cronómetro en pausa por almuerzo</div>
                )}
                <div className="arm-active-zone">
                  <span className="arm-active-zone-code mono">{activeZone.code}</span>
                  <span className="arm-active-zone-info">
                    {activeZone.totalProducts || activeZone.products?.length || 0} productos por recolectar
                  </span>
                </div>
                <div className="arm-active-details">
                  {activeZone.pallet && <span>Pallet: {activeZone.pallet}</span>}
                  {activeZone.ruta && <span>Ruta: {activeZone.ruta}</span>}
                  {activeZone.familia && <span>Familia: {activeZone.familia}</span>}
                </div>
                <button
                  className="arm-action-btn primary"
                  style={{ marginTop: 12 }}
                  onClick={() => { setSelectedZoneCode(activeZone.code); setView("zona"); }}
                >
                  <I.box /> Ver contenido de la zona
                </button>
              </div>
            )}

            <div className="arm-action-area">
              {flow === "idle" ? (
                <button
                  className="arm-action-btn scan"
                  onClick={handleStart}
                  disabled={assignedZones.length === 0}
                >
                  <I.qr /> Escanear QR — Iniciar recorrido
                </button>
              ) : flow === "finish" ? (
                <div className="arm-finish-card">
                  <div className="arm-finish-icon">✓</div>
                  <h3>Recorrido completado</h3>
                  <div className="arm-finish-time mono">{fmt(finishData?.totalElapsed || totalSeconds)}</div>
                  <div className="arm-finish-sub">
                    {finishData?.zonesCompleted || completedCount} de {finishData?.totalZones || totalCount} zonas completadas
                  </div>
                  <div className="arm-finish-sub" style={{ marginTop: 4, fontSize: 11, color: "var(--faint)" }}>
                    Espera nuevas asignaciones de tu supervisor
                  </div>
                </div>
              ) : null}

              {/* Progress */}
              {(flow === "active" || flow === "done-zone" || flow === "scan") && (
                <div className="arm-progress">
                  <div className="arm-progress-bar">
                    <div className="arm-progress-fill" style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }} />
                  </div>
                  <span className="arm-progress-text">{completedCount}/{totalCount} zonas · {fmt(totalSeconds)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════ VIEW: ZONA DETAIL ══════ */}
        {view === "zona" && selectedZone && (
          <div className="arm-zone-detail">
            <button className="arm-back-btn" onClick={() => setView("mapa")}>
              ← Volver al mapa
            </button>

            <div className="arm-zone-detail-header">
              <div className="arm-zone-detail-status" data-status={zoneStatus(selectedZone.code)}>
                {zoneStatus(selectedZone.code) === "completed" && "✓ Completada"}
                {zoneStatus(selectedZone.code) === "active" && "● En curso"}
                {zoneStatus(selectedZone.code) === "assigned" && "○ Asignada"}
                {zoneStatus(selectedZone.code) === "idle" && "— Sin asignar"}
              </div>
              <h2 className="mono">{selectedZone.code}</h2>
              {selectedZone.pallet && (
                <div className="arm-zone-detail-pallet">
                  Pallet: {selectedZone.pallet}{selectedZone.palletTotal ? ` de ${selectedZone.palletTotal}` : ""}
                </div>
              )}
            </div>

            {flow === "active" && activeZone?.code === selectedZone.code && (
              <div className="arm-active-card" style={{ marginBottom: 16 }}>
                <div className="arm-active-header">
                  <span className="arm-active-label">{onLunch ? "EN ALMUERZO" : "EN CURSO"}</span>
                  <span className="arm-active-timer mono">{onLunch ? "⏸" : fmt(elapsedSeconds)}</span>
                </div>
                {onLunch && (
                  <div className="arm-lunch-banner">🍽 Cronómetro en pausa por almuerzo</div>
                )}
                <button className="arm-action-btn scan" onClick={handleFinishZone} disabled={onLunch}>
                  <I.qr /> Terminé esta zona
                </button>
              </div>
            )}

            <div className="arm-zone-info-grid">
              {selectedZone.ruta && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Ruta</span>
                  <span className="arm-zone-info-value mono">{selectedZone.ruta}</span>
                </div>
              )}
              {selectedZone.familia && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Familia</span>
                  <span className="arm-zone-info-value">{selectedZone.familia}</span>
                </div>
              )}
              {selectedZone.camion && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Camión</span>
                  <span className="arm-zone-info-value mono">{selectedZone.camion}</span>
                </div>
              )}
              {selectedZone.sector && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Sector</span>
                  <span className="arm-zone-info-value">{selectedZone.sector}</span>
                </div>
              )}
              {selectedZone.fechaEntrega && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Fecha de entrega</span>
                  <span className="arm-zone-info-value mono">{selectedZone.fechaEntrega}</span>
                </div>
              )}
              {selectedZone.prioridad && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Prioridad</span>
                  <span className="arm-zone-info-value" style={{ color: ZONE_PRIORITY_COLOR[selectedZone.prioridad] }}>
                    {ZONE_PRIORITY_LABEL[selectedZone.prioridad]}
                  </span>
                </div>
              )}
              {selectedZone.avgMinutes != null && selectedZone.avgMinutes > 0 && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Tiempo prom.</span>
                  <span className="arm-zone-info-value mono">{selectedZone.avgMinutes} min</span>
                </div>
              )}
              <div className="arm-zone-info-item">
                <span className="arm-zone-info-label">Productos</span>
                <span className="arm-zone-info-value mono">{selectedZone.totalProducts || selectedZone.products?.length || 0}</span>
              </div>
            </div>

            {selectedZone.products && selectedZone.products.length > 0 && (
              <div className="arm-products">
                <h3>Productos ({selectedZone.products.length})</h3>
                <div className="arm-products-list">
                  {selectedZone.products.map((p, i) => (
                    <div key={i} className="arm-product-row">
                      <div className="arm-product-code mono">{p.codigo}</div>
                      <div className="arm-product-desc">{p.descripcion}</div>
                      <div className="arm-product-qty mono">{p.cantidad}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedZone.incidentNote && (
              <div className="arm-incident-note">
                <strong>Incidencia:</strong> {selectedZone.incidentNote}
              </div>
            )}
          </div>
        )}

        {/* ══════ VIEW: YO ══════ */}
        {view === "yo" && (
          <div className="arm-yo-view">
            {/* Hero Score */}
            <div className="arm-yo-hero">
              <div className="arm-yo-score mono">{yoStats.prodH}</div>
              <div className="arm-yo-label">Productividad (prod/h)</div>
              <div className="arm-yo-encourage">
                {yoStats.prodH >= 500 ? "¡Rendimiento excepcional!" :
                 yoStats.prodH >= 200 ? "Buen ritmo, sigue así" :
                 "Empieza tu recorrido para acumular productividad"}
              </div>
            </div>

            {/* Today's Stats */}
            <div className="arm-yo-section">
              <h3>Hoy</h3>
              <div className="arm-yo-metrics">
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Zonas completadas</span>
                  <span className="arm-yo-metric-value mono">{yoStats.todayZones}</span>
                </div>
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Tiempo hoy</span>
                  <span className="arm-yo-metric-value mono">{fmt(yoStats.todayTime)}</span>
                </div>
                {flow === "finish" && finishData && (
                  <div className="arm-yo-metric">
                    <span className="arm-yo-metric-label">Último recorrido</span>
                    <span className="arm-yo-metric-value mono">{fmt(finishData.totalElapsed)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* General Stats */}
            <div className="arm-yo-section">
              <h3>Mi historial</h3>
              <div className="arm-yo-metrics">
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Sesiones totales</span>
                  <span className="arm-yo-metric-value mono">{yoStats.totalSessions}</span>
                </div>
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Tiempo acumulado</span>
                  <span className="arm-yo-metric-value mono">{fmt(yoStats.totalTime)}</span>
                </div>
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Promedio / zona</span>
                  <span className="arm-yo-metric-value mono">{yoStats.avgTime > 0 ? `${yoStats.avgTime} min` : "—"}</span>
                </div>
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Sector</span>
                  <span className="arm-yo-metric-value">{yoStats.sector}</span>
                </div>
              </div>
            </div>

            {/* Cumplimiento & Incidencias */}
            <div className="arm-yo-section">
              <h3>Rendimiento</h3>
              <div className="arm-yo-metrics">
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Cumplimiento</span>
                  <span className="arm-yo-metric-value mono">{yoStats.cumpl}%</span>
                </div>
                <div className="arm-yo-metric">
                  <span className="arm-yo-metric-label">Incidencias</span>
                  <span className="arm-yo-metric-value mono" style={{ color: yoStats.inc > 0 ? "var(--s-inc)" : undefined }}>{yoStats.inc}</span>
                </div>
              </div>
            </div>

            {/* Badges */}
            {yoStats.badges.length > 0 && (
              <div className="arm-yo-section">
                <h3>Reconocimientos</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {yoStats.badges.filter((b) => b.startsWith("reconocido:")).map((b) => (
                    <span key={b} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: "color-mix(in srgb, var(--gold) 16%, transparent)", color: "var(--gold)", fontWeight: 600 }}>
                      ⭐ {b.replace("reconocido:", "")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Session History */}
            <div className="arm-yo-section">
              <h3>Sesiones recientes</h3>
              {historyLoading ? (
                <div style={{ padding: 16, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Cargando historial...</div>
              ) : historySessions.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>Aún no tienes sesiones registradas</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {historySessions.slice(0, 20).map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--panel2)", borderRadius: 8, fontSize: 12 }}>
                      <span className="mono" style={{ fontWeight: 700, width: 50, flex: "none" }}>{s.zoneCode?.replace(/^.*_/, "")}</span>
                      <span style={{ flex: 1, color: "var(--mut)" }}>{s.startTime ? new Date(s.startTime).toLocaleDateString("es-CO") : "—"}</span>
                      <span className="mono" style={{ fontWeight: 600 }}>{s.duration ? `${Math.round(s.duration / 60)}:${(s.duration % 60).toString().padStart(2, "0")}` : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ─── Overlay: escaneo de QR ────────── */}
      {flow === "scan" && (
        <div className="arm-scan-overlay">
          <div className="arm-scan-header">
            <span>Escanea el QR de la zona <strong className="mono">{nextZoneToScan?.code}</strong></span>
            <button className="arm-icon-btn" onClick={handleCancelScan}>✕</button>
          </div>
          <div className="arm-scan-camera">
            <Scanner
              onScan={handleScanDetected}
              onError={handleScanError}
              formats={["qr_code"]}
              constraints={{ facingMode: "environment" }}
              sound
            />
            <div className="arm-scan-frame" />
          </div>
          {scanError && <div className="arm-scan-error">{scanError}</div>}
          <div className="arm-scan-hint">Apunta la cámara al QR pegado en la zona {nextZoneToScan?.code}.</div>
        </div>
      )}

      {/* ─── Overlay: zona terminada ─── */}
      {flow === "done-zone" && (
        <div className="arm-scan-overlay arm-done-overlay">
          <div className="arm-finish-icon">✓</div>
          <h3>Zona {justFinishedZone?.code} completada</h3>
          <div className="arm-finish-time mono">{fmt(lastZoneDuration)}</div>
          <div className="arm-finish-sub">Tiempo en esa zona</div>

          {nextZoneToScan && (
            <div className="arm-next-map">
              <div className="arm-next-map-head">
                <span>Ve a la zona <strong className="mono">{nextZoneToScan.code}</strong> — Sector {nextZoneToScan.sector}</span>
              </div>
              <div className="arm-mini-floor">
                <MapFloor
                  codes={zones.filter((z) => z.sector === nextZoneToScan.sector).map((z) => z.code)}
                  positions={floorPositions}
                  setPositions={() => {}}
                  editable={false}
                  colorOf={floorColorOf}
                  ownerOf={floorOwnerOf}
                  selected={nextZoneToScan.code}
                  onSelect={() => {}}
                  focusCode={nextZoneToScan.code}
                />
              </div>
              <div className="arm-legend">
                <span><i style={{ background: "var(--s-assigned)" }} /> Tuya, falta</span>
                <span><i style={{ background: "var(--s-done)" }} /> Tuya, lista</span>
                <span><i style={{ background: "var(--s-idle)" }} /> No es tuya</span>
              </div>
            </div>
          )}

          <button
            className="arm-action-btn scan"
            style={{ marginTop: 12 }}
            onClick={() => { setScanError(null); setFlow("scan"); }}
          >
            <I.qr /> Escanear zona {nextZoneToScan?.code}
          </button>
        </div>
      )}

      {/* ─── Bottom Navigation ────────────────────────────── */}
      <nav className="arm-bottomnav">
        <button className={view === "mapa" ? "on" : ""} onClick={() => setView("mapa")}>
          <I.route />
          <span>Mapa</span>
        </button>
        <button className={view === "zona" ? "on" : ""} onClick={() => { if (selectedZoneCode) setView("zona"); }}>
          <I.box />
          <span>Zonas</span>
        </button>
        <button className={view === "yo" ? "on" : ""} onClick={() => setView("yo")}>
          <I.trophy />
          <span>Yo</span>
        </button>
      </nav>
    </div>
  );
}
