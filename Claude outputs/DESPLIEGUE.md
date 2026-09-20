# Despliegue — Siamo.Indicador

> Actualizado el 19 de septiembre de 2026. Nunca incluye valores reales de secretos: solo nombres de variables de entorno inferidos del código fuente. La configuración operativa (jornada, turnos, almuerzo, metas) vive en Firestore (`Company`), no en variables de entorno — no requiere cambios de despliegue al modificarse.

## 1. Resumen

La aplicación es un proyecto Next.js 14 desplegado en Vercel, con Firebase (Auth + Firestore) como backend de datos e identidad. No requiere infraestructura adicional (no hay base de datos relacional, ni colas, ni cron jobs propios del proyecto).

## 2. Requisitos previos

- Un proyecto de Firebase con **Authentication** habilitado (proveedor de Google, y proveedor de email/password) y **Firestore** habilitado en modo nativo.
- Una cuenta de servicio de Firebase (para el SDK de administración usado en las rutas API del servidor).
- Una cuenta de Vercel (o cualquier plataforma compatible con Next.js 14 App Router) para el hosting.

## 3. Variables de entorno

**Importante**: esta sección lista únicamente los *nombres* de las variables requeridas, inferidos del código fuente. Los valores reales nunca deben incluirse en este documento ni en el repositorio.

### 3.1 Configuración del cliente (Firebase SDK web)
Usadas por `src/lib/firebase.ts`, expuestas al navegador (prefijo `NEXT_PUBLIC_`):

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### 3.2 Configuración del servidor (Firebase Admin SDK)
Usadas por `src/lib/firebase-admin.ts` y por las rutas API (`src/app/api/**`), **nunca expuestas al cliente**:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY` (contiene saltos de línea escapados como `\n`; los scripts de mantenimiento hacen `.replace(/\\n/g, "\n")` al leerla)

### 3.3 Control de acceso

- `SUPER_ADMIN_EMAILS`: lista de correos separados por coma que reciben automáticamente el rol `super_admin` al iniciar sesión por primera vez (ver `ARQUITECTURA.md`, sección 5.2).

### 3.4 Otras variables públicas

- `NEXT_PUBLIC_DEMO_ENABLED`: controla si se muestran los botones de "modo demo" en la pantalla de login. **Advertencia**: esta variable solo oculta o muestra los botones; no desactiva el mecanismo de confianza en la cookie de demo subyacente. Ver `ERRORES.md` antes de asumir que ponerla en `false` es suficiente para cerrar ese riesgo en producción.

## 4. Pasos de despliegue

1. Crear el proyecto de Firebase (Auth + Firestore) y una cuenta de servicio con permisos de administración.
2. Configurar todas las variables de entorno de la sección 3 en la plataforma de despliegue (Vercel: Project Settings → Environment Variables).
3. Desplegar `firestore.rules` y `firestore.indexes.json` al proyecto de Firebase:
   ```
   firebase deploy --only firestore:rules,firestore:indexes
   ```
4. Conectar el repositorio a Vercel (o ejecutar `next build` / `next start` en cualquier otra plataforma compatible con App Router).
5. Verificar el primer login: la primera persona que inicie sesión con un correo listado en `SUPER_ADMIN_EMAILS` recibirá automáticamente el rol `super_admin`.
6. Configurar, ya dentro de la aplicación (módulo Configuración), los turnos, el horario de almuerzo, las metas de productividad y el costo por hora — es configuración de datos, no de despliegue.
7. Antes del primer turno real, recordar al admin **iniciar la jornada** desde el módulo de Asignación — mientras no lo haga, los armadores no podrán escanear.
8. (Opcional, mantenimiento inicial) Ejecutar `node scripts/seed-people.mjs` desde una terminal con acceso a internet y el archivo `.env.local` presente. Este script y `delete-ghost-admins.mjs` **no corren dentro de un sandbox sin salida a internet**.

## 5. Build y verificación local

```
npm install
npm run build     # o: npx tsc --noEmit  para solo verificar tipos
npm run dev        # entorno local
```

El proyecto usa TypeScript en modo estricto (`tsconfig.json`) y ESLint (`.eslintrc.json`). Se recomienda correr ambos antes de cada despliegue.

## 6. Consideraciones de seguridad antes de ir a producción

Antes de desplegar a un entorno con datos reales, revisar obligatoriamente `ERRORES.md`, en particular (sin cambios desde la revisión anterior):

- El mecanismo de sesión (`middleware.ts` + cookie `auth-token`) no verifica la autenticidad del token.
- El "modo demo" puede otorgar acceso `super_admin`/`admin`/`armador` a cualquiera que pueda establecer dos cookies desde las herramientas de desarrollador del navegador, independientemente del valor de `NEXT_PUBLIC_DEMO_ENABLED`.
- El endpoint `/api/debug-admin` no requiere autenticación y expone información de configuración y datos de un usuario específico.

Ninguno de estos tres puntos requiere cambios de infraestructura — son correcciones de código, detalladas en `ERRORES.md` y `MEJORAS.md`.

## 7. Solución de problemas (troubleshooting)

| Síntoma | Causa probable | Referencia |
|---|---|---|
| Los armadores no pueden escanear ningún QR | La jornada de la empresa no está activa, o está pausada — revisar el estado en el módulo de Asignación | `ARQUITECTURA.md` §4.4 |
| Usuario es redirigido a `/login` tras ~1 hora de uso activo, aunque su sesión de Firebase sigue vigente | La cookie `auth-token` tiene `max-age=3600` y nunca se refresca | `ERRORES.md` |
| Un armador ve error 403 al operar sobre su propia sesión de escaneo | Confusión entre el ID de roster del armador y su UID de Auth (ver "dos espacios de ID") | `ARQUITECTURA.md` §4.5 |
| Escritura a Firestore falla silenciosamente (solo en la consola del navegador) | Se está enviando un campo `undefined` explícito sin `ignoreUndefinedProperties: true` | `ERRORES.md` |
| Los indicadores de un módulo no coinciden con lo que muestra el mapa en vivo | El módulo lee el modelo legado de `Zone` en lugar del modelo Membrete-derivado (o solo parcialmente, como `mod-pantalla.tsx`) | `ARQUITECTURA.md` §4.3 |
| Aparecen membretes duplicados tras reimportar un Excel/SAP | `importSapData()` no detecta duplicados — cada reimport crea membretes nuevos | `ERRORES.md` §3.2 |
| Un supervisor logra asignar un membrete puntual a un armador específico, pese a que "eso ya no se hace" | El botón "+ Asignar" de `mod-membretes.tsx` sigue activo — es una inconsistencia conocida, no un bug de despliegue | `ERRORES.md` §4.1 |
| `firebase deploy` falla por reglas o índices | Revisar que `firestore.rules` y `firestore.indexes.json` estén sincronizados con las consultas usadas en `src/lib/firestore.ts` | — |
