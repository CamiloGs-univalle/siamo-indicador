/**
 * @file components/admin/mod-asignacion.tsx
 * @description Módulo de asignación de zonas a armadores.
 * Permite asignar/quitar zonas a armadores.
 * La relación es: Zone.armadorId → Armador.id
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { getZones, getArmadores, updateZone } from "@/lib/firestore";
import type { Zone, Armador } from "@/types";

export function ModAsignacion() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

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
      if (a.length > 0 && !sel) setSel(a[0].id);
    } catch (error) {
      console.error("Error loading assignment data:", error);
    } finally {
      setLoading(false);
    }
  }

  // Get unassigned zones (zones without an armadorId)
  const pool = zones.filter((z) => !z.armadorId);

  // Get routes for each armador
  const routes: Record<string, string[]> = {};
  armadores.forEach((a) => {
    routes[a.id] = zones
      .filter((z) => z.armadorId === a.id)
      .map((z) => z.code);
  });

  async function handleAddZone(armadorId: string, zoneId: string) {
    setSaving(armadorId);
    try {
      await updateZone(zoneId, { armadorId }, { uid: user!.uid, name: user!.name });
      await loadData();
    } catch (error) {
      console.error("Error adding zone:", error);
    } finally {
      setSaving(null);
    }
  }

  async function handleRemoveZone(zoneId: string) {
    setSaving(zoneId);
    try {
      await updateZone(zoneId, { armadorId: null }, { uid: user!.uid, name: user!.name });
      await loadData();
    } catch (error) {
      console.error("Error removing zone:", error);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando...</div>;
  }

  return (
    <div className="assign-grid">
      <div style={{ maxHeight: 640, overflow: "auto", paddingRight: 2 }}>
        {armadores.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>
            No hay armadores registrados. Crea uno en el módulo de Equipo.
          </div>
        ) : (
          armadores.map((a) => (
            <div
              key={a.id}
              className="panel org-card"
              style={sel === a.id ? { borderColor: "var(--accent)" } : undefined}
              onClick={() => setSel(a.id)}
            >
              <div className="oh">
                <span className="avatar" style={{ background: a.color || "var(--accent)", width: 28, height: 28, borderRadius: 8, fontSize: 12 }}>
                  {a.name[0]}
                </span>
                <span className="nm">{a.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--faint)" }}>
                  {routes[a.id].length} zonas{sel === a.id ? " · seleccionado" : ""}
                </span>
              </div>
              {routes[a.id].map((z, i) => (
                <div key={z} className="route-item">
                  <span className="num mono">{i + 1}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{z}</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <button
                      className="btn ghost sm"
                      style={{ color: "var(--s-not)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const zone = zones.find((zz) => zz.code === z);
                        if (zone?.id) handleRemoveZone(zone.id);
                      }}
                      disabled={saving !== null}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))}
              {routes[a.id].length === 0 && (
                <div style={{ padding: 14, fontSize: 12.5, color: "var(--faint)" }}>Sin zonas.</div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="panel" style={{ position: "sticky", top: 70 }}>
        <div className="panel-h"><h3>Zonas sin asignar</h3></div>
        <div className="pool">
          {pool.length ? (
            pool.map((z) => (
              <button
                key={z.id}
                className="zchip"
                onClick={() => sel && z.id && handleAddZone(sel, z.id)}
                disabled={!sel || saving !== null}
              >
                <I.grip />{z.code}
              </button>
            ))
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Todas asignadas.</div>
          )}
        </div>
        <div style={{ padding: "0 16px 16px", fontSize: 11.5, color: "var(--faint)" }}>
          Selecciona un armador y toca una zona para agregarla.
        </div>
      </div>
    </div>
  );
}
