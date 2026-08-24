/**
 * `/tracking/[token]` — el seguimiento público del comprador.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * FRONTERA DURA
 * -----------------------------------------------------------------------------
 * Solo aplica a los pedidos cuyo seguimiento es de Rutax — hoy todos menos los
 * de fuente `ml_flex`, donde el comprador ve el seguimiento de Mercado Libre.
 * Esta página rechaza (404) cualquier otro pedido o token inexistente. La URL
 * que Rutax devuelve a Shopify como `trackingInfo.url` es justamente esta.
 *
 * Ruta PÚBLICA (sin autenticación): se accede con un `tracking_token` opaco no
 * adivinable.
 *
 * -----------------------------------------------------------------------------
 * QUÉ VE EL COMPRADOR, PALABRA POR PALABRA
 * -----------------------------------------------------------------------------
 * El sistema de diseño lo fija en su matriz de exposición por rol: el comprador
 * final ve **«solo código, comuna, estado y ventana»**. Las cuatro cosas están,
 * y **ninguna quinta**:
 *
 * · el **código de envío** (`RX-XXXX-XXXX`) — es lo que cita si tiene que
 *   escribirle a la tienda, y sin él la pantalla no sirve para reclamar;
 * · la **comuna**, nunca la dirección;
 * · el **estado**, traducido (regla 46: mismo tono, mismo glifo, otra
 *   redacción, y **nunca el motivo de una falla**);
 * · la **ventana** comprometida.
 *
 * ⚠️ **Lo que no va, y por qué cada uno:**
 * · **nombre, teléfono y dirección del destinatario** — minimización;
 * · **nombre, teléfono y posición del conductor** — el diseño lo marca como
 *   «nunca» para esta superficie, y la Ley 21.431 pesa sobre el conductor;
 * · **el nombre de quien recibió** — regla legal 3, sin excepción: la fórmula
 *   es «Lo recibió alguien en el domicilio»;
 * · **la foto del POD** y cualquier dato de otro pedido;
 * · **el motivo de una entrega fallida** — se lo cuenta la tienda, no nosotros.
 *
 * -----------------------------------------------------------------------------
 * LAS DOS MARCAS, Y CUÁL VA DÓNDE (regla 42)
 * -----------------------------------------------------------------------------
 * Esta pantalla la firma **el courier**, no Rutax: para quien espera un paquete,
 * la relación es con quien se lo despacha, y «Rutax» no le dice nada. El
 * **seller** aparece en la frase, no en el encabezado — es de quien compró.
 *
 * Es exactamente el reparto del correo hermano (`mail.seguimiento`): asunto
 * «Tu pedido de **Vega Norte** va en camino», cuerpo «**Andes Express** lo está
 * entregando hoy». Antes esta página ponía al seller de encabezado y al courier
 * en ninguna parte.
 *
 * Y Rutax entra como **fila de cierre**, que es un lugar estructural y no un pie
 * de página: es el único canal de Rutax hacia consumidores finales, y genera una
 * impresión por entrega.
 */

import { notFound } from "next/navigation";

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { formatearHora } from "@/lib/formato-cl";
import { podLoGobiernaLaFuente } from "@/modules/operacion/fuente";
import type { EstadoPedido } from "@/modules/operacion/tipos";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import type { TonoEstado } from "@/lib/ui/tonos-estado";
import { FirmadoPorRutax } from "@/components/ui/marca-rutax";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";

import { LineaTiempoPublica, type HitoPublico } from "./linea-tiempo-publica";

// =============================================================================
// Los cinco estados públicos
// =============================================================================

/**
 * Cinco, y no los once internos. El comprador no tiene por qué distinguir
 * `pendiente_asignacion` de `asignado` —para él las dos dicen «todavía no sale»—
 * ni `fallido` de `fallido_manual`, que es una diferencia de cómo se registró.
 *
 * `devuelto` cae en «cancelado» y no en un sexto: desde donde mira esta persona,
 * un pedido que volvió al remitente y uno que se anuló terminan igual — no le va
 * a llegar — y la diferencia entre los dos es interna del courier.
 */
type EstadoPublico = "en_preparacion" | "en_camino" | "entregado" | "con_novedad" | "cancelado";

interface Presentacion {
  etiqueta: string;
  descripcion: string;
  tono: TonoEstado;
}

const PRESENTACION: Record<EstadoPublico, Presentacion> = {
  en_preparacion: {
    etiqueta: "En preparación",
    descripcion: "Todavía no sale a ruta. Te avisamos cuando vaya en camino.",
    tono: "neutral",
  },
  en_camino: {
    etiqueta: "En camino",
    descripcion: "Va en la ruta de hoy.",
    tono: "progress",
  },
  entregado: {
    etiqueta: "Entregado",
    // Regla legal 3: **nunca** el nombre de quien recibió.
    descripcion: "Lo recibió alguien en el domicilio.",
    tono: "balanced",
  },
  con_novedad: {
    etiqueta: "Con novedad",
    // Sin el motivo (regla 46). Y sin promesa que no se pueda cumplir: no
    // decimos «se reagenda mañana» porque quien decide eso es la tienda.
    descripcion: "No se pudo entregar en este intento. La tienda te va a contactar.",
    tono: "attention",
  },
  cancelado: {
    etiqueta: "Cancelado",
    descripcion: "Este pedido ya no se va a entregar.",
    // `inert`, igual que en el panel del courier: es el tono de lo que sale del
    // juego, y trae su trama de 135° para que no dependa del color.
    tono: "inert",
  },
};

function aEstadoPublico(estado: EstadoPedido): EstadoPublico {
  switch (estado) {
    case "en_ruta":
      return "en_camino";
    case "entregado":
    case "entregado_manual":
      return "entregado";
    case "fallido":
    case "fallido_manual":
      return "con_novedad";
    case "cancelado":
    case "devuelto":
      return "cancelado";
    default:
      return "en_preparacion";
  }
}

// =============================================================================
// Carga de datos — solo los campos que la pantalla muestra
// =============================================================================

interface DatosSeguimiento {
  estado: EstadoPedido;
  codigo: string | null;
  comuna: string;
  fechaCompromisoHora: string | null;
  retiradoEn: string | null;
  entregadoEn: string | null;
  sellerNombre: string;
  courierNombre: string;
}

async function cargarSeguimiento(token: string): Promise<DatosSeguimiento | null> {
  if (!token) return null;
  const cliente = crearClienteServiceRole();

  const { data: pedido } = await cliente
    .from("pedidos")
    .select(
      "id, estado, tipo_pedido, fuente, tenant_id, seller_id, codigo_interno, destinatario_comuna, fecha_compromiso_hora, retirado_en",
    )
    .eq("tracking_token", token)
    .maybeSingle();

  // [FRONTERA] Solo las fuentes cuyo seguimiento es de Rutax. En Flex el
  // comprador ve el de Mercado Libre y esta página no tiene nada que aportar.
  if (!pedido || podLoGobiernaLaFuente(pedido.fuente)) return null;

  // Las tres consultas de contexto van juntas: son independientes entre sí, y
  // encadenarlas suma tres viajes de red a una página que se abre con mala
  // señal. Ninguna es capaz de tumbar la pantalla — si alguna falla se cae a un
  // texto genérico.
  const [{ data: seller }, { data: tenant }, { data: prueba }] = await Promise.all([
    cliente.from("sellers").select("razon_social").eq("id", pedido.seller_id as string).maybeSingle(),
    cliente
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", pedido.tenant_id as string)
      .maybeSingle(),
    // La hora de entrega **no vive en `pedidos`**: vive en el POD, que en
    // same-day es la verdad autoritativa. Se pide la más reciente por si hubo
    // un intento fallido antes del bueno.
    cliente
      .from("pruebas_entrega")
      .select("capturado_en, tipo_resultado")
      .eq("pedido_id", pedido.id as string)
      .eq("tipo_resultado", "entregado")
      .order("capturado_en", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    estado: pedido.estado as EstadoPedido,
    codigo: (pedido.codigo_interno as string | null) ?? null,
    comuna: (pedido.destinatario_comuna as string | null) ?? "",
    fechaCompromisoHora: (pedido.fecha_compromiso_hora as string | null) ?? null,
    retiradoEn: (pedido.retirado_en as string | null) ?? null,
    entregadoEn: (prueba?.capturado_en as string | null) ?? null,
    sellerNombre: (seller?.razon_social as string | null) ?? "la tienda",
    courierNombre: (tenant?.nombre_fantasia as string | null) ?? "Tu despacho",
  };
}

// =============================================================================
// Los tres hitos de la línea de tiempo
// =============================================================================

function armarHitos(datos: DatosSeguimiento, publico: EstadoPublico): HitoPublico[] {
  const tonoCierre = PRESENTACION[publico].tono;
  const cerrado = publico === "entregado" || publico === "con_novedad" || publico === "cancelado";
  const enCamino = publico === "en_camino";

  // ⚠️ **El primer hito no se puede dar por hecho.** Un pedido cancelado antes de
  // que nadie pasara a buscarlo no fue retirado nunca, y dibujarlo como cumplido
  // le dice al comprador que su paquete está en manos del courier cuando sigue en
  // la tienda. `retirado_en` es la prueba directa; los tres estados que implican
  // que un conductor lo llevaba encima valen como prueba indirecta, porque el
  // retiro no se registra en todos los flujos.
  const loRetiramos =
    Boolean(datos.retiradoEn) ||
    publico === "en_camino" ||
    publico === "entregado" ||
    publico === "con_novedad";

  // ⚠️ **Un pedido cancelado pierde el hito «En camino», y no es cosmética.**
  // Nada en la base dice si alcanzó a salir a ruta antes de anularse, así que
  // dibujarlo como cumplido afirma un viaje que puede no haber ocurrido, y
  // dibujarlo pendiente entre dos hitos alcanzados parte la línea en dos trozos
  // sueltos que se leen como un error de la página. Se retira: el recorrido llegó
  // hasta donde llegó, y ahí se corta.
  const conTransito = publico !== "cancelado";

  // La ventana comprometida. **«antes de las»** y no «alrededor de las»:
  // `fecha_compromiso_hora` es un límite —de él sale `sla_cumplido`—, así que
  // «alrededor» prometía un punto medio que el dato no respalda.
  const ventana = datos.fechaCompromisoHora
    ? `Llega hoy antes de las ${formatearHora(datos.fechaCompromisoHora)}`
    : null;

  const recibido: HitoPublico = {
    clave: "recibido",
    titulo: loRetiramos ? "Lo tenemos nosotros" : "Lo retiramos de la tienda",
    // Sin repetir el nombre del seller: ya está en el encabezado, y decirlo tres
    // veces en una pantalla de teléfono gasta las dos líneas que hay.
    detalle: datos.retiradoEn
      ? `Retirado de la tienda a las ${formatearHora(datos.retiradoEn)}`
      : loRetiramos
        ? "Retirado de la tienda"
        : null,
    // Mientras no sale a ruta, **acá es donde está el pedido**: le toca el anillo
    // de «hito actual», no el punto de algo ya superado.
    situacion: !loRetiramos
      ? publico === "cancelado"
        ? "pendiente"
        : "actual"
      : publico === "en_preparacion"
        ? "actual"
        : "hecho",
    tono: "balanced",
  };

  const transito: HitoPublico = {
    clave: "en_camino",
    titulo: "En camino",
    // Sin hora: no existe una columna que diga cuándo salió a ruta. Ver la nota
    // del componente.
    detalle: cerrado ? null : ventana,
    situacion: enCamino ? "actual" : cerrado ? "hecho" : "pendiente",
    tono: "progress",
  };

  const cierre: HitoPublico = {
    clave: "cierre",
    // Mientras no haya cerrado, el último hito es **el destino**, no el estado de
    // ahora: si mostrara `PRESENTACION[publico].etiqueta`, un pedido en camino
    // diría «En camino» dos veces seguidas y la línea perdería el sentido de ir
    // hacia alguna parte.
    titulo: cerrado ? PRESENTACION[publico].etiqueta : "Entregado",
    detalle:
      datos.entregadoEn && publico === "entregado"
        ? `A las ${formatearHora(datos.entregadoEn)}`
        : null,
    situacion: cerrado ? "actual" : "pendiente",
    tono: cerrado ? tonoCierre : "balanced",
  };

  return conTransito ? [recibido, transito, cierre] : [recibido, cierre];
}

// =============================================================================
// Metadatos
// =============================================================================

/**
 * El título y la descripción que ve quien recibe el enlace.
 *
 * Antes heredaba los del layout raíz: «Rutax — gestión operativo-financiera ·
 * Plataforma para couriers de última milla». Copy escrito para el courier que
 * contrata el software, mostrado al comprador que solo quiere saber dónde está
 * su paquete.
 *
 * ⚠️ **Ni el título ni la descripción dicen el estado** (regla 47): la
 * previsualización se cachea en el chat y el estado cambia varias veces el mismo
 * día, así que diría algo falso — y se ve **sin abrir el enlace**, que es justo
 * lo que el token protege. Tampoco lleva nombre, comuna ni monto (regla 66).
 *
 * `robots: noindex` porque una URL con token no tiene por qué terminar en un
 * buscador: es un enlace personal, no una página pública.
 */
export const metadata = {
  title: "Seguimiento de tu pedido",
  description: "Mira dónde va tu paquete. Solo lo ve quien tenga este enlace.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Seguimiento de tu pedido",
    description: "Mira dónde va tu paquete. Solo lo ve quien tenga este enlace.",
    type: "website" as const,
  },
};

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

  const publico = aEstadoPublico(datos.estado);
  const { etiqueta, descripcion, tono } = PRESENTACION[publico];
  const hitos = armarHitos(datos, publico);

  return (
    <PantallaSinSesion
      marca={{ tipo: "courier", nombre: datos.courierNombre }}
      pie={
        <>
          Este enlace es tuyo: quien lo tenga ve el avance de este pedido. Si algo no calza, escríbele
          a {datos.sellerNombre} con el código de arriba.
        </>
      }
    >
      <div className="w-full max-w-sm space-y-4">
        {/* Sin sombra (regla 4) y con el radio del sistema. */}
        <section className="border border-line bg-bg-raised">
          <header className="border-b border-line-subtle px-5 py-4">
            <p className="text-sm leading-relaxed text-fg-muted">
              Tu pedido de <span className="font-medium text-fg">{datos.sellerNombre}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <DistintivoEstado tono={tono} etiqueta={etiqueta} />
              {datos.comuna ? (
                <span className="text-sm text-fg-muted">· {datos.comuna}</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{descripcion}</p>
          </header>

          <div className="px-5 py-5">
            <LineaTiempoPublica hitos={hitos} enTransito={publico === "en_camino"} />
          </div>

          {/* El código va abajo y en monoespaciada: no es lo primero que se
              busca, pero es lo único que sirve para reclamar, y tiene que poder
              leerse en voz alta por teléfono sin confundir un 0 con una O. */}
          {datos.codigo ? (
            <footer className="border-t border-line-subtle bg-bg-inset px-5 py-3">
              <p className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
                Código de envío
              </p>
              <p className="rx-num mt-0.5 font-mono text-sm font-medium">{datos.codigo}</p>
            </footer>
          ) : null}
        </section>

        <FirmadoPorRutax />
      </div>
    </PantallaSinSesion>
  );
}
