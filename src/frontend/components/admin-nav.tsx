"use client";

import { useEffect, useState } from "react";
import { I } from "@/frontend/components/icons";
import { useAuth } from "@/frontend/context/auth-context";
import { subscribeMembretes } from "@/frontend/services/firestore";
import type { Membrete } from "@/types";

const pad = (n: number) => String(n).padStart(2, "0");

const nav: [string, string, React.FC<Record<string, unknown>>, string?][] = [
  ["pantalla", "Pantalla en vivo", I.monitor, "PROYECCIÓN"],
  ["carga", "Carga SAP", I.upload, "OPERACIÓN DIARIA"],
  ["equipo", "Equipo", I.users],
  ["asignacion", "Asignación", I.users],
  ["zonas", "Zonas", I.box],
  ["membretes", "Membretes", I.file],
  ["qr", "QR de zonas", I.qr],
  ["mapa", "Mapa en vivo", I.map, "SEGUIMIENTO"],
  ["analiticas", "Analítica", I.chart, "ANÁLISIS"],
  ["indicadores", "Indicadores", I.chart],
  ["desempeno", "Desempeño", I.trophy],
  ["historial", "Historial", I.history],
  ["reportes", "Reportes", I.file],
];

export function AdminNav({ mod, setMod }: { mod: string; setMod: (m: string) => void }) {
  const { user } = useAuth();
  // Cuenta zonas con al menos una incidencia ABIERTA (reportada por un
  // armador y aún sin marcar como resuelta por el admin) — vive en el nav
  // para que le "llegue" al administrador sin importar en qué módulo esté
  // parado, no solo cuando tiene abierto el mapa.
  const [openIncidentZones, setOpenIncidentZones] = useState(0);

  useEffect(() => {
    if (!user?.companyId) return;
    const unsub = subscribeMembretes(user.companyId, (membretes: Membrete[]) => {
      const zonesWithOpenIncident = new Set<string>();
      membretes.forEach((m) => {
        const hasOpen = (m.products || []).some((p) => p.status === "incident" && !p.incidentResolvedAt);
        if (hasOpen) zonesWithOpenIncident.add(m.zonaCode);
      });
      setOpenIncidentZones(zonesWithOpenIncident.size);
    });
    return unsub;
  }, [user?.companyId]);

  return (
    <div className="panel nav-wrap">
      <div className="nav">
        {nav.map(([id, label, Icon, sec], i) => (
          <div key={id}>
            {sec && <div className="nav-sec">{sec}</div>}
            <div
              className={"step" + (mod === id ? " on" : "")}
              onClick={() => setMod(id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMod(id); } }}
            >
              <span className="ix mono">{pad(i + 1)}</span>
              <span className="nav-icon"><Icon /></span>
              <span className="nav-label">{label}</span>
              {id === "mapa" && openIncidentZones > 0 && (
                <span className="nav-badge-inc" title={`${openIncidentZones} zona(s) con incidencia abierta — necesitan atención`}>
                  {openIncidentZones}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
