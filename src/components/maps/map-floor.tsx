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
 * Incluye zoom (acercar/alejar el plano) y un tooltip que se voltea hacia
 * abajo cuando la zona está muy arriba y no hay espacio para mostrarlo
 * arriba de la zona — ambos "de fábrica" para cualquiera que use este
 * componente (mapa del admin y mini-mapa del armador por igual).
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { Pos, ZonePriority } from "@/types";

const TILE_W = 96;
const TILE_H = 72;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

interface MapFloorProps {
  codes: string[];
  positions: Record<string, Pos>;
  setPositions: (p: Record<string, Pos>) => void;
  /** Se llama al soltar el arrastre (pointerup), con la posición final — úsalo para persistir. */
  onPositionCommit?: (code: string, pos: Pos) => void;
  editable: boolean;
  colorOf: (code: string) => string;
  ownerOf: (code: string) => string;
  activeOf?: (code: string) => boolean;
  /** Devuelve la prioridad de la zona (si tiene una), para mostrar un aviso visual en el tile. */
  priorityOf?: (code: string) => ZonePriority | undefined;
  selected?: string;
  onSelect: (code: string) => void;
  /** Contenido del tooltip que aparece justo arriba (o abajo, si no hay espacio) de la zona al pasar el cursor (o al tocarla en pantallas táctiles). */
  tooltipOf?: (code: string) => React.ReactNode | null;
  /** Si se indica, el plano se centra solo (con scroll suave) en esta zona al montar o cuando cambia — útil para mostrarle al armador dónde queda la próxima zona sin que tenga que buscarla arrastrando el mapa. */
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
          {codes.map((code) => {
            const col = colorOf(code);
            const pos = positions[code] || { x: 0, y: 0 };
            const active = activeOf ? activeOf(code) : false;
            const priority = priorityOf ? priorityOf(code) : undefined;
            return (
              <div
                key={code}
                className={"zone" + (!editable ? " clk" : "") + (selected === code ? " sel" : "") + (active ? " active" : "")}
                style={{ left: pos.x, top: pos.y }}
                onPointerDown={(e) => down(e, code)}
                onPointerEnter={() => handleEnter(code, pos)}
                onPointerLeave={() => handleLeave(code)}
              >
                {priority === "alta" && <span className="zone-prio" title="Prioridad alta">!</span>}
                <span className="strip" style={{ background: col }} />
                <span className="sdot" style={{ background: col, color: col }} />
                <div className="code mono">{code}</div>
                <div className="who">{ownerOf(code)}</div>
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
