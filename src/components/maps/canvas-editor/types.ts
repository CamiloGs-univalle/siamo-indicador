/**
 * @file components/maps/canvas-editor/types.ts
 * @description Tipos para el editor de mapa canvas del almacén.
 */

export type ShapeTool = "select" | "rect" | "circle" | "line" | "text" | "arrow";

export interface CanvasShape {
  id: string;
  type: "rect" | "circle" | "line" | "text" | "arrow";
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: number[];
  fill: string;
  stroke: string;
  strokeWidth: number;
  label?: string;
  fontSize?: number;
  rotation: number;
  draggable: boolean;
  /** Si es una zona asignada a Firestore, su zoneId */
  zoneId?: string;
  /** Código de zona (para zonas reales) */
  zoneCode?: string;
}

export interface CanvasEditorState {
  shapes: CanvasShape[];
  selectedId: string | null;
  tool: ShapeTool;
  gridSize: number;
  showGrid: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_SHAPE_FILL = "rgba(14, 165, 233, 0.15)";
export const DEFAULT_SHAPE_STROKE = "#0EA5E9";
export const DEFAULT_GRID_SIZE = 20;
