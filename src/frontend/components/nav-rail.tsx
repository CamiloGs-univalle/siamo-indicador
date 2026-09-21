"use client";

/**
 * @file frontend/components/nav-rail.tsx
 * @description Barra lateral flotante "Siamo" — pastilla blanca que se
 * desliza junto al ítem activo, con el recorte (notch) trazado a mano en un
 * <path> SVG para que el borde de la barra se curve alrededor de la pastilla
 * en vez de mostrar un corte recto.
 *
 * Responsive: por debajo de NARROW_BP la barra queda SIEMPRE encogida
 * (icon-rail) sin importar la preferencia guardada, y esto se reevalúa en
 * vivo con un listener de resize — no solo al montar — así que cambiar el
 * ancho de la ventana la reacomoda de inmediato. El ancho "efectivo" (el que
 * de verdad se está pintando) se reporta al padre por onCollapsedChange para
 * que el contenido reserve exactamente ese espacio con --navrail-w.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { I } from "@/frontend/components/icons";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeMembretes } from "@/frontend/services/firestore";
import type { Membrete } from "@/types";

type IconCmp = React.FC<React.SVGProps<SVGSVGElement>>;
type NavEntry = [id: string, label: string, Icon: IconCmp, section?: string];

const NAV: NavEntry[] = [
  ["pantalla", "Pantalla en vivo", I.monitor, "PROYECCIÓN"],
  ["carga", "Carga SAP", I.upload, "OPERACIÓN DIARIA"],
  ["armador", "Armador", I.users],
  ["zonas", "Zonas", I.box],
  ["membretes", "Membretes", I.file],
  ["qr", "QR de zonas", I.qr],
  ["mapa", "Mapa en vivo", I.map, "SEGUIMIENTO"],
  ["analiticas", "Analítica", I.chart, "ANÁLISIS"],
  ["indicadores", "Indicadores", I.chart],
  ["desempeno", "Desempeño", I.trophy],
  ["historial", "Historial", I.history],
  ["reportes", "Reportes", I.file],
];

// Geometría de la pastilla y el recorte — idéntica a la referencia.
const RH = 24; // medio-alto de la pastilla
const W_OPEN = 238;
const XC = 4;
const DIP = 32;
const NOTCH = 72;
const R = 26;

// Por debajo de este ancho la barra queda siempre encogida (icon-rail), sin
// importar lo que el usuario haya guardado — deja de caber cómodo el modo
// expandido de 238px en un teléfono.
const NARROW_BP = 720;

const LOCAL_STORAGE_KEY = "siamo:navrail-collapsed";

function buildPath(W: number, H: number, cy: number) {
  const half = NOTCH / 2;
  const b = Math.min(cy + half + 18, H - R);
  const t = Math.max(cy - half - 18, R);
  const b1 = Math.min(cy + half - 8, H - R);
  const b2 = Math.min(cy + half - 2, H - R);
  const t1 = Math.max(cy - half + 2, R);
  const t2 = Math.max(cy - half + 8, R);
  const xd = DIP;
  return (
    `M ${W} 0 L ${W} ${H} L ${R} ${H} Q 0 ${H} 0 ${H - R}` +
    ` L 0 ${b} C 0 ${b1} ${xd} ${b2} ${xd} ${cy}` +
    ` C ${xd} ${t1} 0 ${t2} 0 ${t} L 0 ${R} Q 0 0 ${R} 0 L ${W} 0 Z`
  );
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function NavRail({
  mod,
  setMod,
  onCollapsedChange,
}: {
  mod: string;
  setMod: (m: string) => void;
  /**
   * Se llama con el estado EFECTIVO (la preferencia del usuario Y el
   * encogido forzado por ancho angosto — lo que de verdad se está
   * pintando), para que el contenido reserve exactamente ese espacio.
   * Es de solo lectura desde afuera: el componente maneja su propio
   * estado, así no hay ida y vuelta que lo pueda dejar "pegado".
   */
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const { user } = useAuth();

  // Zonas con al menos una incidencia ABIERTA — igual que en el nav anterior.
  const [openIncidentZones, setOpenIncidentZones] = useState(0);
  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = subscribeMembretes(user.companyId, (membretes: Membrete[]) => {
      const zonesWithOpenIncident = new Set<string>();
      membretes.forEach((m) => {
        const hasOpen = (m.products || []).some((p) => p.status === "incident" && !p.incidentResolvedAt);
        if (hasOpen) zonesWithOpenIncident.add(m.zonaCode);
      });
      setOpenIncidentZones(zonesWithOpenIncident.size);
    });
    return unsub;
  }, [user?.companyId]);

  // Preferencia del usuario (persistida en localStorage) — independiente
  // del forzado por ancho de ventana.
  const [preference, setPreferenceState] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(LOCAL_STORAGE_KEY) === "1") setPreferenceState(true);
    } catch {
      // sigue con el valor por defecto (expandida)
    }
  }, []);

  const setPreference = useCallback((next: boolean) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Modo privado / storage bloqueado: no pasa nada, solo no persiste.
    }
  }, []);

  // Forzado por ancho de ventana — se recalcula en vivo, en cada resize
  // (no solo al montar), así redimensionar la ventana la reacomoda al toque.
  const [forcedNarrow, setForcedNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_BP}px)`);
    const apply = () => setForcedNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Estado que realmente se pinta: angosto gana siempre sobre la preferencia.
  const isCollapsed = forcedNarrow || preference;

  // Reporta al padre el estado EFECTIVO cada vez que cambia — incluido el
  // forzado por ancho — para que el contenido siempre reserve el espacio
  // correcto (--navrail-w), sea cual sea la razón del cambio.
  useEffect(() => {
    onCollapsedChange?.(isCollapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCollapsed]);

  const barRef = useRef<HTMLElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const itemsScrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dimsRef = useRef({ W: W_OPEN, H: 560 });
  const currentCyRef = useRef(200);
  const rafRef = useRef<number | null>(null);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    reduceMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const centerOf = useCallback((id: string) => {
    const el = itemRefs.current[id];
    const bar = barRef.current;
    if (!el || !bar) return currentCyRef.current;
    const r = el.getBoundingClientRect();
    const a = bar.getBoundingClientRect();
    return r.top - a.top + r.height / 2;
  }, []);

  const render = useCallback((cy: number) => {
    const { W, H } = dimsRef.current;
    if (pathRef.current) pathRef.current.setAttribute("d", buildPath(W, H, cy));
    if (pillRef.current) pillRef.current.style.top = `${cy - RH}px`;
  }, []);

  const setPillWidth = useCallback((collapsedNow: boolean) => {
    if (!pillRef.current) return;
    pillRef.current.style.width = collapsedNow ? `${RH * 2}px` : `${W_OPEN - 12 - (XC - RH)}px`;
  }, []);

  const layout = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    dimsRef.current = { W: bar.clientWidth, H: bar.clientHeight };
    currentCyRef.current = centerOf(mod);
    render(currentCyRef.current);
    setPillWidth(isCollapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerOf, render, setPillWidth]);

  const animate = useCallback(
    (from: number, to: number) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (reduceMotionRef.current) {
        currentCyRef.current = to;
        render(to);
        return;
      }
      const dur = 460;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = ease(p);
        const s = Math.sin(p * Math.PI);
        currentCyRef.current = from + (to - from) * e;
        if (pillRef.current) pillRef.current.style.transform = `translateX(${-4 * s}px)`;
        render(currentCyRef.current);
        if (p < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else if (pillRef.current) {
          pillRef.current.style.transform = "";
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [render]
  );

  // Layout inicial.
  useLayoutEffect(() => {
    layout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reacciona al cambio de módulo activo animando la pastilla hasta su nueva posición.
  const prevModRef = useRef(mod);
  useLayoutEffect(() => {
    if (prevModRef.current !== mod) {
      const from = currentCyRef.current;
      prevModRef.current = mod;
      animate(from, centerOf(mod));
    }
  }, [mod, animate, centerOf]);

  // El ancho de la pastilla depende de si está encogida o no — se dispara en
  // el MISMO tick que el ancho de la barra empieza a transicionar por CSS,
  // para que ambas animaciones queden sincronizadas (antes había un retraso
  // de un frame que las desfasaba y se sentía "lento" / a destiempo).
  useLayoutEffect(() => {
    setPillWidth(isCollapsed);
  }, [isCollapsed, setPillWidth]);

  // El ResizeObserver sigue el ancho/alto REAL de la barra en cada frame
  // mientras el CSS anima su `width`, así el recorte del SVG queda siempre
  // sincronizado con la forma real de la barra, sin importar en qué punto
  // de la transición esté.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(() => {
      dimsRef.current = { W: bar.clientWidth, H: bar.clientHeight };
      render(currentCyRef.current);
    });
    ro.observe(bar);
    return () => ro.disconnect();
  }, [render]);

  // La lista de ítems puede tener su propio scroll interno cuando la
  // pantalla no alcanza para mostrarlos todos — si el usuario la desplaza,
  // la pastilla tiene que seguir al ítem activo (sin animación de resorte,
  // solo pegada de una) en vez de quedarse flotando en su lugar viejo.
  useEffect(() => {
    const scroller = itemsScrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      currentCyRef.current = centerOf(mod);
      render(currentCyRef.current);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [centerOf, mod, render]);

  const activeEntry = NAV.find(([id]) => id === mod);
  const ActiveIcon = activeEntry?.[2];

  return (
    <nav
      className="navrail"
      data-collapsed={isCollapsed}
      aria-label="Navegación"
      ref={(el) => { barRef.current = el; }}
    >
      <svg className="navrail-bg" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="navrail-panel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b2e6a" />
            <stop offset="1" stopColor="#12214d" />
          </linearGradient>
        </defs>
        <path ref={(el) => { pathRef.current = el; }} d="" fill="url(#navrail-panel)" />
      </svg>

      <div className="navrail-head">
        <div className="navrail-word"><span className="a">Sia</span><span className="b">mo</span></div>
        {!forcedNarrow && (
          <button
            className="navrail-toggle"
            type="button"
            aria-label={preference ? "Expandir menú" : "Encoger menú"}
            onClick={() => setPreference(!preference)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}
      </div>

      <div className="navrail-items" ref={(el) => { itemsScrollRef.current = el; }}>
        {NAV.map(([id, label, Icon, sec]) => (
          <div key={id}>
            {sec && <div className="navrail-sec">{sec}</div>}
            <button
              ref={(el) => { itemRefs.current[id] = el; }}
              type="button"
              className={"navrail-item" + (mod === id ? " is-active" : "")}
              aria-label={label}
              onClick={() => setMod(id)}
            >
              <span className="ic"><Icon width={23} height={23} /></span>
              <span className="lbl">{label}</span>
              {id === "mapa" && openIncidentZones > 0 && (
                <span className="navrail-badge" title={`${openIncidentZones} zona(s) con incidencia abierta — necesitan atención`}>
                  {openIncidentZones}
                </span>
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="navrail-pill" ref={(el) => { pillRef.current = el; }} aria-hidden="true">
        <span className="ico">{ActiveIcon && <ActiveIcon width={23} height={23} />}</span>
      </div>
    </nav>
  );
}
