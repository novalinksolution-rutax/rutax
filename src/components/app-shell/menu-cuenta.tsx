"use client"

/**
 * MenuCuenta — bloque de cuenta al pie del sidebar (ADN de Retell §J): avatar +
 * nombre + subtítulo (email o rol) + chevron; al abrir, un popover con el
 * submenú de tema y "Cerrar sesión" al pie.
 *
 * Reutilizado por las tres superficies con sidebar:
 *  - courier `(tenant)` y seller `portal` → cierre de sesión CLIENTE (Supabase).
 *  - `admin` → cierre vía Server Action (`accionSalir`), porque su sesión es la
 *    del backstage. Si se pasa `accionSalir`, se usa un <form>; si no, el cierre
 *    cliente por defecto.
 */

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronsUpDown, LogOut } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SubmenuTema } from "./theme-switcher"

function inicialesDe(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/** Una fila de navegación adicional dentro del menú (p. ej. ajustes propios del conductor). */
export interface EnlaceMenuCuenta {
  href: string
  etiqueta: string
  /** Línea corta bajo la etiqueta — el estado actual de ese ajuste. */
  subtitulo?: string
  /**
   * El ícono YA RENDERIZADO (`<MapPin className="size-4" />`), no el componente.
   *
   * ⚠️ No lo cambies de vuelta a `LucideIcon`. Este es un componente de CLIENTE y
   * quien arma la lista es un layout de SERVIDOR: una función no cruza esa
   * frontera y React tumba el render entero con *"Functions cannot be passed
   * directly to Client Components"*. Un elemento ya renderizado sí cruza — se
   * serializa como parte del payload RSC.
   *
   * Y cuando eso pasa no se cae solo esta fila: se cae **todo lo que envuelva el
   * layout**. Así se rompió la PWA del conductor entera —manifiesto incluido— el
   * 2026-08-14, sin que `typecheck` ni `lint` dijeran una palabra: para el
   * compilador pasar `MapPin` era perfectamente válido.
   */
  icono?: React.ReactNode
}

interface MenuCuentaProps {
  nombre: string
  subtitulo?: string | null
  /** Adorno opcional a la derecha del subtítulo (p. ej. badge de rol admin). */
  adorno?: React.ReactNode
  /** Server Action de cierre (admin). Sin ella, se usa el cierre cliente. */
  accionSalir?: () => void | Promise<void>
  /** Modo colapsado del sidebar → solo avatar. */
  colapsado?: boolean
  /** Lado de apertura del popover: `top` (sidebar) o `bottom` (header conductor). */
  lado?: "top" | "bottom"
  /**
   * Filas de navegación propias de la superficie que use el menú (hoy: la PWA
   * del conductor, para su "Punto de término"). Vacío por defecto: no cambia
   * nada en `(tenant)`, `portal` ni `admin`, que no pasan esta prop.
   */
  enlaces?: EnlaceMenuCuenta[]
}

export function MenuCuenta({ nombre, subtitulo, adorno, accionSalir, colapsado, lado = "top", enlaces }: MenuCuentaProps) {
  const router = useRouter()
  const [cerrando, startCerrar] = useTransition()

  function cerrarSesionCliente() {
    startCerrar(async () => {
      const { createClient } = await import("@/lib/supabase/client")
      await createClient().auth.signOut()
      router.push("/login")
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent p-1.5 text-left shadow-xs outline-none transition-colors",
          "hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          colapsado && "justify-center border-0 bg-transparent p-0 shadow-none",
        )}
        aria-label="Cuenta"
      >
        <Avatar size="sm">
          <AvatarFallback
            className="text-[11px] font-medium text-brand-foreground"
            style={{ backgroundImage: "linear-gradient(135deg, var(--brand), var(--chart-3))" }}
          >
            {inicialesDe(nombre)}
          </AvatarFallback>
        </Avatar>
        {!colapsado ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-sidebar-foreground">{nombre}</span>
              {subtitulo ? (
                <span className="truncate text-xs text-muted-foreground">{subtitulo}</span>
              ) : null}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={lado} className="w-60">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-normal">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">{nombre}</span>
            {subtitulo ? <span className="truncate text-xs text-muted-foreground">{subtitulo}</span> : null}
          </span>
          {adorno}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <SubmenuTema />
        {enlaces && enlaces.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            {enlaces.map((enlace) => {
              return (
                <DropdownMenuItem key={enlace.href} asChild>
                  <Link href={enlace.href} className="flex w-full items-center gap-2">
                    {enlace.icono ?? null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{enlace.etiqueta}</span>
                      {enlace.subtitulo ? (
                        <span className="truncate text-xs text-muted-foreground">{enlace.subtitulo}</span>
                      ) : null}
                    </span>
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </>
        ) : null}
        <DropdownMenuSeparator />
        {accionSalir ? (
          <form action={accionSalir}>
            <DropdownMenuItem asChild variant="destructive">
              <button type="submit" className="w-full">
                <LogOut aria-hidden="true" />
                Cerrar sesión
              </button>
            </DropdownMenuItem>
          </form>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            disabled={cerrando}
            onSelect={(e) => {
              e.preventDefault()
              cerrarSesionCliente()
            }}
          >
            <LogOut aria-hidden="true" />
            Cerrar sesión
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
