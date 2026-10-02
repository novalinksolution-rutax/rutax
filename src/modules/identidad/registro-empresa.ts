/**
 * Registro del courier, paso 2 — «Tu empresa».
 * =============================================================================
 * La persona ya está identificada (Google o código) y todavía no tiene perfil.
 * Acá se crea todo lo que cuelga de ella: el tenant + el dueño, el perfil
 * comercial (las tres preguntas) y la evidencia de aceptación de términos.
 *
 * La Server Action (`src/app/registro/empresa/actions.ts`) es un cascarón: lee
 * sesión y cookie y llama a `registrarEmpresaCourier`, que vive acá para poder
 * probarse con dobles sin levantar Next.
 *
 * -----------------------------------------------------------------------------
 * ATOMICIDAD — NO LA HAY, Y POR ESO EL ORDEN Y LA IDEMPOTENCIA
 * -----------------------------------------------------------------------------
 * Auth y Postgres no comparten transacción, y `provisionarTenantParaAuthUser`
 * son varios INSERT por PostgREST (tenant → perfil → áreas → bitácora). Lo que
 * sí se garantiza:
 *
 *   1. **Nunca queda un tenant sin dueño.** Si falla el perfil o las áreas,
 *      `provisionarTenantParaAuthUser` deshace el tenant (compensación
 *      existente, con prueba propia en `onboarding.test.ts`).
 *   2. **Lo que viene DESPUÉS del tenant es reintentable.** Los asientos de
 *      términos y de perfil comercial y sus escrituras son «si falta, ponlo»:
 *      una segunda llamada con el perfil ya creado NO reprovisiona, solo
 *      completa lo que falte. Así un fallo a mitad (la fila comercial no entró)
 *      se arregla con volver a pulsar «Continuar».
 *   3. **El peor residuo es acotado y visible**: un courier con dueño pero sin
 *      perfil comercial ("sin responder", que Configuración y el backstage ya
 *      tratan como estado válido) o, si cayó la bitácora de `tenant.alta`, sin
 *      ese asiento.
 *
 * -----------------------------------------------------------------------------
 * BITÁCORA ANTES DEL EFECTO
 * -----------------------------------------------------------------------------
 * Cada escritura posterior al tenant va precedida de su asiento, con
 * `actorUsuarioId` = el dueño. La creación del tenant en sí NO puede precederse:
 * `bitacora_auditoria` exige `tenant_id` salvo para `super_admin`
 * (`bitacora_auditoria_tenant_nulo_solo_plataforma`) y el tenant aún no existe.
 * Su asiento es `tenant.alta`, que escribe `provisionarTenantParaAuthUser` con
 * el autor puesto (`actor.tipo = 'usuario'`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "./auditoria";
import { ErrorConflicto } from "./errores";
import { mensajeCorreoOcupado } from "./cuenta-por-email";
import { buscarPerfilPorAuthUserId, provisionarTenantParaAuthUser, type ClienteServicio } from "./onboarding";
import { normalizarYValidarRut } from "./rut";
import { validarPerfilComercial } from "@/lib/ui/perfil-comercial";

/**
 * Ruta del paso 2. Un solo sitio: la usan el callback de Google, la verificación
 * del código, el regreso automático y la propia pantalla.
 */
export const RUTA_REGISTRO_EMPRESA = "/registro/empresa";

// -----------------------------------------------------------------------------
// Validación
// -----------------------------------------------------------------------------

export interface EntradaRegistroEmpresa {
  nombreFantasia: string;
  rut: string;
  /** Solo se usa si la identidad no trae nombre (código por correo). */
  nombreDueno?: string;
  enviosDiaRango: string;
  conductoresRango: string;
  fuentesPedidos: string[];
  fuenteOtra?: string;
}

export type CampoRegistroEmpresa =
  | "nombreFantasia"
  | "rut"
  | "nombreDueno"
  | "enviosDiaRango"
  | "conductoresRango"
  | "fuentesPedidos"
  | "fuenteOtra"
  | "terminos";

export interface DatosRegistroEmpresa {
  nombreFantasia: string;
  /** Normalizado `NNNNNNNN-DV`. */
  rut: string;
  nombreDueno: string;
  enviosDiaRango: string;
  conductoresRango: string;
  fuentesPedidos: string[];
  fuenteOtra: string | null;
}

export type ResultadoValidacionRegistro =
  | { ok: true; datos: DatosRegistroEmpresa }
  | { ok: false; campo: CampoRegistroEmpresa; mensaje: string };

/** Largo mínimo razonable de un nombre de persona. */
const NOMBRE_MIN = 2;
const NOMBRE_MAX = 120;

/**
 * El nombre que ya trae la identidad: `nombre_completo` (lo que escribimos
 * nosotros), o `full_name`/`name` (lo que entrega Google). `null` si no hay.
 */
export function nombreDesdeIdentidad(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  for (const clave of ["nombre_completo", "full_name", "name"]) {
    const valor = metadata[clave];
    if (typeof valor === "string" && valor.trim().length >= NOMBRE_MIN) return valor.trim().slice(0, NOMBRE_MAX);
  }
  return null;
}

/**
 * Re-valida TODO en el servidor: el cliente deshabilita «Continuar», pero eso
 * es comodidad, no control. Devuelve el PRIMER error con su campo, en el orden
 * en que se ven los campos.
 */
export function validarRegistroEmpresa(
  entrada: EntradaRegistroEmpresa,
  nombreIdentidad: string | null,
): ResultadoValidacionRegistro {
  const nombreFantasia = typeof entrada.nombreFantasia === "string" ? entrada.nombreFantasia.trim() : "";
  if (!nombreFantasia) return { ok: false, campo: "nombreFantasia", mensaje: "Obligatorio." };

  const rut = normalizarYValidarRut(typeof entrada.rut === "string" ? entrada.rut : "");
  if (!rut) {
    return { ok: false, campo: "rut", mensaje: "El RUT no es válido. Revisa el dígito verificador." };
  }

  // La identidad manda: si trae nombre, el que llegue del cliente se ignora.
  let nombreDueno = nombreIdentidad;
  if (!nombreDueno) {
    nombreDueno = typeof entrada.nombreDueno === "string" ? entrada.nombreDueno.trim() : "";
    if (nombreDueno.length < NOMBRE_MIN) return { ok: false, campo: "nombreDueno", mensaje: "Obligatorio." };
    nombreDueno = nombreDueno.slice(0, NOMBRE_MAX);
  }

  // Las tres preguntas se validan con el módulo compartido (mismas reglas que
  // los CHECK de la base y que Configuración): acá no se repiten.
  const perfil = validarPerfilComercial({
    enviosDiaRango: entrada.enviosDiaRango,
    conductoresRango: entrada.conductoresRango,
    fuentesPedidos: entrada.fuentesPedidos,
    fuenteOtra: entrada.fuenteOtra,
  });
  if (!perfil.ok) {
    return { ok: false, campo: campoDelPerfilQueFalla(entrada), mensaje: perfil.mensaje };
  }

  return {
    ok: true,
    datos: {
      nombreFantasia,
      rut,
      nombreDueno,
      enviosDiaRango: perfil.perfil.enviosDiaRango,
      conductoresRango: perfil.perfil.conductoresRango,
      fuentesPedidos: perfil.perfil.fuentesPedidos,
      fuenteOtra: perfil.perfil.fuenteOtra,
    },
  };
}

/** Respuestas válidas de relleno: aíslan UNA pregunta para saber cuál es la que falla. */
const RELLENO_VALIDO = {
  enviosDiaRango: "mas_1000",
  conductoresRango: "mas_40",
  fuentesPedidos: ["venta_directa"],
  fuenteOtra: null,
};

/**
 * `validarPerfilComercial` devuelve el mensaje pero no el campo, y el formulario
 * necesita saber a cuál pregunta enfocar. Se valida cada una sola, con las otras
 * dos en un valor que pasa, en el mismo orden en que la función compartida las
 * revisa.
 */
function campoDelPerfilQueFalla(e: EntradaRegistroEmpresa): CampoRegistroEmpresa {
  if (!validarPerfilComercial({ ...RELLENO_VALIDO, enviosDiaRango: e.enviosDiaRango }).ok) {
    return "enviosDiaRango";
  }
  if (!validarPerfilComercial({ ...RELLENO_VALIDO, conductoresRango: e.conductoresRango }).ok) {
    return "conductoresRango";
  }
  if (!validarPerfilComercial({ ...RELLENO_VALIDO, fuentesPedidos: e.fuentesPedidos, fuenteOtra: "x" }).ok) {
    return "fuentesPedidos";
  }
  return "fuenteOtra";
}

// -----------------------------------------------------------------------------
// Registro
// -----------------------------------------------------------------------------

/** Lo que el servidor sabe de lo que la persona vio al aceptar. */
export interface AceptacionTerminos {
  terminosVersion: string;
  privacidadVersion: string;
  /** ISO 8601 del clic. */
  aceptadoEn: string;
  /**
   * De dónde viene: `intencion_registro` = el clic en «Crea tu cuenta» (cookie);
   * `pantalla_empresa` = la intención venció o la cuenta volvió por /login y el
   * aviso se mostró junto a «Continuar» de «Tu empresa».
   */
  via: "intencion_registro" | "pantalla_empresa";
}

export type ResultadoRegistroEmpresa =
  | { ok: true; tenantId: string; yaExistia: boolean }
  | { ok: false; tipo: "validacion"; campo: CampoRegistroEmpresa; mensaje: string }
  | { ok: false; tipo: "correo_ocupado" | "conflicto_rut" | "desconocido"; mensaje: string; causa?: unknown };

const MENSAJE_FALLA_SISTEMA =
  "No pudimos crear tu cuenta por un problema de nuestro sistema. Intenta de nuevo en unos minutos.";

export interface ParametrosRegistroEmpresa {
  authUserId: string;
  /** Correo de la identidad de Auth (nunca el que mande el cliente). */
  email: string;
  nombreIdentidad: string | null;
  entrada: EntradaRegistroEmpresa;
  aceptacion: AceptacionTerminos;
}

export async function registrarEmpresaCourier(
  cliente: ClienteServicio,
  p: ParametrosRegistroEmpresa,
): Promise<ResultadoRegistroEmpresa> {
  const validacion = validarRegistroEmpresa(p.entrada, p.nombreIdentidad);
  if (!validacion.ok) {
    return { ok: false, tipo: "validacion", campo: validacion.campo, mensaje: validacion.mensaje };
  }
  const datos = validacion.datos;

  // --- ¿Ya hay perfil? -------------------------------------------------------
  // Reintento seguro (doble clic, falló algo a mitad) o un correo que ya es otra
  // cosa en Rutax (H2): nunca se crea un segundo perfil encima.
  let perfil;
  try {
    perfil = await buscarPerfilPorAuthUserId(cliente, p.authUserId);
  } catch (causa) {
    return { ok: false, tipo: "desconocido", mensaje: MENSAJE_FALLA_SISTEMA, causa };
  }
  if (perfil && !(perfil.tipoUsuario === "interno" && perfil.rol === "dueno" && perfil.tenantId)) {
    return {
      ok: false,
      tipo: "correo_ocupado",
      mensaje: mensajeCorreoOcupado({ existe: true, tipoEnMiCourier: null }),
    };
  }

  let tenantId: string;
  let yaExistia: boolean;

  if (perfil?.tenantId) {
    tenantId = perfil.tenantId;
    yaExistia = true;
  } else {
    try {
      const creado = await provisionarTenantParaAuthUser(
        cliente,
        p.authUserId,
        {
          tenant: { nombreFantasia: datos.nombreFantasia, rut: datos.rut },
          dueno: { email: p.email, nombreCompleto: datos.nombreDueno },
          // El autor es el propio dueño (RNF-04): `tenant.alta` lleva su id.
          actor: { usuarioId: p.authUserId, tipo: "usuario" },
        },
        { estado: "activo", compensarAuthUser: false },
      );
      tenantId = creado.tenantId;
      yaExistia = false;
    } catch (err) {
      if (err instanceof ErrorConflicto && /rut/i.test(err.message)) {
        return { ok: false, tipo: "conflicto_rut", mensaje: err.message };
      }
      return { ok: false, tipo: "desconocido", mensaje: MENSAJE_FALLA_SISTEMA, causa: err };
    }
  }

  // --- Lo que cuelga del tenant: «si falta, ponlo» ----------------------------
  try {
    await asegurarAceptacionDeTerminos(cliente, tenantId, p.authUserId, p.aceptacion);
    await asegurarPerfilComercial(cliente, tenantId, p.authUserId, datos);
  } catch (causa) {
    return { ok: false, tipo: "desconocido", mensaje: MENSAJE_FALLA_SISTEMA, causa };
  }

  return { ok: true, tenantId, yaExistia };
}

async function asegurarAceptacionDeTerminos(
  cliente: ClienteServicio,
  tenantId: string,
  authUserId: string,
  aceptacion: AceptacionTerminos,
): Promise<void> {
  const { data: actual, error: errorLectura } = await cliente
    .schema("identidad")
    .from("tenants")
    .select("terminos_version")
    .eq("id", tenantId)
    .maybeSingle();
  if (errorLectura) throw new Error(`No se pudo leer la aceptación de términos: ${errorLectura.message}`);
  // Ya hay evidencia (reintento): no se reescribe ni se vuelve a asentar.
  if (actual?.terminos_version) return;

  // Bitácora ANTES de la escritura.
  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId: authUserId,
    actorTipo: "usuario",
    accion: "registro.terminos_aceptados",
    entidadTipo: "tenant",
    entidadId: tenantId,
    detalle: {
      terminos_version: aceptacion.terminosVersion,
      privacidad_version_informada: aceptacion.privacidadVersion,
      aceptado_en: aceptacion.aceptadoEn,
      via: aceptacion.via,
    },
  });

  // `.is(..., null)`: si dos envíos se cruzan, gana el primero y el otro no
  // pisa la evidencia.
  const { error } = await cliente
    .schema("identidad")
    .from("tenants")
    .update({
      terminos_version: aceptacion.terminosVersion,
      terminos_aceptados_en: aceptacion.aceptadoEn,
      terminos_aceptados_por: authUserId,
      privacidad_version_informada: aceptacion.privacidadVersion,
    })
    .eq("id", tenantId)
    .is("terminos_version", null);
  if (error) throw new Error(`No se pudo registrar la aceptación de términos: ${error.message}`);
}

async function asegurarPerfilComercial(
  cliente: ClienteServicio,
  tenantId: string,
  authUserId: string,
  datos: DatosRegistroEmpresa,
): Promise<void> {
  const { data: existente, error: errorLectura } = await cliente
    .schema("identidad")
    .from("courier_perfil_comercial")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (errorLectura) throw new Error(`No se pudo leer el perfil comercial: ${errorLectura.message}`);
  // Ya respondido (reintento): lo que hay manda, no se pisa con un segundo envío.
  if (existente) return;

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId: authUserId,
    actorTipo: "usuario",
    accion: "registro.perfil_comercial_declarado",
    entidadTipo: "courier_perfil_comercial",
    entidadId: tenantId,
    detalle: {
      envios_dia_rango: datos.enviosDiaRango,
      conductores_rango: datos.conductoresRango,
      fuentes_pedidos: datos.fuentesPedidos,
      fuente_otra: datos.fuenteOtra,
    },
  });

  // INSERT puro, nunca upsert: en PostgREST toda columna del payload es también
  // una escritura en el UPDATE, y acá no hay nada que sobrescribir.
  const { error } = await cliente.schema("identidad").from("courier_perfil_comercial").insert({
    tenant_id: tenantId,
    envios_dia_rango: datos.enviosDiaRango,
    conductores_rango: datos.conductoresRango,
    fuentes_pedidos: datos.fuentesPedidos,
    fuente_otra: datos.fuenteOtra,
  });
  if (error) throw new Error(`No se pudo guardar el perfil comercial: ${error.message}`);
}

// -----------------------------------------------------------------------------
// De dónde sale la evidencia de aceptación
// -----------------------------------------------------------------------------

/**
 * Decide qué se asienta como aceptación al crear la empresa.
 *
 *   · Hay intención (cookie del clic en «Crea tu cuenta»): esa, tal cual. Sus
 *     versiones y su instante son los del servidor en ese momento.
 *   · No hay (venció, o la persona volvió por /login con la empresa a medias):
 *     solo vale si la pantalla mostró el aviso junto a «Continuar»
 *     (`avisoVisible`, que el servidor decidió al renderizar y el cliente
 *     devuelve). Entonces el clic de «Continuar» es la aceptación, y las
 *     versiones son las vigentes ahora.
 *   · Ni lo uno ni lo otro: `null`. No se crea una empresa sin poder decir qué
 *     aviso aceptó su dueño.
 */
export function resolverAceptacion(
  intencion: { terminosVersion: string; privacidadVersion: string; aceptadoEn: string } | null,
  avisoVisible: boolean,
  vigente: { terminosVersion: string; privacidadVersion: string; aceptadoEn: string },
): AceptacionTerminos | null {
  if (intencion) return { ...intencion, via: "intencion_registro" };
  if (avisoVisible) return { ...vigente, via: "pantalla_empresa" };
  return null;
}
