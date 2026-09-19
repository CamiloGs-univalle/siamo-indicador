# Funcionalidades — Siamo.Indicador

> Manual funcional actualizado tras una auditoría completa del código (septiembre 2026). Reemplaza la versión anterior, que describía un "Módulo Jornada" y estados de zona (`"not"`/`"assigned"`) que no existen en el sistema actual.

Este documento describe qué hace cada módulo tal como está implementado hoy. Para el detalle de errores conocidos y mejoras propuestas sobre cada uno, ver `ERRORES.md` y `MEJORAS.md`.

## 1. Roles

- **Super admin**: gestiona empresas y usuarios del sistema completo. Bootstrap vía la variable `SUPER_ADMIN_EMAILS` (ver `ARQUITECTURA.md`).
- **Admin**: gestiona la operación de una empresa: carga de trabajo, zonas, armadores, membretes, indicadores y reportes.
- **Armador**: opera desde la app móvil (`/armador`), ejecuta el picking físico.

## 2. Módulos del panel de administración

### 2.1 Pantalla (`mod-pantalla.tsx`)
Vista general de la operación en tiempo real. Usa el modelo moderno Membrete-derivado: el estado de cada zona se calcula a partir de sus membretes activos, no de un campo estático de la zona. Muestra también un indicador de "satisfacción"/error por zona (ver nota sobre datos simulados en `ERRORES.md`).

### 2.2 Carga (`mod-carga.tsx`)
Permite ingresar membretes (órdenes de picking) manualmente o importarlos masivamente desde Excel (`excel-utils.ts`). Cada membrete registra ruta, pallet, total de pallets, fecha de entrega, familia, camión, zona y la lista de productos a recoger.

### 2.3 Asignación (`mod-asignacion.tsx`)
Permite asignar membretes a armadores y zonas, e iniciar/finalizar el ciclo de trabajo de un armador. Incluye botones "Finalizar" y "Cancelar ciclo" — ver `ERRORES.md` sobre el alcance real de estas acciones — y una función "Repetir ciclo" pensada para volver a asignar el último trabajo de un armador.

### 2.4 Equipo (`mod-equipo.tsx`)
Gestión del roster de armadores de la empresa: alta, edición, colores personales de identificación en el mapa, cédula, estado de ciclo.

### 2.5 Zonas (`mod-zonas.tsx`)
Gestión de las zonas físicas de la bodega: código, sector (A/B), posición, prioridad. Incluye eliminación de zonas — ver `ERRORES.md` respecto al alcance real del borrado (no hay limpieza en cascada).

### 2.6 Membretes (`mod-membretes.tsx`)
Vista y edición detallada de membretes individuales, incluyendo el estado de cada producto dentro del membrete.

### 2.7 QR (`mod-qr.tsx`)
Generación e impresión de los códigos QR físicos que se colocan en cada zona de la bodega. El payload codificado es el literal `TRZ://zona/{code}`, que la app del armador decodifica al escanear para registrar la transición de zona. Este mecanismo es de uso activo y obligatorio en el flujo operativo — no es una función legada ni opcional.

### 2.8 Mapa (`mod-mapa.tsx`)
Mapa visual en vivo del piso de bodega (usa `map-floor.tsx` y `warehouse-layout.ts` para el posicionamiento). Usa el modelo moderno Membrete-derivado. Incluye:
- El punto de color en la esquina de cada zona, que refleja el **estado operativo** de la zona (inactiva, asignada, activa, pausada, completada, con incidencia) — este color es independiente del color personal del armador asignado.
- Un banner de "Incidencias abiertas" cuando existen productos marcados con incidencia en cualquier zona de la empresa.
- Un panel de detalle por zona seleccionada, que muestra las incidencias abiertas de esa zona específica con un botón "Marcar resuelta".
- Un badge en la navegación (`admin-nav.tsx`) con el conteo de zonas con incidencias abiertas, visible desde cualquier pantalla del panel.

### 2.9 Analíticas (`mod-analiticas.tsx`)
Indicadores agregados de la operación, calculados mediante `zone-analytics.ts`. **Usa el modelo legado** (lee campos deprecados de `Zone` directamente) — ver `ARQUITECTURA.md` sección 4.3 sobre las implicaciones de esto.

### 2.10 Desempeño (`mod-desempeno.tsx`)
Calcula un "índice operacional" por armador a partir de varios componentes (productividad, disponibilidad, calidad, etc.). **Usa el modelo legado**. La fórmula de este módulo difiere de la usada en Reportes (ver 2.12 y `ERRORES.md`).

### 2.11 Zona Monitor (`mod-zona-monitor.tsx`)
Vista de monitoreo por zona con métricas de "satisfacción" a lo largo del día. **Usa el modelo legado**. Cuando no hay datos reales de sesión para una hora determinada, el módulo genera un valor de "satisfacción" simulado — ver `ERRORES.md` sobre este comportamiento y sus riesgos.

### 2.12 Reportes (`mod-reportes.tsx`)
Generación de reportes exportables (incluye exportación a HTML). Calcula su propio "índice operacional" **por periodo**, con una fórmula distinta a la de Desempeño — ver `ERRORES.md` sobre la discrepancia entre ambas fórmulas.

### 2.13 Historial (`mod-historial.tsx`)
Consulta de eventos históricos de actividad (bitácora), usando `analytics.ts` para normalizar y cruzar sesiones de escaneo con el roster de armadores (ver el problema de los "dos espacios de ID" en `ARQUITECTURA.md`).

### 2.14 Configuración (`mod-configuracion.tsx`)
Ajustes generales de la empresa.

### 2.15 Funciones exclusivas de super admin
Gestión de empresas y usuarios a nivel global del sistema (fuera del alcance de una empresa individual).

## 3. Aplicación del armador (`/armador`)

La app del armador tiene **tres pestañas**: `mapa`, `zona` y `yo`. (No existe una pestaña de "Equipo" en esta app — cualquier referencia a ella en documentación previa era incorrecta.)

### 3.1 Ciclo del armador
1. El armador inicia sesión con su cédula (ver `ARQUITECTURA.md`, sección 5.1).
2. Ve el membrete que tiene asignado y la zona a la que debe dirigirse.
3. Escanea el código QR físico de la zona para registrar la transición (obligatorio en cada cambio de zona).
4. Marca cada producto del membrete como completado, o lo marca con una **incidencia** (con una nota explicativa) si hay un problema puntual con ese producto (faltante, dañado, etc.).
5. Al completar el membrete, el ciclo avanza según la asignación hecha por el admin.

### 3.2 Reporte y resolución de incidencias
Cuando el armador marca un producto como `"incident"`, esto queda registrado en el membrete (`MembreteProduct.status = "incident"`, con la nota del armador). El administrador ve esta incidencia en el panel (badge, banner, alerta de zona — ver 2.8) y puede resolverla desde ahí, quedando registrado quién la resolvió, cuándo y con qué nota (`incidentResolvedAt`, `incidentResolvedBy`, `incidentResolvedByName`, `incidentResolutionNote`).

**Limitación actual**: la resolución de la incidencia por parte del administrador no se refleja de vuelta en la app del armador — el producto sigue mostrando el ícono de incidencia (⚠) en su pantalla independientemente de que el admin ya la haya marcado como resuelta. Ver `MEJORAS.md`.

### 3.3 Estado visual de zona en el mapa del admin
El color/estado que ve el administrador para cada zona en el mapa en vivo corresponde a uno de: inactiva, asignada, activa, pausada, completada o con incidencia — calculado en tiempo real a partir de los membretes de esa zona, con la incidencia abierta como la condición de mayor prioridad visual.

## 4. Notificación y resolución de incidencias (funcionalidad añadida en esta iteración)

Esta es una funcionalidad nueva, construida para cerrar un vacío detectado en el sistema: el reporte de incidencias por producto que hace el armador (sección 3.2) no llegaba antes de forma visible al administrador. Componentes:

- **Badge de navegación**: cuenta zonas con al menos una incidencia abierta, visible en todo el panel admin.
- **Banner global en el mapa**: lista todas las incidencias abiertas de la empresa.
- **Alerta en el panel de zona seleccionada**: detalle de la incidencia de esa zona puntual.
- **Acción de resolución**: el admin marca la incidencia como resuelta (con nota opcional), quedando registrada la resolución en el membrete y en la bitácora de actividad (tipo de evento `membrete_product_incident_resolved`).

## 5. Scripts de mantenimiento (fuera de la aplicación web)

Estos scripts no corren dentro del sandbox de desarrollo (requieren red hacia Firestore) y se ejecutan manualmente desde una terminal con acceso a internet:

- `scripts/seed-people.mjs`: asegura que ciertas personas (el super admin definido, y un admin de prueba) puedan entrar al sistema, creando la invitación correspondiente si no existe.
- `scripts/delete-ghost-admins.mjs`: elimina usuarios "fantasma" creados por un mecanismo de login anterior con un ID que no correspondía al UID real de Google, verificando primero que no tengan un campo `uid` válido antes de borrarlos.
