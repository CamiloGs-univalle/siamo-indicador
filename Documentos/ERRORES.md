# Errores y hallazgos conocidos — Siamo.Indicador

> Documento nuevo, producto de una auditoría completa del código fuente realizada en septiembre de 2026, actuando como equipo de desarrollo revisando el sistema de punta a punta. Organizado por severidad. Cada hallazgo indica el archivo involucrado y, cuando aplica, referencia cruzada a `MEJORAS.md` para la remediación propuesta.

## 1. Seguridad (crítico)

### 1.1 El modo demo otorga acceso administrativo sin verificación de servidor
`src/lib/auth-context.tsx` implementa un "modo demo" donde `handleDemo(role)` (en `login/page.tsx`) establece dos cookies simples vía `document.cookie`: `auth-token=demo-${role}` y `demo-role=${role}`. Las funciones `getDemoRole()` y `createDemoUser(role)` construyen un objeto de usuario completo (`AppUser`) con el rol solicitado **sin ninguna verificación del lado del servidor**.

La variable `NEXT_PUBLIC_DEMO_ENABLED` solo controla si los **botones** de demo aparecen en la interfaz. **No desactiva el mecanismo de confianza en la cookie.** Cualquier persona que pueda abrir las herramientas de desarrollador del navegador y establecer esas dos cookies manualmente obtiene acceso como `super_admin`, `admin` o `armador`, sin credenciales, **independientemente del valor de `NEXT_PUBLIC_DEMO_ENABLED` en producción**.

**Impacto**: acceso administrativo completo sin autenticación, en cualquier entorno donde este código esté desplegado, sin que el valor de la variable de entorno lo impida.

### 1.2 El middleware no verifica la autenticidad de la sesión
`src/middleware.ts` protege las rutas del panel comprobando únicamente que la cookie `auth-token` exista y no esté vacía — no verifica firma, no decodifica el token, no consulta a Firebase de ninguna forma. Es, en la práctica, una comprobación de "¿existe una cadena de texto en esta cookie?", no una verificación de identidad.

Esta cookie se establece desde el cliente vía `document.cookie` (no `httpOnly`, por lo tanto legible y editable desde JavaScript en el propio navegador y visible a cualquier script que corra en la página).

**Impacto**: sumado a 1.1, cualquiera puede fabricar una sesión válida a ojos del middleware con dos líneas en la consola del navegador.

### 1.3 `/api/auth/route.ts` es código muerto — la implementación segura existe pero no se usa
Existe una ruta que sí genera una cookie `httpOnly` firmada correctamente en el servidor usando el SDK de administración de Firebase. Se confirmó, mediante búsqueda exhaustiva de referencias `fetch("/api/auth")` en todo el código fuente, que **ningún componente del frontend la invoca**. El mecanismo de sesión real y activo es el descrito en 1.2, que es inseguro; la implementación segura está escrita pero desconectada.

### 1.4 `/api/debug-admin` es un endpoint de diagnóstico sin autenticación
`src/app/api/debug-admin/route.ts` es un `GET` sin ninguna verificación de sesión ni rol. Al ser invocado, expone:
- Si las variables de entorno de Firebase Admin están configuradas y la longitud de la clave privada.
- El valor completo de `SUPER_ADMIN_EMAILS`.
- Si existe el documento de usuario con UID hardcodeado `ipCVCsAWgbWoTp6gz14ruUQ1nyt2`, y en ese caso, su rol y su email.

**Impacto**: cualquiera con la URL puede confirmar qué variables de entorno están configuradas y obtener el rol/email de un usuario específico del sistema. Debe eliminarse o protegerse antes de cualquier despliegue con datos reales.

### 1.5 Vencimiento de sesión inconsistente con Firebase Auth
La cookie `auth-token` tiene `max-age=3600` (1 hora) y nunca se refresca mientras el usuario navega. La sesión real de Firebase Auth normalmente dura más. Resultado: un usuario activo es expulsado a `/login` por el middleware después de una hora, aunque su sesión de Firebase siga siendo válida — una fricción de producto que además es síntoma de que la cookie de sesión y la sesión real de Auth nunca estuvieron diseñadas para vivir sincronizadas.

## 2. Consistencia de datos (alto impacto en confiabilidad de indicadores)

### 2.1 Dos modelos de datos de zona coexistiendo
Como se detalla en `ARQUITECTURA.md` §4.3, `Zone` tiene un conjunto de campos marcados `@deprecated` (`status`, `armadorId`, `incidentNote`, `incidentClass`, `avgMinutes`, `ruta`, `pallet`) que en teoría fueron reemplazados por un cálculo derivado de los membretes activos de cada zona (`displayStatus(zone)`). Sin embargo:

- `mod-pantalla.tsx` y `mod-mapa.tsx` usan el modelo moderno.
- `mod-desempeno.tsx`, `mod-reportes.tsx`, `mod-zona-monitor.tsx` y `zone-analytics.ts` (usado por `mod-analiticas.tsx`) **siguen leyendo los campos deprecados directamente**.

**Impacto**: los indicadores de desempeño, los reportes exportados y el monitor de zona pueden no reflejar el estado real y actual de la operación tal como lo muestra el mapa en vivo, porque leen una copia de los datos que ya no se actualiza de la misma forma que el modelo moderno.

### 2.2 Dos fórmulas incompatibles de "índice operacional"
`mod-desempeno.tsx` calcula un índice operacional por armador con una fórmula. `mod-reportes.tsx`, dentro de `handleExportHTML()`, calcula un índice operacional **por periodo** con una fórmula distinta. Ambos se presentan al usuario bajo el mismo nombre ("índice operacional"), pero no son comparables entre sí.

Adicionalmente, en la fórmula de `mod-reportes.tsx` existe un aparente error de ponderación: el término de "disponibilidad" se multiplica por un factor extra `*0.15`, lo que limita su contribución máxima a 2.25 puntos en lugar del 15% documentado del total. Esto sub-representa la disponibilidad en el índice reportado.

### 2.3 Datos simulados presentados como métricas reales
`mod-zona-monitor.tsx` usa `Math.round(70 + Math.random() * 25)` como valor de "satisfacción" cuando no hay datos reales de sesión para una hora determinada. Este valor aleatorio es visualmente indistinguible en la interfaz de un valor calculado a partir de datos reales.

De forma similar, tanto `mod-zona-monitor.tsx` como `mod-pantalla.tsx` calculan una "tasa de error" fija de `Math.floor(tasks * 0.08)` (8%) que no proviene de datos de incidencias reales, sino de una constante aplicada al volumen de tareas.

**Impacto**: un administrador que revise estos paneles no tiene forma de distinguir, sin leer el código, cuáles números son reales y cuáles son estimaciones o rellenos. Esto es especialmente riesgoso si estos indicadores se usan para evaluar desempeño de personas.

### 2.4 Umbrales de "satisfacción" inconsistentes entre módulos
`mod-pantalla.tsx` clasifica la satisfacción con cortes en ≥75 / ≥50 / ≥25. `mod-zona-monitor.tsx` usa ≥85 / ≥70 / ≥55 para la misma métrica de nombre. Un mismo valor numérico puede aparecer como "bueno" en un módulo y "regular" en otro.

## 3. Integridad referencial

### 3.1 No hay limpieza en cascada al eliminar
`deleteZone()`, `deleteArmador()` y `deleteMembrete()` (en `src/lib/firestore.ts`) eliminan únicamente el documento correspondiente, sin limpiar las referencias que otras entidades mantienen hacia él (por ejemplo, un membrete que sigue apuntando a una zona ya eliminada, o un armador eliminado que sigue referenciado desde un membrete activo).

**Además**, el modal de confirmación de borrado en `mod-zonas.tsx` afirma en su texto que el borrado es en cascada — esa afirmación es incorrecta y puede llevar a un administrador a asumir una limpieza que no ocurre.

### 3.2 Escrituras probables de `undefined` a Firestore
El cliente de Firestore se inicializa con `getFirestore(app)` **sin** `ignoreUndefinedProperties: true` (ver `src/lib/firebase.ts`). Al menos dos funciones pasan explícitamente valores `undefined` en campos: `unassignMembreteFromArmador()` (en `firestore.ts`) y el `handleCreate()` de `mod-membretes.tsx`. Firestore rechaza esas escrituras, y en ambos casos el error se captura con un `console.error` simple, sin mostrarse al usuario — la operación puede fallar de forma silenciosa desde la perspectiva de quien está usando la interfaz.

## 4. Funcionalidad incompleta o no conectada

### 4.1 "Finalizar" / "Cancelar ciclo" no desasignan membretes
En `mod-asignacion.tsx`, estos botones únicamente limpian el campo `cicloEstado` del armador. **No desasignan** el membrete que el armador tenía activo. El texto de la interfaz sugiere una acción más completa de la que realmente ocurre.

### 4.2 "Repetir ciclo" probablemente no funcional en instalaciones modernas
`repetirCiclo()` opera sobre los campos legados basados en zona, en lugar del campo más reciente `Armador.lastCicloMembreteIds`. En instalaciones que ya migraron al modelo moderno, esta función es probable que no tenga efecto observable.

### 4.3 Valores de enum declarados pero inalcanzables
`cicloEstado: "activo"` y `PositionType: "CF"` están declarados en `types/index.ts` pero, confirmado por búsqueda en todo el código, **nunca se asignan ni se leen** en ningún flujo real.

### 4.4 Mapeo de posiciones de bodega ignora el túnel real
`mapZoneToWarehousePosition()` (en `src/lib/warehouse-layout.ts`) devuelve siempre una posición correspondiente al Túnel 1, sin importar el valor de entrada. Las zonas del Túnel 2 nunca se posicionan correctamente en el mapa visual.

### 4.5 Resolución de incidencias invisible para el armador
La funcionalidad de resolución de incidencias construida en esta misma iteración (ver `FUNCIONALIDADES.md` §4) permite al administrador marcar una incidencia como resuelta, pero esa resolución no se refleja en la app del armador: el producto sigue mostrando el ícono de incidencia (⚠) sin importar que ya haya sido atendida por el admin.

### 4.6 Discrepancia sobre la pestaña "Equipo" en la app del armador
La app del armador tiene únicamente tres pestañas: `mapa`, `zona` y `yo`. No existe una pestaña de "Equipo" — cualquier documentación o suposición anterior que la mencionara en el contexto de la app del armador (a diferencia del módulo de administración del mismo nombre) es incorrecta.

## 5. Otros hallazgos menores

- El mecanismo "oficial" de incidencia a nivel de membrete completo (`cancelMembrete()`, que en teoría produce el estado "Incidencia" a nivel de zona) es código que, según lo relevado, nunca se invoca desde ningún flujo real de la interfaz — el mecanismo de incidencia que sí se usa en la práctica es el de nivel de producto (`markMembreteProduct(..., "incident", note)`) desde la app del armador, que antes de esta iteración no llegaba de forma visible al panel de administración.
- Un posible problema de duplicación de membretes al reimportar desde SAP (a validar con el equipo funcional: confirmar si el proceso de importación de Excel detecta y evita duplicados al reimportar el mismo archivo o uno superpuesto).
- El componente `Toast` existe en el código pero, según lo relevado, nunca se dispara desde ningún flujo.
- El botón "Replicar" identificado en uno de los módulos administrativos no tiene efecto (no-op).
- Se identificó al menos un valor de "+1" incremental hardcodeado en la interfaz que no corresponde a un cálculo real sobre datos.
- No existe una interfaz para "desmarcar" un producto ya marcado como completado desde la app del armador (una vez marcado, no hay forma de revertirlo desde esa pantalla).
- El uso de `window.prompt()` para la resolución de incidencias (introducido en esta misma iteración, por simplicidad) es inconsistente con el resto de la interfaz, que usa modales propios para otras confirmaciones — ver `MEJORAS.md`.

## 6. Resumen de prioridad recomendada

| # | Hallazgo | Severidad | Esfuerzo estimado de corrección |
|---|---|---|---|
| 1.1 | Bypass de modo demo | Crítica | Bajo |
| 1.2 | Middleware sin verificación real | Crítica | Medio (requiere activar 1.3) |
| 1.4 | `/api/debug-admin` sin autenticación | Alta | Muy bajo |
| 1.3 | `/api/auth` desconectado | Alta (es la solución a 1.2) | Bajo |
| 2.1 | Dos modelos de datos de zona | Alta | Alto |
| 2.2 | Fórmulas de índice operacional incompatibles | Media-Alta | Medio |
| 2.3 | Datos simulados presentados como reales | Media-Alta | Medio |
| 3.2 | Escrituras de `undefined` | Media | Bajo |
| 3.1 | Sin limpieza en cascada | Media | Medio |
| 1.5 | Expiración de sesión a 1 hora | Media | Bajo |
| 4.1–4.6 | Funcionalidad incompleta / inconsistente | Media-Baja | Variable |
| 2.4 | Umbrales inconsistentes | Baja | Bajo |
