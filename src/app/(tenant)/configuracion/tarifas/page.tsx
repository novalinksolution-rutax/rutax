import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Tag } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";
import { PanelTarifa } from "./panel-tarifa";
import { FilaTarifa, type TarifaFila } from "./fila-tarifa";
import { BarraCajonesTarifas } from "./barra-cajones-tarifas";
import { clasificarTarifa, contarPorCajon, type CajonTarifa } from "./cajon-tarifa";

export const metadata: Metadata = {
  title: "Tarifas",
};

/**
 * Tarifas — el listado, contra su tablero.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 LO VIGENTE Y LO PROGRAMADO CONVIVEN EN LA MISMA TABLA
 * -----------------------------------------------------------------------------
 * Es la regla 28 de B3b, y la razón es de operación: **no hay pantalla de
 * «cambios pendientes»**. La tarifa que va a regir se ve donde se ve la que
 * rige, porque la pregunta real del courier —«¿cuánto le estoy cobrando a Vega
 * Norte?»— tiene dos respuestas cuando hay una programada, y esconder la segunda
 * detrás de otra pantalla es lo que hace que alguien firme un acuerdo con la
 * cifra vieja.
 *
 * Antes esta pantalla tenía **dos secciones, activas e inactivas**, y una
 * tarifa que empieza el mes que viene se dibujaba entre las activas, sin
 * distinguirse en nada de la que está cobrando hoy.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL CAJÓN «INACTIVAS» TRAE SU VUELTA
 * -----------------------------------------------------------------------------
 * Era uno de los cinco estados sin salida: se podía inactivar una tarifa y no
 * había ninguna forma de reactivarla. Ver `acciones-fila.tsx`.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ HAY UN CUARTO CAJÓN QUE EL TABLERO NO DIBUJA: «VENCIDAS»
 * -----------------------------------------------------------------------------
 * `vigente_hasta` es un campo del formulario, así que una tarifa puede tener su
 * ventana cerrada y seguir `activa`. No cobra —el motor la descarta— pero
 * tampoco está inactiva. El porqué de separarla está en `cajon-tarifa.ts`.
 *
 * -----------------------------------------------------------------------------
 * «COBRAS» Y «PAGAS», JUNTAS Y ROTULADAS ASÍ
 * -----------------------------------------------------------------------------
 * Es el motor del producto en dos celdas. Van pegadas para poder restarlas de un
 * vistazo, y el rótulo es el verbo en segunda persona —no «monto seller» y
 * «monto conductor»— porque lo que se está mirando es la dirección de la plata.
 *
 * -----------------------------------------------------------------------------
 * EL CAJÓN VIVE EN LA URL
 * -----------------------------------------------------------------------------
 * `?cajon=programada`. Es compartible y el botón de atrás funciona. Sin cajón se
 * ven todas, que es el estado correcto para quien llega a mirar.
 */


const ETIQUETA_CAJON: Record<CajonTarifa, string> = {
  vigente: "Vigentes",
  programada: "Programadas",
  vencida: "Vencidas",
  inactiva: "Inactivas",
};

const ORDEN_CAJONES: CajonTarifa[] = ["vigente", "programada", "vencida", "inactiva"];

function esCajon(valor: string | undefined): valor is CajonTarifa {
  return valor === "vigente" || valor === "programada" || valor === "vencida" || valor === "inactiva";
}


export default async function PaginaTarifas({
  searchParams,
}: {
  searchParams: Promise<{ cajon?: string }>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="Las tarifas solo las pueden ver y cambiar el dueño de la cuenta o administración." />
    );
  }

  const params = await searchParams;
  const cajonActivo = esCajon(params.cajon) ? params.cajon : null;

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();
  const hoy = hoyEnSantiago();

  const { data: sellersData } = await supabase
    .schema("identidad")
    .from("sellers")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .order("razon_social");

  const sellers = (sellersData ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    nombre: s.razon_social as string,
  }));
  const sellersMap = new Map(sellers.map((s) => [s.id, s.nombre]));

  const { data: tarifasData, error: errorTarifas } = await supabase
    .schema("identidad")
    .from("tarifas")
    .select("*")
    .eq("tenant_id", tenantId)
    // Dentro de un cajón, la más reciente arriba: es la que se acaba de tocar.
    .order("vigente_desde", { ascending: false });

  const tarifas: TarifaFila[] = (tarifasData ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    sellerId: (t.seller_id as string | null) ?? null,
    sellerNombre: t.seller_id ? (sellersMap.get(t.seller_id as string) ?? null) : null,
    tipoEntrega: t.tipo_entrega as "flex" | "same_day",
    modoCalculo: t.modo_calculo as "monto_fijo" | "por_zona",
    zona: (t.zona as string | null) ?? null,
    montoClp: Number(t.monto_clp),
    montoConductorClp: Number(t.monto_conductor_clp ?? 0),
    vigenteDesdeFecha: t.vigente_desde as string,
    vigenteHasta: (t.vigente_hasta as string | null) ?? null,
    estado: t.estado as "activa" | "inactiva",
    minimoFacturacionClp: t.minimo_facturacion_clp != null ? Number(t.minimo_facturacion_clp) : null,
    minimoRetiroClp: t.minimo_retiro_clp != null ? Number(t.minimo_retiro_clp) : null,
    recargoReprogramacionClp:
      t.recargo_reprogramacion_clp != null ? Number(t.recargo_reprogramacion_clp) : null,
  }));

  const conteo = contarPorCajon(tarifas, hoy);
  const visibles = cajonActivo
    ? tarifas.filter((t) => clasificarTarifa(t, hoy) === cajonActivo)
    : tarifas;

  // ⚠️ Ante una lectura fallida los contadores van en `null`, no en cero: un
  // «Vigentes 0» se lee como «no tengo tarifas» y eso manda a crear una que ya
  // existe. Es la misma regla que la barra de Pedidos.
  const hayCifras = !errorTarifas;

  const destinos: Record<string, string> = { "": "/configuracion/tarifas" };
  for (const c of ORDEN_CAJONES) destinos[c] = `/configuracion/tarifas?cajon=${c}`;

  return (
    <PantallaConfiguracion
      titulo="Tarifas"
      /* Lenguaje de negocio, no jerga. Decía «rate cards por seller… que usa el
         motor de cobro»: quien lee esto quiere saber qué plata mueve, no cómo
         se llama el objeto adentro. */
      bajada="Lo que le cobras a cada seller por entrega y lo que le pagas al conductor por hacerla. Sin una tarifa vigente, una entrega se hace y no se puede cobrar."
      accion={<PanelTarifa sellers={sellers} />}
    >
      {tarifas.length === 0 ? (
        <EmptyState
          icon={Tag}
          tono="arranque"
          titulo="Todavía no tienes tarifas"
          /* El copy del tablero: dice la consecuencia, no el trámite. */
          descripcion="Sin una tarifa, las entregas se hacen y después no se pueden cobrar."
          accion={<PanelTarifa sellers={sellers} />}
        />
      ) : (
        <div className="space-y-4">
          <BarraCajonesTarifas
            cajones={ORDEN_CAJONES.map((c) => ({
              clave: c,
              etiqueta: ETIQUETA_CAJON[c],
              conteo: hayCifras ? conteo[c] : null,
            }))}
            activo={cajonActivo}
            total={hayCifras ? tarifas.length : null}
            destinos={destinos}
          />

          {visibles.length === 0 ? (
            <p className="border border-line bg-bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
              No tienes tarifas en «{ETIQUETA_CAJON[cajonActivo!].toLowerCase()}».
            </p>
          ) : (
            <div className="overflow-x-auto border border-line bg-bg-raised">
              <Table densidad="comfortable" aria-label="Tarifas">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="px-4">Seller</TableHead>
                    <TableHead className="px-4">Tipo</TableHead>
                    <TableHead className="hidden px-4 sm:table-cell">Zona</TableHead>
                    {/* Las dos columnas de dinero van juntas: es el motor del
                        producto en dos celdas, y se restan de un vistazo. */}
                    <TableHead className="px-4 text-right">Cobras</TableHead>
                    <TableHead className="px-4 text-right">Pagas</TableHead>
                    <TableHead className="hidden px-4 md:table-cell">Vigencia</TableHead>
                    <TableHead className="px-4 text-right">
                      <span className="sr-only">Acciones</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((t) => (
                    <FilaTarifa
                      key={t.id}
                      tarifa={t}
                      cajon={clasificarTarifa(t, hoy)}
                      sellers={sellers}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </PantallaConfiguracion>
  );
}
