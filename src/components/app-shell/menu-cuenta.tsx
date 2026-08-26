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
  const [cerrando, startCerrar] = useTransition()

  /**
   * 🔴 **Se cierra en el SERVIDOR, y sin `<form>`.** Dos arreglos en uno, y el
   * botón estaba roto por los dos motivos a la vez:
   *
   * · Antes llamaba a `auth.signOut()` del cliente del navegador y **descartaba
   *   su respuesta**. Si esa llamada fallaba, no quedaba rastro y la persona
   *   veía exactamente lo mismo que si no hubiera pulsado.
   * · Y la otra rama envolvía un `<button type="submit">` en un
   *   `DropdownMenuItem`: Radix cierra el menú al seleccionar, **desmonta el
   *   formulario antes de que el navegador lo envíe**, y el submit se pierde.
   *
   * Con `onSelect` + `preventDefault` el menú NO se cierra solo, y la acción de
   * servidor se llama directo. Ella borra la cookie y redirige.
   */
  function salir() {
    startCerrar(async () => {
      if (accionSalir) {
        await accionSalir()
        return
      }
      // Sin acción de servidor no hay forma fiable de cerrar: se dice, en vez
      // de fingir que se cerró.
      console.error("[sesion] esta superficie no recibió `accionSalir`")
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
          {/* Las iniciales van sobre superficie neutra, sin degradado.
              El degradado navy→morado que había acá es del sistema anterior, y
              rompe la misma regla que rompía el cuadrado de la marca: «fuera de
              los seis tonos de estado y la paleta de gráficos, el producto es
              tinta y papel». Un avatar de usuario no es un estado, así que no
              tiene color que gastar. */}
          <AvatarFallback className="bg-bg-inset text-[11px] font-medium text-fg-muted">
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
        <DropdownMenuItem
          variant="destructive"
          disabled={cerrando}
          onSelect={(e) => {
            e.preventDefault()
            salir()
          }}
        >
          <LogOut aria-hidden="true" />
          {cerrando ? "Cerrando…" : "Cerrar sesión"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
