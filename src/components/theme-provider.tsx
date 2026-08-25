"use client"

/**
 * ThemeProvider — envoltura de `next-themes` para todo el árbol de la app.
 *
 * Monta el conmutador de tema (light/dark/system) que faltaba: define la clase
 * `.dark` en `<html>` según la preferencia, sin flash en la primera pintura
 * (next-themes inyecta un script inline que corre antes de la hidratación; por
 * eso el layout raíz marca `<html suppressHydrationWarning>`).
 *
 * `attribute={["class", "data-rx-theme"]}` → escribe LAS DOS cosas en `<html>`:
 * la clase `.dark` que consumen los tokens heredados de `globals.css`, y el
 * atributo `data-rx-theme` que consume el sistema de diseño nuevo
 * (`rx-tokens.css`). Los dos mecanismos tienen que moverse juntos: si solo se
 * escribiera la clase, `rx-tokens.css` se quedaría en su `:root`, que es el
 * tema OSCURO, y el producto abriría oscuro para todos.
 *
 * `defaultTheme="system"` + `enableSystem` → respeta la
 * preferencia del SO hasta que el usuario elija explícitamente (menú de cuenta,
 * Fase 3). `disableTransitionOnChange` evita el barrido de transiciones al
 * cambiar de tema (coherente con el sistema de movimiento sobrio de Rutax).
 */

import { usePathname } from "next/navigation"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ComponentProps } from "react"

/**
 * ⚠️ LAS RUTAS QUE VAN EN CLARO SIEMPRE
 * -----------------------------------------------------------------------------
 * El tablero dice que sin sesión el tema lo decide el sistema operativo (regla
 * 44), y **`/login` se aparta de eso por decisión del usuario (24-08-2026)**.
 *
 * Se resuelve con `forcedTheme` de la propia librería, y el primer intento fue
 * otro: un componente en la página que escribía la clase en el `<html>` más un
 * script en línea contra el parpadeo. **No funcionó, y el motivo importa** —
 * `next-themes` vuelve a aplicar su tema en su propio efecto, así que lo escrito
 * a mano se pisa sin que nada falle ni avise. Medido en el navegador: el
 * `<html>` seguía en `dark` con el componente montado.
 *
 * Con `forcedTheme` no hay pelea: la librería sabe que en esa ruta manda el
 * valor fijo, lo pinta en su script previo a la hidratación —sin parpadeo— y
 * **no toca la preferencia guardada**, así que quien pasa por el login no se
 * lleva el tema claro al resto del producto.
 *
 * Acotado a propósito: el resto de las pantallas sin sesión sigue la regla 44.
 */
const RUTAS_EN_CLARO = ["/login"]

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  const ruta = usePathname()
  const forzado = RUTAS_EN_CLARO.includes(ruta ?? "") ? "light" : undefined

  return (
    <NextThemesProvider
      attribute={["class", "data-rx-theme"]}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      forcedTheme={forzado}
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
