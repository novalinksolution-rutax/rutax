/**
 * Instrumentación de Next.js — hook de observabilidad de la app.
 * =====================================================================
 * `onRequestError` es el punto único donde Next.js entrega TODA excepción no
 * atrapada del servidor: Server Components, Route Handlers y Server Actions.
 * Lo enrutamos a la observabilidad central (Sentry/logs) — cubre "captura
 * centralizada de excepciones" de la auditoría para la superficie de la app
 * (los jobs los cubre el middleware de Inngest).
 *
 * No añade dependencias ni SDK: reusa `capturarExcepcion`.
 */

import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  // Sin inicialización especial. El transporte de observabilidad es perezoso
  // (lee SENTRY_DSN en cada envío), así que no hay nada que arrancar aquí.
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  // Import perezoso: `onRequestError` puede correr en runtime edge o node; el
  // módulo de observabilidad es agnóstico (usa fetch/console), pero lo cargamos
  // aquí para no penalizar el arranque.
  const { capturarExcepcion } = await import('@/lib/observabilidad');

  await capturarExcepcion(error, {
    origen: 'request',
    etiquetas: {
      router: context.routerKind,
      tipo_ruta: context.routeType,
    },
    extra: {
      path: request.path,
      method: request.method,
      ruta: context.routePath,
    },
  });
};
