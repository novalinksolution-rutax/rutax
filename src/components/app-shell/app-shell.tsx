"use client"

/**
 * AppShell — shell del backoffice del courier `(tenant)` y del portal del seller.
 *
 * Sidebar de 256 px con bloque de marca arriba, navegación agrupada, bloque
 * inferior con plan y configuración, y el menú de cuenta al pie. Colapsable a
 * rail de íconos, con la preferencia persistida.
 *
 * El ítem activo lleva **escalón de fondo (`bg-inset`) + regla de acento de 2 px
 * a la izquierda + peso 600**, tal como lo fija el tablero `Rutax P1 Pedidos`.
 * Las cabeceras de grupo van en mono de 9 px con tracking.
 *
 * ⚠️ La versión anterior de este comentario describía el «ADN de Retell» —
 * pastilla blanca con `shadow-xs`, acento navy, lavanda—, que es el sistema de
 * diseño **retirado** en el commit `234613d`. No es autoridad. Lo que manda son
 * `docs/diseno/` y los tableros.
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
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CentroAvisos } from "./centro-avisos"
import { ICONOS, type GrupoNav, type ItemNav } from "./iconos-nav"
import { NavInferior } from "./nav-inferior"
import { SkipLink } from "./skip-link"
import { PaletaComando } from "./paleta-comando"
import { MenuCuenta } from "./menu-cuenta"
import type { Aviso } from "@/lib/avisos/obtener-avisos"
import { SimboloRutax } from "@/components/ui/marca-rutax"

/** Catálogo de íconos referenciables por nombre desde el servidor. */


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

// `ItemNav`, `GrupoNav` e `ICONOS` viven en `iconos-nav.ts` desde que la barra
// inferior del teléfono necesitó los mismos íconos. Se re-exportan acá para no
// romper los ~10 archivos que ya los importaban desde este módulo.
export type { ItemNav, GrupoNav } from "./iconos-nav"

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
  /** Ítem de plan/suscripción, renderizado como card "Free trial" (patrón Retell). */
  itemPlan?: ItemNav
  /**
   * Opciones del menú de la CUENTA/empresa (bloque de marca superior). Ya
   * filtradas por capacidad en el servidor. Vacío → el bloque de marca queda
   * estático (portal/admin/conductor no lo pasan).
   */
  opcionesCuenta?: ItemNav[]
  /**
   * Opciones del desplegable de la card de plan. Ya filtradas por capacidad.
   * Vacío → la card de plan navega directo a `itemPlan.href` (comportamiento
   * heredado).
   */
  opcionesPlan?: ItemNav[]
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
  /**
   * Destinos de la barra inferior del teléfono. Los arma el layout con
   * `destinosMovil()`, a partir de la navegación que la persona ya puede ver,
   * así que salen del mismo gating RBAC que el sidebar. Sin ellos, la barra no
   * se renderiza y el teléfono se queda como estaba.
   */
  destinosMovil?: ItemNav[]
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
  onAbrirSettings,
}: {
  item: ItemNav
  activo: boolean
  colapsado?: boolean
  relajado?: boolean
  onNavegar?: () => void
  /** Solo para el ítem con `abreSettings`: abre el panel sin navegar. */
  onAbrirSettings?: () => void
}) {
  const Icono = item.icono ? ICONOS[item.icono] : undefined
  // 🔴 El ítem que abre Configuración es un BOTÓN, no un enlace, y la diferencia
  // no es cosmética: un enlace promete un destino y aquí no lo hay. Renderizarlo
  // como `<a href>` deja que el navegador lo abra en otra pestaña, lo precargue
  // y lo anuncie como enlace al lector de pantalla — tres promesas falsas.
  const clases = cn(
        item.abreSettings && "w-full cursor-pointer text-left",
        "group flex items-center gap-2.5 text-[13px] transition-colors duration-(--motion-fast) ease-out",
        relajado ? "px-2.5 py-2" : "px-2.5 py-[9px]",
        colapsado && "relative justify-center px-0",
        // El activo: escalón de fondo + regla de acento de 2 px a la izquierda,
        // y peso 600. **Sin sombra y sin pastilla** — la regla 4 del sistema
        // construye la elevación con fondo y borde, nunca con sombra. Antes
        // llevaba `shadow-sm` y un `ring`, que es el ADN anterior.
        activo
          ? "border-l-2 border-primary bg-bg-inset font-semibold text-fg"
          : "border-l-2 border-transparent font-normal text-fg-muted hover:bg-foreground/5 hover:text-fg",
  )

  const contenido = (
    <>
      {Icono ? (
        <Icono
          className={cn("size-4 shrink-0", activo ? "text-primary" : "text-fg-muted group-hover:text-fg")}
          aria-hidden="true"
        />
      ) : null}
      {!colapsado ? <span className="truncate">{item.etiqueta}</span> : null}
      {/* El contador del destino: excepciones que esperan, incidencias sin
          gestionar. Solo si es > 0 — un contador en cero no es información, es
          ruido, y gasta la señal del que sí importa.

          Colapsado no cabe un número: se reduce a un punto, y el `title` del
          enlace ya dice de qué destino se trata. La cifra igual viaja al lector
          de pantalla. */}
      {typeof item.contador === "number" && item.contador > 0 ? (
        colapsado ? (
          <span
            aria-label={`${item.contador} sin resolver`}
            className="absolute top-1.5 right-2 size-1.5 rounded-full bg-attention-fg"
          />
        ) : (
          <span
            aria-label={`${item.contador} sin resolver`}
            className="ml-auto inline-flex min-w-4 items-center justify-center border border-attention-line bg-attention-bg px-1 font-mono text-[10px] font-medium text-attention-fg tabular-nums"
          >
            {item.contador > 99 ? "99+" : item.contador}
          </span>
        )
      ) : null}
    </>
  )

  // Dos elementos y no uno parametrizado: TypeScript no puede reconciliar las
  // props de `Link` con las de `button` en un mismo componente dinámico, y
  // forzarlo con un `as any` escondería justo lo que aquí importa — que uno
  // lleva `href` y el otro no.
  if (item.abreSettings) {
    return (
      <button
        type="button"
        // ⚠️ NO se llama a `onNavegar`. En el teléfono esa función cierra la
        // hoja del menú, y como este botón no va a ninguna parte, cerrarla
        // dejaba a la persona mirando la pantalla anterior: el panel se abría
        // detrás de una hoja que acababa de desaparecer. La hoja se queda
        // abierta hasta que se elige un destino de verdad.
        onClick={() => onAbrirSettings?.()}
        aria-expanded={activo}
        title={colapsado ? item.etiqueta : undefined}
        className={clases}
      >
        {contenido}
      </button>
    )
  }

  return (
    <Link
      href={item.href}
      onClick={onNavegar}
      aria-current={activo ? "page" : undefined}
      title={colapsado ? item.etiqueta : undefined}
      className={clases}
    >
      {contenido}
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
  onAbrirSettings,
}: {
  grupos: GrupoNav[]
  itemsInferiores: ItemNav[]
  activo: string | null
  colapsado?: boolean
  relajado?: boolean
  onNavegar?: () => void
  onAbrirSettings?: () => void
}) {
  return (
    <>
      <nav className={cn("flex flex-1 flex-col overflow-y-auto px-3 py-3", relajado ? "gap-6" : "gap-5")}>
        {grupos.map((grupo, i) => (
          <div key={grupo.titulo ?? `grupo-${i}`} className="flex flex-col gap-1">
            {grupo.titulo && !colapsado ? (
              <p className="px-2.5 pt-3 pb-1.5 font-mono text-[9px] font-medium tracking-[0.12em] text-fg-subtle uppercase">
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
              onAbrirSettings={onAbrirSettings}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

/**
 * Contenido visual del bloque de marca (avatar + etiqueta + nombre). Se comparte
 * entre la variante estática y la variante con menú, para que ambas se vean
 * idénticas y el degradado navy→morado no se duplique.
 */
function ContenidoMarca({
  nombre,
  etiqueta,
  colapsado,
  conChevron,
}: {
  nombre: string
  etiqueta: string
  colapsado?: boolean
  conChevron?: boolean
}) {
  return (
    <>
      {/* ⚠️ Acá había un cuadrado con DEGRADADO navy→morado y la inicial del
          courier — un patrón heredado del sistema anterior que contradecía dos
          reglas del nuevo a la vez: «fuera de los seis tonos de estado el
          producto es tinta y papel, no hay acento decorativo» y la sombra en algo
          que no flota.
          Ahora va el símbolo de Rutax. La identidad del courier ya está dicha
          con su nombre al lado, que es su lugar: la marca de arriba es del dueño
          del software, y el nombre del courier es de quién es este espacio. */}
      <SimboloRutax className="size-8 shrink-0 p-0.5" titulo="Rutax" />
      {!colapsado ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] leading-tight text-muted-foreground">{etiqueta}</span>
          <span className="truncate text-sm leading-tight font-semibold text-sidebar-foreground">{nombre}</span>
        </span>
      ) : null}
      {conChevron && !colapsado ? (
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  )
}

/**
 * Bloque de marca / workspace (arriba del sidebar) — patrón "workspace switcher"
 * de Retell: card con marco, avatar cuadrado con degradado (navy→morado) + label
 * de contexto + nombre. Identidad del courier/tienda (no un switcher: Rutax no
 * tiene multi-workspace por usuario todavía).
 *
 * Si recibe `opciones` (ya filtradas por capacidad en el servidor), se vuelve un
 * menú de la CUENTA/empresa —distinto del menú de USUARIO del pie— con accesos a
 * la configuración de la empresa, el equipo y la facturación. Sin opciones, cae
 * al bloque estático de siempre (portal/admin/conductor no lo pasan).
 */
function BloqueMarca({
  nombre,
  etiqueta,
  colapsado,
  opciones = [],
  onNavegar,
}: {
  nombre: string
  etiqueta: string
  colapsado?: boolean
  opciones?: ItemNav[]
  onNavegar?: () => void
}) {
  const clasesCard = cn(
    "flex min-w-0 items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent p-1.5 shadow-xs",
    colapsado && "border-0 bg-transparent p-0 shadow-none",
  )

  if (opciones.length === 0) {
    return (
      <div className={clasesCard}>
        <ContenidoMarca nombre={nombre} etiqueta={etiqueta} colapsado={colapsado} />
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          clasesCard,
          "w-full text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        )}
        title={colapsado ? nombre : undefined}
        aria-label="Cuenta de la empresa"
      >
        <ContenidoMarca nombre={nombre} etiqueta={etiqueta} colapsado={colapsado} conChevron />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-64">
        <DropdownMenuLabel className="flex flex-col font-normal">
          <span className="truncate text-sm font-medium text-foreground">{nombre}</span>
          <span className="truncate text-xs text-muted-foreground">{etiqueta}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {opciones.map((item) => {
          const Icono = item.icono ? ICONOS[item.icono] : undefined
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href} onClick={onNavegar} className="flex w-full items-center gap-2">
                {Icono ? <Icono className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                <span className="truncate">{item.etiqueta}</span>
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell({
  nombreFantasia,
  nombreCompleto,
  grupos,
  itemsInferiores = [],
  itemsSettings = [],
  itemPlan,
  opcionesCuenta = [],
  opcionesPlan = [],
  subtituloCuenta,
  etiquetaMarca = "Courier",
  densidad = "compacta",
  rutasAnchas = [],
  avisos,
  accionSalir,
  adornoCuenta,
  mostrarAvisos = true,
  mostrarBusqueda = true,
  destinosMovil = [],
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
  // Settings anidado (Patrón H): activo cuando el pathname cae en un ítem de
  // settings…
  //
  // ⚠️ El `href` del ítem que ABRE settings cuenta como ruta de settings. Es el
  // índice (`/configuracion`), y sin esto quedaba en tierra de nadie: se veía la
  // navegación principal mientras el lienzo mostraba el índice de configuración.
  const rutasSettings = [...itemsSettings, ...itemsInferiores.filter((i) => i.abreSettings)]
  const enRutaSettings =
    itemsSettings.length > 0 &&
    rutasSettings.some((i) => pathname === i.href || pathname?.startsWith(`${i.href}/`))

  /**
   * 🔴 …o cuando la persona lo ABRIÓ, sin haber ido a ninguna parte.
   *
   * «Configuración» era un enlace a `/onboarding`: un clic cargaba «Puesta en
   * marcha» entera para que se viera el sub-menú al lado. Quien entra a
   * Configuración va a *ver las opciones*; mandarlo a una de ellas —y a la que
   * menos se usa después del primer día— le cuesta una carga de página y una
   * vuelta atrás.
   *
   * Ahora el panel se abre en el sitio y **el lienzo no se mueve** hasta que la
   * persona elija. El estado vive acá y no en la URL a propósito: no es un
   * destino, es el estado de un menú, y ensuciar la URL con él haría que el
   * botón «atrás» del navegador tuviera que deshacer un despliegue de menú.
   */
  /**
   * `null` = seguir a la ruta · `true` = lo abrió la persona · `false` = lo
   * cerró la persona.
   *
   * ⚠️ **Hizo falta el tercer estado.** Con un booleano «abierto a mano», el
   * panel se abría bien pero no se podía CERRAR estando en una pantalla de
   * configuración: la ruta lo volvía a abrir sola. La salida de entonces fue
   * que «Volver» navegara al dashboard, y eso reintrodujo el viaje que este
   * arreglo venía a quitar — el usuario lo reportó de inmediato.
   */
  const [panelSettings, setPanelSettings] = useState<boolean | null>(null)
  /** Solo para animar el regreso; ver `contenidoNormal`. */
  const [volviendoDeSettings, setVolviendoDeSettings] = useState(false)
  const enSettings = panelSettings ?? enRutaSettings

  function alternarColapso() {
    escribirColapso(!colapsado)
  }

  const botonBuscar = (colapsadoLocal: boolean, enSheet = false) => (
    <button
      type="button"
      /* 🔴 En el teléfono hay que CERRAR la hoja del menú al abrir el buscador.
         No es cortesía: la hoja y la paleta viven las dos en `z-50`, y la hoja
         se monta después en el DOM —Radix la lleva a `document.body`— así que
         gana el empate. El buscador se abría DETRÁS del menú, difuminado por su
         propio velo, y parecía roto. Cerrar la hoja es además lo correcto: el
         buscador reemplaza al menú, no se apila encima. */
      onClick={() => {
        setBusquedaAbierta(true)
        if (enSheet) setMenuAbierto(false)
      }}
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
          {/* "F" de Find: una sola letra, grande y centrada, en vez del atajo
              ⌘K. El disparo por teclado sigue siendo ⌘K (una "F" a secas
              chocaría con la escritura normal). */}
          <kbd className="flex size-5 items-center justify-center rounded border border-sidebar-border bg-sidebar text-sm leading-none font-semibold text-muted-foreground">
            F
          </kbd>
        </>
      ) : null}
    </button>
  )

  const bloquePlan = (colapsadoLocal: boolean, onNavegar?: () => void) => {
    if (!itemPlan) return null
    const Icono = itemPlan.icono ? ICONOS[itemPlan.icono] : undefined
    const clasesCard = cn(
      "flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent px-2.5 py-2 text-sm font-medium text-sidebar-foreground shadow-xs transition-colors hover:bg-accent",
      colapsadoLocal && "justify-center px-0",
    )
    const interior = (
      <>
        {Icono ? <Icono className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
        {!colapsadoLocal ? (
          <>
            <span className="flex-1 truncate">{itemPlan.etiqueta}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        ) : null}
      </>
    )

    // px-3 como el resto del shell (nav, buscador, cabecera): con px-2 este
    // bloque sobresalía 4px a cada lado y rompía la línea vertical.

    // Sin opciones: la card navega directo (comportamiento heredado).
    if (opcionesPlan.length === 0) {
      return (
        <div className="px-3 pb-1">
          <Link
            href={itemPlan.href}
            onClick={onNavegar}
            title={colapsadoLocal ? itemPlan.etiqueta : undefined}
            className={clasesCard}
          >
            {interior}
          </Link>
        </div>
      )
    }

    // Con opciones: la card es un desplegable que abre hacia ARRIBA (vive al pie
    // del sidebar), no un acceso directo a la pantalla del plan.
    return (
      <div className="px-3 pb-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(clasesCard, "w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring")}
            title={colapsadoLocal ? itemPlan.etiqueta : undefined}
            aria-label={itemPlan.etiqueta}
          >
            {interior}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            {opcionesPlan.map((item) => {
              const IconoOpcion = item.icono ? ICONOS[item.icono] : undefined
              return (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={item.href} onClick={onNavegar} className="flex w-full items-center gap-2">
                    {IconoOpcion ? (
                      <IconoOpcion className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : null}
                    <span className="truncate">{item.etiqueta}</span>
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
    /* La entrada se DESLIZA, y no es adorno: el panel reemplaza a la navegación
       principal en el mismo sitio, así que sin movimiento el cambio se lee como
       un salto y cuesta entender que se puede volver. Entra desde la derecha
       —hacia adentro— y al volver el principal entra desde la izquierda. */
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 slide-in-from-right-4 duration-(--motion-base) ease-standard">
      <div className={cn("flex items-center gap-1 px-3 pt-4 pb-2", colapsadoLocal && "flex-col")}>
        {/* 🔴 «Volver» CIERRA el panel y no navega — nunca, ni siquiera estando
            dentro de una pantalla de configuración. Una versión anterior sí
            navegaba al primer destino del menú, y el usuario lo reportó: había
            entrado a ver las opciones, no a que lo mandaran al dashboard. La
            regla es la misma en los dos sentidos: el lienzo no se mueve hasta
            que la persona elige un destino. */}
        <button
          type="button"
          onClick={() => {
            setVolviendoDeSettings(true)
            setPanelSettings(false)
            if (enSheet) setMenuAbierto(false)
          }}
          title={colapsadoLocal ? "Volver" : undefined}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-sidebar-foreground",
            colapsadoLocal && "justify-center",
          )}
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          {!colapsadoLocal ? <span className="truncate">Volver</span> : null}
        </button>
        {botonColapsar(colapsadoLocal, enSheet)}
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {!colapsadoLocal ? (
          <p className="px-2.5 pt-3 pb-1.5 font-mono text-[9px] font-medium tracking-[0.12em] text-fg-subtle uppercase">
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
    </div>
  )

  const contenidoNormal = (colapsadoLocal: boolean, enSheet = false) => (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        // Solo cuando se VUELVE de configuración. Si se animara siempre, la
        // barra se deslizaría en cada carga de página, que es exactamente el
        // tic nervioso que nadie pide.
        volviendoDeSettings && "animate-in fade-in-0 slide-in-from-left-4 duration-(--motion-base) ease-standard",
      )}
    >
      <div className={cn("flex items-center gap-1 px-3 pt-4 pb-2", colapsadoLocal && "flex-col")}>
        <div className={cn("min-w-0", colapsadoLocal ? "" : "flex-1")}>
          <BloqueMarca
            nombre={nombreFantasia}
            etiqueta={etiquetaMarca}
            colapsado={colapsadoLocal}
            opciones={opcionesCuenta}
            onNavegar={enSheet ? () => setMenuAbierto(false) : undefined}
          />
        </div>
        {mostrarAvisos ? <CentroAvisos avisos={avisos} /> : null}
        {botonColapsar(colapsadoLocal, enSheet)}
      </div>
      {mostrarBusqueda ? <div className="px-3 pb-1">{botonBuscar(colapsadoLocal, enSheet)}</div> : null}
      <Navegacion
        grupos={grupos}
        itemsInferiores={itemsInferiores}
        activo={activo}
        colapsado={colapsadoLocal}
        relajado={relajado}
        onNavegar={enSheet ? () => setMenuAbierto(false) : undefined}
        onAbrirSettings={() => {
          setVolviendoDeSettings(false)
          setPanelSettings(true)
        }}
      />
      {bloquePlan(colapsadoLocal, enSheet ? () => setMenuAbierto(false) : undefined)}
      {bloqueCuenta(colapsadoLocal)}
    </div>
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
            <BloqueMarca nombre={nombreFantasia} etiqueta={etiquetaMarca} opciones={opcionesCuenta} />
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
            "mx-auto w-full flex-1 px-4 outline-none lg:px-8",
            destinosMovil.length > 0 ? "pb-24 lg:pb-10" : "pb-10",
            ancho
              // 1800 px es un techo, no una medida: en 1920 con la barra
              // lateral el contenido queda en ~1600 y el tope no se alcanza, o
              // sea que se comporta como fluido. Existe para que en un monitor
              // de 2560 una fila de tabla no llegue a los 2.300 px, donde el
              // ojo ya no encuentra la columna de la derecha desde la primera.
              ? "max-w-[1800px] pt-5 lg:pt-6"
              : relajado
                ? "max-w-5xl pt-6 lg:pt-8"
                : "max-w-6xl pt-5 lg:pt-6",
          )}
        >
          {children}
        </main>

        {/* La barra vive fuera del <main> y el <main> le deja su alto libre:
            un `fixed` no reserva espacio, y sin este colchón la última fila de
            cualquier tabla queda debajo de la barra justo donde se toca. */}
        <NavInferior items={destinosMovil} hrefActivo={activo} />
      </div>

      {mostrarBusqueda ? (
        <PaletaComando abierta={busquedaAbierta} onAbrirCambio={setBusquedaAbierta} />
      ) : null}
    </div>
  )
}
