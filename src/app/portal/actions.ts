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
import {
  obtenerConexionPorSeller,
  obtenerConexionesPorSeller,
  renombrarConexion,
  type EstadoSaludConexionMl,
} from "@/modules/integraciones/ml";

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

// ---------------------------------------------------------------------------
// Modelo 1:N — el seller gestiona hasta MAX_CUENTAS_ML cuentas de Mercado
// Libre (constante única en conectar-ml/compartido.ts).
// ---------------------------------------------------------------------------

/** Una cuenta ML del seller, en la forma que consume el panel (sin jerga ni refs). */
export interface ConexionMlSellerItem {
  id: string;
  alias: string | null;
  mlNickname: string | null;
  mlUserId: string | null;
  estadoSalud: EstadoSaludConexionMl;
  ultimaSyncExitosaEn: string | null;
  desconectadaDesde: string | null;
}

export type ResultadoConexiones =
  | { ok: true; conexiones: ConexionMlSellerItem[] }
  | { ok: false; mensaje: string };

/** Todas las cuentas ML del seller de la sesión (0 a MAX_CUENTAS_ML), para el panel plural. */
export async function obtenerConexionesPropia(): Promise<ResultadoConexiones> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }

  try {
    const conexiones = await obtenerConexionesPorSeller(sesion.usuario.sellerId);
    return {
      ok: true,
      conexiones: conexiones.map((c) => ({
        id: c.id,
        alias: c.alias,
        mlNickname: c.mlNickname,
        mlUserId: c.mlUserId,
        estadoSalud: c.estadoSalud,
        ultimaSyncExitosaEn: c.ultimaSyncExitosaEn ? c.ultimaSyncExitosaEn.toISOString() : null,
        desconectadaDesde: c.desconectadaDesde ? c.desconectadaDesde.toISOString() : null,
      })),
    };
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos cargar tus cuentas de Mercado Libre por un problema de nuestro sistema.",
    };
  }
}

const ALIAS_MAX = 40;

export type ResultadoRenombrar = { ok: true; alias: string | null } | { ok: false; mensaje: string };

/**
 * Renombra (alias) una de las cuentas del seller. El write real va por
 * service_role con verificación de propiedad en el puerto (`renombrarConexion`)
 * — el seller no puede escribir directo en la tabla (RLS + trigger).
 */
export async function renombrarConexionMl(conexionId: string, aliasCrudo: string): Promise<ResultadoRenombrar> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }

  const alias = aliasCrudo.trim();
  if (alias.length > ALIAS_MAX) {
    return { ok: false, mensaje: `El nombre no puede superar los ${ALIAS_MAX} caracteres.` };
  }
  // Alias vacío = quitar el nombre personalizado (vuelve al nombre por defecto).
  const aliasFinal = alias.length === 0 ? null : alias;

  try {
    const ok = await renombrarConexion({
      conexionId,
      sellerId: sesion.usuario.sellerId,
      alias: aliasFinal,
    });
    if (!ok) {
      return { ok: false, mensaje: "No encontramos esa cuenta entre las tuyas." };
    }
    return { ok: true, alias: aliasFinal };
  } catch {
    return { ok: false, mensaje: "No pudimos guardar el nombre por un problema de nuestro sistema." };
  }
}
