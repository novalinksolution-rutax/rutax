import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { tieneSesionAdmin } from "../sesion-admin";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  clasificarConexion,
  contarPorCajonSalud,
  listarConexionesDeTodosLosCouriers,
  instanteDeClasificacion,
  DIAS_VENCE_PRONTO,
  type CajonSalud,
  type ConexionSalud,
} from "@/modules/plataforma/salud-integraciones";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { formatearFechaHora } from "@/lib/formato-cl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Salud de integraciones · Rutax Admin",
};

// Es un tablero de estado en vivo: nunca cachear.
export const dynamic = "force-dynamic";

/**
 * Salud de integraciones — la vista de arriba.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * PARA QUÉ EXISTE, Y ES UNA SOLA COSA
 * -----------------------------------------------------------------------------
 * **Avisarle al courier antes de que se dé cuenta el seller.** Cada courier ve
 * la salud de SUS conexiones en su panel, y cada seller la suya en su portal.
 * Lo que no existía en ninguna parte es la vista de arriba: sin ella nos
 * enteramos de una caída por el mismo camino que todos, cuando alguien reclama.
 *
 * -----------------------------------------------------------------------------
 * 🔴 «VENCEN PRONTO» ES EL CAJÓN QUE JUSTIFICA LA PANTALLA
 * -----------------------------------------------------------------------------
 * «Caídas» y «Sanas» son pasado y presente, y esos dos ya se ven desde el
 * courier. El del medio es lo único que mira hacia adelante: **es la única
 * vista del producto que ve una caída antes de que ocurra**.
 *
 * ⚠️ Y es solo de Mercado Libre. Shopify no caduca —su token es un Admin API
 * token de app privada, pegado a mano— así que se revoca, no vence. El porqué,
 * y por qué la lámina de B6 dibuja una fila de Shopify que no puede existir,
 * está en `salud-integraciones.ts`.
 *
 * -----------------------------------------------------------------------------
 * NO ES UNA PANTALLA DE ACCIÓN
 * -----------------------------------------------------------------------------
 * No reconecta, no rota tokens y no entra a la cuenta. **Reconectar es del
 * seller** —es su cuenta de Mercado Libre— y ningún atajo desde acá cambia eso.
 * Lo que sí hace es llevar a la ficha del courier, que es desde donde se le
 * escribe o se entra a su cuenta con la sesión de soporte auditada.
 */

const ETIQUETA_CAJON: Record<CajonSalud, string> = {
  caida: "Caídas",
  vence_pronto: `Vencen en ${DIAS_VENCE_PRONTO} días`,
  sana: "Sanas",
};

const ORDEN_CAJONES: CajonSalud[] = ["caida", "vence_pronto", "sana"];

function esCajon(v: string | undefined): v is CajonSalud {
  return v === "caida" || v === "vence_pronto" || v === "sana";
}

export default async function PaginaSaludIntegraciones({
  searchParams,
}: {
  searchParams: Promise<{ cajon?: string }>;
}) {
  // Doble verificación, igual que el resto del backstage: el código server que
  // lee cross-tenant vía service_role NUNCA corre sin sesión admin válida.
  if (!(await tieneSesionAdmin())) redirect("/admin/login");

  const params = await searchParams;
  const cajonActivo = esCajon(params.cajon) ? params.cajon : null;

  const cliente = crearClienteServiceRole();
  const conexiones = await listarConexionesDeTodosLosCouriers(cliente);

  // Un solo instante para toda la pantalla. El porqué —y por qué se lee en el
  // módulo y no acá— está en `instanteDeClasificacion`.
  const ahoraMs = instanteDeClasificacion();
  const conteo = contarPorCajonSalud(conexiones, ahoraMs);
  const empresas = new Set(conexiones.map((c) => c.empresa)).size;

  const visibles = cajonActivo
    ? conexiones.filter((c) => clasificarConexion(c, ahoraMs) === cajonActivo)
    : conexiones;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Salud de integraciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Las conexiones de todos los sellers de todos los couriers. Es la única vista que ve una
          caída antes de que el seller la note.
        </p>
        <p className="rx-num mt-2 font-mono text-xs text-muted-foreground tabular-nums">
          {conexiones.length.toLocaleString("es-CL")} conexiones · {empresas.toLocaleString("es-CL")}{" "}
          {empresas === 1 ? "empresa" : "empresas"}
        </p>
      </div>

      {/* Los cajones. Van como enlaces y no como botones: esta pantalla se
          comparte por chat cuando hay que pasarle a alguien «mira las seis
          caídas», y un estado en React no viaja en un enlace. */}
      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        <ChipCajon href="/admin/salud-integraciones" activo={cajonActivo === null} etiqueta="Todas" conteo={conexiones.length} />
        {ORDEN_CAJONES.map((c) => (
          <ChipCajon
            key={c}
            href={`/admin/salud-integraciones?cajon=${c}`}
            activo={cajonActivo === c}
            etiqueta={ETIQUETA_CAJON[c]}
            conteo={conteo[c]}
            alerta={c === "caida" && conteo[c] > 0}
          />
        ))}
      </nav>

      {visibles.length === 0 ? (
        <p className="border border-line bg-bg-sunken px-4 py-10 text-center text-sm text-fg-muted">
          {conexiones.length === 0
            ? "Todavía no hay ninguna conexión configurada en ningún courier."
            : `No hay conexiones en «${ETIQUETA_CAJON[cajonActivo!].toLowerCase()}».`}
        </p>
      ) : (
        <div className="overflow-x-auto border border-line bg-bg-raised">
          {/* Densidad 32: es una pantalla de uso interno con varias empresas a
              la vista, y lo que importa es cuántas filas caben. */}
          <Table densidad="compact" aria-label="Conexiones de todos los couriers">
            <TableHeader>
              <TableRow className="bg-muted/40">
                {/* La empresa primero, siempre: quien mira esto tiene que
                    llamar al courier, no al seller. */}
                <TableHead className="px-3">Empresa</TableHead>
                <TableHead className="px-3">Cuenta</TableHead>
                <TableHead className="hidden px-3 sm:table-cell">Fuente</TableHead>
                <TableHead className="px-3">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((c) => (
                <FilaSalud key={c.id} conexion={c} cajon={clasificarConexion(c, ahoraMs)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ChipCajon({
  href,
  activo,
  etiqueta,
  conteo,
  alerta = false,
}: {
  href: string;
  activo: boolean;
  etiqueta: string;
  conteo: number;
  alerta?: boolean;
}) {
  return (
    <Link
      href={href}
      // `true` y no `"page"`: la navegación lateral ya marca la página con
      // `aria-current="page"`, y dos elementos reclamando lo mismo dejan al
      // lector de pantalla anunciando dos «actual» distintos. El cajón es un
      // filtro DENTRO de la página, no otra página.
      aria-current={activo ? true : undefined}
      className={cn(
        "inline-flex items-center gap-2 border px-3 py-1.5 text-sm",
        activo ? "border-fg bg-fg text-bg" : "border-line bg-bg-raised text-fg hover:border-fg-muted",
        // El rojo se reserva a lo accionable, y una caída lo es.
        !activo && alerta && "border-fault-line bg-fault-bg text-fault-fg",
      )}
    >
      {etiqueta}
      <span className="rx-num font-mono text-xs tabular-nums">{conteo.toLocaleString("es-CL")}</span>
    </Link>
  );
}

function FilaSalud({ conexion, cajon }: { conexion: ConexionSalud; cajon: CajonSalud }) {
  return (
    <TableRow data-cajon={cajon}>
      <TableCell className="px-3 font-medium">{conexion.empresa}</TableCell>
      <TableCell className="px-3">
        <div className="flex flex-col">
          <span>{conexion.cuenta}</span>
          <span className="text-xs text-fg-muted">{conexion.seller}</span>
        </div>
      </TableCell>
      <TableCell className="hidden px-3 text-fg-muted sm:table-cell">
        {etiquetaFuentePedido(conexion.fuente)}
      </TableCell>
      <TableCell className="px-3">
        {/* `items-start`: sin esto el distintivo hereda el `stretch` del
            contenedor en columna y se estira al ancho de la celda —una
            barra de color de 368 px donde debería haber una etiqueta. */}
        <div className="flex flex-col items-start gap-0.5">
          <DistintivoEstado
            tono={cajon === "caida" ? "fault" : cajon === "vence_pronto" ? "attention" : "balanced"}
            etiqueta={
              cajon === "caida" ? "Caída" : cajon === "vence_pronto" ? "Vence pronto" : "Sana"
            }
          />
          {/* El detalle en texto, no en el distintivo: el distintivo dice la
              familia y tiene que caber en una celda de 32 px de alto. */}
          <span className="rx-num text-xs text-fg-muted tabular-nums">
            {detalleEstado(conexion, cajon)}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * La línea de detalle bajo el distintivo.
 *
 * ⚠️ **Nunca muestra `ultimo_error`.** Un «invalid_grant» no le dice nada a
 * nadie y sí dice de más sobre cómo está armado el sistema por dentro; es la
 * misma regla del bloque de falla externa del portal.
 */
function detalleEstado(c: ConexionSalud, cajon: CajonSalud): string {
  if (cajon === "vence_pronto" && c.tokenExpiraEn) {
    return `Vence el ${formatearFechaHora(c.tokenExpiraEn)}`;
  }
  if (cajon === "caida") {
    if (c.desconectadaDesde) return `Caída desde el ${formatearFechaHora(c.desconectadaDesde)}`;
    if (c.estadoSalud === "pendiente") return "Nunca llegó a conectar";
    return "Sin sincronizar";
  }
  return c.ultimaSyncExitosaEn
    ? `Última sincronización: ${formatearFechaHora(c.ultimaSyncExitosaEn)}`
    : "Sin sincronizaciones todavía";
}
