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
import { useRouter } from "next/navigation";
import { Scanner, type IDetectedBarcode, type IScannerError } from "@yudiel/react-qr-scanner";
import { I } from "@/frontend/components/icons";
import { useTheme } from "@/frontend/hooks/use-theme";
import { useAuth } from "@/frontend/context/auth-context";
import { UserMenu } from "@/frontend/components/user-menu";
import { getZones, getArmadores, subscribeArmadores, updateArmador, createScanSession, updateScanSession, updateZoneAvgMinutes, recalcArmadorProdH, getArmadorSessionState, getScanSessionsByArmador, subscribeMembretes, markMembreteProduct, claimNextMembreteInZone, claimMembrete, completeMembrete } from "@/frontend/services/firestore";
import { getDoc, doc, onSnapshot, collection, query, where, getDocs } from "firebase/firestore";
import { db, auth } from "@/frontend/services/firebase";
import type { Zone, Armador, ScanSession, Membrete } from "@/types";
import { ZONE_PRIORITY_LABEL, ZONE_PRIORITY_COLOR } from "@/frontend/services/zone-priority";

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
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (user.role !== "armador" && user.role !== "admin" && user.role !== "super_admin") {
      router.replace("/login");
    }
  }, [user, authLoading, router]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [armador, setArmador] = useState<Armador | null>(null);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
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
  const [expandedMembreteId, setExpandedMembreteId] = useState<string | null>(null);

  // Escaneo de QR — marca asistencia (una vez por jornada, oculto a armador)
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastZoneDuration, setLastZoneDuration] = useState(0);
  const [hasMarkedAttendance, setHasMarkedAttendance] = useState(false);
  const [generalStartTime, setGeneralStartTime] = useState<number | null>(null);

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
        const data = snap.data() as Armador & { attendanceToday?: { date: string; startedAt: number; familiaCode?: string } };
        setArmador({ id: snap.id, ...snap.data() } as Armador);
        const todayStr = new Date().toISOString().slice(0,10);
        if (data.attendanceToday?.date === todayStr && data.attendanceToday?.startedAt) {
          setHasMarkedAttendance(true);
          setGeneralStartTime(data.attendanceToday.startedAt);
        }
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

  // Subscribe to equipo (armadores de la misma empresa) para vista "Mi equipo"
  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = subscribeArmadores(user.companyId, setArmadores);
    return () => unsub();
  }, [user?.companyId]);

  // Subscribe to company for real-time jornada state + logo
  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = onSnapshot(doc(db, "companies", user.companyId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as any;
      setJornadaActiva(data.jornadaActiva || false);
      setJornadaPaused(!!data.jornadaPausedAt);
      if (data.name) setCompanyName(data.name);
      if (data.logoUrl !== undefined) setCompanyLogoUrl(data.logoUrl || null);
    }, (error) => console.error("company onSnapshot error:", error));
    return () => unsub();
  }, [user?.companyId]);

  // Derive active membrete from armador's own membretes
  // Multiple fallbacks: armador.id, user.uid, or user.armadorId
  useEffect(() => {
    if (!armador?.id && !user?.uid) { setActiveMembrete(null); return; }
    const myId = armador?.id || user?.armadorId || user?.uid || "";
    const myMembrete = membretes.find((m) =>
      m.status === "active" && (
        m.armadorId === myId ||
        m.armadorId === user?.uid ||
        m.armadorId === user?.armadorId
      )
    );
    setActiveMembrete(myMembrete || null);
  }, [membretes, armador?.id, user?.uid, user?.armadorId]);

  async function loadData() {
    if (!user?.companyId || !user?.uid) { setLoading(false); return; }
    try {
      const [z, armadores] = await Promise.all([
        getZones(user.companyId),
        getArmadores(user.companyId),
      ]);
      setZones(z);
      // NOTE: membretes are loaded via subscribeMembretes (real-time), NOT here.
      // loadData used to call getMembretesByArmador which overwrote the subscription
      // with only THIS armador's membretes, breaking zoneStatus "done" detection.
      const currentArmador = user.armadorId
        ? armadores.find((a) => a.id === user.armadorId) || null
        : null;
      setArmador(currentArmador);
      getDoc(doc(db, "companies", user.companyId)).then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          setCompanyName(data.name || null);
          setCompanyLogoUrl(data.logoUrl || null);
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
        // Query Firestore directly for this armador's active membrete
        const activeQ = query(
          collection(db, "membretes"),
          where("armadorId", "==", user.armadorId),
          where("status", "==", "active")
        );
        const activeSnap = await getDocs(activeQ);
        const myActiveMembrete = activeSnap.docs.length > 0
          ? { id: activeSnap.docs[0].id, ...activeSnap.docs[0].data() } as Membrete
          : null;
        if (myActiveMembrete) {
          const zone = z.find((zz) => zz.code === myActiveMembrete.zonaCode) || null;
          const sessionState = await getArmadorSessionState(user.armadorId);
          stopTimerRef.current = false; // Reactivar timer al restaurar
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

  // Ref para que el timer siempre vea el flow actualizado (evita race condition)
  const flowRef = useRef(flow);
  flowRef.current = flow;

  // FLAG para detener el timer INSTANTÁNEAMENTE (sin esperar re-render)
  const stopTimerRef = useRef(false);

  // AUTO-SYNC: Si activeMembrete existe pero flow no es "active", sincronizar
  useEffect(() => {
    if (activeMembrete && flow !== "active" && flow !== "done" && flow !== "scan") {
      setFlow("active");
      if (activeMembrete.zonaCode) {
        setSelectedZoneCode(activeMembrete.zonaCode);
      }
    }
  }, [activeMembrete, flow]);

  // Al terminar marbete, vuelve directo a la lista de su familia (sin volver a escanear) — secuencial
  useEffect(() => {
    if (flow !== "done") return;
    const myFamilia = armador?.zonaAsignadaCode;
    if (!myFamilia) {
      const t = setTimeout(() => { setFlow("idle"); setClaimZone(null); setSessionId(null); setView("mapa"); }, 2000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setFlow("idle");
      setClaimZone(null);
      setSessionId(null);
      setSelectedZoneCode(myFamilia);
      setView("zona");
    }, 900);
    return () => clearTimeout(t);
  }, [flow, armador?.zonaAsignadaCode]);
  const zonaAsignadaCode = armador?.zonaAsignadaCode || null;

  // Timer — corre UNA sola vez, siempre activo. Se detiene con stopTimerRef.
  useEffect(() => {
    timerRef.current = setInterval(() => {
      // DETENCIÓN INSTANTÁNEA — sin esperar re-render
      if (stopTimerRef.current) {
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const lunchNow = isLunchTime(almuerzoInicio, almuerzoDuracionMin);
      setOnLunch(lunchNow);
      if (lunchNow || isPaused) {
        zoneStartRef.current += 1000;
        return;
      }
      if (flowRef.current === "active") {
        setElapsedSeconds(Math.floor((Date.now() - zoneStartRef.current - pauseAccumRef.current) / 1000));
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [almuerzoInicio, almuerzoDuracionMin, isPaused]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  /** Estado del punto de vista de ESTE armador para una zona (no el de la
   *  zona en general, que puede tener otros armadores trabajando también). */
  const zoneStatus = (code: string): "active" | "mine" | "queue" | "idle" | "done" => {
    if (activeMembrete && activeMembrete.zonaCode === code) return "active";
    if (flow === "active" && activeZone?.code === code) return "active";

    const zone = zones.find((z) => z.code === code);
    if (!zone) return "idle";

    const zoneMembretes = membretes.filter((m) => m.zonaId === zone.id && !m.archived);

    // Todos los membretes de la zona terminados
    if (zoneMembretes.length > 0 && zoneMembretes.every((m) => m.status === "completed" || m.status === "cancelled")) return "done";

    // ESTE armador ya terminó todo en esta zona (no tiene ni activos ni pendientes propios)
    if (armador?.id) {
      const myHere = zoneMembretes.filter((m) => m.armadorId === armador.id);
      const myRemaining = myHere.filter((m) => m.status === "active" || m.status === "pending");
      if (myHere.length > 0 && myRemaining.length === 0) return "done";
    }

    if (zoneMembretes.some((m) => !m.armadorId && m.status === "pending")) return "queue";
    if (zonaAsignadaCode === code) return "mine";
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

  /** Reclamar el siguiente membrete directamente SIN escanear QR.
   *  Se usa cuando el armador ya está trabajando en la zona y quiere
   *  tomar el siguiente membrete de la cola sin volver a escanear. */
  async function handleClaimNext(zone: Zone) {
    if (!armador?.id || activeMembrete || !user?.uid || !user?.companyId) return;
    if (zoneStatus(zone.code) === "done") return;
    if (!jornadaActiva || jornadaPaused) return;
    try {
      const result = await claimNextMembreteInZone(
        { id: zone.id || "", code: zone.code },
        user.companyId,
        { id: armador.id, name: armador.name },
        { uid: user.uid, name: user.name }
      );
      if (!result.membrete) {
        setScanError("No hay más membretes disponibles en esta zona.");
        return;
      }
      const newSessionId = await createScanSession(
        { armadorId: user.uid, zoneCode: zone.code, startTime: Date.now() },
        { companyId: user.companyId }
      );
      setSessionId(newSessionId);
      stopTimerRef.current = false; // Reactivar timer
      zoneStartRef.current = Date.now();
      setElapsedSeconds(0);
      setFlow("active");
      setSelectedZoneCode(zone.code);
      setView("zona");
    } catch (e) {
      console.error("Error claiming next membrete:", e);
      setScanError("No se pudo tomar el membrete. Verifica tu conexión e intenta de nuevo.");
    }
  }

  /** Toma un marbete ESPECÍFICO elegido por el armador (selección de secuencia) */
  async function handleClaimSpecific(membreteId: string, zone: Zone) {
    if (!armador?.id || activeMembrete || !user?.uid || !user?.companyId) return;
    if (!jornadaActiva || jornadaPaused) return;
    const myFamilia = armador?.zonaAsignadaCode;
    if (myFamilia && zone.code !== myFamilia) {
      setScanError(`Esta no es tu familia asignada. Debes ir a Familia ${myFamilia}.`);
      return;
    }
    if (myFamilia && !hasMarkedAttendance) {
      setScanError(`Debes escanear el QR de tu familia ${myFamilia} para marcar asistencia primero.`);
      const z = zones.find((zz) => zz.code === myFamilia);
      if (z) { setClaimZone(z); setFlow("scan"); }
      return;
    }
    try {
      const result = await claimMembrete(
        membreteId,
        { id: zone.id || "", code: zone.code },
        user.companyId,
        { id: armador.id, name: armador.name },
        { uid: user.uid, name: user.name }
      );
      if (!result.membrete) {
        setScanError(result.reason === "ya_tomado" ? "Ese marbete ya lo tomó otro compañero. Elige otro." : "No se pudo tomar ese marbete.");
        return;
      }
      const newSessionId = await createScanSession(
        { armadorId: user.uid, zoneCode: zone.code, startTime: Date.now() },
        { companyId: user.companyId }
      );
      setSessionId(newSessionId);
      stopTimerRef.current = false;
      zoneStartRef.current = Date.now();
      setElapsedSeconds(0);
      setFlow("active");
      setSelectedZoneCode(zone.code);
      setView("zona");
      setExpandedMembreteId(null);
    } catch (e) {
      console.error("Error claiming specific marbete:", e);
      setScanError("No se pudo tomar el marbete. Intenta de nuevo.");
    }
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
    const myFamilia = armador?.zonaAsignadaCode;
    if (myFamilia && expected.code !== myFamilia) {
      setScanError(`Esta no es tu familia asignada. Debes ir a Familia ${myFamilia} — escanea el QR de ${myFamilia}.`);
      return;
    }
    // Marcar asistencia una sola vez por jornada (oculto a armador, para admin)
    if (!hasMarkedAttendance) {
      const now = Date.now();
      setHasMarkedAttendance(true);
      setGeneralStartTime(now);
      // Persistir para admin (no molesta al armador)
      try {
        const todayStr = new Date().toISOString().slice(0,10);
        await updateArmador(armador.id, { attendanceToday: { date: todayStr, startedAt: now, familiaCode: expected.code } } as any);
      } catch {}
    }
    // Mostrar todos los marbetes de su familia sin volver a escanear
    setSelectedZoneCode(expected.code);
    setView("zona");
    setFlow("idle");
    setClaimZone(null);
    setExpandedMembreteId(null);
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

  /** Termina el membrete activo. Funciona SIEMPRE que haya un activeMembrete. */
  async function handleFinishActive() {
    console.log("[Armador] handleFinishActive called", { activeMembrete: activeMembrete?.id, user: user?.uid, flow: flowRef.current });
    if (!activeMembrete?.id || !user) {
      console.warn("[Armador] handleFinishActive ABORTED — missing activeMembrete or user");
      return;
    }

    // ── 1. CAPTURAR TIEMPO ──
    const finalElapsed = elapsedSeconds;
    const finalPauseMs = isPaused && pausedAt
      ? zonePauseMs + (Date.now() - pausedAt)
      : zonePauseMs;
    const finalPauseCount = isPaused ? pauseCount + 1 : pauseCount;
    const finishedMembreteId = activeMembrete.id;
    const zoneCode = activeMembrete.zonaCode || claimZone?.code || "";
    const zoneId = claimZone?.id || zones.find((z) => z.code === zoneCode)?.id || "";

    // ── 2. DETENER TIMER INSTANTÁNEAMENTE (ref, no state) ──
    stopTimerRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setLastZoneDuration(finalElapsed);
    setIsPaused(false);
    setPausedAt(null);
    setZonePauseMs(0);
    setPauseCount(0);
    pauseAccumRef.current = 0;
    setElapsedSeconds(0);
    setFlow("done");

    // ── 3. TRABAJO ASYNC ──
    const errors: string[] = [];
    if (sessionId) {
      try {
        await updateScanSession(
          sessionId,
          { endTime: Date.now(), duration: finalElapsed, pauseMs: finalPauseMs, pauseCount: finalPauseCount },
          user.companyId ? { companyId: user.companyId, zoneCode, armadorId: user.uid } : undefined
        );
        if (zoneId && user.companyId) {
          await updateZoneAvgMinutes(zoneId, finalElapsed);
          if (user.armadorId) {
            await recalcArmadorProdH(user.armadorId, user.companyId);
          }
        }
      } catch (e) {
        console.error("Error saving claim session:", e);
        errors.push("sesión");
      }
    }
    if (user.companyId) {
      try {
        console.log("[Armador] Calling completeMembrete for", finishedMembreteId);
        await completeMembrete(finishedMembreteId, finalElapsed * 1000, user.companyId, { uid: user.uid, name: user.name });
        console.log("[Armador] completeMembrete SUCCESS");
      } catch (e) {
        console.error("[Armador] completeMembrete FAILED:", e);
        errors.push("membrete");
      }
    }

    setSessionId(null);
    if (user.armadorId) {
      await persistSession(user.armadorId, null);
    }

    if (errors.length > 0) {
      console.warn(`[Armador] Terminado con errores en: ${errors.join(", ")}`);
    }
  }

  function handleSelectZone(code: string) {
    const myFamilia = armador?.zonaAsignadaCode;
    if (myFamilia && code !== myFamilia) {
      setScanError(`Esta no es tu familia asignada. Debes ir a Familia ${myFamilia}.`);
      // igual muestra la familia correcta en vez de la que tocó
      setSelectedZoneCode(myFamilia);
      setView("zona");
      return;
    }
    if (myFamilia && !hasMarkedAttendance) {
      setScanError(`Debes escanear el QR de tu familia ${myFamilia} para marcar asistencia primero. Luego verás todos los marbetes sin volver a escanear.`);
      // Si aún no marcó asistencia, lo mandamos a escanear
      const z = zones.find((zz) => zz.code === myFamilia);
      if (z) { setClaimZone(z); setFlow("scan"); }
      return;
    }
    setScanError(null);
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

  // Gamificación real — nivel, XP, ranking, productos hoy por familia
  const myFamilia = armador?.zonaAsignadaCode || null;
  const myProductosHoy = (() => {
    const myId = armador?.id || user?.armadorId || "";
    if (!myId) return 0;
    const todayStr = new Date().toDateString();
    const doneHoy = membretes.filter((m) => m.armadorId===myId && m.status==="completed" && m.finishedAt && new Date(m.finishedAt).toDateString()===todayStr).reduce((s,m)=> s + (m.products?.filter(p=>p.status==="completed").length||0),0);
    return doneHoy + (flow==="active" && activeMembrete ? completedProducts : 0);
  })();
  const myMarbetesHoy = (() => {
    const myId = armador?.id || user?.armadorId || "";
    if (!myId) return 0;
    const todayStr = new Date().toDateString();
    const doneHoy = membretes.filter((m) => m.armadorId===myId && m.status==="completed" && m.finishedAt && new Date(m.finishedAt).toDateString()===todayStr).length;
    return doneHoy + (flow==="active" && activeMembrete ? 1 : 0);
  })();
  const myLevel = Math.floor((armador?.prodH||0)/80)+1; // cada 80 p/h subes nivel
  const xpInLevel = (armador?.prodH||0) % 80;
  const xpNeeded = 80;
  const myRankInfo = (() => {
    if (!myFamilia) return null;
    const equipo = armadores.filter((a: Armador)=> a.zonaAsignadaCode===myFamilia);
    if (equipo.length===0) return null;
    const sorted = [...equipo].sort((a,b)=>(b.prodH||0)-(a.prodH||0));
    const idx = sorted.findIndex(a=> a.id===armador?.id);
    return idx>=0 ? { rank: idx+1, total: equipo.length, sorted } : null;
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
          {companyLogoUrl ? (
            <img src={companyLogoUrl} alt={companyName || "Empresa"} style={{ width:52, height:36, borderRadius:10, objectFit:"contain", background:"#fff", border:"1px solid var(--line)", padding:"4px 6px", boxShadow:"var(--shadow)", flex:"none" }} />
          ) : null}
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
            role={user?.role === "super_admin" ? "Super Administrador" : user?.role === "admin" ? "Administrador" : "Armador"}
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
              <h2>Mapa de familias</h2>
              <span className="arm-zone-count">{zonaAsignadaCode ? `Tu familia: ${zonaAsignadaCode}` : "Sin familia asignada"}</span>
            </div>

            <div className="arm-map-grid">
              {zones.length === 0 ? (
                <div className="arm-empty-map">
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin familias registradas</div>
                  <div style={{ fontSize: 12, color: "var(--faint)" }}>Tu administrador todavía no ha configurado familias</div>
                </div>
              ) : (
                <>
                  {!zonaAsignadaCode && (
                      <div style={{ padding: "10px 14px", marginBottom: 10, background: "var(--panel2)", borderRadius: 8, fontSize: 12, color: "var(--faint)" }}>
                        Tu supervisor todavía no te ha asignado una familia — toca cualquier familia con cola para tomar marbetes por tu cuenta.
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

            {/* Active Zone Card — also shows when activeMembrete exists (sync fix) */}
            {(flow === "active" || activeMembrete) && activeZone && (
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
                        <I.qr /> Escanear tu familia ({zonaAsignadaCode})
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
                {zoneStatus(selectedZone.code) === "mine" && "○ Tu familia asignada"}
                {zoneStatus(selectedZone.code) === "queue" && "● Con marbetes en cola"}
                {zoneStatus(selectedZone.code) === "done" && "✓ Familia completada"}
                {zoneStatus(selectedZone.code) && zoneStatus(selectedZone.code) !== "active" && zoneStatus(selectedZone.code) !== "mine" && zoneStatus(selectedZone.code) !== "queue" && zoneStatus(selectedZone.code) !== "done" && "— Sin cola"}
              </div>
              <h2 className="mono">{selectedZone.code}</h2>
            </div>

            {(() => {
              // Mostrar panel activo si hay membrete activo en esta zona (independiente de flow)
              const isActiveHere = activeMembrete && activeMembrete.zonaCode === selectedZone.code;
              if (!isActiveHere) return null;

              return (
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
                    onClick={() => {
                      if (!allProductsChecked) {
                        const remaining = totalProducts - completedProducts;
                        if (!window.confirm(`Faltan ${remaining} producto${remaining === 1 ? "" : "s"} por checar. ¿Terminar el membrete de todas formas?`)) return;
                      }
                      handleFinishActive();
                    }}
                    title={!allProductsChecked ? "Debes checar todos los productos primero" : ""}
                  >
                    <I.qr /> {!allProductsChecked ? `Terminar (${completedProducts}/${totalProducts} checados)` : "Terminé este membrete"}
                  </button>
                </div>
              </div>
              );
            })()}

            {/* ── Membretes de esta zona (post-escaneo) ── */}
            {(() => {
              if (!selectedZone) return null;
              // Ocultar lista si hay membrete activo en esta zona (el panel activo ya se muestra)
              const isActiveHere = activeMembrete && activeMembrete.zonaCode === selectedZone.code;
              if (isActiveHere) return null;

              const allZoneMembretes = membretes
                .filter((m) => m.zonaId === selectedZone.id && !m.archived)
                .sort((a, b) => a.code.localeCompare(b.code));

              // Zona completada: todos los membretes terminados
              const isZoneDone = allZoneMembretes.length > 0 && allZoneMembretes.every((m) => m.status === "completed" || m.status === "cancelled");

              if (isZoneDone) {
                return (
                  <div className="panel" style={{ padding: 20, marginBottom: 16, textAlign: "center", borderColor: "var(--s-done)" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>&#10003;</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--s-done)", marginBottom: 4 }}>Familia completada</div>
                    <div style={{ fontSize: 12.5, color: "var(--mut)" }}>Todos los marbetes de esta familia han sido terminados.</div>
                    <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>El administrador debe volver a cargar marbetes para reactivar esta familia.</div>
                  </div>
                );
              }

              const completedMembretes = allZoneMembretes.filter((m) => m.status === "completed");
              const activeMembretes = allZoneMembretes.filter((m) => m.status === "active");
              const pendingMembretes = allZoneMembretes.filter((m) => m.status === "pending");

              const hasActiveMembrete = !!activeMembrete;

              return (
                <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, fontSize:14 }}>Marbetes — {selectedZone.code}</div>
                    <span style={{ fontSize:11, padding:"3px 8px", borderRadius:999, background:"var(--accent-soft)", color:"var(--accent)", fontWeight:700 }}>{allZoneMembretes.length} marbetes</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 4 }}>
                    Escaneaste la familia. Solo el <b style={{color:"var(--tx)"}}>siguiente marbete (#1)</b> está desbloqueado — tómalo y el siguiente se desbloquea para que otro compañero lo tome. Al terminar tu marbete (todos los productos y cantidades), vuelve a esta lista y toma el siguiente disponible — secuencial.
                  </div>
                  <div style={{ display:"flex", gap:6, marginBottom: 12, fontSize:11, color:"var(--faint)" }}>
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:2,background:"var(--s-done)"}}/> {completedMembretes.length} completados</span>
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:2,background:"var(--s-active)"}}/> {activeMembretes.length} en proceso</span>
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:2,background:"var(--accent)"}}/> {pendingMembretes.length} en cola</span>
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

                      {(() => {
                        const sortedPendings = [...pendingMembretes].sort((a,b)=> a.code.localeCompare(b.code) || (a.createdAt||0)-(b.createdAt||0));
                        const nextId = sortedPendings[0]?.id;
                        return sortedPendings.map((m, idx) => {
                        const expanded = expandedMembreteId === m.id;
                        const isNext = m.id === nextId;
                        const queueNum = idx+1;
                        const isBlocked = !isNext || !!hasActiveMembrete || !jornadaActiva || jornadaPaused;
                        const borderColor = isBlocked ? "var(--line)" : "var(--accent)";
                        const bg = isBlocked ? "var(--panel2)" : "var(--panel)";
                        return (
                          <div key={m.id} style={{ border: `1.5px solid ${borderColor}`, borderRadius: 12, overflow:"hidden", background:bg, boxShadow: isNext && !isBlocked ? "0 1px 8px rgba(13,148,136,0.12)" : "none", opacity: isBlocked && !isNext ? 0.75 : 1 }}>
                            <div style={{ padding:"12px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, cursor:"pointer" }} onClick={()=> setExpandedMembreteId(expanded ? null : (m.id||null))}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                <span style={{ minWidth:22, height:22, borderRadius:6, display:"grid", placeItems:"center", background: isNext && !isBlocked ? "var(--accent)" : "var(--line)", color: isNext && !isBlocked ? "#fff" : "var(--faint)", fontSize:11, fontWeight:800 }}>#{queueNum}</span>
                                <span style={{ fontWeight:800, fontFamily:"var(--mono)", fontSize:14, color: isBlocked && !isNext ? "var(--faint)" : "var(--ink)" }}>{m.code}</span>
                                <span style={{ fontSize:11, padding:"2px 8px", borderRadius:999, background: isNext && !isBlocked ? "var(--accent-soft)" : "var(--inset)", color: isNext && !isBlocked ? "var(--accent)" : "var(--faint)", fontWeight:700, border:`1px solid ${isNext && !isBlocked ? "var(--accent)" : "var(--line)"}` }}>{isNext && !hasActiveMembrete ? "Siguiente" : isNext && hasActiveMembrete ? "Siguiente — bloqueado" : `Bloqueado #${queueNum}`}</span>
                                {m.familia && <span style={{ fontSize:11, color:"var(--mut)", background:"var(--panel2)", padding:"2px 6px", borderRadius:6, border:"1px solid var(--line)" }}>{m.familia}</span>}
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flex:"none" }}>
                                <span style={{ fontSize:11, color:"var(--faint)" }}>{m.totalUnits} uds · {m.totalProducts} prods</span>
                                <span style={{ fontSize:12, color:"var(--faint)" }}>{expanded ? "▲" : "▼"}</span>
                              </div>
                            </div>
                            <div style={{ padding:"0 14px 10px", display:"flex", gap:8, flexWrap:"wrap", fontSize:11, color:"var(--mut)" }}>
                              {m.pallet && <span style={{ background:"var(--panel2)", padding:"3px 8px", borderRadius:6, border:"1px solid var(--line)" }}>Pallet {m.pallet}/{m.palletTotal}</span>}
                              {m.ruta && <span style={{ background:"var(--panel2)", padding:"3px 8px", borderRadius:6, border:"1px solid var(--line)", fontFamily:"var(--mono)" }}>{m.ruta}</span>}
                              {m.camion && <span style={{ background:"var(--panel2)", padding:"3px 8px", borderRadius:6, border:"1px solid var(--line)" }}>Camión {m.camion}</span>}
                              {m.fechaEntrega && <span style={{ background:"var(--panel2)", padding:"3px 8px", borderRadius:6, border:"1px solid var(--line)" }}>{m.fechaEntrega}</span>}
                            </div>
                            {expanded && (
                              <div style={{ margin:"0 12px 12px", border:"1px solid var(--line)", borderRadius:8, overflow:"hidden" }}>
                                <div style={{ maxHeight:180, overflowY:"auto" }}>
                                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                                    <thead style={{ background:"var(--panel2)", position:"sticky", top:0 }}>
                                      <tr style={{ textAlign:"left", color:"var(--faint)", fontSize:11 }}>
                                        <th style={{ padding:"7px 10px", fontWeight:600 }}>Código</th>
                                        <th style={{ padding:"7px 10px", fontWeight:600 }}>Descripción</th>
                                        <th style={{ padding:"7px 10px", fontWeight:600, textAlign:"right" }}>Cant.</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {m.products.map((p, idx)=>(
                                        <tr key={idx} style={{ borderTop:"1px solid var(--line)" }}>
                                          <td style={{ padding:"7px 10px", fontFamily:"var(--mono)", fontSize:11, fontWeight:600 }}>{p.codigo}</td>
                                          <td style={{ padding:"7px 10px" }}>{p.descripcion}</td>
                                          <td style={{ padding:"7px 10px", textAlign:"right", fontWeight:700 }}>{p.cantidad}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                            <div style={{ padding:"0 12px 12px", display:"flex", gap:8 }}>
                              <button
                                onClick={(e)=>{ e.stopPropagation(); if(isNext && !hasActiveMembrete) handleClaimSpecific(m.id||"", selectedZone); }}
                                disabled={!isNext || !!hasActiveMembrete || !jornadaActiva || jornadaPaused}
                                style={{
                                  flex:1, padding:"10px 14px", borderRadius:8, border:0,
                                  background: !isNext || hasActiveMembrete || !jornadaActiva || jornadaPaused ? "var(--line)" : "var(--accent)",
                                  color: !isNext || hasActiveMembrete || !jornadaActiva || jornadaPaused ? "var(--faint)" : "#fff",
                                  fontWeight:700, fontSize:13, cursor: !isNext || hasActiveMembrete || !jornadaActiva || jornadaPaused ? "not-allowed" : "pointer",
                                  opacity: !isNext ? 0.6 : hasActiveMembrete ? 0.6 : 1
                                }}
                              >
                                {!isNext ? `Bloqueado — espera #${queueNum-1} (ya lo tomará otro compañero)` : hasActiveMembrete ? "Termina tu tarea actual primero" : !jornadaActiva ? "Jornada no iniciada" : jornadaPaused ? "Jornada pausada" : `Tomar ${m.code} → Siguiente`}
                              </button>
                              {!expanded && (
                                <button
                                  onClick={()=> setExpandedMembreteId(m.id||null)}
                                  style={{ padding:"10px 12px", borderRadius:8, border:"1px solid var(--line)", background:"var(--panel)", color:"var(--mut)", fontSize:12, cursor:"pointer" }}
                                >
                                  Ver productos
                                </button>
                              )}
                            </div>
                            {!isNext && (
                              <div style={{ padding:"0 12px 12px", fontSize:11, color:"var(--faint)", textAlign:"center" }}>
                                Se desbloquea cuando el compañero tome {sortedPendings[idx-1]?.code || "el anterior"} — secuencial por familia.
                              </div>
                            )}
                          </div>
                        );
                      });})()}

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

            {/* ── Hero Gamificado — Nivel, XP, Familia, Ranking real ── */}
            <div style={{ position:"relative", overflow:"hidden", borderRadius:16, padding:16, background:`radial-gradient(600px 300px at 20% 0%, ${armador?.color||"var(--accent)"}18, transparent 60%), linear-gradient(135deg, var(--panel), var(--inset))`, border:"1px solid var(--line)", boxShadow:"0 8px 24px -12px rgba(0,0,0,0.12)" }}>
              <div style={{ position:"absolute", width:220, height:220, borderRadius:"50%", background:`radial-gradient(circle, ${armador?.color||"var(--accent)"}14, transparent 70%)`, top:-40, right:-20, pointerEvents:"none" }}/>
              <div style={{ position:"relative", display:"flex", gap:14, alignItems:"center" }}>
                <div style={{ position:"relative", flex:"none" }}>
                  <div style={{ width:64, height:64, borderRadius:16, display:"grid", placeItems:"center", background: armador?.color||"var(--accent)", color:"#fff", fontWeight:900, fontSize:22, boxShadow:`0 8px 20px -8px ${armador?.color||"var(--accent)"}88`, border:"3px solid var(--panel)" }}>{initial}</div>
                  <div style={{ position:"absolute", bottom:-6, right:-6, minWidth:26, height:22, borderRadius:999, background:"linear-gradient(135deg, #f59e0b, #fbbf24)", color:"#fff", display:"grid", placeItems:"center", fontWeight:900, fontSize:11, padding:"0 6px", border:"2px solid var(--panel)", boxShadow:"0 2px 8px rgba(245,158,11,0.4)" }}>Nv.{myLevel}</div>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:900, fontSize:15, lineHeight:1.2, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>{displayName}
                    {myFamilia ? <span style={{ fontSize:11, padding:"3px 8px", borderRadius:999, background:"var(--accent-soft)", color:"var(--accent)", border:"1px solid var(--accent)", fontWeight:800 }}>Familia {myFamilia}</span> : <span style={{ fontSize:11, padding:"3px 8px", borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", color:"var(--faint)" }}>Sin familia</span>}
                    {myRankInfo && <span style={{ fontSize:11, padding:"3px 8px", borderRadius:999, background: myRankInfo.rank===1? "#f59e0b18":"var(--panel)", color: myRankInfo.rank===1? "#b45309":"var(--faint)", border:`1px solid ${myRankInfo.rank===1? "#f59e0b22":"var(--line)"}`, fontWeight:800 }}>#{myRankInfo.rank} de {myRankInfo.total} {myRankInfo.rank===1? "· LÍDER":""}</span>}
                  </div>
                  <div style={{ fontSize:11, color:"var(--faint)", marginTop:2 }}>{myProductosHoy} productos hoy · {myMarbetesHoy} marbetes · {armador?.cumpl||0}% cumpl. · {armador?.prodH||0} p/h</div>
                  <div style={{ marginTop:8, height:8, borderRadius:999, background:"var(--panel)", border:"1px solid var(--line)", overflow:"hidden", position:"relative" }}>
                    <div style={{ height:"100%", width:`${(xpInLevel/xpNeeded)*100}%`, background:`linear-gradient(90deg, ${armador?.color||"var(--accent)"}, #34d399)`, borderRadius:999, transition:"width .6s", boxShadow:`0 0 8px ${armador?.color||"var(--accent)"}55` }}/>
                    <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)", backgroundSize:"200% 100%", animation:"shimmer 2s linear infinite", opacity:0.6 }}/>
                  </div>
                  <div style={{ fontSize:10, color:"var(--faint)", marginTop:4, display:"flex", justifyContent:"space-between" }}><span>XP {xpInLevel}/{xpNeeded} para Nv.{myLevel+1}</span><span>{armador?.prodH||0} p/h</span></div>
                </div>
                <div style={{ textAlign:"center", flex:"none", minWidth:70 }}>
                  <div style={{ fontSize:28, fontWeight:900, lineHeight:1 }} className="mono">{yoStats.prodH>0? yoStats.prodH : "—"}</div>
                  <div style={{ fontSize:10, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"var(--faint)" }}>prod/h</div>
                  <div style={{ marginTop:6, fontSize:11, padding:"4px 8px", borderRadius:999, background: yoStats.prodH>=400? "#10b98118": yoStats.prodH>=200? "#f59e0b18":"var(--inset)", color: yoStats.prodH>=400? "#065f46": yoStats.prodH>=200? "#92400e":"var(--faint)", border:`1px solid ${yoStats.prodH>=400? "#10b98122": yoStats.prodH>=200? "#f59e0b22":"var(--line)"}`, fontWeight:800 }}>{yoStats.prodH>=400? "★ ÉPICO": yoStats.prodH>=200? "▲ BUEN RITMO":"○ INICIA"}</div>
                </div>
              </div>
              <div style={{ position:"relative", marginTop:12, padding:"8px 12px", borderRadius:10, background: flow==="active"&&elapsedSeconds>0? "color-mix(in srgb, var(--accent) 10%, transparent)" : "var(--inset)", border:`1px solid ${flow==="active"&&elapsedSeconds>0? "var(--accent)":"var(--line)"}`, display:"flex", alignItems:"center", gap:8, fontSize:12, fontWeight:700 }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background: flow==="active"&&elapsedSeconds>0? "var(--s-active)":"var(--faint)", boxShadow: flow==="active"&&elapsedSeconds>0? "0 0 0 4px rgba(245,158,11,0.18)":undefined, animation: flow==="active"&&elapsedSeconds>0? "pulse 1.5s infinite":undefined }}/>
                {flow === "active" && elapsedSeconds > 0 ? `▶ En familia ${activeZone?.code} — ${fmt(elapsedSeconds)} · ${completedProducts}/${totalProducts} productos` : yoStats.prodH >= 400 ? "¡Vas líder! Mantén el ritmo 🔥" : myRankInfo && myRankInfo.rank>3 ? `Estás #${myRankInfo.rank} — ¡alcanza al líder!` : "Toma tu siguiente marbete para sumar XP"}
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

            {/* ── Hoy — Misiones del día (datos reales) ── */}
            <div className="arm-yo-section">
              <h3 style={{ display:"flex", alignItems:"center", gap:8 }}>Hoy — tu jornada <span style={{ fontSize:10, padding:"2px 7px", borderRadius:999, background:"var(--accent-soft)", color:"var(--accent)", border:"1px solid var(--accent)" }}>{myFamilia? `Familia ${myFamilia}`:"Sin familia"}</span></h3>
              <div className="arm-yo-today-grid" style={{ gridTemplateColumns:"repeat(4, 1fr)" }}>
                <div className="arm-yo-today-card" style={{ position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, var(--accent)08, transparent)", pointerEvents:"none" }}/>
                  <div className="arm-yo-today-icon" style={{ background:"var(--accent)", color:"#fff", boxShadow:"0 4px 12px -4px var(--accent)" }}><span style={{ fontWeight:900, fontSize:14 }}>📦</span></div>
                  <div className="arm-yo-today-value mono" style={{ position:"relative" }}>{myMarbetesHoy}</div>
                  <div className="arm-yo-today-label">Marbetes hoy</div>
                  <div style={{ position:"relative", marginTop:6, height:4, borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", overflow:"hidden" }}><div style={{ height:"100%", width:`${Math.min(100, (myMarbetesHoy/8)*100)}%`, background:"var(--accent)", borderRadius:999 }}/></div>
                  <div style={{ position:"relative", fontSize:10, color:"var(--faint)", marginTop:4 }}>Meta 8/día</div>
                </div>
                <div className="arm-yo-today-card" style={{ position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, #10b98108, transparent)", pointerEvents:"none" }}/>
                  <div className="arm-yo-today-icon" style={{ background:"#10b981", color:"#fff", boxShadow:"0 4px 12px -4px #10b981" }}><span style={{ fontWeight:900, fontSize:14 }}>✓</span></div>
                  <div className="arm-yo-today-value mono" style={{ position:"relative" }}>{myProductosHoy}</div>
                  <div className="arm-yo-today-label">Productos hoy</div>
                  <div style={{ position:"relative", marginTop:6, fontSize:10, color:"var(--faint)" }}>{myProductosHoy>0? "¡Sigue así!":"Toma un marbete"}</div>
                </div>
                <div className="arm-yo-today-card" style={{ position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, #f59e0b08, transparent)", pointerEvents:"none" }}/>
                  <div className="arm-yo-today-icon" style={{ background:"#f59e0b", color:"#fff", boxShadow:"0 4px 12px -4px #f59e0b" }}><I.clock /></div>
                  <div className="arm-yo-today-value mono" style={{ position:"relative" }}>{fmt(yoStats.todayTime)}</div>
                  <div className="arm-yo-today-label">Tiempo activo</div>
                  <div style={{ position:"relative", fontSize:10, color:"var(--faint)", marginTop:4 }}>{yoStats.avgTime? `${yoStats.avgTime} min/prom`:"—"}</div>
                </div>
                <div className="arm-yo-today-card" style={{ position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, #6366f108, transparent)", pointerEvents:"none" }}/>
                  <div className="arm-yo-today-icon" style={{ background: yoStats.todayInc>0? "#ef4444":"#6366f1", color:"#fff", boxShadow:`0 4px 12px -4px ${yoStats.todayInc>0? "#ef4444":"#6366f1"}` }}><I.alert /></div>
                  <div className="arm-yo-today-value mono" style={{ position:"relative", color: yoStats.todayInc>0? "#ef4444":undefined }}>{yoStats.todayInc}</div>
                  <div className="arm-yo-today-label">Incidencias</div>
                  <div style={{ position:"relative", fontSize:10, color: yoStats.todayInc>0? "#ef4444":"#10b981", marginTop:4, fontWeight:700 }}>{yoStats.todayInc>0? "Revisa":"¡Limpio!"}</div>
                </div>
              </div>
              <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
                <span style={{ fontSize:11, padding:"4px 8px", borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", color:"var(--muted)" }}>Familia: <b style={{color:"var(--ink)"}}>{myFamilia||"—"}</b></span>
                <span style={{ fontSize:11, padding:"4px 8px", borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", color:"var(--muted)" }}>Ranking: <b style={{color: myRankInfo?.rank===1? "#b45309":"var(--ink)"}}>{myRankInfo? `#${myRankInfo.rank} de ${myRankInfo.total}`:"—"}</b></span>
                <span style={{ fontSize:11, padding:"4px 8px", borderRadius:999, background:"var(--inset)", border:"1px solid var(--line)", color:"var(--muted)" }}>Nivel <b style={{color:"var(--ink)"}}>{myLevel}</b> · XP {xpInLevel}/{xpNeeded}</span>
              </div>
            </div>

            {/* ── Mi Equipo — Familia ── */}
            <div className="arm-yo-section">
              <h3>Mi equipo — {armador?.zonaAsignadaCode ? `Familia ${armador.zonaAsignadaCode}` : "Sin familia"}</h3>
              {(() => {
                const myFamilia = armador?.zonaAsignadaCode;
                if (!myFamilia) {
                  return <div style={{ padding:14, textAlign:"center", color:"var(--faint)", fontSize:12, background:"var(--panel2)", border:"1px solid var(--line)", borderRadius:10 }}>Aún no tienes familia asignada. Tu supervisor te asignará una familia y aquí verás a tu equipo en simultáneo.</div>;
                }
                const equipo = armadores.filter((a: Armador)=> a.zonaAsignadaCode===myFamilia);
                if (equipo.length===0) return <div style={{ padding:14, textAlign:"center", color:"var(--faint)", fontSize:12 }}>Sin compañeros en esta familia aún</div>;
                const maxProd = Math.max(...equipo.map((a: Armador)=>a.prodH||0),1);
                const sorted = [...equipo].sort((a: Armador,b: Armador)=>(b.prodH||0)-(a.prodH||0));
                const myId = armador?.id;
                return (
                  <div style={{ display:"grid", gap:8 }}>
                    <div style={{ fontSize:11, color:"var(--faint)", marginBottom:2 }}>Simultáneo — quién va mejor en tu familia. Se actualiza en vivo.</div>
                    {sorted.length>=3 && (
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, alignItems:"end", marginBottom:8 }}>
                        {[1,0,2].map((sortedIdx)=>{
                          const a = sorted[sortedIdx];
                          if(!a) return <div key={sortedIdx}/>;
                          const isMe = a.id===myId;
                          const heights = [70,90,60];
                          const h = sortedIdx===0?90: sortedIdx===1?70:60;
                          const medal = sortedIdx===0? "🥇" : sortedIdx===1? "🥈" : "🥉";
                          const bg = sortedIdx===0? "linear-gradient(180deg, #fef3c7, #fde68a)" : sortedIdx===1? "linear-gradient(180deg, #f1f5f9, #e2e8f0)" : "linear-gradient(180deg, #ffedd5, #fed7aa)";
                          return (
                            <div key={a.id} style={{ textAlign:"center" }}>
                              <div style={{ fontSize:20, marginBottom:4 }}>{medal}</div>
                              <div style={{ width:36, height:36, borderRadius:10, display:"grid", placeItems:"center", background:(a as Armador).color||"var(--accent)", color:"#fff", fontWeight:900, margin:"0 auto", border: isMe? "2px solid var(--accent)": "2px solid var(--panel)", boxShadow: isMe? "0 0 0 3px var(--accent)":"none" }}>{(a as Armador).name[0]}</div>
                              <div style={{ fontWeight:800, fontSize:11, marginTop:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{(a as Armador).name}{isMe&&" (TÚ)"}</div>
                              <div style={{ fontSize:11, fontWeight:900 }} className="mono">{(a as Armador).prodH||0} <span style={{ fontSize:9, color:"var(--faint)"}}>p/h</span></div>
                              <div style={{ height:h, borderRadius:"8px 8px 0 0", background:bg, border:"1px solid var(--line)", borderBottom:"none", marginTop:6, display:"grid", placeItems:"center", fontWeight:900, color:"#92400e", fontSize:12 }}>{sortedIdx+1}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {sorted.map((a: Armador,i)=>{
                      const isMe = a.id===myId;
                      const myMems = membretes.filter((m: Membrete)=> m.armadorId===a.id);
                      const done = myMems.filter(m=>m.status==="completed").length;
                      const active = myMems.filter(m=>m.status==="active").length;
                      const isActiveNow = active>0;
                      return (
                        <div key={a.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:12, border: isMe? "1.5px solid var(--accent)" : "1px solid var(--line)", background: isMe? "color-mix(in srgb, var(--accent) 6%, var(--panel))" : "var(--panel)", boxShadow: i===0? "0 2px 8px rgba(245,158,11,0.12)":undefined }}>
                          <div style={{ width:22, textAlign:"center", fontWeight:900, fontSize:11, color: i===0? "#f59e0b" : i===1? "#94a3b8" : i===2? "#b45309" : "var(--faint)" }}>{i+1}</div>
                          <div style={{ width:32, height:32, borderRadius:10, display:"grid", placeItems:"center", background:a.color||"var(--accent)", color:"#fff", fontWeight:900, flex:"none", position:"relative" }}>
                            {a.name[0]}
                            {isActiveNow && <span style={{ position:"absolute", top:-4, right:-4, width:10, height:10, borderRadius:"50%", background:"var(--s-active)", border:"2px solid var(--panel)", boxShadow:"0 0 0 2px rgba(245,158,11,0.3)" }}/>}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:800, fontSize:12, display:"flex", alignItems:"center", gap:6 }}>{a.name}{isMe && <span style={{ fontSize:10, padding:"1px 6px", borderRadius:999, background:"var(--accent)", color:"#fff", fontWeight:700 }}>TÚ</span>}{i===0 && <span style={{ fontSize:10, padding:"1px 6px", borderRadius:999, background:"#f59e0b18", color:"#b45309", fontWeight:700 }}>LÍDER</span>}</div>
                            <div style={{ fontSize:10, color:"var(--faint)" }}>{done} hechos · {active>0? `${active} en curso` : "sin activo"} · {a.cumpl||0}% cumpl.</div>
                            <div style={{ height:6, borderRadius:999, background:"var(--panel2)", border:"1px solid var(--line)", overflow:"hidden", marginTop:6 }}>
                              <div style={{ height:"100%", width:`${( (a.prodH||0)/maxProd)*100}%`, background: i===0? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, var(--accent), #34d399)", transition:"width .6s" }}/>
                            </div>
                          </div>
                          <div style={{ textAlign:"right", minWidth:54 }}>
                            <div style={{ fontWeight:900, fontSize:13 }} className="mono">{a.prodH||0}<span style={{ fontSize:10, color:"var(--faint)" }}> p/h</span></div>
                            <div style={{ fontSize:10, color: isActiveNow? "var(--s-active)" : "var(--faint)", fontWeight:700 }}>{isActiveNow? "● En curso" : "○ Libre"}</div>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ fontSize:11, color:"var(--faint)", background:"var(--inset)", border:"1px solid var(--line)", borderRadius:8, padding:"8px 10px", marginTop:2 }}>
                      Indicadores de armadores en simultáneo — el administrador ve este mismo ranking en <b>Indicadores → Familias</b> y <b>Desempeño</b>.
                    </div>
                  </div>
                );
              })()}
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

      {/* ─── Overlay: membrete terminado ─── */}
      {flow === "done" && (() => {
        const doneZoneCode = claimZone?.code || activeMembrete?.zonaCode || "—";
        const doneZoneId = claimZone?.id || (activeMembrete ? zones.find((z) => z.code === activeMembrete.zonaCode)?.id : null);
        return (
        <div className="arm-scan-overlay arm-done-overlay">
          <div className="arm-finish-icon">✓</div>
          <h3>Membrete completado en {doneZoneCode}</h3>
          <div className="arm-finish-time mono">{fmt(lastZoneDuration)}</div>
          <div className="arm-finish-sub">Tiempo en esa tarea</div>

          {doneZoneId ? (() => {
            const pendingHere = membretes.filter((m) => m.zonaId === doneZoneId && !m.armadorId && m.status === "pending");
            return pendingHere.length > 0 ? (
              <>
                <div className="arm-finish-sub" style={{ marginTop: 8 }}>
                  Quedan {pendingHere.length} membrete{pendingHere.length === 1 ? "" : "s"} más en esta zona.
                </div>
                <button
                  className="arm-action-btn scan"
                  style={{ marginTop: 12 }}
                  onClick={() => {
                    const myFam = armador?.zonaAsignadaCode;
                    if (myFam) { setSelectedZoneCode(myFam); setView("zona"); setFlow("idle"); setClaimZone(null); setScanError(null); }
                    else { setFlow("idle"); setView("mapa"); }
                  }}
                >
                  Ver lista de marbetes
                </button>
              </>
            ) : (
              <div className="arm-finish-sub" style={{ marginTop: 8, color: "var(--s-done)", fontWeight: 600 }}>
                ✓ Zona completada — no quedan más membretes pendientes
              </div>
            );
          })() : (
            <div className="arm-finish-sub" style={{ marginTop: 8 }}>Volviendo al mapa...</div>
          )}

          <button
            className="btn sm primary"
            style={{ marginTop: 16, minWidth: 180 }}
            onClick={() => { setFlow("idle"); setClaimZone(null); setSessionId(null); setView("mapa"); }}
          >
            Volver al mapa
          </button>
        </div>
        );
      })()}

      {/* ─── Bottom Navigation ────────────────────────────── */}
      <nav className="arm-bottomnav">
        <button className={view === "mapa" ? "on" : ""} onClick={() => {
          // Si está en "done" o "active", limpiar estado al volver al mapa
          if (flow === "done" || flow === "active") {
            setFlow("idle");
            setClaimZone(null);
            setSessionId(null);
          }
          setView("mapa");
        }}>
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
