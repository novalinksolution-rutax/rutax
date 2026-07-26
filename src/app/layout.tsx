import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// ADN de Retell (§2.2): Inter self-hosted vía next/font, como fuente sans de
// toda la UI. Es un archivo variable → cubre los pesos 400/500/600/700 que usa
// la escala tipográfica sin cargar caras extra.
const inter = Inter({
  variable: "--font-sans-src",
  subsets: ["latin"],
  display: "swap",
});

// Se conserva un mono para números y dinero (regla de Rutax: `tabular-nums`).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  themeColor: "#2a3ca0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-CL"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
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
