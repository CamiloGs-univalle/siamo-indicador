/**
 * @file components/admin/mod-jornada.tsx
 * @description Módulo de gestión de jornadas.
 * Permite crear jornadas y ver las recientes desde Firestore.
 */

"use client";

import { useState, useEffect } from "react";
import { Panel } from "@/components/ui/panel";
import { useAuth } from "@/lib/auth-context";
import { getJornadas, createJornada } from "@/lib/firestore";
import type { Jornada, JornadaTurno } from "@/types";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "var(--s-assigned)" },
  active: { label: "En proceso", color: "var(--s-active)" },
  done: { label: "Completada", color: "var(--s-done)" },
};

const TURNO_LABEL: Record<string, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
};

export function ModJornada() {
  const { user } = useAuth();
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Form state
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [pedido, setPedido] = useState("");
  const [turno, setTurno] = useState<JornadaTurno>("morning");

  useEffect(() => {
    loadJornadas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId]);

  async function loadJornadas() {
    if (!user?.companyId) {
      setLoading(false);
      return;
    }
    try {
      const data = await getJornadas(user.companyId);
      setJornadas(data);
    } catch (error) {
      console.error("Error loading jornadas:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!user?.companyId || !pedido.trim()) return;
    setCreating(true);
    try {
      await createJornada({
        companyId: user.companyId,
        pedido: pedido.trim(),
        fecha: fecha,
        turno,
        status: "pending",
      });
      setPedido("");
      await loadJornadas();
    } catch (error) {
      console.error("Error creating jornada:", error);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Nueva jornada">
        <div style={{ padding: 16 }}>
          <div className="field">
            <label>Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Pedido SAP</label>
            <input
              placeholder="Ej. 4582"
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Turno</label>
            <select value={turno} onChange={(e) => setTurno(e.target.value as JornadaTurno)}>
              <option value="morning">Mañana (06:00–14:00)</option>
              <option value="afternoon">Tarde (14:00–22:00)</option>
            </select>
          </div>
          <button
            className="btn primary"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={handleCreate}
            disabled={creating || !pedido.trim()}
          >
            {creating ? "Creando..." : "Crear jornada"}
          </button>
        </div>
      </Panel>

      <Panel title="Jornadas recientes">
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
            Cargando...
          </div>
        ) : jornadas.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
            No hay jornadas registradas
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha</th>
                <th>Turno</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {jornadas.map((j) => {
                const status = STATUS_MAP[j.status] || STATUS_MAP.pending;
                return (
                  <tr key={j.id}>
                    <td className="mono">{j.pedido}</td>
                    <td>{j.fecha}</td>
                    <td>{TURNO_LABEL[j.turno] || "—"}</td>
                    <td>
                      <span
                        className="pill"
                        style={{
                          background: `color-mix(in srgb,${status.color} 14%,transparent)`,
                          color: status.color,
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: status.color }} />
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
