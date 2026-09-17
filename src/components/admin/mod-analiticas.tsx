"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions } from "@/lib/firestore";
import { computeZoneAnalytics } from "@/lib/zone-analytics";
import type { Zone, Armador, ScanSession } from "@/types";
import type { ZoneMetric, ZoneAnalyticsSummary } from "@/lib/zone-analytics";

/* ─── Live event simulation ─── */
interface LiveEvent {
  id: string;
  time: Date;
  type: "scan" | "start" | "pause" | "resume" | "complete" | "alert";
  zone: string;
  armador?: string;
  message: string;
}

const SIMULATED_ZONES = ["Z01","Z02","Z03","Z04","Z05","Z06","Z07","Z08","Z09","Z10","Z11","Z12","Z13","Z14","Z15","Z16","Z17","Z18","Z19","Z20"];
const SIMULATED_ARMA = ["Carlos M.","Ana L.","Pedro R.","Laura S.","Diego F.","Sofia G.","Martin V.","Valentina H."];
const EVENT_TEMPLATES = [
  { type: "scan" as const, msgs: ["Escaneo QR en zona","Lectura exitosa","Zona activada por armador","Verificacion completada"] },
  { type: "start" as const, msgs: ["Inicio de recorrido","Recorrido iniciado","Armador comienza zona"] },
  { type: "pause" as const, msgs: ["Pausa temporal","Descanso registrado","Pausa por hidratacion"] },
  { type: "resume" as const, msgs: ["Reanudar actividad","Continua recorrido","Vuelta al trabajo"] },
  { type: "complete" as const, msgs: ["Zona completada","Recorrido finalizado","100% verificado"] },
  { type: "alert" as const, msgs: ["Alerta: zona lenta","Alerta: carga desbalanceada","Alerta: tiempo excedido"] },
];

function generateLiveEvent(): LiveEvent {
  const tmpl = EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)];
  const zone = SIMULATED_ZONES[Math.floor(Math.random() * SIMULATED_ZONES.length)];
  const armador = SIMULATED_ARMA[Math.floor(Math.random() * SIMULATED_ARMA.length)];
  const msg = tmpl.msgs[Math.floor(Math.random() * tmpl.msgs.length)];
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    time: new Date(),
    type: tmpl.type,
    zone,
    armador,
    message: `${msg} ${zone}`,
  };
}

/* ─── Animated number hook ─── */
function useAnimatedNumber(target: number, duration = 600): number {
  const [current, setCurrent] = useState(0);
  const ref = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = ref.current;
    const diff = target - start;
    if (diff === 0) return;
    const startTime = performance.now();
    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = Math.round(start + diff * eased);
      setCurrent(val);
      ref.current = val;
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return current;
}

/* ─── Animated bar ─── */
function AnimatedBar({ value, max, color, label, sublabel, delay = 0 }: {
  value: number; max: number; color: string; label: string; sublabel?: string; delay?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), delay); return () => clearTimeout(t); }, [delay]);
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{ width: 44, fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)", textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, height: 24, background: "var(--panel2)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
        <div style={{ width: mounted ? `${pct}%` : "0%", height: "100%", background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: 6, transition: "width 1s cubic-bezier(.22,1,.36,1)", position: "relative" }}>
          {pct > 20 && <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: 700, color: "#fff" }}>{sublabel || value}</span>}
        </div>
        {pct <= 20 && <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: 600, color: "var(--faint)" }}>{sublabel || value}</span>}
      </div>
    </div>
  );
}

/* ─── Animated gauge SVG ─── */
function AnimatedGauge({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 100); return () => clearTimeout(t); }, []);
  const pct = Math.min(value / Math.max(max, 1), 1);
  const deg = pct * 180;
  const animVal = useAnimatedNumber(Math.round(pct * 100), 800);
  return (
    <div className="panel" style={{ padding: 16, textAlign: "center" }}>
      <div style={{ position: "relative", width: 100, height: 55, margin: "0 auto 8px" }}>
        <svg viewBox="0 0 100 55" style={{ width: 100, height: 55 }}>
          <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="var(--panel2)" strokeWidth="8" strokeLinecap="round" />
          <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={mounted ? `${deg} 180` : "0 180"} style={{ transition: "stroke-dasharray 1s cubic-bezier(.22,1,.36,1)" }} />
        </svg>
        <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", fontSize: 18, fontWeight: 700 }}>
          {animVal}<span style={{ fontSize: 10, color: "var(--faint)" }}>%</span>
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>{label}</div>
    </div>
  );
}

/* ─── Animated donut ─── */
function AnimatedDonut({ segments, size }: { segments: { value: number; color: string; label: string }[]; size: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 200); return () => clearTimeout(t); }, []);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--panel2)" }} />;
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dashLen = pct * circ;
          const dashOff = -(acc / total) * circ;
          acc += seg.value;
          return <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={seg.color} strokeWidth="12"
            strokeDasharray={mounted ? `${dashLen} ${circ - dashLen}` : `0 ${circ}`} strokeDashoffset={dashOff}
            style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.22,1,.36,1)" }} />;
        })}
        <text x={size/2} y={size/2 - 4} textAnchor="middle" style={{ fontSize: 18, fontWeight: 700, fill: "var(--tx)" }}>{total}</text>
        <text x={size/2} y={size/2 + 12} textAnchor="middle" style={{ fontSize: 9, fill: "var(--faint)" }}>total</text>
      </svg>
      <div style={{ display: "grid", gap: 6 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: seg.color }} />
            <span style={{ fontSize: 11, color: "var(--mut)" }}>{seg.label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 4 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Live event feed ─── */
function LiveFeed({ events, maxVisible = 8 }: { events: LiveEvent[]; maxVisible?: number }) {
  const typeIcon: Record<string, string> = { scan: "\u{1F50D}", start: "\u25B6\uFE0F", pause: "\u23F8\uFE0F", resume: "\u25B6\uFE0F", complete: "\u2705", alert: "\u26A0\uFE0F" };
  const typeColor: Record<string, string> = { scan: "var(--s-active)", start: "var(--s-assigned)", pause: "var(--s-paused)", resume: "var(--s-done)", complete: "var(--s-done)", alert: "var(--s-inc)" };
  const visible = events.slice(0, maxVisible);
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="live"><span className="pulse" />En vivo</span>
        <span style={{ fontSize: 10, color: "var(--faint)" }}>Feed de actividad</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((ev, i) => (
          <div key={ev.id} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            borderRadius: 8, background: i === 0 ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
            border: i === 0 ? "1px solid color-mix(in srgb, var(--accent) 15%, transparent)" : "1px solid transparent",
            animation: i === 0 ? "fadeInUp .3s ease" : undefined, transition: "background .3s",
          }}>
            <span style={{ fontSize: 14 }}>{typeIcon[ev.type]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.message}</div>
              <div style={{ fontSize: 9, color: typeColor[ev.type], fontWeight: 600 }}>{ev.armador}</div>
            </div>
            <span style={{ fontSize: 9, color: "var(--faint)", fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>
              {ev.time.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        ))}
        {visible.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 12 }}>Esperando eventos...</div>
        )}
      </div>
    </div>
  );
}

/* ─── Animated time chart ─── */
function AnimatedTimeChart({ zones, target }: { zones: ZoneMetric[]; target: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 300); return () => clearTimeout(t); }, []);
  const maxTime = Math.max(...zones.map((z) => z.actualMinutes), target, 1);
  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Tiempo por zona vs Objetivo ({target} min)</div>
      <div style={{ fontSize: 11, color: "var(--faint)", marginBottom: 12 }}>Barras crecen en tiempo real</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 200, borderBottom: "1px solid var(--line)", position: "relative" }}>
        <div style={{ position: "absolute", bottom: Math.round((target / maxTime) * 180), left: 0, right: 0, borderTop: "2px dashed var(--accent)", opacity: 0.6, zIndex: 1 }} />
        <div style={{ position: "absolute", bottom: Math.round((target / maxTime) * 180) + 2, right: 4, fontSize: 9, color: "var(--accent)", fontWeight: 600, zIndex: 2 }}>{target}m</div>
        {zones.slice(0, 20).map((z, i) => {
          const fullH = Math.round((z.actualMinutes / maxTime) * 180);
          const color = z.actualMinutes > target ? "var(--s-inc)" : z.actualMinutes > target * 0.7 ? "var(--s-paused)" : "var(--s-done)";
          return (
            <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", position: "relative", zIndex: 0 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: "var(--tx)", marginBottom: 2, opacity: mounted ? 1 : 0, transition: "opacity .5s", transitionDelay: `${i * 50}ms` }}>{z.actualMinutes}</span>
              <div style={{ width: "100%", maxWidth: 36, height: mounted ? Math.max(fullH, 3) : 3, borderRadius: "3px 3px 0 0", background: color, transition: "height 1s cubic-bezier(.22,1,.36,1)", transitionDelay: `${i * 50}ms` }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        {zones.slice(0, 20).map((z) => (
          <div key={z.code} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "var(--faint)", fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</div>
        ))}
      </div>
    </div>
  );
}

/* ─── Toast notifications ─── */
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position: "fixed", top: 20, right: 20, zIndex: 9999,
      padding: "12px 18px", borderRadius: 10,
      background: "var(--s-inc)", color: "#fff", fontWeight: 600, fontSize: 13,
      boxShadow: "0 8px 30px rgba(0,0,0,.3)", animation: "slideInRight .3s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>🔔</span>
        <span>{message}</span>
      </div>
    </div>
  );
}

/* ─── Time display ─── */
function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13, letterSpacing: ".02em" }}>
      {time.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

/* ─── Alert count animation ─── */
function AnimatedCount({ value, color }: { value: number; color: string }) {
  const animVal = useAnimatedNumber(value, 400);
  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, borderRadius: 10, background: color, color: "#fff", fontSize: 10, fontWeight: 700, padding: "0 6px" }}>{animVal}</span>;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN MODULE
   ═══════════════════════════════════════════════════════════════════════════════ */

export function ModAnaliticas() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"resumen" | "zonas" | "alertas" | "recomendaciones">("resumen");
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [pulseActive, setPulseActive] = useState(true);
  const eventTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubS = subscribeSessions(user.companyId, setSessions);
    return () => { unsubZ(); unsubA(); unsubS(); };
  }, [user?.companyId]);

  // Simulated live events
  useEffect(() => {
    eventTimerRef.current = setInterval(() => {
      const ev = generateLiveEvent();
      setLiveEvents((prev) => [ev, ...prev].slice(0, 50));
      if (ev.type === "alert") setToast(ev.message);
    }, 2500 + Math.random() * 2000);
    return () => { if (eventTimerRef.current) clearInterval(eventTimerRef.current); };
  }, []);

  const analytics = useMemo(() => {
    if (zones.length === 0) return null;
    return computeZoneAnalytics(zones, armadores, sessions);
  }, [zones, armadores, sessions]);

  // Pulse active state
  useEffect(() => {
    const i = setInterval(() => setPulseActive((p) => !p), 1000);
    return () => clearInterval(i);
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando analitica...</div>;
  if (!analytics) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>&#x1F4CA;</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Sin datos suficientes</div>
      <div style={{ fontSize: 13, color: "var(--mut)" }}>Carga datos desde SAP y asigna zonas para ver la analitica</div>
    </div>
  );

  const tabCount = (tab: string) => {
    if (tab === "alertas") return analytics.alerts.length;
    if (tab === "recomendaciones") return analytics.recommendations.length;
    if (tab === "zonas") return analytics.zones.length;
    return null;
  };

  return (
    <div>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* Live header bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "10px 16px", background: "var(--panel)", borderRadius: 12, border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="live"><span className="pulse" />EN VIVO</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: pulseActive ? "var(--s-done)" : "var(--s-idle)", transition: "background .3s" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--s-done)" }}>{analytics.zones.filter((z) => z.status === "active").length} activas</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: analytics.alerts.filter((a) => a.severity === "high").length > 0 ? "var(--s-inc)" : "var(--s-idle)", transition: "background .3s" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: analytics.alerts.filter((a) => a.severity === "high").length > 0 ? "var(--s-inc)" : "var(--faint)" }}>
              {analytics.alerts.filter((a) => a.severity === "high").length} alertas
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LiveClock />
          <span style={{ fontSize: 10, color: "var(--faint)" }}>{sessions.length} sesiones</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--panel2)", borderRadius: 10, padding: 4 }}>
        {(["resumen", "zonas", "alertas", "recomendaciones"] as const).map((tab) => {
          const cnt = tabCount(tab);
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              background: activeTab === tab ? "var(--accent)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--mut)", fontWeight: 600, fontSize: 12,
              fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "all .2s",
            }}>
              {tab === "resumen" && "\u25C9 Resumen"}
              {tab === "zonas" && "Zonas"}
              {tab === "alertas" && "Alertas"}
              {tab === "recomendaciones" && "Recomendaciones"}
              {cnt !== null && cnt > 0 && <AnimatedCount value={cnt} color={activeTab === tab ? "#fff" : tab === "alertas" ? "var(--s-inc)" : "var(--accent)"} />}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ display: "grid", gridTemplateColumns: activeTab === "resumen" ? "1fr 300px" : "1fr", gap: 16 }}>
        <div>
          {activeTab === "resumen" && <ResumenTab analytics={analytics} sessions={sessions} />}
          {activeTab === "zonas" && <ZonasTab analytics={analytics} />}
          {activeTab === "alertas" && <AlertasTab analytics={analytics} />}
          {activeTab === "recomendaciones" && <RecomendacionesTab analytics={analytics} />}
        </div>
        {activeTab === "resumen" && <LiveFeed events={liveEvents} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   RESUMEN TAB
   ═══════════════════════════════════════════════════════════════════════════════ */

function ResumenTab({ analytics, sessions }: { analytics: ZoneAnalyticsSummary; sessions: ScanSession[] }) {
  const recentSessions = sessions.filter((s) => s.endTime && Date.now() - (s.endTime || 0) < 3600000).length;
  return (
    <div>
      {/* Gauges */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <AnimatedGauge value={analytics.avgEfficiency} max={100} label="Eficiencia" color="var(--accent)" />
        <AnimatedGauge value={analytics.balanceScore} max={100} label="Balance" color="var(--s-done)" />
        <AnimatedGauge value={analytics.saturatedCount} max={Math.max(analytics.totalZones, 1)} label="Saturadas" color="var(--s-inc)" />
        <AnimatedGauge value={analytics.activeCount} max={Math.max(analytics.totalZones, 1)} label="Activas" color="var(--s-active)" />
      </div>

      {/* Donut + Time chart */}
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, marginBottom: 16 }}>
        <div className="panel" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Distribucion de estados</div>
          <AnimatedDonut
            segments={[
              { value: analytics.doneCount, color: "var(--s-done)", label: "Completadas" },
              { value: analytics.activeCount, color: "var(--s-active)", label: "En proceso" },
              { value: analytics.incidentCount, color: "var(--s-inc)", label: "Incidencias" },
              { value: analytics.idleCount, color: "var(--s-idle)", label: "Pendientes" },
            ]}
            size={180}
          />
        </div>
        <AnimatedTimeChart zones={analytics.zones} target={15} />
      </div>

      {/* Product density + Armador distribution */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="panel" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>&#x1F4E6; Densidad de productos por zona</div>
          {analytics.zones.filter((z) => z.totalProducts > 0).sort((a, b) => b.totalProducts - a.totalProducts).slice(0, 8).map((z, i) => {
            const maxProd = Math.max(...analytics.zones.map((zz) => zz.totalProducts), 1);
            return <AnimatedBar key={z.code} value={z.totalProducts} max={maxProd} color="var(--accent)" label={z.code.replace(/^.*_/, "")} sublabel={`${z.totalProducts} prod`} delay={i * 80} />;
          })}
        </div>
        <div className="panel" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>&#x1F465; Armadores por zona</div>
          {analytics.zones.filter((z) => z.armadorCount > 0).sort((a, b) => b.armadorCount - a.armadorCount).slice(0, 8).map((z, i) => {
            const maxArm = Math.max(...analytics.zones.map((zz) => zz.armadorCount), 1);
            return <AnimatedBar key={z.code} value={z.armadorCount} max={maxArm} color="var(--s-active)" label={z.code.replace(/^.*_/, "")} sublabel={`${z.armadorCount} arms`} delay={i * 80} />;
          })}
        </div>
      </div>

      {/* Best/Worst/Activity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {analytics.bestZone && (
          <div className="panel" style={{ borderLeft: "4px solid var(--s-done)", padding: 16, animation: "fadeInUp .4s ease" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--s-done)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>&#x1F3C6; Mas productiva</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--mono)" }}>{analytics.bestZone.code.replace(/^.*_/, "")}</div>
            <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 4 }}>Score {analytics.bestZone.score} · {analytics.bestZone.productsPerHour} prod/h · {analytics.bestZone.actualMinutes} min</div>
          </div>
        )}
        {analytics.worstZone && (
          <div className="panel" style={{ borderLeft: "4px solid var(--s-inc)", padding: 16, animation: "fadeInUp .4s ease .1s both" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--s-inc)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>&#x1F534; Menor desempeno</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--mono)" }}>{analytics.worstZone.code.replace(/^.*_/, "")}</div>
            <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 4 }}>Score {analytics.worstZone.score} · {analytics.worstZone.productsPerHour} prod/h · {analytics.worstZone.actualMinutes} min</div>
          </div>
        )}
        <div className="panel" style={{ padding: 16, animation: "fadeInUp .4s ease .2s both" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--s-active)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>&#x23F3; Actividad reciente</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}><AnimatedCount value={recentSessions} color="var(--s-active)" /></div>
          <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 4 }}>sesiones en la ultima hora</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ZONAS TAB
   ═══════════════════════════════════════════════════════════════════════════════ */

function ZonasTab({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const [sortKey, setSortKey] = useState<"score" | "actualMinutes" | "efficiency" | "totalProducts" | "armadorCount">("score");
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const arr = [...analytics.zones];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "score") cmp = a.score - b.score;
      else if (sortKey === "actualMinutes") cmp = a.actualMinutes - b.actualMinutes;
      else if (sortKey === "efficiency") cmp = a.efficiency - b.efficiency;
      else if (sortKey === "totalProducts") cmp = a.totalProducts - b.totalProducts;
      else if (sortKey === "armadorCount") cmp = a.armadorCount - b.armadorCount;
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [analytics.zones, sortKey, sortAsc]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const si = (key: typeof sortKey) => sortKey === key ? (sortAsc ? " \u25B2" : " \u25BC") : "";

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--panel2)" }}>
              <Th onClick={() => toggleSort("score")}>Zona{si("score")}</Th>
              <Th>Estado</Th>
              <Th right onClick={() => toggleSort("actualMinutes")}>Tiempo{si("actualMinutes")}</Th>
              <Th right>Var.</Th>
              <Th right onClick={() => toggleSort("efficiency")}>Eficiencia{si("efficiency")}</Th>
              <Th right onClick={() => toggleSort("totalProducts")}>Prod.{si("totalProducts")}</Th>
              <Th right onClick={() => toggleSort("armadorCount")}>Arms.{si("armadorCount")}</Th>
              <Th right onClick={() => toggleSort("score")}>Score{si("score")}</Th>
              <Th>Carga</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((z) => {
              const isExpanded = expanded === z.code;
              return (
                <tr key={z.code} style={{ borderBottom: "1px solid var(--line)", cursor: "pointer", background: isExpanded ? "color-mix(in srgb, var(--accent) 4%, transparent)" : undefined, transition: "background .2s" }}
                  onClick={() => setExpanded(isExpanded ? null : z.code)}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}><StatusBadge status={z.status} /></td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.actualMinutes}m</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600, color: z.varianceMinutes > 0 ? "var(--s-inc)" : "var(--s-done)" }}>
                    {z.varianceMinutes > 0 ? "+" : ""}{z.varianceMinutes}m
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}><EfficiencyBar value={z.efficiency} /></td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.totalProducts}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.armadorCount}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}><ScoreBadge score={z.score} /></td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}><LoadBadge level={z.loadLevel} /></td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--faint)", fontSize: 10 }}>{isExpanded ? "\u25BC" : "\u25B6"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Expanded zone detail inline */}
      {expanded && (
        <div style={{ padding: "16px 20px", background: "var(--panel2)", borderTop: "2px solid var(--accent)" }}>
          {(() => {
            const z = analytics.zones.find((zz) => zz.code === expanded);
            if (!z) return null;
            return (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Detalle zona {z.code.replace(/^.*_/, "")} <StatusBadge status={z.status} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
                  {[["Tiempo real", `${z.actualMinutes} min`, z.varianceMinutes > 0 ? "var(--s-inc)" : "var(--s-done)"],
                    ["Objetivo", `${z.targetMinutes} min`, undefined],
                    ["Eficiencia", `${z.efficiency}%`, z.efficiency >= 80 ? "var(--s-done)" : "var(--s-inc)"],
                    ["Prod/min", String(z.productsPerMinute), undefined],
                    ["Prod/hora", String(z.productsPerHour), undefined],
                    ["Unidades", String(z.totalUnits), undefined],
                    ["Unid/armador", String(z.unitsPerArmador), undefined],
                    ["Sesiones", String(z.sessionsCompleted), undefined],
                    ["Min prom", `${z.avgSessionMinutes}m`, undefined],
                    ["Min min", `${z.minSessionMinutes}m`, undefined],
                    ["Min max", `${z.maxSessionMinutes}m`, undefined],
                  ].map(([label, value, color]) => (
                    <div key={label as string}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: color || "var(--tx)" }}>{value}</div>
                    </div>
                  ))}
                </div>
                {z.armadorNames.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--faint)", marginBottom: 6 }}>ARMADORES</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {z.armadorNames.map((name) => (
                        <span key={name} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "var(--panel)", border: "1px solid var(--line)", fontWeight: 500 }}>{name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   ALERTAS TAB
   ═══════════════════════════════════════════════════════════════════════════════ */

function AlertasTab({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  if (analytics.alerts.length === 0) return (
    <div className="panel" style={{ padding: 50, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>&#x2705;</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--s-done)" }}>Todo operando normal</div>
      <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>Sin alertas activas en este momento</div>
    </div>
  );

  const grouped = [
    { sev: "high", label: "Alta prioridad", icon: "\u{1F534}", color: "var(--s-inc)" },
    { sev: "medium", label: "Media prioridad", icon: "\u{1F7E0}", color: "var(--s-paused)" },
    { sev: "low", label: "Baja prioridad", icon: "\u{1F7E2}", color: "var(--s-idle)" },
  ];

  return (
    <div>
      {grouped.map(({ sev, label, icon, color }) => {
        const alerts = analytics.alerts.filter((a) => a.severity === sev);
        if (alerts.length === 0) return null;
        return (
          <div key={sev} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{icon} {label} ({alerts.length})</div>
            <div style={{ display: "grid", gap: 8 }}>
              {alerts.map((a, i) => (
                <div key={i} className="panel" style={{ borderLeft: `4px solid ${color}`, padding: "12px 16px", animation: `fadeInUp .3s ease ${i * 50}ms both` }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 16 }}>{typeIcon(a.type)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 12 }}>{a.zoneCode}</span>
                      </div>
                      <div style={{ fontSize: 12, marginBottom: 4 }}>{a.message}</div>
                      <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 500 }}>&#x1F4A1; {a.recommendation}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   RECOMENDACIONES TAB
   ═══════════════════════════════════════════════════════════════════════════════ */

function RecomendacionesTab({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  if (analytics.recommendations.length === 0) return (
    <div className="panel" style={{ padding: 50, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>&#x1F3AF;</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Operacion equilibrada</div>
      <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>No hay recomendaciones pendientes</div>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {analytics.recommendations.map((rec, i) => (
        <div key={i} className="panel" style={{ padding: "18px 22px", display: "flex", gap: 16, animation: `fadeInUp .3s ease ${i * 60}ms both` }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: catColor(rec.category), display: "grid", placeItems: "center", color: "#fff", fontSize: 16, fontWeight: 700, flexShrink: 0 }}>{rec.priority}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{rec.title}</div>
            <div style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.6, marginBottom: 8 }}>{rec.description}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 12, background: catBg(rec.category), color: catColor(rec.category), fontWeight: 700, textTransform: "uppercase" }}>{rec.category}</span>
              <span style={{ fontSize: 11, color: "var(--s-done)", fontWeight: 500 }}>&#x26A1; {rec.impact}</span>
            </div>
            {rec.zones.length > 0 && rec.zones.length <= 6 && (
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {rec.zones.map((z) => (
                  <span key={z} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "var(--panel2)", fontFamily: "var(--mono)", fontWeight: 600 }}>{z.replace(/^.*_/, "")}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════════════════════════════════════ */

function Th({ children, right, onClick }: { children: React.ReactNode; right?: boolean; onClick?: () => void }) {
  return (
    <th onClick={onClick} style={{
      padding: "10px 12px", textAlign: right ? "right" : "left",
      fontSize: 10, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase",
      letterSpacing: ".04em", cursor: onClick ? "pointer" : undefined, whiteSpace: "nowrap",
    }}>{children}</th>
  );
}

function EfficiencyBar({ value }: { value: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 100); return () => clearTimeout(t); }, []);
  const color = value >= 80 ? "var(--s-done)" : value >= 50 ? "var(--s-paused)" : "var(--s-inc)";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
      <div style={{ width: 50, height: 6, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: mounted ? `${value}%` : "0%", height: "100%", background: color, borderRadius: 3, transition: "width 1s cubic-bezier(.22,1,.36,1)" }} />
      </div>
      <span style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 11, color }}>{value}%</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "var(--s-done)" : score >= 40 ? "var(--s-paused)" : "var(--s-inc)";
  const bg = score >= 70 ? "color-mix(in srgb, var(--s-done) 12%, transparent)" : score >= 40 ? "color-mix(in srgb, var(--s-paused) 12%, transparent)" : "color-mix(in srgb, var(--s-inc) 12%, transparent)";
  return <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: bg, color }}>{score}</span>;
}

function LoadBadge({ level }: { level: string }) {
  const c = level === "alta" ? { label: "Alta", color: "var(--s-inc)", bg: "color-mix(in srgb, var(--s-inc) 12%, transparent)" }
    : level === "media" ? { label: "Media", color: "var(--s-paused)", bg: "color-mix(in srgb, var(--s-paused) 12%, transparent)" }
    : { label: "Baja", color: "var(--s-done)", bg: "color-mix(in srgb, var(--s-done) 12%, transparent)" };
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: c.bg, color: c.color, fontWeight: 600 }}>{c.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { l: string; c: string; b: string }> = {
    idle: { l: "Pend", c: "var(--s-idle)", b: "color-mix(in srgb, var(--s-idle) 12%, transparent)" },
    assigned: { l: "Asig", c: "var(--s-assigned)", b: "color-mix(in srgb, var(--s-assigned) 12%, transparent)" },
    active: { l: "Act", c: "var(--s-active)", b: "color-mix(in srgb, var(--s-active) 12%, transparent)" },
    paused: { l: "Paus", c: "var(--s-paused)", b: "color-mix(in srgb, var(--s-paused) 12%, transparent)" },
    done: { l: "Listo", c: "var(--s-done)", b: "color-mix(in srgb, var(--s-done) 12%, transparent)" },
    incident: { l: "Incid", c: "var(--s-inc)", b: "color-mix(in srgb, var(--s-inc) 12%, transparent)" },
  };
  const s = m[status] || m.idle;
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: s.b, color: s.c, fontWeight: 600 }}>{s.l}</span>;
}

function typeIcon(t: string) {
  const m: Record<string, string> = { saturated: "\u26A0\uFE0F", underutilized: "\u2193", slow: "\u23F1", fast: "\u26A1", incident: "\u274C", idle: "\u23F8", unbalanced: "\u2696\uFE0F" };
  return m[t] || "\u2139\uFE0F";
}

function catColor(c: string) {
  return c === "distribucion" ? "var(--s-active)" : c === "tiempo" ? "var(--s-paused)" : c === "productividad" ? "var(--s-done)" : "var(--s-inc)";
}
function catBg(c: string) {
  return c === "distribucion" ? "color-mix(in srgb, var(--s-active) 12%, transparent)" : c === "tiempo" ? "color-mix(in srgb, var(--s-paused) 12%, transparent)" : c === "productividad" ? "color-mix(in srgb, var(--s-done) 12%, transparent)" : "color-mix(in srgb, var(--s-inc) 12%, transparent)";
}
