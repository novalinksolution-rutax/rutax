"use client"

/**
 * ConductorNav — barra de navegación INFERIOR de la PWA del conductor (ADN de
 * Retell adaptado a móvil táctil): tabs de ≥56px de alto, alto contraste, ícono
 * + etiqueta, activo en `--brand` (navy). Sustituye los enlaces del header por
 * un tab bar al alcance del pulgar. Es la superficie operativa del conductor.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Truck, Wallet, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const TABS: { href: string; etiqueta: string; icono: LucideIcon }[] = [
  { href: "/conductor", etiqueta: "Inicio", icono: Home },
  { href: "/conductor/manifiesto", etiqueta: "Manifiesto", icono: Truck },
  { href: "/conductor/liquidaciones", etiqueta: "Liquidaciones", icono: Wallet },
]

function esActivo(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (href === "/conductor") return pathname === "/conductor"
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function ConductorNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Navegación del conductor"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-lg grid-cols-3">
        {TABS.map(({ href, etiqueta, icono: Icono }) => {
          const activo = esActivo(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={activo ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
                activo ? "text-brand" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icono className="size-5" aria-hidden="true" />
              <span>{etiqueta}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
