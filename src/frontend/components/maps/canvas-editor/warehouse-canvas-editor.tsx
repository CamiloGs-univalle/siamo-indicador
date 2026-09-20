/**
 * @file components/maps/canvas-editor/warehouse-canvas-editor.tsx
 * @description Editor de mapa de almacén tipo canvas con react-konva.
 *
 * Permite al administrador dibujar zonas visualmente:
 * - Rectángulos, círculos, líneas, flechas y texto
 * - Arrastrar y redimensionar formas
 * - Snap-to-grid para alineación
 * - Pan/zoom para navegar planos grandes
 * - Guardar/cargar layout desde Firestore
 *
 * Usa next/dynamic con ssr:false porque konva usa window/document.
 */

"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Circle, Line, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { CanvasShape, ShapeTool } from "./types";
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, DEFAULT_GRID_SIZE } from "./types";
import { CanvasToolbar } from "./canvas-toolbar";

interface WarehouseCanvasEditorProps {
  /** Formas iniciales (cargadas de Firestore) */
  initialShapes?: CanvasShape[];
  /** Callback cuando cambian las formas (para guardar) */
  onShapesChange?: (shapes: CanvasShape[]) => void;
  /** Zonas existentes de Firestore (para overlay) */
  zoneColors?: Record<string, string>;
  /** Ancho del canvas */
  width?: number;
  /** Alto del canvas */
  height?: number;
}

let idCounter = 0;
const genId = () => `shape_${Date.now()}_${idCounter++}`;

export function WarehouseCanvasEditor({
  initialShapes = [],
  onShapesChange,
  zoneColors: _zoneColors = {},
  width = 1200,
  height = 700,
}: WarehouseCanvasEditorProps) {
  const [shapes, setShapes] = useState<CanvasShape[]>(initialShapes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<ShapeTool>("select");
  const [gridSize, setGridSize] = useState(DEFAULT_GRID_SIZE);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stageRef = useRef<Konva.Stage>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<Konva.Layer>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sincronizar con initialShapes
  useEffect(() => {
    if (initialShapes.length > 0 && shapes.length === 0) {
      setShapes(initialShapes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShapes]);

  // Notificar cambios
  useEffect(() => {
    if (onShapesChange && shapes.length > 0) {
      onShapesChange(shapes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes]);

  // Snap to grid
  const snapToGrid = useCallback((val: number) => {
    return Math.round(val / gridSize) * gridSize;
  }, [gridSize]);

  // Coordenadas del mouse relativas al stage
  const getPointerPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    return {
      x: (pos.x - panX) / zoom,
      y: (pos.y - panY) / zoom,
    };
  }, [zoom, panX, panY]);

  // ─── Mouse handlers ───────────────────────────────────────────────
  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.getParent() === layerRef.current;

    if (tool === "select") {
      if (clickedOnEmpty) {
        setSelectedId(null);
      }
      // Pan con middle click o space+click
      if (e.evt.button === 1 || (e.evt.altKey && clickedOnEmpty)) {
        setIsPanning(true);
        return;
      }
      return;
    }

    // Herramientas de dibujo
    const pos = getPointerPos();
    const sx = snapToGrid(pos.x);
    const sy = snapToGrid(pos.y);

    if (tool === "text") {
      const label = window.prompt("Texto de la zona:", "Zona");
      if (label) {
        const newShape: CanvasShape = {
          id: genId(),
          type: "text",
          x: sx,
          y: sy,
          fill: "var(--ink, #1a1a2e)",
          stroke: "transparent",
          strokeWidth: 0,
          label,
          fontSize: 16,
          rotation: 0,
          draggable: true,
        };
        setShapes((prev) => [...prev, newShape]);
        setSelectedId(newShape.id);
      }
      setTool("select");
      return;
    }

    // Iniciar dibujo de rect, circle, line, arrow
    setIsDrawing(true);
    setDrawStart({ x: sx, y: sy });

    if (tool === "line" || tool === "arrow") {
      const newShape: CanvasShape = {
        id: genId(),
        type: tool === "arrow" ? "arrow" : "line",
        x: sx,
        y: sy,
        points: [0, 0, 0, 0],
        fill: "transparent",
        stroke: DEFAULT_SHAPE_STROKE,
        strokeWidth: 2,
        rotation: 0,
        draggable: true,
      };
      setShapes((prev) => [...prev, newShape]);
      setSelectedId(newShape.id);
    }
  }, [tool, getPointerPos, snapToGrid]);

  const handleMouseMove = useCallback(() => {
    if (!isDrawing || !drawStart) return;

    const pos = getPointerPos();
    const ex = snapToGrid(pos.x);
    const ey = snapToGrid(pos.y);

    if (tool === "rect") {
      const newShape: CanvasShape = {
        id: genId(),
        type: "rect",
        x: Math.min(drawStart.x, ex),
        y: Math.min(drawStart.y, ey),
        width: Math.abs(ex - drawStart.x),
        height: Math.abs(ey - drawStart.y),
        fill: DEFAULT_SHAPE_FILL,
        stroke: DEFAULT_SHAPE_STROKE,
        strokeWidth: 2,
        rotation: 0,
        draggable: true,
      };
      setShapes((prev) => {
        const filtered = prev.filter((s) => s.id !== selectedId);
        return [...filtered, newShape];
      });
      setSelectedId(newShape.id);
    } else if (tool === "circle") {
      const dx = ex - drawStart.x;
      const dy = ey - drawStart.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const newShape: CanvasShape = {
        id: genId(),
        type: "circle",
        x: drawStart.x,
        y: drawStart.y,
        radius,
        fill: DEFAULT_SHAPE_FILL,
        stroke: DEFAULT_SHAPE_STROKE,
        strokeWidth: 2,
        rotation: 0,
        draggable: true,
      };
      setShapes((prev) => {
        const filtered = prev.filter((s) => s.id !== selectedId);
        return [...filtered, newShape];
      });
      setSelectedId(newShape.id);
    } else if ((tool === "line" || tool === "arrow") && selectedId) {
      setShapes((prev) =>
        prev.map((s) =>
          s.id === selectedId
            ? { ...s, points: [0, 0, ex - drawStart.x, ey - drawStart.y] }
            : s
        )
      );
    }
  }, [isDrawing, drawStart, tool, getPointerPos, snapToGrid, selectedId]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      setDrawStart(null);
      if (tool !== "select") {
        setTool("select");
      }
    }
    if (isPanning) {
      setIsPanning(false);
    }
  }, [isDrawing, isPanning, tool]);

  // Pan con rueda del mouse
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - panX) / oldScale,
      y: (pointer.y - panY) / oldScale,
    };

    const direction = e.evt.deltaY < 0 ? 1 : -1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.2, Math.min(5, newScale));

    setZoom(clampedScale);
    setPanX(pointer.x - mousePointTo.x * clampedScale);
    setPanY(pointer.y - mousePointTo.y * clampedScale);
  }, [zoom, panX, panY]);

  // ─── Shape drag end ──────────────────────────────────────────────
  const handleDragEnd = useCallback((id: string, e: KonvaEventObject<DragEvent>) => {
    const shape = shapes.find((s) => s.id === id);
    if (!shape) return;

    const newX = snapToGrid(e.target.x());
    const newY = snapToGrid(e.target.y());

    setShapes((prev) =>
      prev.map((s) => (s.id === id ? { ...s, x: newX, y: newY } : s))
    );
  }, [shapes, snapToGrid]);

  // ─── Transformer update ──────────────────────────────────────────
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;

    if (selectedId) {
      const node = stage.findOne(`#${selectedId}`);
      if (node) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
      }
    } else {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
    }
  }, [selectedId]);

  // ─── Delete selected ─────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    setShapes((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        handleDelete();
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete]);

  // ─── Grid lines ──────────────────────────────────────────────────
  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    const lines = [];
    const w = width / zoom + 200;
    const h = height / zoom + 200;
    for (let i = -100; i < w; i += gridSize) {
      lines.push(
        <Line key={`v${i}`} points={[i, -100, i, h]} stroke="#e5e7eb" strokeWidth={0.5} />
      );
    }
    for (let i = -100; i < h; i += gridSize) {
      lines.push(
        <Line key={`h${i}`} points={[-100, i, w, i]} stroke="#e5e7eb" strokeWidth={0.5} />
      );
    }
    return lines;
  }, [showGrid, gridSize, width, height, zoom]);

  // ─── Render shapes ───────────────────────────────────────────────
  const renderShape = (shape: CanvasShape) => {
    const isSelected = shape.id === selectedId;
    const commonProps = {
      id: shape.id,
      key: shape.id,
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      draggable: shape.draggable && tool === "select",
      onClick: () => setSelectedId(shape.id),
      onDragEnd: (e: KonvaEventObject<DragEvent>) => handleDragEnd(shape.id, e),
      stroke: isSelected ? "#3b82f6" : shape.stroke,
      strokeWidth: isSelected ? 3 : shape.strokeWidth,
    };

    switch (shape.type) {
      case "rect":
        return (
          <Rect
            {...commonProps}
            width={shape.width || 100}
            height={shape.height || 60}
            fill={shape.fill}
            cornerRadius={4}
          />
        );
      case "circle":
        return (
          <Circle
            {...commonProps}
            radius={shape.radius || 30}
            fill={shape.fill}
          />
        );
      case "line":
        return (
          <Line
            {...commonProps}
            points={shape.points || [0, 0, 100, 0]}
            tension={0}
            lineCap="round"
          />
        );
      case "arrow":
        return (
          <Line
            {...commonProps}
            points={shape.points || [0, 0, 100, 0]}
            tension={0}
            lineCap="round"
            pointerLength={10}
            pointerWidth={10}
            fill={shape.stroke}
          />
        );
      case "text":
        return (
          <Text
            {...commonProps}
            text={shape.label || "Zona"}
            fontSize={shape.fontSize || 16}
            fill={shape.fill}
            padding={4}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--panel)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)" }}>
      {/* Toolbar */}
      <CanvasToolbar
        tool={tool}
        onToolChange={setTool}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(!showGrid)}
        gridSize={gridSize}
        onGridSizeChange={setGridSize}
        zoom={zoom}
        onZoomChange={setZoom}
        onDelete={handleDelete}
        selectedId={selectedId}
      />

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, overflow: "hidden", cursor: tool === "select" ? (isPanning ? "grabbing" : "default") : "crosshair" }}>
        <Stage
          ref={stageRef}
          width={width}
          height={height}
          scaleX={zoom}
          scaleY={zoom}
          x={panX}
          y={panY}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          <Layer ref={layerRef}>
            {/* Grid */}
            {gridLines}

            {/* Shapes */}
            {shapes.map(renderShape)}

            {/* Transformer for selected shape */}
            <Transformer
              ref={trRef}
              boundBoxFunc={(oldBox: { x: number; y: number; width: number; height: number; rotation: number }, newBox: { x: number; y: number; width: number; height: number; rotation: number }) => {
                if (newBox.width < 20 || newBox.height < 20) return oldBox;
                return newBox;
              }}
            />
          </Layer>
        </Stage>
      </div>

      {/* Status bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--faint)", background: "var(--panel2)" }}>
        <span>{shapes.length} formas</span>
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span>Grid: {gridSize}px</span>
        {selectedId && <span style={{ color: "var(--accent)" }}>Seleccionada: {selectedId}</span>}
        <span style={{ marginLeft: "auto" }}>Arrastra para mover · Shift+click para multi-selección · Delete para borrar</span>
      </div>
    </div>
  );
}
