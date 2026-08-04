/**
 * Las cifras de cabecera de la Torre.
 * =============================================================================
 *
 * Cuatro magnitudes en una fila, separadas por una línea de 1 px y **sin
 * cards**: el principio del sistema es jerarquizar con espacio y peso, no con
 * cajas. Todas son magnitudes — no hay ni un índice ni un porcentaje derivado.
 *
 * DOS REGLAS QUE SE VEN ACÁ Y SE ROMPEN FÁCIL:
 *
 * · **La fracción va con la palabra «faltan».** No es decoración: sin ella,
 *   «38 de 120» se lee como «38 hechos de 120» tan fácil como al revés — le pasó
 *   al dueño del producto mirando su propia pantalla. Se evaluó invertirla a lo
 *   entregado y se descartó: el contador de la Torre tiene que ACHICARSE durante
 *   el día, y contar lo hecho lo convertiría en una barra de progreso dejando
 *   «¿cuántos me faltan?» detrás de una resta.
 *
 * · **El rojo es solo de la incidencia.** La cifra de incidencias lo toma cuando
 *   hay alguna; ninguna otra puede, ni siquiera la del corte, que va en ámbar.
 */

import { cn } from '@/lib/utils';
import type { FrescuraTorre, ResumenTorre } from '@/modules/contexto/contrato-torre';

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
      {/* `tabular-nums` en toda cifra que se refresca: sin ancho fijo por dígito,
          el número «salta» a cada actualización de realtime. */}
      <p
        className={cn(
          'mt-0.5 tabular-nums',
          destacada ? 'text-2xl font-semibold' : 'text-xl font-medium',
        )}
      >
        {children}
      </p>
    </div>
  );
}

export function CifrasTorre({
  resumen,
  frescura,
}: {
  resumen: ResumenTorre;
  frescura: FrescuraTorre;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-start divide-x divide-border border-y border-border">
        <Magnitud etiqueta="Faltan por entregar" destacada>
          {resumen.pendientes}
          <span className="text-base font-normal text-muted-foreground"> de {resumen.total}</span>
        </Magnitud>

        <Magnitud etiqueta="Entregados hoy">{resumen.entregados}</Magnitud>

        <Magnitud etiqueta="Incidencias abiertas">
          <span className={resumen.incidenciasAbiertas > 0 ? 'text-destructive' : undefined}>
            {resumen.incidenciasAbiertas}
          </span>
        </Magnitud>

        <Magnitud etiqueta="Cerca del corte">
          <span
            className={
              resumen.enRiesgoDeCorte > 0 ? 'text-warning-subtle-foreground' : undefined
            }
          >
            {resumen.enRiesgoDeCorte}
          </span>
        </Magnitud>
      </div>

      {/* Regla 5: el mapa nunca esconde carga. Lo que no se pudo ubicar se
          declara SIEMPRE, y una sola vez en toda la pantalla — en la v1 esta
          misma cifra aparecía cuatro veces. */}
      {resumen.sinUbicar > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {resumen.sinUbicar === 1
            ? '1 pedido no se pudo ubicar en el mapa y no está dibujado.'
            : `${resumen.sinUbicar} pedidos no se pudieron ubicar en el mapa y no están dibujados.`}
        </p>
      ) : null}

      {/* F6, callada por defecto: mientras el dato está fresco no se dibuja
          nada. Un indicador que siempre está ahí deja de leerse justo el día que
          importa. */}
      {frescura.atrasada && frescura.edadMinutos !== null ? (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-warning-subtle px-2 py-1 text-xs font-medium text-warning-subtle-foreground">
          Sin cierres de conductor hace {frescura.edadMinutos} min
        </p>
      ) : null}
    </div>
  );
}
