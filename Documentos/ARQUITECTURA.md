# Arquitectura — Siamo.Indicador

> Documento técnico actualizado tras una auditoría completa del código fuente (septiembre 2026). Sustituye por completo la versión anterior de este archivo, que describía módulos y colecciones (`mod-jornada`, `jornadas`) que ya no existen en el sistema.

## 1. Resumen del sistema

Siamo.Indicador es una aplicación web de gestión y productividad para operaciones de bodega/almacén (picking). Coordina tres roles:

- **Super admin**: administra empresas y usuarios a nivel global.
- **Admin**: administra una empresa (zonas, armadores, membretes, indicadores).
- **Armador**: el operario que recorre físicamente las zonas de la bodega, escanea códigos QR y marca el avance del picking desde un dispositivo móvil.

La aplicación vive en un único proyecto Next.js con dos frentes claramente separados por rutas: el panel administrativo (`/admin/...` y los módulos `mod-*`) y la aplicación del armador (`/armador`), que es una PWA orientada a móvil.

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript en modo estricto |
| UI | React, componentes propios en `src/components/` |
| Autenticación | Firebase Auth (Google popup, email/password, y un flujo propio por cédula vía custom token) |
| Base de datos | Firestore — SDK cliente (`getFirestore(app)`, **sin** `ignoreUndefinedProperties`) y SDK de administración (`firebase-admin`) en las rutas API |
| Hosting/Build | Vercel (build de Next.js) |
| Escaneo QR | `@yudiel/react-qr-scanner` (uso activo y obligatorio en la app del armador, no es una función legada) |
| Reglas de datos | `firestore.rules` |

No existe backend propio fuera de las rutas API de Next.js (`src/app/api/**`). No hay servidor de colas, cron jobs en el propio proyecto, ni base de datos relacional adicional.

## 3. Estructura real del proyecto (resumen)

```
src/
  app/
    (auth)/login/page.tsx        # Página de login (3 mecanismos, ver sección 5)
    admin/                       # Layout y páginas del panel admin
    armador/                     # App del armador (mapa / zona / yo)
    api/
      auth/route.ts              # ⚠ código muerto, ver sección 5.4
      cedula-login/route.ts      # Login por cédula → custom token
      claim-invite/route.ts      # Resuelve el perfil (rol, empresa) tras login
      admins/route.ts
      debug-admin/route.ts       # ⚠ endpoint de diagnóstico sin autenticación, ver ERRORES.md
      armador-session/route.ts
      armador-finish-cycle/route.ts
  components/
    admin/mod-*.tsx               # Cada módulo del panel admin (ver FUNCIONALIDADES.md)
    admin-nav.tsx
    maps/map-floor.tsx            # Render visual del piso de bodega (zonas)
    logout-button.tsx
  lib/
    firebase.ts                   # Inicialización SDK cliente
    firebase-admin.ts             # Inicialización SDK admin (solo server-side)
    firestore.ts                  # Todas las operaciones de lectura/escritura a Firestore
    auth-context.tsx              # Contexto de sesión en el cliente (incluye modo demo, ver sección 5.5)
    api-auth.ts                   # Verificación de sesión en rutas API, super admins por email
    analytics.ts                  # Normalización de eventos para reportes
    zone-analytics.ts             # Cálculos derivados de zonas (modelo legado)
    warehouse-layout.ts           # Mapeo de zonas a posiciones visuales del piso
    excel-utils.ts                # Import/export de membretes vía Excel
  types/index.ts                  # Definición de todos los tipos de dominio
scripts/
  seed-people.mjs                 # Script de mantenimiento (invitaciones), no corre en el sandbox
  delete-ghost-admins.mjs         # Script de limpieza de usuarios "fantasma"
firestore.rules
firestore.indexes.json
firebase.json
```

## 4. Modelo de datos

### 4.1 Entidades principales

- **`users`**: perfil de cada persona autenticada (rol: `super_admin` | `admin` | `armador`, empresa asociada, email).
- **`companies`**: empresas/clientes del sistema.
- **`armadores`**: el roster de operarios de una empresa. Campos relevantes: `cedula`, `authUid` (el uid real de Firebase Auth de esa persona), `cicloEstado`, `membreteId` (el membrete que tiene asignado actualmente), `activeSession`, colores personales de UI.
- **`zones`**: las posiciones físicas de la bodega. Campos: `code`, `sector` (`"A"` | `"B"`), `position`, `prioridad`. **Contiene además un conjunto de campos legados marcados `@deprecated` en `types/index.ts`** (ver sección 4.3): `armadorId`, `ruta`, `pallet`, `status`, `incidentNote`, `incidentClass`, `avgMinutes`.
- **`membretes`**: la unidad de trabajo real — una orden de picking. Campos: `ruta`, `pallet`, `palletTotal`, `fechaEntrega`, `familia`, `camion`, `zonaId`, `zonaCode`, `armadorId`, `status` (`"pending" | "active" | "completed" | "cancelled"`), y `products: MembreteProduct[]` (cada producto tiene su propio estado, incluyendo `"incident"` cuando el armador reporta un problema con ese producto puntual).
- **`invitations`**: invitaciones pendientes que `claim-invite` resuelve al primer login.
- Colecciones de soporte: sesiones de escaneo (`ScanSession`) y bitácora de actividad (`ActivityLogEntry`, tipo `ActivityType`).

### 4.2 Relación entre entidades

```
Armador ──(membreteId)──► Membrete ──(zonaId/zonaCode)──► Zone
   │                          │
   └─(authUid = uid de Auth)  └─ products: MembreteProduct[] (estado por producto, incluye incidencias)
```

El estado que ve el administrador en el mapa de bodega **no es un campo simple de `Zone`**: se calcula a partir de los membretes activos asociados a esa zona (ver 4.3).

### 4.3 Hallazgo arquitectónico central: dos modelos de datos convivendo

El sistema está en una migración incompleta entre dos modelos:

1. **Modelo legado "Zone-direct"**: el estado de una zona se leía directamente de campos de `Zone` (`status`, `armadorId`, `incidentNote`, `incidentClass`, `avgMinutes`). Todos estos campos están marcados `@deprecated` en `types/index.ts`, pero **no han sido eliminados ni migrados en todos los módulos**.
2. **Modelo moderno "Membrete-derivado"**: el estado visual de una zona (`displayStatus(zone)`) se calcula dinámicamente a partir de los membretes vigentes de esa zona, no de un campo estático.

**Solo `mod-pantalla.tsx` y `mod-mapa.tsx` usan el modelo moderno.** Los siguientes módulos todavía leen los campos deprecados de `Zone` directamente:

- `mod-desempeno.tsx`
- `mod-reportes.tsx`
- `mod-zona-monitor.tsx`
- `zone-analytics.ts` (usado por `mod-analiticas.tsx`)

**Consecuencia práctica**: los indicadores de desempeño, los reportes exportados y el monitor de zona pueden mostrar información desactualizada o inconsistente con lo que efectivamente ve el operador en el mapa en vivo, porque están leyendo una fuente de datos distinta a la que alimenta el mapa. Este es el hallazgo de mayor impacto de esta auditoría; el detalle de cada síntoma está en `ERRORES.md` y la recomendación de unificación en `MEJORAS.md`.

### 4.4 El problema de los "dos espacios de ID"

Existen dos identificadores distintos para un mismo armador, y el sistema los mezcla en varios lugares:

- `Armador.id`: el ID del documento del armador en Firestore (el "ID de roster"). Es el valor que se usa como `Zone.armadorId` y `Membrete.armadorId`.
- `Armador.authUid`: el UID real de Firebase Auth de esa persona.

Para complicar las cosas, `ScanSession.armadorId` **en realidad almacena el UID de Auth**, no el ID de roster, a pesar del nombre del campo. `src/lib/analytics.ts` tiene que "traducir" entre ambos espacios mediante `normalizeEvents()` para poder cruzar sesiones de escaneo con el roster de armadores. Hubo errores históricos (ya corregidos) en `/api/armador-session` y `/api/armador-finish-cycle` que comparaban directamente estos dos valores sin traducir, causando fallos 403 recurrentes. Cualquier desarrollador que trabaje sobre sesiones, actividad o reportes debe tener esto presente antes de comparar IDs de armador.

## 5. Autenticación y autorización

### 5.1 Tres mecanismos de login, una sola pantalla

`src/app/(auth)/login/page.tsx` implementa **tres flujos de login independientes**, todos convergiendo en el mismo endpoint de resolución de perfil:

1. **Google popup** (`signInWithPopup`): pensado para admins y super admins.
2. **Email + contraseña** (`signInWithEmailAndPassword`): alternativa para admins.
3. **Login por cédula** (flujo propio): el armador ingresa su número de cédula, la app llama a `/api/cedula-login`, que genera un custom token de Firebase (`signInWithCustomToken`) sin que el armador maneje contraseña alguna.

Los tres métodos, al completarse, llaman a `/api/claim-invite` (usando el SDK de administración) para resolver o crear el perfil del usuario (`users/{uid}`) y determinar su rol y empresa a partir de invitaciones pendientes o de la lista de super admins.

### 5.2 Bootstrap de super_admin

El mecanismo real para otorgar el rol `super_admin` es la variable de entorno `SUPER_ADMIN_EMAILS` (lista separada por comas), consultada mediante `getSuperAdminEmails()` / `isSuperAdminEmail()` en `src/lib/api-auth.ts`. **No existe** un mecanismo de "el primer usuario que entra se vuelve super_admin" — esa descripción, presente en la documentación anterior, no corresponde al código actual.

### 5.3 Verificación de sesión en el middleware — hallazgo de seguridad

`src/middleware.ts` protege las rutas del panel comprobando únicamente que la cookie `auth-token` **exista y no esté vacía**. No verifica firma, no decodifica el token, no consulta Firebase: es una comprobación de presencia de cadena, no una verificación de autenticidad.

Esta cookie se establece **desde el cliente**, mediante `document.cookie` (no `httpOnly`), en `login/page.tsx`, después de cada uno de los tres métodos de login, con `max-age=3600` (1 hora). Se limpia de la misma forma (client-side) en `logout-button.tsx`.

Ver `ERRORES.md` para el detalle del impacto de seguridad de este diseño y `MEJORAS.md` para la recomendación de remediación.

### 5.4 `/api/auth/route.ts` es código muerto

Existe una ruta `/api/auth` que sí establece una cookie `httpOnly` firmada correctamente en el servidor usando el SDK de administración. **Ningún componente del frontend la invoca** — se confirmó mediante búsqueda exhaustiva de referencias (`fetch` a `/api/auth`) en todo el código fuente, sin resultados. El mecanismo de sesión real es el descrito en 5.3, no este endpoint, que quedó de una implementación anterior y nunca fue conectado (o fue reemplazado y no se eliminó el código viejo).

### 5.5 Modo demo — bypass de autenticación sin verificación de servidor

`auth-context.tsx` implementa un modo "demo": `handleDemo(role)` en la página de login establece dos cookies vía `document.cookie` (`auth-token=demo-${role}` y `demo-role=${role}`), y las funciones `getDemoRole()` / `createDemoUser(role)` construyen un objeto `AppUser` completamente formado con el rol solicitado, **sin ninguna verificación del lado del servidor**.

La variable de entorno `NEXT_PUBLIC_DEMO_ENABLED` únicamente controla si los **botones** de demo se muestran en la interfaz — no desactiva el mecanismo de confianza en la cookie. Ver `ERRORES.md`, sección de seguridad, para el análisis completo de impacto.

### 5.6 Permisos de datos

`firestore.rules` define las reglas de acceso a nivel de documento (alcance por empresa, por rol). Las rutas API que usan el SDK de administración (`firebase-admin`) operan con privilegios elevados y son responsables de aplicar sus propias comprobaciones de rol antes de leer/escribir — ver `src/lib/api-auth.ts` para las funciones de verificación usadas en esas rutas.

## 6. Flujo operativo (alto nivel)

1. El admin carga membretes (manualmente o vía import de Excel, `mod-carga.tsx` / `excel-utils.ts`).
2. El admin asigna membretes a armadores y zonas (`mod-asignacion.tsx`).
3. El armador inicia sesión (login por cédula), ve su membrete asignado en la app `/armador`, se desplaza físicamente por las zonas, escanea el código QR de cada zona (payload `TRZ://zona/{code}`) para registrar la transición, y marca cada producto del membrete como completado o con incidencia.
4. El mapa en vivo del admin (`mod-mapa.tsx` / `mod-pantalla.tsx`) refleja el estado de cada zona en tiempo real, calculado a partir de los membretes activos y las incidencias abiertas de sus productos.
5. Si un producto queda marcado con incidencia, el administrador la ve (badge de navegación, banner en el mapa, alerta en el detalle de zona) y puede marcarla como resuelta desde la interfaz, quedando registrada la resolución (quién, cuándo, nota) en el propio membrete y en la bitácora de actividad.
6. Al cerrar el ciclo, se generan los indicadores de desempeño y los reportes exportables.

## 7. Consideraciones para quien vaya a modificar este código

- Antes de tocar cualquier lógica de estado de zona, confirmar si el módulo en cuestión usa el modelo legado o el modelo Membrete-derivado (sección 4.3) — mezclar ambos en un mismo cambio produce inconsistencias silenciosas.
- Antes de comparar IDs de armador entre colecciones, confirmar cuál de los dos espacios de ID (roster vs. Auth uid) usa cada campo (sección 4.4).
- Ninguna escritura a Firestore debe enviar campos `undefined` explícitos: el cliente se inicializa sin `ignoreUndefinedProperties: true`, por lo que esas escrituras pueden fallar (ver `ERRORES.md`).
- No asumir que el mecanismo de sesión es seguro por el solo hecho de existir una cookie: ver sección 5.3–5.5 antes de tomar decisiones de producto que dependan de la identidad del usuario.
