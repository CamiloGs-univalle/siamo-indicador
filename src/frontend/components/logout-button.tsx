/**
 * @file components/logout-button.tsx
 * @description Botón de cerrar sesión reutilizable.
 * Limpia cookie de auth y redirige a login.
 */

"use client";

import { auth } from "@/frontend/services/firebase";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { I } from "@/frontend/components/icons";

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      document.cookie = "auth-token=; path=/; max-age=0";
      router.push("/login");
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  return (
    <button className="iconbtn" onClick={handleLogout} title="Cerrar sesión">
      <I.logout />
    </button>
  );
}
