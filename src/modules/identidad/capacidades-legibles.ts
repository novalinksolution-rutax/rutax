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
import { esRolInterno, ROLES_INTERNOS, type Rol } from "./roles";

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
  gestionar_perfil_empresa: "Editar los datos de la empresa",
  gestionar_bodegas: "Administrar las bodegas",
  sincronizar_conexiones_ml: "Sincronizar las cuentas de Mercado Libre",
  ver_torre_control: "Ver la torre de control",
  ver_reportes_ejecutivos: "Ver los reportes del negocio",
  ver_bitacora_auditoria: "Ver la bitácora y exportar los datos",
  gestionar_suscripcion: "Cambiar el plan de Rutax",
  /* --- Del seller, en su portal ---------------------------------------------
     🔴 **En SEGUNDA persona, y las de arriba no.** No es una inconsistencia.
     Las del equipo interno se leen en dos contextos —«esta persona va a poder…»
     al invitar, y «Puedes…» en Mi perfil—, así que van en infinitivo desnudo,
     que funciona en los dos. Éstas y las del conductor solo se renderizan en
     UN sitio: el «Qué puedes hacer» de su propio perfil (`permisos-por-rol` y
     el diálogo de cambiar rol recorren solo `ROLES_INTERNOS`, y `universoDe`
     impide que un rol interno vea las ajenas). Ahí «Descargar sus facturas»
     bajo el rótulo «Puedes» habla de un tercero que no existe.
     Si alguna vez se muestran a otro, hay que volver a mirarlas. */
  gestionar_conexion_ml_propia: "Conectar tu tienda o tu cuenta de Mercado Libre",
  solicitar_same_day: "Pedir un envío same-day",
  ver_documentos_propios: "Descargar tus facturas",
  ver_incidencias_propias: "Ver las incidencias de tus pedidos",
  reportar_incidencias_propias: "Reportar un problema con un pedido tuyo",
  descargar_etiqueta_same_day: "Descargar la etiqueta de un same-day",
  gestionar_pedidos_propios: "Cancelar o editar tus pedidos",
  // --- Del conductor, en su app (misma nota que arriba) ---
  ver_ruta_propia: "Ver tu ruta del día",
  confirmar_manifiesto_propio: "Confirmar tu manifiesto",
  marcar_evidencias_propias: "Registrar la evidencia de tus entregas",
  ver_liquidacion_propia: "Ver tu liquidación",
  recibir_traspaso_propio: "Recibir un traspaso de otro conductor",
  // --- De Rutax, no del courier ---
  administrar_plataforma: "Administrar la plataforma",
};


// =============================================================================
// El universo contra el que se mide un rol
// =============================================================================

/**
 * 🔴 **Un rol interno NO se mide contra el catálogo entero.**
 *
 * Encontrado el 26-08-2026 al construir la referencia de permisos de Equipo: la
 * pantalla decía que el **dueño** —«control total»— «no puede» hacer 13 cosas.
 * Las trece resultaron ser capacidades **de otros tipos de usuario**: siete del
 * seller (conectar su cuenta de Mercado Libre, descargar sus facturas, pedir un
 * same-day…), cinco del conductor (ver su ruta del día, confirmar su
 * manifiesto…) y una del super-admin de Rutax.
 *
 * No son huecos de su poder: **no son de su rol**. Decirle al dueño que no puede
 * «ver su ruta del día» no es un permiso que le falte, es un error de categoría
 * — y como la lista sale del catálogo, se veía cierta.
 *
 * Así que el lado NEGATIVO —«no puede», «sigue sin tener»— se mide contra la
 * **familia del rol**: para un rol interno, la unión de lo que los cuatro roles
 * internos pueden tener. El lado positivo no cambia: lo que un rol puede es lo
 * que puede.
 *
 * ⚠️ Afectaba a las tres superficies que explican roles —el formulario de
 * invitación, el diálogo de cambiar el rol y la referencia nueva— porque las
 * tres recorren este módulo.
 */
function universoDe(...roles: Rol[]): Capacidad[] {
  const familia = new Set<Rol>();
  for (const rol of roles) {
    if (esRolInterno(rol)) for (const r of ROLES_INTERNOS) familia.add(r);
    // Fuera del equipo interno cada rol es su propia familia: no hay un segundo
    // rol de seller con el que compararlo, así que su «no puede» es vacío — y
    // eso es lo correcto, no un olvido.
    else familia.add(rol);
  }

  const union = new Set<Capacidad>();
  for (const r of familia) for (const c of capacidadesDeRol(r)) union.add(c);

  // Se filtra el CATÁLOGO y no se devuelve el `Set`: así el orden de las listas
  // es siempre el mismo —el del catálogo— y no depende de cómo se escribió la
  // matriz de cada rol.
  return CAPACIDADES.filter((c) => union.has(c));
}

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

  // Se recorre el UNIVERSO de los dos roles —no el catálogo entero— y no los
  // conjuntos: el orden de las tres listas queda siempre el mismo, y
  // `sigueSinTener` no se llena de capacidades de seller y de conductor que
  // ningún rol interno podría tener nunca. Ver `universoDe`.
  for (const c of universoDe(desde, hacia)) {
    const tenia = antes.has(c);
    const tendra = despues.has(c);
    if (tenia && !tendra) pierde.push(FRASE_CAPACIDAD[c]);
    else if (!tenia && tendra) gana.push(FRASE_CAPACIDAD[c]);
    else if (!tenia && !tendra) sigueSinTener.push(FRASE_CAPACIDAD[c]);
  }

  return { pierde, gana, sigueSinTener };
}

export interface CapacidadesDeUnRol {
  /** Lo que va a poder hacer. */
  vaAPoder: string[];
  /** Lo que NO va a poder. Es la mitad que evita el «pensé que sí podía». */
  noVaAPoder: string[];
}

/**
 * Las dos listas de un rol, sin comparación con otro.
 *
 * `compararRoles` responde «qué cambia»; esto responde «qué es». Hace falta al
 * **invitar**, donde no hay rol anterior con el que comparar — y el tablero pide
 * el mismo bloque de capacidades ahí, porque es la única superficie donde el
 * sistema explica los roles.
 *
 * ⚠️ **Sale del catálogo de capacidades, no de un texto a mano.** Es la regla 6
 * del bloque: cuatro frases escritas a mano se desactualizan en cuanto un rol
 * gana una capacidad, y nadie se entera — la pantalla sigue prometiendo lo
 * mismo. Acá, si la matriz cambia, el copy cambia solo.
 */
export function capacidadesLegiblesDeRol(rol: Rol): CapacidadesDeUnRol {
  const suyas = new Set(capacidadesDeRol(rol));
  const vaAPoder: string[] = [];
  const noVaAPoder: string[] = [];
  // El universo de su familia, no el catálogo entero: ver `universoDe`. Sin
  // esto, del dueño se decía que «no puede» ver su ruta del día.
  for (const c of universoDe(rol)) {
    (suyas.has(c) ? vaAPoder : noVaAPoder).push(FRASE_CAPACIDAD[c]);
  }
  return { vaAPoder, noVaAPoder };
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
  // Las frases del catálogo empiezan en mayúscula («Dar de alta gente…») porque
  // ahí son ítems de una lista; acá se encadenan, así que se bajan todas y
  // después se sube la primera.
  const frases = primeras.map((c) => FRASE_CAPACIDAD[c].toLowerCase());
  const resto = suyas.length - primeras.length;
  const cuerpo =
    resto > 0
      ? `${frases.join(", ")}, y ${resto} ${resto === 1 ? "cosa" : "cosas"} más.`
      : `${frases.join(", ")}.`;
  // 🐞 Salía en minúscula: «dar de alta gente y cambiarle el rol, …». Los cinco
  // sitios que la muestran la ponen en su propio párrafo, como frase suelta, así
  // que una frase que empieza en minúscula se lee como un texto cortado.
  return cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1);
}
