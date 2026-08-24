/**
 * Página pública de seguimiento de pedido (Bloque 2 — F11/F12).
 *
 * FRONTERA DURA: solo aplica a los pedidos cuyo seguimiento es de Rutax — hoy
 * todos menos los de fuente `ml_flex`, donde el comprador ve el seguimiento de
 * Mercado Libre. Esta página rechaza (404) cualquier otro pedido o token
 * inexistente. La URL que Rutax devuelve a Shopify como `trackingInfo.url` es
 * justamente esta.
 *
 * Ruta PÚBLICA (sin autenticación): se accede con un `tracking_token` opaco no
 * adivinable. Por minimización de datos personales, esta página muestra SOLO:
 *   - Marca/nombre del seller.
 *   - Estado legible del pedido (en preparación / en camino / entregado / con novedad).
 *   - Hora estimada de entrega (ETA = fecha_compromiso_hora).
 *
 * NO muestra (decisión de privacidad — Ley 21.431 / minimización):
 *   - Posición, nombre ni teléfono del conductor.
 *   - Nombre, teléfono ni dirección exacta del destinatario.
 *   - Foto del POD ni datos de otros pedidos.
 */

import { notFound } from "next/navigation";
import { Package, Clock, CheckCircle2, Truck, AlertTriangle, RotateCcw } from "lucide-react";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { formatearEtaSameDay } from "@/modules/operacion/eta-same-day";
import { podLoGobiernaLaFuente } from "@/modules/operacion/fuente";
import type { EstadoPedido } from "@/modules/operacion/tipos";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import type { TonoEstado } from "@/lib/ui/tonos-estado";
import { FirmadoPorRutax } from "@/components/ui/marca-rutax";

// =============================================================================
// Estado público (amigable para el comprador — no expone estados internos)
// =============================================================================

interface EstadoPublico {
  etiqueta: string;
  descripcion: string;
  Icono: typeof Package;
  /** El MISMO tono del sistema que ve el courier. Ver regla 46. */
  tono: TonoEstado;
}

function estadoPublico(estado: EstadoPedido): EstadoPublico {
  switch (estado) {
    case "pendiente_asignacion":
    case "asignado":
      return {
        etiqueta: "En preparación",
        descripcion: "Tu pedido está siendo preparado para el despacho.",
        Icono: Package,
        tono: "neutral",
      };
    case "en_ruta":
      return {
        etiqueta: "En camino",
        descripcion: "Tu pedido va en ruta hacia la dirección de entrega.",
        Icono: Truck,
        tono: "progress",
      };
    case "entregado":
    case "entregado_manual":
      return {
        etiqueta: "Entregado",
        descripcion: "Tu pedido fue entregado.",
        Icono: CheckCircle2,
        tono: "balanced",
      };
    case "fallido":
    case "fallido_manual":
      return {
        etiqueta: "Con novedad",
        descripcion: "Hubo un inconveniente con la entrega. El despachador la reagendará o se contactará contigo.",
        Icono: AlertTriangle,
        tono: "attention",
      };
    case "devuelto":
      return {
        etiqueta: "Devuelto",
        descripcion: "El pedido fue devuelto al remitente.",
        Icono: RotateCcw,
        tono: "neutral",
      };
    case "cancelado":
      return {
        etiqueta: "Cancelado",
        descripcion: "Este pedido fue cancelado.",
        Icono: AlertTriangle,
        // `inert`, igual que en el panel del courier: es el tono de lo que sale
        // del juego, y trae su trama de 135° para que no dependa del color.
        tono: "inert",
      };
    default:
      return {
        etiqueta: "En proceso",
        descripcion: "",
        Icono: Package,
        tono: "neutral",
      };
  }
}

// =============================================================================
// Carga de datos (solo campos mínimos — minimización)
// =============================================================================

interface DatosSeguimiento {
  estado: EstadoPedido;
  comuna: string;
  fechaCompromisoHora: string | null;
  sellerNombre: string;
}

async function cargarSeguimiento(token: string): Promise<DatosSeguimiento | null> {
  if (!token) return null;
  const cliente = crearClienteServiceRole();

  const { data: pedido } = await cliente
    .from("pedidos")
    .select("estado, tipo_pedido, fuente, seller_id, destinatario_comuna, fecha_compromiso_hora")
    .eq("tracking_token", token)
    .maybeSingle();

  // [FRONTERA] Solo las fuentes cuyo seguimiento es de Rutax. En Flex el
  // comprador ve el de Mercado Libre y esta página no tiene nada que aportar.
  if (!pedido || podLoGobiernaLaFuente(pedido.fuente)) return null;

  // Marca del seller (dato del seller, no del comprador).
  const { data: seller } = await cliente
    .from("sellers")
    .select("razon_social")
    .eq("id", pedido.seller_id as string)
    .maybeSingle();

  return {
    estado: pedido.estado as EstadoPedido,
    comuna: (pedido.destinatario_comuna as string | null) ?? "",
    fechaCompromisoHora: (pedido.fecha_compromiso_hora as string | null) ?? null,
    sellerNombre: (seller?.razon_social as string | null) ?? "Tu tienda",
  };
}

// =============================================================================
// Página
// =============================================================================

interface Props {
  params: Promise<{ token: string }>;
}

/**
 * El titulo y la descripcion que ve quien recibe el enlace.
 *
 * Antes heredaba los del layout raiz: «Rutax - gestion operativo-financiera ·
 * Plataforma para couriers de ultima milla». Copy escrito para el courier que
 * contrata el software, mostrado al comprador que solo quiere saber donde esta
 * su paquete.
 *
 * ⚠️ **Ni el titulo ni la descripcion dicen el estado** (regla 47): la
 * previsualizacion se cachea en el chat y el estado cambia varias veces el mismo
 * dia, asi que diria algo falso — y se ve sin abrir el enlace, que es justo lo
 * que el token protege. Tampoco lleva nombre, comuna ni monto (regla 66).
 *
 * `robots: noindex` porque una URL con token no tiene por que terminar en un
 * buscador: es un enlace personal, no una pagina publica.
 */
export const metadata = {
  title: "Seguimiento de tu pedido",
  description: "Mira donde va tu paquete. Solo lo ve quien tenga este enlace.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Seguimiento de tu pedido",
    description: "Mira donde va tu paquete. Solo lo ve quien tenga este enlace.",
    type: "website" as const,
  },
};

export default async function PaginaSeguimiento({ params }: Props) {
  const { token } = await params;
  const datos = await cargarSeguimiento(token);
  if (!datos) notFound();

  const { etiqueta, descripcion, Icono, tono } = estadoPublico(datos.estado);
  const eta = formatearEtaSameDay({
    pedidoId: "",
    fechaCompromisoHora: datos.fechaCompromisoHora,
    corteRiesgo: false,
  });
  const esTerminalEntregado = datos.estado === "entregado" || datos.estado === "entregado_manual";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-5 py-10">
      {/* Marca del seller */}
      <header className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Seguimiento de tu pedido</p>
        <h1 className="mt-1 text-xl font-semibold">{datos.sellerNombre}</h1>
      </header>

      {/* Estado actual.
          ⚠️ REGLA 46 · el estado que ve el comprador es una TRADUCCION, no un
          renombre: **el mismo tono y el mismo glifo** que ve el courier, con
          otra redaccion. Antes el tono salia de una clase escrita a mano
          (`text-info`, `text-success`, `text-warning`) que no coincidia con
          ninguno de los seis del sistema: el comprador y el coordinador miraban
          el mismo pedido y lo veian de colores distintos.
          Sin sombra (regla 4). */}
      <section className="flex flex-col items-center gap-3 border border-line bg-card p-6 text-center">
        <Icono className="size-12 text-fg-muted" aria-hidden="true" />
        <DistintivoEstado tono={tono} etiqueta={etiqueta} />
        {descripcion && <p className="text-sm text-fg-muted">{descripcion}</p>}
      </section>

      {/* ETA (solo si aún no se entregó y hay estimación) */}
      {eta && !esTerminalEntregado && (
        <section className="flex items-center justify-center gap-2 rounded-lg bg-info-subtle px-4 py-3 text-sm text-info-subtle-foreground">
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Entrega estimada hoy alrededor de las <span className="font-semibold">{eta}</span>
          </span>
        </section>
      )}

      {/* Comuna de destino (sin dirección exacta — minimización) */}
      {datos.comuna && (
        <p className="text-center text-xs text-muted-foreground">Destino: {datos.comuna}</p>
      )}

      {/* Regla 42 + manual de marca: **esta pantalla la firma el courier**.
          «Rutax» no le dice nada a alguien que compró en una tienda y espera un
          paquete; la relación es con quien le despacha.

          Rutax entra como FILA DE CIERRE, y el manual es específico sobre por
          qué: «la misma barra que cierra una liquidación cierra la pantalla. Es
          un lugar estructural, no un pie de página, y por eso no compite con la
          marca de arriba». Su logotipo no pasa de 15 px acá y nunca toma color
          de acento en el texto. */}
      <footer className="mt-auto pt-6">
        <FirmadoPorRutax />
      </footer>
    </main>
  );
}
