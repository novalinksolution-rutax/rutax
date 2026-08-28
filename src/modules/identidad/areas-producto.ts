/**
 * Áreas de producto — qué partes puede apagar Rutax por courier.
 * =============================================================================
 *
 * POR QUÉ EXISTE
 * -----------------------------------------------------------------------------
 * El módulo de dinero no es productivo y el primer courier real ya opera. Rutax
 * necesita apagar «esta parte no está lista» por courier, alcanzando a todos sus
 * usuarios —los de hoy y los que cree mañana— sin tocar roles.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL APAGADO SE APLICA EN `tieneCapacidad`, Y ESO ES TODO EL DISEÑO
 * -----------------------------------------------------------------------------
 * Cada pantalla, cada entrada de menú y cada Server Action del producto ya pasa
 * por `tieneCapacidad`. Restar ahí las capacidades de un área apagada cubre las
 * ~50 puertas existentes **sin tocar ni una**, y hace imposible que alguien
 * agregue una pantalla nueva que se salte el interruptor: si la gatea con una
 * capacidad, ya está gateada por el área.
 *
 * La alternativa —un `if (areaApagada)` en cada pantalla— habría sido cincuenta
 * sitios donde olvidarse de uno.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ VER Y HACER ESTABAN PEGADOS, Y HUBO QUE SEPARARLOS
 * -----------------------------------------------------------------------------
 * `emitir_facturas` gateaba la pantalla de Períodos (donde se VE cuánto le debe
 * cada seller) además de la emisión del DTE. Igual `gestionar_liquidaciones_
 * conductores` con la pantalla de Liquidaciones. Apagar el área habría borrado
 * justo lo que el courier sí tiene que ver.
 *
 * Por eso existen `ver_periodos_cobro` y `ver_liquidaciones`, que NO pertenecen
 * a ninguna área: son lectura, y la lectura se queda encendida siempre.
 *
 * -----------------------------------------------------------------------------
 * EL SELLER Y EL CONDUCTOR ENTRAN POR SUS PROPIAS CAPACIDADES
 * -----------------------------------------------------------------------------
 * `ver_documentos_propios` es del SELLER (su DTE) y `ver_liquidacion_propia` es
 * del CONDUCTOR — dos capacidades distintas, una audiencia cada una. Un
 * comentario del catálogo sugería que la primera servía a las dos y llevó a
 * mapearla por tipo de usuario; la matriz de roles lo desmiente y una prueba lo
 * destapó. Mapeadas directo, la liquidación del conductor queda gateada de
 * verdad — con la otra forma no lo estaba por ninguna área.
 */

import type { Capacidad } from "./capacidades";

/**
 * Las cinco áreas. Misma lista que el CHECK
 * `areas_habilitadas_area_valida` de la migración `20260828000003`.
 */
export const AREAS_PRODUCTO = [
  "emision_facturas",
  "folios_caf",
  "pago_conductores",
  "conciliacion_cobranza",
  "suscripcion_rutax",
] as const;

export type AreaProducto = (typeof AREAS_PRODUCTO)[number];

export function esAreaProducto(valor: unknown): valor is AreaProducto {
  return typeof valor === "string" && (AREAS_PRODUCTO as readonly string[]).includes(valor);
}

export interface DescripcionArea {
  clave: AreaProducto;
  titulo: string;
  /** Qué deja de poder hacer el courier, en una línea. */
  apaga: string;
  /** Qué SIGUE viendo. Vacío cuando el área no deja nada detrás. */
  conserva: string | null;
}

/**
 * El catálogo, para el panel del backstage. El orden es el del flujo de dinero:
 * primero se factura, luego se cobra, luego se paga.
 */
export const DESCRIPCION_AREAS: readonly DescripcionArea[] = [
  {
    clave: "emision_facturas",
    titulo: "Emisión de facturas",
    apaga: "Emitir DTE y notas de crédito, y cerrar o reabrir períodos de cobro.",
    conserva: "Los períodos y cuánto le debe cada seller.",
  },
  {
    clave: "folios_caf",
    titulo: "Folios CAF",
    apaga: "Cargar rangos de folios del SII.",
    conserva: null,
  },
  {
    clave: "pago_conductores",
    titulo: "Pago a conductores",
    apaga: "Emitir el pago, marcar una liquidación como pagada y ajustarla. También el job que transfiere.",
    conserva: "Las liquidaciones y cuánto se le debe a cada conductor.",
  },
  {
    clave: "conciliacion_cobranza",
    titulo: "Conciliación y cobranza",
    // ⚠️ Frase con VERBO: el panel la mete dentro de «deja de poder: …», y una
    // frase que empieza en sustantivo queda «deja de poder: la bandeja de…».
    apaga:
      "Resolver excepciones, atribuir los pagos que entran y mandar recordatorios de morosidad. También el job detective.",
    conserva: null,
  },
  {
    clave: "suscripcion_rutax",
    titulo: "Suscripción a Rutax",
    apaga: "Contratar o cambiar de plan, el mandato y el cobro automático.",
    conserva: "Qué plan tiene contratado.",
  },
] as const;

/**
 * Qué capacidades apaga cada área.
 *
 * ⚠️ Solo capacidades de ACCIÓN. Las de lectura (`ver_periodos_cobro`,
 * `ver_liquidaciones`, `ver_reportes_ejecutivos`) quedan deliberadamente fuera:
 * el courier tiene que poder ver sus cifras aunque no pueda actuar sobre ellas,
 * que es todo el punto del encargo.
 */
const CAPACIDADES_POR_AREA: Record<AreaProducto, readonly Capacidad[]> = {
  emision_facturas: [
    // Emite el DTE, la nota de crédito, y cierra/reabre el período — las tres
    // acciones piden esta misma capacidad en `dinero/acciones.ts`.
    "emitir_facturas",
    // Aprobar la facturación no tiene sentido si no se puede emitir.
    "aprobar_facturacion",
    // Del SELLER: ver y descargar sus DTE. Sin emisión no hay documento que
    // mostrarle, y enseñarle una deuda sin factura invita al reclamo.
    "ver_documentos_propios",
  ],
  folios_caf: [
    // Gatea el proveedor DTE, el certificado y los folios. Los DATOS del emisor
    // (giro, dirección, comuna, actividad) NO: son de `gestionar_perfil_empresa`
    // y siguen siendo identidad de la empresa aunque no se emita nada.
    "gestionar_configuracion_dte",
  ],
  pago_conductores: [
    "gestionar_liquidaciones_conductores",
    // Del CONDUCTOR: su propia liquidación. Mientras Rutax no le pague por acá,
    // mostrarle un monto que no va a recibir por este canal genera el reclamo
    // que el interruptor viene a evitar.
    "ver_liquidacion_propia",
  ],
  conciliacion_cobranza: ["ver_conciliacion", "gestionar_cobranza"],
  suscripcion_rutax: ["gestionar_suscripcion"],
};

/** A qué área pertenece una capacidad, o `null` si no la gobierna ninguna. */
export function areaDeCapacidad(capacidad: Capacidad): AreaProducto | null {
  for (const area of AREAS_PRODUCTO) {
    if (CAPACIDADES_POR_AREA[area].includes(capacidad)) return area;
  }
  return null;
}

/** Todas las capacidades que algún área puede apagar. Para pruebas y el panel. */
export function capacidadesDeArea(area: AreaProducto): readonly Capacidad[] {
  return CAPACIDADES_POR_AREA[area];
}
