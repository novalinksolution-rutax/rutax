/**
 * Página pública de seguimiento de pedido same-day (Bloque 2 — F11/F12).
 *
 * FRONTERA DURA: solo aplica a pedidos `tipo_pedido='same_day'`. En Flex el
 * comprador ve el seguimiento de Mercado Libre; esta página rechaza (404) cualquier
 * pedido que no sea same-day o cuyo token no exista.
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
import type { EstadoPedido } from "@/modules/operacion/tipos";

// =============================================================================
// Estado público (amigable para el comprador — no expone estados internos)
// =============================================================================

interface EstadoPublico {
  etiqueta: string;
  descripcion: string;
  Icono: typeof Package;
  clase: string;
}

function estadoPublico(estado: EstadoPedido): EstadoPublico {
  switch (estado) {
    case "pendiente_asignacion":
    case "asignado":
      return {
        etiqueta: "En preparación",
        descripcion: "Tu pedido está siendo preparado para el despacho.",
        Icono: Package,
        clase: "text-muted-foreground",
      };
    case "en_ruta":
      return {
        etiqueta: "En camino",
        descripcion: "Tu pedido va en ruta hacia la dirección de entrega.",
        Icono: Truck,
        clase: "text-info",
      };
    case "entregado":
    case "entregado_manual":
      return {
        etiqueta: "Entregado",
        descripcion: "Tu pedido fue entregado.",
        Icono: CheckCircle2,
        clase: "text-success",
      };
    case "fallido":
    case "fallido_manual":
      return {
        etiqueta: "Con novedad",
        descripcion: "Hubo un inconveniente con la entrega. El despachador la reagendará o se contactará contigo.",
        Icono: AlertTriangle,
        clase: "text-warning",
      };
    case "devuelto":
      return {
        etiqueta: "Devuelto",
        descripcion: "El pedido fue devuelto al remitente.",
        Icono: RotateCcw,
        clase: "text-muted-foreground",
      };
    case "cancelado":
      return {
        etiqueta: "Cancelado",
        descripcion: "Este pedido fue cancelado.",
        Icono: AlertTriangle,
        clase: "text-muted-foreground",
      };
    default:
      return {
        etiqueta: "En proceso",
        descripcion: "",
        Icono: Package,
        clase: "text-muted-foreground",
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
    .select("estado, tipo_pedido, seller_id, destinatario_comuna, fecha_compromiso_hora")
    .eq("tracking_token", token)
    .maybeSingle();

  // [FRONTERA] Solo same-day: en Flex el comprador ve a Mercado Libre.
  if (!pedido || pedido.tipo_pedido !== "same_day") return null;

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

export default async function PaginaSeguimiento({ params }: Props) {
  const { token } = await params;
  const datos = await cargarSeguimiento(token);
  if (!datos) notFound();

  const { etiqueta, descripcion, Icono, clase } = estadoPublico(datos.estado);
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

      {/* Estado actual */}
      <section className="rounded-lg border bg-card p-6 text-center shadow-xs">
        <Icono className={`mx-auto size-12 ${clase}`} aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold">{etiqueta}</h2>
        {descripcion && <p className="mt-1 text-sm text-muted-foreground">{descripcion}</p>}
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

      <footer className="mt-auto pt-6 text-center text-xs text-muted-foreground">
        Despacho gestionado por tu courier de última milla.
      </footer>
    </main>
  );
}
