/**
 * El catálogo de íconos de navegación y el contrato de un ítem.
 *
 * Vivían dentro de `app-shell.tsx`. Salieron acá cuando la barra inferior del
 * teléfono (`nav-inferior.tsx`) necesitó los mismos íconos: importarlos desde el
 * shell habría creado un ciclo, porque el shell renderiza la barra.
 *
 * Es un módulo sin `"use client"` a propósito: son datos y tipos, así que lo
 * pueden leer también los `layout.tsx` de servidor que arman la navegación.
 */

import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Boxes,
  Building2,
  CreditCard,
  Download,
  GitCompareArrows,
  HandCoins,
  Home,
  LayoutDashboard,
  LineChart,
  Link2,
  MapPinned,
  Megaphone,
  Package,
  Plug,
  Radar,
  Receipt,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  Tag,
  TriangleAlert,
  Truck,
  UserCheck,
  Users,
  Wallet,
  Warehouse,
  MessageCircle,
  type LucideIcon,
} from "lucide-react"

export const ICONOS: Record<string, LucideIcon> = {
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
  // La libreta de a quien le escribe Rutax por WhatsApp. `Megaphone` ya es
  // "comunicaciones" del backstage, y esto no es difusion: es un directorio.
  "contactos-whatsapp": MessageCircle,
  // Bultos apilados = la carga consolidada esperando en el piso de la bodega.
  // No `Package` (ya es "pedidos") ni `Warehouse` (ya es el catálogo de bodegas):
  // la Preparación no es el lugar, es lo que se acumula dentro de él.
  preparacion: Boxes,
  // Lo que el courier le paga al conductor por visita a bodega — distinto de
  // "tarifas" (Tag, cobro al seller) y de "pagos" (Banknote, cobranza).
  "retiro-bodega": HandCoins,
  "conexion-ml": Link2,
  couriers: Building2,
  "cambiar-plan": ArrowLeftRight,
  metricas: LineChart,
  salud: Activity,
  bitacora: ScrollText,
  comunicaciones: Megaphone,
  seguridad: ShieldCheck,
  "torre-de-control": Radar,
}

export interface ItemNav {
  href: string
  etiqueta: string
  icono?: keyof typeof ICONOS | string
  /**
   * Nombre para la barra del teléfono, donde hay ~90 px por destino.
   *
   * «Preparación del día» mide 103 px a 11 px de cuerpo y se corta a mitad de
   * palabra; el tablero P1 usa «Preparación». Sin esto, la barra trunca. Cuando
   * no se declara, se usa `etiqueta` — que es lo correcto para «Pedidos» o
   * «Sellers», que ya son cortas.
   */
  etiquetaCorta?: string
  /**
   * Cifra que acompaña al destino: incidencias sin gestionar, excepciones que
   * vencen. Se muestra **solo si es mayor que cero** — un contador en 0 no es
   * información, es ruido, y gasta la señal del que sí importa.
   */
  contador?: number
  /**
   * 🔴 Este ítem NO navega: abre el Settings anidado ahí mismo.
   *
   * «Configuración» apuntaba a `/onboarding`, así que hacer clic cargaba
   * «Puesta en marcha» entera. Quien entra a Configuración va a *ver las
   * opciones*, no a caer en una de ellas — y menos en la que menos se usa
   * después del primer día. Con esto el panel se desliza y el lienzo se queda
   * donde estaba hasta que la persona elija.
   */
  abreSettings?: boolean
}

export interface GrupoNav {
  titulo: string | null
  items: ItemNav[]
}
