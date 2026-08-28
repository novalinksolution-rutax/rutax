/**
 * Los catorce pasos de la puesta en marcha, en tres bloques.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES UNA FUNCIÓN PURA Y NO ESTÁ EN LA PANTALLA
 * -----------------------------------------------------------------------------
 * El asistente, el aviso del marco y la pantalla de cierre tienen que decir lo
 * mismo. Hasta hoy cada uno lo calculaba a su manera y decían cosas distintas en
 * la misma pantalla: la barra de progreso contaba dos pasos y el grid dibujaba
 * cinco, a 25 px de distancia.
 *
 * -----------------------------------------------------------------------------
 * 🔴 POR QUÉ HAY BLOQUES, Y NO UNA LISTA DE CATORCE
 * -----------------------------------------------------------------------------
 * El asistente pedía cinco cosas y el sistema necesita catorce: faltaban la
 * bodega, los conductores, los sellers, los datos del emisor SII, la cuenta
 * bancaria, la periodicidad, la retención, el pago por visita, las zonas y el
 * contacto público. Varios de esos no eran «un ajuste olvidado» — eran columnas
 * que el motor lee y ninguna pantalla escribía nunca.
 *
 * Catorce renglones planos y numerados son una lista de tareas que se abandona
 * en el cuarto. Tres bloques con una pregunta cada uno se leen de una pasada:
 *
 *   · **Para operar**   — sin esto no sale un paquete.
 *   · **Para cobrar**   — sin esto la entrega no se convierte en plata.
 *   · **Para que cuadre** — no bloquea, pero mientras no se toque hay un valor
 *     por defecto decidiendo en silencio (0% de retención, mensual, sin monto
 *     por visita).
 *
 * El bloque es SOLO agrupación visual: la numeración sigue siendo del 1 al 14 y
 * corrida, porque «paso 3 de 14» ubica y «paso 3 del bloque 1» obliga a sumar.
 *
 * -----------------------------------------------------------------------------
 * QUÉ AGREGA SOBRE `estado.ts`
 * -----------------------------------------------------------------------------
 * `estado.ts` responde «cómo está cada cosa». Esto responde «qué le toca hacer
 * al dueño ahora»: el orden, el número, de qué depende cada paso, cuál está
 * bloqueado y cuál es el siguiente. Son preguntas distintas y por eso viven
 * separadas — y ésta se puede probar sin base de datos.
 *
 * -----------------------------------------------------------------------------
 * BLOQUEADO NO ES LO MISMO QUE PENDIENTE
 * -----------------------------------------------------------------------------
 * Folios depende de DTE: sin proveedor elegido no se sabe siquiera si el courier
 * tiene que cargar folios o si los gestiona el proveedor. Un paso bloqueado se
 * muestra igual —con sus campos a la vista, atenuados— para que el dueño sepa
 * qué le van a pedir, y con el motivo escrito. Esconderlo lo deja adivinando.
 *
 * -----------------------------------------------------------------------------
 * SE RESUELVE FUERA ≠ ESTÁ INCOMPLETO
 * -----------------------------------------------------------------------------
 * Cinco pasos (bodega, conductores, sellers, zonas, plan) ya tienen su propia
 * pantalla, buena y con su RBAC. `seResuelveFuera` hace que el asistente los
 * ENLACE en vez de reimplementarlos embebidos: duplicar la nómina de conductores
 * dentro del asistente sería una segunda pantalla que mantener, y la que se
 * quedaría atrás sería siempre la copia.
 */

import { etiquetaFechaCivilCorta } from "@/lib/ui/rango-fecha";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import type { EstadoOnboardingCourier } from "./estado";

export type ClaveBloque = "operar" | "cobrar" | "cuadrar";

export type ClavePaso =
  | "sellers"
  | "conductores"
  | "bodega"
  | "dte"
  | "folios"
  | "tarifas"
  | "periodos"
  | "cobro"
  | "cobranza"
  | "retencion"
  | "retiro"
  | "zonas"
  | "contacto"
  | "plan";

export interface Bloque {
  clave: ClaveBloque;
  titulo: string;
  /** La pregunta que responde el bloque, en una línea. */
  proposito: string;
}

export const BLOQUES: readonly Bloque[] = [
  {
    clave: "operar",
    titulo: "Para operar",
    proposito: "Sin esto no sale un paquete.",
  },
  {
    clave: "cobrar",
    titulo: "Para cobrar",
    proposito: "Sin esto la entrega se hace y no se convierte en plata.",
  },
  {
    clave: "cuadrar",
    titulo: "Para que cuadre",
    proposito:
      "No te bloquea, pero mientras no lo toques hay un valor por defecto decidiendo por ti.",
  },
] as const;

export interface PasoAsistente {
  clave: ClavePaso;
  bloque: ClaveBloque;
  /** 1 a 14, corrido. El orden es fijo y no depende del estado. */
  numero: number;
  titulo: string;
  /**
   * El título metido en una frase: «Seguir con **los folios CAF**».
   *
   * Existe porque pasar el título por `toLowerCase()` produce «seguir con tu
   * plan en rutax» — le come la mayúscula a un nombre propio. Y porque el
   * artículo cambia con el paso.
   */
  enFrase: string;
  /** Una línea con el DATO real, no con la promesa: «50 cargados, quedan 8». */
  resumen: string;
  listo: boolean;
  /** Sin él el courier no puede operar. */
  critico: boolean;
  /** De qué paso depende, si depende de alguno. */
  dependeDe: ClavePaso | null;
  /** Su dependencia no está lista todavía. */
  bloqueado: boolean;
  /** Por qué está bloqueado, en lenguaje llano. `null` si no lo está. */
  motivoBloqueo: string | null;
  /** Ruta propia del paso. Se conserva para enlaces guardados y vuelta atrás. */
  href: string;
  /**
   * El paso vive en su propia pantalla y el asistente solo enlaza. Ver la nota
   * de cabecera: reimplementarlo embebido crearía una copia que se queda atrás.
   */
  seResuelveFuera: boolean;
}

export function pasosDelAsistente(estado: EstadoOnboardingCourier): PasoAsistente[] {
  const hayProveedor = estado.dte.proveedorElegido !== null;
  const dteCargado = estado.dte.estado === "activo" || estado.dte.estado === "en_proceso";
  const emisorCompleto = estado.dte.camposEmisorFaltantes.length === 0;

  // Folios es el único paso con dependencia real, y es una dependencia de
  // INFORMACIÓN, no de permiso: hasta que no hay proveedor, nadie sabe si al
  // courier le toca cargar folios.
  const foliosBloqueado = !hayProveedor;

  const resumenDte = !hayProveedor
    ? "Sin proveedor elegido."
    : estado.dte.estado === "con_problemas"
      ? "Hay un problema con tu certificado."
      : !emisorCompleto
        ? // El certificado sin los datos del emisor no basta: son campos
          // obligatorios del documento, y decir cuáles faltan evita abrir el
          // paso solo para averiguarlo.
          `${estado.dte.proveedorElegido} · falta ${listaEnFrase(estado.dte.camposEmisorFaltantes)} de tu empresa.`
        : estado.dte.certificadoVenceEn
          ? // Fecha CIVIL: `etiquetaFechaCivilCorta` no pasa por `Date`, que la
            // correría un día (medianoche UTC es el día anterior en Santiago).
            `${estado.dte.proveedorElegido} · certificado hasta el ${etiquetaFechaCivilCorta(estado.dte.certificadoVenceEn.slice(0, 10))}.`
          : `${estado.dte.proveedorElegido} · certificado cargado.`;

  const resumenFolios = !hayProveedor
    ? "Depende de tu proveedor: él decide si los gestiona o si los cargas tú."
    : estado.folios.gestionadoPorProveedor
      ? "Los gestiona tu proveedor directo con el SII. No tienes que hacer nada."
      : estado.folios.cantidadVigentes > 0
        ? `${estado.folios.cantidadVigentes} ${estado.folios.cantidadVigentes === 1 ? "rango vigente" : "rangos vigentes"}.`
        : "Sin folios cargados. No vas a poder emitir facturas.";

  const resumenTarifas =
    estado.tarifas.cantidad > 0
      ? `${estado.tarifas.cantidad} ${estado.tarifas.cantidad === 1 ? "tarifa activa" : "tarifas activas"}.`
      : "Sin tarifas. Una entrega sin tarifa se hace y no se puede cobrar.";

  const resumenCobranza =
    estado.cobranza.estado === "con_problemas"
      ? "La conexión con el banco se cayó. Los pagos no se están conciliando."
      : estado.cobranza.bancoConectado
        ? `${estado.cobranza.cuentaBancoAlias ?? "Banco"} conectado.`
        : "Sin banco conectado. Los pagos de tus sellers los vas a conciliar a mano.";

  const resumenPlan =
    estado.plan.estado === "sin_suscripcion"
      ? "Sin plan contratado."
      : estado.plan.estado === "trial"
        ? `Prueba${estado.plan.trialHasta ? ` hasta el ${etiquetaFechaCivilCorta(estado.plan.trialHasta.slice(0, 10))}` : ""}.`
        : `${estado.plan.nombrePlan ?? "Plan"} · ${estado.plan.estado}.`;

  const definiciones: Array<Omit<PasoAsistente, "numero">> = [
    // ── Bloque 1 · Para operar ──────────────────────────────────────────────
    {
      clave: "sellers",
      bloque: "operar",
      titulo: "Tus sellers",
      enFrase: "tus sellers",
      resumen:
        estado.sellers.cantidad > 0
          ? `${estado.sellers.cantidad} ${estado.sellers.cantidad === 1 ? "seller" : "sellers"}.`
          : "Sin sellers. No va a entrar ni un pedido al sistema.",
      listo: estado.sellers.cantidad > 0,
      critico: true,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/sellers",
      seResuelveFuera: true,
    },
    {
      clave: "conductores",
      bloque: "operar",
      titulo: "Tus conductores",
      enFrase: "tus conductores",
      resumen:
        estado.conductores.cantidad > 0
          ? `${estado.conductores.cantidad} ${estado.conductores.cantidad === 1 ? "conductor activo" : "conductores activos"}.`
          : "Sin conductores. No vas a tener a quién asignarle los pedidos.",
      listo: estado.conductores.cantidad > 0,
      critico: true,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/conductores",
      seResuelveFuera: true,
    },
    {
      clave: "bodega",
      bloque: "operar",
      titulo: "Tu bodega",
      enFrase: "tu bodega",
      resumen: resumenBodega(estado),
      listo: estado.bodegas.cantidad > 0,
      // NO es crítico: sin bodega la asignación y el manifiesto funcionan
      // igual. Lo que se cae es el ruteo, que arranca ahí.
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/configuracion/bodegas",
      seResuelveFuera: true,
    },

    // ── Bloque 2 · Para cobrar ──────────────────────────────────────────────
    {
      clave: "dte",
      bloque: "cobrar",
      titulo: "Facturación electrónica",
      enFrase: "la facturación electrónica",
      resumen: resumenDte,
      listo: dteCargado && emisorCompleto,
      critico: true,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/onboarding/dte",
      seResuelveFuera: false,
    },
    {
      clave: "folios",
      bloque: "cobrar",
      titulo: "Folios CAF",
      enFrase: "los folios CAF",
      resumen: resumenFolios,
      listo: estado.folios.estado === "vigente" || estado.folios.estado === "no_aplica",
      critico: false,
      dependeDe: "dte",
      bloqueado: foliosBloqueado,
      motivoBloqueo: foliosBloqueado
        ? "Primero elige tu proveedor de facturación: él decide si gestiona tus folios o si los cargas tú."
        : null,
      href: "/onboarding/folios",
      seResuelveFuera: false,
    },
    {
      clave: "tarifas",
      bloque: "cobrar",
      titulo: "Tarifas",
      enFrase: "las tarifas",
      resumen: resumenTarifas,
      listo: estado.tarifas.estado === "configuradas",
      critico: true,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/onboarding/tarifas",
      seResuelveFuera: false,
    },
    {
      clave: "periodos",
      bloque: "cobrar",
      titulo: "Cada cuánto facturas",
      enFrase: "cada cuánto facturas",
      resumen: estado.periodos.explicita
        ? `${nombrePeriodicidad(estado.periodos.tipoPeriodo)}.`
        : `Nadie lo eligió: estás facturando ${nombrePeriodicidad(estado.periodos.tipoPeriodo).toLowerCase()} por defecto.`,
      listo: estado.periodos.explicita,
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/configuracion/tarifas?seccion=periodos",
      seResuelveFuera: false,
    },
    {
      clave: "cobro",
      bloque: "cobrar",
      titulo: "Dónde te pagan",
      enFrase: "dónde te pagan",
      resumen: estado.datosCobro.configurado
        ? `${estado.datosCobro.banco ?? "Cuenta"} · tus sellers ya saben a dónde transferir.`
        : "Sin cuenta bancaria. La factura sale y el seller no sabe a dónde pagarte.",
      listo: estado.datosCobro.configurado,
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/onboarding?paso=cobro",
      seResuelveFuera: false,
    },
    {
      clave: "cobranza",
      bloque: "cobrar",
      titulo: "Conciliar los pagos",
      enFrase: "la conciliación de pagos",
      resumen: resumenCobranza,
      listo: estado.cobranza.estado === "conectado",
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/onboarding/cobranza",
      seResuelveFuera: false,
    },

    // ── Bloque 3 · Para que cuadre ──────────────────────────────────────────
    {
      clave: "retencion",
      bloque: "cuadrar",
      titulo: "Retención de boleta de terceros",
      enFrase: "la retención de boleta de terceros",
      resumen: estado.retencion.configurada
        ? `${formatearPorcentaje(estado.retencion.porcentaje ?? 0)} a tus conductores independientes.`
        : "Sin definir: hoy se les retiene 0% a tus conductores independientes.",
      listo: estado.retencion.configurada,
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/onboarding?paso=retencion",
      seResuelveFuera: false,
    },
    {
      clave: "retiro",
      bloque: "cuadrar",
      titulo: "Pago por visita a bodega",
      enFrase: "el pago por visita a bodega",
      resumen:
        estado.retiro.montoVisitaClp !== null
          ? `${formatearCLP(estado.retiro.montoVisitaClp)} por cada visita cerrada.`
          : "Sin monto propio. Las visitas se pagan con la tarifa de entrega, si la hay.",
      listo: estado.retiro.montoVisitaClp !== null,
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/configuracion/tarifas?seccion=retiro",
      seResuelveFuera: false,
    },
    {
      clave: "zonas",
      bloque: "cuadrar",
      titulo: "Zonas",
      enFrase: "las zonas",
      resumen:
        estado.zonas.cantidad > 0
          ? `${estado.zonas.cantidad} ${estado.zonas.cantidad === 1 ? "zona activa" : "zonas activas"}.`
          : "Sin zonas. Todas tus comunas se cobran con la tarifa por defecto.",
      listo: estado.zonas.cantidad > 0,
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/configuracion/tarifas?seccion=zonas",
      seResuelveFuera: true,
    },
    {
      clave: "contacto",
      bloque: "cuadrar",
      titulo: "Tu contacto público",
      enFrase: "tu contacto público",
      resumen: resumenContacto(estado),
      listo: Boolean(estado.contacto.telefono || estado.contacto.email),
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: "/onboarding?paso=contacto",
      seResuelveFuera: false,
    },
    {
      clave: "plan",
      bloque: "cuadrar",
      titulo: "Tu plan en Rutax",
      enFrase: "tu plan en Rutax",
      resumen: resumenPlan,
      listo: estado.plan.estado === "activa" || estado.plan.estado === "trial",
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      // El quinto paso vive fuera del asistente: es la suscripción del courier a
      // Rutax, que es backstage y tiene su propia pantalla.
      href: "/configuracion/plan",
      seResuelveFuera: true,
    },
  ];

  return definiciones.map((d, i) => ({ ...d, numero: i + 1 }));
}

function resumenBodega(estado: EstadoOnboardingCourier): string {
  if (estado.bodegas.cantidad === 0) {
    return "Sin bodega. El ruteo no tiene desde dónde empezar.";
  }
  if (!estado.bodegas.hayPrincipal) {
    return `${estado.bodegas.cantidad} cargadas, ninguna marcada como principal.`;
  }
  return estado.bodegas.cantidad === 1
    ? "1 bodega, marcada como principal."
    : `${estado.bodegas.cantidad} bodegas, con una principal.`;
}

function resumenContacto(estado: EstadoOnboardingCourier): string {
  const { telefono, email } = estado.contacto;
  if (!telefono && !email) {
    return "Sin datos. Quien espera un paquete no tiene a quién preguntarle.";
  }
  if (telefono && email) return `${telefono} · ${email}`;
  return telefono ?? email ?? "";
}

/** «14,5%» sin decimales de más: el 15 se ve 15%, no 15,00%. */
function formatearPorcentaje(valor: number): string {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(valor)}%`;
}

function nombrePeriodicidad(tipo: string): string {
  if (tipo === "semanal") return "Semanal";
  if (tipo === "quincenal") return "Quincenal";
  return "Mensual";
}

/** «giro, dirección y comuna» — con «y» antes del último, no una lista con comas. */
function listaEnFrase(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/**
 * El siguiente paso que hay para hacer después de `desde`.
 *
 * Da la vuelta a la lista: si desde el paso 12 no queda nada por delante, mira
 * los anteriores. Sin eso, el botón «Seguir con…» desaparece justo cuando el
 * dueño abre el último paso pendiente por el medio, que es como se usa esto de
 * verdad.
 *
 * Salta los bloqueados: mandar a alguien a un paso que no puede completar es
 * peor que no ofrecerle nada.
 */
export function siguientePendiente(
  pasos: readonly PasoAsistente[],
  desde: ClavePaso,
): PasoAsistente | null {
  const i = pasos.findIndex((p) => p.clave === desde);
  const inicio = i === -1 ? 0 : i + 1;
  const rotados = [...pasos.slice(inicio), ...pasos.slice(0, Math.max(0, inicio))];
  return rotados.find((p) => !p.listo && !p.bloqueado && p.clave !== desde) ?? null;
}
