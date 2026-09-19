/**
 * @file app/(dashboard)/armador/page.tsx
 * @description Panel del Armador — vista móvil optimizada.
 *
 * Modelo único (cola de zona, por voluntad propia):
 * El supervisor postula al armador a una zona (roster —
 * `Armador.zonaAsignadaCode`, ver módulo de Asignación) y pone membretes en
 * las zonas (sin armador). El armador va a su zona (o a cualquier otra que
 * tenga cola), escanea el QR, y el sistema le entrega — por su propia
 * voluntad, en orden, el más antiguo primero — el siguiente membrete
 * pendiente que encuentre ahí (`claimNextMembreteInZone`). No hay rutas
 * pre-armadas por el supervisor ni "ciclo" que confirmar: el armador
 * simplemente escanea y listo.
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Scanner, type IDetectedBarcode, type IScannerError } from "@yudiel/react-qr-scanner";
import { I } from "@/components/icons";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth-context";
import { UserMenu } from "@/components/user-menu";
import { getZones, getArmadores, createScanSession, updateScanSession, updateZoneAvgMinutes, recalcArmadorProdH, getArmadorSessionState, getScanSessionsByArmador, subscribeMembretes, markMembreteProduct, getMembretesByArmador, claimNextMembreteInZone, completeMembrete } from "@/lib/firestore";
import { getDoc, doc, onSnapshot } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import type { Zone, Armador, ScanSession, Membrete } from "@/types";
import { ZONE_PRIORITY_LABEL, ZONE_PRIORITY_COLOR } from "@/lib/zone-priority";

/** Guarda el estado activo del armador en Firestore vía Admin SDK */
async function persistSession(armadorId: string, state: { active: boolean; finished: boolean; currentZoneCode: string; membreteId: string; sessionId: string; startedAt: number; paused?: boolean; pausedAt?: number; pausedMs?: number; pauseCount?: number } | null) {
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
type FlowState = "idle" | "scan" | "active" | "done";

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

  // Jornada state — el admin debe iniciar la jornada para que el armador pueda escanear
  const [jornadaActiva, setJornadaActiva] = useState(false);
  const [jornadaPaused, setJornadaPaused] = useState(false);

  // Navigation
  const [view, setView] = useState<View>("mapa");
  const [flow, setFlow] = useState<FlowState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Zona de la que el armador está tomando (o acaba de tomar) un membrete
  // por su cuenta — es la zona cuyo QR se espera al escanear.
  const [claimZone, setClaimZone] = useState<Zone | null>(null);

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const zoneStartRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pause state
  const [isPaused, setIsPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [zonePauseMs, setZonePauseMs] = useState(0);
  const [pauseCount, setPauseCount] = useState(0);
  const pauseAccumRef = useRef(0); // total pause ms accumulated

  // Selected zone for detail view
  const [selectedZoneCode, setSelectedZoneCode] = useState<string | null>(null);

  // Escaneo de QR
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastZoneDuration, setLastZoneDuration] = useState(0);

  // Membretes — picking orders
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [activeMembrete, setActiveMembrete] = useState<Membrete | null>(null);

  // "Yo" view — historical stats
  const [historySessions, setHistorySessions] = useState<ScanSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Suscripción en tiempo real al propio documento del armador -- así, si el
  // admin lo postula a otra zona, este armador lo ve al instante sin
  // recargar la página.
  useEffect(() => {
    if (!user?.armadorId) return;
    const unsub = onSnapshot(
      doc(db, "armadores", user.armadorId),
      (snap) => {
        if (!snap.exists()) return;
        setArmador({ id: snap.id, ...snap.data() } as Armador);
      },
      (error) => console.error("armador onSnapshot error:", error)
    );
    return () => unsub();
  }, [user?.armadorId]);

  // Subscribe to membretes (picking orders) for real-time product status
  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = subscribeMembretes(user.companyId, setMembretes);
    return () => unsub();
  }, [user?.companyId]);

  // Subscribe to company for real-time jornada state
  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = onSnapshot(doc(db, "companies", user.companyId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setJornadaActiva(data.jornadaActiva || false);
      setJornadaPaused(!!data.jornadaPausedAt);
    }, (error) => console.error("company onSnapshot error:", error));
    return () => unsub();
  }, [user?.companyId]);

  // Derive active membrete from armador's own membretes
  useEffect(() => {
    if (!armador?.id) { setActiveMembrete(null); return; }
    const myMembrete = membretes.find((m) => m.armadorId === armador.id && m.status === "active");
    setActiveMembrete(myMembrete || null);
  }, [membretes, armador?.id]);

  async function loadData() {
    if (!user?.companyId || !user?.uid) { setLoading(false); return; }
    try {
      const [z, armadores, mem] = await Promise.all([
        getZones(user.companyId),
        getArmadores(user.companyId),
        getMembretesByArmador(user.armadorId || ""),
      ]);
      setZones(z);
      setMembretes(mem);
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
          setJornadaActiva(data.jornadaActiva || false);
          setJornadaPaused(!!data.jornadaPausedAt);
        }
      }).catch(() => {});

      // Restaura la sesión activa (membrete en curso) desde Firestore, si
      // hay una — el tiempo se calcula a partir de Membrete.startedAt, que
      // es dato duro de Firestore y no depende de este estado persistido.
      if (user.armadorId) {
        const myActiveMembrete = mem.find((m) => m.armadorId === user.armadorId && m.status === "active");
        if (myActiveMembrete) {
          const zone = z.find((zz) => zz.code === myActiveMembrete.zonaCode) || null;
          const sessionState = await getArmadorSessionState(user.armadorId);
          setClaimZone(zone);
          setSelectedZoneCode(myActiveMembrete.zonaCode);
          zoneStartRef.current = myActiveMembrete.startedAt || Date.now();
          setFlow("active");
          if (sessionState?.active && sessionState.sessionId) {
            setSessionId(sessionState.sessionId);
            if (sessionState.paused && sessionState.pausedAt) {
              setIsPaused(true);
              setPausedAt(sessionState.pausedAt);
              setZonePauseMs(sessionState.pausedMs || 0);
              setPauseCount(sessionState.pauseCount || 0);
              pauseAccumRef.current = sessionState.pausedMs || 0;
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

  const activeZone = claimZone || undefined;
  const zonaAsignadaCode = armador?.zonaAsignadaCode || null;

  // Timer — se pausa durante la ventana de almuerzo O durante pausa manual del armador
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const lunchNow = isLunchTime(almuerzoInicio, almuerzoDuracionMin);
      setOnLunch(lunchNow);
      if (lunchNow || isPaused) {
        zoneStartRef.current += 1000;
        return;
      }
      if (flow === "active") {
        setElapsedSeconds(Math.floor((Date.now() - zoneStartRef.current - pauseAccumRef.current) / 1000));
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [flow, almuerzoInicio, almuerzoDuracionMin, isPaused]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  /** Estado del punto de vista de ESTE armador para una zona (no el de la
   *  zona en general, que puede tener otros armadores trabajando también). */
  const zoneStatus = (code: string): "active" | "mine" | "queue" | "idle" | "done" => {
    if (flow === "active" && activeZone?.code === code) return "active";
    if (zonaAsignadaCode === code) return "mine";
    const zone = zones.find((z) => z.code === code);
    if (!zone) return "idle";
    // Zona completada: todos sus membretes terminados
    const zoneMembretes = membretes.filter((m) => m.zonaId === zone.id);
    if (zoneMembretes.length > 0 && zoneMembretes.every((m) => m.status === "completed" || m.status === "cancelled")) return "done";
    if (zoneMembretes.some((m) => m.zonaId === zone.id && !m.armadorId && m.status === "pending")) return "queue";
    return "idle";
  };

  // ── Product checking (membrete products) ──────────────────────────────
  const activeMembreteRef = useRef<Membrete | null>(null);
  activeMembreteRef.current = activeMembrete;

  const markProduct = useCallback(async (productIndex: number, status: "completed" | "incident", note?: string) => {
    const mem = activeMembreteRef.current;
    if (!mem?.id) return;
    const products = mem.products || [];
    const nextPendingIdx = products.findIndex((p) => !p.status || p.status === "pending");
    if (productIndex !== nextPendingIdx) return;
    try {
      await markMembreteProduct(mem.id, productIndex, status, note);
    } catch (err) {
      console.error("markProduct error:", err);
    }
  }, []);

  // Derive membrete products for the selected zone
  const membreteForZone = activeMembrete && selectedZoneCode
    ? (activeMembrete.zonaCode === selectedZoneCode ? activeMembrete : null)
    : null;
  const membreteProducts = membreteForZone?.products || [];
  const completedProducts = membreteProducts.filter((p) => p.status === "completed" || p.status === "incident").length;
  const totalProducts = membreteProducts.length;
  const progressPct = totalProducts > 0 ? Math.round((completedProducts / totalProducts) * 100) : 0;
  const allProductsChecked = totalProducts > 0 && completedProducts === totalProducts;
  // Índice del siguiente producto pendiente (para secuencial)
  const nextPendingIdx = membreteProducts.findIndex((p) => !p.status || p.status === "pending");

  /**
   * COLA DE ZONA — el armador elige (por su cuenta) ir a tomar el siguiente
   * membrete disponible de una zona. Solo prepara el escaneo del QR de esa
   * zona; el que realmente reclama el membrete es `handleScanDetected`, una
   * vez confirmada su presencia física con el QR.
   */
  function handleStartClaim(zone: Zone) {
    if (!armador?.id || activeMembrete) return;
    // Zona completada: no se pueden tomar más membretes
    if (zoneStatus(zone.code) === "done") return;
    // Check if jornada is active
    if (!jornadaActiva) {
      setScanError("La jornada no ha sido iniciada. Espera a que el admin inicie las labores.");
      return;
    }
    if (jornadaPaused) {
      setScanError("La jornada está pausada. Espera a que el admin la reanude.");
      return;
    }
    setScanError(null);
    setClaimZone(zone);
    setFlow("scan");
  }

  async function handleScanDetected(detected: IDetectedBarcode[]) {
    if (flow !== "scan") return;
    const raw = detected[0]?.rawValue;
    const expected = claimZone;
    if (!raw || !expected || !user?.uid || !armador?.id || !user.companyId) return;

    const expectedValue = `TRZ://zona/${expected.code}`;
    if (raw !== expectedValue) {
      setScanError(`Ese código no es el de la zona ${expected.code}. Escanea el QR físico pegado en esa zona.`);
      return;
    }

    setScanError(null);

    try {
      const result = await claimNextMembreteInZone(
        { id: expected.id || "", code: expected.code },
        user.companyId,
        { id: armador.id, name: armador.name },
        { uid: user.uid, name: user.name }
      );
      if (!result.membrete) {
        setScanError("No se pudo tomar el membrete. Puede que otro armador lo haya tomado. Intenta de nuevo.");
        return;
      }
      const newSessionId = await createScanSession(
        { armadorId: user.uid, zoneCode: expected.code, startTime: Date.now() },
        { companyId: user.companyId }
      );
      setSessionId(newSessionId);
      zoneStartRef.current = Date.now();
      setElapsedSeconds(0);
      setFlow("active");
      setSelectedZoneCode(expected.code);
      setView("zona");
    } catch (e) {
      console.error("Error claiming membrete:", e);
      setScanError("No se pudo tomar el membrete. Verifica tu conexión e intenta de nuevo.");
    }
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
    if (!sessionId) {
      // Cancelando un intento de toma que todavía no reclamó nada.
      setClaimZone(null);
      setFlow("idle");
      return;
    }
    setFlow("done");
  }

  function handlePause() {
    if (flow !== "active" || isPaused || onLunch) return;
    const now = Date.now();
    setIsPaused(true);
    setPausedAt(now);
    if (user?.armadorId && sessionId && activeMembrete?.id) {
      persistSession(user.armadorId, {
        active: true,
        finished: false,
        currentZoneCode: activeZone?.code || "",
        membreteId: activeMembrete.id,
        sessionId,
        startedAt: zoneStartRef.current,
        paused: true,
        pausedAt: now,
        pausedMs: pauseAccumRef.current,
        pauseCount,
      });
    }
  }

  function handleResume() {
    if (!isPaused || !pausedAt) return;
    const pauseDuration = Date.now() - pausedAt;
    const newAccum = pauseAccumRef.current + pauseDuration;
    pauseAccumRef.current = newAccum;
    setZonePauseMs((prev) => prev + pauseDuration);
    setPauseCount((prev) => prev + 1);
    setIsPaused(false);
    setPausedAt(null);
    if (user?.armadorId && sessionId && activeMembrete?.id) {
      persistSession(user.armadorId, {
        active: true,
        finished: false,
        currentZoneCode: activeZone?.code || "",
        membreteId: activeMembrete.id,
        sessionId,
        startedAt: zoneStartRef.current,
        paused: false,
        pausedMs: newAccum,
        pauseCount: pauseCount + 1,
      });
    }
  }

  /** Termina el membrete que el armador tomó por su cuenta. No toca el
   *  estado de la zona: una zona puede tener a varios armadores tomando
   *  membretes distintos de ella al mismo tiempo, así que su estado ya no
   *  le pertenece a uno solo — el mapa del admin lo calcula a partir de los
   *  membretes activos de la zona (ver `displayStatus` / mod-mapa). */
  async function handleFinishActive() {
    if (flow !== "active" || !claimZone || !activeMembrete?.id || !user) return;

    // ── 1. Capturar y congelar el tiempo ANTES de anything async ──
    const finalElapsed = elapsedSeconds;
    const finalPauseMs = isPaused && pausedAt
      ? zonePauseMs + (Date.now() - pausedAt)
      : zonePauseMs;
    const finalPauseCount = isPaused ? pauseCount + 1 : pauseCount;
    const finishedMembreteId = activeMembrete.id;
    const finishedZone = claimZone;

    // ── 2. Detener el timer INMEDIATAMENTE ──
    setLastZoneDuration(finalElapsed);
    setIsPaused(false);
    setPausedAt(null);
    setZonePauseMs(0);
    setPauseCount(0);
    pauseAccumRef.current = 0;
    setElapsedSeconds(0);
    setFlow("done");

    // ── 3. Trabajo async (fuera del timer) ──
    if (sessionId) {
      try {
        await updateScanSession(
          sessionId,
          { endTime: Date.now(), duration: finalElapsed, pauseMs: finalPauseMs, pauseCount: finalPauseCount },
          user.companyId ? { companyId: user.companyId, zoneCode: finishedZone.code, armadorId: user.uid } : undefined
        );
        if (finishedZone.id && user.companyId) {
          await updateZoneAvgMinutes(finishedZone.id, finalElapsed);
          if (user.armadorId) {
            await recalcArmadorProdH(user.armadorId, user.companyId);
          }
        }
      } catch (e) {
        console.error("Error saving claim session:", e);
      }
    }
    if (user.companyId) {
      try {
        await completeMembrete(finishedMembreteId, finalElapsed * 1000, user.companyId, { uid: user.uid, name: user.name });
      } catch (e) {
        console.error("Error completing membrete:", e);
      }
    }

    setSessionId(null);
    if (user.armadorId) {
      await persistSession(user.armadorId, null);
    }
  }

  function handleSelectZone(code: string) {
    setSelectedZoneCode(code);
    setView("zona");
  }

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
    // Include current active session in today's stats
    const currentSessionActive = flow === "active" && elapsedSeconds > 0;
    // Today's products/incidents from completed membretes
    const todayMembreteCodes = zonesToday.map((s) => s.zoneCode).filter(Boolean);
    const todayMembretes = membretes.filter((m) => todayMembreteCodes.includes(m.zonaCode) && m.status === "completed");
    const todayProducts = todayMembretes.reduce((sum, m) => sum + (m.products?.filter((p) => p.status === "completed" || p.status === "incident").length || 0), 0)
      + (currentSessionActive && activeMembrete ? completedProducts : 0);
    const todayInc = todayMembretes.reduce((sum, m) => sum + (m.products?.filter((p) => p.status === "incident").length || 0), 0)
      + (currentSessionActive && activeMembrete ? membreteProducts.filter((p) => p.status === "incident").length : 0);
    return {
      totalSessions: done.length,
      totalTime,
      avgTime,
      todayZones: zonesToday.length + (currentSessionActive ? 1 : 0),
      todayTime: todayTime + (currentSessionActive ? elapsedSeconds : 0),
      todayProducts,
      todayInc,
      prodH: armador?.prodH || 0,
      cumpl: armador?.cumpl || 0,
      inc: armador?.inc || 0,
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
            <div className="arm-sector">{companyName || "Siamo"}</div>
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

      {/* ─── Persistent Active Timer Bar (visible on ALL views) ─── */}
      {flow === "active" && activeZone && (
        <div className="arm-timer-bar">
          <span className="arm-timer-bar-label">
            {onLunch ? "⏸ EN ALMUERZO" : isPaused ? "⏸ EN PAUSA" : "▶ EN CURSO"}
          </span>
          <span className="arm-timer-bar-zone mono">{activeZone.code}</span>
          <span className="arm-timer-bar-time mono">{onLunch || isPaused ? "⏸" : fmt(elapsedSeconds)}</span>
        </div>
      )}

      {/* ─── Main Content ─────────────────────────────────── */}
      <main className="arm-main">

        {/* ══════ VIEW: MAPA ══════ */}
        {view === "mapa" && (
          <div className="arm-map-view">
            <div className="arm-map-header">
              <h2>Mapa de la bodega</h2>
              <span className="arm-zone-count">{zonaAsignadaCode ? `Tu zona: ${zonaAsignadaCode}` : "Sin zona asignada"}</span>
            </div>

            <div className="arm-map-grid">
              {zones.length === 0 ? (
                <div className="arm-empty-map">
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin zonas registradas</div>
                  <div style={{ fontSize: 12, color: "var(--faint)" }}>Tu administrador todavía no ha creado zonas</div>
                </div>
              ) : (
                <>
                  {!zonaAsignadaCode && (
                    <div style={{ padding: "10px 14px", marginBottom: 10, background: "var(--panel2)", borderRadius: 8, fontSize: 12, color: "var(--faint)" }}>
                      Tu supervisor todavía no te ha asignado una zona — toca cualquier zona con cola para tomar membretes por tu cuenta.
                    </div>
                  )}
                  <div className="arm-zone-grid">
                    {zones.map((z) => {
                      const status = zoneStatus(z.code);
                      const hasQueue = status === "queue";
                      const isDone = status === "done";
                      return (
                        <button
                          key={z.code}
                          className={`arm-zone-tile ${status} ${status === "mine" || status === "active" ? "mine" : status === "done" ? "" : "other"}`}
                          onClick={() => !isDone && handleSelectZone(z.code)}
                          disabled={isDone}
                          style={hasQueue ? { boxShadow: "0 0 0 2px var(--accent) inset" } : undefined}
                        >
                          <span className="arm-zone-code mono">{z.code.replace(/^.*_/, "")}</span>
                          {status === "mine" && <span className="arm-zone-sub">tu zona</span>}
                          {hasQueue && <span className="arm-zone-sub">en cola</span>}
                          {isDone && <span className="arm-zone-sub arm-zone-sub--done">completada</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="arm-legend">
              <span><i style={{ background: "var(--s-active)" }} /> En curso</span>
              <span><i style={{ background: "var(--s-assigned)" }} /> Tu zona</span>
              <span><i style={{ background: "var(--accent)" }} /> Con cola</span>
              <span><i style={{ background: "var(--s-done)" }} /> Completada</span>
              <span><i style={{ background: "var(--s-not)", opacity: 0.5 }} /> Otra</span>
            </div>

            {/* Active Zone Card */}
            {flow === "active" && activeZone && (
              <div className="arm-active-card">
                <div className="arm-active-header">
                  <span className="arm-active-label">{onLunch ? "EN ALMUERZO" : isPaused ? "EN PAUSA" : "EN CURSO"}</span>
                  <span className="arm-active-timer mono">{onLunch ? "⏸" : isPaused ? "⏸" : fmt(elapsedSeconds)}</span>
                </div>
                {onLunch && (
                  <div className="arm-lunch-banner">🍽 Cronómetro en pausa por almuerzo</div>
                )}
                {isPaused && (
                  <div className="arm-lunch-banner" style={{ background: "color-mix(in srgb, var(--s-paused) 12%, transparent)", color: "var(--s-paused)" }}>
                    ⏸ Pausa activa — toca reanudar para continuar
                  </div>
                )}
                <div className="arm-active-zone">
                  <span className="arm-active-zone-code mono">{activeZone.code}</span>
                  <span className="arm-active-zone-info">
                    {activeMembrete?.totalProducts || 0} productos por recolectar
                  </span>
                </div>
                <div className="arm-active-details">
                  {activeMembrete?.pallet && <span>Pallet: {activeMembrete.pallet}</span>}
                  {activeMembrete?.ruta && <span>Ruta: {activeMembrete.ruta}</span>}
                  {activeMembrete?.familia && <span>Familia: {activeMembrete.familia}</span>}
                </div>
                {/* Pause / Resume button */}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {!isPaused && !onLunch ? (
                    <button
                      className="arm-action-btn"
                      style={{ flex: 1, background: "var(--s-paused)", color: "#fff" }}
                      onClick={handlePause}
                    >
                      ⏸ Pausa
                    </button>
                  ) : isPaused ? (
                    <button
                      className="arm-action-btn primary"
                      style={{ flex: 1 }}
                      onClick={handleResume}
                    >
                      ▶ Reanudar
                    </button>
                  ) : null}
                  <button
                    className="arm-action-btn primary"
                    style={{ flex: 1 }}
                    onClick={() => { setSelectedZoneCode(activeZone.code); setView("zona"); }}
                  >
                    <I.box /> Ver contenido
                  </button>
                </div>
              </div>
            )}

            <div className="arm-action-area">
              {/* Jornada status indicator */}
              {flow === "idle" && !jornadaActiva && (
                <div style={{
                  padding: "12px 16px",
                  marginBottom: 12,
                  borderRadius: 8,
                  background: "rgba(107,114,128,0.12)",
                  color: "#6B7280",
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: "center",
                }}>
                  ⏸ La jornada no ha sido iniciada. Espera a que el admin inicie las labores.
                </div>
              )}
              {flow === "idle" && jornadaActiva && jornadaPaused && (
                <div style={{
                  padding: "12px 16px",
                  marginBottom: 12,
                  borderRadius: 8,
                  background: "rgba(245,158,11,0.12)",
                  color: "#F59E0B",
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: "center",
                }}>
                  ⏸ La jornada está pausada. Espera a que el admin la reanude.
                </div>
              )}
              {flow === "idle" && (
                <div className="arm-wait-card">
                  <div className="arm-wait-icon">📦</div>
                  <div className="arm-wait-msg">
                    {zonaAsignadaCode
                      ? `Ve a tu zona ${zonaAsignadaCode} y escanea el QR para tomar el siguiente membrete.`
                      : "Toca una zona con cola en el mapa para escanear y tomar un membrete por tu cuenta."}
                  </div>
                  {zonaAsignadaCode && jornadaActiva && !jornadaPaused && (
                    <button
                      className="arm-action-btn scan"
                      style={{ marginTop: 12 }}
                      onClick={() => {
                        const z = zones.find((zz) => zz.code === zonaAsignadaCode);
                        if (z) handleStartClaim(z);
                      }}
                    >
                      <I.qr /> Escanear tu zona ({zonaAsignadaCode})
                    </button>
                  )}
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
                {zoneStatus(selectedZone.code) === "active" && "● En curso"}
                {zoneStatus(selectedZone.code) === "mine" && "○ Tu zona asignada"}
                {zoneStatus(selectedZone.code) === "queue" && "● Con cola"}
                {zoneStatus(selectedZone.code) === "done" && "✓ Zona completada"}
                {zoneStatus(selectedZone.code) && zoneStatus(selectedZone.code) !== "active" && zoneStatus(selectedZone.code) !== "mine" && zoneStatus(selectedZone.code) !== "queue" && zoneStatus(selectedZone.code) !== "done" && "— Sin cola"}
              </div>
              <h2 className="mono">{selectedZone.code}</h2>
            </div>

            {flow === "active" && activeZone?.code === selectedZone.code && (
              <div className="arm-active-card" style={{ marginBottom: 16 }}>
                <div className="arm-active-header">
                  <span className="arm-active-label">{onLunch ? "EN ALMUERZO" : isPaused ? "EN PAUSA" : "EN CURSO"}</span>
                  <span className="arm-active-timer mono">{onLunch ? "⏸" : isPaused ? "⏸" : fmt(elapsedSeconds)}</span>
                </div>
                {onLunch && (
                  <div className="arm-lunch-banner">🍽 Cronómetro en pausa por almuerzo</div>
                )}
                {isPaused && (
                  <div className="arm-lunch-banner" style={{ background: "color-mix(in srgb, var(--s-paused) 12%, transparent)", color: "var(--s-paused)" }}>
                    ⏸ Pausa activa
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {!isPaused && !onLunch ? (
                    <button
                      className="arm-action-btn"
                      style={{ flex: 1, background: "var(--s-paused)", color: "#fff" }}
                      onClick={handlePause}
                    >
                      ⏸ Pausa
                    </button>
                  ) : isPaused ? (
                    <button
                      className="arm-action-btn primary"
                      style={{ flex: 1 }}
                      onClick={handleResume}
                    >
                      ▶ Reanudar
                    </button>
                  ) : null}
                  <button
                    className="arm-action-btn scan"
                    style={{ flex: 1 }}
                    onClick={handleFinishActive}
                    disabled={onLunch || !allProductsChecked}
                    title={!allProductsChecked ? "Debes checar todos los productos primero" : ""}
                  >
                    <I.qr /> {!allProductsChecked ? `Checa todos los productos (${completedProducts}/${totalProducts})` : "Terminé este membrete"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Membretes de esta zona (post-escaneo) ── */}
            {(() => {
              if (!selectedZone) return null;
              if (flow === "active" && activeZone?.code === selectedZone.code) return null;

              const allZoneMembretes = membretes
                .filter((m) => m.zonaId === selectedZone.id)
                .sort((a, b) => a.code.localeCompare(b.code));

              // Zona completada: todos los membretes terminados
              const isZoneDone = allZoneMembretes.length > 0 && allZoneMembretes.every((m) => m.status === "completed" || m.status === "cancelled");

              if (isZoneDone) {
                return (
                  <div className="panel" style={{ padding: 20, marginBottom: 16, textAlign: "center", borderColor: "var(--s-done)" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>&#10003;</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--s-done)", marginBottom: 4 }}>Zona completada</div>
                    <div style={{ fontSize: 12.5, color: "var(--mut)" }}>Todos los membretes de esta zona han sido terminados.</div>
                    <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>El administrador debe volver a cargar membretes para reactivar esta zona.</div>
                  </div>
                );
              }

              const completedMembretes = allZoneMembretes.filter((m) => m.status === "completed");
              const activeMembretes = allZoneMembretes.filter((m) => m.status === "active");
              const pendingMembretes = allZoneMembretes.filter((m) => m.status === "pending");

              const nextAvailable = pendingMembretes.find((m) => !m.armadorId) || null;
              const disabledPendings = pendingMembretes.filter((m) => m.id !== nextAvailable?.id);
              const hasActiveMembrete = !!activeMembrete;

              return (
                <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Membretes de la zona {selectedZone.code}</div>
                  <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 12 }}>
                    Se toman en orden secuencial. Solo el siguiente disponible esta habilitado.
                  </div>

                  {allZoneMembretes.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "12px 0" }}>No hay membretes en esta zona.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {completedMembretes.map((m) => (
                        <div key={m.id} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--s-done)", background: "rgba(16,185,129,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: 0.7 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, color: "var(--s-done)" }}>&#10003;</span>
                            <span style={{ fontWeight: 600, fontFamily: "var(--mono)", fontSize: 13, textDecoration: "line-through" }}>{m.code}</span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(16,185,129,0.12)", color: "var(--s-done)", fontWeight: 600 }}>Completado</span>
                          </div>
                          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--faint)" }}>
                            {m.pallet && <span>Pallet {m.pallet}{m.palletTotal ? `/${m.palletTotal}` : ""}</span>}
                            <span>{m.totalUnits} uds</span>
                          </div>
                        </div>
                      ))}

                      {activeMembretes.map((m) => (
                        <div key={m.id} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--s-active)", background: "rgba(59,130,246,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14 }}>&#9654;</span>
                            <span style={{ fontWeight: 600, fontFamily: "var(--mono)", fontSize: 13 }}>{m.code}</span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(59,130,246,0.12)", color: "var(--s-active)", fontWeight: 600 }}>En proceso</span>
                            {m.armadorName && <span style={{ fontSize: 11, color: "var(--faint)" }}>— {m.armadorName}</span>}
                          </div>
                          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--faint)" }}>
                            {m.pallet && <span>Pallet {m.pallet}{m.palletTotal ? `/${m.palletTotal}` : ""}</span>}
                            <span>{m.totalUnits} uds</span>
                          </div>
                        </div>
                      ))}

                      {nextAvailable && (
                        <div
                          onClick={() => !hasActiveMembrete && handleStartClaim(selectedZone)}
                          style={{
                            padding: "12px 14px",
                            borderRadius: 8,
                            border: "2px solid var(--accent)",
                            background: hasActiveMembrete ? "var(--panel2)" : "rgba(13,148,136,0.08)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            cursor: hasActiveMembrete ? "not-allowed" : "pointer",
                            opacity: hasActiveMembrete ? 0.5 : 1,
                            transition: "all 0.15s",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 16, color: "var(--accent)" }}>&#9671;</span>
                            <span style={{ fontWeight: 700, fontFamily: "var(--mono)", fontSize: 14, color: "var(--accent)" }}>{nextAvailable.code}</span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(13,148,136,0.15)", color: "var(--accent)", fontWeight: 700 }}>
                              {hasActiveMembrete ? "Termina tu tarea actual primero" : "TAP PARA TOMAR"}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--faint)" }}>
                            {nextAvailable.pallet && <span>Pallet {nextAvailable.pallet}{nextAvailable.palletTotal ? `/${nextAvailable.palletTotal}` : ""}</span>}
                            {nextAvailable.ruta && <span style={{ fontFamily: "var(--mono)" }}>{nextAvailable.ruta}</span>}
                            <span>{nextAvailable.totalUnits} uds</span>
                          </div>
                        </div>
                      )}

                      {disabledPendings.map((m) => (
                        <div key={m.id} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel2)", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: 0.5 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, color: "var(--faint)" }}>&#9675;</span>
                            <span style={{ fontWeight: 600, fontFamily: "var(--mono)", fontSize: 13, color: "var(--faint)" }}>{m.code}</span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(107,114,128,0.12)", color: "var(--faint)", fontWeight: 600 }}>Bloqueado</span>
                          </div>
                          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--faint)" }}>
                            {m.pallet && <span>Pallet {m.pallet}{m.palletTotal ? `/${m.palletTotal}` : ""}</span>}
                            <span>{m.totalUnits} uds</span>
                          </div>
                        </div>
                      ))}

                      {!jornadaActiva && (
                        <div style={{ fontSize: 12, color: "#6B7280", padding: "8px 12px", background: "rgba(107,114,128,0.08)", borderRadius: 6, marginTop: 4 }}>
                          La jornada no ha sido iniciada. Espera a que el admin inicie las labores.
                        </div>
                      )}
                      {jornadaActiva && jornadaPaused && (
                        <div style={{ fontSize: 12, color: "#F59E0B", padding: "8px 12px", background: "rgba(245,158,11,0.08)", borderRadius: 6, marginTop: 4 }}>
                          La jornada esta pausada. Espera a que el admin la reanude.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="arm-zone-info-grid">
              {selectedZone.sector && (
                <div className="arm-zone-info-item">
                  <span className="arm-zone-info-label">Sector</span>
                  <span className="arm-zone-info-value">{selectedZone.sector}</span>
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

            {membreteProducts.length > 0 ? (
              <div className="arm-products">
                <div className="arm-products-header">
                  <h3>Productos — {activeMembrete?.code}</h3>
                  <span className="arm-products-progress mono">{completedProducts}/{totalProducts} ({progressPct}%)</span>
                </div>
                {totalProducts > 0 && (
                  <div className="arm-progress-bar">
                    <div className="arm-progress-fill" style={{ width: `${progressPct}%` }} data-done={progressPct === 100} />
                  </div>
                )}
                <div className="arm-products-list">
                  {membreteProducts.map((p, i) => {
                    const isDone = p.status === "completed" || p.status === "incident";
                    const isNext = i === nextPendingIdx; // Siguiente pendiente
                    const isLocked = !isDone && !isNext; // Bloqueado (no es el siguiente)
                    return (
                      <div key={i} className={`arm-product-row ${isDone ? "done" : ""} ${p.status === "incident" ? "incident" : ""} ${isLocked ? "locked" : ""}`} data-status={p.status || "pending"}>
                        <div className="arm-product-check">
                          {isDone ? (
                            <button className={`arm-check-btn ${p.status}`} title={p.status === "completed" ? "Completado" : p.incidentNote || "Incidencia"}>
                              {p.status === "completed" ? "✓" : "⚠"}
                            </button>
                          ) : isNext ? (
                            <button className="arm-check-btn pending next" onClick={() => markProduct(i, "completed")} title="Marcar como listo">○</button>
                          ) : (
                            <span className="arm-check-btn locked" title="Espera que terminen los productos anteriores">🔒</span>
                          )}
                        </div>
                        <div className="arm-product-info">
                          <div className="arm-product-code mono">{p.codigo}</div>
                          <div className="arm-product-desc">{p.descripcion}</div>
                          {isDone && p.completedAt && (
                            <div className="arm-product-time mono">{new Date(p.completedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                          )}
                        </div>
                        <div className="arm-product-qty mono">x{p.cantidad}</div>
                        {isNext && !isDone && (
                          <button className="arm-incident-btn" onClick={() => {
                            const note = prompt("Describe la incidencia:");
                            if (note !== null) markProduct(i, "incident", note);
                          }} title="Reportar incidencia">!</button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {allProductsChecked && (
                  <div className="arm-products-complete">
                    ✓ Todos los productos completados — ya puedes terminar la zona
                  </div>
                )}
              </div>
            ) : selectedZone.products && selectedZone.products.length > 0 ? (
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
            ) : null}

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

            {/* ── Hero: Productivity Score ── */}
            <div className={`arm-yo-hero ${flow === "active" && elapsedSeconds > 0 ? "arm-yo-hero--active" : ""}`}>
              <div className="arm-yo-hero-glow" />
              <div className="arm-yo-hero-content">
                <div className="arm-yo-score mono">{yoStats.prodH > 0 ? yoStats.prodH : "\u2014"}</div>
                <div className="arm-yo-label">productividad <span className="arm-yo-unit">prod/h</span></div>
              </div>
              <div className="arm-yo-encourage">
                {flow === "active" && elapsedSeconds > 0
                  ? `\u25b6 En zona ${activeZone?.code} \u2014 ${fmt(elapsedSeconds)}`
                  : yoStats.prodH >= 500 ? "\u00a1Rendimiento excepcional!" :
                    yoStats.prodH >= 200 ? "Buen ritmo, sigue as\u00ed" :
                    "Toma tu primer membrete para empezar"}
              </div>
            </div>

            {/* ── Active Session Live ── */}
            {flow === "active" && activeZone && (
              <div className="arm-yo-active-live">
                <div className="arm-yo-active-pulse" />
                <div className="arm-yo-active-body">
                  <div className="arm-yo-active-top">
                    <span className="arm-yo-active-badge">EN CURSO</span>
                    <span className="arm-yo-active-timer mono">{onLunch || isPaused ? "\u23f8" : fmt(elapsedSeconds)}</span>
                  </div>
                  <div className="arm-yo-active-zone">
                    <span className="arm-yo-active-zone-code mono">{activeZone.code}</span>
                    <span className="arm-yo-active-zone-name">{activeZone.name || `Zona ${activeZone.code}`}</span>
                  </div>
                  {activeMembrete && (
                    <div className="arm-yo-active-progress">
                      <div className="arm-yo-active-progress-bar">
                        <div className="arm-yo-active-progress-fill" style={{ width: `${progressPct}%` }} />
                      </div>
                      <span className="arm-yo-active-progress-text mono">{completedProducts}/{totalProducts} productos</span>
                    </div>
                  )}
                  {isPaused && <div className="arm-yo-active-pause-note">\u23f8 En pausa \u2014 toca reanudar</div>}
                  {onLunch && <div className="arm-yo-active-pause-note">\ud83c\udf7d Almuerzo \u2014 cron\u00f3metro en pausa</div>}
                </div>
              </div>
            )}

            {/* ── Today Dashboard ── */}
            <div className="arm-yo-section">
              <h3>Hoy</h3>
              <div className="arm-yo-today-grid">
                <div className="arm-yo-today-card">
                  <div className="arm-yo-today-icon" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }}>
                    <I.box />
                  </div>
                  <div className="arm-yo-today-value mono">{yoStats.todayZones}</div>
                  <div className="arm-yo-today-label">Zonas</div>
                </div>
                <div className="arm-yo-today-card">
                  <div className="arm-yo-today-icon" style={{ background: "color-mix(in srgb, var(--s-active) 12%, transparent)", color: "var(--s-active)" }}>
                    <I.clock />
                  </div>
                  <div className="arm-yo-today-value mono">{fmt(yoStats.todayTime)}</div>
                  <div className="arm-yo-today-label">Tiempo activo</div>
                </div>
                <div className="arm-yo-today-card">
                  <div className="arm-yo-today-icon" style={{ background: "color-mix(in srgb, var(--s-done) 12%, transparent)", color: "var(--s-done)" }}>
                    <I.check />
                  </div>
                  <div className="arm-yo-today-value mono">{yoStats.todayProducts}</div>
                  <div className="arm-yo-today-label">Productos</div>
                </div>
                <div className="arm-yo-today-card">
                  <div className="arm-yo-today-icon" style={{ background: "color-mix(in srgb, var(--s-inc) 12%, transparent)", color: "var(--s-inc)" }}>
                    <I.alert />
                  </div>
                  <div className="arm-yo-today-value mono" style={{ color: yoStats.todayInc > 0 ? "var(--s-inc)" : undefined }}>{yoStats.todayInc}</div>
                  <div className="arm-yo-today-label">Incidencias</div>
                </div>
              </div>
            </div>

            {/* ── Performance Ring ── */}
            <div className="arm-yo-section">
              <h3>Rendimiento</h3>
              <div className="arm-yo-perf-card">
                <div className="arm-yo-perf-ring-wrap">
                  <svg className="arm-yo-perf-ring" viewBox="0 0 100 100">
                    <circle className="arm-yo-perf-ring-bg" cx="50" cy="50" r="40" />
                    <circle className="arm-yo-perf-ring-fill" cx="50" cy="50" r="40"
                      style={{ strokeDasharray: `${(yoStats.cumpl / 100) * 251.3} 251.3` }} />
                  </svg>
                  <div className="arm-yo-perf-ring-center">
                    <span className="arm-yo-perf-ring-pct mono">{yoStats.cumpl}</span>
                    <span className="arm-yo-perf-ring-pct-sign">%</span>
                  </div>
                </div>
                <div className="arm-yo-perf-details">
                  <div className="arm-yo-perf-row">
                    <span className="arm-yo-perf-dot" style={{ background: "var(--s-done)" }} />
                    <span>Cumplimiento</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{yoStats.cumpl}%</span>
                  </div>
                  <div className="arm-yo-perf-row">
                    <span className="arm-yo-perf-dot" style={{ background: "var(--s-inc)" }} />
                    <span>Incidencias</span>
                    <span className="mono" style={{ fontWeight: 600, color: yoStats.inc > 0 ? "var(--s-inc)" : undefined }}>{yoStats.inc}</span>
                  </div>
                  <div className="arm-yo-perf-row">
                    <span className="arm-yo-perf-dot" style={{ background: "var(--accent)" }} />
                    <span>Sesiones totales</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{yoStats.totalSessions}</span>
                  </div>
                  <div className="arm-yo-perf-row">
                    <span className="arm-yo-perf-dot" style={{ background: "var(--s-active)" }} />
                    <span>Promedio / zona</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{yoStats.avgTime > 0 ? `${yoStats.avgTime} min` : "\u2014"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Badges ── */}
            {yoStats.badges.length > 0 && (
              <div className="arm-yo-section">
                <h3>Reconocimientos</h3>
                <div className="arm-yo-badges">
                  {yoStats.badges.filter((b) => b.startsWith("reconocido:")).map((b) => (
                    <div key={b} className="arm-yo-badge">
                      <span className="arm-yo-badge-icon">&#11088;</span>
                      <span>{b.replace("reconocido:", "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Session Timeline ── */}
            <div className="arm-yo-section">
              <h3>Sesiones recientes</h3>
              {historyLoading ? (
                <div className="arm-yo-empty">Cargando historial...</div>
              ) : historySessions.length === 0 ? (
                <div className="arm-yo-empty">
                  <div className="arm-yo-empty-icon">&#128203;</div>
                  <div className="arm-yo-empty-text">Aun no tienes sesiones registradas</div>
                  <div className="arm-yo-empty-hint">Toma un membrete para que aparezca aqui tu historial</div>
                </div>
              ) : (
                <div className="arm-yo-timeline">
                  {historySessions.slice(0, 15).map((s, i) => {
                    const isToday = s.startTime ? new Date(s.startTime).toDateString() === new Date().toDateString() : false;
                    const durMin = s.duration ? Math.floor(s.duration / 60) : 0;
                    const durSec = s.duration ? s.duration % 60 : 0;
                    const pauseMin = s.pauseMs ? Math.floor(s.pauseMs / 60000) : 0;
                    const hour = s.startTime ? new Date(s.startTime).getHours() : 0;
                    const timeOfDay = hour < 12 ? "ma\u00f1ana" : hour < 18 ? "tarde" : "noche";
                    return (
                      <div key={s.id || i} className={`arm-yo-timeline-item ${isToday ? "arm-yo-timeline-item--today" : ""}`}>
                        <div className="arm-yo-timeline-dot" />
                        <div className="arm-yo-timeline-body">
                          <div className="arm-yo-timeline-top">
                            <span className="arm-yo-timeline-zone mono">{s.zoneCode?.replace(/^.*_/, "")}</span>
                            <span className="arm-yo-timeline-time mono">{durMin}:{durSec.toString().padStart(2, "0")}</span>
                          </div>
                          <div className="arm-yo-timeline-meta">
                            <span>{s.startTime ? new Date(s.startTime).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) : "\u2014"}</span>
                            <span className="arm-yo-timeline-tod">{timeOfDay}</span>
                            {pauseMin > 0 && <span className="arm-yo-timeline-pause">\u23f8 {pauseMin}m pausa</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
            <span>Escanea el QR de la zona <strong className="mono">{claimZone?.code}</strong></span>
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
          <div className="arm-scan-hint">
            Apunta la cámara al QR pegado en la zona {claimZone?.code} para tomar el siguiente membrete.
          </div>
        </div>
      )}

      {/* ─── Overlay: membrete terminado (toma voluntaria) ─── */}
      {flow === "done" && claimZone && (
        <div className="arm-scan-overlay arm-done-overlay">
          <div className="arm-finish-icon">✓</div>
          <h3>Membrete completado en {claimZone.code}</h3>
          <div className="arm-finish-time mono">{fmt(lastZoneDuration)}</div>
          <div className="arm-finish-sub">Tiempo en esa tarea</div>

          {(() => {
            const pendingHere = membretes.filter((m) => m.zonaId === claimZone.id && !m.armadorId && m.status === "pending");
            return pendingHere.length > 0 ? (
              <>
                <div className="arm-finish-sub" style={{ marginTop: 8 }}>
                  Quedan {pendingHere.length} membrete{pendingHere.length === 1 ? "" : "s"} más en esta zona.
                </div>
                <button
                  className="arm-action-btn scan"
                  style={{ marginTop: 12 }}
                  onClick={() => { setScanError(null); setFlow("scan"); }}
                >
                  <I.qr /> Tomar el siguiente membrete
                </button>
              </>
            ) : (
              <div className="arm-finish-sub" style={{ marginTop: 8 }}>No quedan más membretes pendientes en esta zona.</div>
            );
          })()}

          <button
            className="btn sm"
            style={{ marginTop: 12 }}
            onClick={() => { setFlow("idle"); setClaimZone(null); setView("mapa"); }}
          >
            Volver al mapa
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
