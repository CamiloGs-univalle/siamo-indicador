/**
 * @file hooks/use-theme.ts
 * @description Hook para manejar el tema (light/dark) de la aplicación.
 * Persiste en localStorage y respeta prefers-color-scheme la primera vez.
 */

"use client";

import { useState, useCallback, useEffect } from "react";

type Theme = "light" | "dark";

interface UseThemeReturn {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = "siamo-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme(defaultTheme?: Theme): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(defaultTheme || getInitialTheme);

  useEffect(() => {
    document.body.className = `trazo ${theme}`;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  return { theme, toggleTheme, setTheme };
}
