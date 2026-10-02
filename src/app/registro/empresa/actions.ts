"use server";

/**
 * Server Action — «Tu empresa» (registro v2, paso 2).
 * =============================================================================
 * Cascarón fino: lee la sesión y la intención de registro, y delega TODO lo que
 * importa en `registrarEmpresaCourier` (`modules/identidad/registro-empresa.ts`),
 * que es lo que prueban las pruebas — validación en el servidor, orden
 * bitácora→efecto, idempotencia y evidencia de términos.
 *
 * El correo, el id y el nombre de la identidad salen de la SESIÓN, nunca de lo
 * que mande el formulario: el cliente no elige quién es el dueño.
 */

import {
  construirIntencionActual,
  leerIntencion,
  limpiarIntencion,
} from "@/lib/identidad/intencion-registro";
import { capturarExcepcion } from "@/lib/observabilidad";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  nombreDesdeIdentidad,
  registrarEmpresaCourier,
  resolverAceptacion,
  type CampoRegistroEmpresa,
} from "@/modules/identidad/registro-empresa";

export interface CompletarRegistroEmpresaEntrada {
  nombreFantasia: string;
  rut: string;
  nombreDueno?: string;
  enviosDiaRango: string;
  conductoresRango: string;
  fuentesPedidos: string[];
  fuenteOtra?: string;
  /** Si la pantalla mostró el aviso de términos junto a «Continuar». */
  avisoVisible: boolean;
}

export type CompletarRegistroEmpresaResultado =
  | { ok: true; destino: string }
  | { ok: false; tipo: "sin_sesion" }
  | { ok: false; tipo: "validacion"; campo: CampoRegistroEmpresa; mensaje: string }
  | { ok: false; tipo: "correo_ocupado" | "conflicto_rut" | "desconocido"; mensaje: string };

export async function completarRegistroEmpresa(
  entrada: CompletarRegistroEmpresaEntrada,
): Promise<CompletarRegistroEmpresaResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, tipo: "sin_sesion" };

  const aceptacion = resolverAceptacion(
    await leerIntencion(),
    entrada.avisoVisible === true,
    construirIntencionActual(),
  );
  if (!aceptacion) {
    return {
      ok: false,
      tipo: "validacion",
      campo: "terminos",
      mensaje: "Recarga la página para continuar.",
    };
  }

  const resultado = await registrarEmpresaCourier(crearClienteServiceRole(), {
    authUserId: user.id,
    email: user.email.trim().toLowerCase(),
    nombreIdentidad: nombreDesdeIdentidad(user.user_metadata),
    entrada,
    aceptacion,
  });

  if (!resultado.ok) {
    if (resultado.tipo === "desconocido") {
      await capturarExcepcion(resultado.causa ?? new Error(resultado.mensaje), {
        origen: "action:registro/completarRegistroEmpresa",
      });
    }
    if (resultado.tipo === "validacion") {
      return { ok: false, tipo: "validacion", campo: resultado.campo, mensaje: resultado.mensaje };
    }
    return { ok: false, tipo: resultado.tipo, mensaje: resultado.mensaje };
  }

  await limpiarIntencion();
  // El JWT tiene que traer ya tenant_id/rol/estado: sin esto, el layout de la
  // puesta en marcha rebota a /login (la sesión se emitió antes del perfil).
  await supabase.auth.refreshSession();

  return { ok: true, destino: "/puesta-en-marcha" };
}
