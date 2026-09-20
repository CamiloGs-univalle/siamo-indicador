/**
 * @file lib/analytics.ts
 * @description Motor de analítica operacional: convierte la bitácora de
 * actividad (append-only, `activity`) en métricas medidas — no estimadas —
 * sobre dos preguntas concretas que pidió el negocio:
 *
 *   1. ¿Cuánto se demora un armador en escanear su PRIMERA zona después de
 *      que el administrador confirma la asignación (botón "Listo")?
 *   2. ¿Cuánto se demora en pasar de una zona terminada a la siguiente?
 *
 * No se agregó ningún campo nuevo a Firestore ni se tocó ninguna regla de
 * seguridad para lograr esto: `assignZone`/`activarCiclo`/`createScanSession`/
 * `updateScanSession` YA registran "zone_assigned", "cycle_started",
 * "scan_started" y "scan_finished" en la bitácora con su `createdAt` real.
 * Este módulo simplemente los ordena por armador y calcula las diferencias.
 *
 * ── La trampa de los dos espacios de id (importante) ──────────────────────
 * La bitácora mezcla dos "espacios de identidad" en el mismo campo
 * `armadorId` según el tipo de evento:
 *   - "cycle_started" / "zone_assigned" / "zone_unassigned" / "cycle_completed"
 *     → `armadorId` es el id del ROSTER (`Armador.id`, el doc de `armadores`).
 *   - "scan_started" / "scan_finished"
 *     → `armadorId` es el UID de Firebase Auth (`ScanSession.armadorId`,
 *     tal como lo valida `firestore.rules` en la colección `sessions`).
 * Comparar estos dos directamente (como ya pasó dos veces antes en este
 * proyecto, en las reglas de `zones` y en `/api/armador-session`) hace que
 * nunca se emparejen y el cálculo salga vacío o mal. Por eso lo primero que
 * hace este módulo es traducir TODO a un único espacio: el id del roster,
 * usando `Armador.authUid` como puente.
 */

import type { ActivityLogEntry, Armador } from "@/types";

// ─── Tipos de resultado ─────────────────────────────────────────────────────

/** Una medición real: cuánto tardó un armador en escanear su primera zona de un ciclo. */
export interface ReactionSample {
  armadorId: string;
  armadorName: string;
  /** Cuándo el admin confirmó el ciclo ("Listo"). */
  cycleStartedAt: number;
  /** Cuándo el armador escaneó la primera zona. */
  firstScanAt: number;
  /** Diferencia, en segundos. Siempre >= 0. */
  latencySec: number;
  zoneCode: string;
}

/** Una medición real: cuánto tardó un armador en pasar de una zona terminada a la siguiente. */
export interface TransitionSample {
  armadorId: string;
  armadorName: string;
  fromZoneCode: string;
  toZoneCode: string;
  finishedAt: number;
  nextStartedAt: number;
  /** Diferencia, en segundos. Siempre >= 0. */
  transitionSec: number;
}

/** Cuánto duró realmente un escaneo de zona (de "scan_started" a "scan_finished"), con su fecha — para ver tendencia en el tiempo. */
export interface ScanDurationSample {
  armadorId: string;
  armadorName: string;
  zoneCode: string;
  finishedAt: number;
  durationSec: number;
}

export interface Stat {
  count: number;
  avgSec: number;
  medianSec: number;
  p90Sec: number;
  minSec: number;
  maxSec: number;
}

export interface HistogramBucket {
  label: string;
  /** Límite superior en segundos (Infinity para el último balde). */
  maxSec: number;
  count: number;
}

export interface DailyPoint {
  /** YYYY-MM-DD, hora local del navegador. */
  day: string;
  avgLatencySec: number | null;
  avgTransitionSec: number | null;
  latencyCount: number;
  transitionCount: number;
}

export interface ArmadorAnalytics {
  armadorId: string;
  armadorName: string;
  color?: string;
  reaction: Stat | null;
  transition: Stat | null;
  reactionSamples: number;
  transitionSamples: number;
}

export interface CompanyAnalytics {
  reactions: ReactionSample[];
  transitions: TransitionSample[];
  scanDurations: ScanDurationSample[];
  reactionStat: Stat | null;
  transitionStat: Stat | null;
  reactionHistogram: HistogramBucket[];
  transitionHistogram: HistogramBucket[];
  perArmador: ArmadorAnalytics[];
  dailyTrend: DailyPoint[];
  /** Armadores cuyo promedio de reacción supera 1.5x el promedio de la empresa — candidatos a revisar/acompañar. */
  slowResponders: { armadorId: string; armadorName: string; avgLatencySec: number }[];
  /** true si todavía no hay suficientes datos (0 muestras) para mostrar algo con confianza. */
  isEmpty: boolean;
}

// ─── Estadística básica ─────────────────────────────────────────────────────

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(valuesSec: number[]): Stat | null {
  if (valuesSec.length === 0) return null;
  const sorted = [...valuesSec].sort((a, b) => a - b);
  return {
    count: sorted.length,
    avgSec: Math.round(mean(sorted)),
    medianSec: Math.round(percentile(sorted, 50)),
    p90Sec: Math.round(percentile(sorted, 90)),
    minSec: sorted[0],
    maxSec: sorted[sorted.length - 1],
  };
}

const REACTION_BUCKETS: { label: string; maxSec: number }[] = [
  { label: "< 2 min", maxSec: 120 },
  { label: "2–5 min", maxSec: 300 },
  { label: "5–10 min", maxSec: 600 },
  { label: "10–20 min", maxSec: 1200 },
  { label: "> 20 min", maxSec: Infinity },
];

const TRANSITION_BUCKETS: { label: string; maxSec: number }[] = [
  { label: "< 1 min", maxSec: 60 },
  { label: "1–3 min", maxSec: 180 },
  { label: "3–5 min", maxSec: 300 },
  { label: "5–10 min", maxSec: 600 },
  { label: "> 10 min", maxSec: Infinity },
];

function histogram(valuesSec: number[], buckets: { label: string; maxSec: number }[]): HistogramBucket[] {
  return buckets.map((b, i) => {
    const prevMax = i === 0 ? -1 : buckets[i - 1].maxSec;
    const count = valuesSec.filter((v) => v > prevMax && v <= b.maxSec).length;
    return { label: b.label, maxSec: b.maxSec, count };
  });
}

/**
 * Versiones públicas de `summarize`/`histogram`, para cuando un dashboard
 * necesita recalcular sobre un subconjunto de muestras ya calculadas por
 * `computeCompanyAnalytics` (por ejemplo, filtradas a un período de fechas)
 * sin tener que rehacer la correlación de eventos desde cero.
 */
export function summarizeSeconds(valuesSec: number[]): Stat | null {
  return summarize(valuesSec);
}

export function histogramSeconds(valuesSec: number[], kind: "reaction" | "transition"): HistogramBucket[] {
  return histogram(valuesSec, kind === "reaction" ? REACTION_BUCKETS : TRANSITION_BUCKETS);
}

// ─── Normalización de la bitácora a un solo espacio de id ──────────────────

type NormalizedEvent =
  | { kind: "cycle_started"; armadorId: string; armadorName: string; at: number }
  | { kind: "scan_started"; armadorId: string; armadorName: string; at: number; zoneCode: string }
  | { kind: "scan_finished"; armadorId: string; armadorName: string; at: number; zoneCode: string; durationSec: number };

/**
 * Traduce la bitácora cruda a eventos con el id del ROSTER siempre, sin
 * importar en qué espacio venía originalmente cada tipo de evento. Ver el
 * comentario de cabecera del archivo para el porqué.
 */
function normalizeEvents(activity: ActivityLogEntry[], armadores: Armador[]): NormalizedEvent[] {
  const byRosterId = new Map<string, Armador>();
  const byAuthUid = new Map<string, Armador>();
  for (const a of armadores) {
    byRosterId.set(a.id, a);
    if (a.authUid) byAuthUid.set(a.authUid, a);
  }

  const out: NormalizedEvent[] = [];
  for (const e of activity) {
    if (!e.armadorId) continue;
    if (e.type === "cycle_started") {
      const a = byRosterId.get(e.armadorId);
      if (!a) continue;
      out.push({ kind: "cycle_started", armadorId: a.id, armadorName: a.name, at: e.createdAt });
    } else if (e.type === "scan_started") {
      // armadorId aquí es el uid de Auth — puentear a través de authUid.
      const a = byAuthUid.get(e.armadorId) || byRosterId.get(e.armadorId);
      if (!a || !e.zoneCode) continue;
      out.push({ kind: "scan_started", armadorId: a.id, armadorName: a.name, at: e.createdAt, zoneCode: e.zoneCode });
    } else if (e.type === "scan_finished") {
      const a = byAuthUid.get(e.armadorId) || byRosterId.get(e.armadorId);
      if (!a || !e.zoneCode) continue;
      out.push({
        kind: "scan_finished",
        armadorId: a.id,
        armadorName: a.name,
        at: e.createdAt,
        zoneCode: e.zoneCode,
        durationSec: e.quantity || 0,
      });
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

// ─── Cálculo principal ──────────────────────────────────────────────────────

/**
 * Recorre la línea de tiempo de cada armador y extrae, ciclo por ciclo:
 *  - la latencia hasta el primer escaneo del ciclo ("reacción")
 *  - la latencia entre el fin de una zona y el inicio de la siguiente ("transición")
 *  - la duración real de cada escaneo (para la tendencia diaria)
 *
 * Un "ciclo" empieza en cada "cycle_started" de ese armador y dura hasta el
 * siguiente "cycle_started" (o hasta el final de los datos). Dentro de un
 * ciclo, el primer "scan_started" define la reacción; cada "scan_started"
 * posterior que tenga un "scan_finished" previo (de la zona anterior) define
 * una transición.
 */
export function computeCompanyAnalytics(
  activity: ActivityLogEntry[],
  armadores: Armador[]
): CompanyAnalytics {
  const events = normalizeEvents(activity, armadores);

  // Agrupar por armador (roster id), preservando el orden cronológico.
  const byArmador = new Map<string, NormalizedEvent[]>();
  for (const ev of events) {
    const list = byArmador.get(ev.armadorId) || [];
    list.push(ev);
    byArmador.set(ev.armadorId, list);
  }

  const reactions: ReactionSample[] = [];
  const transitions: TransitionSample[] = [];
  const scanDurations: ScanDurationSample[] = [];

  for (const [, list] of Array.from(byArmador)) {
    let cycleStartedAt: number | null = null;
    let firstScanDoneForCycle = false;
    let lastFinished: { zoneCode: string; at: number } | null = null;

    for (const ev of list) {
      if (ev.kind === "cycle_started") {
        cycleStartedAt = ev.at;
        firstScanDoneForCycle = false;
        lastFinished = null;
      } else if (ev.kind === "scan_started") {
        if (cycleStartedAt !== null && !firstScanDoneForCycle) {
          reactions.push({
            armadorId: ev.armadorId,
            armadorName: ev.armadorName,
            cycleStartedAt,
            firstScanAt: ev.at,
            latencySec: Math.max(0, Math.round((ev.at - cycleStartedAt) / 1000)),
            zoneCode: ev.zoneCode,
          });
          firstScanDoneForCycle = true;
        } else if (lastFinished) {
          transitions.push({
            armadorId: ev.armadorId,
            armadorName: ev.armadorName,
            fromZoneCode: lastFinished.zoneCode,
            toZoneCode: ev.zoneCode,
            finishedAt: lastFinished.at,
            nextStartedAt: ev.at,
            transitionSec: Math.max(0, Math.round((ev.at - lastFinished.at) / 1000)),
          });
          lastFinished = null;
        }
      } else if (ev.kind === "scan_finished") {
        lastFinished = { zoneCode: ev.zoneCode, at: ev.at };
        scanDurations.push({
          armadorId: ev.armadorId,
          armadorName: ev.armadorName,
          zoneCode: ev.zoneCode,
          finishedAt: ev.at,
          durationSec: ev.durationSec,
        });
      }
    }
  }

  const reactionSecs = reactions.map((r) => r.latencySec);
  const transitionSecs = transitions.map((t) => t.transitionSec);
  const reactionStat = summarize(reactionSecs);
  const transitionStat = summarize(transitionSecs);

  // ─ Por armador ─
  const names = new Map<string, { name: string; color?: string }>();
  for (const a of armadores) names.set(a.id, { name: a.name, color: a.color });
  const armadorIds = new Set<string>([...reactions.map((r) => r.armadorId), ...transitions.map((t) => t.armadorId)]);
  const perArmador: ArmadorAnalytics[] = Array.from(armadorIds).map((id) => {
    const info = names.get(id);
    const myReactions = reactions.filter((r) => r.armadorId === id).map((r) => r.latencySec);
    const myTransitions = transitions.filter((t) => t.armadorId === id).map((t) => t.transitionSec);
    return {
      armadorId: id,
      armadorName: info?.name || "Desconocido",
      color: info?.color,
      reaction: summarize(myReactions),
      transition: summarize(myTransitions),
      reactionSamples: myReactions.length,
      transitionSamples: myTransitions.length,
    };
  }).sort((a, b) => (a.reaction?.avgSec ?? Infinity) - (b.reaction?.avgSec ?? Infinity));

  // ─ Armadores lentos a destacar ─
  const slowResponders = reactionStat
    ? perArmador
        .filter((a) => a.reaction && a.reaction.avgSec > reactionStat.avgSec * 1.5 && a.reaction.count >= 2)
        .map((a) => ({ armadorId: a.armadorId, armadorName: a.armadorName, avgLatencySec: a.reaction!.avgSec }))
    : [];

  // ─ Tendencia diaria (últimos días con datos) ─
  const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const days = new Map<string, { lat: number[]; trans: number[] }>();
  for (const r of reactions) {
    const k = dayKey(r.firstScanAt);
    if (!days.has(k)) days.set(k, { lat: [], trans: [] });
    days.get(k)!.lat.push(r.latencySec);
  }
  for (const t of transitions) {
    const k = dayKey(t.nextStartedAt);
    if (!days.has(k)) days.set(k, { lat: [], trans: [] });
    days.get(k)!.trans.push(t.transitionSec);
  }
  const dailyTrend: DailyPoint[] = Array.from(days.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([day, v]) => ({
      day,
      avgLatencySec: v.lat.length > 0 ? Math.round(mean(v.lat)) : null,
      avgTransitionSec: v.trans.length > 0 ? Math.round(mean(v.trans)) : null,
      latencyCount: v.lat.length,
      transitionCount: v.trans.length,
    }));

  return {
    reactions,
    transitions,
    scanDurations,
    reactionStat,
    transitionStat,
    reactionHistogram: histogram(reactionSecs, REACTION_BUCKETS),
    transitionHistogram: histogram(transitionSecs, TRANSITION_BUCKETS),
    perArmador,
    dailyTrend,
    slowResponders,
    isEmpty: reactions.length === 0 && transitions.length === 0,
  };
}

// ─── Formato ─────────────────────────────────────────────────────────────

/** Formatea segundos como "3m 20s" / "45s" / "1h 05m" — consistente en todos los dashboards. */
export function formatDuration(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return "—";
  if (totalSec < 60) return `${Math.round(totalSec)}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatDayLabel(day: string): string {
  const d = new Date(day + "T00:00:00");
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}
