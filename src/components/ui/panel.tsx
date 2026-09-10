/**
 * @file components/ui/panel.tsx
 * @description Componente panel contenedor con header y contenido.
 * Base visual para secciones del dashboard.
 */

interface PanelProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function Panel({ title, hint, action, children }: PanelProps) {
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>{title}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {hint && <span className="hint">{hint}</span>}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}
