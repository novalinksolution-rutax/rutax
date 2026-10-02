"use server";

/**
 * Server Action — Configuración → Tu empresa (perfil comercial).
 *
 * Escribe `identidad.courier_perfil_comercial` con la SESIÓN del usuario (no
 * service_role): la RLS de la tabla (dueño y administración) es la autorización
 * real y el trigger fija `actualizado_por` a auth.uid(). El gate de capacidad
 * (`gestionar_perfil_empresa`) es la primera barrera, no la única.
 *
 * Insert si no hay fila (tenants antiguos), update si la hay. Nunca upsert: los
 * grants son por columna y el UPDATE no incluye `tenant_id`.
 *
 * Bitácora ANTES de escribir, con autor (regla del proyecto): se prefiere un
 * asiento de un cambio que falló a un cambio sin rastro.
 */

import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { validarPerfilComercial } from "@/lib/ui/perfil-comercial";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { puedeGestionarPerfilEmpresa } from "@/modules/identidad/capacidades";

type Resultado = { ok: true; acuse: string } | { ok: false; mensaje: string };

export async function accionGuardarPerfilComercial(formData: FormData): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarPerfilEmpresa(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para editar los datos de la empresa." };
  }

  const validacion = validarPerfilComercial({
    enviosDiaRango: formData.get("envios_dia_rango"),
    conductoresRango: formData.get("conductores_rango"),
    fuentesPedidos: formData.getAll("fuentes_pedidos"),
    fuenteOtra: formData.get("fuente_otra"),
  });
  if (!validacion.ok) return validacion;
  const { perfil } = validacion;

  const tenantId = sesion.usuario.tenantId;
  const supabase = await createClient();

  try {
    const { data: existente, error: errorLectura } = await supabase
      .schema("identidad")
      .from("courier_perfil_comercial")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (errorLectura) throw new Error(errorLectura.message);

    await registrarEnBitacora(crearClienteServiceRole(), {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.perfil_comercial_guardado",
      entidadTipo: "courier_perfil_comercial",
      entidadId: tenantId,
      detalle: {
        operacion: existente ? "actualizado" : "creado",
        envios_dia_rango: perfil.enviosDiaRango,
        conductores_rango: perfil.conductoresRango,
        fuentes_pedidos: perfil.fuentesPedidos,
        fuente_otra: perfil.fuenteOtra,
      },
    });

    const columnas = {
      envios_dia_rango: perfil.enviosDiaRango,
      conductores_rango: perfil.conductoresRango,
      fuentes_pedidos: perfil.fuentesPedidos,
      fuente_otra: perfil.fuenteOtra,
    };

    if (existente) {
      const { data, error } = await supabase
        .schema("identidad")
        .from("courier_perfil_comercial")
        .update(columnas)
        .eq("tenant_id", tenantId)
        .select("tenant_id");
      if (error) throw new Error(error.message);
      // Una RLS que filtra el UPDATE no da error: da cero filas.
      if (!data || data.length === 0) {
        throw new Error("No tienes permiso para editar los datos de la empresa.");
      }
    } else {
      const { error } = await supabase
        .schema("identidad")
        .from("courier_perfil_comercial")
        .insert({ tenant_id: tenantId, ...columnas });
      if (error) throw new Error(error.message);
    }

    revalidatePath("/configuracion/empresa");
    return { ok: true, acuse: "Listo, quedó guardado." };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.",
    };
  }
}
