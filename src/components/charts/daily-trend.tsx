/**
 * @file components/charts/daily-trend.tsx
 * @description Tendencia diaria de UNA sola métrica de tiempo (nunca dos ejes
 * en la misma gráfica — regla del skill de dataviz). Se usa dos veces, una
 * junto a otra, para comparar reacción vs. transición sin mezclar escalas.
 */

"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { DailyPoint } from "@/lib/analytics";
import { formatDayLabel, formatDuration } from "@/lib/analytics";

interface DailyTrendProps {
  data: DailyPoint[];
  /** Cuál de las dos series de DailyPoint graficar. */
  metric: "avgLatencySec" | "avgTransitionSec";
  color: string;
  height?: number;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: { value?: number; payload?: DailyPoint }[];
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const value = payload[0].value;
  if (!point || value === undefined || value === null) return null;
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
      <div style={{ fontWeight: 600, color: "var(--tx)" }}>{formatDayLabel(point.day)}</div>
      <div style={{ color: "var(--mut)" }}>Promedio: {formatDuration(value)}</div>
    </div>
  );
}

export function DailyTrend({ data, metric, color, height = 140 }: DailyTrendProps) {
  const withData = data.filter((d) => d[metric] !== null);
  if (withData.length < 2) {
    return (
      <div style={{ height, display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 12.5 }}>
        Todavía no hay suficientes días con datos para una tendencia
      </div>
    );
  }
  const gradientId = `trend-fill-${metric}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickFormatter={(d: string) => formatDayLabel(d)}
          tick={{ fill: "var(--faint)", fontSize: 10 }}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={false}
          minTickGap={20}
        />
        <YAxis hide domain={[0, "dataMax"]} />
        <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--line2)", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey={metric}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          connectNulls
          dot={{ r: 3, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: "var(--panel)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
