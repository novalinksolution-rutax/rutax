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
 * QUÉ CAMBIÓ EL 23-08-2026, contra el tablero B1a: salieron «Entregados hoy»
 * —que es el complemento de la primera cifra y ya se lee ahí— y «Cerca del
 * corte». Entraron «En ruta ahora» y «Conductores con ruta». Las cuatro de
 * ahora responden la misma pregunta: **quién está trabajando y qué falta**.
 *
 * ⚠️ Con «cerca del corte» se retiró la única señal de riesgo de la franja.
 * `resumen.enRiesgoDeCorte` sigue calculándose y sigue marcando comunas en el
 * mapa y en la lista: lo que se fue es su cifra agregada arriba. Decisión del
 * usuario, 23-08-2026.
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
        <Magnitud etiqueta="Por entregar hoy" destacada>
          {resumen.pendientes}
          <span className="text-base font-normal text-muted-foreground"> de {resumen.total}</span>
        </Magnitud>

        {/* «En ruta ahora» NO es «pendientes»: un pedido asignado a un
            manifiesto que todavía no sale está pendiente y no está en la calle.
            La diferencia entre las dos cifras es lo que aún no arrancó, y a las
            16:30 esa es la pregunta del día. */}
        <Magnitud etiqueta="En ruta ahora">{resumen.enRutaAhora}</Magnitud>

        <Magnitud etiqueta="Conductores con ruta">
          {resumen.conductoresConRuta}
          <span className="text-base font-normal text-muted-foreground">
            {' '}
            de {resumen.conductoresDisponibles}
          </span>
        </Magnitud>

        <Magnitud etiqueta="Incidencias abiertas">
          <span className={resumen.incidenciasAbiertas > 0 ? 'text-destructive' : undefined}>
            {resumen.incidenciasAbiertas}
          </span>
          {/* La segunda línea no es adorno: tres recién abiertas y tres
              olvidadas hace cinco horas se leen igual sin ella, y son cosas muy
              distintas. */}
          {resumen.incidenciasSinGestionar > 0 ? (
            <span className="text-base font-normal text-destructive">
              {' · '}
              {resumen.incidenciasSinGestionar} sin gestionar
            </span>
          ) : null}
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
