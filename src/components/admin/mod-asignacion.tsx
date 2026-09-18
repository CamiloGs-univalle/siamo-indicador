/**
 * @file components/admin/mod-asignacion.tsx
 * @description Módulo de asignación de membretes a armadores.
 *
 * Modelo A → M → Z:
 * - Armador (A): persona que realiza el picking
 * - Membrete (M): lista de tareas/productos asignados a un armador
 * - Zona (Z): espacio físico donde están los productos
 *
 * Flujo:
 * 1. Admin crea membretes (desde SAP o manualmente)
 * 2. Admin asigna un membrete a un armador
 * 3. Armador va a la zona (sabe cuál por el membrete)
 * 4. Armador escanea QR → inicia timer → plataforma muestra membrete
 */

"use client";

import { useState, useEffect } from "react";
import { I } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeZones,
  subscribeArmadores,
  subscribeMembretes,
  assignMembreteToArmador,
  unassignMembreteFromArmador,
  activarCiclo,
  pausarCiclo,
  reanudarCiclo,
  repetirCiclo,
  nuevoCiclo,
} from "@/lib/firestore";
import type { Zone, Armador, Membrete } from "@/types";

export function ModAsignacion() {
  const { user } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [membretes, setMembretes] = useState<Membrete[]>([]);
  const [armadoresLoaded, setArmadoresLoaded] = useState(false);
  const [membretesLoaded, setMembretesLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId) return;

    const unsubZones = subscribeZones(user.companyId, (z) => {
      setZones(z);
    });
    const unsubArmadores = subscribeArmadores(user.companyId, (a) => {
      setArmadores(a);
      setSel((prevSel) => prevSel ?? (a.length > 0 ? a[0].id : null));
      setArmadoresLoaded(true);
    });
    const unsubMembretes = subscribeMembretes(user.companyId, (m) => {
      setMembretes(m);
      setMembretesLoaded(true);
    });

    return () => {
      unsubZones();
      unsubArmadores();
      unsubMembretes();
    };
  }, [user?.companyId]);

  // Membretes sin asignar (sin armadorId)
  const pool = membretes.filter((m) => !m.armadorId);

  // Membretes asignados a cada armador
  const routes: Record<string, Membrete[]> = {};
  armadores.forEach((a) => {
    routes[a.id] = membretes.filter((m) => m.armadorId === a.id);
  });

  // Armadores con membretes asignados primero
  const sortedArmadores = [...armadores].sort((a, b) => {
    const diff = (routes[b.id]?.length || 0) - (routes[a.id]?.length || 0);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  async function handleAssignMembrete(armadorId: string, membrete: Membrete) {
    if (!membrete.id || !user) return;
    setSaving(armadorId);
    try {
      const armador = armadores.find((a) => a.id === armadorId);
      if (!armador) return;
      await assignMembreteToArmador(
        membrete.id,
        { id: armador.id, name: armador.name },
        user.companyId!,
        { uid: user.uid, name: user.name }
      );
    } catch (error) {
      console.error("Error assigning membrete:", error);
    } finally {
      setSaving(null);
    }
  }

  async function handleUnassignMembrete(membrete: Membrete) {
    if (!membrete.id || !membrete.armadorId || !user) return;
    setSaving(membrete.id);
    try {
      await unassignMembreteFromArmador(
        membrete.id,
        membrete.armadorId,
        user.companyId!,
        { uid: user.uid, name: user.name }
      );
    } catch (error) {
      console.error("Error unassigning membrete:", error);
    } finally {
      setSaving(null);
    }
  }

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

  async function handlePausarCiclo(a: Armador) {
    if (!user) return;
    setSaving(a.id);
    try {
      await pausarCiclo({ id: a.id, name: a.name }, user.companyId!, { uid: user.uid, name: user.name });
    } catch (error) {
      console.error("Error pausando ciclo:", error);
    } finally {
      setSaving(null);
    }
  }

  async function handleReanudarCiclo(a: Armador) {
    if (!user) return;
    setSaving(a.id);
    try {
      await reanudarCiclo({ id: a.id, name: a.name }, user.companyId!, { uid: user.uid, name: user.name });
    } catch (error) {
      console.error("Error reanudando ciclo:", error);
    } finally {
      setSaving(null);
    }
  }

  async function handleRepetirCiclo(a: Armador) {
    if (!user) return;
    setSaving(a.id);
    try {
      const result = await repetirCiclo(a, zones, user.companyId!, { uid: user.uid, name: user.name });
      if (result.saltadas > 0) {
        alert(`Se reasignaron ${result.reasignadas} zona${result.reasignadas === 1 ? "" : "s"}. ${result.saltadas} ya no estaban disponibles.`);
      }
    } catch (error) {
      console.error("Error repitiendo ciclo:", error);
    } finally {
      setSaving(null);
    }
  }

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

  return (
    <div className="assign-grid">
      <div style={{ maxHeight: 640, overflow: "auto", paddingRight: 2 }}>
        {!armadoresLoaded ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 12 }}>Cargando armadores...</div>
        ) : armadores.length === 0 ? (
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
                    {route.length === 0 ? "Sin membretes" : `${route.length} membrete${route.length === 1 ? "" : "s"}`}
                    {sel === a.id && (
                      <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        seleccionado
                      </span>
                    )}
                  </span>
                </div>

                {a.cicloEstado === "completado" ? (
                  <div className="alert done" onClick={(e) => e.stopPropagation()}>
                    <div className="at">✓ Ciclo completado — el armador ya no tiene membretes asignados.</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="btn sm" onClick={() => handleRepetirCiclo(a)} disabled={saving !== null}>
                        Repetir ciclo
                      </button>
                      <button className="btn sm" onClick={() => handleNuevoCiclo(a)} disabled={saving !== null}>
                        Nuevo ciclo
                      </button>
                    </div>
                  </div>
                ) : a.cicloEstado === "pausado" ? (
                  <div className="alert warn" onClick={(e) => e.stopPropagation()}>
                    <div className="at">⏸ Ciclo pausado — el armador tiene el recorrido suspendido.</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="btn sm primary" onClick={() => handleReanudarCiclo(a)} disabled={saving !== null}>
                        ▶ Reanudar
                      </button>
                      <button className="btn sm" onClick={() => handleNuevoCiclo(a)} disabled={saving !== null}>
                        Cancelar ciclo
                      </button>
                    </div>
                  </div>
                ) : route.length > 0 && a.cicloEstado === "listo" ? (
                  <div className="alert done" onClick={(e) => e.stopPropagation()}>
                    <div className="at" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="badge active" style={{ margin: 0 }}>● En curso</span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>El armador puede escanear</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="btn sm" onClick={() => handlePausarCiclo(a)} disabled={saving !== null}>
                        ⏸ Pausar
                      </button>
                      <button className="btn sm" onClick={() => handleNuevoCiclo(a)} disabled={saving !== null}>
                        Finalizar
                      </button>
                    </div>
                  </div>
                ) : route.length > 0 ? (
                  <div className="alert warn" onClick={(e) => e.stopPropagation()}>
                    <div className="at">Membretes asignados — revisa y luego inicia el ciclo.</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="btn sm primary" onClick={() => handleActivarCiclo(a)} disabled={saving !== null}>
                        ▶ Iniciar ciclo
                      </button>
                    </div>
                  </div>
                ) : null}

                {route.map((m, i) => {
                  return (
                    <div key={m.id} className="route-item">
                      <span className="num mono">{i + 1}</span>
                      <span className="mono" style={{ fontWeight: 600 }}>{m.zonaCode}</span>
                      <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 500 }}>
                        {m.code}
                      </span>
                      {(m.pallet || m.ruta) && (
                        <span style={{ fontSize: 11, color: "var(--faint)" }}>
                          {m.pallet && `P:${m.pallet}${m.palletTotal ? `/${m.palletTotal}` : ""}`}
                          {m.pallet && m.ruta && " · "}
                          {m.ruta && `R:${m.ruta}`}
                        </span>
                      )}
                      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        <button
                          className="btn ghost sm"
                          style={{ color: "var(--s-not)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnassignMembrete(m);
                          }}
                          disabled={saving !== null}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  );
                })}
                {route.length === 0 && a.cicloEstado !== "completado" && (
                  <div style={{ padding: 14, fontSize: 12.5, color: "var(--faint)" }}>Sin membretes.</div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="panel" style={{ position: "sticky", top: 70 }}>
        <div className="panel-h">
          <h3>Membretes sin asignar</h3>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{membretesLoaded ? pool.length : "..."}</span>
        </div>
        <div className="pool">
          {!membretesLoaded ? (
            <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Cargando membretes...</div>
          ) : pool.length ? (
            pool.map((m) => (
              <button
                key={m.id}
                className="zchip"
                onClick={() => sel && handleAssignMembrete(sel, m)}
                disabled={!sel || saving !== null}
                title={`Zona: ${m.zonaCode} | ${m.pallet ? `Pallet ${m.pallet}` : ""} | ${m.totalProducts} productos`}
              >
                <I.grip />
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{m.zonaCode}</span>
                  <span style={{ fontSize: 10, color: "var(--faint)" }}>{m.code}</span>
                </span>
              </button>
            ))
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Todos asignados.</div>
          )}
        </div>
        <div style={{ padding: "0 16px 16px", fontSize: 11.5, color: "var(--faint)" }}>
          {sel
            ? `Toca un membrete para asignarlo a ${armadores.find((a) => a.id === sel)?.name || "el armador seleccionado"}.`
            : "Selecciona un armador y toca un membrete para asignarlo."}
        </div>
      </div>
    </div>
  );
}
