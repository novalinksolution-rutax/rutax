/**
 * Validación zod del payload de la Torre.
 * =====================================================================
 *
 * La pantalla consume `EstadoTorre` sin defensas: el mapa asume que `centro.lat`
 * es un número, la ficha de incidencia asume que `abiertaEn` es una fecha ISO
 * parseable, la placa de comuna asume que `pendientes` es un entero. TypeScript
 * lo garantiza EN COMPILACIÓN, y eso no alcanza acá: entre el compilador y la
 * pantalla hay una base de datos que devuelve columnas nullable donde el contrato
 * pide no-nulo y numéricos que llegan como string.
 *
 * Este esquema es la línea donde ese `unknown` se convierte en el tipo que la
 * pantalla espera.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EL ESQUEMA SE DECLARA `z.ZodType<EstadoTorre>`
 * -----------------------------------------------------------------------------
 * Para que las dos formas no puedan divergir. Si alguien agrega un campo al
 * contrato y no acá —o al revés—, el error es de compilación en este archivo y no
 * un `parse` que rechaza en producción un payload perfectamente válido.
 */

import { z } from 'zod';
import type { EstadoTorre } from '../contrato-torre';

// =============================================================================
// Primitivas
// =============================================================================

/** Fecha civil `YYYY-MM-DD`. No es un instante: no lleva hora ni offset. */
const fechaCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha civil YYYY-MM-DD');

/** Instante ISO 8601. Se valida que sea parseable, no su forma exacta. */
const instante = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'instante ISO no parseable');

const ventana = z.object({ inicio: instante, fin: instante.nullable() });

const coordenada = z.object({
  lat: z.number().min(-90).max(90),
  long: z.number().min(-180).max(180),
});

/** Un conteo: entero y nunca negativo. */
const conteo = z.number().int().min(0);

// =============================================================================
// Bloques
// =============================================================================

const frescura = z.object({
  ultimoRegistroEn: instante.nullable(),
  edadMinutos: conteo.nullable(),
  atrasada: z.boolean(),
  umbralMinutos: z.number().positive(),
});

const comuna = z.object({
  nombre: z.string().min(1),
  pendientes: conteo,
  total: conteo,
  entregados: conteo,
  incidenciasAbiertas: conteo,
  enRiesgoDeCorte: conteo,
  centro: coordenada,
  zonaId: z.string().nullable(),
});

const estadoPunto = z.enum(['pendiente', 'en_ruta', 'entregado', 'incidencia']);

const pedidoEnPunto = z.object({
  id: z.string(),
  codigoEnvio: z.string().nullable(),
  estado: estadoPunto,
  conductorNombre: z.string().nullable(),
  sellerNombre: z.string().nullable(),
  /** 0 = primer intento. Nunca negativo: cuenta incidencias cerradas. */
  intentosPrevios: conteo,
});

const punto = z.object({
  id: z.string(),
  posicion: coordenada,
  /** Al menos el representante. Su largo es el `+N` del mapa. */
  pedidos: z.array(pedidoEnPunto).min(1),
  estado: estadoPunto,
  comuna: z.string().nullable(),
  conductorId: z.string().nullable(),
  cercaDelCorte: z.boolean(),
});

const incidencia = z.object({
  id: z.string(),
  pedidoId: z.string(),
  tipo: z.string(),
  etiqueta: z.string(),
  comuna: z.string().nullable(),
  codigoEnvio: z.string().nullable(),
  conductorNombre: z.string().nullable(),
  abiertaEn: instante,
});

const conductor = z.object({
  id: z.string(),
  nombre: z.string(),
  asignados: conteo,
  completados: conteo,
  pendientes: conteo,
  rezagados: conteo.nullable(),
  ultimoRegistroEn: instante.nullable(),
  minutosSinRegistrar: conteo.nullable(),
});

const ola = z.object({
  id: z.string(),
  nombre: z.string(),
  arquetipo: z.enum(['venta', 'regalo']),
  organizador: z.string().nullable(),
  fechaEvento: ventana,
  diasParaEvento: z.number().int(),
  ventanaEntregas: ventana,
  variacionEsperadaPct: z.number(),
  diaCritico: fechaCivil,
  /** Brecha de conductores: negativa cuando falta gente, 0 cuando alcanza. */
  brechaConductores: z.number().int().max(0),
  fuenteProyeccion: z.enum(['catalogo', 'historico_tenant']),
});

const resumen = z.object({
  total: conteo,
  pendientes: conteo,
  entregados: conteo,
  incidenciasAbiertas: conteo,
  enRiesgoDeCorte: conteo,
  sinUbicar: conteo,
});

// =============================================================================
// Raíz
// =============================================================================

export const esquemaEstadoTorre: z.ZodType<EstadoTorre> = z.object({
  courier: z.object({ id: z.string(), nombre: z.string() }),
  ahora: instante,
  fecha: fechaCivil,
  estado: z.enum(['con_incidencias', 'tranquilo', 'cargando', 'sin_pedidos']),
  resumen,
  comunas: z.array(comuna),
  puntos: z.array(punto),
  incidencias: z.array(incidencia),
  conductores: z.array(conductor),
  olas: z.array(ola),
  frescura,
  corte: z.object({
    /** Hora local `HH:MM`, o `null` si el courier no configuró ninguna. */
    hora: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    diaCerrado: z.boolean(),
  }),
});

/**
 * Valida el payload antes de mandarlo a la pantalla.
 *
 * Lanza si no calza. Es deliberado: la banda del dashboard ya envuelve su llamada
 * en un `try`, así que un payload malformado hace desaparecer la banda en vez de
 * pintar cifras inventadas — y en la Torre misma, un error visible es preferible
 * a un tablero que miente en silencio.
 */
export function validarEstadoTorre(candidato: unknown): EstadoTorre {
  return esquemaEstadoTorre.parse(candidato);
}
