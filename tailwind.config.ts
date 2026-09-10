import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        card: { DEFAULT: "var(--color-card)", foreground: "var(--color-card-foreground)" },
        primary: { DEFAULT: "var(--color-primary)", foreground: "var(--color-primary-foreground)" },
        secondary: { DEFAULT: "var(--color-secondary)", foreground: "var(--color-secondary-foreground)" },
        muted: { DEFAULT: "var(--color-muted)", foreground: "var(--color-muted-foreground)" },
        accent: { DEFAULT: "var(--color-accent)", foreground: "var(--color-accent-foreground)" },
        destructive: { DEFAULT: "var(--color-destructive)" },
        border: "var(--color-border)",
        input: "var(--color-input)",
        ring: "var(--color-ring)",
        "s-assigned": "var(--color-s-assigned)",
        "s-active": "var(--color-s-active)",
        "s-done": "var(--color-s-done)",
        "s-not": "var(--color-s-not)",
        "s-idle": "var(--color-s-idle)",
        "s-inc": "var(--color-s-inc)",
        gold: "var(--color-gold)",
      },
      borderRadius: {
        xl: "var(--radius)",
      },
    },
  },
  plugins: [],
};
export default config;
