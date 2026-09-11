/**
 * @file components/charts/latency-histogram.tsx
 * @description Histograma de distribución para una métrica de tiempo (los
 * baldes que produce `analytics.ts`). Un solo hue por gráfica — nunca arcoíris
 * — con la etiqueta del valor puesta directamente sobre cada barra (regla del
 * skill de dataviz: "selective direct labels", nunca un eje Y denso además).
 */

"use client";

import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import type { HistogramBucket } from "@/lib/analytics";

interface LatencyHistogramProps {
  data: HistogramBucket[];
  /** Color CSS (var(--accent), var(--s-active), etc.) — un solo hue, nunca varios. */
  color: string;
  height?: number;
}

interface TooltipPayloadItem {
  value?: number;
  payload?: HistogramBucket;
}

function HistogramTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;
  if (!bucket) return null;
  return (
    <div
      style={{
        background: "var(--elev)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div style={{ fontWeight: 600, color: "var(--tx)" }}>{bucket.label}</div>
      <div style={{ color: "var(--mut)" }}>{bucket.count} {bucket.count === 1 ? "caso" : "casos"}</div>
    </div>
  );
}

export function LatencyHistogram({ data, color, height = 160 }: LatencyHistogramProps) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <div style={{ height, display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 12.5 }}>
        Aún no hay suficientes datos para esta distribución
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: 8, bottom: 4 }} barCategoryGap="18%">
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--faint)", fontSize: 10.5 }}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={false}
        />
        <Tooltip content={<HistogramTooltip />} cursor={{ fill: "var(--panel2)" }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((d, i) => (
            <Cell key={i} fill={color} fillOpacity={d.count === 0 ? 0.15 : 0.85} />
          ))}
          <LabelOnTop />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Envuelto aparte para no mostrar una etiqueta "0" flotando sobre baldes vacíos.
function LabelOnTop() {
  return (
    <LabelList
      dataKey="count"
      position="top"
      style={{ fill: "var(--tx)", fontSize: 11, fontWeight: 600 }}
      formatter={(v: unknown) => (typeof v === "number" && v > 0 ? String(v) : "")}
    />
  );
}
