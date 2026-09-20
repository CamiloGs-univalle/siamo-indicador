/**
 * @file components/maps/canvas-editor/canvas-toolbar.tsx
 * @description Toolbar del editor de mapa canvas con herramientas de dibujo.
 */

"use client";

import type { ShapeTool } from "./types";

interface CanvasToolbarProps {
  tool: ShapeTool;
  onToolChange: (tool: ShapeTool) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  gridSize: number;
  onGridSizeChange: (size: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onDelete: () => void;
  selectedId: string | null;
}

const TOOLS: { tool: ShapeTool; label: string; icon: string; shortcut?: string }[] = [
  { tool: "select", label: "Seleccionar", icon: "↖", shortcut: "V" },
  { tool: "rect", label: "Rectángulo", icon: "□", shortcut: "R" },
  { tool: "circle", label: "Círculo", icon: "○", shortcut: "C" },
  { tool: "line", label: "Línea", icon: "╱", shortcut: "L" },
  { tool: "arrow", label: "Flecha", icon: "→", shortcut: "A" },
  { tool: "text", label: "Texto", icon: "T", shortcut: "T" },
];

export function CanvasToolbar({
  tool,
  onToolChange,
  showGrid,
  onToggleGrid,
  gridSize,
  onGridSizeChange,
  zoom,
  onZoomChange,
  onDelete,
  selectedId,
}: CanvasToolbarProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "8px 12px",
      borderBottom: "1px solid var(--line)",
      background: "var(--panel2)",
      flexWrap: "wrap",
    }}>
      {/* Herramientas de dibujo */}
      <div style={{ display: "flex", gap: 2, background: "var(--bg)", borderRadius: 8, padding: 2, border: "1px solid var(--line)" }}>
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            onClick={() => onToolChange(t.tool)}
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "none",
              background: tool === t.tool ? "var(--accent)" : "transparent",
              color: tool === t.tool ? "#fff" : "var(--tx)",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {/* Separador */}
      <div style={{ width: 1, height: 24, background: "var(--line)" }} />

      {/* Grid */}
      <button
        onClick={onToggleGrid}
        title={showGrid ? "Ocultar cuadrícula" : "Mostrar cuadrícula"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid var(--line)",
          background: showGrid ? "var(--accent)" : "var(--bg)",
          color: showGrid ? "#fff" : "var(--tx)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 13 }}>▦</span> Grid
      </button>

      {/* Tamaño de grid */}
      <select
        value={gridSize}
        onChange={(e) => onGridSizeChange(Number(e.target.value))}
        style={{
          padding: "4px 6px",
          borderRadius: 6,
          border: "1px solid var(--line)",
          background: "var(--bg)",
          color: "var(--tx)",
          fontSize: 11,
          fontFamily: "inherit",
        }}
      >
        <option value={10}>10px</option>
        <option value={20}>20px</option>
        <option value={40}>40px</option>
        <option value={50}>50px</option>
      </select>

      {/* Separador */}
      <div style={{ width: 1, height: 24, background: "var(--line)" }} />

      {/* Zoom */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={() => onZoomChange(Math.max(0.2, zoom - 0.1))}
          style={{
            width: 28, height: 28, borderRadius: 6, border: "1px solid var(--line)",
            background: "var(--bg)", color: "var(--tx)", cursor: "pointer",
            fontSize: 14, fontWeight: 700, fontFamily: "inherit",
          }}
        >
          −
        </button>
        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)", minWidth: 40, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => onZoomChange(Math.min(5, zoom + 0.1))}
          style={{
            width: 28, height: 28, borderRadius: 6, border: "1px solid var(--line)",
            background: "var(--bg)", color: "var(--tx)", cursor: "pointer",
            fontSize: 14, fontWeight: 700, fontFamily: "inherit",
          }}
        >
          +
        </button>
        <button
          onClick={() => { onZoomChange(1); }}
          style={{
            padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)",
            background: "var(--bg)", color: "var(--tx)", cursor: "pointer",
            fontSize: 10, fontWeight: 600, fontFamily: "inherit",
          }}
        >
          1:1
        </button>
      </div>

      {/* Separador */}
      <div style={{ width: 1, height: 24, background: "var(--line)" }} />

      {/* Eliminar */}
      <button
        onClick={onDelete}
        disabled={!selectedId}
        title="Eliminar seleccionada (Delete)"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid var(--line)",
          background: selectedId ? "#fef2f2" : "var(--bg)",
          color: selectedId ? "#dc2626" : "var(--faint)",
          cursor: selectedId ? "pointer" : "not-allowed",
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "inherit",
          opacity: selectedId ? 1 : 0.5,
        }}
      >
        <span style={{ fontSize: 13 }}>🗑</span> Eliminar
      </button>
    </div>
  );
}
