/**
 * @file components/maps/map-floor.tsx
 * @description Componente de mapa de planta con zonas arrastrables.
 * Muestra las zonas en un plano interactivo con soporte de edición.
 *
 * Totalmente controlado por props — no importa el dataset de ejemplo.
 * Tanto el modo demo (`mod-mapa.tsx` → `ModMapaDemo`) como el modo real
 * (`ModMapaReal`, con datos de Firestore) le pasan sus propias funciones
 * `colorOf`/`ownerOf`/`activeOf`, así que este componente no necesita
 * saber si las zonas vienen del dataset mock o de la base de datos.
 *
 * Incluye zoom (acercar/alejar el plano), un ajuste automático que encuadra
 * todas las zonas visibles dentro del contenedor apenas cambia el conjunto
 * de zonas (por ejemplo al cambiar de sector), y un tooltip que se voltea
 * hacia abajo cuando la zona está muy arriba y no hay espacio para
 * mostrarlo arriba — todo "de fábrica" para cualquiera que use este
 * componente (mapa del admin y mini-mapa del armador por igual).
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { Pos, ZonePriority } from "@/types";
import { fullWarehouseLayout, positionTypeColor } from "@/lib/warehouse-layout";

// Debe coincidir con el tamaño real del tile en CSS (.zone{width:120px;height:72px}) —
// antes decía 96 y desalineaba el centrado automático (focusCode) y el límite de arrastre.
const TILE_W = 120;
const TILE_H = 72;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;
// El encuadre automatico nunca reduce el zoom mas alla de esto por su
// cuenta -- textos/codigos de zona ilegibles no sirven de nada aunque
// "quepa todo". Si de verdad hace falta ver mas de una vez, el boton
// manual de alejar (hasta ZOOM_MIN) sigue disponible.
const MIN_FIT_ZOOM = 0.7;

// Colores fijos de la "bolita" de estado (la del tiempo real) — deben ser
// exactamente los mismos que usa la leyenda (mod-mapa.tsx: Sin asignar/
// Completada/En proceso/Pausada/Incidencia) y las variables --s-* de
// globals.css. A propósito NUNCA se mezclan con el color del armador.
const STATUS_DOT_COLOR: Record<string, string> = {
  idle: "var(--s-idle)",
  assigned: "var(--s-assigned)",
  active: "var(--s-active)",
  paused: "var(--s-paused)",
  done: "var(--s-done)",
  incident: "var(--s-inc)",
};

interface MapFloorProps {
  codes: string[];
  positions: Record<string, Pos>;
  setPositions: (p: Record<string, Pos>) => void;
  onPositionCommit?: (code: string, pos: Pos) => void;
  editable: boolean;
  colorOf: (code: string) => string;
  ownerOf: (code: string) => string;
  activeOf?: (code: string) => boolean;
  /** Devuelve el status display de la zona (para el indicador visual). */
  statusOf?: (code: string) => string;
  priorityOf?: (code: string) => ZonePriority | undefined;
  selected?: string;
  onSelect: (code: string) => void;
  tooltipOf?: (code: string) => React.ReactNode | null;
  focusCode?: string;
}

export function MapFloor({
  codes,
  positions,
  setPositions,
  onPositionCommit,
  editable,
  colorOf,
  ownerOf,
  activeOf,
  statusOf,
  priorityOf,
  selected,
  onSelect,
  tooltipOf,
  focusCode,
}: MapFloorProps) {
  const [hover, setHover] = useState<{ code: string; below: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ code: string; dx: number; dy: number } | null>(null);
  const posRef = useRef(positions);
  posRef.current = positions;
  const fitCodesKeyRef = useRef<string>("");

  // ─── Encuadre automático ────────────────────────────────────────────
  // Cada vez que cambia el conjunto de zonas a mostrar (p. ej. el armador
  // cambia de sector, o este componente se monta de nuevo para la siguiente
  // zona), calculamos el rectángulo real que ocupan esas zonas y ajustamos
  // el zoom para que quepan completas y bien proporcionadas en el
  // contenedor — nunca las acerca de más (como mucho deja el zoom en
  // 100%), solo aleja lo necesario cuando el plano es más grande que el
  // espacio disponible. Así el mini-mapa del armador (chico, en el celular)
  // y el mapa grande del admin siempre se ven "a la medida" sin que
  // tengamos que adivinar el tamaño real de la bodega de cada empresa.
  useEffect(() => {
    const codesKey = codes.join(",");
    if (codesKey === fitCodesKeyRef.current) return;
    fitCodesKeyRef.current = codesKey;
    const el = ref.current;
    if (!el || codes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    codes.forEach((code) => {
      const p = posRef.current[code] || { x: 0, y: 0 };
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + TILE_W);
      maxY = Math.max(maxY, p.y + TILE_H);
    });
    if (!isFinite(minX)) return;

    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const availW = el.clientWidth;
    const availH = el.clientHeight;
    if (availW === 0 || availH === 0) return;

    // 0.92 deja un margen alrededor para que ninguna zona quede pegada al borde.
    const fit = Math.min(1, (availW / contentW) * 0.92, (availH / contentH) * 0.92);
    const newZoom = Math.max(MIN_FIT_ZOOM, Math.min(ZOOM_MAX, Math.round(fit * 100) / 100));
    setZoom(newZoom);

    // Se deja para el siguiente frame: el zoom recién aplicado cambia el
    // tamaño real del contenido (scrollWidth/scrollHeight) y necesitamos
    // ese tamaño ya actualizado para centrar el scroll correctamente.
    requestAnimationFrame(() => {
      el.scrollTo({
        left: Math.max(0, minX * newZoom - (availW - contentW * newZoom) / 2),
        top: Math.max(0, minY * newZoom - (availH - contentH * newZoom) / 2),
        behavior: "auto",
      });
    });
    // Solo nos importa CUÁLES zonas se muestran, no sus posiciones exactas
    // (eso se lee de posRef.current en el momento) — si dependiera de
    // "positions" se re-encuadraría en cada arrastre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes]);

  useEffect(() => {
    if (!focusCode || !ref.current) return;
    const pos = posRef.current[focusCode];
    if (!pos) return;
    const el = ref.current;
    el.scrollTo({
      left: Math.max(0, pos.x * zoom - el.clientWidth / 2 + (TILE_W * zoom) / 2),
      top: Math.max(0, pos.y * zoom - el.clientHeight / 2 + (TILE_H * zoom) / 2),
      behavior: "smooth",
    });
    // Solo cuando cambia la zona a enfocar o el zoom (no en cada actualización de posiciones).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCode, zoom]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      let x = (e.clientX - r.left + ref.current.scrollLeft) / zoom - d.dx;
      let y = (e.clientY - r.top + ref.current.scrollTop) / zoom - d.dy;
      const maxX = Math.max(r.width, ref.current.scrollWidth) / zoom - TILE_W - 4;
      x = Math.max(4, Math.min(x, maxX));
      y = Math.max(4, y);
      setPositions({ ...posRef.current, [d.code]: { x, y } });
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d && onPositionCommit) {
        const p = posRef.current[d.code];
        if (p) onPositionCommit(d.code, p);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [setPositions, onPositionCommit, zoom]);

  const down = (e: React.PointerEvent, code: string) => {
    onSelect(code);
    setHover(null);
    if (!editable || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const p = positions[code] || { x: 0, y: 0 };
    const mx = (e.clientX - r.left + ref.current.scrollLeft) / zoom;
    const my = (e.clientY - r.top + ref.current.scrollTop) / zoom;
    drag.current = { code, dx: mx - p.x, dy: my - p.y };
    e.preventDefault();
  };

  // Si la zona está muy cerca del borde superior visible del plano, no hay
  // espacio para el tooltip arriba — lo mostramos abajo en su lugar.
  const handleEnter = (code: string, pos: Pos) => {
    let below = false;
    if (ref.current) {
      const visualY = pos.y * zoom - ref.current.scrollTop;
      below = visualY < 160;
    }
    setHover({ code, below });
  };
  const handleLeave = (code: string) => {
    setHover((h) => (h && h.code === code ? null : h));
  };

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
  const zoomReset = () => setZoom(1);

  const hoverPos = hover ? positions[hover.code] || { x: 0, y: 0 } : null;
  const tooltipContent = hover && tooltipOf && !drag.current ? tooltipOf(hover.code) : null;

  return (
    <div className="floor-wrap">
      <div className={"floor" + (editable ? " edit" : "")} ref={ref}>
        <div className="floor-zoom" style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
          {/* Warehouse layout reference grid (background) */}
          {!editable && fullWarehouseLayout().filter((p) => p.type !== "PASILLO").map((wp) => (
            <div
              key={wp.code}
              style={{
                position: "absolute",
                left: wp.x,
                top: wp.y,
                width: wp.w,
                height: wp.h,
                border: `1px dashed ${positionTypeColor(wp.type)}`,
                borderRadius: 4,
                opacity: 0.15,
                pointerEvents: "none",
              }}
              title={`${wp.code} (${wp.type})`}
            />
          ))}

          {/* Zone tiles */}
          {codes.map((code) => {
            const col = colorOf(code);
            const pos = positions[code] || { x: 0, y: 0 };
            const active = activeOf ? activeOf(code) : false;
            const priority = priorityOf ? priorityOf(code) : undefined;
            const zoneStatus = statusOf ? statusOf(code) : "idle";
            // La "bolita" de estado SIEMPRE usa el color fijo del estado
            // (el mismo de la leyenda: Sin asignar/Completada/En proceso/
            // Pausada/Incidencia) — NUNCA el color propio del armador. El
            // color del armador (colorOf/col) queda solo para la franja
            // izquierda (.strip), que es la que identifica "quién" trabaja
            // la zona. La bolita es la que dice "qué está pasando" en tiempo
            // real, y por eso no puede cambiar según quién esté asignado.
            const statusCol = STATUS_DOT_COLOR[zoneStatus] || STATUS_DOT_COLOR.idle;
            return (
              <div
                key={code}
                className={"zone" + (!editable ? " clk" : "") + (selected === code ? " sel" : "") + (active ? " active" : "") + " " + zoneStatus}
                style={{ left: pos.x, top: pos.y }}
                onPointerDown={(e) => down(e, code)}
                onPointerEnter={() => handleEnter(code, pos)}
                onPointerLeave={() => handleLeave(code)}
              >
                {priority === "alta" && <span className="zone-prio" title="Prioridad alta">!</span>}
                <span className="strip" style={{ background: col }} />
                {/* Bolita de estado: color fijo por estado (ver STATUS_DOT_COLOR),
                    igual a la leyenda. El anillo/brillo extra viene de la clase de
                    estado (zoneStatus) que ya llega en className — ver .zone.* .sdot
                    en globals.css. */}
                <span className="sdot" style={{ background: statusCol, color: statusCol }} />
                <div className="code mono">{code}</div>
                <div className="who" title={ownerOf(code)}>{ownerOf(code)}</div>
              </div>
            );
          })}
        </div>

        {tooltipContent && hoverPos && hover && (
          /* Fuera de la capa con zoom, para que el texto no crezca/encoja con el plano;
             se posiciona en coordenadas visuales (ya multiplicadas por el zoom). */
          <div
            className={"zone-tooltip" + (hover.below ? " below" : "")}
            style={{
              left: hoverPos.x * zoom,
              top: hover.below ? hoverPos.y * zoom + TILE_H * zoom + 10 : hoverPos.y * zoom,
            }}
            onPointerEnter={() => setHover(hover)}
            onPointerLeave={() => setHover((h) => (h && hover && h.code === hover.code ? null : h))}
          >
            {tooltipContent}
          </div>
        )}
      </div>

      <div className="floor-zoom-controls">
        <button type="button" className="btn ghost sm" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Alejar">
          −
        </button>
        <button type="button" className="btn ghost sm zoom-pct" onClick={zoomReset} title="Restablecer zoom">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="btn ghost sm" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Acercar">
          +
        </button>
      </div>
    </div>
  );
}
