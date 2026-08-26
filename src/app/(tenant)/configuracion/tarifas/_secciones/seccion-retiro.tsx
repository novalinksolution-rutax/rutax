import Link from "next/link";
import { TriangleAlert, Info } from "lucide-react";

import {
  obtenerMontoVisitaDefaultClp,
  obtenerMontoEntregaDeRespaldoClp,
} from "@/lib/datos-tenant/config-retiro";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { FormularioRetiro } from "../../retiro/formulario-retiro";

/**
 * Retiro — la sección, antes `configuracion/retiro/page.tsx`.
 * =============================================================================
 *
 * Vive dentro del módulo de tarifas desde el 26-08-2026: es **la otra mitad de
 * lo que se le paga al conductor**. La tarifa cubre la entrega; esto cubre la
 * visita a la bodega.
 *
 * Un solo campo gobierna todo: cuánto le paga el courier al conductor por CADA
 * visita cerrada a una bodega de seller (`identidad.courier_config_retiro`, 1:1
 * con el tenant).
 *
 * -----------------------------------------------------------------------------
 * 🔴 POR QUÉ ADEMÁS LLEVA UNA TABLA
 * -----------------------------------------------------------------------------
 * El texto decía —y sigue diciendo— que se puede fijar un monto distinto para
 * una bodega puntual, **y no mostraba ninguna**. O sea que para saber si alguna
 * lo tenía había que ir a Bodegas y abrirlas una por una.
 *
 * La tabla lista **todas las bodegas activas con lo que cuesta visitar cada
 * una**, marcando cuáles heredan y cuáles tienen monto propio. Convierte un
 * campo suelto en la respuesta a la pregunta real: «¿cuánto me cuesta salir a
 * retirar?». Y le da a esta sección la misma anatomía que sus dos hermanas.
 */
export async function SeccionRetiro({ tenantId }: { tenantId: string }) {
  const cliente = crearClienteServiceRole();

  const [montoActual, montoEntregaRespaldo, bodegasFila] = await Promise.all([
    obtenerMontoVisitaDefaultClp(tenantId),
    obtenerMontoEntregaDeRespaldoClp(tenantId),
    // Tolerante: si esta lectura falla, el formulario —que es el punto de la
    // pantalla— sigue en pie. Una tabla de contexto no puede tumbar el ajuste.
    Promise.resolve(
      cliente
        .schema("identidad")
        .from("seller_bodegas")
        .select("id, nombre, comuna, monto_visita_clp, seller_id")
        .eq("tenant_id", tenantId)
        .eq("activa", true)
        .order("nombre"),
    )
      .then((r) => r.data ?? [])
      .catch(() => [] as Record<string, unknown>[]),
  ]);

  const sellerIds = [...new Set(bodegasFila.map((b) => b.seller_id as string))];
  const nombreSeller = new Map<string, string>();
  if (sellerIds.length > 0) {
    // ⚠️ `razon_social`, no `nombre`: esa columna no existe en
    // `identidad.sellers`, y equivocarse deja la celda con el UUID.
    const { data } = await cliente
      .schema("identidad")
      .from("sellers")
      .select("id, razon_social")
      .eq("tenant_id", tenantId)
      .in("id", sellerIds);
    for (const s of data ?? []) {
      nombreSeller.set(s.id as string, (s.razon_social as string) ?? "Seller");
    }
  }

  const usandoRespaldo = montoActual === null && montoEntregaRespaldo !== null;
  const sinPagoPosible = montoActual === null && montoEntregaRespaldo === null;
  /** Lo que se paga hoy por una visita que no tiene monto propio. */
  const montoHeredado = montoActual ?? montoEntregaRespaldo;
  const conMontoPropio = bodegasFila.filter((b) => b.monto_visita_clp !== null).length;

  return (
    <div className="space-y-4">
      {sinPagoPosible && (
        <div
          role="alert"
          className="rounded-lg border border-warning-subtle bg-warning-subtle px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-warning-subtle-foreground">
                Las visitas a bodega no se están pagando
              </p>
              <p className="text-sm text-warning-subtle-foreground">
                No definiste un monto por visita y tus tarifas tampoco dicen cuánto le pagas al
                conductor por entrega, así que no hay de dónde sacar la cifra. Las visitas que
                cierren tus conductores quedan como excepción bloqueante en la bandeja de
                conciliación hasta que definas uno de los dos.
              </p>
            </div>
          </div>
        </div>
      )}

      {usandoRespaldo && (
        // Informativo, NO alarma: se está pagando, solo que con un valor
        // heredado. Se muestra la cifra concreta porque «usa la tarifa» no le
        // dice a nadie cuánto está saliendo cada visita.
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Cada visita se está pagando {formatearCLP(montoEntregaRespaldo!)}
              </p>
              <p className="text-sm text-muted-foreground">
                Es el mismo monto que le pagas al conductor por una entrega, porque todavía no
                definiste uno propio para las visitas. Funciona, pero visitar una bodega y entregar
                un paquete no son el mismo trabajo: si no te calza, define el monto acá abajo.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pago por visita a bodega</CardTitle>
            <CardDescription>
              Cuánto le pagas al conductor por cada visita que hace a una bodega de seller para
              retirar pedidos. Es el monto general de tu courier: cada bodega puede tener el suyo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormularioRetiro montoActual={montoActual} />
            {/* La otra mitad del modelo, dicha donde se pregunta. El retiro
                genera un pago al conductor y **ningún cobro al seller**: es una
                decisión del alcance, no un olvido, y quien configura esto se lo
                pregunta apenas ve que hay un solo campo. */}
            <p className="border border-line bg-bg-sunken px-4 py-3 text-sm leading-relaxed text-fg-muted">
              Al seller todavía no se le cobra el retiro: ese lado del modelo está vacío a
              propósito. Solo la entrega efectiva genera una línea de cobro.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Lo que cuesta cada bodega ──────────────────────────────────────── */}
      {bodegasFila.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              <span className="rx-num font-medium text-fg">{bodegasFila.length}</span>{" "}
              {bodegasFila.length === 1 ? "bodega activa" : "bodegas activas"} ·{" "}
              {conMontoPropio === 0
                ? "todas heredan el monto general"
                : `${conMontoPropio} con monto propio`}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/configuracion/bodegas">Administrar bodegas</Link>
            </Button>
          </div>

          <div className="overflow-x-auto border border-line bg-bg-raised">
            <Table densidad="comfortable" aria-label="Lo que cuesta visitar cada bodega">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Bodega</TableHead>
                  <TableHead className="px-4">Seller</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Comuna</TableHead>
                  <TableHead className="px-4 text-right">Por visita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bodegasFila.map((b) => {
                  const propio = b.monto_visita_clp as number | null;
                  return (
                    <TableRow key={b.id as string}>
                      <TableCell className="px-4 font-medium text-fg">
                        {b.nombre as string}
                      </TableCell>
                      <TableCell className="px-4 text-sm text-fg-muted">
                        {nombreSeller.get(b.seller_id as string) ?? "—"}
                      </TableCell>
                      <TableCell className="hidden px-4 text-sm text-fg-muted sm:table-cell">
                        {(b.comuna as string | null) ?? "—"}
                      </TableCell>
                      <TableCell className="px-4 text-right">
                        {/* 🔴 Se muestra lo que se PAGA, no lo que está
                            configurado. Una celda vacía para las que heredan
                            dejaría la pregunta sin responder: la cifra es la
                            misma para todas, y decirla en cada fila es lo que
                            convierte «$4.500» en «me cuesta esto por bodega». */}
                        {propio !== null ? (
                          <>
                            <span className="rx-num block text-sm font-medium text-fg">
                              {formatearCLP(propio)}
                            </span>
                            <span className="block text-xs text-fg-muted">monto propio</span>
                          </>
                        ) : montoHeredado !== null ? (
                          <>
                            <span className="rx-num block text-sm text-fg">
                              {formatearCLP(montoHeredado)}
                            </span>
                            <span className="block text-xs text-fg-subtle">hereda el general</span>
                          </>
                        ) : (
                          <span className="text-sm text-attention-fg">sin monto</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
