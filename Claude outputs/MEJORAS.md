# Mejoras y hoja de ruta — Siamo.Indicador

> Actualizado el 19 de septiembre de 2026. Lista de mejoras derivadas de los hallazgos en `ERRORES.md`, organizadas por área. Cada punto referencia el hallazgo correspondiente donde aplica. Los puntos ya resueltos desde la versión anterior se marcan como tales.

## 0. Resueltos desde la última revisión

- ~~Migrar "Repetir ciclo" al modelo moderno~~ — el modelo de "ciclo" completo fue eliminado por decisión del cliente; ya no aplica.
- ~~Retirar los valores de enum inalcanzables `cicloEstado: "activo"`~~ — el tipo completo fue eliminado.
- ~~Corregir `mapZoneToWarehousePosition()` para distinguir Túnel 1/2~~ — ya distingue correctamente por sector.
- ~~Corregir el import roto de `Panel` en `mod-historial.tsx`~~ — el archivo ya existe y el módulo funciona.

## 1. Decisión de producto urgente

1. **Resolver la contradicción de `mod-membretes.tsx`** (ref. `ERRORES.md` §4.1). Hay que decidir explícitamente, con el cliente, entre dos caminos: (a) quitar el botón "+ Asignar"/"Quitar" de `mod-membretes.tsx` para que el sistema completo respete "el supervisor no asigna tareas puntuales, solo dónde trabaja cada armador", como se pidió; o (b) si el negocio de verdad necesita una vía de excepción manual (por ejemplo, para destrabar un membrete atascado), mantenerla pero corregir el comentario del archivo para que no diga lo contrario, y dejar claro en la interfaz que es una acción de excepción, no el flujo normal. Cualquiera de las dos opciones es rápida de implementar una vez decidida — lo urgente es la decisión, no el código.

## 2. Seguridad — prioridad inmediata (sin cambios desde la revisión anterior)

2. **Eliminar el mecanismo de confianza ciega del modo demo** (ref. `ERRORES.md` §1.1). Si se sigue necesitando, debe generar su sesión mediante una ruta de servidor que valide explícitamente `NEXT_PUBLIC_DEMO_ENABLED` también del lado del servidor, y emita un token firmado con alcance y expiración cortos.
3. **Conectar `/api/auth` (§1.3) y retirar la verificación de presencia de cookie en `middleware.ts` (§1.2)**. El endpoint que ya firma correctamente una cookie `httpOnly` debe ser el único mecanismo de sesión; el middleware debe verificar esa cookie (firma/expiración), no solo confirmar que existe.
4. **Eliminar o proteger `/api/debug-admin`** (§1.4). Si se necesita para diagnóstico, debe exigir sesión de `super_admin` verificada server-side.
5. **Sincronizar la expiración de la cookie de sesión con la sesión real de Firebase Auth** (§1.5), o implementar un refresco silencioso.
6. Una vez resueltos 2–5, hacer una revisión de penetración básica del flujo de login completo antes de considerar el sistema listo para datos de producción sensibles.

## 3. Unificación del modelo de datos

7. **Terminar de migrar `mod-desempeno.tsx`, `mod-reportes.tsx`, `mod-zona-monitor.tsx` y `zone-analytics.ts` al modelo Membrete-derivado** (ref. `ERRORES.md` §2.1), siguiendo el patrón que ya se aplicó parcialmente en `mod-pantalla.tsx` (usar membretes completados como fuente primaria, con sesiones como respaldo). Es el trabajo de mayor impacto en confiabilidad de todo el backlog.
8. Una vez migrados todos los módulos, **eliminar formalmente los campos `@deprecated` de `Zone`** del esquema y de `types/index.ts`.
9. **Unificar la fórmula del índice operacional** entre `mod-desempeno.tsx` y `mod-reportes.tsx` en una sola función compartida.
10. **Reemplazar los datos simulados por datos reales o etiquetarlos explícitamente como estimación** (§2.3): la tasa de error fija del 8% y el valor de "satisfacción" aleatorio de `mod-zona-monitor.tsx` deberían mostrar "sin datos suficientes" en vez de un número que aparenta ser real.
11. **Unificar los umbrales de "satisfacción"** entre `mod-pantalla.tsx` y `mod-zona-monitor.tsx` en una sola constante compartida.

## 4. Integridad de datos

12. **Implementar deduplicación de membretes al reimportar desde SAP** (§3.2, ya confirmado en el código): antes de crear un `Membrete` en `importSapData()`, verificar si ya existe uno con la misma zona/pallet/ruta (o el criterio que defina el equipo funcional) y decidir si se actualiza en vez de duplicar, o si se avisa al usuario antes de continuar.
13. **Implementar limpieza en cascada** (o al menos validación previa que impida el borrado) al eliminar zonas, armadores o membretes (§3.1), y corregir el texto del modal de confirmación en `mod-zonas.tsx`.
14. **Reauditar las escrituras a Firestore en busca de campos `undefined` explícitos** (§3.3) — no se repitió la auditoría línea por línea en esta revisión; conviene una pasada dedicada, especialmente en las funciones tocadas más recientemente (asignación de roster, jornada).

## 5. Funcionalidad incompleta

15. **Aclarar el alcance real de "Finalizar jornada"** (§4.2): decidir si debe (o no) liberar el roster de zona y cerrar los membretes activos de los armadores al finalizar, y ajustar el código o el texto del botón según lo que se decida.
16. **Cerrar el ciclo de resolución de incidencias hacia el armador** (§4.3): cuando el admin marca una incidencia como resuelta, la app del armador debe reflejarlo en la siguiente sincronización.
17. Permitir **desmarcar un producto** ya marcado como completado desde la app del armador.
18. **Reemplazar `window.prompt()` por un modal propio** para la resolución de incidencias, consistente con el resto de la interfaz.
19. **Renombrar los tipos de `ActivityType` que usa la Jornada** (§4.4): `iniciarJornada`/`pausarJornada`/`reanudarJornada`/`finalizarJornada` deberían loguear con tipos propios (p. ej. `jornada_iniciada`, `jornada_pausada`...) en vez de reutilizar los antiguos `cycle_*`, para no confundir a quien lea la bitácora.
20. Revisar y decidir explícitamente el destino del componente `Toast` de `mod-analiticas.tsx` (conectarlo a los flujos que lo necesitan o retirarlo), del botón "Replicar" sin efecto en `mod-zona-monitor.tsx`, y del valor "+1" hardcodeado.
21. Decidir el destino de `src/app/api/armador-finish-cycle/route.ts`: es código muerto que además describe el modelo de "ciclo" ya eliminado — es un buen candidato para borrar directamente (requiere permiso de borrado en el dispositivo del usuario, por eso no se hizo automáticamente).

## 6. Claridad del proyecto (nuevo)

22. **Decidir el destino del scaffolding de Tailwind/shadcn** (`tailwind.config.ts`, `components.json`, dependencias `@radix-ui/*`, `class-variance-authority`, `tailwind-merge`, `react-hot-toast`): o se adopta de verdad para nuevas pantallas, o se retira para no confundir a quien llegue al proyecto esperando encontrarlo funcionando.

## 7. Mejoras de arquitectura a mediano plazo

23. Considerar mover los módulos que aún dependen de una sola lectura inicial hacia suscripciones en tiempo real (`onSnapshot`), siguiendo el patrón ya usado en los módulos modernos.
24. Evaluar si la exportación de reportes (actualmente HTML) debería migrar a un formato de archivo real (Excel/PDF) si el objetivo es que el usuario lo comparta fuera del sistema.
25. Extender las notificaciones de incidencias más allá de la interfaz interna (correo o push) para administradores sin el panel abierto.
26. Una vez resuelto el punto 7 (unificación de modelo), documentar formalmente en el código cuál es la única fuente de verdad para el estado de una zona.

## 8. Cómo usar este documento

Este backlog no está en Jira ni en ninguna herramienta externa — es intencionalmente un documento de referencia técnica. Se recomienda que, al tomar cualquiera de estos puntos para implementación, se cree la tarea correspondiente en la herramienta de seguimiento que use el equipo, enlazando de vuelta a la sección relevante de este documento y de `ERRORES.md`.
