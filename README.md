# Siamo.Indicador

Sistema de gestión y medición operacional para bodegas. Plataforma full-stack que mide la productividad de armadores mediante escaneo de QR en zonas de trabajo.

## Arquitectura

```
src/
├── app/                          # Next.js App Router (rutas)
│   ├── (auth)/login/             # Login con Google Auth
│   ├── (dashboard)/              # Vistas autenticadas
│   │   ├── super-admin/          # Panel Super Admin
│   │   ├── admin/                # Panel Administrador
│   │   └── armador/              # Panel Armador (móvil)
│   └── api/auth/                 # API para cookies de auth
├── components/                   # Componentes reutilizables
│   ├── admin/                    # Módulos del admin
│   │   ├── mod-jornada.tsx       # Gestión de jornadas
│   │   ├── mod-carga.tsx         # Importación SAP
│   │   ├── mod-asignacion.tsx    # Asignación de zonas
│   │   ├── mod-mapa.tsx          # Mapa en tiempo real
│   │   ├── mod-indicadores.tsx   # Métricas de productividad
│   │   ├── mod-desempeno.tsx     # Ranking y reconocimiento
│   │   ├── mod-reportes.tsx      # Reportes diarios/semanales
│   │   └── mod-qr.tsx            # Generación de QR
│   ├── maps/                     # Componentes de mapa
│   │   └── map-floor.tsx         # Plano interactivo con drag
│   ├── qr/                       # Generación de QR
│   │   └── qr-glyph.tsx          # QR visual mockup
│   ├── ui/                       # Componentes de UI
│   │   ├── kpi.tsx               # Indicador clave
│   │   └── panel.tsx             # Contenedor con header
│   ├── icons.tsx                 # Iconos SVG compartidos
│   └── admin-nav.tsx             # Navegación del admin
├── hooks/                        # Custom hooks
│   ├── use-timer.ts              # Cronómetro reutilizable
│   └── use-theme.ts              # Manejo de tema light/dark
├── lib/                          # Utilidades y configuración
│   ├── firebase.ts               # Config Firebase client
│   ├── firebase-admin.ts         # Config Firebase admin
│   ├── auth-context.tsx          # Context de autenticación
│   ├── firestore.ts              # Operaciones Firestore
│   └── data.ts                   # Datos mock del sistema
├── types/                        # Definiciones TypeScript
│   └── index.ts                  # Interfaces del dominio
└── middleware.ts                  # Protección de rutas
```

## Roles

| Rol | Permisos |
|-----|----------|
| **Super Admin** | Crear empresas, gestionar administradores |
| **Admin** | Delegar zonas, gestionar armadores, importar SAP, ver reportes |
| **Armador** | Escanear QR, ver recorrido, reportar incidencias |

## Stack Técnico

- **Frontend**: Next.js 14 (App Router)
- **UI**: CSS personalizado (variables CSS, light/dark)
- **Auth**: Firebase Auth (Google)
- **DB**: Firestore
- **Deploy**: Vercel
- **Gráficas**: Recharts
- **QR**: html5-qrcode
- **Excel**: xlsx (SheetJS)

## Variables de entorno

Copiar `.env.example` a `.env.local` y configurar:

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
