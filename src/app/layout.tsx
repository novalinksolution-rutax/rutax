import type { Metadata, Viewport } from "next";
import { Chivo, Azeret_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Sistema de diseño Rutax v1.0. Chivo self-hosted vía next/font como fuente
// sans de toda la interfaz.
//
// Los cuatro pesos NO son negociables y están declarados explícitamente: el 500
// sostiene los rótulos y el 600 los títulos. Subconjuntar de menos deja que el
// navegador sintetice la negrita, y eso se nota justo donde más duele — en una
// columna de cifras.
//
// Se conservan los nombres de variable heredados (`--font-sans-src`,
// `--font-geist-mono`) a propósito: `globals.css` los mapea en `@theme inline`,
// así que cambiar la cara no obliga a tocar el andamiaje ni ningún componente.
const chivo = Chivo({
  variable: "--font-sans-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Azeret Mono sostiene TODAS las cifras del producto: montos en pesos, códigos
// de envío, cantidades de bultos y horas. Tres pesos, por la misma razón.
const azeretMono = Azeret_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rutax — gestión operativo-financiera",
  description: "Plataforma para couriers de última milla: operación Flex + same-day y trastienda de dinero.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Rutax",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  // La tinta de la marca nueva. Antes era `#2a3ca0`, el navy de la identidad
  // anterior: pintaba la barra del navegador en móvil de un color que ya no
  // existe en ninguna parte del producto.
  themeColor: "#0B1114",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-CL"
      className={`${chivo.variable} ${azeretMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster position="top-right" richColors />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
