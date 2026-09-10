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
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { Pos, ZonePriority } from "@/types";

const TILE_W = 96;

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
  /** Contenido del tooltip que aparece justo arriba de la zona al pasar el cursor (o al tocarla en pantallas táctiles). */
  tooltipOf?: (code: string) => React.ReactNode | null;
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
}: MapFloorProps) {
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ code: string; dx: number; dy: number } | null>(null);
  const posRef = useRef(positions);
  posRef.current = positions;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      let x = e.clientX - r.left - d.dx + ref.current.scrollLeft;
      let y = e.clientY - r.top - d.dy + ref.current.scrollTop;
      x = Math.max(4, Math.min(x, Math.max(r.width, ref.current.scrollWidth) - TILE_W - 4));
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
  }, [setPositions, onPositionCommit]);

  const down = (e: React.PointerEvent, code: string) => {
    onSelect(code);
    setHover(null);
    if (!editable || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const p = positions[code] || { x: 0, y: 0 };
    drag.current = {
      code,
      dx: e.clientX - r.left - p.x + ref.current.scrollLeft,
      dy: e.clientY - r.top - p.y + ref.current.scrollTop,
    };
    e.preventDefault();
  };

  return (
    <div className={"floor" + (editable ? " edit" : "")} ref={ref}>
      {codes.map((code) => {
        const col = colorOf(code);
        const pos = positions[code] || { x: 0, y: 0 };
        const active = activeOf ? activeOf(code) : false;
        const priority = priorityOf ? priorityOf(code) : undefined;
        const showTooltip = hover === code && !!tooltipOf && !drag.current;
        return (
          <div key={code}>
            <div
              className={"zone" + (!editable ? " clk" : "") + (selected === code ? " sel" : "") + (active ? " active" : "")}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => down(e, code)}
              onPointerEnter={() => setHover(code)}
              onPointerLeave={() => setHover((h) => (h === code ? null : h))}
            >
              {priority === "alta" && <span className="zone-prio" title="Prioridad alta">!</span>}
              <span className="strip" style={{ background: col }} />
              <span className="sdot" style={{ background: col, color: col }} />
              <div className="code mono">{code}</div>
              <div className="who">{ownerOf(code)}</div>
            </div>
            {showTooltip && (
              /* Fuera del tile (que tiene overflow:hidden) para que no se recorte;
                 se ancla con las mismas coordenadas y se desplaza hacia arriba con transform. */
              <div
                className="zone-tooltip"
                style={{ left: pos.x, top: pos.y }}
                onPointerEnter={() => setHover(code)}
                onPointerLeave={() => setHover((h) => (h === code ? null : h))}
              >
                {tooltipOf!(code)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
