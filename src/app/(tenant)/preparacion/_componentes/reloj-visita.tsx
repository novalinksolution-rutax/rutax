"use client";

/**
 * Reloj de inactividad de una tarjeta de visita — leaf de cliente, mínimo de
 * JS (mismo criterio que `IndicadorEnVivo`): el resto de la tarjeta
 * (`tarjeta-visita.tsx`) sigue siendo Server Component.
 *
 * POR QUÉ ES CLIENTE Y NO SE CALCULA EN EL SERVIDOR (docs/ux/etapa-5-preparacion-del-dia.md §6):
 * la pantalla se refresca por señal de Realtime, pero un conductor que DEJÓ
 * de escanear no genera ningún evento — nada dispara un refresco, así que
 * "hace 3 min" se quedaría literalmente congelado para siempre si el cálculo
 * viviera solo en el servidor.
 *
 * `useSyncExternalStore` y no `useState` + `useEffect` con un `setState`
 * síncrono: es el hook pensado exactamente para esto —leer un valor externo
 * y mutable (acá, el reloj) de forma segura para SSR— y evita a la vez los
 * dos problemas del patrón manual: (a) llamar `setState` síncronamente dentro
 * del cuerpo del efecto, que `react-hooks/set-state-in-effect` marca como
 * error, y (b) el mismatch de hidratación de calcular `Date.now()` directo en
 * el render (sin `getServerSnapshot`, el reloj del servidor y el del cliente
 * casi nunca coinciden al segundo). `getServerSnapshot` devuelve `null`: no
 * hay "ahora" del cliente que sincronizar hasta que la hidratación termina.
 */

import { useSyncExternalStore } from "react";
import { horaLocalEnSantiago } from "@/lib/fecha-santiago";
import { calcularEstadoReloj } from "../_lib/reloj-inactividad";

/** Ni cada segundo (ruido visual y de CPU sin necesidad — la unidad útil es el minuto) ni cada varios minutos (se sentiría atrasado). */
const INTERVALO_MS = 30_000;

/** La "suscripción": un intervalo que notifica a React cada 30 s para que vuelva a leer el reloj. */
function suscribirAlReloj(notificar: () => void): () => void {
  const id = setInterval(notificar, INTERVALO_MS);
  return () => clearInterval(id);
}

function leerAhora(): number | null {
  return Date.now();
}

/** Durante SSR (y el primer render de cliente, antes de hidratar) no hay reloj de cliente que leer todavía. */
function leerAhoraEnServidor(): number | null {
  return null;
}

export function RelojVisita({
  ultimoEscaneoEn,
  abiertaEn,
}: {
  ultimoEscaneoEn: string | null;
  abiertaEn: string;
}) {
  // React pinta `leerAhoraEnServidor()` (null) en el server y en el primer
  // paint del cliente —sin eso, mismatch de hidratación— y lo corrige al
  // valor real INMEDIATAMENTE después de hidratar (§6: "no espera el primer
  // tick"), sin esperar a que dispare el `setInterval`.
  const ahoraMs = useSyncExternalStore(suscribirAlReloj, leerAhora, leerAhoraEnServidor);

  if (ahoraMs === null) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        <span>Calculando…</span>
      </p>
    );
  }

  const estado = calcularEstadoReloj({ ultimoEscaneoEn, abiertaEn, ahoraMs });
  const etiquetaHora = ultimoEscaneoEn ? "Último escaneo" : "Llegó a la bodega";

  // ⚠️ DOS relojes, no uno, y miden cosas distintas:
  //
  //   · **Cuánto lleva abierta la visita** — la cifra principal. Es la que pide
  //     el tablero, y avisa sobre una hora: una visita larga puede ir bien, pero
  //     pasada la hora ya compite con las 16:00.
  //   · **Cuánto lleva sin escanear** — solo aparece cuando pasa su umbral. Es
  //     la que detecta a alguien TRABADO mientras está pasando: una visita de 20
  //     minutos que lleva 14 sin un escaneo es un problema, y el reloj de visita
  //     no lo vería.
  //
  // Decisión del usuario, 23-08-2026, sobre quedarse con uno solo: ninguno
  // reemplaza al otro.
  const minutosAbierta = Math.max(0, Math.floor((ahoraMs - Date.parse(abiertaEn)) / 60_000));
  const visitaLarga = minutosAbierta > MINUTOS_VISITA_LARGA;

  return (
    // Sin `aria-live`: el texto cambia cada 30 s y sería ruidoso para lector
    // de pantalla (§6, a diferencia de `IndicadorEnVivo`, que sí lo usa pero
    // para un cambio de estado infrecuente). El `title` da la hora exacta a
    // quien la necesite.
    <>
    <p
      className={`text-xs tabular-nums ${visitaLarga ? "text-warning-subtle-foreground" : "text-muted-foreground"}`}
    >
      Abierta hace {textoDuracion(minutosAbierta)}
      {visitaLarga ? " · lleva más de una hora" : ""}
    </p>
    <p
      className="flex items-center gap-1.5 text-xs"
      title={`${etiquetaHora}: ${horaLocalEnSantiago(new Date(estado.senalEn))}`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${estado.enAviso ? "bg-warning" : "bg-muted-foreground/40"}`}
        aria-hidden="true"
      />
      {/* El color nunca es el único canal: la palabra "Sin escaneos" ya lo dice. */}
      <span className={estado.enAviso ? "text-warning-subtle-foreground" : "text-muted-foreground"}>
        {estado.texto}
      </span>
    </p>
    </>
  );
}

/** Sobre esto, una visita a bodega ya compite con la salida de las 16:00. */
export const MINUTOS_VISITA_LARGA = 60;

/** `38 min` · `1 h 12`. */
export function textoDuracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${String(resto).padStart(2, "0")}`;
}
