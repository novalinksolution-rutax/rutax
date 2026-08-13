"use client"

/**
 * AppShell — shell del backoffice del courier `(tenant)` y del portal del seller.
 *
 * Rediseño Fase 3 (ADN de Retell, patrón A): sidebar ~256px sobre `--sidebar`
 * (lavanda), SIN borde derecho (el contraste lo da el color); bloque de marca /
 * workspace arriba; navegación AGRUPADA con headers `xs` uppercase muted; ítem
 * activo = **pill blanca** (`--sidebar-accent`) con `shadow-xs` e ícono en
 * `--brand` (navy); hover lavanda; bloque inferior con ítems de plan/config y el
 * **menú de cuenta** (avatar + tema + cerrar sesión). Colapsable a rail de íconos.
 *
 * El filtrado por capacidad RBAC ocurre en el servidor (layout) — este componente
 * solo pinta los `grupos` que recibe. Densidad `relajada` para el portal (seller).
 */

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Menu,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
  ChevronsUpDown,
  LayoutDashboard,
  Home,
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
  UserCheck,
  Tag,
  CreditCard,
  Rocket,
  Plug,
  MapPinned,
  Link2,
  Building2,
  LineChart,
  Activity,
  ScrollText,
  Megaphone,
  ShieldCheck,
  Radar,
  Warehouse,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { CentroAvisos } from "./centro-avisos"
import { SkipLink } from "./skip-link"
import { PaletaComando } from "./paleta-comando"
import { MenuCuenta } from "./menu-cuenta"
import type { Aviso } from "@/lib/avisos/obtener-avisos"

/** Catálogo de íconos referenciables por nombre desde el servidor. */
const ICONOS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  inicio: Home,
  cobros: Wallet,
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
  conductores: UserCheck,
  tarifas: Tag,
  plan: CreditCard,
  "puesta-en-marcha": Rocket,
  integraciones: Plug,
  zonas: MapPinned,
  // `Building2` ya está tomado por "couriers" en el panel de administración.
  bodegas: Warehouse,
  "conexion-ml": Link2,
  couriers: Building2,
  metricas: LineChart,
  salud: Activity,
  bitacora: ScrollText,
  comunicaciones: Megaphone,
  seguridad: ShieldCheck,
  "torre-de-control": Radar,
}

/**
 * Preferencia de colapso del sidebar como store externo (persistida en
 * localStorage). Se lee con `useSyncExternalStore` para evitar `setState` dentro
 * de un effect (regla del proyecto) y es SSR-safe (`getServerSnapshot` = false).
 */
const CLAVE_COLAPSO = "rutax:sidebar-colapsado"
const listenersColapso = new Set<() => void>()

function leerColapso(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(CLAVE_COLAPSO) === "1"
}
function suscribirColapso(cb: () => void): () => void {
  listenersColapso.add(cb)
  window.addEventListener("storage", cb)
  return () => {
    listenersColapso.delete(cb)
    window.removeEventListener("storage", cb)
  }
}
function escribirColapso(valor: boolean): void {
  window.localStorage.setItem(CLAVE_COLAPSO, valor ? "1" : "0")
  listenersColapso.forEach((l) => l())
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
  /** Ítems del bloque inferior (Mi plan, Configuración…), sobre el menú de cuenta. */
  itemsInferiores?: ItemNav[]
  /**
   * Ítems del Settings anidado (Patrón H de Retell). Cuando el pathname cae en
   * uno de ellos, el sidebar se REEMPLAZA por esta sub-navegación con "‹ Volver".
   * Opt-in: solo `(tenant)` lo pasa; admin/portal/conductor no se ven afectados.
   */
  itemsSettings?: ItemNav[]
  /** Destino del "‹ Volver" del Settings anidado (área principal). */
  hrefPrincipal?: string
  /** Ítem de plan/suscripción, renderizado como card "Free trial" (patrón Retell). */
  itemPlan?: ItemNav
  /** Subtítulo del menú de cuenta (email o rol). */
  subtituloCuenta?: string | null
  /** Etiqueta del bloque de marca ("Courier", "Tienda"…). */
  etiquetaMarca?: string
  /** Densidad: `compacta` (courier) o `relajada` (portal). */
  densidad?: "compacta" | "relajada"
  /**
   * Rutas que se salen del `max-w` del `<main>` y usan el ancho amplio.
   *
   * Existe por una sola pantalla —la Torre de control— y por una razón concreta:
   * un mapa necesita más ancho que un formulario, y `max-w-6xl` deja la caja
   * cartográfica angosta justo donde la comuna tiene que reconocerse de un
   * vistazo. **La excepción se declara acá y no se le quita el `max-w` a las
   * demás pantallas**, que es lo que mantiene legible el resto del backoffice.
   *
   * La lista la pasa el layout que conoce sus rutas, no el shell: éste es
   * genérico y lo comparten `(tenant)`, `portal`, `conductor` y `admin`.
   */
  rutasAnchas?: string[]
  avisos?: Aviso[]
  /** Server Action de cierre de sesión (admin). Sin ella, cierre cliente. */
  accionSalir?: () => void | Promise<void>
  /** Adorno junto al nombre en el menú de cuenta (p. ej. badge de rol admin). */
  adornoCuenta?: React.ReactNode
  /** Centro de avisos in-app (por defecto sí; admin no lo tiene). */
  mostrarAvisos?: boolean
  /** Buscador global ⌘K (por defecto sí; admin no lo usa). */
  mostrarBusqueda?: boolean
  banner?: React.ReactNode
  children: React.ReactNode
}

/** Devuelve el href más específico que prefija el pathname (evita doble activo). */
function hrefActivo(pathname: string | null, grupos: GrupoNav[], inferiores: ItemNav[]): string | null {
  if (!pathname) return null
  let mejor: string | null = null
  const todos = [...grupos.flatMap((g) => g.items), ...inferiores]
  for (const item of todos) {
    const coincide = pathname === item.href || pathname.startsWith(`${item.href}/`)
    if (coincide && (mejor === null || item.href.length > mejor.length)) mejor = item.href
  }
  return mejor
}

function ItemLink({
  item,
  activo,
  colapsado,
  relajado,
  onNavegar,
}: {
  item: ItemNav
  activo: boolean
  colapsado?: boolean
  relajado?: boolean
  onNavegar?: () => void
}) {
  const Icono = item.icono ? ICONOS[item.icono] : undefined
  return (
    <Link
      href={item.href}
      onClick={onNavegar}
      aria-current={activo ? "page" : undefined}
      title={colapsado ? item.etiqueta : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors duration-(--motion-fast) ease-out",
        relajado ? "px-2.5 py-2" : "px-2.5 py-1.5",
        colapsado && "justify-center px-0",
        activo
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-sidebar-foreground",
      )}
    >
      {Icono ? (
        <Icono
          className={cn("size-4 shrink-0", activo ? "text-brand" : "text-muted-foreground group-hover:text-sidebar-foreground")}
          aria-hidden="true"
        />
      ) : null}
      {!colapsado ? <span className="truncate">{item.etiqueta}</span> : null}
    </Link>
  )
}

function Navegacion({
  grupos,
  itemsInferiores,
  activo,
  colapsado,
  relajado,
  onNavegar,
}: {
  grupos: GrupoNav[]
  itemsInferiores: ItemNav[]
  activo: string | null
  colapsado?: boolean
  relajado?: boolean
  onNavegar?: () => void
}) {
  return (
    <>
      <nav className={cn("flex flex-1 flex-col overflow-y-auto px-3 py-3", relajado ? "gap-6" : "gap-5")}>
        {grupos.map((grupo, i) => (
          <div key={grupo.titulo ?? `grupo-${i}`} className="flex flex-col gap-1">
            {grupo.titulo && !colapsado ? (
              <p className="px-2.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {grupo.titulo}
              </p>
            ) : null}
            {grupo.items.map((item) => (
              <ItemLink
                key={item.href}
                item={item}
                activo={activo === item.href}
                colapsado={colapsado}
                relajado={relajado}
                onNavegar={onNavegar}
              />
            ))}
          </div>
        ))}
      </nav>
      {itemsInferiores.length > 0 ? (
        <div className="flex flex-col gap-1 px-3 pb-2">
          {itemsInferiores.map((item) => (
            <ItemLink
              key={item.href}
              item={item}
              activo={activo === item.href}
              colapsado={colapsado}
              relajado={relajado}
              onNavegar={onNavegar}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

/**
 * Bloque de marca / workspace (arriba del sidebar) — patrón "workspace switcher"
 * de Retell: card con marco, avatar cuadrado con degradado (navy→morado) + label
 * de contexto + nombre. Identidad del courier/tienda (no un switcher: Rutax no
 * tiene multi-workspace por usuario todavía).
 */
function BloqueMarca({ nombre, etiqueta, colapsado }: { nombre: string; etiqueta: string; colapsado?: boolean }) {
  const inicial = nombre.trim().charAt(0).toUpperCase() || "R"
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent p-1.5 shadow-xs",
        colapsado && "border-0 bg-transparent p-0 shadow-none",
      )}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-brand-foreground shadow-xs"
        style={{ backgroundImage: "linear-gradient(135deg, var(--brand), var(--chart-3))" }}
        aria-hidden="true"
      >
        {inicial}
      </span>
      {!colapsado ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] leading-tight text-muted-foreground">{etiqueta}</span>
          <span className="truncate text-sm leading-tight font-semibold text-sidebar-foreground">{nombre}</span>
        </span>
      ) : null}
    </div>
  )
}

export function AppShell({
  nombreFantasia,
  nombreCompleto,
  grupos,
  itemsInferiores = [],
  itemsSettings = [],
  hrefPrincipal = "/",
  itemPlan,
  subtituloCuenta,
  etiquetaMarca = "Courier",
  densidad = "compacta",
  rutasAnchas = [],
  avisos,
  accionSalir,
  adornoCuenta,
  mostrarAvisos = true,
  mostrarBusqueda = true,
  banner,
  children,
}: AppShellProps) {
  const pathname = usePathname()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [busquedaAbierta, setBusquedaAbierta] = useState(false)
  const colapsado = useSyncExternalStore(suscribirColapso, leerColapso, () => false)
  const activo = hrefActivo(pathname, grupos, [...itemsInferiores, ...itemsSettings])
  const relajado = densidad === "relajada"
  // El ancho amplio es por RUTA, no por densidad: la densidad la fija el layout
  // para toda su área y esto es la excepción de una pantalla.
  const ancho = rutasAnchas.some((r) => pathname === r || pathname?.startsWith(`${r}/`))
  // Settings anidado (Patrón H): activo cuando el pathname cae en un ítem de settings.
  const enSettings =
    itemsSettings.length > 0 &&
    itemsSettings.some((i) => pathname === i.href || pathname?.startsWith(`${i.href}/`))

  function alternarColapso() {
    escribirColapso(!colapsado)
  }

  const botonBuscar = (colapsadoLocal: boolean) => (
    <button
      type="button"
      onClick={() => setBusquedaAbierta(true)}
      title={colapsadoLocal ? "Buscar" : undefined}
      className={cn(
        // `w-full` es lo que alinea el buscador con el resto del shell: sin él
        // el <button> se encoge a su contenido — expandido quedaba 134px contra
        // los 222px de los ítems de navegación, y colapsado se reducía al ancho
        // del ícono (18px), dejando la lupa pegada al borde izquierdo del riel
        // en vez de centrada como los demás iconos.
        "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-background/60 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-sidebar-foreground",
        colapsadoLocal ? "justify-center px-0 py-1.5" : "px-2.5 py-1.5",
      )}
      aria-label="Buscar"
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      {!colapsadoLocal ? (
        <>
          <span className="flex-1 text-left">Buscar</span>
          <kbd className="rounded border border-sidebar-border bg-sidebar px-1.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </>
      ) : null}
    </button>
  )

  const bloquePlan = (colapsadoLocal: boolean, onNavegar?: () => void) => {
    if (!itemPlan) return null
    const Icono = itemPlan.icono ? ICONOS[itemPlan.icono] : undefined
    return (
      // px-3 como el resto del shell (nav, buscador, cabecera): con px-2 este
      // bloque sobresalía 4px a cada lado y rompía la línea vertical.
      <div className="px-3 pb-1">
        <Link
          href={itemPlan.href}
          onClick={onNavegar}
          title={colapsadoLocal ? itemPlan.etiqueta : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent px-2.5 py-2 text-sm font-medium text-sidebar-foreground shadow-xs transition-colors hover:bg-accent",
            colapsadoLocal && "justify-center px-0",
          )}
        >
          {Icono ? <Icono className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
          {!colapsadoLocal ? (
            <>
              <span className="flex-1 truncate">{itemPlan.etiqueta}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </>
          ) : null}
        </Link>
      </div>
    )
  }

  const bloqueCuenta = (colapsadoLocal: boolean) => (
    <div className="p-2">
      <MenuCuenta
        nombre={nombreCompleto ?? "Cuenta"}
        subtitulo={subtituloCuenta}
        adorno={adornoCuenta}
        accionSalir={accionSalir}
        colapsado={colapsadoLocal}
      />
    </div>
  )

  const botonColapsar = (colapsadoLocal: boolean, enSheet: boolean) =>
    !enSheet ? (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={alternarColapso}
        className="shrink-0 text-muted-foreground"
        aria-label={colapsadoLocal ? "Expandir menú" : "Colapsar menú"}
      >
        {colapsadoLocal ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>
    ) : null

  // Sidebar del Settings anidado (Patrón H): "‹ Volver" + sub-ítems de configuración.
  const contenidoSettings = (colapsadoLocal: boolean, enSheet = false) => (
    <>
      <div className={cn("flex items-center gap-1 px-3 pt-4 pb-2", colapsadoLocal && "flex-col")}>
        <Link
          href={hrefPrincipal}
          onClick={enSheet ? () => setMenuAbierto(false) : undefined}
          title={colapsadoLocal ? "Volver" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-sidebar-foreground",
            colapsadoLocal && "justify-center",
          )}
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          {!colapsadoLocal ? <span className="truncate">Volver</span> : null}
        </Link>
        {botonColapsar(colapsadoLocal, enSheet)}
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {!colapsadoLocal ? (
          <p className="px-2.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Configuración
          </p>
        ) : null}
        {itemsSettings.map((item) => (
          <ItemLink
            key={item.href}
            item={item}
            activo={activo === item.href}
            colapsado={colapsadoLocal}
            relajado={relajado}
            onNavegar={enSheet ? () => setMenuAbierto(false) : undefined}
          />
        ))}
      </nav>
      {bloquePlan(colapsadoLocal, enSheet ? () => setMenuAbierto(false) : undefined)}
      {bloqueCuenta(colapsadoLocal)}
    </>
  )

  const contenidoNormal = (colapsadoLocal: boolean, enSheet = false) => (
    <>
      <div className={cn("flex items-center gap-1 px-3 pt-4 pb-2", colapsadoLocal && "flex-col")}>
        <div className={cn("min-w-0", colapsadoLocal ? "" : "flex-1")}>
          <BloqueMarca nombre={nombreFantasia} etiqueta={etiquetaMarca} colapsado={colapsadoLocal} />
        </div>
        {mostrarAvisos ? <CentroAvisos avisos={avisos} /> : null}
        {botonColapsar(colapsadoLocal, enSheet)}
      </div>
      {mostrarBusqueda ? <div className="px-3 pb-1">{botonBuscar(colapsadoLocal)}</div> : null}
      <Navegacion
        grupos={grupos}
        itemsInferiores={itemsInferiores}
        activo={activo}
        colapsado={colapsadoLocal}
        relajado={relajado}
        onNavegar={enSheet ? () => setMenuAbierto(false) : undefined}
      />
      {bloquePlan(colapsadoLocal, enSheet ? () => setMenuAbierto(false) : undefined)}
      {bloqueCuenta(colapsadoLocal)}
    </>
  )

  const contenidoSidebar = (colapsadoLocal: boolean, enSheet = false) =>
    enSettings ? contenidoSettings(colapsadoLocal, enSheet) : contenidoNormal(colapsadoLocal, enSheet)

  return (
    <div className="min-h-svh bg-background">
      <SkipLink />

      {/* Sidebar fijo — escritorio */}
      <aside
        className={cn(
          "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:flex-col lg:bg-sidebar lg:transition-[width] lg:duration-(--motion-base) lg:ease-standard",
          colapsado ? "lg:w-16" : "lg:w-64",
        )}
      >
        {contenidoSidebar(colapsado)}
      </aside>

      {/* Área principal */}
      <div className={cn("flex min-h-svh flex-col transition-[padding] duration-(--motion-base) ease-standard", colapsado ? "lg:pl-16" : "lg:pl-64")}>
        {/* Barra superior mínima — solo móvil (en escritorio el header vive en cada página) */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur lg:hidden">
          <Sheet open={menuAbierto} onOpenChange={setMenuAbierto}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Abrir menú">
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navegación</SheetTitle>
              {contenidoSidebar(false, true)}
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <BloqueMarca nombre={nombreFantasia} etiqueta={etiquetaMarca} />
          </div>
          {mostrarBusqueda ? (
            <button
              type="button"
              onClick={() => setBusquedaAbierta(true)}
              className="text-muted-foreground"
              aria-label="Buscar"
            >
              <Search className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          {mostrarAvisos ? <CentroAvisos avisos={avisos} /> : null}
        </header>

        {banner}

        <main
          id="contenido"
          tabIndex={-1}
          className={cn(
            "mx-auto w-full flex-1 px-4 pb-10 outline-none lg:px-8",
            ancho
              ? "max-w-[1600px] pt-5 lg:pt-6"
              : relajado
                ? "max-w-5xl pt-6 lg:pt-8"
                : "max-w-6xl pt-5 lg:pt-6",
          )}
        >
          {children}
        </main>
      </div>

      {mostrarBusqueda ? (
        <PaletaComando abierta={busquedaAbierta} onAbrirCambio={setBusquedaAbierta} />
      ) : null}
    </div>
  )
}
