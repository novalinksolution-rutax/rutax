/**
 * Validación zod del payload de la Torre contra el contrato congelado.
 * =====================================================================
 *
 * El contrato lo congeló el handoff de diseño y la pantalla lo consume sin
 * defensas: la ficha de excepción asume que `ventana.inicio` es una fecha ISO
 * parseable, el mapa asume que `centro.lat` es un número, la línea de tiempo
 * asume que `carril` es un entero. TypeScript lo garantiza EN COMPILACIÓN, y
 * eso no alcanza aquí: entre el compilador y la pantalla hay una base de datos
 * que devuelve `jsonb` sin forma declarada (`riesgo_zona.desglose`), columnas
 * nullable donde el contrato pide no-nulo, `bigint` que llega como string y
 * arrays que pueden venir `null`.
 *
 * Este esquema es la línea donde ese `unknown` se convierte en el tipo que la
 * pantalla espera. No es paranoia: `desglose` es JSON libre escrito por el job,
 * y una versión vieja del job dejando un campo con otro nombre pasaría el
 * typecheck sin problema y llegaría a producción como una zona sin factores.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EL ESQUEMA SE DECLARA `z.ZodType<TorreRespuesta>`
 * -----------------------------------------------------------------------------
 * Para que las dos formas no puedan divergir. Si alguien agrega un campo al
 * contrato y no aquí —o al revés—, el error es de compilación en este archivo,
 * no un `parse` que rechaza en producción un payload perfectamente válido.
 */

import { z } from 'zod';
import type { EstadoTorre, TorreRespuesta } from '../contrato-torre';

// =============================================================================
// Primitivas
// =============================================================================

/** Fecha civil `YYYY-MM-DD`. No es un instante: no lleva hora ni offset. */
const fechaCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha civil YYYY-MM-DD');

/** Instante ISO 8601. Se valida que sea parseable, no su forma exacta. */
const instante = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'instante ISO no parseable');

/**
 * Instante que además admite la cadena vacía: es el desajuste conocido del
 * contrato con `fuentes_estado.actualizado_en`, que es nullable porque una
 * fuente que nunca corrió no tiene última actualización exitosa.
 */
const instanteOVacio = z.union([z.literal(''), instante]);

const ventana = z.object({ inicio: instante, fin: instante.nullable() });
const ventanaCerrada = z.object({ inicio: instante, fin: instante });

const coordenada = z.object({
  lat: z.number().min(-90).max(90),
  long: z.number().min(-180).max(180),
});

const puntaje = z.number().min(0).max(100);

// =============================================================================
// Bloques
// =============================================================================

const frescuraFuente = z.object({
  id: z.string(),
  nombre: z.string(),
  estado: z.enum(['ok', 'atrasada', 'caida']),
  actualizadoEn: instanteOVacio,
  edadMinutos: z.number().min(0),
  cadenciaMinutos: z.number().positive(),
  motivo: z.string().nullable(),
});

const factorRiesgo = z.object({
  id: z.enum(['presion_operativa', 'clima', 'aire', 'transito', 'eventos', 'historico']),
  etiqueta: z.string().min(1),
  valor: puntaje,
  // El peso es el EFECTIVAMENTE usado, no el nominal: tránsito va en 0 mientras
  // no exista su fuente, y mostrar el nominal sería decirle al coordinador que
  // un factor pesa 15 % cuando no pesó nada.
  peso: z.number().min(0).max(1),
  explicacion: z.string(),
});

const zona = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  comunas: z.array(z.string()),
  riesgo: puntaje,
  nivel: z.enum(['calmo', 'bajo', 'medio', 'alto', 'critico']),
  factores: z.array(factorRiesgo),
  pedidosPendientes: z.number().int().min(0),
  pedidosEntregados: z.number().int().min(0),
  capacidadEstimada: z.number().int().min(0),
  conductoresAsignados: z.number().int().min(0),
  conductoresDisponibles: z.number().int().min(0),
  ventanaCorte: z.object({
    hora: z.string().regex(/^\d{2}:\d{2}$/, 'hora HH:MM'),
    // Puede ser negativo a propósito: el contrato lo declara así («negativo si
    // ya venció») y la pantalla usa el signo para decir cuánto se pasó.
    minutosRestantes: z.number(),
  }),
  montoComprometidoClp: z.number().min(0),
  centro: coordenada,
});

const metricaResumen = z.object({
  id: z.string(),
  etiqueta: z.string().min(1),
  valor: z.string().min(1),
  valorCrudo: z.number(),
  variacionPorcentual: z.number().nullable(),
  detalle: z.string(),
});

const accionSugerida = z.object({
  id: z.string().min(1),
  etiqueta: z.string().min(1),
  descripcion: z.string(),
});

const severidad = z.enum(['critica', 'alta', 'media', 'informativa']);

const excepcion = z.object({
  id: z.string().min(1),
  severidad,
  titulo: z.string().min(1),
  cuerpo: z.string(),
  zonaId: z.string().nullable(),
  ventana: ventana.nullable(),
  pedidosAfectados: z.number().int().min(0),
  montoAfectadoClp: z.number().min(0),
  acciones: z.array(accionSugerida),
  origen: z.enum(['motor', 'manual']),
  detectadaEn: instante,
});

const olaEntrante = z.object({
  id: z.string(),
  nombre: z.string(),
  arquetipo: z.enum(['venta', 'regalo']),
  organizador: z.string().nullable(),
  fechaEvento: ventana,
  diasParaEvento: z.number(),
  ventanaEntregas: ventana,
  variacionEsperadaPct: z.number(),
  curva: z.array(
    z.object({
      fecha: fechaCivil,
      etiquetaDia: z.string(),
      offsetDias: z.number().int(),
      pedidosProyectados: z.number().min(0),
      pedidosBase: z.number().min(0),
      capacidadEstimada: z.number().min(0),
      esPeak: z.boolean(),
    }),
  ),
  diaCritico: fechaCivil,
  brechaConductores: z.number().int(),
  fechaLimiteCompraPorZona: z
    .array(z.object({ zonaId: z.string(), fecha: fechaCivil }))
    .nullable(),
  hitos: z.array(
    z.object({
      id: z.string(),
      tMenosDias: z.number().int(),
      fechaLimite: fechaCivil,
      titulo: z.string(),
      estado: z.enum(['pendiente', 'hecho', 'vencido']),
    }),
  ),
  fuenteProyeccion: z.enum(['catalogo', 'historico_tenant']),
});

const bloqueTimeline = z.object({
  id: z.string().min(1),
  tipo: z.enum(['ventana_reparto', 'clima', 'corte_en_riesgo', 'restriccion']),
  etiqueta: z.string().min(1),
  inicio: instante,
  fin: instante,
  zonaId: z.string().nullable(),
  carril: z.number().int().min(0),
});

const estadoCapa = z.object({
  id: z.enum(['riesgo', 'clima', 'aire', 'conductores', 'pedidos', 'comunas']),
  etiqueta: z.string().min(1),
  activa: z.boolean(),
  disponible: z.boolean(),
  motivoNoDisponible: z.string().nullable(),
});

const conductorEnMapa = z.object({
  id: z.string(),
  nombre: z.string(),
  zonaId: z.string(),
  posicion: coordenada,
  ultimoPing: instante,
  minutosSinPing: z.number().min(0),
  paradasTotales: z.number().int().min(0),
  paradasCompletadas: z.number().int().min(0),
  estado: z.enum(['en_ruta', 'detenido', 'sin_senal', 'finalizado']),
});

const celdaClima = z.object({
  id: z.string(),
  tipo: z.enum(['lluvia', 'viento']),
  centro: coordenada,
  radioMetros: z.number().positive(),
  intensidadMmHora: z.number().min(0),
  ventana,
  zonasAfectadas: z.array(z.string()),
});

const pedidoEnMapa = z.object({
  id: z.string(),
  posicion: coordenada,
  estado: z.string(),
  cerrado: z.boolean(),
  zonaId: z.string().nullable(),
});

const marcaOperativa = z.object({
  id: z.string(),
  nota: z.string(),
  posicion: coordenada,
  radioMetros: z.number().positive(),
  ventana,
  autor: z.string(),
  creadaEn: instante,
});

const pronosticoAire = z.object({
  fecha: fechaCivil,
  pm25Maximo: z.number().min(0),
  nivel: z.enum(['bueno', 'regular', 'alerta', 'preemergencia', 'emergencia']),
  esProyeccion: z.boolean(),
});

const restriccionVehicular = z.object({
  fecha: fechaCivil,
  tipo: z.enum(['permanente', 'preemergencia', 'emergencia']),
  digitos: z.array(z.number().int().min(0).max(9)),
  alcance: z.string(),
});

// =============================================================================
// Raíz
// =============================================================================

export const esquemaEstadoTorre: z.ZodType<EstadoTorre> = z.object({
  courier: z.object({ id: z.string().min(1), nombre: z.string().min(1) }),
  ahora: instante,
  horizonte: z.enum(['hoy', 'manana', '72h']),
  estado: z.enum(['con_excepciones', 'tranquilo', 'cargando', 'degradado', 'sin_zonas', 'sin_pedidos']),
  zoom: z.enum(['zonas', 'comunas', 'pedidos']),
  zonaSeleccionada: z.string().nullable(),
  metricas: z.array(metricaResumen),
  zonas: z.array(zona),
  excepciones: z.array(excepcion),
  olaEntrante: olaEntrante.nullable(),
  timeline: z.array(bloqueTimeline),
  rangoTimeline: ventanaCerrada,
  capas: z.array(estadoCapa),
  frescura: z.array(frescuraFuente),
  conductores: z.array(conductorEnMapa),
  celdasClima: z.array(celdaClima),
  pedidos: z.array(pedidoEnMapa),
  marcasOperativas: z.array(marcaOperativa),
  pronosticoAire: z.array(pronosticoAire),
  restricciones: z.array(restriccionVehicular),
  pedidosSinGeocodificar: z.number().int().min(0),
});

export const esquemaTorreRespuesta: z.ZodType<TorreRespuesta> = z.object({
  horizonteInicial: z.enum(['hoy', 'manana', '72h']),
  horizontes: z.object({
    hoy: esquemaEstadoTorre,
    manana: esquemaEstadoTorre,
    '72h': esquemaEstadoTorre,
  }),
});

/**
 * Valida el payload antes de mandarlo a la pantalla.
 *
 * Lanza si no cuadra, y es deliberado: un payload fuera de contrato no produce
 * una pantalla degradada, produce una pantalla con números equivocados o una
 * excepción de render a medio camino. Fallar aquí deja el problema donde se
 * puede leer —con la ruta del campo infractor— en vez de en un `undefined` tres
 * componentes más abajo.
 */
export function validarTorreRespuesta(payload: unknown): TorreRespuesta {
  const resultado = esquemaTorreRespuesta.safeParse(payload);
  if (resultado.success) return resultado.data;

  const detalle = resultado.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join(' · ');
  throw new Error(
    `El composer de la Torre produjo un payload fuera de contrato. ${detalle}`,
  );
}
