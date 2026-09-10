"use client";

/**
 * @file lib/auth-context.tsx
 * @description Autenticación y estado de usuario global.
 * Resuelve el usuario desde Firebase Auth + /api/claim-invite (Admin SDK).
 * NO lee Firestore directamente desde el cliente — evita problemas de reglas.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";

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

function getDemoRole(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((row) => row.startsWith("demo-role="));
  return match?.split("=")[1] || null;
}

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
 * Resuelve el usuario llamando a /api/claim-invite (Admin SDK).
 * El API crea/actualiza el perfil y devuelve los datos —
 * el cliente NO necesita leer Firestore.
 */
async function resolveUser(firebaseUser: FirebaseUser): Promise<AppUser | null> {
  const token = await firebaseUser.getIdToken();

  const res = await fetch("/api/claim-invite", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    await auth.signOut();
    return null;
  }

  const data = await res.json();

  if (!data.ok || !data.user) {
    await auth.signOut();
    return null;
  }

  const u = data.user;
  return {
    uid: u.uid,
    email: u.email || firebaseUser.email || "",
    name: u.name || firebaseUser.displayName || "",
    role: u.role,
    companyId: u.companyId || undefined,
    adminId: u.adminId || undefined,
    sector: u.sector || undefined,
    color: u.color || undefined,
    armadorId: u.armadorId || undefined,
  };
}
