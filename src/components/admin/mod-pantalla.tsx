"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { MapFloor } from "@/components/maps/map-floor";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, subscribeSessions } from "@/lib/firestore";
import { computeZoneAnalytics } from "@/lib/zone-analytics";
import type { Zone, Armador, ScanSession } from "@/types";
import type { ZoneMetric, ZoneAnalyticsSummary } from "@/lib/zone-analytics";

/* ─── Types ─── */
interface LiveEvent {
  id: string;
  time: Date;
  type: "scan" | "start" | "pause" | "resume" | "complete" | "alert";
  zone: string;
  armador: string;
  message: string;
}

/* ─── Simulation ─── */
const ZONES = ["Z01","Z02","Z03","Z04","Z05","Z06","Z07","Z08","Z09","Z10","Z11","Z12","Z13","Z14","Z15","Z16","Z17","Z18","Z19","Z20"];
const ARMA = ["Carlos M.","Ana L.","Pedro R.","Laura S.","Diego F.","Sofia G.","Martin V.","Valentina H."];
const TEMPLATES = [
  { type: "scan" as const, msgs: ["Escaneo QR exitoso","Lectura de zona verificada","Zona activada"] },
  { type: "start" as const, msgs: ["Inicio de recorrido","Recorrido iniciado","Armador comienza"] },
  { type: "pause" as const, msgs: ["Pausa registrada","Descanso momentaneo"] },
  { type: "resume" as const, msgs: ["Reanuda actividad","Continua recorrido"] },
  { type: "complete" as const, msgs: ["Zona completada","Recorrido finalizado 100%"] },
  { type: "alert" as const, msgs: ["Alerta: zona lenta","Alerta: tiempo excedido","Alerta: carga desbalanceada"] },
];

function genEvent(): LiveEvent {
  const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const zone = ZONES[Math.floor(Math.random() * ZONES.length)];
  const armador = ARMA[Math.floor(Math.random() * ARMA.length)];
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`, time: new Date(), type: t.type, zone, armador, message: `${t.msgs[Math.floor(Math.random() * t.msgs.length)]} ${zone}` };
}

/* ─── Animated number ─── */
function useAnim(target: number, dur = 600): number {
  const [cur, setCur] = useState(0);
  const ref = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    const s = ref.current, d = target - s;
    if (d === 0) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const v = Math.round(s + d * e);
      setCur(v); ref.current = v;
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, dur]);
  return cur;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN: MOD-PANTALLA — Dashboard de proyeccion
   ═══════════════════════════════════════════════════════════════════════════════ */

export function ModPantalla() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [view, setView] = useState<"map" | "chart" | "ranking">("map");
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [pulseOn, setPulseOn] = useState(true);

  // Subscriptions
  useEffect(() => {
    if (!user?.companyId) { setLoading(false); return; }
    const unsubZ = subscribeZones(user.companyId, (z) => { setZones(z); setLoading(false); });
    const unsubA = subscribeArmadores(user.companyId, setArmadores);
    const unsubS = subscribeSessions(user.companyId, setSessions);
    return () => { unsubZ(); unsubA(); unsubS(); };
  }, [user?.companyId]);

  // Clock
  useEffect(() => { const i = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(i); }, []);
  // Pulse
  useEffect(() => { const i = setInterval(() => setPulseOn((p) => !p), 1000); return () => clearInterval(i); }, []);
  // Live events
  useEffect(() => { const i = setInterval(() => { setEvents((prev) => [genEvent(), ...prev].slice(0, 60)); }, 2200 + Math.random() * 1800); return () => clearInterval(i); }, []);
  // Auto-rotate view
  useEffect(() => { const i = setInterval(() => { setView((v) => v === "map" ? "chart" : v === "chart" ? "ranking" : "map"); }, 15000); return () => clearInterval(i); }, []);

  // Fullscreen
  useEffect(() => { const h = () => setIsFullscreen(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);
  async function toggleFS() { try { if (!document.fullscreenElement) await fullscreenRef.current?.requestFullscreen(); else await document.exitFullscreen(); } catch {} }

  const analytics = useMemo(() => zones.length > 0 ? computeZoneAnalytics(zones, armadores, sessions) : null, [zones, armadores, sessions]);

  // Derived
  const statusOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "idle";
    if (z.status === "active" || z.status === "paused" || z.status === "done" || z.status === "incident") return z.status;
    return z.armadorId ? "assigned" : "idle";
  };
  const colorOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z) return "var(--s-idle)";
    if (z.armadorId) { const a = armadores.find((aa) => aa.id === z.armadorId); if (a?.color) return a.color; }
    const sc: Record<string, string> = { done: "var(--s-done)", active: "var(--s-active)", assigned: "var(--s-assigned)", incident: "var(--s-inc)", idle: "var(--s-idle)", paused: "var(--s-paused)" };
    return sc[statusOf(code)] || "var(--s-idle)";
  };
  const ownerOf = (code: string) => {
    const z = zones.find((zz) => zz.code === code);
    if (!z?.armadorId) return "";
    return armadores.find((a) => a.id === z.armadorId)?.name || "";
  };
  const activeOf = (code: string) => { const z = zones.find((zz) => zz.code === code); return z?.status === "active" || z?.status === "incident"; };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando pantalla...</div>;

  const done = zones.filter((z) => statusOf(z.code) === "done").length;
  const active = zones.filter((z) => statusOf(z.code) === "active").length;
  const paused = zones.filter((z) => statusOf(z.code) === "paused").length;
  const incidents = zones.filter((z) => statusOf(z.code) === "incident").length;
  const pending = zones.filter((z) => { const s = statusOf(z.code); return s === "idle" || s === "assigned"; }).length;
  const pctDone = zones.length > 0 ? Math.round((done / zones.length) * 100) : 0;

  return (
    <div ref={fullscreenRef} className={"pantalla-root" + (isFullscreen ? " fs" : "")} style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {/* ─── TOP BAR ─── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: "var(--panel)", borderBottom: "2px solid var(--line)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: ".04em" }}>SIAMO.INDICADOR</span>
          <span className="live" style={{ fontSize: 11 }}><span className="pulse" />EN VIVO</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Progress ring */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ProgressRing value={pctDone} size={32} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{pctDone}%</div>
              <div style={{ fontSize: 9, color: "var(--faint)" }}>avance</div>
            </div>
          </div>
          {/* Clock */}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16 }}>{clock.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</div>
            <div style={{ fontSize: 9, color: "var(--faint)" }}>{clock.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })}</div>
          </div>
          <button onClick={toggleFS} style={{ background: "none", border: "none", color: "var(--tx)", cursor: "pointer", fontSize: 18 }}>{isFullscreen ? "⊡" : "⛶"}</button>
        </div>
      </div>

      {/* ─── KPI STRIP ─── */}
      <div style={{ display: "flex", gap: 0, padding: "0 20px", background: "var(--panel)", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        {[
          { label: "TOTAL", value: zones.length, color: "var(--accent)" },
          { label: "COMPLETADAS", value: done, color: "var(--s-done)" },
          { label: "EN PROCESO", value: active, color: "var(--s-active)" },
          { label: "PAUSADAS", value: paused, color: "var(--s-paused)" },
          { label: "PENDIENTES", value: pending, color: "var(--s-assigned)" },
          { label: "INCIDENCIAS", value: incidents, color: "var(--s-inc)" },
        ].map((kpi) => (
          <div key={kpi.label} style={{ flex: 1, padding: "10px 12px", textAlign: "center", borderRight: "1px solid var(--line)" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color }}><AnimNum target={kpi.value} /></div>
            <div style={{ fontSize: 8, fontWeight: 600, color: "var(--faint)", letterSpacing: ".08em" }}>{kpi.label}</div>
          </div>
        ))}
        <div style={{ flex: 1, padding: "10px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: analytics ? (analytics.avgEfficiency >= 70 ? "var(--s-done)" : "var(--s-inc)") : "var(--faint)" }}><AnimNum target={analytics?.avgEfficiency || 0} />%</div>
          <div style={{ fontSize: 8, fontWeight: 600, color: "var(--faint)", letterSpacing: ".08em" }}>EFICIENCIA</div>
        </div>
      </div>

      {/* ─── VIEW SELECTOR ─── */}
      <div style={{ display: "flex", gap: 6, padding: "8px 20px", flexShrink: 0 }}>
        {(["map", "chart", "ranking"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: view === v ? "var(--accent)" : "var(--panel2)",
            color: view === v ? "#fff" : "var(--mut)", fontWeight: 600, fontSize: 11, fontFamily: "inherit",
            transition: "all .2s",
          }}>
            {v === "map" && "🗺 Mapa en Vivo"}
            {v === "chart" && "📊 Analitica"}
            {v === "ranking" && "🏆 Ranking"}
          </button>
        ))}
      </div>

      {/* ─── MAIN CONTENT ─── */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, padding: "0 20px 16px", minHeight: 0 }}>
        {/* Left: Map or Charts */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {view === "map" && (
            <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
              {/* Legend */}
              <div style={{ display: "flex", gap: 12, padding: "8px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0, fontSize: 10, flexWrap: "wrap" }}>
                {[
                  { color: "var(--s-idle)", label: "Sin asignar" },
                  { color: "var(--s-done)", label: "✓ Completada" },
                  { color: "var(--s-active)", label: "● En proceso" },
                  { color: "var(--s-paused)", label: "⏸ Pausada" },
                  { color: "var(--s-inc)", label: "✕ Incidencia" },
                ].map((l) => (
                  <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: l.color }} />
                    <span style={{ color: "var(--faint)" }}>{l.label}</span>
                  </span>
                ))}
                <span style={{ marginLeft: "auto", color: "var(--faint)" }}>Colores = armadores</span>
              </div>
              {/* Map */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <MapFloor
                  codes={zones.map((z) => z.code)}
                  positions={positions}
                  setPositions={setPositions}
                  editable={false}
                  colorOf={colorOf}
                  ownerOf={ownerOf}
                  activeOf={activeOf}
                  statusOf={statusOf}
                  onSelect={() => {}}
                />
              </div>
            </div>
          )}

          {view === "chart" && analytics && <ChartView analytics={analytics} />}

          {view === "ranking" && analytics && <RankingView analytics={analytics} />}
        </div>

        {/* Right: Live Feed + Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
          {/* Mini status */}
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--faint)", letterSpacing: ".06em", marginBottom: 8 }}>RESUMEN RAPIDO</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[
                { label: "Activas", value: active, color: "var(--s-active)", icon: "●" },
                { label: "Completadas", value: done, color: "var(--s-done)", icon: "✓" },
                { label: "Pausadas", value: paused, color: "var(--s-paused)", icon: "⏸" },
                { label: "Incidencias", value: incidents, color: "var(--s-inc)", icon: "✕" },
              ].map((s) => (
                <div key={s.label} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--panel2)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: s.color, fontSize: 14 }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}><AnimNum target={s.value} /></div>
                    <div style={{ fontSize: 9, color: "var(--faint)" }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Efficiency gauge */}
          {analytics && (
            <div className="panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--faint)", letterSpacing: ".06em", marginBottom: 8 }}>EFICIENCIA OPERATIVA</div>
              <GaugeLarge value={analytics.avgEfficiency} />
            </div>
          )}

          {/* Live feed */}
          <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexShrink: 0 }}>
              <span className="live" style={{ fontSize: 9 }}><span className="pulse" />ACTIVIDAD</span>
              <span style={{ fontSize: 9, color: "var(--faint)" }}>{events.length} eventos</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {events.slice(0, 30).map((ev, i) => (
                <div key={ev.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6,
                  background: i === 0 ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                  animation: i === 0 ? "fadeInUp .3s ease" : undefined,
                  transition: "background .3s",
                }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{evIcon(ev.type)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.message}</div>
                    <div style={{ fontSize: 8, color: "var(--faint)" }}>{ev.armador}</div>
                  </div>
                  <span style={{ fontSize: 8, color: "var(--faint)", fontFamily: "var(--mono)", flexShrink: 0 }}>
                    {ev.time.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CHART VIEW
   ═══════════════════════════════════════════════════════════════════════════════ */

function ChartView({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const maxTime = Math.max(...analytics.zones.map((z) => z.actualMinutes), 15, 1);
  const maxProd = Math.max(...analytics.zones.map((z) => z.totalProducts), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, height: "100%" }}>
      {/* Time chart */}
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Tiempo por zona vs Objetivo (15 min)</div>
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 3, borderBottom: "1px solid var(--line)", position: "relative" }}>
          <div style={{ position: "absolute", bottom: Math.round((15 / maxTime) * 100) + "%", left: 0, right: 0, borderTop: "2px dashed var(--accent)", opacity: 0.5 }} />
          {analytics.zones.slice(0, 20).map((z, i) => {
            const h = (z.actualMinutes / maxTime) * 100;
            const c = z.actualMinutes > 15 ? "var(--s-inc)" : z.actualMinutes > 10 ? "var(--s-paused)" : "var(--s-done)";
            return (
              <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 7, fontWeight: 700, marginBottom: 1 }}>{z.actualMinutes}</span>
                <div style={{ width: "100%", height: `${h}%`, minHeight: 3, borderRadius: "3px 3px 0 0", background: c, transition: "height 1s ease" }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
          {analytics.zones.slice(0, 20).map((z) => (
            <div key={z.code} style={{ flex: 1, textAlign: "center", fontSize: 7, color: "var(--faint)", fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</div>
          ))}
        </div>
      </div>

      {/* Product chart */}
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Productos por zona</div>
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 3, borderBottom: "1px solid var(--line)" }}>
          {analytics.zones.filter((z) => z.totalProducts > 0).sort((a, b) => b.totalProducts - a.totalProducts).slice(0, 12).map((z) => {
            const h = (z.totalProducts / maxProd) * 100;
            return (
              <div key={z.code} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 7, fontWeight: 700, marginBottom: 1 }}>{z.totalProducts}</span>
                <div style={{ width: "100%", height: `${h}%`, minHeight: 3, borderRadius: "3px 3px 0 0", background: "linear-gradient(to top, var(--accent), var(--s-done))", transition: "height 1s ease" }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
          {analytics.zones.filter((z) => z.totalProducts > 0).sort((a, b) => b.totalProducts - a.totalProducts).slice(0, 12).map((z) => (
            <div key={z.code} style={{ flex: 1, textAlign: "center", fontSize: 7, color: "var(--faint)", fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</div>
          ))}
        </div>
      </div>

      {/* Donut */}
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Distribucion de estados</div>
        <DonutRing segments={[
          { value: analytics.doneCount, color: "var(--s-done)", label: "Completadas" },
          { value: analytics.activeCount, color: "var(--s-active)", label: "En proceso" },
          { value: analytics.incidentCount, color: "var(--s-inc)", label: "Incidencias" },
          { value: analytics.idleCount, color: "var(--s-idle)", label: "Pendientes" },
        ]} size={160} />
      </div>

      {/* Score distribution */}
      <div className="panel" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Score por zona</div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {analytics.zones.sort((a, b) => b.score - a.score).slice(0, 8).map((z) => (
            <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 32, fontSize: 9, fontWeight: 600, fontFamily: "var(--mono)", textAlign: "right" }}>{z.code.replace(/^.*_/, "")}</span>
              <div style={{ flex: 1, height: 16, background: "var(--panel2)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                <div style={{ width: `${z.score}%`, height: "100%", background: z.score >= 70 ? "var(--s-done)" : z.score >= 40 ? "var(--s-paused)" : "var(--s-inc)", borderRadius: 4, transition: "width 1s ease" }} />
              </div>
              <span style={{ width: 24, fontSize: 9, fontWeight: 700, fontFamily: "var(--mono)", textAlign: "right" }}>{z.score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   RANKING VIEW
   ═══════════════════════════════════════════════════════════════════════════════ */

function RankingView({ analytics }: { analytics: ZoneAnalyticsSummary }) {
  const sorted = [...analytics.zones].sort((a, b) => b.score - a.score);
  return (
    <div className="panel" style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Ranking de Zonas por Score</div>
      {/* Podium */}
      {sorted.length >= 3 && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 12, marginBottom: 20 }}>
          {[sorted[1], sorted[0], sorted[2]].map((z, i) => {
            const h = i === 1 ? 100 : i === 0 ? 75 : 60;
            const medal = i === 1 ? "\u{1F947}" : i === 0 ? "\u{1F948}" : "\u{1F949}";
            const label = i === 1 ? "1ro" : i === 0 ? "2do" : "3ro";
            return (
              <div key={z.code} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>{z.code.replace(/^.*_/, "")}</div>
                <div style={{ fontSize: 20 }}>{medal}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--tx)" }}>{z.score}</div>
                <div style={{ width: 60, height: h, background: `linear-gradient(to top, ${i === 1 ? "var(--accent)" : i === 0 ? "var(--s-done)" : "var(--s-paused)"}, transparent)`, borderRadius: "8px 8px 0 0", marginTop: 4, opacity: 0.8 }} />
                <div style={{ fontSize: 9, color: "var(--faint)", marginTop: 4 }}>{label}</div>
              </div>
            );
          })}
        </div>
      )}
      {/* Full list */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {sorted.map((z, i) => (
          <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, marginBottom: 4, background: i < 3 ? "color-mix(in srgb, var(--accent) 5%, transparent)" : "transparent" }}>
            <span style={{ width: 24, fontSize: 12, fontWeight: 800, color: i === 0 ? "var(--accent)" : i === 1 ? "var(--s-done)" : i === 2 ? "var(--s-paused)" : "var(--faint)" }}>#{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}>{z.code.replace(/^.*_/, "")}</span>
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: z.status === "done" ? "color-mix(in srgb, var(--s-done) 12%, transparent)" : z.status === "active" ? "color-mix(in srgb, var(--s-active) 12%, transparent)" : "var(--panel2)", color: z.status === "done" ? "var(--s-done)" : z.status === "active" ? "var(--s-active)" : "var(--faint)", fontWeight: 600 }}>{z.status === "done" ? "Listo" : z.status === "active" ? "Activo" : z.status === "incident" ? "Incidencia" : "Pend"}</span>
            <span style={{ width: 40, textAlign: "right", fontSize: 12, fontWeight: 700 }}>{z.score}</span>
            <div style={{ width: 60 }}>
              <div style={{ height: 6, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${z.efficiency}%`, height: "100%", background: z.efficiency >= 80 ? "var(--s-done)" : z.efficiency >= 50 ? "var(--s-paused)" : "var(--s-inc)", borderRadius: 3 }} />
              </div>
            </div>
            <span style={{ width: 40, textAlign: "right", fontSize: 10, fontFamily: "var(--mono)", color: z.efficiency >= 80 ? "var(--s-done)" : "var(--s-inc)" }}>{z.efficiency}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════════ */

function AnimNum({ target, dur = 500 }: { target: number; dur?: number }) {
  const v = useAnim(target, dur);
  return <>{v}</>;
}

function ProgressRing({ value, size }: { value: number; size: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 100); return () => clearTimeout(t); }, []);
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const deg = (value / 100) * circ;
  const color = value >= 70 ? "var(--s-done)" : value >= 40 ? "var(--s-paused)" : "var(--s-inc)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel2)" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={mounted ? `${deg} ${circ - deg}` : `0 ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 1s cubic-bezier(.22,1,.36,1)" }} />
    </svg>
  );
}

function GaugeLarge({ value }: { value: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 200); return () => clearTimeout(t); }, []);
  const deg = (value / 100) * 180;
  const animVal = useAnim(Math.round(value), 800);
  const color = value >= 70 ? "var(--s-done)" : value >= 40 ? "var(--s-paused)" : "var(--s-inc)";
  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 120 65" style={{ width: 120, height: 65, margin: "0 auto" }}>
        <path d="M 5 60 A 55 55 0 0 1 115 60" fill="none" stroke="var(--panel2)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 5 60 A 55 55 0 0 1 115 60" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={mounted ? `${deg} 180` : "0 180"} style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.22,1,.36,1)" }} />
        <text x="60" y="50" textAnchor="middle" style={{ fontSize: 24, fontWeight: 800, fill: "var(--tx)" }}>{animVal}%</text>
      </svg>
      <div style={{ fontSize: 9, color: "var(--faint)", marginTop: 2 }}>
        {value >= 80 ? "Excelente" : value >= 60 ? "Bueno" : value >= 40 ? "Regular" : "Critico"}
      </div>
    </div>
  );
}

function DonutRing({ segments, size }: { segments: { value: number; color: string; label: string }[]; size: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 200); return () => clearTimeout(t); }, []);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--panel2)" }} />;
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dl = pct * circ;
          const doff = -(acc / total) * circ;
          acc += seg.value;
          return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth="14"
            strokeDasharray={mounted ? `${dl} ${circ - dl}` : `0 ${circ}`} strokeDashoffset={doff}
            style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.22,1,.36,1)" }} />;
        })}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" style={{ fontSize: 20, fontWeight: 800, fill: "var(--tx)" }}>{total}</text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" style={{ fontSize: 9, fill: "var(--faint)" }}>total</text>
      </svg>
      <div style={{ display: "grid", gap: 4 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            <span style={{ fontSize: 10, color: "var(--mut)" }}>{seg.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function evIcon(t: string) {
  const m: Record<string, string> = { scan: "🔍", start: "▶️", pause: "⏸️", resume: "▶️", complete: "✅", alert: "⚠️" };
  return m[t] || "ℹ️";
}
