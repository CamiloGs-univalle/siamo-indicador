/**
 * @file components/admin/mod-equipo.tsx
 * @description Módulo "Equipo" — gestión del roster de armadores.
 *
 * El administrador crea, edita y elimina los armadores de su empresa
 * (colección `armadores` en Firestore). El sector es de la ZONA, no del armador.
 * Este módulo es solo el maestro de personas: nombre, cédula, costo/hora.
 */

"use client";

import { useEffect, useState } from "react";
import { I } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { getArmadores, createArmador, updateArmador, deleteArmador } from "@/lib/firestore";
import type { Armador } from "@/types";

const AVATAR_COLORS = ["#0E7C7B", "#7C3AED", "#D97706", "#DC2626", "#16A34A", "#2563EB"];

type EditingState = Armador | "new" | null;

export function ModEquipo() {
  const { user } = useAuth();
  const companyId = user?.companyId;

  const [armadores, setArmadores] = useState<Armador[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<EditingState>(null);
  const [formName, setFormName] = useState("");
  const [formCedula, setFormCedula] = useState("");
  const [formCostPerHour, setFormCostPerHour] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId) loadArmadores(companyId);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function loadArmadores(cid: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await getArmadores(cid);
      list.sort((a, b) => a.name.localeCompare(b.name));
      setArmadores(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudo cargar el equipo.");
    } finally {
      setLoading(false);
    }
  }

  function openNew() {
    setEditing("new");
    setFormName("");
    setFormCedula("");
    setFormCostPerHour("");
    setFormError(null);
  }

  function openEdit(arm: Armador) {
    setEditing(arm);
    setFormName(arm.name);
    setFormCedula(arm.cedula || "");
    setFormCostPerHour(arm.costPerHour ?? "");
    setFormError(null);
  }

  function closeForm() {
    setEditing(null);
    setFormError(null);
  }

  async function handleSave() {
    if (!companyId) return;
    const name = formName.trim();
    if (!name) {
      setFormError("El nombre es obligatorio.");
      return;
    }
    const cedula = formCedula.trim();
    if (!cedula) {
      setFormError("La cédula es obligatoria.");
      return;
    }
    const editingId = editing && editing !== "new" ? editing.id : undefined;
    const existing = armadores.find((a) => a.cedula === cedula && a.id !== editingId);
    if (existing) {
      setFormError(`Ya existe un armador con la cédula ${cedula} (${existing.name}).`);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") {
        const createData: Omit<Armador, "id"> = {
          companyId: companyId!,
          name,
          cedula,
          color: AVATAR_COLORS[armadores.length % AVATAR_COLORS.length],
          route: [],
          prodH: 0,
          cumpl: 0,
          inc: 0,
          retrab: 0,
          index: 0,
          trend: "0%",
          badges: [],
        };
        if (formCostPerHour !== "") {
          (createData as Record<string, unknown>).costPerHour = Number(formCostPerHour);
        }
        await createArmador(createData);
      } else if (editing) {
        const updateData: Record<string, unknown> = {
          name,
          cedula,
        };
        if (formCostPerHour !== "") {
          updateData.costPerHour = Number(formCostPerHour);
        }
        await updateArmador(editing.id, updateData);
      }
      closeForm();
      await loadArmadores(companyId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el armador.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(arm: Armador) {
    if (!companyId) return;
    if (!confirm(`¿Eliminar a ${arm.name} del equipo? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteArmador(arm.id, { companyId: arm.companyId, name: arm.name });
      if (editing !== "new" && editing?.id === arm.id) closeForm();
      await loadArmadores(companyId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo eliminar el armador.");
    }
  }

  const noCompany = !companyId;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
      <div className="panel">
        <div className="panel-h">
          <h3>Armadores ({armadores.length})</h3>
          {!noCompany && (
            <button className="btn primary sm" onClick={openNew}>
              + Agregar armador
            </button>
          )}
        </div>

        {noCompany ? (
          <div style={{ padding: 16 }}>
            <div className="alert warn">
              <I.alert /> Tu usuario no tiene una empresa asociada, así que el equipo no se puede cargar en este modo.
            </div>
          </div>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Cargando…</div>
        ) : loadError ? (
          <div style={{ padding: 16 }}>
            <div className="alert warn"><I.alert /> {loadError}</div>
          </div>
        ) : armadores.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👷</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Sin armadores todavía</div>
            <div style={{ fontSize: 13, color: "var(--mut)", marginBottom: 20 }}>
              Agrega a las personas que van a escanear los QR de las zonas.
            </div>
            <button className="btn primary" onClick={openNew}>+ Agregar armador</button>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Armador</th>
                <th>Costo/hora</th>
                <th>Índice</th>
                <th>Acceso</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {armadores.map((arm) => (
                <tr key={arm.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="avatar" style={{ background: arm.color || "var(--s-inc)", width: 28, height: 28, fontSize: 11 }}>
                        {arm.name[0]?.toUpperCase()}
                      </span>
                      <div>
                        <div style={{ fontWeight: 500 }}>{arm.name}</div>
                        {arm.cedula && <div style={{ fontSize: 11, color: "var(--faint)" }}>CC: {arm.cedula}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="mono">{arm.costPerHour ? `$${arm.costPerHour.toLocaleString("es-CO")}` : "—"}</td>
                  <td className="mono">{arm.index ? arm.index : "—"}</td>
                  <td>
                    {arm.authUid ? (
                      <span className="chip" style={{ background: "color-mix(in srgb,var(--s-done) 16%,transparent)", color: "var(--s-done)" }}>
                        Ya inició sesión
                      </span>
                    ) : arm.cedula ? (
                      <span style={{ fontSize: 11.5, color: "var(--mut)" }}>Puede entrar con CC {arm.cedula}</span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Sin cédula, no puede entrar</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn sm" onClick={() => openEdit(arm)} style={{ marginRight: 6 }}>Editar</button>
                    <button className="btn sm" style={{ color: "var(--s-not)" }} onClick={() => handleDelete(arm)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {editing && (
          <div className="panel">
            <div className="panel-h"><h3>{editing === "new" ? "Nuevo armador" : "Editar armador"}</h3></div>
            <div style={{ padding: 16 }}>
              <div className="field">
                <label>Nombre completo</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ej. Juan Torres" />
              </div>
              <div className="field">
                <label>Cédula de identidad</label>
                <input value={formCedula} onChange={(e) => setFormCedula(e.target.value)} placeholder="Ej. 1234567890" />
              </div>
              <div className="field">
                <label>Costo por hora (opcional)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={formCostPerHour}
                  onChange={(e) => setFormCostPerHour(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="Ej. 6500"
                />
              </div>
              {formError && (
                <div className="alert warn" style={{ marginBottom: 12 }}><I.alert /> {formError}</div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
                  {saving ? "Guardando…" : editing === "new" ? "Agregar armador" : "Guardar cambios"}
                </button>
                <button className="btn" onClick={closeForm}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {!editing && (
          <div className="panel">
            <div className="panel-h"><h3>¿Cómo funciona?</h3></div>
            <div style={{ padding: 16, fontSize: 12.5, color: "var(--mut)", lineHeight: 1.7 }}>
              <p><b>1.</b> Agrega a cada armador con su nombre y cédula.</p>
              <p><b>2.</b> El armador entra con su cédula en la pantalla de login — sin Google, sin correo.</p>
              <p><b>3.</b> Asígnale un recorrido de zonas en el módulo de Asignación.</p>
              <p><b>4.</b> El armador escanea el QR de su primera zona para empezar.</p>
              <p><b>5.</b> Su índice y productividad se calculan solos con cada jornada.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
