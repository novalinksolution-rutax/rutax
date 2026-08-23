/**
 * Franja de 4 magnitudes de la cabecera (§13). Mismo lenguaje visual que
 * `torre-de-control/_componentes/cifras.tsx`: fila con divisores de 1 px, SIN
 * cards — se jerarquiza con espacio y peso, no con cajas.
 *
 * `magnitudes === null` es el caso en que la consulta de VISITAS falló: se
 * muestran guiones en vez de ceros (mismo criterio que
 * `operaciones/page.tsx`, `{errorCarga ? "—" : contador}`) para no afirmar
 * "cero" cuando en realidad no se pudo saber.
 *
 * QUÉ CAMBIÓ EL 23-08-2026, contra el tablero B1a: salieron «De vuelta» y «Sin
 * novedades» —la primera es el complemento de «visitas en curso», la segunda
 * ahora vive pegada a la visita que la provoca, que es donde se puede actuar— y
 * entraron «Comunas con carga» y «Sin tarifa». Y la primera magnitud ganó su
 * DENOMINADOR, que es lo que convierte esta pantalla en la conciliación de
 * bodega que el alcance define.
 */

import { cn } from "@/lib/utils";
import type { MagnitudesPreparacion } from "../_lib/estado-preparacion";

function Magnitud({
  etiqueta,
  children,
  destacada = false,
}: {
  etiqueta: string;
  children: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    <div className="flex-1 px-4 py-3 first:pl-0 last:pr-0 sm:px-5">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      {/* `tabular-nums`: sin ancho fijo por dígito, el número "salta" a cada
          actualización de realtime. */}
      <p
        className={cn(
          "mt-0.5 tabular-nums",
          destacada ? "text-2xl font-semibold" : "text-xl font-medium",
        )}
      >
        {children}
      </p>
    </div>
  );
}

export function FranjaMagnitudes({
  magnitudes,
  esperados,
  visitasAbiertas,
  visitasTotales,
  comunasConCarga,
  bultosSinTarifa,
}: {
  magnitudes: MagnitudesPreparacion | null;
  /** El «~190»: lo que se espera retirar hoy. `null` si no se pudo saber. */
  esperados: number | null;
  visitasAbiertas: number;
  visitasTotales: number;
  comunasConCarga: number;
  bultosSinTarifa: number;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-start divide-x divide-border border-y border-border">
        <Magnitud etiqueta="Bultos retirados hoy" destacada>
          {magnitudes ? magnitudes.bultosRetiradosHoy : "—"}
          {/* El denominador es lo que convierte un contador en una
              conciliación: «128» no dice nada, «128 de ~190» dice que faltan 62
              y que el despacho no puede salir. La TILDE no es adorno — todavía
              pueden entrar pedidos, así que es una expectativa viva y no un
              contrato. */}
          {esperados !== null && esperados > 0 ? (
            <span className="text-base font-normal text-muted-foreground">
              {" "}
              de ~{esperados}
            </span>
          ) : null}
        </Magnitud>

        <Magnitud etiqueta="Visitas en curso">
          {visitasAbiertas}
          <span className="text-base font-normal text-muted-foreground">
            {" "}
            de {visitasTotales}
          </span>
        </Magnitud>

        <Magnitud etiqueta="Comunas con carga">{comunasConCarga}</Magnitud>

        <Magnitud etiqueta="Sin tarifa">
          {/* Ámbar solo si > 0. Es plata que no se va a poder cobrar, y se
              descubre acá con horas de margen o en el cierre del período. */}
          <span className={bultosSinTarifa > 0 ? "text-warning-subtle-foreground" : undefined}>
            {bultosSinTarifa}
          </span>
          {bultosSinTarifa > 0 ? (
            <span className="text-base font-normal text-muted-foreground"> bultos</span>
          ) : null}
        </Magnitud>
      </div>

      {magnitudes && magnitudes.bultosSinIdentificar > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {magnitudes.bultosSinIdentificar === 1
            ? "1 bulto no se pudo identificar todavía."
            : `${magnitudes.bultosSinIdentificar} bultos no se pudieron identificar todavía.`}
        </p>
      ) : null}
    </div>
  );
}
