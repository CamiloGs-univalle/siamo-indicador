"use client";

import { I } from "@/components/icons";

const pad = (n: number) => String(n).padStart(2, "0");

const nav: [string, string, React.FC<Record<string, unknown>>, string?][] = [
  ["carga", "Carga SAP", I.upload, "OPERACIÓN DIARIA"],
  ["equipo", "Equipo", I.users],
  ["asignacion", "Asignación", I.users],
  ["qr", "QR de zonas", I.qr],
  ["mapa", "Mapa en vivo", I.map, "SEGUIMIENTO"],
  ["indicadores", "Indicadores", I.chart],
  ["desempeno", "Desempeño", I.trophy],
  ["historial", "Historial", I.history],
  ["reportes", "Reportes", I.file],
  ["configuracion", "Configuración", I.gear, "AJUSTES"],
];

export function AdminNav({ mod, setMod }: { mod: string; setMod: (m: string) => void }) {
  return (
    <div className="panel">
      <div className="nav" style={{ padding: 7 }}>
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
              <span className="ix mono">{pad(i + 1)}</span><Icon />{label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
