/**
 * Las capacidades, dichas en castellano, y la comparación entre dos roles.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE
 * -----------------------------------------------------------------------------
 * Cambiarle el rol a alguien es una decisión sobre lo que va a poder hacer, y
 * hasta hoy la interfaz no tenía forma de decirlo: las descripciones de rol
 * estaban **escritas a mano**, con un comentario que admitía ser «un resumen
 * fiel que debe revisarse si el mapa cambia». Un resumen que hay que acordarse
 * de revisar es un resumen que va a mentir.
 *
 * Acá cada capacidad tiene su frase, y el resto —qué pierde, qué gana, qué sigue
 * sin tener— sale por **diferencia de conjuntos** sobre `MATRIZ_ROL_CAPACIDADES`.
 * Si mañana el dueño le saca `gestionar_bodegas` al coordinador, el diálogo lo
 * dice solo.
 *
 * -----------------------------------------------------------------------------
 * LA RED QUE LO SOSTIENE
 * -----------------------------------------------------------------------------
 * `capacidades-legibles.test.ts` comprueba que **las capacidades del catálogo
 * tengan frase**. Sin eso, agregar una capacidad nueva la haría aparecer en el
 * diálogo como `gestionar_bodegas` a secas, en medio de una lista en castellano.
 */

import { CAPACIDADES, capacidadesDeRol, type Capacidad } from "./capacidades";
import type { Rol } from "./roles";

/**
 * Qué permite cada capacidad, en la voz del producto.
 *
 * Se escriben como acciones («Emitir facturas al SII») y no como permisos
 * («Permiso de emisión»): quien lee esto está decidiendo qué va a hacer otra
 * persona mañana.
 */
export const FRASE_CAPACIDAD: Record<Capacidad, string> = {
  // --- Del equipo interno del courier ---
  gestionar_usuarios_y_roles: "Dar de alta gente y cambiarle el rol",
  invitar_usuarios_internos: "Invitar a alguien al equipo",
  revocar_invitaciones: "Revocar una invitación",
  gestionar_tarifas: "Cambiar las tarifas y las zonas",
  gestionar_configuracion_dte: "Configurar la facturación electrónica y sus folios",
  aprobar_facturacion: "Aprobar la facturación de un período",
  emitir_facturas: "Emitir facturas al SII",
  ver_conciliacion: "Ver la conciliación y sus excepciones",
  gestionar_liquidaciones_conductores: "Liquidar y pagar a los conductores",
  gestionar_cobranza: "Gestionar la cobranza a los sellers",
  asignar_y_reasignar_pedidos: "Asignar y reasignar pedidos",
  generar_manifiestos: "Armar los manifiestos del día",
  gestionar_incidencias: "Resolver incidencias",
  ajustar_operacion_diaria: "Ajustar la operación del día",
  ver_preparacion_dia: "Ver la preparación del día",
  gestionar_bodegas: "Administrar las bodegas",
  sincronizar_conexiones_ml: "Sincronizar las cuentas de Mercado Libre",
  ver_torre_control: "Ver la torre de control",
  ver_reportes_ejecutivos: "Ver los reportes del negocio",
  ver_bitacora_auditoria: "Ver la bitácora y exportar los datos",
  gestionar_suscripcion: "Cambiar el plan de Rutax",
  // --- Del seller, en su portal ---
  gestionar_conexion_ml_propia: "Conectar su tienda o su cuenta de Mercado Libre",
  solicitar_same_day: "Pedir un envío same-day",
  ver_documentos_propios: "Descargar sus facturas",
  ver_incidencias_propias: "Ver las incidencias de sus pedidos",
  reportar_incidencias_propias: "Reportar un problema con un pedido suyo",
  descargar_etiqueta_same_day: "Descargar la etiqueta de un same-day",
  gestionar_pedidos_propios: "Cancelar o editar sus pedidos",
  // --- Del conductor, en su app ---
  ver_ruta_propia: "Ver su ruta del día",
  confirmar_manifiesto_propio: "Confirmar su manifiesto",
  marcar_evidencias_propias: "Registrar la evidencia de sus entregas",
  ver_liquidacion_propia: "Ver su liquidación",
  recibir_traspaso_propio: "Recibir un traspaso de otro conductor",
  // --- De Rutax, no del courier ---
  administrar_plataforma: "Administrar la plataforma",
};

export interface CambioDeRol {
  /** Lo que deja de poder hacer. Es lo primero que hay que leer. */
  pierde: string[];
  /** Lo que pasa a poder hacer. */
  gana: string[];
  /** Lo que no podía ni va a poder. Cierra la pregunta «¿y esto otro?». */
  sigueSinTener: string[];
}

/**
 * Qué cambia al pasar a alguien de un rol a otro.
 *
 * `sigueSinTener` no es relleno: sin esa tercera lista, quien aprueba el cambio
 * tiene que acordarse de todo lo que el catálogo contiene para saber qué NO
 * está pasando. Con ella, la pantalla responde la pregunta completa.
 */
export function compararRoles(desde: Rol, hacia: Rol): CambioDeRol {
  const antes = new Set(capacidadesDeRol(desde));
  const despues = new Set(capacidadesDeRol(hacia));

  const pierde: string[] = [];
  const gana: string[] = [];
  const sigueSinTener: string[] = [];

  // Se recorre el CATÁLOGO y no los conjuntos: así el orden de las tres listas
  // es siempre el mismo —el del catálogo— y no depende de cómo se escribió la
  // matriz de cada rol.
  for (const c of CAPACIDADES) {
    const tenia = antes.has(c);
    const tendra = despues.has(c);
    if (tenia && !tendra) pierde.push(FRASE_CAPACIDAD[c]);
    else if (!tenia && tendra) gana.push(FRASE_CAPACIDAD[c]);
    else if (!tenia && !tendra) sigueSinTener.push(FRASE_CAPACIDAD[c]);
  }

  return { pierde, gana, sigueSinTener };
}

/**
 * La descripción de un rol, derivada del mapa.
 *
 * Reemplaza las cuatro frases escritas a mano. Toma las capacidades más
 * significativas —las primeras del catálogo que el rol tiene— porque enumerar
 * las veintiuna del dueño no describe nada.
 */
export function describirRol(rol: Rol, cuantas = 3): string {
  const suyas = capacidadesDeRol(rol);
  if (suyas.length === 0) return "Sin acceso a la operación del courier.";
  const primeras = CAPACIDADES.filter((c) => suyas.includes(c)).slice(0, cuantas);
  const frases = primeras.map((c) => FRASE_CAPACIDAD[c].toLowerCase());
  const resto = suyas.length - primeras.length;
  return resto > 0
    ? `${frases.join(", ")}, y ${resto} ${resto === 1 ? "cosa" : "cosas"} más.`
    : `${frases.join(", ")}.`;
}
