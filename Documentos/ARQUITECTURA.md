# Siamo.Indicador — Documentación Técnica

## Tabla de Contenidos

1. [Arquitectura del Sistema](#1-arquitectura-del-sistema)
2. [Modelo de Datos](#2-modelo-de-datos)
3. [Autenticación y Autorización](#3-autenticación-y-autorización)
4. [Funcionalidades por Rol](#4-funcionalidades-por-rol)
5. [Despliegue](#5-despliegue)
6. [Desarrollo Local](#6-desarrollo-local)

---

## 1. Arquitectura del Sistema

### 1.1 Visión General

Siamo.Indicador es una plataforma de medición operacional para bodegas que mide la productividad de armadores mediante escaneo de códigos QR en zonas de trabajo.

### 1.2 Stack Tecnológico

| Capa | Tecnología | Propósito |
|------|------------|-----------|
| Frontend | Next.js 14 (App Router) | SPA con SSR, routing por roles |
| UI | CSS Personalizado | Variables CSS, light/dark mode |
| Gráficas | Recharts | Dashboard de productividad |
| Auth | Firebase Auth | Login con Google |
| Base de datos | Firestore | Datos en tiempo real |
| Almacenamiento | Firebase Storage | Reportes, archivos |
| QR | html5-qrcode | Escaneo de códigos |
| Excel | xlsx (SheetJS) | Importación SAP |
| Deploy | Vercel | Hosting automático |

### 1.3 Estructura del Proyecto

```
siamo-indicador/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/login/             # Login
│   │   ├── (dashboard)/              # Vistas autenticadas
│   │   │   ├── super-admin/          # Panel Super Admin
│   │   │   ├── admin/                # Panel Administrador
│   │   │   └── armador/              # Panel Armador
│   │   └── api/auth/                 # API auth
│   ├── components/                   # Componentes
│   │   ├── admin/                    # Módulos admin
│   │   ├── maps/                     # Mapa interactivo
│   │   ├── qr/                       # Generación QR
│   │   └── ui/                       # Componentes UI
│   ├── hooks/                        # Custom hooks
│   ├── lib/                          # Utilidades
│   ├── types/                        # Tipos TypeScript
│   └── middleware.ts                  # Protección rutas
├── firestore.rules                   # Reglas Firestore
├── firebase.json                     # Config Firebase
└── .env.local                        # Variables entorno
```

---

## 2. Modelo de Datos

### 2.1 Colecciones en Firestore

```
users/
  └── {userId}
      ├── uid: string
      ├── email: string
      ├── name: string
      ├── role: "super_admin" | "admin" | "armador"
      ├── companyId?: string
      ├── adminId?: string
      ├── sector?: "A" | "B"
      ├── color?: string
      ├── createdAt: timestamp
      └── lastLogin: timestamp

companies/
  └── {companyId}
      ├── name: string
      ├── address?: string
      ├── createdBy?: string
      └── createdAt: timestamp

zones/
  └── {zoneId}
      ├── code: string (ej. "Z01")
      ├── companyId: string
      ├── sector: "A" | "B"
      ├── pedido: string
      ├── status: "idle" | "assigned" | "active" | "done" | "incident"
      ├── assignedTo?: string
      ├── position: { x: number, y: number }
      ├── products: Array<{ producto: string, cantidad: number }>
      └── totalProducts: number

jornadas/
  └── {jornadaId}
      ├── companyId: string
      ├── date: string
      ├── shift: "morning" | "afternoon"
      ├── pedido: string
      └── status: "active" | "done" | "pending"

sessions/
  └── {sessionId}
      ├── armadorId: string
      ├── zoneCode: string
      ├── startTime: timestamp
      ├── endTime?: timestamp
      ├── duration?: number
      └── date: string
```

### 2.2 Diagrama de Relaciones

```
Super Admin
    │
    ├── Crea Companies
    │
    └── Crea Admins
            │
            ├── Admin gestiona Zones
            ├── Admin gestiona Armadores
            ├── Admin crea Jornadas
            │
            └── Armador escanea QR
                    │
                    ├── Crea Sessions
                    └── Reporta Incidencias
```

---

## 3. Autenticación y Autorización

### 3.1 Flujo de Login

1. Usuario hace clic en "Continuar con Google"
2. Se abre popup de autenticación de Google
3. Firebase Auth crea/authentica el usuario
4. Se verifica si existe en Firestore
5. Si no existe, se crea como super_admin (primer usuario)
6. Se crea cookie de sesión (`auth-token`)
7. Middleware redirige según rol

### 3.2 Protección de Rutas

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;
  
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  
  // Verificar token y rol
  // Redirigir a la ruta correcta según rol
}
```

### 3.3 Permisos por Rol

| Rol | Empresas | Usuarios | Zonas | Jornadas | Sesiones |
|-----|----------|----------|-------|----------|----------|
| Super Admin | CRUD | CRUD | Lectura | Lectura | Lectura |
| Admin | Lectura (su empresa) | CRUD (su empresa) | CRUD | CRUD | Lectura |
| Armador | - | - | Lectura | Lectura | Crear/Leer |

---

## 4. Funcionalidades por Rol

### 4.1 Super Administrador

**Email**: `auxiliar.ti@proservis.com.co`

| Función | Descripción |
|---------|-------------|
| Crear Empresa | Nombre, dirección |
| Gestionar Empresas | Ver, editar, eliminar |
| Crear Administradores | Nombre, email, sector |
| Ver Estadísticas | KPIs globales |

### 4.2 Administrador

| Módulo | Funcionalidad |
|--------|---------------|
| **Jornada** | Crear jornadas, ver historial |
| **Carga SAP** | Importar Excel con zonas/productos |
| **Asignación** | Delegar zonas a armadores, definir rutas |
| **Mapa** | Vista en tiempo real, editar posiciones |
| **Indicadores** | Métricas de productividad |
| **Desempeño** | Ranking, reconocimientos, incidencias |
| **Reportes** | Resumen diario/semanal, exportar |
| **QR** | Generar códigos para zonas |

### 4.3 Armador

| Función | Descripción |
|---------|-------------|
| Ver Recorrido | Lista de zonas asignadas |
| Escanear QR | Iniciar/detener tiempo por zona |
| Ver Mapa | Mapa del sector |
| Ver Equipo | Estado de compañeros |
| Mi Desempeño | Índice, badges, estadísticas |
| Reportar Incidencias | Opcional después de escaneo |

### 4.4 Lógica de Tiempo

```
Escaneo QR #1 → Inicia cronómetro zona #1
Escaneo QR #2 → Detiene zona #1, inicia zona #2
Escaneo QR #N → Muestra "Terminar recorrido"
Pausa almuerzo → 12:00pm - 2:00pm (configurable)
```

---

## 5. Despliegue

### 5.1 Requisitos

- Node.js 18+
- Cuenta de Firebase
- Cuenta de Vercel
- Repositorio GitHub

### 5.2 Configuración de Firebase

1. Crear proyecto en Firebase Console
2. Habilitar Authentication → Google
3. Crear Firestore Database
4. Configurar reglas de Firestore (`firestore.rules`)
5. Obtener credenciales del proyecto

### 5.3 Variables de Entorno

Crear `.env.local`:

```env
# Firebase Client
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin (service account)
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

### 5.4 Desplegar Reglas Firestore

```bash
# Instalar Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Inicializar proyecto
firebase init

# Desplegar reglas
firebase deploy --only firestore:rules
```

### 5.5 Desplegar en Vercel

1. Conectar repositorio GitHub a Vercel
2. Configurar variables de entorno
3. Deploy automático en cada push

```bash
# O deploy manual
npm run build
vercel --prod
```

---

## 6. Desarrollo Local

### 6.1 Instalación

```bash
# Clonar repositorio
git clone <repo-url>
cd siamo-indicador

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con credenciales

# Ejecutar
npm run dev
```

### 6.2 Comandos Disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor desarrollo (localhost:3000) |
| `npm run build` | Build producción |
| `npm start` | Iniciar producción |
| `npm run lint` | Verificar código |

### 6.3 Estructura de Componentes

```
components/
├── admin/
│   ├── mod-jornada.tsx      # ~80 líneas
│   ├── mod-carga.tsx        # ~70 líneas
│   ├── mod-asignacion.tsx   # ~100 líneas
│   ├── mod-mapa.tsx         # ~150 líneas
│   ├── mod-indicadores.tsx  # ~120 líneas
│   ├── mod-desempeno.tsx    # ~150 líneas
│   ├── mod-reportes.tsx     # ~60 líneas
│   └── mod-qr.tsx           # ~50 líneas
├── maps/
│   └── map-floor.tsx        # ~100 líneas
├── qr/
│   └── qr-glyph.tsx         # ~60 líneas
└── ui/
    ├── kpi.tsx              # ~20 líneas
    └── panel.tsx            # ~20 líneas
```

---

## Notas Importantes

1. **QR Permanente**: Los QR solo codifican el identificador de zona (ej. `TRZ://zona/Z07`). El pedido y armador cambian diariamente.

2. **Pausa de Almuerzo**: Configurable por el administrador. Default: 12:00pm - 2:00pm.

3. **Incidencias**: Nunca se marcan como "incumplimiento" automáticamente. La causa la define el supervisor.

4. **Offline**: La app está diseñada para funcionar parcialmente sin conexión (lectura de datos cacheados).

---

*Documentación generada para Siamo.Indicador v1.0*
