/**
 * Las dos líneas que cierran la Preparación del día.
 *
 * -----------------------------------------------------------------------------
 * EL AVISO DE TARIFA ES LA PIEZA QUE CONECTA ESTA PANTALLA CON EL DINERO
 * -----------------------------------------------------------------------------
 * Sin él, esta pantalla es monitoreo: cuenta bultos y no dice nada sobre si esos
 * bultos se van a poder cobrar. Un seller sin tarifa vigente genera entregas que
 * **se hacen y no se facturan**, y eso se descubre acá —con horas de margen y
 * con el bulto todavía en bodega— o no se descubre hasta el cierre del período,
 * cuando ya no hay nada que hacer.
 *
 * ⚠️ **El aviso es POR SELLER, no por comuna.** El tablero B1a lo escribe como
 * «Colina no tiene tarifa configurada», pero el motor resuelve la tarifa por
 * seller (`resolverTarifaVigente`). Es la misma contradicción que apareció en
 * «Crear pedido same-day» y se resuelve igual: el aviso dice lo que el sistema
 * puede verificar, y nombra a quién hay que configurársela.
 *
 * -----------------------------------------------------------------------------
 * LA ESTIMACIÓN DECLARA SUS SUPUESTOS
 * -----------------------------------------------------------------------------
 * «Necesitas 5 conductores» sin decir de dónde sale es una instrucción. Con sus
 * dos supuestos a la vista —los bultos que hay y los 12 min por parada— es una
 * cuenta que el coordinador puede rehacer y discutir, que es lo que un promedio
 * merece.
 */

import Link from "next/link";
import { AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatearHora } from "@/lib/formato-cl";
import {
  calcularConductoresNecesarios,
  MINUTOS_POR_PARADA,
  type SellerSinTarifa,
} from "@/modules/operacion/retiro/expectativa";

/**
 * La hora a la que hay que haber terminado de repartir.
 *
 * Del alcance: «el despacho arranca a las 16:00, sin excepción, y el corte es
 * 21:00–22:00». Se toma el extremo TEMPRANO —las 21:00— porque una estimación
 * de cuánta gente se necesita tiene que pecar de prudente: quedarse corto de
 * conductores a las 20:45 no se arregla.
 */
const HORA_CORTE = "21:00";

export function CierreDelDia({
  sinTarifa,
  bultosEnBodega,
}: {
  sinTarifa: readonly SellerSinTarifa[];
  bultosEnBodega: number;
}) {
  const minutosHastaElCorte = minutosHasta(HORA_CORTE);
  const estimacion = calcularConductoresNecesarios(bultosEnBodega, minutosHastaElCorte);

  if (sinTarifa.length === 0 && !estimacion.aplicable) return null;

  return (
    <div className="space-y-2">
      {sinTarifa.map((seller) => (
        <div
          key={seller.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-attention-line bg-attention-bg px-3 py-2.5 text-sm text-attention-fg"
          role="status"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-medium">{seller.nombre}</strong> no tiene tarifa
            configurada, así que {textoEntregas(seller.bultos)} no se podrían cobrar.
          </span>
          {/* La acción va PEGADA al aviso: quien lee esto está a un clic de
              arreglarlo, y mandarlo a buscar la pantalla de tarifas es perder
              justamente el margen que este aviso acaba de ganar. */}
          <Button asChild size="sm" variant="outline" className="ms-auto">
            <Link href={`/configuracion/tarifas?seller=${encodeURIComponent(seller.id)}`}>
              Configurar la tarifa
            </Link>
          </Button>
        </div>
      ))}

      {estimacion.aplicable ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Con{" "}
            <strong className="font-medium text-foreground tabular-nums">
              {estimacion.bultos}
            </strong>{" "}
            bultos en bodega y {MINUTOS_POR_PARADA} min por parada, necesitas{" "}
            <strong className="font-medium text-foreground tabular-nums">
              {estimacion.conductores}
            </strong>{" "}
            {estimacion.conductores === 1 ? "conductor" : "conductores"} para cerrar antes de
            las {HORA_CORTE}.
          </span>
          {/* Los supuestos, dichos. Un promedio presentado como certeza deja de
              poder discutirse. */}
          <span className="text-xs">
            Estimación: {MINUTOS_POR_PARADA} min por parada es el promedio del rubro en hora
            punta.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function textoEntregas(bultos: number): string {
  return bultos === 1 ? "esa entrega" : `esas ${bultos} entregas`;
}

/**
 * Minutos desde ahora hasta una hora `HH:MM` de HOY, en Santiago.
 *
 * Por `formatearHora` y no `toLocaleTimeString` a mano: ese camino olvida
 * `timeZone` —y da la hora del servidor, que en Vercel es UTC— u olvida
 * `hour12: false`. Las dos cosas ya pasaron en este repo.
 */
function minutosHasta(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  const [ha, ma] = formatearHora(new Date()).split(":").map(Number);
  if ([h, m, ha, ma].some(Number.isNaN)) return 0;
  return h * 60 + m - (ha * 60 + ma);
}
