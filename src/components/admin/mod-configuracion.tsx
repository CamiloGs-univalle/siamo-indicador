/**
 * @file components/admin/mod-configuracion.tsx
 * @description Modulo "Configuracion" - parametros operativos de la empresa.
 *
 * Todo lo que el resto de la app necesita para calcular tiempos, pausas y
 * costos reales vive aqui, en el documento companies/{companyId}:
 *  - Horario y almuerzo: turnos y la pausa de almuerzo que congela el
 *    cronometro del armador (ver app/(dashboard)/armador/page.tsx).
 *  - Costos de mano de obra: costo por hora por defecto, usado cuando un
 *    armador no tiene su propio costPerHour (configurado en Equipo).
 *  - Metas de productividad: unidades/hora y minutos por zona, usadas como
 *    referencia en Indicadores y Reportes.
 */

"use client";

import { useEffect, useState } from "react";
import { I } from "@/components/icons";
import { Panel } from "@/components/ui/panel";
import { useAuth } from "@/lib/auth-context";
import { getCompany, updateCompany, type Company } from "@/lib/firestore";

const DEFAULTS: Required<
  Pick<
    Company,
    | "turnoMananaInicio"
    | "turnoMananaFin"
    | "turnoTardeInicio"
    | "turnoTardeFin"
    | "almuerzoInicio"
    | "almuerzoDuracionMin"
    | "metaProdHora"
    | "metaMinutosZona"
    | "costoHoraDefault"
  >
> = {
  turnoMananaInicio: "06:00",
  turnoMananaFin: "14:00",
  turnoTardeInicio: "14:00",
  turnoTardeFin: "22:00",
  almuerzoInicio: "12:00",
  almuerzoDuracionMin: 60,
  metaProdHora: 40,
  metaMinutosZona: 15,
  costoHoraDefault: 0,
};

export function ModConfiguracion() {
  const { user } = useAuth();
  const companyId = user?.companyId;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [turnoMananaInicio, setTurnoMananaInicio] = useState(DEFAULTS.turnoMananaInicio);
  const [turnoMananaFin, setTurnoMananaFin] = useState(DEFAULTS.turnoMananaFin);
  const [turnoTardeInicio, setTurnoTardeInicio] = useState(DEFAULTS.turnoTardeInicio);
  const [turnoTardeFin, setTurnoTardeFin] = useState(DEFAULTS.turnoTardeFin);
  const [almuerzoInicio, setAlmuerzoInicio] = useState(DEFAULTS.almuerzoInicio);
  const [almuerzoDuracionMin, setAlmuerzoDuracionMin] = useState(DEFAULTS.almuerzoDuracionMin);
  const [costoHoraDefault, setCostoHoraDefault] = useState(DEFAULTS.costoHoraDefault);
  const [metaProdHora, setMetaProdHora] = useState(DEFAULTS.metaProdHora);
  const [metaMinutosZona, setMetaMinutosZona] = useState(DEFAULTS.metaMinutosZona);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    getCompany(companyId)
      .then((company) => {
        if (!company) return;
        setTurnoMananaInicio(company.turnoMananaInicio || DEFAULTS.turnoMananaInicio);
        setTurnoMananaFin(company.turnoMananaFin || DEFAULTS.turnoMananaFin);
        setTurnoTardeInicio(company.turnoTardeInicio || DEFAULTS.turnoTardeInicio);
        setTurnoTardeFin(company.turnoTardeFin || DEFAULTS.turnoTardeFin);
        setAlmuerzoInicio(company.almuerzoInicio || DEFAULTS.almuerzoInicio);
        setAlmuerzoDuracionMin(company.almuerzoDuracionMin ?? DEFAULTS.almuerzoDuracionMin);
        setCostoHoraDefault(company.costoHoraDefault ?? DEFAULTS.costoHoraDefault);
        setMetaProdHora(company.metaProdHora ?? DEFAULTS.metaProdHora);
        setMetaMinutosZona(company.metaMinutosZona ?? DEFAULTS.metaMinutosZona);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "No se pudo cargar la configuracion."))
      .finally(() => setLoading(false));
  }, [companyId]);

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateCompany(companyId, {
        turnoMananaInicio,
        turnoMananaFin,
        turnoTardeInicio,
        turnoTardeFin,
        almuerzoInicio,
        almuerzoDuracionMin: Number(almuerzoDuracionMin) || 0,
        costoHoraDefault: Number(costoHoraDefault) || 0,
        metaProdHora: Number(metaProdHora) || 0,
        metaMinutosZona: Number(metaMinutosZona) || 0,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "No se pudo guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  }

  const noCompany = !companyId;

  if (noCompany) {
    return (
      <div className="panel">
        <div style={{ padding: 16 }}>
          <div className="alert warn">
            <I.alert /> Tu usuario no tiene una empresa asociada, asi que la configuracion no se puede guardar en este modo.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando...</div>;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Horario y almuerzo" hint="Define los turnos y la pausa que congela el cronometro del armador">
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="field">
            <label>Turno manana - inicio</label>
            <input type="time" value={turnoMananaInicio} onChange={(e) => setTurnoMananaInicio(e.target.value)} />
          </div>
          <div className="field">
            <label>Turno manana - fin</label>
            <input type="time" value={turnoMananaFin} onChange={(e) => setTurnoMananaFin(e.target.value)} />
          </div>
          <div className="field">
            <label>Turno tarde - inicio</label>
            <input type="time" value={turnoTardeInicio} onChange={(e) => setTurnoTardeInicio(e.target.value)} />
          </div>
          <div className="field">
            <label>Turno tarde - fin</label>
            <input type="time" value={turnoTardeFin} onChange={(e) => setTurnoTardeFin(e.target.value)} />
          </div>
          <div className="field">
            <label>Hora de inicio del almuerzo</label>
            <input type="time" value={almuerzoInicio} onChange={(e) => setAlmuerzoInicio(e.target.value)} />
          </div>
          <div className="field">
            <label>Duracion del almuerzo (minutos)</label>
            <input
              type="number"
              min={0}
              value={almuerzoDuracionMin}
              onChange={(e) => setAlmuerzoDuracionMin(Number(e.target.value))}
            />
          </div>
        </div>
        <div style={{ padding: "0 16px 16px", fontSize: 12, color: "var(--faint)", lineHeight: 1.6 }}>
          Mientras un armador tiene un recorrido activo, el cronometro se pausa automaticamente durante esta ventana de almuerzo y se reanuda al terminar.
        </div>
      </Panel>

      <Panel title="Costos de mano de obra" hint="Costo por hora por defecto (usado si el armador no tiene uno propio)">
        <div style={{ padding: 16 }}>
          <div className="field" style={{ maxWidth: 280 }}>
            <label>Costo por hora por defecto</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={costoHoraDefault}
              onChange={(e) => setCostoHoraDefault(Number(e.target.value))}
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)", lineHeight: 1.6 }}>
            El costo real de produccion se calcula por armador: cada uno puede tener su propio costo por hora en el modulo de Equipo. Este valor solo se usa como respaldo cuando un armador no tiene uno configurado.
          </div>
        </div>
      </Panel>

      <Panel title="Metas de productividad" hint="Referencias usadas en Indicadores y Reportes">
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="field">
            <label>Meta de productividad (unidades / hora)</label>
            <input
              type="number"
              min={0}
              value={metaProdHora}
              onChange={(e) => setMetaProdHora(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Meta de tiempo por zona (minutos)</label>
            <input
              type="number"
              min={0}
              value={metaMinutosZona}
              onChange={(e) => setMetaMinutosZona(Number(e.target.value))}
            />
          </div>
        </div>
      </Panel>

      {saveError && (
        <div className="alert warn"><I.alert /> {saveError}</div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando..." : "Guardar configuracion"}
        </button>
        {saved && <span style={{ fontSize: 12.5, color: "var(--s-done)" }}><I.check /> Guardado</span>}
      </div>
    </div>
  );
}
