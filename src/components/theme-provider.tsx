"use client"

/**
 * ThemeProvider — envoltura de `next-themes` para todo el árbol de la app.
 *
 * Monta el conmutador de tema (light/dark/system) que faltaba: define la clase
 * `.dark` en `<html>` según la preferencia, sin flash en la primera pintura
 * (next-themes inyecta un script inline que corre antes de la hidratación; por
 * eso el layout raíz marca `<html suppressHydrationWarning>`).
 *
 * `attribute="class"` → alterna la clase `.dark` que consumen los tokens de
 * `globals.css`. `defaultTheme="system"` + `enableSystem` → respeta la
 * preferencia del SO hasta que el usuario elija explícitamente (menú de cuenta,
 * Fase 3). `disableTransitionOnChange` evita el barrido de transiciones al
 * cambiar de tema (coherente con el sistema de movimiento sobrio de Rutax).
 */

import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ComponentProps } from "react"

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
