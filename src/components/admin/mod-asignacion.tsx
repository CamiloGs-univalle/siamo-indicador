/**
 * @file components/admin/mod-asignacion.tsx
 * @description Módulo de asignación de zonas a armadores.
 * Permite asignar/quitar zonas a armadores.
 * La relación es: Zone.armadorId → Armador.id
 *
 * Usa suscripciones en tiempo real (subscribeZones/subscribeArmadores) en
 * lugar de una sola lectura: así, si otro admin asigna una zona desde otra
 * pantalla, o el estado de una zona cambia, este módulo lo refleja al
 * instante — antes se quedaba con los datos del momento en que se abrió,
 * lo que hacía parecer que "no se veían los asignados".
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { subscribeZones, subscribeArmadores, assignZone, unassignZone, activarCiclo, repetirCiclo, nuevoCiclo } from "@/lib/firestore";
import type { Zone, Armador } from "@/types";

export function ModAsignacion() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let zonesLoaded = false;
    let armadoresLoaded = false;
    const maybeStopLoading = () => {
      if (zonesLoaded && armadoresLoaded) setLoading(false);
    };

    const unsubZones = subscribeZones(user.companyId, (z) => {
      setZones(z);
      zonesLoaded = true;
      maybeStopLoading();
    });
    const unsubArmadores = subscribeArmadores(user.companyId, (a) => {
      setArmadores(a);
      setSel((prevSel) => prevSel ?? (a.length > 0 ? a[0].id : null));
      armadoresLoaded = true;
      maybeStopLoading();
    });

    return () => {
      unsubZones();
      unsubArmadores();
    };
  }, [user?.companyId]);

  // Zonas sin asignar (sin armadorId)
  const pool = zones.filter((z) => !z.armadorId);

  // Recorrido de cada armador
  const routes: Record<string, Zone[]> = {};
  armadores.forEach((a) => {
    routes[a.id] = zones.filter((z) => z.armadorId === a.id);
  });

  // Armadores con zonas asignadas primero, para ver de un vistazo quién
  // ya tiene trabajo y quién está libre.
  const sortedArmadores = [...armadores].sort((a, b) => {
    const diff = (routes[b.id]?.length || 0) - (routes[a.id]?.length || 0);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  async function handleAddZone(armadorId: string, zone: Zone) {
    if (!zone.id || !user) return;
    setSaving(armadorId);
    try {
      const armador = armadores.find((a) => a.id === armadorId);
      if (!armador) return;
      await assignZone(zone.id, zone.code, user.companyId!, { id: armador.id, name: armador.name }, { uid: user.uid, name: user.name });
      // No hace falta recargar a mano: la suscripción en tiempo real trae el cambio.
    } catch (error) {
      console.error("Error adding zone:", error);
    } finally {
      setSaving(null);
    }
  }

  async function handleRemoveZone(zone: Zone) {
    if (!zone.id || !user) return;
    setSaving(zone.id);
    try {
      const previousArmador = zone.armadorId ? armadores.find((a) => a.id === zone.armadorId) : undefined;
      await unassignZone(
        zone.id,
        zone.code,
        user.companyId!,
        previousArmador ? { id: previousArmador.id, name: previousArmador.name } : undefined,
        { uid: user.uid, name: user.name }
      );
    } catch (error) {
      console.error("Error removing zone:", error);
    } finally {
      setSaving(null);
    }
  }

  /** El admin confirma la asignación actual: el armador ya puede iniciar su recorrido. */
  async function handleActivarCiclo(a: Armador) {
    if (!user) return;
    setSaving(a.id);
    try {
      await activarCiclo({ id: a.id, name: a.name }, user.companyId!, { uid: user.uid, name: user.name });
    } catch (error) {
      console.error("Error activando ciclo:", error);
    } finally {
      setSaving(null);
    }
  }

  /** Reasigna de un clic las mismas zonas del ciclo que este armador acaba de terminar. */
  async function handleRepetirCiclo(a: Armador) {
    if (!user) return;
    setSaving(a.id);
    try {
      const { reasignadas, saltadas } = await repetirCiclo(a, zones, user.companyId!, { uid: user.uid, name: user.name });
      if (saltadas > 0) {
        alert(`Se reasignaron ${reasignadas} zona${reasignadas === 1 ? "" : "s"}. ${saltadas} ya no estaban disponibles (asignadas a otro armador o eliminadas).`);
      }
    } catch (error) {
      console.error("Error repitiendo ciclo:", error);
    } finally {
      setSaving(null);
    }
  }

  /** Baja el aviso de "completado" para armar un ciclo desde cero con el panel de siempre. */
  async function handleNuevoCiclo(a: Armador) {
    setSaving(a.id);
    try {
      await nuevoCiclo(a.id);
    } catch (error) {
      console.error("Error iniciando nuevo ciclo:", error);
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
          sortedArmadores.map((a) => {
            const route = routes[a.id] || [];
            return (
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
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: route.length === 0 ? "var(--faint)" : "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {route.length === 0 ? "Sin zonas" : `${route.length} zona${route.length === 1 ? "" : "s"}`}
                    {sel === a.id && (
                      <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        seleccionado
                      </span>
                    )}
                  </span>
                </div>

                {a.cicloEstado === "completado" ? (
                  <div className="alert done" onClick={(e) => e.stopPropagation()}>
                    <div className="at">✓ Ciclo completado — el armador ya no tiene zonas asignadas.</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="btn sm" onClick={() => handleRepetirCiclo(a)} disabled={saving !== null}>
                        Repetir ciclo
                      </button>
                      <button className="btn sm" onClick={() => handleNuevoCiclo(a)} disabled={saving !== null}>
                        Nuevo ciclo
                      </button>
                    </div>
                  </div>
                ) : route.length > 0 && a.cicloEstado !== "listo" ? (
                  <div className="alert warn" onClick={(e) => e.stopPropagation()}>
                    <div className="at">Zonas asignadas — falta confirmar para que el armador pueda iniciar.</div>
                    <div style={{ marginTop: 8 }}>
                      <button className="btn sm primary" onClick={() => handleActivarCiclo(a)} disabled={saving !== null}>
                        ✓ Listo, avisar al armador
                      </button>
                    </div>
                  </div>
                ) : route.length > 0 && a.cicloEstado === "listo" ? (
                  <div style={{ padding: "0 16px 10px" }}>
                    <span className="badge active">● En curso</span>
                  </div>
                ) : null}

                {route.map((z, i) => (
                  <div key={z.code} className="route-item">
                    <span className="num mono">{i + 1}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{z.code}</span>
                    {(z.pallet || z.ruta) && (
                      <span style={{ fontSize: 11, color: "var(--faint)" }}>
                        {z.pallet && `P:${z.pallet}${z.palletTotal ? `/${z.palletTotal}` : ""}`}
                        {z.pallet && z.ruta && " · "}
                        {z.ruta && `R:${z.ruta}`}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                      <button
                        className="btn ghost sm"
                        style={{ color: "var(--s-not)" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveZone(z);
                        }}
                        disabled={saving !== null}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
                {route.length === 0 && a.cicloEstado !== "completado" && (
                  <div style={{ padding: 14, fontSize: 12.5, color: "var(--faint)" }}>Sin zonas.</div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="panel" style={{ position: "sticky", top: 70 }}>
        <div className="panel-h">
          <h3>Zonas sin asignar</h3>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{pool.length}</span>
        </div>
        <div className="pool">
          {pool.length ? (
            pool.map((z) => (
              <button
                key={z.id}
                className="zchip"
                onClick={() => sel && handleAddZone(sel, z)}
                disabled={!sel || saving !== null}
                title={z.pallet ? `Pallet ${z.pallet}${z.palletTotal ? ` de ${z.palletTotal}` : ""}` : undefined}
              >
                <I.grip />{z.code}
              </button>
            ))
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Todas asignadas.</div>
          )}
        </div>
        <div style={{ padding: "0 16px 16px", fontSize: 11.5, color: "var(--faint)" }}>
          {sel
            ? `Toca una zona para agregarla a ${armadores.find((a) => a.id === sel)?.name || "el armador seleccionado"}.`
            : "Selecciona un armador y toca una zona para agregarla."}
        </div>
      </div>
    </div>
  );
}
