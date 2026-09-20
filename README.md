# Siamo.Indicador

Sistema de gestión y medición operacional para bodegas. Plataforma full-stack que mide la productividad de armadores mediante escaneo de QR en zonas de trabajo.

> Documentación funcional y técnica detallada en [`Documentos/`](./Documentos/): `ARQUITECTURA.md`, `FUNCIONALIDADES.md`, `ERRORES.md`, `MEJORAS.md`, `DESPLIEGUE.md` — actualizados el 19 de septiembre de 2026, incluyendo la reorganización de carpetas en `frontend/`/`backend/` (ver más abajo y `ARQUITECTURA.md` §3).

## Modelo de trabajo (resumen)

El supervisor hace dos cosas: asigna cada membrete (orden de picking) a una zona, y postula a cada armador a la zona donde debe trabajar (roster). No asigna tareas puntuales a un armador específico — cada armador toma, por voluntad propia, el siguiente membrete pendiente de su zona al escanear el código QR. El supervisor además controla la **jornada** de la empresa (iniciar / pausar / reanudar / finalizar): mientras no está activa, los armadores no pueden escanear ni tomar membretes.

## Arquitectura

El código está organizado en `frontend/` y `backend/` dentro de `src/`, con separación de responsabilidades estilo MVC. `app/` (enrutamiento) y `app/api/` (rutas) se quedan donde Next.js los exige — no se pueden mover — pero por dentro delegan a `frontend/` y `backend/`. Detalle completo en `Documentos/ARQUITECTURA.md` §3.

```
src/
├── app/                          # Next.js App Router — SOLO enrutamiento
│   ├── (auth)/login/             # Login (Google, email/password, cédula)
│   ├── (dashboard)/              # Vistas autenticadas
│   │   ├── super-admin/          # Panel Super Admin
│   │   ├── admin/                # Panel Administrador
│   │   └── armador/              # Panel Armador (móvil)
│   └── api/                      # Rutas API — cada route.ts delega a backend/controllers/
├── backend/                      # Todo lo que corre solo en el servidor
│   ├── controllers/              # Un archivo por ruta API (admins, auth, cedula-login, claim-invite,
│   │                              #   debug-admin, armador-session, armador-finish-cycle)
│   └── services/                 # firebase-admin.ts, api-auth.ts
├── frontend/                     # Todo lo que corre en el navegador
│   ├── components/               # Vistas
│   │   ├── admin/                # Módulos del admin
│   │   │   ├── mod-asignacion.tsx    # Control de jornada + roster de armadores por zona
│   │   │   ├── mod-carga.tsx         # Importación SAP / manual de membretes
│   │   │   ├── mod-membretes.tsx     # Vista y edición de membretes
│   │   │   ├── mod-mapa.tsx          # Mapa en tiempo real (modelo Membrete-derivado)
│   │   │   ├── mod-pantalla.tsx      # Vista general en vivo
│   │   │   ├── mod-zonas.tsx         # Gestión de zonas físicas
│   │   │   ├── mod-equipo.tsx        # Roster de armadores
│   │   │   ├── mod-qr.tsx            # Generación de QR
│   │   │   ├── mod-analiticas.tsx    # Indicadores agregados
│   │   │   ├── mod-desempeno.tsx     # Ranking y reconocimiento
│   │   │   ├── mod-zona-monitor.tsx  # Monitoreo por zona
│   │   │   ├── mod-reportes.tsx      # Reportes exportables
│   │   │   ├── mod-historial.tsx     # Bitácora de actividad
│   │   │   └── mod-configuracion.tsx # Turnos, almuerzo, metas
│   │   ├── charts/                # Wrappers de Recharts
│   │   ├── maps/{map-floor.tsx, canvas-editor/}  # Plano interactivo del piso de bodega
│   │   ├── qr/qr-glyph.tsx        # QR visual mockup
│   │   └── ui/{kpi,panel}.tsx     # Componentes de UI compartidos
│   ├── hooks/use-theme.ts        # Manejo de tema light/dark
│   ├── context/auth-context.tsx  # Contexto de sesión (incluye modo demo — ver ERRORES.md)
│   └── services/                 # El "modelo" del lado cliente — hablan directo con Firestore
│       ├── firebase.ts / firestore.ts
│       ├── analytics.ts / zone-analytics.ts / zone-priority.ts
│       ├── warehouse-layout.ts / warehouse-floorplan.ts
│       └── excel-utils.ts
├── types/index.ts                # Modelo de dominio compartido (Armador, Zone, Membrete, Company...)
└── middleware.ts                 # Protección de rutas (ver ERRORES.md — solo verifica presencia de cookie)
```

## Roles

| Rol | Permisos |
|-----|----------|
| **Super Admin** | Crear empresas, gestionar administradores |
| **Admin** | Controlar la jornada, postular armadores a zonas, gestionar zonas/membretes, importar SAP, ver reportes |
| **Armador** | Escanear QR, tomar membretes de su zona por voluntad propia, reportar incidencias |

## Stack Técnico

- **Frontend**: Next.js 14.2 (App Router)
- **UI**: CSS personalizado (variables CSS, light/dark) — el proyecto tiene configuración de Tailwind/shadcn instalada pero **sin usar** en ningún componente actual
- **Auth**: Firebase Auth (Google, email/password, cédula)
- **DB**: Firestore
- **Deploy**: Vercel
- **Gráficas**: Recharts
- **QR**: `@yudiel/react-qr-scanner`
- **Excel**: `xlsx` y `exceljs`

## Variables de entorno

Copiar `.env.example` a `.env.local` y configurar (ver `Documentos/DESPLIEGUE.md` para el detalle completo):

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
SUPER_ADMIN_EMAILS=
NEXT_PUBLIC_DEMO_ENABLED=
```

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Estado conocido

Antes de desplegar con datos reales, revisar `Documentos/ERRORES.md`: hay hallazgos de seguridad críticos vigentes (modo demo, verificación de sesión, endpoint de diagnóstico sin autenticación) y una inconsistencia de producto (`mod-membretes.tsx` permite asignar membretes puntuales a un armador, contradiciendo el modelo de "roster + toma voluntaria" del resto del sistema).
