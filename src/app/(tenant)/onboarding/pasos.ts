/**
 * Los cinco pasos de la puesta en marcha, en orden y con su dependencia.
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
 */

import { etiquetaFechaCivilCorta } from "@/lib/ui/rango-fecha";
import type { EstadoOnboardingCourier } from "./estado";

export type ClavePaso = "dte" | "folios" | "tarifas" | "cobranza" | "plan";

export interface PasoAsistente {
  clave: ClavePaso;
  /** 1 a 5. El orden es fijo y no depende del estado. */
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
  /** Sin él el courier no puede operar. Los otros tres son informativos. */
  critico: boolean;
  /** De qué paso depende, si depende de alguno. */
  dependeDe: ClavePaso | null;
  /** Su dependencia no está lista todavía. */
  bloqueado: boolean;
  /** Por qué está bloqueado, en lenguaje llano. `null` si no lo está. */
  motivoBloqueo: string | null;
  /** Ruta propia del paso. Se conserva para enlaces guardados y vuelta atrás. */
  href: string;
}

const TITULOS: Record<ClavePaso, string> = {
  dte: "Facturación electrónica",
  folios: "Folios CAF",
  tarifas: "Tarifas",
  cobranza: "Cobranza",
  plan: "Tu plan en Rutax",
};

const EN_FRASE: Record<ClavePaso, string> = {
  dte: "la facturación electrónica",
  folios: "los folios CAF",
  tarifas: "las tarifas",
  cobranza: "la cobranza",
  plan: "tu plan en Rutax",
};

const RUTAS: Record<ClavePaso, string> = {
  dte: "/onboarding/dte",
  folios: "/onboarding/folios",
  tarifas: "/onboarding/tarifas",
  cobranza: "/onboarding/cobranza",
  // El quinto paso vive fuera del asistente: es la suscripción del courier a
  // Rutax, que es backstage y tiene su propia pantalla.
  plan: "/configuracion/plan",
};

export function pasosDelAsistente(estado: EstadoOnboardingCourier): PasoAsistente[] {
  const dteListo = estado.dte.estado === "activo" || estado.dte.estado === "en_proceso";
  const hayProveedor = estado.dte.proveedorElegido !== null;

  const resumenDte = !hayProveedor
    ? "Sin proveedor elegido."
    : estado.dte.estado === "con_problemas"
      ? "Hay un problema con tu certificado."
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

  // Folios es el único paso con dependencia real, y es una dependencia de
  // INFORMACIÓN, no de permiso: hasta que no hay proveedor, nadie sabe si al
  // courier le toca cargar folios.
  const foliosBloqueado = !hayProveedor;

  return [
    {
      clave: "dte",
      numero: 1,
      titulo: TITULOS.dte,
      enFrase: EN_FRASE.dte,
      resumen: resumenDte,
      listo: dteListo,
      critico: true,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: RUTAS.dte,
    },
    {
      clave: "folios",
      numero: 2,
      titulo: TITULOS.folios,
      enFrase: EN_FRASE.folios,
      resumen: resumenFolios,
      listo: estado.folios.estado === "vigente" || estado.folios.estado === "no_aplica",
      critico: false,
      dependeDe: "dte",
      bloqueado: foliosBloqueado,
      motivoBloqueo: foliosBloqueado
        ? "Primero elige tu proveedor de facturación: él decide si gestiona tus folios o si los cargas tú."
        : null,
      href: RUTAS.folios,
    },
    {
      clave: "tarifas",
      numero: 3,
      titulo: TITULOS.tarifas,
      enFrase: EN_FRASE.tarifas,
      resumen: resumenTarifas,
      listo: estado.tarifas.estado === "configuradas",
      critico: true,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: RUTAS.tarifas,
    },
    {
      clave: "cobranza",
      numero: 4,
      titulo: TITULOS.cobranza,
      enFrase: EN_FRASE.cobranza,
      resumen: resumenCobranza,
      listo: estado.cobranza.estado === "conectado",
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: RUTAS.cobranza,
    },
    {
      clave: "plan",
      numero: 5,
      titulo: TITULOS.plan,
      enFrase: EN_FRASE.plan,
      resumen: resumenPlan,
      listo: estado.plan.estado === "activa" || estado.plan.estado === "trial",
      critico: false,
      dependeDe: null,
      bloqueado: false,
      motivoBloqueo: null,
      href: RUTAS.plan,
    },
  ];
}

/**
 * El siguiente paso que hay para hacer después de `desde`.
 *
 * Da la vuelta a la lista: si desde el paso 4 no queda nada por delante, mira
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
