"use server";

/**
 * Server Actions — Pantalla F (folios CAF, RF-008 parte 2).
 *
 * Esta pantalla "se decide en tiempo de ejecución según el proveedor elegido"
 * (§1.2): Caso A (proveedor gestiona folios directo con el SII — hoy,
 * `simplefactura`) es de solo-lectura; Caso B (`openfactura` y otros) exige
 * carga manual de archivos `.xml` CAF, cifrados con el mismo mecanismo y
 * "puerto" que el certificado digital (`integraciones/secretos`).
 *
 * Mismas reglas que `onboarding/dte/actions.ts`: cliente de sesión para
 * `courier_config_dte`/`folios_caf` (RLS P1 estricta, sin P2/P3 — interno del
 * tenant), `cifrarSecreto` como única vía de cifrado, auditoría vía
 * `service_role` + `registrarEnBitacora`.
 */

import { createClient } from "@/lib/supabase/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarConfiguracionDte } from "@/modules/identidad/capacidades";
import { cifrarSecreto } from "@/modules/integraciones/secretos";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerProveedorDte } from "../dte/catalogo";
import { proveedorGestionaFolios } from "../estado";
import { TIPOS_DOCUMENTO_DTE } from "./catalogo";

// -----------------------------------------------------------------------------
// Estado para renderizar — incluye qué "caso" aplica (A/B) y, si aplica, el
// listado de folios cargados.
// -----------------------------------------------------------------------------

export interface FolioCaf {
  id: string;
  tipoDocumento: number;
  folioDesde: number;
  folioHasta: number;
  folioActual: number;
  estado: "vigente" | "agotado" | "vencido";
}

export type CasoFolios = "sin_proveedor" | "gestionado_por_proveedor" | "carga_manual";

export interface EstadoFoliosCaf {
  caso: CasoFolios;
  nombreProveedor: string | null;
  folios: FolioCaf[];
}

export async function obtenerEstadoFoliosCaf(): Promise<
  { ok: true; estado: EstadoFoliosCaf } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }

  const supabase = await createClient();
  const [{ data: config, error: errorConfig }, { data: filasFolios, error: errorFolios }] = await Promise.all([
    supabase.from("courier_config_dte").select("proveedor_dte").eq("tenant_id", sesion.usuario.tenantId).maybeSingle(),
    supabase
      .from("folios_caf")
      .select("id, tipo_documento, folio_desde, folio_hasta, folio_actual, estado")
      .eq("tenant_id", sesion.usuario.tenantId)
      .order("tipo_documento", { ascending: true })
      .order("folio_desde", { ascending: true }),
  ]);

  if (errorConfig || errorFolios) {
    return { ok: false, mensaje: "No pudimos cargar tus folios por un problema de nuestro sistema." };
  }

  const proveedorId = (config?.proveedor_dte as string | null) ?? null;
  const folios: FolioCaf[] = (filasFolios ?? []).map((fila) => ({
    id: fila.id as string,
    tipoDocumento: fila.tipo_documento as number,
    folioDesde: Number(fila.folio_desde),
    folioHasta: Number(fila.folio_hasta),
    folioActual: Number(fila.folio_actual),
    estado: fila.estado as FolioCaf["estado"],
  }));

  let caso: CasoFolios;
  if (!proveedorId) {
    caso = "sin_proveedor";
  } else if (proveedorGestionaFolios(proveedorId)) {
    caso = "gestionado_por_proveedor";
  } else {
    caso = "carga_manual";
  }

  return {
    ok: true,
    estado: {
      caso,
      nombreProveedor: proveedorId ? (obtenerProveedorDte(proveedorId)?.nombre ?? proveedorId) : null,
      folios,
    },
  };
}

// -----------------------------------------------------------------------------
// Carga manual de un rango CAF (Caso B) — archivo .xml cifrado igual que el
// certificado (§1.2: "mismo patrón de 'se guardó, no se muestra el contenido'")
// -----------------------------------------------------------------------------

export type AccionFoliosResultado = { ok: true } | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

const TAMANO_MAXIMO_CAF_BYTES = 2 * 1024 * 1024; // 2 MB — generoso para un XML CAF típico

export async function cargarRangoCaf(formData: FormData): Promise<AccionFoliosResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarConfiguracionDte(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para cargar folios — contacta al dueño de la cuenta.",
    };
  }

  const archivo = formData.get("archivo");
  const tipoDocumento = Number(formData.get("tipoDocumento"));
  const folioDesde = Number(formData.get("folioDesde"));
  const folioHasta = Number(formData.get("folioHasta"));

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, tipo: "validacion", mensaje: "Selecciona el archivo CAF (.xml) que descargaste del SII." };
  }
  if (!/\.xml$/i.test(archivo.name)) {
    return { ok: false, tipo: "validacion", mensaje: "El archivo CAF debe tener formato .xml — el que entrega el SII." };
  }
  if (archivo.size > TAMANO_MAXIMO_CAF_BYTES) {
    return { ok: false, tipo: "validacion", mensaje: "El archivo es demasiado grande para ser un CAF válido (máximo 2 MB)." };
  }
  if (!Number.isFinite(tipoDocumento) || !TIPOS_DOCUMENTO_DTE.some((t) => t.codigo === tipoDocumento)) {
    return { ok: false, tipo: "validacion", mensaje: "Elige el tipo de documento de la lista." };
  }
  if (!Number.isFinite(folioDesde) || !Number.isFinite(folioHasta) || folioDesde <= 0 || folioHasta <= 0) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa el rango de folios (números mayores a cero)." };
  }
  if (folioDesde > folioHasta) {
    return {
      ok: false,
      tipo: "validacion",
      mensaje: "El folio inicial no puede ser mayor que el folio final — revisa el rango que indicaste.",
    };
  }

  const supabase = await createClient();

  // Conflicto de solapamiento (mismo espíritu que §1.2 de tarifas: "mensaje
  // explicativo, no un error de base de datos crudo") — se valida aquí porque
  // es información de negocio que el formulario puede explicar mejor que un
  // constraint genérico.
  const { data: existentes } = await supabase
    .from("folios_caf")
    .select("folio_desde, folio_hasta")
    .eq("tenant_id", sesion.usuario.tenantId)
    .eq("tipo_documento", tipoDocumento);

  const seSolapa = (existentes ?? []).some(
    (fila) => folioDesde <= Number(fila.folio_hasta) && folioHasta >= Number(fila.folio_desde),
  );
  if (seSolapa) {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje: `Ya tienes un rango de folios cargado para este tipo de documento que se cruza con ${folioDesde}-${folioHasta}. Revisa el listado antes de cargar uno nuevo.`,
    };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());

  let referencia: string;
  try {
    const cifrado = await cifrarSecreto({
      tenantId: sesion.usuario.tenantId,
      tipoSecreto: "archivo_caf",
      valor: bytes,
      venceEn: null,
      metadata: {
        nombre_archivo: archivo.name,
        tipo_documento: tipoDocumento,
        folio_desde: folioDesde,
        folio_hasta: folioHasta,
      },
    });
    referencia = cifrado.referenciaExternaId;
  } catch {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos cifrar y guardar tu archivo CAF por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  const { error } = await supabase.from("folios_caf").insert({
    tenant_id: sesion.usuario.tenantId,
    tipo_documento: tipoDocumento,
    folio_desde: folioDesde,
    folio_hasta: folioHasta,
    folio_actual: folioDesde,
    archivo_caf_ref: referencia,
    estado: "vigente",
  });

  if (error) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "Ciframos tu archivo CAF pero no pudimos registrarlo por un problema de nuestro sistema. Intenta de nuevo.",
    };
  }

  const cliente = crearClienteServiceRole();
  await registrarEnBitacora(cliente, {
    tenantId: sesion.usuario.tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "folios_caf.rango_cargado",
    entidadTipo: "folios_caf",
    entidadId: null,
    detalle: {
      tipo_documento: tipoDocumento,
      folio_desde: folioDesde,
      folio_hasta: folioHasta,
      nombre_archivo: archivo.name,
    },
  });

  return { ok: true };
}
