"use client";

/**
 * @file lib/auth-context.tsx
 * @description Autenticación y estado de usuario global.
 * Resuelve el usuario desde Firebase Auth + Firestore via /api/claim-invite.
 * Soporta modo demo para testing sin backend.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export type UserRole = "super_admin" | "admin" | "armador";

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  companyId?: string;
  adminId?: string;
  sector?: string;
  color?: string;
  /** id del documento en `armadores/{armadorId}` vinculado al reclamar la invitación (solo role "armador"). */
  armadorId?: string;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const appUser = await resolveUser(firebaseUser);
          setUser(appUser);
        } else {
          // Check for demo mode cookie
          const demoRole = getDemoRole();
          if (demoRole) {
            setUser(createDemoUser(demoRole));
          } else {
            setUser(null);
          }
        }
      } catch (err) {
        console.error("Auth resolve error:", err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Extrae el rol demo de la cookie.
 */
function getDemoRole(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((row) => row.startsWith("demo-role="));
  return match?.split("=")[1] || null;
}

/**
 * Crea un usuario demo sintético basado en el rol.
 */
function createDemoUser(role: string): AppUser {
  const roleMap: Record<string, { name: string; role: UserRole }> = {
    "super-admin": { name: "Super Administrador", role: "super_admin" },
    "admin": { name: "Administrador", role: "admin" },
    "armador": { name: "Armador", role: "armador" },
  };
  const config = roleMap[role] || roleMap["armador"];
  return {
    uid: `demo-${role}`,
    email: `demo@${role}.com`,
    name: config.name,
    role: config.role,
  };
}

/**
 * Resuelve el usuario real desde Firebase:
 * 1. Llama a /api/claim-invite para crear/vincular el perfil
 * 2. Lee el doc users/{uid} para hidratar AppUser
 */
async function resolveUser(firebaseUser: FirebaseUser): Promise<AppUser | null> {
  const token = await firebaseUser.getIdToken();

  // Llamar claim-invite para crear/actualizar el perfil
  const res = await fetch("/api/claim-invite", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // No autorizado → cerrar sesión
    await auth.signOut();
    return null;
  }

  // Leer el doc del usuario desde Firestore
  const snap = await getDoc(doc(db, "users", firebaseUser.uid));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    uid: snap.id,
    email: data.email || firebaseUser.email || "",
    name: data.name || firebaseUser.displayName || "",
    role: data.role,
    companyId: data.companyId,
    adminId: data.adminId,
    sector: data.sector,
    color: data.color,
    armadorId: data.armadorId,
  };
}
