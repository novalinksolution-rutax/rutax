"use server";

/**
 * Server Actions — Pantalla O (estado de conexión persistente del seller,
 * §3.2, RF-048).
 *
 * Solo lectura — delega a `obtenerConexionPorSeller` (puerto `integraciones/ml`
 * ya existente) para no duplicar la forma en que se resuelve la fila de
 * conexión. La traducción de `estado_salud` a lenguaje humano vive en el
 * componente de cliente (`panel-conexion-ml.tsx`) — aquí solo se entrega el
 * dato crudo tipado, nunca jerga ni tokens.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { obtenerConexionPorSeller, type EstadoSaludConexionMl } from "@/modules/integraciones/ml";

export interface ConexionMlSeller {
  estadoSalud: EstadoSaludConexionMl;
  ultimaSyncExitosaEn: string | null;
  desconectadaDesde: string | null;
}

export type ResultadoEstadoConexion =
  | { ok: true; conexion: ConexionMlSeller | null }
  | { ok: false; mensaje: string };

export async function obtenerEstadoConexionPropia(): Promise<ResultadoEstadoConexion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }

  try {
    const conexion = await obtenerConexionPorSeller(sesion.usuario.sellerId);
    if (!conexion) {
      return { ok: true, conexion: null };
    }

    return {
      ok: true,
      conexion: {
        estadoSalud: conexion.estadoSalud,
        ultimaSyncExitosaEn: conexion.ultimaSyncExitosaEn ? conexion.ultimaSyncExitosaEn.toISOString() : null,
        desconectadaDesde: conexion.desconectadaDesde ? conexion.desconectadaDesde.toISOString() : null,
      },
    };
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos cargar el estado de tu conexión por un problema de nuestro sistema.",
    };
  }
}
