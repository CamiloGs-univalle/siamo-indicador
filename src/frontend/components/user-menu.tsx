/**
 * @file components/user-menu.tsx
 * @description Menú de usuario reutilizable para el topbar.
 * Muestra nombre, hover con email, click con dropdown.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/frontend/services/firebase";
import { signOut } from "firebase/auth";
import { I } from "@/frontend/components/icons";

interface UserMenuProps {
  name: string;
  email: string;
  role?: string;
  color?: string;
}

export function UserMenu({ name, email, role, color }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const initial = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      document.cookie = "auth-token=; path=/; max-age=0";
      document.cookie = "demo-role=; path=/; max-age=0";
      router.push("/login");
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  const handleChangeAccount = async () => {
    try {
      await signOut(auth);
    } catch {}
    document.cookie = "auth-token=; path=/; max-age=0";
    document.cookie = "demo-role=; path=/; max-age=0";
    router.push("/login");
  };

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => setOpen(!open)}
      >
        <span className="avatar" style={{ background: color || "var(--accent)", width: 28, height: 28, fontSize: 11 }}>
          {initial}
        </span>
        <div className="user-menu-text">
          <div className="nm">{name}</div>
          {role && <div className="role">{role}</div>}
        </div>
      </button>

      {showTooltip && !open && (
        <div className="user-tooltip">
          <I.mail width={12} height={12} />
          <span>{email}</span>
        </div>
      )}

      {open && (
        <div className="user-dropdown">
          <div className="user-dropdown-header">
            <span className="avatar" style={{ background: color || "var(--accent)", width: 40, height: 40, fontSize: 14 }}>
              {initial}
            </span>
            <div>
              <div className="name">{name}</div>
              <div className="email">{email}</div>
              {role && <div className="role">{role}</div>}
            </div>
          </div>
          <div className="user-dropdown-divider" />
          <button className="user-dropdown-item" onClick={handleChangeAccount}>
            <I.users width={14} height={14} />
            <span>Cambiar cuenta</span>
          </button>
          <button className="user-dropdown-item logout" onClick={handleLogout}>
            <I.logout width={14} height={14} />
            <span>Salir</span>
          </button>
        </div>
      )}
    </div>
  );
}
