/**
 * Contrato de la Torre de control v2 — los tipos, del lado del servidor.
 * =====================================================================
 *
 * **Tipo VIVO.** El «contrato congelado» del handoff de diseño se retiró el
 * 2026-08-03 (`docs/torre-de-control/alcance-v2.md`). Este archivo se edita
 * cuando el producto lo pide; ya no espeja ningún documento externo.
 *
 * Sigue viviendo aquí, y no en `tipos.ts`, por la razón de siempre: `tipos.ts`
 * es el vocabulario INTERNO del módulo y esto es el contrato EXTERNO con la
 * pantalla. Una sola declaración compartida entre el composer y la interfaz es
 * lo que hace que un desajuste sea error de compilación y no una región vacía.
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMBIÓ RESPECTO DE LA v1, Y POR QUÉ
 * -----------------------------------------------------------------------------
 * · **La unidad es la COMUNA, no la zona.** El courier reconoce comunas; «Sur /
 *   Oriente» es una agrupación suya que sirve para cortes, conductores y
 *   capacidad, pero no manda el mapa. La zona sobrevive como `zonaId` colgando
 *   de la comuna, para enlazar, no para agregar.
 * · **La cifra es una MAGNITUD, nunca un índice.** «38 de 120 pendientes», no
 *   «73 de riesgo». Cayeron el puntaje 0–100, sus seis factores y la escala
 *   cromática entera. Con ellos cayeron clima y aire, que solo existían como
 *   factores y como capas.
 * · **Un solo horizonte: HOY.** Cayó `TorreRespuesta` con su
 *   `Record<Horizonte, EstadoTorre>`. El composer devuelve un `EstadoTorre` y
 *   ya. Lo único que mira adelante es la ola, y es una banda de aviso.
 * · **Entregado lo declara la app de Rutax**, no la sincronización con Mercado
 *   Libre. Ver `EstadoPunto` más abajo: es la decisión con más consecuencias de
 *   todo este archivo.
 *
 * -----------------------------------------------------------------------------
 * MINIMIZACIÓN DE DATOS PERSONALES — no es estilo, es invariante
 * -----------------------------------------------------------------------------
 * · **Del destinatario no viaja nada.** Ni nombre, ni dirección, ni teléfono. El
 *   identificador del punto es el CÓDIGO DE ENVÍO, que es del paquete y no de
 *   una persona. La minimización empieza en el `select` de `consultas.ts`, no en
 *   el render: un campo que no se dibuja pero viaja en el payload está expuesto
 *   igual.
 * · **`tracking_token` NUNCA entra acá.** Es el otro identificador del pedido y
 *   es PÚBLICO: viaja en la URL `/tracking/[token]` que se le comparte al
 *   destinatario. Ponerlo en la Torre lo filtraría a toda la operación.
 * · **Del conductor viaja el nombre y su avance, nunca su recorrido.** El modelo
 *   guarda una sola fila por conductor —la última posición, sin histórico— y eso
 *   es minimización deliberada (Ley 21.431), no una tabla a medio hacer.
 */

// =============================================================================
// 1. Primitivas
// =============================================================================

export interface Coordenada {
  lat: number;
  long: number;
}

/**
 * Rango temporal. Fechas ISO 8601 con offset de Santiago.
 * `fin: null` = en curso, sin término conocido.
 */
export interface Ventana {
  inicio: string;
  fin: string | null;
}

// =============================================================================
// 2. Frescura — F6, callada por defecto
// =============================================================================

/**
 * Cuán reciente es lo que la pantalla está mostrando.
 *
 * **Qué mide, exactamente.** El instante del último registro de entrega que un
 * conductor de este courier subió por la app de Rutax — sea el POD autoritativo
 * del same-day o el cierre operativo de una parada Flex. NO mide la última
 * sincronización con Mercado Libre, y esa distinción es toda la decisión: el
 * dato que la Torre cuenta es el de la app propia, así que la frescura tiene que
 * medir esa app y no la integración.
 *
 * **Callada por defecto** (regla 1 del alcance): mientras `atrasada` sea falso,
 * la pantalla no dibuja nada. Un indicador que siempre está ahí deja de leerse
 * justo el día que importa.
 *
 * Existe porque el contador puede mentir en silencio: si nadie sube un cierre en
 * dos horas, la pantalla se ve perfecta y está vieja, y el coordinador persigue
 * a un conductor que ya entregó.
 */
export interface FrescuraTorre {
  /** Instante ISO del último registro. `null` si hoy todavía no hay ninguno. */
  ultimoRegistroEn: string | null;
  /** Minutos desde `ultimoRegistroEn`. `null` cuando no hay registro con qué medir. */
  edadMinutos: number | null;
  /** Pasado el umbral. Es lo único que la pantalla necesita mirar para decidir si habla. */
  atrasada: boolean;
  /** A partir de cuántos minutos deja de estar callada. Viaja para poder explicarse. */
  umbralMinutos: number;
}

// =============================================================================
// 3. La comuna — F1 y nivel 1 del zoom
// =============================================================================

/**
 * Una comuna de la Región Metropolitana con la carga del día.
 *
 * `nombre` es el nombre CANÓNICO (el que produce `resolverComunaCanonica`), y no
 * es decorativo: es la clave con la que el cliente empareja contra la geometría
 * comunal DPA 2023 de `public/mapas/comunas-rm.topojson.json`. Si acá viajara el
 * nombre crudo del pedido —con o sin acento, en mayúsculas—, la comuna no
 * pintaría y el mapa perdería carga sin avisar.
 */
export interface ComunaEnTorre {
  nombre: string;
  /** Lo que falta por entregar. Es LA cifra de la pantalla. */
  pendientes: number;
  /** Con cuántos partió el día. `pendientes` sobre esto es la fracción «38 de 120». */
  total: number;
  entregados: number;
  /** Incidencias abiertas de pedidos de esta comuna. Lo único que se pinta en rojo. */
  incidenciasAbiertas: number;
  /**
   * Pendientes que ya están cerca de la hora de corte (F7).
   *
   * El corte se calcula y se usa para MARCAR, nunca para dibujar una cuenta
   * regresiva: el corte del same-day es uno solo y el courier lo sabe de memoria,
   * así que un reloj en la cabecera no informa nada. La urgencia va pegada al
   * dato.
   */
  enRiesgoDeCorte: number;
  /** Centro visual, para la placa y el encuadre. */
  centro: Coordenada;
  /**
   * Zona del courier que cubre esta comuna, si la configuró. Sirve para enlazar
   * y para resolver el corte aplicable — **no** para agregar el mapa.
   */
  zonaId: string | null;
}

// =============================================================================
// 4. El punto de entrega — F3 y nivel 3 del zoom
// =============================================================================

/**
 * Estado de un punto en el mapa.
 *
 * ⚠️ **`entregado` se declara desde la app de Rutax, no desde el estado oficial
 * del pedido** (decisión del usuario, 2026-08-03). El conductor cierra cada
 * parada en la app de Rutax —`operacion.cierres_conductor` para Flex,
 * `operacion.pruebas_entrega` para el same-day— y eso es lo que la Torre cuenta.
 *
 * **La consecuencia hay que conocerla antes de tocar esto.** En Flex, el estado
 * oficial del pedido lo gobierna la app de Mercado Envíos y llega con retraso,
 * así que durante unas horas la Torre puede decir 38 pendientes mientras
 * `/operaciones` dice 45. No es un bug: es la Torre yendo por delante. La
 * pantalla lo declara para que nadie lo lea como un descuadre, y el motor
 * entrega→dinero sigue rigiéndose por el estado oficial — esto no lo toca.
 *
 * `incidencia` gana a todo lo demás: es lo único accionable de la pantalla.
 */
export type EstadoPunto = 'pendiente' | 'en_ruta' | 'entregado' | 'incidencia';

/**
 * Un pedido concreto dentro de un punto del mapa.
 *
 * ⚠️ **Existe porque un punto NO es un pedido: es una UBICACIÓN.** Los pedidos
 * que comparten portal se colapsan en un solo punto (`agrupados`), y hasta ahora
 * del resto solo sobrevivía la cuenta: el mapa decía «+2» y no había forma de
 * saber cuáles eran esos dos sin salir a `/operaciones`. Con la lista, la ficha
 * los pagina en el mismo sitio.
 *
 * Es deliberadamente plano y corto: lo que la tarjeta dibuja y nada más. **Del
 * destinatario no viaja nada** — ni nombre, ni dirección, ni teléfono—, igual
 * que en el punto que lo contiene.
 */
export interface PedidoEnPunto {
  id: string;
  /** `ml_shipment_id` en Flex, `codigo_interno` en same-day. Nunca `tracking_token`. */
  codigoEnvio: string | null;
  estado: EstadoPunto;
  /** El NOMBRE, no el id: el coordinador va a llamar a una persona. */
  conductorNombre: string | null;
  sellerNombre: string | null;
  /** Intentos anteriores a hoy. `0` = primer intento. */
  intentosPrevios: number;
}

export interface PuntoEntrega {
  /** Id del pedido REPRESENTANTE. Es con lo que el clic abre la ficha. */
  id: string;
  posicion: Coordenada;
  /**
   * Los pedidos de esta ubicación, **empezando por el representante**.
   *
   * `pedidos.length` es el `+N` del mapa, y es la única fuente de esa cuenta: no
   * hay un campo aparte que pueda divergir. El primero es el de mayor prioridad
   * visual —una incidencia nunca queda escondida detrás de un entregado—, y es
   * el que la ficha muestra al abrirse.
   *
   * ⚠️ **Antes acá vivían `codigoEnvio`, `conductorNombre`, `sellerNombre` e
   * `intentosPrevios` del representante, más un `agrupados` con la cuenta.** Eso
   * dejaba al mapa diciendo «+2» sin forma de saber cuáles eran esos dos. Con la
   * lista, esos campos viven donde corresponde —en cada pedido— y la cuenta se
   * deriva de su largo.
   */
  pedidos: PedidoEnPunto[];
  /**
   * Estado de la UBICACIÓN: el de mayor prioridad visual entre sus pedidos.
   *
   * Es lo que pinta el punto, y por eso no se deriva en el cliente: una
   * incidencia nunca puede quedar escondida detrás de un entregado, y esa regla
   * se decide una vez en el servidor.
   */
  estado: EstadoPunto;
  comuna: string | null;
  /** Conductor del representante. Sirve para enlazar; el nombre va en el pedido. */
  conductorId: string | null;
  /** Algún pendiente de esta ubicación está cerca del corte (F7). Marca, no reloj. */
  cercaDelCorte: boolean;
}

// =============================================================================
// 5. Incidencias — F4
// =============================================================================

/**
 * Una entrega que falló y sigue abierta. **Es lo único rojo de la pantalla**
 * (regla 4 del alcance): nada decorativo puede usar ese color.
 */
export interface IncidenciaEnTorre {
  id: string;
  pedidoId: string;
  /** Valor crudo de `operacion.tipo_incidencia`. */
  tipo: string;
  /** El tipo ya traducido a español, para no obligar a la pantalla a saber el enum. */
  etiqueta: string;
  comuna: string | null;
  codigoEnvio: string | null;
  conductorNombre: string | null;
  /** Cuándo se abrió la incidencia, no cuándo la vimos. */
  abiertaEn: string;
}

// =============================================================================
// 6. Conductores — F13
// =============================================================================

/**
 * El avance de un conductor en su día.
 *
 * **F13 cambió de sujeto** (decisión del usuario, 2026-08-03): lo rezagado son
 * los PAQUETES, no las personas — al día siguiente esos paquetes los puede
 * entregar otro conductor. Así que este tipo tiene dos lecturas según la hora:
 *
 *   · **Durante el día** (antes de `HORA_CIERRE_DIA`): avance, sin juzgar.
 *     «Pérez · 12 de 40», ordenado por cuánto le falta. `rezagados` va en `null`
 *     porque a las 10 de la mañana todos tienen casi todo pendiente y la palabra
 *     no significaría nada.
 *   · **Después del cierre**: `rezagados` trae cuántos paquetes quedaron sin
 *     entregar. Ahí sí es una cuenta, y es la que se mide.
 *
 * No lleva GPS ni recorrido: el rezago se calcula con marcas de tiempo de
 * entregas, que ya existen. Decisión tomada y no se reabre.
 */
export interface ConductorEnTorre {
  id: string;
  nombre: string;
  /** Paradas del manifiesto de hoy. */
  asignados: number;
  /** Paradas que el conductor ya cerró en la app de Rutax. */
  completados: number;
  pendientes: number;
  /** Paquetes que quedaron sin entregar. `null` mientras el día sigue abierto. */
  rezagados: number | null;
  /** Último cierre que subió, para F6 y para ordenar. */
  ultimoRegistroEn: string | null;
  minutosSinRegistrar: number | null;
}

// =============================================================================
// 7. Olas entrantes — F9, lo único que mira adelante
// =============================================================================

/**
 * Dos arquetipos con comportamiento OPUESTO, y por eso el campo es el más
 * importante de la ola:
 * - `venta`: las entregas llegan DESPUÉS del evento (D+1 a D+5).
 * - `regalo`: llegan ANTES y el plazo es duro (la fecha es el deadline).
 *
 * Sin esto, las fechas engañan.
 */
export type ArquetipoOla = 'venta' | 'regalo';

/**
 * Una ola comercial dentro del horizonte.
 *
 * Respecto de la v1 se retiraron tres campos, y los tres por la misma razón —
 * ocupaban mucho y decían poco:
 *   · `curva` (proyectado vs base vs capacidad): es un gráfico, y dice lo mismo
 *     que `brechaConductores` + `diaCritico` en diez veces el espacio.
 *   · `fechaLimiteCompraPorZona`: le sirve al SELLER para su publicidad, no al
 *     courier para despachar.
 *   · `hitos`: eran cuatro textos genéricos con fecha calculada y sin forma de
 *     marcarlos hechos. Pasaron el propio test del alcance: texto genérico, cae.
 */
export interface OlaEntrante {
  id: string;
  nombre: string;
  arquetipo: ArquetipoOla;
  organizador: string | null;
  /** Fecha del evento comercial en sí. */
  fechaEvento: Ventana;
  diasParaEvento: number;
  /** Ventana en que llegan las entregas. Distinta de `fechaEvento` — ver arquetipo. */
  ventanaEntregas: Ventana;
  variacionEsperadaPct: number;
  /** Día de mayor BRECHA contra la capacidad, que no es el de mayor volumen. */
  diaCritico: string;
  /** LA cifra accionable: «el 15 te faltan 4 conductores». Negativa o 0. */
  brechaConductores: number;
  /**
   * Letra chica, pero es señal de confianza: salir del histórico propio del
   * courier se cree; salir de un catálogo genérico se toma con pinzas.
   */
  fuenteProyeccion: 'catalogo' | 'historico_tenant';
}

/** Calendario comercial chileno, tal como vive en `contexto.eventos_comerciales`. */
export interface EventoComercial {
  id: string;
  nombre: string;
  arquetipo: ArquetipoOla;
  organizador: string | null;
  inicio: string;
  fin: string;
  multiplicadorBase: number;
  /** Distribución del rezago: clave = offset en días, valor = proporción. */
  curvaRezago: Record<string, number>;
}

// =============================================================================
// 8. Resumen y estado de pantalla
// =============================================================================

/**
 * Las cifras de cabecera. Todas son magnitudes: no hay ni un índice ni un
 * porcentaje derivado.
 */
export interface ResumenTorre {
  /** Pedidos con compromiso de hoy. El denominador de «38 de 120». */
  total: number;
  pendientes: number;
  entregados: number;
  incidenciasAbiertas: number;
  /** Pendientes cerca del corte, sumados (F7). */
  enRiesgoDeCorte: number;
  /**
   * Pedidos que no se pudieron ubicar en el mapa.
   *
   * **Una sola vez en pantalla** (en la v1 aparecía cuatro). Se declara siempre,
   * porque un mapa que esconde lo que no pudo ubicar miente sobre la carga real
   * y eso destruye la confianza en toda la pantalla (regla 5 del alcance).
   */
  sinUbicar: number;
}

/**
 * Estados que la interfaz DEBE resolver. No son casos borde: son estados de
 * diseño de primera clase.
 *
 * De la v1 cayeron dos. `degradado` se fue con las fuentes externas —era el
 * estado en el que la Torre abría SIEMPRE, por dos fuentes que se decidió no
 * construir— y `sin_zonas` se fue con la comuna como unidad: las comunas de la
 * RM existen configure o no el courier sus zonas.
 */
export type EstadoPantalla =
  /** Hay al menos una incidencia abierta. Es el estado que pide atención. */
  | 'con_incidencias'
  /** El día va bien. Se dice en una línea y la pantalla se calla. */
  | 'tranquilo'
  /** Primera carga. Cada región llega por separado, ninguna bloquea a la otra. */
  | 'cargando'
  /** No hay pedidos con compromiso hoy (feriado, domingo). */
  | 'sin_pedidos';

export interface MensajeEstado {
  estado: EstadoPantalla;
  titulo: string;
  cuerpo: string;
  accion: { etiqueta: string; destino: string } | null;
}

// =============================================================================
// 9. Raíz — todo el estado de la pantalla en un objeto
// =============================================================================

/**
 * Lo que el composer devuelve a la pantalla.
 *
 * **Ya no hay envoltorio de horizontes.** En la v1 esto venía dentro de un
 * `TorreRespuesta` con `hoy`, `manana` y `72h` precalculados, para que el
 * selector de horizonte no disparara un viaje al servidor. Ese selector se
 * retiró: en same-day el horizonte de 72 h estaría vacío siempre y el de mañana
 * no dice nada de un día que se cierra hoy. Con un solo horizonte, el envoltorio
 * era una capa que solo servía para escribir `.horizontes.hoy` en todas partes.
 */
export interface EstadoTorre {
  courier: { id: string; nombre: string };
  /** Instante ISO de «ahora», calculado UNA vez en el servidor. */
  ahora: string;
  /** Fecha civil de hoy en Santiago. Nunca derivar esto de `ahora` en el cliente. */
  fecha: string;
  estado: EstadoPantalla;
  resumen: ResumenTorre;
  comunas: ComunaEnTorre[];
  puntos: PuntoEntrega[];
  incidencias: IncidenciaEnTorre[];
  conductores: ConductorEnTorre[];
  /** Las próximas 2 o 3. Vacío cuando no hay ninguna en el horizonte. */
  olas: OlaEntrante[];
  frescura: FrescuraTorre;
  /**
   * Hora de corte aplicable, si el día ya cerró (F13 cambia de lectura ahí) y si
   * el corte YA VENCIÓ.
   *
   * `vencido` existe porque pasada la hora `minutosHastaCorte` devuelve 0 y todo
   * lo pendiente cae dentro del margen de riesgo: la cuarta magnitud pasa a
   * repetir exacto a «faltan por entregar» y deja de informar. Con los cortes
   * reales de un courier same-day (mediodía y media tarde) eso ocurre durante
   * buena parte de la jornada, no solo al final. La cifra no cambia — cambia el
   * rótulo, que pasa a decir «pasadas del corte».
   *
   * Se calcula en el SERVIDOR, con el mismo `ahoraMinutos` que alimenta el resto
   * del cálculo. Derivarlo en el cliente comparando con `hora` reintroduciría una
   * zona horaria en el navegador, que es justo lo que este contrato evita.
   */
  corte: { hora: string | null; diaCerrado: boolean; vencido: boolean };
}
