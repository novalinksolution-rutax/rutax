/**
 * Formato USD para el módulo Consumo — es plata chica (fracciones de centavo
 * por evento), a diferencia del resto del backstage que es todo CLP
 * (`formatearClp`, sin decimales). 4 decimales para costos unitarios/muy
 * pequeños, 2 para totales — ninguno de los dos redondea a 0 un costo real.
 */

const FORMATEADOR_USD_TOTAL = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FORMATEADOR_USD_PRECISO = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** `US$ 128,40` — para totales. */
export function formatearUsd(monto: number): string {
  return FORMATEADOR_USD_TOTAL.format(monto);
}

/** `US$ 0,0032` — para valores chicos (costo por entrega, por unidad) donde 2 decimales redondearían a cero. */
export function formatearUsdPreciso(monto: number): string {
  if (monto === 0) return FORMATEADOR_USD_TOTAL.format(0);
  return FORMATEADOR_USD_PRECISO.format(monto);
}
