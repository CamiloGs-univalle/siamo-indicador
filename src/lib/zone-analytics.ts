/**
 * @file lib/zone-analytics.ts
 * @description Motor de analítica por zona: mide saturación, productividad,
 * distribución de armadores, y genera recomendaciones en tiempo real.
 *
 * Pregunta del negocio: "¿Qué zonas están saturadas o con poco trabajo?
 * ¿Dónde debemos mover armadores para ser más productivos?"
 */

import type { Zone, Armador, ScanSession } from "@/types";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface ZoneMetric {
  code: string;
  sector: string;
  status: string;
  priority: string;
  /** Tiempo real de la zona (minutos) */
  actualMinutes: number;
  /** Tiempo objetivo (minutos) */
  targetMinutes: number;
  /** Variación vs objetivo (positivo = sobre tiempo) */
  varianceMinutes: number;
  /** Eficiencia: target/actual * 100 (max 100) */
  efficiency: number;
  /** Total de productos en la zona */
  totalProducts: number;
  /** Unidades totales */
  totalUnits: number;
  /** Productos por minuto */
  productsPerMinute: number;
  /** Productos por hora */
  productsPerHour: number;
  /** Cantidad de armadores que han trabajado en esta zona */
  armadorCount: number;
  /** Nombres de armadores */
  armadorNames: string[];
  /** Sesiones completadas */
  sessionsCompleted: number;
  /** Tiempo promedio por sesión */
  avgSessionMinutes: number;
  /** Minimo tiempo registrado */
  minSessionMinutes: number;
  /** Maximo tiempo registrado */
  maxSessionMinutes: number;
  /** Unidades por armador */
  unitsPerArmador: number;
  /** ¿Está saturada? */
  isSaturated: boolean;
  /** ¿Está subutilizada? */
  isUnderutilized: boolean;
  /** Nivel de carga: "alta" | "media" | "baja" */
  loadLevel: "alta" | "media" | "baja";
  /** Score compuesto 0-100 */
  score: number;
}

export interface ZoneAlert {
  type: "saturated" | "underutilized" | "slow" | "fast" | "incident" | "idle" | "unbalanced";
  severity: "high" | "medium" | "low";
  zoneCode: string;
  message: string;
  recommendation: string;
}

export interface ZoneRecommendation {
  priority: number;
  category: "distribucion" | "tiempo" | "productividad" | "capacidad";
  title: string;
  description: string;
  impact: string;
  zones: string[];
}

export interface ZoneAnalyticsSummary {
  /** Métricas por zona */
  zones: ZoneMetric[];
  /** Alertas activas */
  alerts: ZoneAlert[];
  /** Recomendaciones */
  recommendations: ZoneRecommendation[];
  /** Resumen general */
  totalZones: number;
  totalProducts: number;
  totalUnits: number;
  avgEfficiency: number;
  avgProductsPerHour: number;
  saturatedCount: number;
  underutilizedCount: number;
  idleCount: number;
  activeCount: number;
  doneCount: number;
  incidentCount: number;
  /** Zona más productiva */
  bestZone: ZoneMetric | null;
  /** Zona menos productiva */
  worstZone: ZoneMetric | null;
  /** Balance: que tan distribuido está el trabajo (0-100, 100 = perfectamente parejo) */
  balanceScore: number;
}

// ─── Constantes ─────────────────────────────────────────────────────────────

const TARGET_MINUTES = 15;
const SATURATION_THRESHOLD = 1.5; // 1.5x target = saturada
const UNDERUTILIZED_THRESHOLD = 0.5; // 0.5x target = subutilizada
const MIN_PRODUCTS_FOR_DENSITY = 1;

// ─── Funciones auxiliares ───────────────────────────────────────────────────

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((sum, n) => sum + Math.pow(n - m, 2), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function coefficientOfVariation(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  if (m === 0) return 0;
  return (stddev(nums) / m) * 100;
}

// ─── Motor principal ────────────────────────────────────────────────────────

export function computeZoneAnalytics(
  zones: Zone[],
  armadores: Armador[],
  sessions: ScanSession[]
): ZoneAnalyticsSummary {
  // Index armadores by id
  const armadorMap = new Map<string, Armador>();
  armadores.forEach((a) => { if (a.id) armadorMap.set(a.id, a); });

  // Group sessions by zone code
  const sessionsByZone = new Map<string, ScanSession[]>();
  sessions.forEach((s) => {
    const existing = sessionsByZone.get(s.zoneCode) || [];
    existing.push(s);
    sessionsByZone.set(s.zoneCode, existing);
  });

  // Compute metrics per zone
  const zoneMetrics: ZoneMetric[] = zones.map((z) => {
    const zoneSessions = sessionsByZone.get(z.code) || [];
    const durations = zoneSessions
      .filter((s) => s.duration && s.duration > 0)
      .map((s) => (s.duration || 0) / 60); // convert seconds to minutes

    const actualMinutes = durations.length > 0 ? mean(durations) : (z.avgMinutes || 0);
    const varianceMinutes = actualMinutes - TARGET_MINUTES;
    const efficiency = Math.min(100, actualMinutes > 0 ? (TARGET_MINUTES / actualMinutes) * 100 : 0);

    const totalProducts = z.products?.length || 0;
    const totalUnits = z.products?.reduce((sum, p) => sum + p.cantidad, 0) || 0;
    const productsPerMinute = actualMinutes > 0 ? totalProducts / actualMinutes : 0;
    const productsPerHour = productsPerMinute * 60;

    // Unique armadores from sessions
    const armadorIds = Array.from(new Set(zoneSessions.map((s) => s.armadorId)));
    const armadorNames = armadorIds
      .map((id) => armadorMap.get(id)?.name || id)
      .slice(0, 10);

    const sessionsCompleted = zoneSessions.filter((s) => s.endTime).length;
    const avgSessionMinutes = durations.length > 0 ? mean(durations) : 0;
    const minSessionMinutes = durations.length > 0 ? Math.min(...durations) : 0;
    const maxSessionMinutes = durations.length > 0 ? Math.max(...durations) : 0;
    const unitsPerArmador = armadorIds.length > 0 ? totalUnits / armadorIds.length : 0;

    const isSaturated = actualMinutes > TARGET_MINUTES * SATURATION_THRESHOLD;
    const isUnderutilized = actualMinutes > 0 && actualMinutes < TARGET_MINUTES * UNDERUTILIZED_THRESHOLD;
    const loadLevel = isSaturated ? "alta" : isUnderutilized ? "baja" : "media";

    // Score: efficiency (40%) + product density (30%) + balance (30%)
    const densityScore = Math.min(100, (totalProducts / Math.max(TARGET_MINUTES, 1)) * 100);
    const balanceScore = armadorIds.length > 0 ? Math.min(100, (totalUnits / armadorIds.length / 50) * 100) : 0;
    const score = Math.round(efficiency * 0.4 + densityScore * 0.3 + balanceScore * 0.3);

    return {
      code: z.code,
      sector: z.sector,
      status: z.status,
      priority: z.prioridad || "media",
      actualMinutes: Math.round(actualMinutes * 10) / 10,
      targetMinutes: TARGET_MINUTES,
      varianceMinutes: Math.round(varianceMinutes * 10) / 10,
      efficiency: Math.round(efficiency),
      totalProducts,
      totalUnits,
      productsPerMinute: Math.round(productsPerMinute * 100) / 100,
      productsPerHour: Math.round(productsPerHour),
      armadorCount: armadorIds.length,
      armadorNames,
      sessionsCompleted,
      avgSessionMinutes: Math.round(avgSessionMinutes * 10) / 10,
      minSessionMinutes: Math.round(minSessionMinutes * 10) / 10,
      maxSessionMinutes: Math.round(maxSessionMinutes * 10) / 10,
      unitsPerArmador: Math.round(unitsPerArmador),
      isSaturated,
      isUnderutilized,
      loadLevel,
      score,
    };
  });

  // Alerts
  const alerts: ZoneAlert[] = [];
  zoneMetrics.forEach((zm) => {
    if (zm.isSaturated) {
      alerts.push({
        type: "saturated",
        severity: "high",
        zoneCode: zm.code,
        message: `Zona ${zm.code} saturada: ${zm.actualMinutes} min vs ${TARGET_MINUTES} min objetivo`,
        recommendation: `Reasignar ${Math.ceil(zm.armadorCount * 0.3)} armador(es) adicionales o dividir la zona`,
      });
    }
    if (zm.isUnderutilized && zm.status !== "idle" && zm.status !== "done") {
      alerts.push({
        type: "underutilized",
        severity: "medium",
        zoneCode: zm.code,
        message: `Zona ${zm.code} con poco trabajo: ${zm.actualMinutes} min, ${zm.totalProducts} productos`,
        recommendation: `Considerar combinar con otra zona cercana o asignar más productos`,
      });
    }
    if (zm.status === "incident") {
      alerts.push({
        type: "incident",
        severity: "high",
        zoneCode: zm.code,
        message: `Zona ${zm.code} con incidencia activa`,
        recommendation: `Revisar y resolver la incidencia antes de reasignar`,
      });
    }
    if (zm.status === "idle" && zm.totalProducts > 0) {
      alerts.push({
        type: "idle",
        severity: "low",
        zoneCode: zm.code,
        message: `Zona ${zm.code} pendiente con ${zm.totalProducts} productos sin asignar`,
        recommendation: `Asignar armador para iniciar trabajo`,
      });
    }
  });

  // Unbalanced alert
  const activeZones = zoneMetrics.filter((z) => z.status !== "idle" && z.status !== "done");
  const activeProducts = activeZones.map((z) => z.totalProducts);
  const overallCV = coefficientOfVariation(activeProducts);
  if (activeZones.length >= 3 && overallCV > 50) {
    const maxZone = activeZones.reduce((a, b) => a.totalProducts > b.totalProducts ? a : b);
    const minZone = activeZones.reduce((a, b) => a.totalProducts < b.totalProducts ? a : b);
    alerts.push({
      type: "unbalanced",
      severity: "medium",
      zoneCode: `${maxZone.code}/${minZone.code}`,
      message: `Carga desbalanceada: ${maxZone.code} tiene ${maxZone.totalProducts} prod vs ${minZone.code} con ${minZone.totalProducts}`,
      recommendation: `Redistribuir productos o armadores entre zonas para equilibrar la carga`,
    });
  }

  // Recommendations
  const recommendations: ZoneRecommendation[] = [];

  // Rec 1: Saturated zones
  const saturated = zoneMetrics.filter((z) => z.isSaturated);
  if (saturated.length > 0) {
    recommendations.push({
      priority: 1,
      category: "capacidad",
      title: `${saturated.length} zona(s) saturada(s) necesitan más personal`,
      description: `Las zonas ${saturated.map((z) => z.code).join(", ")} superan el tiempo objetivo en más de 50%. Considere agregar armadores o dividir el trabajo.`,
      impact: "Alto — reducir tiempos de entrega y mejorar cumplimiento",
      zones: saturated.map((z) => z.code),
    });
  }

  // Rec 2: Underutilized zones
  const underutilized = zoneMetrics.filter((z) => z.isUnderutilized && z.status !== "idle" && z.status !== "done");
  if (underutilized.length > 0) {
    recommendations.push({
      priority: 2,
      category: "distribucion",
      title: `${underutilized.length} zona(s) con capacidad ociosa`,
      description: `Las zonas ${underutilized.map((z) => z.code).join(", ")} tienen tiempo por debajo de la meta. Pueden absorber más carga.`,
      impact: "Medio — mejor distribución del trabajo existente",
      zones: underutilized.map((z) => z.code),
    });
  }

  // Rec 3: High armador count with low productivity
  const highArmadorLowProd = zoneMetrics.filter((z) => z.armadorCount >= 3 && z.productsPerHour < 20);
  if (highArmadorLowProd.length > 0) {
    recommendations.push({
      priority: 3,
      category: "productividad",
      title: `${highArmadorLowProd.length} zona(s) con muchos armadores pero baja productividad`,
      description: `Zonas ${highArmadorLowProd.map((z) => z.code).join(", ")} tienen ${highArmadorLowProd.map((z) => z.armadorCount).join(", ")} armadores pero menos de 20 prod/h. Posible sobrecruce o interferencia.`,
      impact: "Alto — optimizar asignación reduce tiempos muertos",
      zones: highArmadorLowProd.map((z) => z.code),
    });
  }

  // Rec 4: Idle zones with products
  const idleWithProducts = zoneMetrics.filter((z) => z.status === "idle" && z.totalProducts > 0);
  if (idleWithProducts.length > 0) {
    recommendations.push({
      priority: 4,
      category: "distribucion",
      title: `${idleWithProducts.length} zona(s) con productos sin empezar`,
      description: `Zonas ${idleWithProducts.map((z) => z.code).join(", ")} tienen ${idleWithProducts.reduce((s, z) => s + z.totalProducts, 0)} productos esperando. Asignar armadores para iniciar.`,
      impact: "Medio — aprovechar capacidad ociosa",
      zones: idleWithProducts.map((z) => z.code),
    });
  }

  // Rec 5: Balance
  if (overallCV > 40 && activeZones.length >= 3) {
    recommendations.push({
      priority: 5,
      category: "distribucion",
      title: "Carga de trabajo desbalanceada entre zonas",
      description: `El coeficiente de variación es ${Math.round(overallCV)}% — algunas zonas tienen mucho más trabajo que otras. Redistribuir para equilibrar.`,
      impact: "Medio — tiempos más uniformes y predecibles",
      zones: activeZones.map((z) => z.code),
    });
  }

  // Summary stats
  const totalProducts = zoneMetrics.reduce((s, z) => s + z.totalProducts, 0);
  const totalUnits = zoneMetrics.reduce((s, z) => s + z.totalUnits, 0);
  const avgEfficiency = zoneMetrics.length > 0 ? mean(zoneMetrics.map((z) => z.efficiency)) : 0;
  const avgProductsPerHour = zoneMetrics.length > 0 ? mean(zoneMetrics.map((z) => z.productsPerHour)) : 0;
  const bestZone = zoneMetrics.length > 0 ? zoneMetrics.reduce((a, b) => a.score > b.score ? a : b) : null;
  const worstZone = zoneMetrics.length > 0 ? zoneMetrics.reduce((a, b) => a.score < b.score ? a : b) : null;

  // Balance score: inverse of CV, capped at 100
  const balanceScore = Math.max(0, Math.min(100, Math.round(100 - overallCV)));

  return {
    zones: zoneMetrics,
    alerts: alerts.sort((a, b) => {
      const sev = { high: 0, medium: 1, low: 2 };
      return sev[a.severity] - sev[b.severity];
    }),
    recommendations: recommendations.sort((a, b) => a.priority - b.priority),
    totalZones: zones.length,
    totalProducts,
    totalUnits,
    avgEfficiency: Math.round(avgEfficiency),
    avgProductsPerHour: Math.round(avgProductsPerHour),
    saturatedCount: saturated.length,
    underutilizedCount: underutilized.length,
    idleCount: zoneMetrics.filter((z) => z.status === "idle").length,
    activeCount: zoneMetrics.filter((z) => z.status === "active").length,
    doneCount: zoneMetrics.filter((z) => z.status === "done").length,
    incidentCount: zoneMetrics.filter((z) => z.status === "incident").length,
    bestZone,
    worstZone,
    balanceScore,
  };
}
