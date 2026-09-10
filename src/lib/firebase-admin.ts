import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

let adminApp: App | null = null;
let _adminDb: Firestore | null = null;
let _adminAuth: Auth | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;
  const serviceAccount = {
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
  adminApp = getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount as Record<string, string>) })
    : getApps()[0];
  return adminApp;
}

export function getAdminDb(): Firestore {
  if (_adminDb) return _adminDb;
  _adminDb = getFirestore(getAdminApp());
  return _adminDb;
}

export function getAdminAuth(): Auth {
  if (_adminAuth) return _adminAuth;
  _adminAuth = getAuth(getAdminApp());
  return _adminAuth;
}
