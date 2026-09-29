"use server";

/**
 * Server Actions — Pantalla E (configuración DTE: proveedor + certificado +
 * credenciales, RF-007/RF-008 parte 1).
 *
 * Capa delgada de "ruta de servidor": valida forma + capacidad
 * (`puedeGestionarConfiguracionDte`), persiste en `courier_config_dte` con el
 * cliente DE SESIÓN del usuario (RLS ya exige `tenant_id` + `tipo_usuario =
 * 'interno'` — migración 0003 §5) y delega el cifrado de los secretos
 * (certificado, credenciales) al mecanismo central de `integraciones/secretos`
 * — la ÚNICA vía permitida para cifrar (regla §11.2 de arquitectura: "nadie
 * fuera de integraciones... cifra/descifra un secreto por su cuenta"; el
 * módulo `secretos` ES ese puerto para cifrado).
 *
 * Regla de oro de la pantalla (criterio transversal #1): el valor cifrado
 * NUNCA vuelve al cliente — solo metadatos (`vence_en`, `estado_certificacion`,
 * nombre de archivo). La única acción sobre un secreto guardado es
 * reemplazarlo (sobrescribe vía el mismo cifrado, nunca "edita en línea").
 */

import { createClient } from "@/lib/supabase/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarConfiguracionDte } from "@/modules/identidad/capacidades";
import { cifrarSecreto } from "@/modules/integraciones/secretos";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerProveedorDte } from "./catalogo";

// -----------------------------------------------------------------------------
// Tipo de "estado actual" que el cliente necesita para renderizar (§1.2)
// -----------------------------------------------------------------------------

export interface EstadoConfiguracionDte {
  proveedorDte: string | null;
  estadoCertificacion: "pendiente" | "en_proceso" | "activo" | "con_problemas" | null;
  certificadoVenceEn: string | null;
  /** `true` si ya se cargó (NUNCA se expone el valor — solo "existe / no existe"). */
  certificadoCargado: boolean;
  credencialesCargadas: boolean;
}

export async function obtenerEstadoConfiguracionDte(): Promise<
  { ok: true; estado: EstadoConfiguracionDte } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courier_config_dte")
    .select("proveedor_dte, estado_certificacion, certificado_vence_en, certificado_digital_ref, proveedor_credenciales_ref")
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, mensaje: "No pudimos cargar tu configuración DTE por un problema de nuestro sistema." };
  }

  if (!data) {
    return {
      ok: true,
      estado: {
        proveedorDte: null,
        estadoCertificacion: null,
        certificadoVenceEn: null,
        certificadoCargado: false,
        credencialesCargadas: false,
      },
    };
  }

  return {
    ok: true,
    estado: {
      proveedorDte: (data.proveedor_dte as string | null) ?? null,
      estadoCertificacion: (data.estado_certificacion as EstadoConfiguracionDte["estadoCertificacion"]) ?? null,
      certificadoVenceEn: (data.certificado_vence_en as string | null) ?? null,
      certificadoCargado: Boolean(data.certificado_digital_ref),
      credencialesCargadas: Boolean(data.proveedor_credenciales_ref),
    },
  };
}

// -----------------------------------------------------------------------------
// 1. Elegir proveedor — una sola vez (§1.2: "no se puede cambiar libremente")
// -----------------------------------------------------------------------------

export type AccionDteResultado = { ok: true } | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

export async function elegirProveedorDte(proveedorId: string): Promise<AccionDteResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarConfiguracionDte(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para configurar la facturación — contacta al dueño de la cuenta.",
    };
  }

  const proveedor = obtenerProveedorDte(proveedorId);
  if (!proveedor) {
    return { ok: false, tipo: "validacion", mensaje: "Elige un proveedor de la lista." };
  }

  const supabase = await createClient();

  // No se puede cambiar libremente una vez elegido (§1.2) — si ya existe fila
  // con proveedor distinto, es conflicto (debe pasar por soporte).
  const { data: existente } = await supabase
    .from("courier_config_dte")
    .select("proveedor_dte")
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (existente?.proveedor_dte && existente.proveedor_dte !== proveedor.id) {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje: "Ya elegiste un proveedor de facturación. Para cambiarlo, contacta a soporte.",
    };
  }

  const { error } = await supabase
    .from("courier_config_dte")
    .upsert(
      { tenant_id: sesion.usuario.tenantId, proveedor_dte: proveedor.id, estado_certificacion: "pendiente" },
      { onConflict: "tenant_id" },
    );

  if (error) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos guardar tu elección por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  await auditar(sesion.usuario.tenantId, sesion.usuarioId, "courier_config_dte.proveedor_elegido", {
    proveedor_dte: proveedor.id,
  });

  return { ok: true };
}

// -----------------------------------------------------------------------------
// 2. Cargar certificado digital (.pfx/.p12 + contraseña)
// -----------------------------------------------------------------------------

const TAMANO_MAXIMO_CERTIFICADO_BYTES = 5 * 1024 * 1024; // 5 MB — generoso para un .pfx típico

export interface CargarCertificadoEntrada {
  archivo: File;
  contrasenaCertificado: string;
  /** Fecha de vencimiento que el dueño conoce de su certificado (el proveedor la confirmará al validar). */
  venceEn: string;
}

export async function cargarCertificadoDigital(formData: FormData): Promise<AccionDteResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarConfiguracionDte(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para configurar la facturación — contacta al dueño de la cuenta.",
    };
  }

  const archivo = formData.get("archivo");
  const contrasena = String(formData.get("contrasenaCertificado") ?? "");
  const venceEn = String(formData.get("venceEn") ?? "");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, tipo: "validacion", mensaje: "Selecciona el archivo de tu certificado (.pfx o .p12)." };
  }
  if (!/\.(pfx|p12)$/i.test(archivo.name)) {
    return {
      ok: false,
      tipo: "validacion",
      mensaje: "El archivo debe tener formato .pfx o .p12 — el formato que entrega tu certificadora.",
    };
  }
  if (archivo.size > TAMANO_MAXIMO_CERTIFICADO_BYTES) {
    return { ok: false, tipo: "validacion", mensaje: "El archivo es demasiado grande (máximo 5 MB)." };
  }
  if (!contrasena) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa la contraseña de tu certificado digital." };
  }
  if (!venceEn || Number.isNaN(Date.parse(venceEn))) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa la fecha de vencimiento de tu certificado." };
  }

  const supabase = await createClient();
  const { data: config } = await supabase
    .from("courier_config_dte")
    .select("proveedor_dte")
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (!config?.proveedor_dte) {
    return { ok: false, tipo: "validacion", mensaje: "Primero elige tu proveedor de facturación electrónica." };
  }

  const venceEnFecha = new Date(venceEn);
  const bytes = new Uint8Array(await archivo.arrayBuffer());

  let referenciaArchivo: string;
  let referenciaContrasena: string;
  try {
    // Dos secretos distintos (archivo binario + contraseña) — cada uno con su
    // propio tipo, para que la rotación/auditoría no los confunda.
    const cifradoArchivo = await cifrarSecreto({
      tenantId: sesion.usuario.tenantId,
      tipoSecreto: "certificado_digital_courier",
      valor: bytes,
      venceEn: venceEnFecha,
      metadata: { nombre_archivo: archivo.name, proposito: "certificado_digital_archivo" },
    });
    const cifradoContrasena = await cifrarSecreto({
      tenantId: sesion.usuario.tenantId,
      tipoSecreto: "certificado_digital_courier",
      valor: contrasena,
      venceEn: venceEnFecha,
      metadata: { proposito: "certificado_digital_contrasena" },
    });
    referenciaArchivo = cifradoArchivo.referenciaExternaId;
    referenciaContrasena = cifradoContrasena.referenciaExternaId;
  } catch {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos cifrar y guardar tu certificado por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  // courier_config_dte solo guarda UNA referencia opaca de certificado — la
  // contraseña queda referenciada dentro de los metadatos no sensibles del
  // mismo registro lógico (su propia fila en secretos_cifrados, vinculada por
  // convención de nombre — el adaptador DTE real, fuera de esta iteración,
  // las leerá ambas para construir el material de firma).
  const { error } = await supabase
    .from("courier_config_dte")
    .update({
      certificado_digital_ref: referenciaArchivo,
      certificado_vence_en: venceEn,
      estado_certificacion: "en_proceso",
    })
    .eq("tenant_id", sesion.usuario.tenantId);

  if (error) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "Ciframos tu certificado pero no pudimos guardarlo por un problema de nuestro sistema. Intenta de nuevo.",
    };
  }

  await auditar(sesion.usuario.tenantId, sesion.usuarioId, "courier_config_dte.certificado_cargado", {
    nombre_archivo: archivo.name,
    vence_en: venceEn,
    // Referencia de la contraseña cifrada queda en bitácora como dato NO
    // sensible (es un id opaco, no el secreto) — útil para trazabilidad si
    // algún día hay que re-emparejar archivo + contraseña.
    referencia_contrasena: referenciaContrasena,
  });

  return { ok: true };
}

// -----------------------------------------------------------------------------
// 3. Cargar credenciales del proveedor DTE (campos según el proveedor elegido)
// -----------------------------------------------------------------------------

export async function cargarCredencialesProveedor(
  valores: Record<string, string>,
): Promise<AccionDteResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarConfiguracionDte(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para configurar la facturación — contacta al dueño de la cuenta.",
    };
  }

  const supabase = await createClient();
  const { data: config } = await supabase
    .from("courier_config_dte")
    .select("proveedor_dte")
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  const proveedor = config?.proveedor_dte ? obtenerProveedorDte(config.proveedor_dte as string) : null;
  if (!proveedor) {
    return { ok: false, tipo: "validacion", mensaje: "Primero elige tu proveedor de facturación electrónica." };
  }

  for (const campo of proveedor.camposCredenciales) {
    if (!valores[campo.clave]?.trim()) {
      return { ok: false, tipo: "validacion", mensaje: `Completa el campo "${campo.etiqueta}".` };
    }
  }

  let referencia: string;
  try {
    const cifrado = await cifrarSecreto({
      tenantId: sesion.usuario.tenantId,
      tipoSecreto: "credenciales_proveedor_dte",
      // Serializado como JSON — el adaptador DTE real (otra iteración) sabrá
      // deserializar según `proveedor_dte`. Nunca se loguea ni se expone.
      valor: JSON.stringify(valores),
      venceEn: null,
      metadata: { proveedor_dte: proveedor.id, proposito: "credenciales_proveedor_dte" },
    });
    referencia = cifrado.referenciaExternaId;
  } catch {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "El proveedor rechazó estas credenciales o no pudimos cifrarlas. Verifica que sean las que te entregó al contratar el servicio.",
    };
  }

  const { error } = await supabase
    .from("courier_config_dte")
    .update({ proveedor_credenciales_ref: referencia })
    .eq("tenant_id", sesion.usuario.tenantId);

  if (error) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "Guardamos tus credenciales cifradas pero no pudimos asociarlas por un problema de nuestro sistema.",
    };
  }

  await auditar(sesion.usuario.tenantId, sesion.usuarioId, "courier_config_dte.credenciales_cargadas", {
    proveedor_dte: proveedor.id,
    campos: Object.keys(valores),
  });

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Auditoría — vía service_role (bitacora_auditoria es append-only, sin INSERT
// para `authenticated`, igual que documenta `invitaciones.ts`).
// -----------------------------------------------------------------------------

async function auditar(
  tenantId: string,
  actorUsuarioId: string,
  accion: string,
  detalle: Record<string, unknown>,
): Promise<void> {
  const cliente = crearClienteServiceRole();
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion,
    entidadTipo: "courier_config_dte",
    entidadId: tenantId,
    detalle,
  });
}
