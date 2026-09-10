import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Siamo.Indicador",
  description: "Sistema de gestión y medición operacional",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="trazo dark">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
