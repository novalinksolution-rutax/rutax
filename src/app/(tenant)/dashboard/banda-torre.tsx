/**
 * Banda de resumen de la Torre de control, para el dashboard del dueño.
 * =====================================================================
 *
 * POR QUÉ EXISTE. La Torre es un tablero de viewport fijo, con atajos de
 * teclado y un riel que se scrollea: es herramienta de COORDINADOR, alguien
 * sentado frente a ella toda la mañana. El dueño quiere otra cosa —«¿hay algo
 * que deba mirar hoy?», en diez segundos— y para eso no hacía falta una segunda
 * pantalla, sino tres líneas aquí con un enlace.
 *
 * LÍMITE DE MÓDULOS. `CLAUDE.md` prohíbe que `operacion` y `dinero` llamen a
 * `contexto`. Esto NO lo viola: quien llama es la PANTALLA (capa de app), que
 * puede componer varios módulos. Ningún módulo de negocio importa `contexto`.
 *
 * COSTO. Reusa `cargarTablero`, que calcula los tres horizontes. Es más de lo
 * que esta banda necesita, y es deliberado: una consulta paralela «ligera»
 * tendría que reimplementar el colapso por franja y la ventana de corte, y
 * divergiría del tablero al primer cambio. `cargarTablero` va envuelto en
 * `cache()` por request y esta banda vive dentro de su propio `<Suspense>`, así
 * que no retiene el resto del dashboard.
 */

import Link from "next/link";
import { ArrowRight, Radar } from "lucide-react";
import { cargarTablero } from "@/modules/contexto/composer";
import { Skeleton } from "@/components/ui/skeleton";

/** Niveles que ameritan que el dueño mire. Bajo esto, la banda no aparece. */
const NIVELES_QUE_IMPORTAN = new Set(["medio", "alto", "critico"]);

const ETIQUETA_NIVEL: Record<string, string> = {
  calmo: "en calma",
  bajo: "riesgo bajo",
  medio: "riesgo medio",
  alto: "riesgo alto",
  critico: "riesgo crítico",
};

export function EsqueletoBandaTorre() {
  return <Skeleton className="h-16 w-full rounded-lg" />;
}

export async function BandaTorre({ tenantId }: { tenantId: string }) {
  let hoy;
  try {
    const tablero = await cargarTablero(tenantId);
    hoy = tablero.horizontes.hoy;
  } catch {
    // La Torre depende de fuentes externas y de un cron. Si algo falla, el
    // dashboard del dueño NO se cae por eso: la banda simplemente no aparece.
    return null;
  }

  const zonaPeor = [...hoy.zonas].sort((a, b) => b.riesgo - a.riesgo)[0] ?? null;
  const excepciones = hoy.excepciones.length;

  // Silencio por defecto (regla 3 del handoff): si no hay nada que mirar, no se
  // ocupa espacio en el dashboard con una banda que dice «todo bien».
  const hayRiesgo = zonaPeor !== null && NIVELES_QUE_IMPORTAN.has(zonaPeor.nivel);
  if (!hayRiesgo && excepciones === 0) return null;

  // El corte más cercano que todavía no vence, entre las zonas con pendientes.
  const proximoCorte = hoy.zonas
    .filter((z) => z.pedidosPendientes > 0 && z.ventanaCorte.minutosRestantes > 0)
    .sort((a, b) => a.ventanaCorte.minutosRestantes - b.ventanaCorte.minutosRestantes)[0];

  const piezas: string[] = [];
  if (zonaPeor && hayRiesgo) {
    piezas.push(`${zonaPeor.nombre} con ${ETIQUETA_NIVEL[zonaPeor.nivel] ?? "riesgo"}`);
  }
  if (proximoCorte) {
    piezas.push(`corte de ${proximoCorte.nombre} a las ${proximoCorte.ventanaCorte.hora}`);
  }
  if (excepciones > 0) {
    piezas.push(`${excepciones} ${excepciones === 1 ? "excepción" : "excepciones"}`);
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
