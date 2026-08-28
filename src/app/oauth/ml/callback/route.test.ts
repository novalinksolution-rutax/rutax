import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas del callback OAuth de Mercado Libre — `GET /oauth/ml/callback`.
 *
 * BUG REAL DE PRODUCCIÓN QUE ORIGINA ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * Un seller que acababa de reconectar su cuenta pulsó "Agregar otra cuenta de
 * Mercado Libre". Como su sesión de ML seguía viva y la app ya estaba
 * autorizada, ML lo devolvió de inmediato con un `code` de LA MISMA cuenta, sin
 * mostrar login ni selector. El puerto resolvió `(seller_id, ml_user_id)`,
 * encontró la fila y actualizó tokens (UPDATE, sin error), y el callback —que
 * clasificaba por el `modo` que el seller había pedido— redirigía con
 * `resultado=exito`. La pantalla decía "Agregaste la cuenta correctamente".
 * No se había agregado ninguna cuenta.
 *
 * No se puede prevenir en la URL de autorización: `/authorization` de ML NO
 * admite `prompt`, `select_account`, `approval_prompt`, `max_age` ni
 * `login_hint` (la lista documentada es `response_type`, `client_id`,
 * `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`), y no hay
 * endpoint de logout documentado. Lo único que ML sí entrega es el `user_id` en
 * la respuesta de `POST /oauth/token` — de ahí sale el `desenlace` del puerto,
 * y por eso la detección es POST-canje.
 *
 * Lo que fijan estas pruebas: el resultado refleja LO QUE PASÓ (`desenlace`),
 * no lo que el seller PIDIÓ (`modo`) — y la clasificación de errores previa
 * (colisión entre couriers, tope, transitorio, sistema) queda intacta y en el
 * mismo orden.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesFalsas = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nombre: string) => {
      const value = cookiesFalsas.get(nombre);
      return value === undefined ? undefined : { name: nombre, value };
    },
  }),
}));

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

// El puerto se dobla entero (no queremos red ni Supabase), incluidas sus clases
// de error: el route hace `instanceof` contra ESTAS, y el test lanza estas
// mismas — misma identidad de clase, porque ambos importan del módulo doblado.
vi.mock("@/modules/integraciones/ml", () => {
  class ErrorTopeCuentasMlAlcanzado extends Error {}
  class ErrorCuentaMlYaConectada extends Error {}
  return {
    intercambiarCodigoPorTokens: vi.fn(),
    ErrorTopeCuentasMlAlcanzado,
    ErrorCuentaMlYaConectada,
  };
});

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  intercambiarCodigoPorTokens,
  ErrorTopeCuentasMlAlcanzado,
  ErrorCuentaMlYaConectada,
} from "@/modules/integraciones/ml";
import type {
  ConexionSellerMl,
  DesenlaceIntercambioMl,
  IntercambiarCodigoResultado,
} from "@/modules/integraciones/ml";
import {
  COOKIE_CONEXION_ML,
  COOKIE_MODO_ML,
  COOKIE_STATE_ML,
  type ModoConexionMl,
} from "@/app/portal/conectar-ml/compartido";
import { GET } from "./route";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SELLER_ID = "22222222-2222-2222-2222-222222222222";
const USUARIO_ID = "33333333-3333-3333-3333-333333333333";
const STATE = "state-anticsrf-abc123";
const ML_USER_ID = "999888777";

/** Sesión de un seller activo — la capacidad RBAC real (`seller`) la concede. */
function sesionSellerActivo() {
  return {
    usuarioId: USUARIO_ID,
    email: "seller@ejemplo.cl",
    nombreCompleto: "Seller de Prueba",
    usuario: {
      tenantId: TENANT_ID,
      tipoUsuario: "seller" as const,
      sellerId: SELLER_ID,
      driverId: null,
      rol: "seller" as const,
      estado: "activo" as const,
      areasHabilitadas: [...AREAS_PRODUCTO],
    },
  };
}

function conexion(overrides: Partial<ConexionSellerMl> = {}): ConexionSellerMl {
  return {
    id: "conexion-1",
    tenantId: TENANT_ID,
    sellerId: SELLER_ID,
    mlUserId: ML_USER_ID,
    desconectadaPorPersona: false,
    tokenExpiraEn: new Date(Date.now() + 6 * 60 * 60_000),
    estadoSalud: "sana",
    ultimaSyncExitosaEn: new Date(),
    desconectadaDesde: null,
    ultimoError: null,
    alias: null,
    mlNickname: "TIENDA_DEMO",
    ...overrides,
  };
}

function resultadoIntercambio(
  desenlace: DesenlaceIntercambioMl,
  overrides: Partial<ConexionSellerMl> = {},
): IntercambiarCodigoResultado {
  return { conexion: conexion(overrides), desenlace };
}

/**
 * Cliente Supabase mínimo para `buscarColisionMlUserId` (la única lectura del
 * route). `colision: true` simula que OTRO seller —de otro courier— ya tiene
 * vinculada esta misma cuenta ML.
 */
function clienteSupabase(opts: { colision?: boolean } = {}) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.schema = vi.fn(self);
  b.from = vi.fn(self);
  b.select = vi.fn(self);
  b.eq = vi.fn(self);
  b.neq = vi.fn(self);
  b.limit = vi.fn(self);
  b.maybeSingle = vi.fn(async () => ({
    data: opts.colision ? { seller_id: "otro-seller" } : null,
    error: null,
  }));
  return b as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function peticionCallback(params: { code?: string; state?: string; error?: string } = {}) {
  const query = new URLSearchParams();
  query.set("code", params.code ?? "code-de-ml");
  query.set("state", params.state ?? STATE);
  if (params.error) query.set("error", params.error);
  return new Request(
    `http://localhost/oauth/ml/callback?${query.toString()}`,
  ) as unknown as import("next/server").NextRequest;
}

/** `?resultado=…&modo=…` de la redirección, que es todo el contrato con la UI. */
function destino(res: Response): { resultado: string | null; modo: string | null; ruta: string } {
  const url = new URL(res.headers.get("location") ?? "");
  return {
    resultado: url.searchParams.get("resultado"),
    modo: url.searchParams.get("modo"),
    ruta: url.pathname,
  };
}

/**
 * `conexionObjetivo`: el id que "Reconectar" deja en su cookie para señalar QUÉ
 * tarjeta se está arreglando. Omitirlo simula los flujos que no lo llevan (alta,
 * conexión inicial) o una reconexión cuya verificación de propiedad falló.
 */
function prepararFlujo(modo: ModoConexionMl, conexionObjetivo?: string) {
  cookiesFalsas.clear();
  cookiesFalsas.set(COOKIE_STATE_ML, STATE);
  cookiesFalsas.set(COOKIE_MODO_ML, modo);
  if (conexionObjetivo) cookiesFalsas.set(COOKIE_CONEXION_ML, conexionObjetivo);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookiesFalsas.clear();
  vi.mocked(obtenerSesionActual).mockResolvedValue(sesionSellerActivo());
  vi.mocked(crearClienteServiceRole).mockReturnValue(clienteSupabase());
  vi.mocked(registrarEnBitacora).mockResolvedValue(undefined as never);
});

describe("callback ML — el resultado refleja lo que PASÓ, no lo que el seller PIDIÓ", () => {
  it("agregar_cuenta + la cuenta YA estaba conectada → cuenta_ya_conectada (el bug de producción)", async () => {
    prepararFlujo("agregar_cuenta");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada"),
    );

    const res = await GET(peticionCallback());

    expect(destino(res)).toEqual({
      resultado: "cuenta_ya_conectada",
      modo: "agregar_cuenta",
      ruta: "/portal/conectar-ml",
    });
  });

  it("agregar_cuenta + cuenta NUEVA → exito en modo agregar_cuenta", async () => {
    prepararFlujo("agregar_cuenta");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("alta_nueva", { id: "conexion-2", mlUserId: "555444333" }),
    );

    const res = await GET(peticionCallback());

    expect(destino(res)).toEqual({
      resultado: "exito",
      modo: "agregar_cuenta",
      ruta: "/portal/conectar-ml",
    });
  });

  it("reconexion + la MISMA cuenta → exito en modo reconexion (sin cambios)", async () => {
    prepararFlujo("reconexion");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada"),
    );

    const res = await GET(peticionCallback());

    expect(destino(res)).toEqual({
      resultado: "exito",
      modo: "reconexion",
      ruta: "/portal/conectar-ml",
    });
  });

  it("reconexion + OTRA cuenta que no tenía fila → reconexion_otra_cuenta_nueva", async () => {
    prepararFlujo("reconexion", "conexion-1");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("alta_nueva", { id: "conexion-3", mlUserId: "111222333" }),
    );

    const res = await GET(peticionCallback());

    // No dice "volviste a autorizar" ni un "¡Listo!" a secas: se sumó una cuenta
    // distinta y la que quería arreglar sigue rota. Las dos cosas hay que decirlas.
    expect(destino(res)).toEqual({
      resultado: "reconexion_otra_cuenta_nueva",
      modo: "reconexion",
      ruta: "/portal/conectar-ml",
    });
  });

  it("reconexion + OTRA cuenta que YA estaba conectada → reconexion_otra_cuenta_existente", async () => {
    // El seller aprieta Reconectar en la tarjeta de `conexion-1`, pero ML lo
    // devuelve con la cuenta de `conexion-2` (la que tenía sesión viva). Se
    // renovó la conexión equivocada; la roja sigue roja.
    prepararFlujo("reconexion", "conexion-1");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada", {
        id: "conexion-2",
        mlUserId: "999888777",
      }),
    );

    const res = await GET(peticionCallback());

    expect(destino(res)).toEqual({
      resultado: "reconexion_otra_cuenta_existente",
      modo: "reconexion",
      ruta: "/portal/conectar-ml",
    });
  });

  it("reconexion + LA MISMA fila objetivo → exito (el caso que sí funcionó)", async () => {
    prepararFlujo("reconexion", "conexion-1");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada", { id: "conexion-1" }),
    );

    const res = await GET(peticionCallback());

    expect(destino(res)).toEqual({
      resultado: "exito",
      modo: "reconexion",
      ruta: "/portal/conectar-ml",
    });
  });

  it("reconexion SIN id objetivo en la cookie → exito, no se inventa un diagnóstico", async () => {
    // Sin el id no hay con qué comparar. Antes que afirmar "reconectaste otra
    // cuenta" sin saberlo, se conserva el desenlace anterior.
    prepararFlujo("reconexion");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada", { id: "conexion-7" }),
    );

    const res = await GET(peticionCallback());

    expect(destino(res)).toEqual({
      resultado: "exito",
      modo: "reconexion",
      ruta: "/portal/conectar-ml",
    });
  });

  it("conexion_inicial → exito en su propio modo, con cualquiera de los dos desenlaces", async () => {
    for (const desenlace of ["alta_nueva", "conexion_existente_actualizada"] as DesenlaceIntercambioMl[]) {
      prepararFlujo("conexion_inicial");
      vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(resultadoIntercambio(desenlace));

      const res = await GET(peticionCallback());

      expect(destino(res)).toEqual({
        resultado: "exito",
        modo: "conexion_inicial",
        ruta: "/portal/conectar-ml",
      });
    }
  });

  it("doble callback con el mismo `code`: el puerto memoriza el desenlace → mismo destino las dos veces", async () => {
    prepararFlujo("agregar_cuenta");

    // Simula la caché de idempotencia del puerto: el `code` es de un solo uso,
    // así que la 2ª pasada devuelve TAL CUAL lo que memorizó la 1ª.
    const memorizado = resultadoIntercambio("conexion_existente_actualizada");
    let canjes = 0;
    vi.mocked(intercambiarCodigoPorTokens).mockImplementation(async () => {
      canjes += 1;
      return memorizado;
    });

    const primera = await GET(peticionCallback({ code: "code-repetido" }));
    prepararFlujo("agregar_cuenta"); // el navegador reenvía la misma petición
    const segunda = await GET(peticionCallback({ code: "code-repetido" }));

    expect(canjes).toBe(2); // el route no cachea: la idempotencia vive en el puerto
    expect(destino(primera)).toEqual(destino(segunda));
    expect(destino(segunda).resultado).toBe("cuenta_ya_conectada");
  });
});

describe("callback ML — la clasificación previa se mantiene intacta y en el mismo orden", () => {
  it("la colisión entre couriers gana sobre la clasificación por desenlace", async () => {
    prepararFlujo("agregar_cuenta");
    vi.mocked(crearClienteServiceRole).mockReturnValue(clienteSupabase({ colision: true }));
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada"),
    );

    const res = await GET(peticionCallback());

    expect(destino(res).resultado).toBe("cuenta_en_otro_courier");
    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
  });

  it("la señal de cuenta colaborador gana sobre la clasificación por desenlace", async () => {
    prepararFlujo("agregar_cuenta");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada", {
        ultimoError: "ML rechazó: la cuenta es de un colaborador",
      }),
    );

    const res = await GET(peticionCallback());

    expect(destino(res).resultado).toBe("cuenta_colaborador");
  });

  it("tope de cuentas → tope_alcanzado", async () => {
    prepararFlujo("agregar_cuenta");
    vi.mocked(intercambiarCodigoPorTokens).mockRejectedValue(new ErrorTopeCuentasMlAlcanzado(SELLER_ID));

    const res = await GET(peticionCallback());

    expect(destino(res).resultado).toBe("tope_alcanzado");
  });

  it("ErrorCuentaMlYaConectada (carrera 23505 sin fila relegible) → cuenta_ya_conectada", async () => {
    prepararFlujo("agregar_cuenta");
    vi.mocked(intercambiarCodigoPorTokens).mockRejectedValue(
      new ErrorCuentaMlYaConectada(SELLER_ID, ML_USER_ID),
    );

    const res = await GET(peticionCallback());

    expect(destino(res).resultado).toBe("cuenta_ya_conectada");
  });

  it("error marcado como reintentable → error_transitorio, sin bitácora de fallo", async () => {
    prepararFlujo("reconexion");
    const transitorio = Object.assign(new Error("ML 503"), { reintentable: true as const });
    vi.mocked(intercambiarCodigoPorTokens).mockRejectedValue(transitorio);

    const res = await GET(peticionCallback());

    expect(destino(res)).toMatchObject({ resultado: "error_transitorio", modo: "reconexion" });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("error no clasificado → error_sistema + bitácora, sin filtrar el mensaje al seller", async () => {
    prepararFlujo("conexion_inicial");
    vi.mocked(intercambiarCodigoPorTokens).mockRejectedValue(new Error("boom interno"));

    const res = await GET(peticionCallback());

    expect(destino(res).resultado).toBe("error_sistema");
    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
    // El detalle técnico queda en bitácora, nunca en la URL que ve el seller.
    expect(res.headers.get("location")).not.toContain("boom");
  });

  it("el seller canceló en ML (o no vino `code`) → cancelado, sin canjear nada", async () => {
    prepararFlujo("agregar_cuenta");

    const res = await GET(peticionCallback({ error: "access_denied" }));

    expect(destino(res).resultado).toBe("cancelado");
    expect(intercambiarCodigoPorTokens).not.toHaveBeenCalled();
  });

  it("`state` que no calza con la cookie → estado_invalido, sin canjear el code", async () => {
    prepararFlujo("agregar_cuenta");

    const res = await GET(peticionCallback({ state: "state-forjado" }));

    expect(destino(res).resultado).toBe("estado_invalido");
    expect(intercambiarCodigoPorTokens).not.toHaveBeenCalled();
  });
});

describe("callback ML — la URL de vuelta nunca lleva secretos", () => {
  it("ningún desenlace filtra el `code`, el `state` ni el ml_user_id a la URL de la pantalla", async () => {
    for (const modo of ["conexion_inicial", "reconexion", "agregar_cuenta"] as ModoConexionMl[]) {
      for (const desenlace of ["alta_nueva", "conexion_existente_actualizada"] as DesenlaceIntercambioMl[]) {
        prepararFlujo(modo);
        vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(resultadoIntercambio(desenlace));

        const res = await GET(peticionCallback({ code: "code-secreto-de-ml" }));
        const location = res.headers.get("location") ?? "";

        expect(location).not.toContain("code-secreto-de-ml");
        expect(location).not.toContain(STATE);
        expect(location).not.toContain(ML_USER_ID);
        // Solo `resultado` y `modo` viajan en la URL.
        expect([...new URL(location).searchParams.keys()].sort()).toEqual(["modo", "resultado"]);
      }
    }
  });
});

describe("callback ML — las cookies del flujo son de un solo uso", () => {
  it("borra también el id de conexión objetivo, no solo `state` y `modo`", async () => {
    // Si sobrevive, el id de una reconexión queda colgando y contamina la
    // evaluación del flujo siguiente (que ya no es sobre esa tarjeta).
    prepararFlujo("reconexion", "conexion-1");
    vi.mocked(intercambiarCodigoPorTokens).mockResolvedValue(
      resultadoIntercambio("conexion_existente_actualizada", { id: "conexion-1" }),
    );

    const res = await GET(peticionCallback());
    const borradas = res.headers.getSetCookie().filter((c) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c));

    for (const cookie of [COOKIE_STATE_ML, COOKIE_MODO_ML, COOKIE_CONEXION_ML]) {
      expect(borradas.some((c) => c.startsWith(`${cookie}=`))).toBe(true);
    }
  });

  it("las borra incluso cuando el flujo termina en error", async () => {
    prepararFlujo("reconexion", "conexion-1");
    vi.mocked(intercambiarCodigoPorTokens).mockRejectedValue(new Error("caída inesperada"));

    const res = await GET(peticionCallback());
    const borradas = res.headers.getSetCookie().filter((c) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c));

    expect(destino(res).resultado).toBe("error_sistema");
    expect(borradas.some((c) => c.startsWith(`${COOKIE_CONEXION_ML}=`))).toBe(true);
  });
});
