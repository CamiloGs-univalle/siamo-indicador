# Funcionalidades — Siamo.Indicador

> Actualizado el 19 de septiembre de 2026. Describe qué hace cada módulo tal como está implementado hoy, incluyendo el nuevo modelo de asignación (roster + jornada) y el control de almuerzo. Para el detalle de errores conocidos y mejoras propuestas, ver `ERRORES.md` y `MEJORAS.md`.

## 1. Roles

- **Super admin**: gestiona empresas y usuarios del sistema completo. Bootstrap vía la variable `SUPER_ADMIN_EMAILS` (ver `ARQUITECTURA.md`).
- **Admin**: gestiona la operación de una empresa: jornada, carga de trabajo, zonas, armadores, membretes, indicadores, reportes y configuración.
- **Armador**: opera desde la app móvil (`/armador`), ejecuta el picking físico.

## 2. Módulos del panel de administración

### 2.1 Pantalla (`mod-pantalla.tsx`)
Vista general de la operación en tiempo real. Sus cálculos de productividad por hora y de ranking de zonas ahora usan **primero los membretes completados del día** (`durationMs`, `finishedAt`) como fuente de verdad, y solo recurren a las sesiones de escaneo (`ScanSession`) cuando no hay membretes registrados para esa hora/zona — una mejora reciente sobre la versión anterior, que dependía solo de sesiones. La tasa de error que se muestra en el detalle de zona sigue siendo una constante fija (`8%` sobre el total de tareas), no un dato real de incidencias — ver `ERRORES.md` §2.3.

### 2.2 Carga (`mod-carga.tsx`)
Permite ingresar membretes (órdenes de picking) manualmente o importarlos masivamente desde Excel (`excel-utils.ts`). Cada membrete registra ruta, pallet, total de pallets, fecha de entrega, familia, camión, zona y la lista de productos a recoger. También puede alimentarse desde `importSapData()` (ver `ARQUITECTURA.md` §6.1), que **no** detecta membretes duplicados al reimportar el mismo archivo o uno superpuesto.

### 2.3 Asignación (`mod-asignacion.tsx`)
Ahora combina dos funciones:

- **Control de Jornada**: el admin inicia, pausa, reanuda y finaliza la jornada de la empresa. Mientras la jornada no está activa (o está pausada), los armadores no pueden escanear ni tomar membretes nuevos — la app del armador se lo indica explícitamente. Un panel de estadísticas muestra en vivo cuántos armadores están asignados, cuántos trabajando, y cuántos membretes hay en cola/activos/completados.
- **Roster de armadores**: el admin postula a cada armador a la zona donde debe trabajar (selector armador → zona) y puede quitarlo del roster en cualquier momento. Esto **no** le asigna ningún membrete puntual — solo le dice dónde ir. El armador toma sus propios membretes al escanear, por orden de llegada a la cola de esa zona (ver `ARQUITECTURA.md` §4.4).

**Nota**: "Finalizar jornada" no desasigna a los armadores de su zona ni cierra sus membretes activos — solo bloquea el escaneo de nuevos membretes. Ver `ERRORES.md` §4.1.

### 2.4 Equipo (`mod-equipo.tsx`)
Gestión del roster de armadores de la empresa: alta, edición, colores personales de identificación en el mapa, cédula, costo por hora.

### 2.5 Zonas (`mod-zonas.tsx`)
Gestión de las zonas físicas de la bodega: código, sector (A/B), posición, prioridad. Incluye eliminación de zonas — ver `ERRORES.md` respecto al alcance real del borrado (no hay limpieza en cascada).

### 2.6 Membretes (`mod-membretes.tsx`)
Vista y edición detallada de membretes individuales, incluyendo el estado de cada producto dentro del membrete. **Además, conserva una acción "+ Asignar" / "Quitar" que asigna o quita manualmente un armador de un membrete puntual** (`assignMembreteToArmador()` / `unassignMembreteFromArmador()`), a pesar de que el comentario de encabezado del propio archivo dice que esta función ya no existe. Esto contradice el modelo de "roster + toma voluntaria" del resto del sistema — ver `ARQUITECTURA.md` §4.4 y `ERRORES.md` §4.1, es el hallazgo más importante de esta revisión.

### 2.7 QR (`mod-qr.tsx`)
Generación e impresión de los códigos QR físicos que se colocan en cada zona de la bodega. El payload codificado es el literal `TRZ://zona/{code}`, que la app del armador decodifica al escanear. Uso activo y obligatorio en el flujo operativo.

### 2.8 Mapa (`mod-mapa.tsx`)
Mapa visual en vivo del piso de bodega (usa `map-floor.tsx` y `warehouse-layout.ts`, con posiciones correctas para Túnel 1 y Túnel 2 — ver §5 más abajo). Usa el modelo moderno Membrete-derivado por completo. Incluye:
- El punto de color en la esquina de cada zona, que refleja el **estado operativo** de la zona (inactiva, asignada/con roster, activa, pausada, completada, con incidencia) — independiente del color personal del armador.
- Un panel de **roster** en el detalle de zona: qué armadores están postulados ahí (con opción de postular uno nuevo o quitar uno existente), separado de la cola de membretes pendientes.
- Un banner de "Incidencias abiertas" a nivel de empresa, y un panel de detalle por zona con botón "Marcar resuelta".
- Un badge en la navegación (`admin-nav.tsx`) con el conteo de zonas con incidencias abiertas.

### 2.9 Analíticas (`mod-analiticas.tsx`)
Indicadores agregados de la operación, calculados mediante `zone-analytics.ts`. **Usa el modelo legado** (lee campos deprecados de `Zone` directamente) — ver `ARQUITECTURA.md` §4.3. Tiene un componente `Toast` propio, pero nunca llega a mostrarse: en el código actual solo se invoca para *cerrarlo* (`setToast(null)`), nunca para mostrar un mensaje.

### 2.10 Desempeño (`mod-desempeno.tsx`)
Calcula un "índice operacional" por armador a partir de varios componentes (productividad, disponibilidad, calidad, etc.). **Usa el modelo legado** de forma completa, sin ningún fallback a membretes. La fórmula de este módulo difiere de la usada en Reportes (ver 2.12 y `ERRORES.md`).

### 2.11 Zona Monitor (`mod-zona-monitor.tsx`)
Vista de monitoreo por zona con métricas de "satisfacción" a lo largo del día. **Usa el modelo legado** sin fallback a membretes. Cuando no hay datos reales de sesión para una hora determinada, genera un valor de "satisfacción" simulado (`Math.round(70 + Math.random() * 25)`) — ver `ERRORES.md`. Tiene un botón "Replicar" sin ningún manejador asociado (no hace nada al hacer clic) y una tarjeta de KPI con un delta "+1" fijo que no proviene de ningún cálculo real.

### 2.12 Reportes (`mod-reportes.tsx`)
Generación de reportes exportables (a HTML). Calcula su propio "índice operacional" **por periodo**, con una fórmula distinta a la de Desempeño, y **usa el modelo legado** de zona sin fallback a membretes — ver `ERRORES.md` sobre la discrepancia entre ambas fórmulas.

### 2.13 Historial (`mod-historial.tsx`)
Consulta de eventos históricos de actividad (bitácora), usando `analytics.ts` para normalizar y cruzar sesiones de escaneo con el roster de armadores (ver "dos espacios de ID" en `ARQUITECTURA.md`). Usa el componente `Panel` de `src/components/ui/panel.tsx` — este archivo existe y el módulo funciona correctamente (una revisión anterior había detectado que este import apuntaba a un archivo inexistente; eso ya no es así en el código actual).

### 2.14 Configuración (`mod-configuracion.tsx`)
Ajustes operativos de la empresa: turnos (mañana, tarde, noche), **horario y duración del almuerzo** (pausa automática del cronómetro del armador — ver 3.4), meta de productividad por hora, meta de minutos por zona, y costo por hora por defecto para armadores sin uno propio.

### 2.15 Funciones exclusivas de super admin
Gestión de empresas y usuarios a nivel global del sistema (fuera del alcance de una empresa individual).

## 3. Aplicación del armador (`/armador`)

La app del armador tiene **tres pestañas**: `mapa`, `zona` y `yo`. No existe una pestaña de "Equipo" en esta app.

### 3.1 Flujo del armador
1. El armador inicia sesión con su cédula (ver `ARQUITECTURA.md`, sección 5.1).
2. Si la jornada de la empresa no está activa o está pausada, la app se lo indica y bloquea el escaneo hasta que el admin la inicie/reanude.
3. Ve su zona asignada (roster) — o cualquier otra zona con membretes en cola — y se dirige físicamente a ella.
4. Escanea el código QR físico de la zona para registrar la transición (obligatorio en cada cambio de zona); el sistema le entrega el membrete pendiente más antiguo de esa zona.
5. Marca cada producto del membrete como completado, o lo marca con una **incidencia** (con una nota explicativa) si hay un problema puntual (faltante, dañado, etc.).
6. Al completar el membrete, puede tomar el siguiente de la cola de la misma zona escaneando de nuevo, o dirigirse a otra zona.

El estado de cada zona en el mapa del armador puede ser: activa (en curso por otro armador), la suya (roster), con cola (pendientes sin tomar), completada (`"done"`), o sin actividad.

### 3.2 Pausa por almuerzo (funcionalidad nueva)
La app calcula si la hora actual cae dentro de la ventana de almuerzo configurada por el admin (`Company.almuerzoInicio` + `almuerzoDuracionMin`, ver 2.14) y, si es así, pausa el flujo del armador y se lo indica en pantalla. Es una pausa automática basada en el reloj, no una acción que el armador dispare manualmente.

### 3.3 Reporte y resolución de incidencias
Cuando el armador marca un producto como `"incident"`, esto queda registrado en el membrete (`MembreteProduct.status = "incident"`, con la nota del armador). El administrador ve esta incidencia en el panel (badge, banner, alerta de zona — ver 2.8) y puede resolverla desde ahí, quedando registrado quién la resolvió, cuándo y con qué nota (`incidentResolvedAt`, `incidentResolvedBy`, `incidentResolvedByName`, `incidentResolutionNote`).

**Limitación vigente**: la resolución de la incidencia por parte del administrador no se refleja de vuelta en la app del armador — el producto sigue mostrando el ícono de incidencia (⚠) independientemente de que el admin ya la haya marcado como resuelta. Ver `MEJORAS.md`.

**Limitación vigente**: no existe una forma de desmarcar un producto ya marcado como completado desde la app del armador.

### 3.4 Estado visual de zona en el mapa del admin
El color/estado que ve el administrador para cada zona en el mapa en vivo corresponde a uno de: inactiva, con roster, activa, pausada, completada o con incidencia — calculado en tiempo real a partir de los membretes de esa zona, con la incidencia abierta como la condición de mayor prioridad visual.

## 4. Notificación y resolución de incidencias

Componentes:

- **Badge de navegación**: cuenta zonas con al menos una incidencia abierta, visible en todo el panel admin.
- **Banner global en el mapa**: lista todas las incidencias abiertas de la empresa.
- **Alerta en el panel de zona seleccionada**: detalle de la incidencia de esa zona puntual.
- **Acción de resolución**: el admin marca la incidencia como resuelta (con nota opcional, capturada vía `window.prompt()` — ver `MEJORAS.md`), quedando registrada la resolución en el membrete y en la bitácora de actividad (tipo de evento `membrete_product_incident_resolved`).

## 5. Mapeo del plano de bodega

`warehouse-layout.ts` mapea zonas a posiciones visuales reales, con datos separados para Túnel 1 (Order Picking) y Túnel 2 (Retornable). `mapZoneToWarehousePosition()` deriva correctamente el túnel a partir del sector (`sector === "A" → Túnel 1`, `"B" → Túnel 2`); una limitación reportada anteriormente en este cálculo ya no está presente en el código actual.

## 6. Scripts de mantenimiento (fuera de la aplicación web)

Estos scripts no corren dentro del sandbox de desarrollo (requieren red hacia Firestore) y se ejecutan manualmente desde una terminal con acceso a internet:

- `scripts/seed-people.mjs`: asegura que ciertas personas (el super admin definido, y un admin de prueba) puedan entrar al sistema, creando la invitación correspondiente si no existe.
- `scripts/delete-ghost-admins.mjs`: elimina usuarios "fantasma" creados por un mecanismo de login anterior con un ID que no correspondía al UID real de Google, verificando primero que no tengan un campo `uid` válido antes de borrarlos.
