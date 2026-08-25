"use server";

/**
 * Server Actions — Destinatarios de WhatsApp, desde el backstage de Rutax.
 *
 * Las tres escrituras exigen `exigirActorAdmin()`, que a su vez exige rol
 * `admin_total` **y MFA verificado en esta sesión**. No es ceremonia: agregar
 * un número es afirmar que una persona consintió que Rutax le escriba, y esa
 * afirmación queda con el nombre del super-admin que la hizo.
 */

import { revalidatePath } from "next/cache";
import { exigirActorAdmin } from "../sesion-admin";
import {
  agregarDestinatario,
  revocarDestinatario,
  eliminarDestinatarioDeRutax,
} from "@/modules/plataforma/whatsapp-destinatarios";

const RUTA = "/admin/whatsapp";

type Resultado = { ok: true } | { ok: false; mensaje: string };

/** Traduce el fallo del gate a un mensaje que se pueda mostrar, sin filtrar detalle. */
async function conActor<T>(fn: (actorUsuarioId: string) => Promise<T>): Promise<T | Resultado> {
  try {
    const { actorUsuarioId } = await exigirActorAdmin();
    return await fn(actorUsuarioId);
  } catch {
    return {
      ok: false,
      mensaje: "Necesitas rol de administración total y la verificación en dos pasos de esta sesión.",
    };
  }
}

export async function accionAgregarDestinatario(entrada: {
  tenantId: string;
  sellerId: string;
  telefono: string;
  etiqueta: string | null;
}): Promise<Resultado> {
  const r = await conActor((actorUsuarioId) => agregarDestinatario({ ...entrada, actorUsuarioId }));
  if ((r as Resultado).ok) revalidatePath(RUTA);
  return r as Resultado;
}

export async function accionRevocarDestinatario(contactoId: string): Promise<Resultado> {
  const r = await conActor((actorUsuarioId) => revocarDestinatario({ contactoId, actorUsuarioId }));
  if ((r as Resultado).ok) revalidatePath(RUTA);
  return r as Resultado;
}

export async function accionEliminarDestinatario(contactoId: string): Promise<Resultado> {
  const r = await conActor((actorUsuarioId) =>
    eliminarDestinatarioDeRutax({ contactoId, actorUsuarioId }),
  );
  if ((r as Resultado).ok) revalidatePath(RUTA);
  return r as Resultado;
}
