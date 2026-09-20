/**
 * @file components/ui/kpi.tsx
 * @description Componente de indicador clave de rendimiento (KPI).
 * Muestra una métrica con valor, unidad, delta de variación e icono.
 */

import type { KpiProps } from "@/types";

export function Kpi({ lab, val, unit, delta, up, down, icon, accent, small }: KpiProps) {
  return (
    <div className="kpi">
      <div className="kpi-accent" style={{ background: accent }} />
      <div className="lab">
        {icon && (
          <span style={{ color: accent, display: "grid", placeItems: "center" }}>
            {icon}
          </span>
        )}
        {lab}
      </div>
      <div className="val mono" style={small ? { fontSize: 22 } : undefined}>
        {val}
        {unit && <span className="u">{unit}</span>}
      </div>
      {delta && (
        <div className={"delta " + (up ? "up" : down ? "down" : "")}>{delta}</div>
      )}
    </div>
  );
}
