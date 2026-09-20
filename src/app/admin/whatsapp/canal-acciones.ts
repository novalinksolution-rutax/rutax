"use server";

/**
 * Server Action — configuración del canal de CONSULTA por WhatsApp
 * (`integraciones.whatsapp_canal_consulta_config`), por courier.
 *
 * Mismo gate que el resto del backstage de WhatsApp: `exigirActorAdmin()`
 * exige rol `admin_total` y MFA verificado en esta sesión — encender el canal
 * para un courier es la misma clase de decisión que agregar un destinatario:
 * queda con el nombre del super-admin que la tomó.
 */

import { revalidatePath } from "next/cache";
import { exigirActorAdmin } from "../sesion-admin";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { guardarConfigCanalConsulta } from "@/modules/conversacion";

const RUTA = "/admin/whatsapp";

type Resultado = { ok: true } | { ok: false; mensaje: string };

export async function accionGuardarConfigCanalConsulta(entrada: {
  tenantId: string;
  canalActivo: boolean;
  topeConsultasHora: number;
  topeIntentosSinMatchHora: number;
  nota: string | null;
}): Promise<Resultado> {
  try {
    const { actorUsuarioId } = await exigirActorAdmin();
    const cliente = crearClienteServiceRole();
    const r = await guardarConfigCanalConsulta(cliente, { ...entrada, actorUsuarioId });
    if (r.ok) revalidatePath(RUTA);
    return r;
  } catch {
    return {
      ok: false,
      mensaje: "Necesitas rol de administración total y la verificación en dos pasos de esta sesión.",
    };
  }
}
