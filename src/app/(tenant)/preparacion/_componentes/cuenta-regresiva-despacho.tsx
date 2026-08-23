"use client";

/**
 * Cuánto falta para que salga el despacho.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTA CUENTA MANDA EN ESTA PANTALLA
 * -----------------------------------------------------------------------------
 * El alcance lo dice sin matices: **«el despacho arranca a las 16:00, sin
 * excepción»**, y la asignación tiene que estar terminada para entonces. Todo lo
 * que la Preparación del día muestra —bultos que llegan, visitas abiertas, carga
 * por comuna— se juzga contra ese reloj: 128 bultos a las 11:40 es tranquilidad
 * y a las 15:40 es un problema.
 *
 * Sin la cuenta, la pantalla informa y no apura. Con ella, cada cifra tiene su
 * contra qué.
 *
 * -----------------------------------------------------------------------------
 * DE CLIENTE, Y POR LA MISMA RAZÓN QUE EL RELOJ DE LA TORRE
 * -----------------------------------------------------------------------------
 * Una cuenta regresiva renderizada en el servidor se congela en el instante del
 * render. En una pantalla que se mira de pie durante horas, eso es peor que no
 * tenerla: diría «faltan 4 h 20» a las tres de la tarde.
 *
 * `useSyncExternalStore` y no `useState` + efecto: el reloj es una fuente
 * externa a React, el snapshot va cacheado por minuto —si devolviera un objeto
 * nuevo en cada llamada, React lo leería como cambio permanente— y el servidor
 * devuelve `null`, así que la hidratación calza.
 */

import { useSyncExternalStore } from "react";
import { formatearHora } from "@/lib/formato-cl";

/** «El despacho arranca a las 16:00, sin excepción» — alcance de retiro y ruteo. */
export const HORA_DESPACHO = "16:00";

let cache: { minuto: number; texto: string | null } | null = null;

function leer(): string | null {
  const ahora = Date.now();
  const minuto = Math.floor(ahora / 60_000);
  if (!cache || cache.minuto !== minuto) {
    cache = { minuto, texto: calcular(new Date(ahora)) };
  }
  return cache.texto;
}

function calcular(instante: Date): string | null {
  const [hd, md] = HORA_DESPACHO.split(":").map(Number);
  const [ha, ma] = formatearHora(instante).split(":").map(Number);
  if ([hd, md, ha, ma].some(Number.isNaN)) return null;

  const faltan = hd * 60 + md - (ha * 60 + ma);
  // Pasada la hora la cuenta deja de tener sentido: lo que informa entonces es
  // que ya salió, no un número negativo.
  if (faltan <= 0) return "el despacho ya salió";

  const horas = Math.floor(faltan / 60);
  const minutos = faltan % 60;
  const cuanto =
    horas === 0
      ? `${minutos} min`
      : minutos === 0
        ? `${horas} h`
        : `${horas} h ${String(minutos).padStart(2, "0")}`;
  return `faltan ${cuanto} para el despacho`;
}

function sinTexto(): string | null {
  return null;
}

function suscribir(avisar: () => void): () => void {
  // Cada 15 s: el minuto puede cambiar en cualquier punto del intervalo, así que
  // un tic de un minuto exacto dejaría la cuenta hasta 59 s atrasada.
  const id = setInterval(avisar, 15_000);
  return () => clearInterval(id);
}

export function CuentaRegresivaDespacho() {
  const texto = useSyncExternalStore(suscribir, leer, sinTexto);
  if (!texto) return null;
  return <span className="rx-num">{texto}</span>;
}
