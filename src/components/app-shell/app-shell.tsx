"use client"

/**
 * AppShell — esqueleto del backoffice del courier `(tenant)`.
 *
 * Implementa DESIGN_SYSTEM §7 (navegación lateral + barra superior) y la
 * arquitectura de información de UX_STRATEGY §5.2: navegación AGRUPADA por
 * objetivo (Operación · Dinero · Configuración), no plana. El filtrado por
 * capacidad RBAC ocurre en el servidor (layout) — este componente solo pinta
 * los grupos que recibe: lo que un rol no puede hacer, no llega como `grupo`.
 *
 * Responsive: barra lateral fija en `lg+`; colapsa a un Sheet lateral en menor.
 */

import { useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LogOut,
  Menu,
  LayoutDashboard,
  Package,
  Truck,
  TriangleAlert,
  Receipt,
  Wallet,
  GitCompareArrows,
  Banknote,
  Settings,
  Users,
  Store,
  Download,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { CentroAvisos } from "./centro-avisos"
import { SkipLink } from "./skip-link"

/** Catálogo de íconos referenciables por nombre desde el servidor. */
const ICONOS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  pedidos: Package,
  manifiestos: Truck,
  incidencias: TriangleAlert,
  periodos: Receipt,
  liquidaciones: Wallet,
  conciliacion: GitCompareArrows,
  pagos: Banknote,
  configuracion: Settings,
  equipo: Users,
  sellers: Store,
  exportar: Download,
}

export interface ItemNav {
  href: string
  etiqueta: string
  icono?: keyof typeof ICONOS | string
}

export interface GrupoNav {
  titulo: string | null
  items: ItemNav[]
}

interface AppShellProps {
  nombreFantasia: string
  nombreCompleto: string | null
  grupos: GrupoNav[]
  banner?: React.ReactNode
  children: React.ReactNode
}

/** Devuelve el href más específico que prefija el pathname (evita doble activo). */
function hrefActivo(pathname: string | null, grupos: GrupoNav[]): string | null {
  if (!pathname) return null
  let mejor: string | null = null
  for (const grupo of grupos) {
    for (const item of grupo.items) {
      const coincide = pathname === item.href || pathname.startsWith(`${item.href}/`)
      if (coincide && (mejor === null || item.href.length > mejor.length)) {
        mejor = item.href
      }
    }
  }
  return mejor
}

function ListaNav({
  grupos,
  activo,
  onNavegar,
}: {
  grupos: GrupoNav[]
  activo: string | null
  onNavegar?: () => void
}) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {grupos.map((grupo, i) => (
        <div key={grupo.titulo ?? `grupo-${i}`} className="flex flex-col gap-1">
          {grupo.titulo ? (
            <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {grupo.titulo}
            </p>
          ) : null}
          {grupo.items.map((item) => {
            const Icono = item.icono ? ICONOS[item.icono] : undefined
            const esActivo = activo === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavegar}
                aria-current={esActivo ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                  esActivo
                    ? "bg-sidebar-primary/10 text-sidebar-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {Icono ? <Icono className="size-4 shrink-0" aria-hidden="true" /> : null}
                <span className="truncate">{item.etiqueta}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function AppShell({
  nombreFantasia,
  nombreCompleto,
  grupos,
  banner,
  children,
}: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [cerrandoSesion, startCerrarSesion] = useTransition()
  const activo = hrefActivo(pathname, grupos)

  function manejarCerrarSesion() {
    startCerrarSesion(async () => {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push("/login")
      router.refresh()
    })
  }

  const marca = (
    <span className="truncate font-heading text-base font-semibold text-foreground">
      {nombreFantasia}
    </span>
  )

  const botonSalir = (
    <Button
      variant="ghost"
      size="sm"
      onClick={manejarCerrarSesion}
      loading={cerrandoSesion}
      className="w-full justify-start text-muted-foreground"
    >
      <LogOut className="size-4" aria-hidden="true" />
      Cerrar sesión
    </Button>
  )

  return (
    <div className="min-h-svh bg-muted/20">
      <SkipLink />
      {/* Barra lateral fija — escritorio */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          {marca}
        </div>
        <ListaNav grupos={grupos} activo={activo} />
        <div className="border-t border-sidebar-border p-3">{botonSalir}</div>
      </aside>

      {/* Área principal */}
      <div className="flex min-h-svh flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {/* Menú móvil */}
          <Sheet open={menuAbierto} onOpenChange={setMenuAbierto}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                aria-label="Abrir menú"
              >
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
              <SheetTitle className="flex h-14 items-center border-b border-border px-4">
                {nombreFantasia}
              </SheetTitle>
              <ListaNav
                grupos={grupos}
                activo={activo}
                onNavegar={() => setMenuAbierto(false)}
              />
              <div className="border-t border-border p-3">{botonSalir}</div>
            </SheetContent>
          </Sheet>

          {/* Marca en móvil (en escritorio vive en la barra lateral) */}
          <div className="lg:hidden">{marca}</div>

          <div className="flex flex-1 items-center justify-end gap-2">
            <CentroAvisos />
            {nombreCompleto ? (
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                {nombreCompleto}
              </span>
            ) : null}
          </div>
        </header>

        {banner}

        <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none">
          {children}
        </main>
      </div>
    </div>
  )
}
