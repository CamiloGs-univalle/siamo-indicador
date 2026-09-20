# Arquitectura — Siamo.Indicador

> Actualizado el 19 de septiembre de 2026. Sustituye la versión anterior (auditoría de septiembre 2026): incorpora el nuevo modelo de asignación (roster + jornada), el control de jornada y almuerzo, y una revisión de todos los módulos y hallazgos a la luz del código actual en disco (incluyendo cambios aún sin commitear).

## 1. Resumen del sistema

Siamo.Indicador es una aplicación web de gestión y productividad para operaciones de bodega/almacén (picking). Coordina tres roles:

- **Super admin**: administra empresas y usuarios a nivel global.
- **Admin**: administra una empresa (jornada, zonas, armadores, membretes, indicadores).
- **Armador**: el operario que recorre físicamente las zonas de la bodega, escanea códigos QR y marca el avance del picking desde un dispositivo móvil.

La aplicación vive en un único proyecto Next.js con dos frentes claramente separados por rutas: el panel administrativo (`/admin/...` y los módulos `mod-*`) y la aplicación del armador (`/armador`), que es una PWA orientada a móvil.

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 14.2 (App Router), TypeScript en modo estricto |
| UI | React, componentes propios en `src/components/` con CSS en línea + variables CSS (`var(--...)`) — **no** utilidades de Tailwind |
| Autenticación | Firebase Auth (Google popup, email/password, y un flujo propio por cédula vía custom token) |
| Base de datos | Firestore — SDK cliente (`getFirestore(app)`, **sin** `ignoreUndefinedProperties`) y SDK de administración (`firebase-admin`) en las rutas API |
| Hosting/Build | Vercel (build de Next.js) |
| Escaneo QR | `@yudiel/react-qr-scanner` (uso activo y obligatorio en la app del armador) |
| Gráficas | Recharts (`src/components/charts/`) |
| Excel | `xlsx` y `exceljs` conviven en `package.json` para importación/exportación (ver `excel-utils.ts`) |
| Reglas de datos | `firestore.rules` |

**Nota — scaffolding sin usar**: el proyecto tiene `tailwind.config.ts`, `postcss.config.mjs` y `components.json` (configuración de shadcn/ui) en la raíz, además de dependencias `@radix-ui/*`, `class-variance-authority`, `tailwind-merge` y `react-hot-toast` en `package.json`. Nada de esto está realmente conectado: `globals.css` no tiene directivas `@tailwind`, no hay ningún `className` con utilidades Tailwind en el código, y `src/components/ui/` solo contiene `kpi.tsx` y `panel.tsx` (ambos con CSS en línea, no shadcn). Es infraestructura instalada pero inerte — no afecta el funcionamiento actual, pero puede confundir a quien llegue esperando encontrar Tailwind funcionando. Ver `MEJORAS.md`.

No existe backend propio fuera de las rutas API de Next.js (`src/app/api/**`). No hay servidor de colas ni cron jobs en el propio proyecto, ni base de datos relacional adicional.

## 3. Estructura real del proyecto

```
src/
  app/
    (auth)/login/page.tsx        # Página de login (3 mecanismos, ver sección 5)
    (dashboard)/
      admin/                     # Layout y páginas del panel admin
      armador/page.tsx           # App del armador (mapa / zona / yo) — ver sección 6
      super-admin/               # Panel super admin
    api/
      auth/route.ts              # ⚠ código muerto, ver sección 5.4
      cedula-login/route.ts      # Login por cédula → custom token
      claim-invite/route.ts      # Resuelve el perfil (rol, empresa) tras login
      admins/route.ts            # Alta directa de administradores (Admin SDK)
      armadores/route.ts         # Alta directa de armadores (Admin SDK)
      debug-admin/route.ts       # ⚠ endpoint de diagnóstico sin autenticación, ver ERRORES.md
      armador-session/route.ts   # Persistencia del estado de sesión activa del armador
      armador-finish-cycle/route.ts  # ⚠ código muerto del modelo "ciclo" ya eliminado, ver 5.7
  components/
    admin/mod-*.tsx               # Cada módulo del panel admin (ver FUNCIONALIDADES.md):
                                   # asignacion, membretes, mapa, zonas, equipo, carga,
                                   # analiticas, desempeno, zona-monitor, reportes,
                                   # historial, configuracion, pantalla, qr
    admin-nav.tsx                 # Navegación del admin (incluye badge de incidencias)
    charts/                       # Wrappers de Recharts (daily-trend, latency-histogram)
    maps/map-floor.tsx            # Render visual del piso de bodega (zonas)
    qr/qr-glyph.tsx                # Mockup visual del QR
    ui/{kpi,panel}.tsx             # Componentes de UI compartidos
    logout-button.tsx
    user-menu.tsx
  hooks/
    use-theme.ts                  # Manejo de tema light/dark
  lib/
    firebase.ts                   # Inicialización SDK cliente
    firebase-admin.ts             # Inicialización SDK admin (solo server-side)
    firestore.ts                  # Todas las operaciones de lectura/escritura a Firestore (~1550 líneas)
    auth-context.tsx              # Contexto de sesión en el cliente (incluye modo demo, ver sección 5.5)
    api-auth.ts                   # Verificación de sesión en rutas API, super admins por email
    analytics.ts                  # Normalización de eventos para reportes
    zone-analytics.ts             # Cálculos derivados de zonas (modelo legado)
    zone-priority.ts              # Prioridad de zonas
    warehouse-layout.ts           # Mapeo de zonas a posiciones visuales del piso (túneles 1 y 2)
    warehouse-floorplan.ts        # Importación del plano físico real de la bodega
    excel-utils.ts                # Import/export de membretes vía Excel
    utils.ts                      # Helper `cn()` de shadcn — sin uso real en el proyecto
  types/index.ts                  # Definición de todos los tipos de dominio
scripts/
  seed-people.mjs                 # Script de mantenimiento (invitaciones), no corre en el sandbox
  delete-ghost-admins.mjs         # Script de limpieza de usuarios "fantasma"
firestore.rules
firestore.indexes.json
firebase.json
```

No existen `mod-jornada.tsx`, un hook `use-timer.ts` ni `src/lib/data.ts` — si aparecen mencionados en documentación externa o en memoria de trabajo anterior, no corresponden al código actual.

## 4. Modelo de datos

### 4.1 Entidades principales

- **`users`**: perfil de cada persona autenticada (rol: `super_admin` | `admin` | `armador`, empresa asociada, email).
- **`companies`**: empresas/clientes del sistema. Además de los datos básicos, guarda la configuración operativa (turnos, almuerzo, metas, costo por hora) y el **estado de la jornada** (ver sección 4.4).
- **`armadores`**: el roster de operarios de una empresa. Campos relevantes: `cedula`, `authUid` (el uid real de Firebase Auth de esa persona), `membreteId` (el membrete activo, si tiene uno), `activeSession`, `zonaAsignadaId`/`zonaAsignadaCode` (roster de zona, ver sección 4.4), colores personales de UI.
- **`zones`**: las posiciones físicas de la bodega. Campos vigentes: `code`, `name`, `sector` (`"A"` | `"B"`), `position`, `w`/`h` (tamaño real para zonas importadas del plano), `prioridad`. **Contiene además un conjunto de campos legados marcados `@deprecated` en `types/index.ts`** (ver sección 4.3): `armadorId`, `ruta`, `pallet`, `palletTotal`, `familia`, `camion`, `fechaEntrega`, `startedAt`, `finishedAt`, `status`, `incidentNote`, `incidentClass`, `avgMinutes`.
- **`membretes`**: la unidad de trabajo real — una orden de picking. Campos: `ruta`, `pallet`, `palletTotal`, `fechaEntrega`, `familia`, `camion`, `zonaId`, `zonaCode`, `armadorId`, `status` (`"pending" | "active" | "completed" | "cancelled"`), `claimedAt` (cuándo un armador lo tomó voluntariamente de la cola de su zona), y `products: MembreteProduct[]` (cada producto tiene su propio estado, incluyendo `"incident"` cuando el armador reporta un problema con ese producto puntual).
- **`invitations`**: invitaciones pendientes que `claim-invite` resuelve al primer login.
- Colecciones de soporte: sesiones de escaneo (`ScanSession`) y bitácora de actividad (`ActivityLogEntry`, tipo `ActivityType`).

### 4.2 Relación entre entidades

```
Armador ──(membreteId)──► Membrete ──(zonaId/zonaCode)──► Zone
   │                          │
   ├─(authUid = uid de Auth)  └─ products: MembreteProduct[] (estado por producto, incluye incidencias)
   └─(zonaAsignadaId/Code)──► Zone   [roster — solo organizativo, ver 4.4]
```

El estado que ve el administrador en el mapa de bodega **no es un campo simple de `Zone`**: se calcula a partir de los membretes activos asociados a esa zona (ver 4.3).

### 4.3 Dos modelos de datos de zona conviviendo (hallazgo aún vigente)

El sistema sigue en una migración incompleta entre dos modelos:

1. **Modelo legado "Zone-direct"**: el estado de una zona se leía directamente de campos de `Zone` (`status`, `armadorId`, `incidentNote`, `incidentClass`, `avgMinutes`). Todos estos campos están marcados `@deprecated` en `types/index.ts`, pero **no han sido eliminados ni migrados en todos los módulos**.
2. **Modelo moderno "Membrete-derivado"**: el estado visual de una zona (`displayStatus(zone)`) se calcula dinámicamente a partir de los membretes vigentes de esa zona, no de un campo estático.

**`mod-mapa.tsx` usa el modelo moderno de forma completa.** `mod-pantalla.tsx` está en transición: sus cálculos de productividad por hora y de ranking ahora usan **primero** los membretes completados del día (`todayCompletedMembretes`) y solo caen de vuelta a `ScanSession` cuando no hay membretes para esa hora/zona — una mejora reciente, presente en el árbol de trabajo pero aún sin commitear, que reduce (sin eliminar del todo) la dependencia del modelo legado. Los siguientes módulos **todavía leen los campos deprecados de `Zone` directamente, sin ningún fallback a membretes**:

- `mod-desempeno.tsx`
- `mod-reportes.tsx`
- `mod-zona-monitor.tsx`
- `zone-analytics.ts` (usado por `mod-analiticas.tsx`)

**Consecuencia práctica**: los indicadores de desempeño, los reportes exportados y el monitor de zona pueden mostrar información desactualizada o inconsistente con lo que efectivamente ve el operador en el mapa en vivo, porque están leyendo una fuente de datos distinta a la que alimenta el mapa. Este sigue siendo el hallazgo de mayor impacto en confiabilidad de indicadores; el detalle está en `ERRORES.md` y la recomendación de unificación en `MEJORAS.md`.

### 4.4 Modelo de asignación (rediseñado — cola de zona + roster + jornada)

El modelo de asignación tiene ahora **tres piezas independientes**, ninguna de las cuales le entrega una tarea puntual a un armador específico:

1. **Membrete → Zona**: se define al crear el membrete (carga manual o import SAP). No cambia con este rediseño.
2. **Armador → Zona (roster)**: el supervisor "postula" a cada armador a la zona donde debe trabajar, mediante `assignArmadorToZone()` / `unassignArmadorFromZone()` en `firestore.ts`, que solo escriben `Armador.zonaAsignadaId`/`zonaAsignadaCode`. Es puramente organizativo — **no** le asigna ningún membrete puntual. Vive en `mod-asignacion.tsx` (control principal) y también en el panel de detalle de zona de `mod-mapa.tsx` (postular/quitar desde el mapa).
3. **Toma voluntaria del membrete**: el armador, ya en su zona, escanea el QR y el sistema le entrega el membrete pendiente más antiguo de esa zona (`claimNextMembreteInZone()`, con `runTransaction` para evitar condiciones de carrera si dos armadores escanean casi al mismo tiempo). El supervisor no elige qué membrete puntual recibe cada armador.

Adicionalmente, el módulo de Asignación ahora controla la **Jornada** a nivel de empresa (`Company.jornadaActiva` / `jornadaStartedAt` / `jornadaPausedAt`, funciones `iniciarJornada()`/`pausarJornada()`/`reanudarJornada()`/`finalizarJornada()`): mientras la jornada no está activa, o está pausada, la app del armador bloquea el escaneo y la toma de membretes. Es un interruptor global de "¿se puede trabajar ahora?", no una ruta de trabajo por armador — no debe confundirse con el modelo de "ciclo" descrito abajo. **Nota de implementación**: estas funciones reutilizan, por conveniencia, los valores de `ActivityType` `"cycle_started"/"cycle_paused"/"cycle_resumed"/"cycle_completed"` para registrar la jornada en la bitácora — el nombre es un remanente del modelo anterior y puede generar confusión al leer el historial de actividad, aunque no afecta el funcionamiento.

**El modelo de "ciclo" (rutas fijas armadas a mano por el supervisor, membrete por membrete, con `cicloEstado`/`activarCiclo`/`pausarCiclo`/`reanudarCiclo`/`repetirCiclo`/`nuevoCiclo`) fue eliminado por completo**, por decisión explícita del cliente: el supervisor ya no decide qué tarea puntual hace cada armador, solo dónde trabaja (roster) y cuándo se puede trabajar (jornada); cada armador decide qué membrete toma dentro de su zona. `Armador.cicloEstado`, `lastCicloMembreteIds` y `lastCicloZoneIds` ya no existen en `types/index.ts`.

**⚠ Inconsistencia detectada — la asignación directa de membretes sigue viva en `mod-membretes.tsx`**: pese a lo anterior, `mod-membretes.tsx` conserva (o recuperó, en un cambio posterior a la eliminación del ciclo) botones "+ Asignar" / "Quitar" que llaman a `assignMembreteToArmador()` / `unassignMembreteFromArmador()` (aún presentes en `firestore.ts`), permitiendo que el supervisor empuje un membrete puntual a un armador específico — exactamente lo que se decidió eliminar. El propio comentario de encabezado del archivo dice lo contrario ("ya NO asigna membretes puntuales a un armador"), lo cual no coincide con el código real. Es la inconsistencia más importante a resolver de este documento — ver `ERRORES.md` §4.1 y `MEJORAS.md`.

### 4.5 El problema de los "dos espacios de ID"

Existen dos identificadores distintos para un mismo armador, y el sistema los mezcla en varios lugares:

- `Armador.id`: el ID del documento del armador en Firestore (el "ID de roster"). Es el valor que se usa como `Zone.armadorId` (legado) y `Membrete.armadorId`.
- `Armador.authUid`: el UID real de Firebase Auth de esa persona.

`ScanSession.armadorId` **en realidad almacena el UID de Auth**, no el ID de roster, a pesar del nombre del campo. `src/lib/analytics.ts` tiene que "traducir" entre ambos espacios mediante `normalizeEvents()` para poder cruzar sesiones de escaneo con el roster de armadores. Cualquier desarrollador que trabaje sobre sesiones, actividad o reportes debe tener esto presente antes de comparar IDs de armador.

## 5. Autenticación y autorización

### 5.1 Tres mecanismos de login, una sola pantalla

`src/app/(auth)/login/page.tsx` implementa **tres flujos de login independientes**, todos convergiendo en el mismo endpoint de resolución de perfil:

1. **Google popup** (`signInWithPopup`): pensado para admins y super admins.
2. **Email + contraseña** (`signInWithEmailAndPassword`): alternativa para admins.
3. **Login por cédula** (flujo propio): el armador ingresa su número de cédula, la app llama a `/api/cedula-login`, que genera un custom token de Firebase (`signInWithCustomToken`) sin que el armador maneje contraseña alguna.

Los tres métodos, al completarse, llaman a `/api/claim-invite` (usando el SDK de administración) para resolver o crear el perfil del usuario (`users/{uid}`) y determinar su rol y empresa a partir de invitaciones pendientes o de la lista de super admins. Adicionalmente, `/api/admins` y `/api/armadores` permiten dar de alta directamente a administradores y armadores (con el SDK de administración), sin depender del flujo de invitación.

### 5.2 Bootstrap de super_admin

El mecanismo real para otorgar el rol `super_admin` es la variable de entorno `SUPER_ADMIN_EMAILS` (lista separada por comas), consultada mediante `getSuperAdminEmails()` / `isSuperAdminEmail()` en `src/lib/api-auth.ts`. No existe un mecanismo de "el primer usuario que entra se vuelve super_admin".

### 5.3 Verificación de sesión en el middleware — hallazgo de seguridad (vigente)

`src/middleware.ts` protege las rutas del panel comprobando únicamente que la cookie `auth-token` **exista y no esté vacía**. No verifica firma, no decodifica el token, no consulta Firebase: es una comprobación de presencia de cadena, no una verificación de autenticidad.

Esta cookie se establece **desde el cliente**, mediante `document.cookie` (no `httpOnly`), en `login/page.tsx`, después de cada uno de los tres métodos de login, con `max-age=3600` (1 hora). Se limpia de la misma forma (client-side) en `logout-button.tsx`.

Ver `ERRORES.md` para el detalle del impacto de seguridad de este diseño y `MEJORAS.md` para la recomendación de remediación. **Se revisó el código actual y este hallazgo sigue vigente sin cambios.**

### 5.4 `/api/auth/route.ts` sigue siendo código muerto

Existe una ruta que sí establece una cookie `httpOnly` firmada correctamente en el servidor usando el SDK de administración. Sigue sin haber ningún componente del frontend que la invoque. El mecanismo de sesión real sigue siendo el descrito en 5.3.

### 5.5 Modo demo — bypass de autenticación sin verificación de servidor (vigente)

`auth-context.tsx` implementa un modo "demo": `handleDemo(role)` en la página de login establece dos cookies vía `document.cookie` (`auth-token=demo-${role}` y `demo-role=${role}`), y `getDemoRole()` / `createDemoUser(role)` construyen un objeto `AppUser` completamente formado con el rol solicitado, **sin ninguna verificación del lado del servidor**. `NEXT_PUBLIC_DEMO_ENABLED` solo controla si los botones de demo se muestran — no desactiva el mecanismo de confianza en la cookie. Se revisó el código actual y este hallazgo sigue vigente sin cambios.

### 5.6 Permisos de datos

`firestore.rules` define las reglas de acceso a nivel de documento. Hubo un ajuste reciente ("Reglas Firestore para admin") que amplió la lista de campos que un admin puede escribir sobre un armador (incluyendo `lastEdited*`). Las rutas API que usan el SDK de administración operan con privilegios elevados y son responsables de sus propias comprobaciones de rol (`src/lib/api-auth.ts`).

### 5.7 `/api/armador-finish-cycle/route.ts` — ahora doblemente muerto

Esta ruta ya estaba desconectada de la interfaz (ningún componente actual la invoca — confirmado por búsqueda de referencias en todo `src/`). Además, su lógica y su propio comentario de encabezado describen explícitamente el modelo de "ciclo" que fue eliminado (`Zone.armadorId`, `Armador.cicloEstado`, `lastCicloZoneIds`), por lo que ni siquiera sería consistente con el modelo de datos actual si alguna vez se reconectara. Es candidato directo a borrado — ver `MEJORAS.md`.

## 6. Flujo operativo (alto nivel)

1. El admin carga membretes (manualmente o vía import de Excel, `mod-carga.tsx` / `excel-utils.ts`), o SAP directo (`importSapData`, ver 6.1).
2. El admin postula armadores a zonas (roster, `mod-asignacion.tsx` / `mod-mapa.tsx`) y configura turnos, almuerzo y metas (`mod-configuracion.tsx`).
3. El admin **inicia la jornada** ("Iniciar labores" en `mod-asignacion.tsx`) — hasta entonces, la app del armador bloquea el escaneo.
4. El armador inicia sesión (login por cédula), ve en la app `/armador` su zona asignada (o cualquier zona con cola), se desplaza físicamente, escanea el código QR de la zona (payload `TRZ://zona/{code}`) y el sistema le entrega el membrete pendiente más antiguo de esa zona. Si es hora de almuerzo (según la configuración de la empresa), la app se lo indica y pausa el flujo.
5. El armador marca cada producto del membrete como completado o con incidencia.
6. El mapa en vivo del admin (`mod-mapa.tsx` / `mod-pantalla.tsx`) refleja el estado de cada zona en tiempo real, calculado (total o parcialmente, según el módulo — ver 4.3) a partir de los membretes activos y las incidencias abiertas.
7. Si un producto queda marcado con incidencia, el administrador la ve (badge de navegación, banner en el mapa, alerta en el detalle de zona) y puede marcarla como resuelta, quedando registrada la resolución en el propio membrete y en la bitácora de actividad. **Esta resolución no se refleja de vuelta en la app del armador** (ver `ERRORES.md` §4.4).
8. El admin puede pausar o finalizar la jornada en cualquier momento; al finalizar, el escaneo se bloquea de nuevo, pero **no se limpia** el roster ni los membretes activos de los armadores (ver `ERRORES.md` §4.1).
9. Se generan los indicadores de desempeño y los reportes exportables (con las salvedades de modelo de datos y fórmulas descritas en la sección 4.3 y en `ERRORES.md`).

### 6.1 Import SAP y duplicados

`importSapData()` agrupa las filas del Excel por zona (para crear/actualizar `Zone.products`) y luego, dentro de cada zona, por `pallet`+`ruta` (para crear un `Membrete` por cada grupo). **No hay ninguna verificación de que un membrete equivalente ya exista** antes de crearlo: cada llamada a `importSapData` genera documentos `Membrete` nuevos, aunque el archivo importado se solape total o parcialmente con uno ya cargado. La única deduplicación real es a nivel de `Zone` (por `code`). Ver `ERRORES.md` §3.2.

## 7. Consideraciones para quien vaya a modificar este código

- Antes de tocar cualquier lógica de estado de zona, confirmar si el módulo en cuestión usa el modelo legado, el modelo Membrete-derivado, o el híbrido de transición (sección 4.3) — mezclar modelos en un mismo cambio produce inconsistencias silenciosas.
- Antes de comparar IDs de armador entre colecciones, confirmar cuál de los dos espacios de ID (roster vs. Auth uid) usa cada campo (sección 4.5).
- Antes de tocar la asignación, decidir explícitamente qué hacer con la contradicción de `mod-membretes.tsx` (sección 4.4) — no asumir que "solo roster" es el comportamiento real sin revisar ese archivo primero.
- Ninguna escritura a Firestore debe enviar campos `undefined` explícitos: el cliente se inicializa sin `ignoreUndefinedProperties: true` (ver `ERRORES.md`).
- No asumir que el mecanismo de sesión es seguro por el solo hecho de existir una cookie: ver sección 5.3–5.5 antes de tomar decisiones de producto que dependan de la identidad del usuario.
- El repositorio puede tener cambios sin commitear en cualquier momento — verificar con `git status`/`git diff` antes de asumir que el historial de commits refleja el estado real del código en disco. Este mismo documento se escribió leyendo el árbol de trabajo actual, incluyendo el cambio pendiente de commit en `mod-pantalla.tsx`.
