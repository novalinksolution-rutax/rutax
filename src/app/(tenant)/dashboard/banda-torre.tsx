/**
 * Banda de resumen de la Torre de control, para el dashboard del dueño.
 * =====================================================================
 *
 * POR QUÉ EXISTE. El dueño no entra a la Torre: entra al dashboard. Lo que
 * necesita es «¿hay algo que deba mirar hoy?» en diez segundos, y para eso no
 * hacía falta una segunda pantalla, sino una línea acá con un enlace.
 *
 * QUÉ CONSERVA DE LA v1 —y hay que conservarlo, es la pieza mejor calibrada del
 * módulo—:
 *
 *   1. **Silencio por defecto.** Si el día va bien, la banda NO aparece. No se
 *      ocupa espacio en el dashboard para decir «todo bien».
 *   2. **Falla hacia el silencio.** Si la Torre revienta, la banda desaparece en
 *      vez de tumbar el dashboard del dueño. De ahí el `try` que devuelve `null`.
 *
 * QUÉ CAMBIÓ. El contenido, entero. Hablaba de riesgo, zonas y cortes, y los tres
 * se retiraron con el rediseño v2. Ahora dice **comunas + pendientes +
 * incidencias**, y aloja además la versión mínima de la ola entrante — que es
 * anticipación pura, y el dashboard es donde el dueño la va a ver.
 *
 * LÍMITE DE MÓDULOS. `CLAUDE.md` prohíbe que `operacion` y `dinero` llamen a
 * `contexto`. Esto NO lo viola: quien llama es la PANTALLA (capa de app), que
 * puede componer varios módulos. Ningún módulo de negocio importa `contexto`.
 *
 * COSTO. Reusa `cargarTablero`, que arma el tablero completo. Es más de lo que
 * esta banda necesita, y es deliberado: una consulta paralela «ligera» tendría
 * que reimplementar la unificación de cierres y POD, y divergiría del tablero al
 * primer cambio — el dueño vería una cifra en el dashboard y otra distinta al
 * entrar. `cargarTablero` va envuelto en `cache()` por request y esta banda vive
 * dentro de su propio `<Suspense>`, así que no retiene el resto del dashboard.
 */

import Link from "next/link";
import { ArrowRight, Radar } from "lucide-react";
import { cargarTablero } from "@/modules/contexto/composer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A cuántos días de una ola vale la pena avisarle al dueño en el dashboard.
 *
 * Treinta días es el plazo en que todavía se alcanza a contratar refuerzo. Más
 * lejos que eso, el aviso no es accionable y se convierte en ruido permanente en
 * el dashboard — que es exactamente lo que la regla de silencio evita.
 */
const DIAS_AVISO_OLA = 30;

export function EsqueletoBandaTorre() {
  return <Skeleton className="h-16 w-full rounded-lg" />;
}

export async function BandaTorre({ tenantId }: { tenantId: string }) {
  let torre;
  try {
    torre = await cargarTablero(tenantId);
  } catch {
    // La Torre depende de un composer con varias consultas y de un cron. Si algo
    // falla, el dashboard del dueño NO se cae por eso: la banda no aparece.
    return null;
  }

  const { resumen, comunas, olas } = torre;

  // La ola solo entra si está dentro del plazo en que se puede hacer algo.
  const ola = olas.find((o) => o.diasParaEvento >= 0 && o.diasParaEvento <= DIAS_AVISO_OLA) ?? null;

  // Silencio por defecto: sin pendientes, sin incidencias y sin ola a la vista,
  // no hay nada que mirar y la banda no se dibuja.
  if (resumen.pendientes === 0 && resumen.incidenciasAbiertas === 0 && ola === null) {
    return null;
  }

  const piezas: string[] = [];

  if (resumen.pendientes > 0) {
    // La fracción, no el número suelto: «38 de 120» dice el avance sin obligar a
    // recordar de cuánto partió el día.
    piezas.push(`${resumen.pendientes} de ${resumen.total} por entregar`);

    // La comuna que más concentra, solo si concentra de verdad. Nombrar «Maipú
    // con 2» cuando hay 38 repartidos parejo dirige la atención al lugar
    // equivocado.
    const peor = comunas[0];
    if (peor && peor.pendientes > 1 && peor.pendientes >= resumen.pendientes / 3) {
      piezas.push(`${peor.pendientes} en ${peor.nombre}`);
    }
  }

  if (resumen.incidenciasAbiertas > 0) {
    piezas.push(
      resumen.incidenciasAbiertas === 1
        ? "1 incidencia abierta"
        : `${resumen.incidenciasAbiertas} incidencias abiertas`,
    );
  }

  if (ola) {
    // Nombre + días + brecha, en una línea. La brecha viene negativa cuando falta
    // gente; si alcanza, no se dice nada — anunciar «te sobran 0 conductores» es
    // ruido.
    const cuando = ola.diasParaEvento === 0 ? "hoy" : `en ${ola.diasParaEvento} días`;
    const brecha =
      ola.brechaConductores < 0
        ? `, faltan ${Math.abs(ola.brechaConductores)} conductores`
        : "";
    piezas.push(`${ola.nombre} ${cuando}${brecha}`);
  }

  return (
    <Link
      href="/torre-de-control"
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-xs transition-colors hover:border-foreground/30 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Radar className="size-4.5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Torre de control</p>
        <p className="text-sm text-muted-foreground">{piezas.join(" · ")}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
