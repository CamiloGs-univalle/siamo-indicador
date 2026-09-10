# Guía de Despliegue — Siamo.Indicador

## Despliegue en Producción

### Paso 1: Preparar Repositorio

```bash
# Inicializar git (si no está inicializado)
git init
git add .
git commit -m "feat: initial setup siamo-indicador"

# Conectar con GitHub
git remote add origin <url-del-repositorio>
git push -u origin main
```

### Paso 2: Configurar Firebase

1. Ir a [Firebase Console](https://console.firebase.google.com)
2. Seleccionar el proyecto `siamo-indicador`
3. Ir a **Authentication** → **Sign-in method** → Habilitar **Google**
4. Ir a **Firestore Database** → **Crear base de datos** (modo producción)
5. Ir a **Rules** → Pegar contenido de `firestore.rules` → **Publish**

### Paso 3: Obtener Credenciales

#### Credenciales Client (para .env.local)
1. Ir a **Project Settings** → **General**
2. En "Your apps", clic en ícono web `</>`
3. Registrar app con nombre "Siamo.Indicador"
4. Copiar `firebaseConfig` a `.env.local`

#### Credenciales Admin (para .env.local)
1. Ir a **Project Settings** → **Service accounts**
2. Clic en "Generate new private key"
3. Guardar JSON
4. Extraer valores para `.env.local`

### Paso 4: Configurar Vercel

1. Ir a [Vercel](https://vercel.com)
2. Importar repositorio de GitHub
3. Configurar variables de entorno:

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=siamo-indicador.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=siamo-indicador
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=siamo-indicador.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
FIREBASE_ADMIN_PROJECT_ID=siamo-indicador
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxxx@siamo-indicador.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

4. Clic en "Deploy"

### Paso 5: Verificar Despliegue

1. Abrir URL de Vercel (ej. `https://siamo-indicador.vercel.app`)
2. Hacer clic en "Continuar con Google"
3. Iniciar sesión con `auxiliar.ti@proservis.com.co`
4. Verificar que se crea el usuario como super_admin
5. Crear una empresa de prueba
6. Crear un administrador
7. Verificar que el admin puede entrar

---

## Comandos Útiles

```bash
# Desarrollo local
npm run dev

# Build producción
npm run build

# Desplegar solo Firestore rules
firebase deploy --only firestore:rules

# Ver logs de Vercel
vercel logs

# Rollback en Vercel
vercel rollback
```

---

## Troubleshooting

### Error: "Missing or insufficient permissions"
- Verificar que `firestore.rules` esté desplegado
- Verificar que el usuario tenga el rol correcto en Firestore

### Error: "Firebase: Error (auth/popup-closed-by-user)"
- El usuario cerró el popup de Google
- Verificar que Google Auth esté habilitado en Firebase Console

### Error: ".functions is not a function"
- Verificar que todas las dependencias estén instaladas
- Ejecutar `npm install`

### La app no carga después del deploy
- Verificar variables de entorno en Vercel
- Verificar logs en Vercel Dashboard → Functions

---

## Monitoreo

### Firebase Console
- **Authentication**: Ver usuarios registrados
- **Firestore**: Ver datos en tiempo real
- **Functions**: Ver logs de funciones (si se usan)

### Vercel Dashboard
- **Analytics**: Ver tráfico
- **Functions**: Ver logs de serverless
- **Speed Insights**: Ver rendimiento

---

*Guía de despliegue para Siamo.Indicador v1.0*
