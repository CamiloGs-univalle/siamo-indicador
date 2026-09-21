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
  ["armador", "Armador", I.users],
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

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 12L6 8L10 4" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 12L10 8L6 4" />
    </svg>
  );
}

export function AdminNav({ mod, setMod }: { mod: string; setMod: (m: string) => void }) {
  const { user } = useAuth();
  const [openIncidentZones, setOpenIncidentZones] = useState(0);
  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("nav-expanded") === "true";
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem("nav-expanded", String(expanded));
  }, [expanded]);

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
    <div className={"nav-wrap" + (expanded ? " expanded" : "")}>
      <div className="nav-head">
        <span className="nav-head-label">Menú</span>
        <button
          className="nav-toggle"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Contraer menú" : "Expandir menú"}
        >
          {expanded ? <ChevronLeft /> : <ChevronRight />}
        </button>
      </div>
      <div className="nav">
        {nav.map(([id, label, Icon, sec], i) => (
          <div key={id}>
            {sec && expanded && <div className="nav-sec">{sec}</div>}
            <div
              className={"step" + (mod === id ? " on" : "")}
              onClick={() => setMod(id)}
              title={!expanded ? label : undefined}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMod(id); } }}
            >
              <span className="ix mono">{pad(i + 1)}</span>
              <span className="nav-icon" style={{ position: "relative" }}>
                <Icon />
                {!expanded && id === "mapa" && openIncidentZones > 0 && (
                  <span className="nav-badge-dot" title={`${openIncidentZones} zona(s) con incidencia abierta`} />
                )}
              </span>
              {expanded && <span className="nav-label">{label}</span>}
              {expanded && id === "mapa" && openIncidentZones > 0 && (
                <span className="nav-badge-inc" style={{ marginLeft: "auto" }} title={`${openIncidentZones} zona(s) con incidencia abierta — necesitan atención`}>
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
