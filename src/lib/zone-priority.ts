/**
 * @file lib/zone-priority.ts
 * @description Etiqueta y color de cada nivel de prioridad de zona.
 * Único lugar donde vive este mapeo — antes estaba duplicado, con los mismos
 * valores escritos a mano, en mod-mapa.tsx (vista del admin) y en
 * armador/page.tsx (vista del armador). Cualquier módulo que muestre la
 * prioridad de una zona importa esto en vez de redefinirlo.
 */

import type { ZonePriority } from "@/types";

export const ZONE_PRIORITY_LABEL: Record<ZonePriority, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

export const ZONE_PRIORITY_COLOR: Record<ZonePriority, string> = {
  alta: "var(--s-inc)",
  media: "var(--s-active)",
  baja: "var(--s-idle)",
};
