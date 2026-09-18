/**
 * @file app/(dashboard)/armador/page.tsx
 * @description Panel del Armador — vista móvil optimizada.
 * Mapa interactivo con zonas asignadas, escaneo QR y temporizador.
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Scanner, type IDetectedBarcode, type IScannerError } from "@yudiel/react-qr-scanner";
import { I } from "@/components/icons";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth-context";
import { UserMenu } from "@/components/user-menu";
import { getZones, getArmadores, createScanSession, updateScanSession, updateZone, updateZoneAvgMinutes, recalcArmadorProdH, getArmadorSessionState, getScanSessionsByArmador, subscribeMembretes, markMembreteProduct, getMembretesByArmador } from "@/lib/firestore";
import { getDoc, doc, onSnapshot } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import type { Zone, Armador, Pos, ScanSession, Membrete } from "@/types";
import { ZONE_PRIORITY_LABEL, ZONE_PRIORITY_COLOR } from "@/lib/zone-priority";
import { MapFloor } from "@/components/maps/map-floor";

/** Guarda el estado activo del armador en Firestore vía Admin SDK */
async function persistSession(armadorId: string, state: { active: boolean; finished: boolean; currentZoneCode: string; sessionId: string; zoneIndex: number; totalStartedAt: number; startedAt: number; finishedAt?: number; totalElapsed?: number; zonesCompleted?: number; totalZones?: number; paused?: boolean; pausedAt?: number; pausedMs?: number; pauseCount?: number } | null) {
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

/**
 * Avisa al servidor que el armador terminó TODAS sus zonas asignadas.
 * Usa el Admin SDK (vía /api/armador-finish-cycle) porque le quita la
 * asignación a cada zona y cierra el ciclo -- algo que un armador no
 * puede hacer directamente por las reglas de Firestore (Zone.armadorId
 * y Armador.cicloEstado son admin-only). Sin esto, las zonas se quedaban
 * "asignadas" para siempre en el módulo de Asignación del admin aunque
 * el armador ya hubiera terminado.
 */
async function finishCycle(armadorId: string) {
  const user = auth.currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  const res = await fetch("/api/armador-finish-cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ armadorId }),
  });
  if (!res.ok) {
    console.error("finishCycle: fallo al cerrar el ciclo", res.status, await res.text().catch(() => ""));
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

  // Finish state (persisted)
  const [finishData, setFinishData] = useState<{ totalElapsed: number; zonesCompleted: number; totalZones: number; finishedAt: number } | null>(null);

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

  // Suscripción en tiempo real al propio documento del armador -- así, en
  // cuanto el admin confirma el ciclo con "Listo" (cicloEstado -> "listo"),
  // este armador lo ve al instante sin tener que recargar la página. El
  // listado de zonas de este panel no es tiempo real (ver loadData), así
  // que cuando el ciclo pasa a "listo" también se refresca una vez para
  // traer lo que el admin acaba de asignar.
  useEffect(() => {
    if (!user?.armadorId) return;
    // onSnapshot dispara inmediatamente con el estado ACTUAL al suscribirse
    // -- eso no es una "transición" real, es solo la primera lectura. Sin
    // este guard, cada vez que el armador recarga la página mientras ya
    // está "listo", este efecto pensaría que el ciclo "recién" se activó y
    // reiniciaría currentZoneIndex/sessionId, pisando la restauración de
    // sesión que hace loadData().
    let isFirstSnapshot = true;
    const unsub = onSnapshot(
      doc(db, "armadores", user.armadorId),
      (snap) => {
        if (!snap.exists()) return;
        const data = { id: snap.id, ...snap.data() } as Armador;
        setArmador((prev) => {
          if (!isFirstSnapshot && prev?.cicloEstado !== "listo" && data.cicloEstado === "listo") {
            if (user.companyId) getZones(user.companyId).then(setZones).catch(() => {});
            setFlow((f) => (f === "finish" ? "idle" : f));
            setFinishData(null);
            setCurrentZoneIndex(0);
            setSessionId(null);
          }
          return data;
        });
        isFirstSnapshot = false;
      },
      (error) => console.error("armador onSnapshot error:", error)
    );
    return () => unsub();
  }, [user?.armadorId, user?.companyId]);

  // Subscribe to membretes (picking orders) for real-time product status
  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = subscribeMembretes(user.companyId, setMembretes);
    return () => unsub();
  }, [user?.companyId]);

  // Derive active membrete from armador's assigned membretes
  useEffect(() => {
    if (!armador?.id) { setActiveMembrete(null); return; }
    const myMembrete = membretes.find(
      (m) => m.armadorId === armador.id && (m.status === "active" || m.status === "pending")
    );
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
            // Armador has an active session in progress — derive assigned zones from membretes
            const myMem = mem.filter((m) => m.armadorId === user.armadorId && m.status !== "cancelled");
            const zoneCodes = Array.from(new Set(myMem.map((m) => m.zonaCode).filter(Boolean)));
            const assigned = z.filter((zz) => zoneCodes.includes(zz.code));
            const idx = assigned.findIndex((zz) => zz.code === sessionState.currentZoneCode);
            if (idx >= 0) {
              setSessionId(sessionState.sessionId);
              setCurrentZoneIndex(idx);
              setFlow("active");
              totalStartRef.current = sessionState.totalStartedAt;
              zoneStartRef.current = sessionState.startedAt;
              setSelectedZoneCode(sessionState.currentZoneCode);
              // Restore pause state
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
      }
    } catch (error) {
      console.error("Error loading armador data:", error);
    } finally {
      setLoading(false);
    }
  }

  // Derive assigned zones from membretes (not from zone.armadorId which is deprecated)
  const myMembretes = membretes.filter((m) => armador?.id && m.armadorId === armador.id && m.status !== "cancelled");
  const assignedZoneCodes = Array.from(new Set(myMembretes.map((m) => m.zonaCode).filter(Boolean)));
  const assignedZones = zones.filter((z) => assignedZoneCodes.includes(z.code));
  const activeZone = assignedZones[currentZoneIndex];
  const completedCount = currentZoneIndex;
  const totalCount = assignedZones.length;
  // El admin ya armó y confirmó este ciclo ("Listo") -- sin esto, el
  // armador podía arrancar apenas se le asignaba una zona, incluso si el
  // admin todavía estaba ajustando la lista.
  const cicloListo = armador?.cicloEstado === "listo";

  // Timer — se pausa durante la ventana de almuerzo O durante pausa manual del armador
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const lunchNow = isLunchTime(almuerzoInicio, almuerzoDuracionMin);
      setOnLunch(lunchNow);
      if (lunchNow || isPaused) {
        // Durante almuerzo o pausa manual, ajustar los refs para que el tiempo no avance
        zoneStartRef.current += 1000;
        totalStartRef.current += 1000;
        return;
      }
      if (flow === "active") {
        setElapsedSeconds(Math.floor((Date.now() - zoneStartRef.current - pauseAccumRef.current) / 1000));
      }
      setTotalSeconds(Math.floor((Date.now() - totalStartRef.current - pauseAccumRef.current) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [flow, almuerzoInicio, almuerzoDuracionMin, isPaused]);

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

  // ── Product checking (membrete products) ──────────────────────────────
  const markProduct = useCallback(async (productIndex: number, status: "completed" | "incident", note?: string) => {
    if (!activeMembrete?.id) return;
    try {
      await markMembreteProduct(activeMembrete.id, productIndex, status, note);
    } catch (err) {
      console.error("markProduct error:", err);
    }
  }, [activeMembrete?.id]);

  // Derive membrete products for the selected zone
  const membreteForZone = activeMembrete && selectedZoneCode
    ? (activeMembrete.zonaCode === selectedZoneCode ? activeMembrete : null)
    : null;
  const membreteProducts = membreteForZone?.products || [];
  const completedProducts = membreteProducts.filter((p) => p.status === "completed" || p.status === "incident").length;
  const totalProducts = membreteProducts.length;
  const progressPct = totalProducts > 0 ? Math.round((completedProducts / totalProducts) * 100) : 0;

  function handleStart() {
    if (!armador?.id || assignedZones.length === 0 || !cicloListo) return;
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

  function handlePause() {
    if (flow !== "active" || isPaused || onLunch) return;
    const now = Date.now();
    setIsPaused(true);
    setPausedAt(now);
    // Persist pause state
    if (user?.armadorId && sessionId) {
      persistSession(user.armadorId, {
        active: true,
        finished: false,
        currentZoneCode: activeZone?.code || "",
        sessionId,
        zoneIndex: currentZoneIndex,
        totalStartedAt: totalStartRef.current,
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
    // Persist resumed state
    if (user?.armadorId && sessionId) {
      persistSession(user.armadorId, {
        active: true,
        finished: false,
        currentZoneCode: activeZone?.code || "",
        sessionId,
        zoneIndex: currentZoneIndex,
        totalStartedAt: totalStartRef.current,
        startedAt: zoneStartRef.current,
        paused: false,
        pausedMs: newAccum,
        pauseCount: pauseCount + 1,
      });
    }
  }

  async function handleFinishZone() {
    if (flow !== "active" || !activeZone) return;
    // If currently paused, close the pause first
    if (isPaused && pausedAt) {
      const pauseDuration = Date.now() - pausedAt;
      pauseAccumRef.current += pauseDuration;
      setZonePauseMs((prev) => prev + pauseDuration);
      setPauseCount((prev) => prev + 1);
      setIsPaused(false);
      setPausedAt(null);
    }
    if (sessionId) {
      try {
        await updateScanSession(
          sessionId,
          { endTime: Date.now(), duration: elapsedSeconds, pauseMs: zonePauseMs, pauseCount },
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

    // Reset pause state for next zone
    setIsPaused(false);
    setPausedAt(null);
    setZonePauseMs(0);
    setPauseCount(0);
    pauseAccumRef.current = 0;

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
        // Cierra el ciclo del lado del servidor: le quita las zonas
        // (para que el admin ya no las vea "asignadas") y deja todo
        // esperando a que arme el próximo ciclo.
        await finishCycle(user.armadorId);
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
                    {activeZone.totalProducts || activeZone.products?.length || 0} productos por recolectar
                  </span>
                </div>
                <div className="arm-active-details">
                  {activeZone.pallet && <span>Pallet: {activeZone.pallet}</span>}
                  {activeZone.ruta && <span>Ruta: {activeZone.ruta}</span>}
                  {activeZone.familia && <span>Familia: {activeZone.familia}</span>}
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
              {flow === "idle" ? (
                assignedZones.length === 0 ? (
                  <div className="arm-wait-card">
                    <div className="arm-wait-icon">⏳</div>
                    <div className="arm-wait-msg">Espera nuevas asignaciones de tu supervisor</div>
                  </div>
                ) : !cicloListo ? (
                  <div className="arm-wait-card">
                    <div className="arm-wait-icon">⏳</div>
                    <div className="arm-wait-msg">Tu supervisor está preparando tu recorrido — espera a que lo confirme para poder iniciar.</div>
                  </div>
                ) : (
                  <button
                    className="arm-action-btn scan"
                    onClick={handleStart}
                  >
                    <I.qr /> Escanear QR — Iniciar recorrido
                  </button>
                )
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
                  <button className="arm-action-btn scan" style={{ flex: 1 }} onClick={handleFinishZone} disabled={onLunch}>
                    <I.qr /> Terminé esta zona
                  </button>
                </div>
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
                  {membreteProducts.map((p, i) => (
                    <div key={i} className={`arm-product-row ${p.status === "completed" ? "done" : ""} ${p.status === "incident" ? "incident" : ""}`} data-status={p.status || "pending"}>
                      <div className="arm-product-check">
                        {p.status === "completed" ? (
                          <button className="arm-check-btn done" onClick={() => markProduct(i, "completed")} title="Completado">✓</button>
                        ) : p.status === "incident" ? (
                          <button className="arm-check-btn incident" onClick={() => markProduct(i, "incident", p.incidentNote)} title={p.incidentNote || "Incidencia"}>⚠</button>
                        ) : (
                          <button className="arm-check-btn pending" onClick={() => markProduct(i, "completed")} title="Marcar como listo">○</button>
                        )}
                      </div>
                      <div className="arm-product-info">
                        <div className="arm-product-code mono">{p.codigo}</div>
                        <div className="arm-product-desc">{p.descripcion}</div>
                      </div>
                      <div className="arm-product-qty mono">x{p.cantidad}</div>
                      {p.status !== "completed" && p.status !== "incident" && (
                        <button className="arm-incident-btn" onClick={() => {
                          const note = prompt("Describe la incidencia:");
                          if (note !== null) markProduct(i, "incident", note);
                        }} title="Reportar incidencia">!</button>
                      )}
                    </div>
                  ))}
                </div>
                {progressPct === 100 && (
                  <div className="arm-products-complete">
                    ✓ Todos los productos completados
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
