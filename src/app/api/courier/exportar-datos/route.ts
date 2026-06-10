/**
 * GET /api/courier/exportar-datos — exporta los datos de negocio del tenant
 * del courier en un archivo JSON descargable (RNF-13, item H-07: protección y
 * portabilidad de datos).
 *
 * Flujo:
 * 1. Requiere sesión activa (401 si no hay).
 * 2. Requiere la capacidad `ver_bitacora_auditoria` (`puedeVerBitacoraAuditoria`
 *    — la tienen los roles `dueno` y `administracion`). 403 si no la tiene.
 * 3. Usando `service_role`, consulta cada tabla de negocio del tenant
 *    SIEMPRE filtrando por `tenant_id` (o `id` para la fila del propio
 *    tenant) — aislamiento multi-tenant impuesto también aquí, no solo en RLS.
 * 4. Cada tabla se consulta de forma independiente (try/catch): si una falla
 *    o no existe, se registra el error en `_errores` y el export continúa con
 *    las demás — un problema puntual no debe bloquear toda la portabilidad.
 * 5. Responde un JSON descargable (`Content-Disposition: attachment`) y
 *    registra la exportación en la bitácora de auditoría con conteos de filas
 *    por tabla (nunca el contenido).
 *
 * EXCLUSIONES DELIBERADAS (no forman parte de la portabilidad de datos):
 * - `identidad.conexiones_seller_ml`: contiene tokens OAuth cifrados de ML.
 * - Certificados digitales / `identidad.secretos_cifrados`: material
 *   criptográfico del courier, fuera de logs/exports por contrato (CLAUDE.md).
 * - Cualquier columna de `tenants` relacionada con certificados o credenciales
 *   de proveedores DTE/pagos — solo se exportan datos comerciales/identidad.
 * - `dinero.documentos_dte.xml_dte_ref` / `pdf_ref`: son paths opacos a
 *   Storage, no el binario; se incluyen como metadato pero no se resuelven a
 *   URLs firmadas (evita filtrar accesos temporales en un export estático).
 */

import { NextRequest, NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerBitacoraAuditoria } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = "America/Santiago";

/** Fecha local en Santiago, formato 'YYYY-MM-DD' (garantizado por 'en-CA'). */
function fechaLocalSantiago(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

/**
 * Tablas/vistas (en `public`, expuestas vía PostgREST) a exportar, junto con
 * la(s) columna(s) de filtro de aislamiento. Cada entrada se consulta de forma
 * independiente — un fallo no debe afectar a las demás.
 *
 * Notas de columnas (ver migraciones 0001/0002/0005/0006):
 * - `tenants`: se filtra por `id` (es la fila del propio tenant), no por
 *   `tenant_id` (no tiene esa columna — es la tabla raíz).
 * - `sellers`/`conductores`/`pedidos`/`manifiestos`/`asignaciones_pedido`/
 *   `incidencias`/`periodos_cobro`/`lineas_cobro`/`liquidaciones`/
 *   `documentos_dte`/`eventos_conciliacion`: todas tienen `tenant_id`.
 */
interface DefinicionTabla {
  /** Clave bajo la que aparece en `datos` y en los conteos de bitácora. */
  clave: string;
  /** Nombre de la vista/tabla en `public`. */
  tabla: string;
  /** Columnas a seleccionar — excluye explícitamente secretos/tokens. */
  columnas: string;
  /** Columna de filtro de aislamiento. */
  columnaFiltro: "tenant_id" | "id";
}

const TABLAS_A_EXPORTAR: DefinicionTabla[] = [
  {
    clave: "tenants",
    tabla: "tenants",
    // Solo datos comerciales/identidad — sin certificados ni credenciales de
    // proveedores DTE/pagos (esas viven en identidad.secretos_cifrados, tabla
    // estructuralmente inalcanzable para authenticated y excluida aquí).
    columnas:
      "id, nombre_fantasia, razon_social, rut, estado, plan_id, zona_horaria, creado_en, actualizado_en",
    columnaFiltro: "id",
  },
  {
    clave: "sellers",
    tabla: "sellers",
    // Datos comerciales del seller — SIN tokens de conexiones_seller_ml
    // (tabla aparte, excluida deliberadamente de este export).
    columnas:
      "id, razon_social, rut, nombre_contacto, email_contacto, estado, creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "conductores",
    tabla: "conductores",
    // Dato personal protegido por Ley 21.431, pero pertenece a la
    // portabilidad del courier (es su nómina de conductores).
    columnas:
      "id, nombre_completo, rut, tipo_relacion, estado, creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "pedidos",
    tabla: "pedidos",
    // Todas las columnas de negocio — sin datos de autenticación (no las hay
    // en esta tabla; driver_id_asignado y seller_id son referencias internas).
    columnas:
      "id, seller_id, tipo_pedido, origen, ml_order_id, ml_shipment_id, estado, estado_ml, " +
      "subestado_ml, ultima_sync_ml_en, driver_id_asignado, destinatario_nombre, " +
      "destinatario_direccion, destinatario_comuna, destinatario_telefono, " +
      "instrucciones_entrega, fecha_compromiso, tarifa_aplicable_id, monto_cobro_clp, " +
      "monto_liquidacion_clp, cobro_generado, liquidacion_generada, notas_internas, " +
      "creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "manifiestos",
    tabla: "manifiestos",
    columnas:
      "id, driver_id, nombre, fecha_operacion, estado, notas, creado_por_usuario_id, " +
      "confirmado_en, completado_en, creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "asignaciones_pedido",
    tabla: "asignaciones_pedido",
    columnas:
      "id, pedido_id, manifiesto_id, driver_id, seller_id, activa, " +
      "asignado_por_usuario_id, asignado_en, desasignado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "incidencias",
    tabla: "incidencias",
    columnas:
      "id, pedido_id, seller_id, tipo, estado, descripcion, notas_resolucion, " +
      "afecta_cobro, afecta_liquidacion, abierta_por_usuario_id, resuelta_por_usuario_id, " +
      "abierta_en, resuelta_en, creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "periodos_cobro",
    tabla: "periodos_cobro",
    columnas:
      "id, seller_id, fecha_inicio, fecha_fin, tipo_periodo, estado, total_lineas, " +
      "monto_total_clp, documento_dte_id, cerrado_en, cerrado_por_usuario_id, " +
      "creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "lineas_cobro",
    tabla: "lineas_cobro",
    columnas:
      "id, seller_id, pedido_id, periodo_cobro_id, tarifa_id, monto_base_clp, " +
      "ajuste_incidencia_clp, monto_final_clp, concepto, tipo_pedido, fecha_entrega, " +
      "incidencia_id, origen_generacion, generado_por_usuario_id, notas, " +
      "creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "liquidaciones",
    tabla: "liquidaciones",
    columnas:
      "id, driver_id, fecha_inicio, fecha_fin, tipo_periodo, estado, total_entregas, " +
      "monto_total_clp, tipo_relacion_conductor, pdf_ref, notas, generado_en, " +
      "generado_por_usuario_id, creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "documentos_dte",
    tabla: "documentos_dte",
    // Metadatos del documento — xml_dte_ref/pdf_ref son paths opacos a Storage
    // (no el binario), se incluyen como referencia pero no se resuelven a URLs.
    columnas:
      "id, seller_id, periodo_cobro_id, tipo_documento, folio, fecha_emision, " +
      "monto_neto_clp, monto_iva_clp, monto_total_clp, xml_dte_ref, pdf_ref, " +
      "proveedor_dte_id_externo, estado_sii, estado_proveedor, error_descripcion, " +
      "dte_referencia_id, emitido_en, creado_en, actualizado_en",
    columnaFiltro: "tenant_id",
  },
  {
    clave: "eventos_conciliacion",
    tabla: "eventos_conciliacion",
    columnas:
      "id, seller_id, periodo_cobro_id, tipo_diferencia, pedido_id, descripcion, " +
      "monto_diferencia_clp, estado, resuelto_por_usuario_id, resuelto_en, " +
      "job_run_id, creado_en",
    columnaFiltro: "tenant_id",
  },
];

interface ResultadoTabla {
  clave: string;
  filas: Record<string, unknown>[] | null;
  error: string | null;
}

/** Consulta una tabla de forma aislada — nunca lanza, siempre resuelve. */
async function consultarTabla(
  cliente: SupabaseClient,
  tenantId: string,
  definicion: DefinicionTabla,
): Promise<ResultadoTabla> {
  try {
    const consulta = cliente
      .from(definicion.tabla)
      .select<string, Record<string, unknown>>(definicion.columnas);
    const { data, error } =
      definicion.columnaFiltro === "id"
        ? await consulta.eq("id", tenantId)
        : await consulta.eq("tenant_id", tenantId);

    if (error) {
      return { clave: definicion.clave, filas: null, error: error.message };
    }

    return { clave: definicion.clave, filas: data ?? [], error: null };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido.";
    return { clave: definicion.clave, filas: null, error: mensaje };
  }
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!sesion.usuario.tenantId) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!puedeVerBitacoraAuditoria(sesion.usuario)) {
    return NextResponse.json(
      { error: "No tienes permiso para exportar los datos del courier." },
      { status: 403 },
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  const resultados = await Promise.allSettled(
    TABLAS_A_EXPORTAR.map((definicion) => consultarTabla(cliente, tenantId, definicion)),
  );

  const datos: Record<string, Record<string, unknown>[]> = {};
  const errores: Record<string, string> = {};
  const conteos: Record<string, number> = {};

  for (let i = 0; i < resultados.length; i++) {
    const definicion = TABLAS_A_EXPORTAR[i];
    const resultado = resultados[i];

    if (resultado.status === "rejected") {
      const mensaje =
        resultado.reason instanceof Error ? resultado.reason.message : "Error desconocido.";
      errores[definicion.clave] = mensaje;
      console.error(
        `Error al exportar datos del courier (tabla ${definicion.clave}, tenant ${tenantId}):`,
        mensaje,
      );
      continue;
    }

    const { clave, filas, error } = resultado.value;
    if (error || filas === null) {
      errores[clave] = error ?? "Error desconocido.";
      console.error(
        `Error al exportar datos del courier (tabla ${clave}, tenant ${tenantId}):`,
        error,
      );
      continue;
    }

    datos[clave] = filas;
    conteos[clave] = filas.length;
  }

  const generadoEn = new Date();
  const cuerpo: Record<string, unknown> = {
    generado_en: generadoEn.toISOString(),
    tenant_id: tenantId,
    datos,
  };

  if (Object.keys(errores).length > 0) {
    cuerpo._errores = errores;
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "identidad.datos_courier_exportados",
    entidadTipo: "tenant",
    entidadId: tenantId,
    detalle: {
      conteos_por_tabla: conteos,
      tablas_con_error: Object.keys(errores),
    },
  });

  const fechaArchivo = fechaLocalSantiago(generadoEn);
  const nombreArchivo = `export-datos-${tenantId}-${fechaArchivo}.json`;

  return new NextResponse(JSON.stringify(cuerpo, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
    },
  });
}
