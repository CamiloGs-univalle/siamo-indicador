# Errores y hallazgos conocidos — Siamo.Indicador

> Actualizado el 19 de septiembre de 2026, revisando el código actual en disco (incluyendo cambios sin commitear) tras el rediseño del modelo de asignación (roster + jornada) y la eliminación del modelo de "ciclo". Organizado por severidad. Los hallazgos ya resueltos desde la revisión anterior se marcan como tales y se retiran de la lista activa; se agregan los hallazgos nuevos encontrados en esta revisión.

## 0. Resueltos desde la última revisión

- **Pestaña "Equipo" en la app del armador**: aclarado — nunca existió; era una imprecisión de documentación, ya corregida en `FUNCIONALIDADES.md`.
- **`mod-historial.tsx` importaba `Panel` desde un archivo inexistente**: `src/components/ui/panel.tsx` ya existe y el módulo funciona.
- **Enums inalcanzables `cicloEstado: "activo"`**: el tipo `cicloEstado` y todo el modelo de "ciclo" fueron eliminados por completo — ya no aplica.
- **`mapZoneToWarehousePosition()` siempre devolvía Túnel 1**: la función actual deriva correctamente el túnel a partir del sector (`"A"` → Túnel 1, `"B"` → Túnel 2).
- **"Repetir ciclo" no funcional en instalaciones modernas**: la función completa y el modelo de "ciclo" fueron eliminados; ya no hay una función equivalente que pueda quedar desactualizada.

## 1. Seguridad (crítico — sin cambios respecto a la revisión anterior)

### 1.1 El modo demo otorga acceso administrativo sin verificación de servidor
`src/lib/auth-context.tsx` implementa un "modo demo" donde `handleDemo(role)` (en `login/page.tsx`) establece dos cookies simples vía `document.cookie`: `auth-token=demo-${role}` y `demo-role=${role}`. `getDemoRole()` y `createDemoUser(role)` construyen un objeto de usuario completo (`AppUser`) con el rol solicitado **sin ninguna verificación del lado del servidor**.

`NEXT_PUBLIC_DEMO_ENABLED` solo controla si los **botones** de demo aparecen en la interfaz. **No desactiva el mecanismo de confianza en la cookie.** Cualquier persona que pueda abrir las herramientas de desarrollador del navegador y establecer esas dos cookies manualmente obtiene acceso como `super_admin`, `admin` o `armador`, sin credenciales, independientemente del valor de `NEXT_PUBLIC_DEMO_ENABLED` en producción.

**Impacto**: acceso administrativo completo sin autenticación, en cualquier entorno donde este código esté desplegado.

### 1.2 El middleware no verifica la autenticidad de la sesión
`src/middleware.ts` protege las rutas del panel comprobando únicamente que la cookie `auth-token` exista y no esté vacía — no verifica firma, no decodifica el token, no consulta a Firebase de ninguna forma.

Esta cookie se establece desde el cliente vía `document.cookie` (no `httpOnly`).

**Impacto**: sumado a 1.1, cualquiera puede fabricar una sesión válida a ojos del middleware con dos líneas en la consola del navegador.

### 1.3 `/api/auth/route.ts` es código muerto — la implementación segura existe pero no se usa
Existe una ruta que sí genera una cookie `httpOnly` firmada correctamente en el servidor usando el SDK de administración de Firebase. Se confirmó nuevamente, mediante búsqueda exhaustiva de referencias (`fetch("/api/auth")`) en todo el código fuente, que **ningún componente del frontend la invoca**.

### 1.4 `/api/debug-admin` es un endpoint de diagnóstico sin autenticación
`src/app/api/debug-admin/route.ts` es un `GET` sin ninguna verificación de sesión ni rol. Expone si las variables de entorno de Firebase Admin están configuradas, el valor completo de `SUPER_ADMIN_EMAILS`, y si existe el documento de usuario con UID hardcodeado `ipCVCsAWgbWoTp6gz14ruUQ1nyt2` (y en ese caso, su rol y su email).

**Impacto**: cualquiera con la URL puede confirmar qué variables de entorno están configuradas y obtener el rol/email de un usuario específico del sistema.

### 1.5 Vencimiento de sesión inconsistente con Firebase Auth
La cookie `auth-token` tiene `max-age=3600` (1 hora) y nunca se refresca mientras el usuario navega, mientras que la sesión real de Firebase Auth normalmente dura más. Un usuario activo es expulsado a `/login` después de una hora aunque su sesión de Firebase siga siendo válida.

## 2. Consistencia de datos (alto impacto en confiabilidad de indicadores)

### 2.1 Dos modelos de datos de zona coexistiendo (parcialmente mejorado)
`Zone` tiene un conjunto de campos marcados `@deprecated` que en teoría fueron reemplazados por un cálculo derivado de los membretes activos de cada zona (`displayStatus(zone)`). Estado actual:

- `mod-mapa.tsx` usa el modelo moderno de forma completa.
- `mod-pantalla.tsx` **mejoró**: sus cálculos de productividad por hora y de ranking ahora priorizan los membretes completados del día, con las sesiones de escaneo como respaldo cuando no hay membretes — reduce la desincronización con el mapa en vivo, aunque no la elimina del todo (el error rate sigue siendo una constante fija, ver 2.3).
- `mod-desempeno.tsx`, `mod-reportes.tsx`, `mod-zona-monitor.tsx` y `zone-analytics.ts` (usado por `mod-analiticas.tsx`) **siguen leyendo los campos deprecados directamente, sin ningún fallback a membretes**.

**Impacto**: los indicadores de desempeño, los reportes exportados y el monitor de zona pueden no reflejar el estado real y actual de la operación tal como lo muestra el mapa en vivo.

### 2.2 Dos fórmulas incompatibles de "índice operacional"
`mod-desempeno.tsx` calcula un índice operacional por armador con una fórmula. `mod-reportes.tsx`, dentro de `handleExportHTML()`, calcula un índice operacional **por periodo** con una fórmula distinta. Ambos se presentan al usuario bajo el mismo nombre, pero no son comparables entre sí. No se detectaron cambios en esta revisión — sigue pendiente la unificación (`MEJORAS.md`).

### 2.3 Datos simulados presentados como métricas reales
`mod-zona-monitor.tsx` sigue usando `Math.round(70 + Math.random() * 25)` como valor de "satisfacción" cuando no hay datos reales de sesión para una hora determinada.

Tanto `mod-zona-monitor.tsx` como el detalle de zona de `mod-pantalla.tsx` calculan una "tasa de error" fija de `Math.floor(tasks * 0.08)` (8%) que no proviene de datos de incidencias reales.

**Impacto**: un administrador que revise estos paneles no tiene forma de distinguir, sin leer el código, cuáles números son reales y cuáles son estimaciones o rellenos.

### 2.4 Umbrales de "satisfacción" inconsistentes entre módulos
`mod-pantalla.tsx` y `mod-zona-monitor.tsx` siguen usando cortes distintos para clasificar el mismo tipo de métrica. Sin cambios respecto a la revisión anterior.

## 3. Integridad referencial

### 3.1 No hay limpieza en cascada al eliminar
`deleteZone()`, `deleteArmador()` y `deleteMembrete()` (en `src/lib/firestore.ts`) eliminan únicamente el documento correspondiente, sin limpiar las referencias que otras entidades mantienen hacia él. El modal de confirmación de borrado en `mod-zonas.tsx` sigue afirmando (incorrectamente) que el borrado es en cascada.

### 3.2 Posible duplicación de membretes al reimportar desde SAP — confirmado
Se revisó directamente `importSapData()` en `src/lib/firestore.ts`: agrupa las filas por zona y luego por `pallet`+`ruta`, y **crea un documento `Membrete` nuevo por cada grupo sin verificar si ya existe uno equivalente**. La única deduplicación real ocurre a nivel de `Zone` (por `code`). Si el mismo archivo (o uno superpuesto) se reimporta, se generan membretes duplicados. Este hallazgo estaba antes marcado "a confirmar con el equipo funcional"; con esta revisión queda confirmado en el código.

### 3.3 Escrituras probables de `undefined` a Firestore
El cliente de Firestore se sigue inicializando con `getFirestore(app)` **sin** `ignoreUndefinedProperties: true`. No se re-auditó línea por línea cada función de escritura en esta revisión; se recomienda una pasada específica antes de dar este punto por cerrado (ver `MEJORAS.md`).

## 4. Funcionalidad incompleta, inconsistente o contradictoria

### 4.1 `mod-membretes.tsx` contradice el modelo de asignación vigente (hallazgo nuevo, el más importante de esta revisión)
El módulo de Membretes conserva una acción "+ Asignar" / "Quitar" que llama a `assignMembreteToArmador()` / `unassignMembreteFromArmador()` (ambas siguen exportadas en `firestore.ts`), permitiendo que el supervisor asigne o quite manualmente el armador de un membrete puntual. Esto es exactamente el comportamiento que el cliente pidió eliminar ("ya el supervisor no asigna eso, cada armador lo hace a su voluntad") y que sí se eliminó correctamente de `mod-mapa.tsx` y `mod-asignacion.tsx`.

Agravante: el propio comentario de encabezado de `mod-membretes.tsx` afirma "Este módulo ya NO asigna membretes puntuales a un armador — solo crea/edita/elimina membretes", lo cual es falso a la luz del código real del mismo archivo. No hay forma de saber, sin abrir el archivo, si este control fue reintroducido a propósito (una excepción operativa que alguien decidió mantener) o si es un remanente que debería haberse quitado junto con el resto del modelo de ciclo.

**Impacto**: el sistema en producción permite hoy exactamente la acción que el cliente pidió expresamente eliminar. Requiere una decisión de producto explícita — ver `MEJORAS.md`.

### 4.2 "Finalizar jornada" no libera el roster ni los membretes activos
`finalizarJornada()` solo cambia `Company.jornadaActiva` a `false` y limpia `jornadaPausedAt` — no toca `Armador.zonaAsignadaCode` de ningún armador ni el estado de sus membretes activos. El texto de la interfaz ("Finalizar") puede sugerir un cierre más completo del que realmente ocurre. Es la versión actualizada del hallazgo que antes aplicaba a "Finalizar/Cancelar ciclo".

### 4.3 Resolución de incidencias invisible para el armador
La resolución de incidencias que hace el administrador (ver `FUNCIONALIDADES.md` §4) no se refleja en la app del armador: el producto sigue mostrando el ícono de incidencia (⚠) sin importar que ya haya sido atendida.

### 4.4 Reutilización de valores de `ActivityType` de "ciclo" para la Jornada
`iniciarJornada()`/`pausarJornada()`/`reanudarJornada()`/`finalizarJornada()` registran sus eventos en la bitácora usando los tipos `"cycle_started"`/`"cycle_paused"`/`"cycle_resumed"`/`"cycle_completed"` — nombres que pertenecían al modelo de "ciclo" ya eliminado. Funcionalmente no rompe nada (son solo etiquetas de bitácora), pero puede confundir a quien lea el historial de actividad o el código pensando que el ciclo sigue existiendo.

## 5. Otros hallazgos menores

- El mecanismo "oficial" de incidencia a nivel de membrete completo (`cancelMembrete()`) sigue sin invocarse desde ningún flujo real de la interfaz — el mecanismo que sí se usa es el de nivel de producto (`markMembreteProduct(..., "incident", note)`).
- El componente `Toast` de `mod-analiticas.tsx` nunca llega a mostrarse: en el código actual solo se le llama para cerrarse (`setToast(null)`), nunca para desplegar un mensaje.
- El botón "Replicar" en `mod-zona-monitor.tsx` sigue sin ningún manejador de clic (no-op).
- El valor "+1" incremental hardcodeado en el KPI "Promedio general" de `mod-zona-monitor.tsx` sigue presente, sin corresponder a un cálculo real.
- No existe una interfaz para "desmarcar" un producto ya marcado como completado desde la app del armador.
- El uso de `window.prompt()` para la resolución de incidencias en `mod-mapa.tsx` sigue siendo inconsistente con el resto de la interfaz, que usa modales propios para otras confirmaciones.
- `src/app/api/armador-finish-cycle/route.ts` sigue siendo código muerto (nadie lo invoca) y además su lógica describe el modelo de "ciclo" ya eliminado — sería inconsistente con el modelo de datos actual si alguna vez se reconectara. Candidato a borrado (ver `MEJORAS.md`).
- El proyecto tiene configuración de Tailwind/shadcn (`tailwind.config.ts`, `components.json`, dependencias `@radix-ui/*`) instalada pero sin usar en ninguna parte del código — puede llevar a un desarrollador nuevo a asumir, incorrectamente, que el proyecto usa Tailwind.

## 6. Resumen de prioridad recomendada

| # | Hallazgo | Severidad | Esfuerzo estimado de corrección |
|---|---|---|---|
| 1.1 | Bypass de modo demo | Crítica | Bajo |
| 1.2 | Middleware sin verificación real | Crítica | Medio (requiere activar 1.3) |
| 1.4 | `/api/debug-admin` sin autenticación | Alta | Muy bajo |
| 1.3 | `/api/auth` desconectado | Alta (es la solución a 1.2) | Bajo |
| 4.1 | `mod-membretes.tsx` contradice el modelo de asignación confirmado | Alta (decisión de producto) | Bajo (una vez decidido qué hacer) |
| 2.1 | Modelos de datos de zona coexistiendo | Alta | Alto (parcialmente en progreso) |
| 3.2 | Duplicación de membretes al reimportar SAP | Media-Alta | Medio |
| 2.2 | Fórmulas de índice operacional incompatibles | Media-Alta | Medio |
| 2.3 | Datos simulados presentados como reales | Media-Alta | Medio |
| 3.3 | Posibles escrituras de `undefined` | Media | Bajo (requiere reauditar) |
| 3.1 | Sin limpieza en cascada | Media | Medio |
| 1.5 | Expiración de sesión a 1 hora | Media | Bajo |
| 4.2 | "Finalizar jornada" no libera roster/membretes | Media | Bajo |
| 4.3–4.4 | Funcionalidad incompleta / etiquetas heredadas | Media-Baja | Variable |
| 2.4 | Umbrales inconsistentes | Baja | Bajo |
| — | Scaffolding de Tailwind/shadcn sin usar | Baja (claridad de proyecto) | Bajo (documentar o retirar) |
