"use server";

/**
 * Server Action — Configuración → Retiro.
 *
 * UPSERT sobre `identidad.courier_config_retiro` (migración `20260815000004`):
 * cuánto le paga el courier al conductor por CADA visita cerrada a una bodega
 * de seller. Tabla 1:1 con el tenant, SIN política de escritura para
 * `authenticated` — la migración es explícita: "la configura la app con
 * service_role, igual que courier_config_payout". Por eso el UPSERT va con
 * `crearClienteServiceRole()`, nunca con el cliente de sesión.
 *
 * RBAC: `puedeGestionarTarifas` (dueño / administración) y NO una capacidad
 * propia. A diferencia de `gestionar_bodegas` (que decide DÓNDE se retira —
 * un lugar de la calle, sin cifra), este monto es exactamente la misma clase
 * de dato que `identidad.tarifas.monto_conductor_clp`: lo que el courier le
 * paga al conductor por una unidad de trabajo. Ese campo ya vive detrás de
 * `gestionar_tarifas` (ver `configuracion/tarifas/actions.ts`), y `zonas`
 * — configuración operativa-tarifaria, no financiera "dura" — usa el mismo
 * gate por la misma razón. Coherente además con quién puede leer el
 * resultado: `identidad.courier_config_retiro` es `select` solo para
 * `tipo_usuario = 'interno'`, e igual que tarifas, aquí NO se distingue
 * supervisor/coordinador porque directamente no tienen `gestionar_tarifas`.
 *
 * Bitácora: se registra INMEDIATAMENTE después del UPSERT y ANTES de
 * `revalidatePath` — mismo orden que `configuracion/tarifas/actions.ts` (el
 * patrón citado como referencia). El invariante de CLAUDE.md ("bitácora antes
 * que efectos externos") protege la auditoría de un `inngest.send()` o una
 * llamada a integración externa que pueda fallar después — esta acción no
 * tiene ninguno de los dos: es una escritura de configuración pura, y
 * registrar la bitácora ANTES del UPSERT dejaría un asiento fantasma para un
 * cambio que nunca se guardó si el UPSERT fallara.
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

type ResultadoAccion = { ok: true } | { ok: false; mensaje: string };

/**
 * Valida el monto de la visita. Entero, mayor a cero — el CHECK
 * `courier_config_retiro_monto_visita_positivo` lo exige en la base, pero acá
 * se rechaza ANTES de llegar a Postgres para poder explicar el porqué del
 * cero: no es un valor legítimo, es indistinguible de "nadie llenó este
 * campo" (la misma lección de `identidad.tarifas.monto_conductor_clp`, que
 * nació en 0 sin que ningún formulario lo pidiera y liquidó $0 en producción
 * durante meses).
 */
function validarMontoVisita(valor: unknown): { ok: true; monto: number } | { ok: false; mensaje: string } {
  const n = Number(valor);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, mensaje: "Ingresa un monto válido en CLP (solo números enteros)." };
  }
  if (n === 0) {
    return {
      ok: false,
      mensaje:
        "El monto no puede ser $0 — un cero no se distingue de una configuración olvidada. " +
        "Mientras quede en cero, las visitas a bodega de tus conductores no generarían su pago.",
    };
  }
  if (n < 0) {
    return { ok: false, mensaje: "El monto no puede ser negativo." };
  }
  return { ok: true, monto: n };
}

export async function accionGuardarConfigRetiro(formData: FormData): Promise<ResultadoAccion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar la configuración de retiro." };
  }

  const validacion = validarMontoVisita(formData.get("monto_visita_bodega_clp"));
  if (!validacion.ok) return validacion;

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const { error } = await supabase
      .schema("identidad")
      .from("courier_config_retiro")
      .upsert(
        { tenant_id: tenantId, monto_visita_bodega_clp: validacion.monto },
        { onConflict: "tenant_id" },
      );

    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.config_retiro_actualizada",
      entidadTipo: "courier_config_retiro",
      entidadId: tenantId,
      detalle: { monto_visita_bodega_clp: validacion.monto },
    });

    revalidatePath("/configuracion/retiro");
    // La cifra que ven las tarjetas de bodegas depende de este valor (herencia
    // cuando `seller_bodegas.monto_visita_clp` es NULL) — sin este revalidate
    // quedaría mostrando el monto anterior hasta la próxima navegación dura.
    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo guardar la configuración de retiro.",
    };
  }
}
