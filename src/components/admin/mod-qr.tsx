/**
 * @file components/admin/mod-qr.tsx
 * @description Módulo de generación de códigos QR por zona.
 * Los QR son permanentes y solo codifican el identificador de zona.
 * Carga zonas reales desde Firestore.
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/components/icons";
import { QRGlyph } from "@/components/qr/qr-glyph";
import { Panel } from "@/components/ui/panel";
import { useAuth } from "@/lib/auth-context";
import { getZones } from "@/lib/firestore";
import type { Zone } from "@/types";

export function ModQR() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId]);

  async function loadZones() {
    if (!user?.companyId) {
      setLoading(false);
      return;
    }
    try {
      const data = await getZones(user.companyId);
      setZones(data);
    } catch (error) {
      console.error("Error loading zones:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando...</div>;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Configuración de QR">
        <div className="alert warn" style={{ margin: 16 }}>
          <div className="at" style={{ color: "var(--accent)" }}>
            <I.qr /> El QR identifica la zona, no el trabajo
          </div>
          <div className="ab">
            Cada zona tiene un QR <b style={{ color: "var(--tx)" }}>fijo y permanente</b>. Codifica solo el identificador
            de la zona (ej. <span className="mono">TRZ://zona/Z07</span>). El pedido, el armador y el recorrido cambian
            cada día sin reimprimir nada.
          </div>
        </div>
        <div style={{ padding: "0 16px 14px", display: "flex", gap: 9 }}>
          <button className="btn primary" disabled={zones.length === 0} onClick={() => window.print()}>
            <I.file /> Descargar hoja de impresión ({zones.length})
          </button>
          <button className="btn" onClick={loadZones}>
            <I.qr /> Actualizar lista
          </button>
        </div>
      </Panel>

      {/* Hoja de impresión: oculta en pantalla, visible solo al imprimir/exportar a PDF */}
      <div className="qr-print-sheet">
        {zones.map((z) => (
          <div key={z.id} className="qr-print-card">
            <QRGlyph text={"TRZ://zona/" + z.code} size={140} />
            <div className="code">{z.code}</div>
            <div className="pl">TRZ://zona/{z.code}</div>
          </div>
        ))}
      </div>

      <Panel title="QR de zonas" hint={`${zones.length} zonas · escaneables`}>
        {zones.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
            No hay zonas configuradas. Importa datos desde SAP en el módulo de carga.
          </div>
        ) : (
          <div className="qr-grid">
            {zones.map((z) => (
              <div key={z.id} className="qr-card">
                <QRGlyph text={"TRZ://zona/" + z.code} size={116} />
                <div className="code mono">{z.code}</div>
                <div className="pl mono">TRZ://zona/{z.code}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
