/**
 * @file components/admin/mod-reportes.tsx
 * @description Módulo de reportes diarios y semanales.
 * Carga datos reales desde Firestore.
 */

"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { Panel } from "@/components/ui/panel";
import { useAuth } from "@/lib/auth-context";
import { getZones, getArmadores } from "@/lib/firestore";
import type { Zone, Armador } from "@/types";

export function ModReportes() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId]);

  async function loadData() {
    if (!user?.companyId) {
      setLoading(false);
      return;
    }
    try {
      const [z, a] = await Promise.all([
        getZones(user.companyId),
        getArmadores(user.companyId),
      ]);
      setZones(z);
      setArmadores(a);
    } catch (error) {
      console.error("Error loading report data:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando...</div>;
  }

  // Calculate daily metrics
  const doneZones = zones.filter((z) => z.status === "done");
  const totalProducts = zones.reduce((sum, z) => sum + (z.totalProducts || 0), 0);
  const avgTime = doneZones.length > 0
    ? Math.round(doneZones.reduce((sum, z) => sum + (z.avgMinutes || 0), 0) / doneZones.length * 10) / 10
    : 0;
  const productivity = avgTime > 0 ? Math.round((totalProducts / avgTime) * 60) : 0;
  const completionRate = zones.length > 0 ? Math.round((doneZones.length / zones.length) * 100) : 0;
  const incidents = zones.filter((z) => z.status === "incident").length;


  function exportExcel() {
    const today = new Date().toLocaleDateString("es-CO");
    const rows = [
      ["Reporte diario", today],
      [],
      ["Indicador", "Valor"],
      ["Armadores", armadores.length],
      ["Zonas procesadas", doneZones.length],
      ["Zonas totales", zones.length],
      ["Productos", totalProducts],
      ["Tiempo promedio (min)", avgTime],
      ["Productividad (prod/h)", productivity],
      ["Cumplimiento (%)", completionRate],
      ["Incidencias", incidents],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen diario");

    const zoneRows = [
      ["Zona", "Sector", "Estado", "Productos", "Armador asignado"],
      ...zones.map((z) => [
        z.code,
        z.sector,
        z.status,
        z.totalProducts || 0,
        armadores.find((a) => a.id === z.armadorId)?.name || "",
      ]),
    ];
    const wsZones = XLSX.utils.aoa_to_sheet(zoneRows);
    XLSX.utils.book_append_sheet(wb, wsZones, "Zonas");

    XLSX.writeFile(wb, `reporte_siamo_${today.replace(/\//g, "-")}.xlsx`);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Resumen diario" hint={new Date().toLocaleDateString("es-CO")}>
        <div style={{ padding: "6px 0" }}>
          {[
            ["Armadores", armadores.length.toString()],
            ["Zonas procesadas", doneZones.length.toString()],
            ["Productos", totalProducts.toLocaleString()],
            ["Tiempo promedio", `${avgTime} min`],
            ["Productividad", `${productivity} prod/h`],
            ["Cumplimiento", `${completionRate}%`],
            ["Incidencias", incidents.toString()],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{k}</span>
              <span className="mono" style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 14, display: "flex", gap: 9 }}>
          <button className="btn primary" style={{ flex: 1, justifyContent: "center" }} onClick={exportExcel}>
            Exportar Excel
          </button>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: "center", opacity: 0.6, cursor: "not-allowed" }}
            disabled
            title="Exportación a PDF aún no disponible"
          >
            PDF (próximamente)
          </button>
        </div>
      </Panel>

      <Panel title="Historial semanal" hint="se construye con datos reales">
        <div style={{ padding: 32, textAlign: "center", color: "var(--faint)" }}>
          Aún no hay suficiente historial de días completos para mostrar una tendencia semanal real.
          Esta vista se irá completando a medida que se registren jornadas y zonas finalizadas en el sistema.
        </div>
        <div style={{ padding: "0 16px 16px", fontSize: 12, color: "var(--faint)" }}>
          El resumen diario de la izquierda sí refleja datos reales de hoy, cargados desde Firestore.
        </div>
      </Panel>
    </div>
  );
}
