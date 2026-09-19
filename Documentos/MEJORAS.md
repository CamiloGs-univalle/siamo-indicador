# Mejoras y hoja de ruta — Siamo.Indicador

> Documento nuevo. Lista de mejoras derivadas de la auditoría completa registrada en `ERRORES.md`, organizadas por área. Cada punto referencia el hallazgo correspondiente donde aplica.

## 1. Seguridad — prioridad inmediata

1. **Eliminar el mecanismo de confianza ciega del modo demo** (ref. `ERRORES.md` §1.1). En lugar de que `auth-context.tsx` confíe en una cookie arbitraria, el modo demo — si se sigue necesitando — debe generar su sesión mediante una ruta de servidor que valide explícitamente que el modo demo está habilitado (`NEXT_PUBLIC_DEMO_ENABLED`, comprobado también server-side, no solo para mostrar/ocultar botones) y emita un token firmado con alcance y expiración cortos.
2. **Conectar `/api/auth` (§1.3) y retirar la verificación de presencia de cookie en `middleware.ts` (§1.2)**. El endpoint que ya firma correctamente una cookie `httpOnly` con el SDK de administración debe ser el único mecanismo de sesión; el middleware debe verificar esa cookie (firma/expiración), no solo confirmar que existe.
3. **Eliminar o proteger `/api/debug-admin`** (§1.4). Si se necesita para diagnóstico, debe exigir sesión de `super_admin` verificada server-side y no exponer valores de variables de entorno ni datos de usuarios específicos hardcodeados.
4. **Sincronizar la expiración de la cookie de sesión con la sesión real de Firebase Auth** (§1.5), o implementar un refresco silencioso de la cookie mientras la sesión de Firebase siga vigente, para evitar expulsar a usuarios activos.
5. Una vez resueltos 1–4, hacer una revisión de penetración básica del flujo de login completo antes de considerar el sistema listo para datos de producción sensibles.

## 2. Unificación del modelo de datos

6. **Migrar `mod-desempeno.tsx`, `mod-reportes.tsx`, `mod-zona-monitor.tsx` y `zone-analytics.ts` al modelo Membrete-derivado** (ref. `ERRORES.md` §2.1), siguiendo el mismo patrón ya usado en `mod-mapa.tsx` y `mod-pantalla.tsx`. Esto es el trabajo de mayor impacto en confiabilidad de todo el backlog: mientras coexistan los dos modelos, cualquier indicador fuera del mapa en vivo puede estar mostrando una realidad desincronizada.
7. Una vez migrados todos los módulos, **eliminar formalmente los campos `@deprecated` de `Zone`** (`status`, `armadorId`, `incidentNote`, `incidentClass`, `avgMinutes`, `ruta`, `pallet`) del esquema y de `types/index.ts`, y limpiar cualquier dato residual en Firestore si aplica.
8. **Unificar la fórmula del índice operacional** entre `mod-desempeno.tsx` y `mod-reportes.tsx` en una sola función compartida (por ejemplo en `src/lib/` como utilidad común), corrigiendo en el proceso el error de ponderación de la disponibilidad (`*0.15` aplicado dos veces) identificado en `ERRORES.md` §2.2.
9. **Reemplazar los datos simulados por datos reales o etiquetarlos explícitamente como estimación** (§2.3): si no hay datos de sesión suficientes para calcular satisfacción o tasa de error en una hora determinada, la interfaz debe mostrar un estado de "sin datos suficientes" en lugar de un número generado aleatoriamente o una constante fija que aparenta ser una medición real.
10. **Unificar los umbrales de "satisfacción"** entre `mod-pantalla.tsx` y `mod-zona-monitor.tsx` (§2.4) en una sola constante compartida, para que el mismo valor numérico se clasifique siempre igual en toda la aplicación.

## 3. Integridad de datos

11. **Implementar limpieza en cascada** (o al menos validación previa que impida el borrado) al eliminar zonas, armadores o membretes (§3.1), y corregir el texto del modal de confirmación en `mod-zonas.tsx` para que refleje el comportamiento real hasta que la cascada esté implementada.
12. **Sanear los payloads antes de escribir a Firestore**: revisar `unassignMembreteFromArmador()` y `mod-membretes.tsx`'s `handleCreate()` para eliminar campos `undefined` explícitos (usando `deleteField()` cuando la intención sea borrar un valor, o simplemente omitiendo el campo), y en general considerar si conviene activar `ignoreUndefinedProperties: true` en la inicialización del cliente como red de seguridad adicional. Adicionalmente, estos catches deben notificar al usuario (toast/mensaje visible), no solo loguear en consola.

## 4. Funcionalidad incompleta

13. **Corregir "Finalizar"/"Cancelar ciclo"** para que efectivamente desasignen el membrete activo del armador, o renombrar los botones para que su texto no sugiera una acción que no ocurre (§4.1).
14. **Migrar "Repetir ciclo" a `Armador.lastCicloMembreteIds`** (§4.2) para que funcione en instalaciones que ya usan el modelo moderno.
15. **Retirar los valores de enum inalcanzables** (`cicloEstado: "activo"`, `PositionType: "CF"`) o, si tienen un propósito futuro, documentarlo y conectarlos a un flujo real (§4.3).
16. **Corregir `mapZoneToWarehousePosition()`** para que efectivamente distinga entre Túnel 1 y Túnel 2 (§4.4).
17. **Cerrar el ciclo de resolución de incidencias hacia el armador** (§4.5): cuando el admin marca una incidencia como resuelta, la app del armador debe reflejarlo (dejar de mostrar el ícono de incidencia, o mostrar un estado "resuelta" distinto) en la siguiente sincronización.
18. Permitir **desmarcar un producto** ya marcado como completado desde la app del armador, para corregir errores de marcado sin depender de soporte administrativo (mencionado en `ERRORES.md` §5).
19. **Reemplazar `window.prompt()` por un modal propio** para la resolución de incidencias (introducido como solución rápida en esta iteración), consistente con el resto de confirmaciones de la interfaz.
20. Revisar y decidir explícitamente el destino de la funcionalidad de "Toast" (conectarla a los flujos que la necesitan o retirar el componente), del botón "Replicar" sin efecto, y del valor "+1" hardcodeado identificados en `ERRORES.md` §5.
21. Confirmar con el equipo funcional si existe o no un riesgo real de membretes duplicados al reimportar desde SAP, y si lo hay, añadir una validación de deduplicación en `excel-utils.ts` antes de insertar.

## 5. Mejoras de arquitectura a mediano plazo

22. Considerar mover los módulos que aún dependen de una sola lectura inicial (fetch puntual) hacia suscripciones en tiempo real (`onSnapshot`), siguiendo el patrón ya usado en los módulos modernos, para que toda la aplicación tenga la misma consistencia de "vivo" que ya tiene el mapa.
23. Evaluar si la exportación de reportes (actualmente HTML) debería migrar a un formato de archivo real (Excel/PDF) si el objetivo es que el usuario lo comparta fuera del sistema, o mantenerse como HTML si el objetivo es solo visualización rápida — actualmente el nombre de la función (`handleExportHTML`) es claro, pero conviene validar con los usuarios finales si ese es el formato que realmente necesitan.
24. Extender las notificaciones de incidencias más allá de la interfaz interna (por ejemplo, correo o push) para administradores que no tengan el panel abierto en el momento en que se reporta una incidencia.
25. Una vez resuelto el punto 6 (unificación de modelo), documentar formalmente en el código (no solo en este documento) cuál es la única fuente de verdad para el estado de una zona, para evitar que un futuro módulo reintroduzca una lectura directa de los campos legados de `Zone`.

## 6. Cómo usar este documento

Este backlog no está en Jira ni en ninguna herramienta externa — es intencionalmente un documento de referencia técnica. Se recomienda que, al tomar cualquiera de estos puntos para implementación, se cree la tarea correspondiente en la herramienta de seguimiento que use el equipo, enlazando de vuelta a la sección relevante de este documento y de `ERRORES.md` para no perder el contexto de la investigación original.
