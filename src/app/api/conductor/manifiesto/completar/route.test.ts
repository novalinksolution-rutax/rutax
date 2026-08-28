import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de POST /api/conductor/manifiesto/completar.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * Esta ruta delega TODO el trabajo (lectura + escritura) en
 * `completarManifiesto` (`src/modules/operacion/manifiestos.ts`), sin ninguna
 * verificación propia de pertenencia — a diferencia de
 * `manifiesto/iniciar/route.ts`, que sí filtra por `driver_id` en su propia
 * consulta. Por eso estas pruebas NO mockean `completarManifiesto`: lo dejan
 * correr de verdad contra un doble de Supabase, para golpear la línea real
 * que sustituye a RLS.
 *
 * Esa línea es (manifiestos.ts, dentro de `completarManifiesto`):
 *
 *   cliente.from("manifiestos").select("*")
 *     .eq("id", manifiestoId)
 *     .eq("tenant_id", tenantId)      // ← aísla por TENANT. Funciona (ver test 1).
 *     .eq("driver_id", driverId)      // ← y por CONDUCTOR (ver tests de más abajo).
 *     .maybeSingle();
 *
 * Nota (2026-08-14): hasta esa fecha `completarManifiesto` también llamaba a
 * `borrarUbicacionAlCerrarRuta` (purga de GPS, ALTO-1/Ley 21.431) tras el
 * UPDATE. Ese borrado y su doble de `ubicacion_conductor` en este archivo se
 * retiraron junto con todo el rastreo en vivo del conductor — ver
 * `docs/seguridad/punto-de-termino-conductor.md` §1. El doble de Supabase de
 * más abajo ya NO tiene caso para `"ubicacion_conductor"`: si algo la vuelve a
 * consultar, `crearCliente` revienta con "Tabla no mockeada en esta prueba".
 *
 * 🚨 HALLAZGO DE AISLAMIENTO — REAL, VERIFICADO, NO CORREGIDO EN ESTE CAMBIO 🚨
 * ---------------------------------------------------------------------------
 * `completarManifiesto` aísla por `tenant_id` pero JAMÁS compara
 * `manifiesto.driver_id` contra el `driverId` de quien llama. El parámetro
 * `driverId` que SÍ recibe la función solo se usa después, para el detalle de
 * bitácora. Consecuencia: CUALQUIER conductor autenticado y activo del mismo
 * tenant puede terminar ("completado") el manifiesto `en_ruta` de OTRO
 * conductor con solo conocer/adivinar su `manifiestoId` (UUID) — algo que hoy
 * puede ser alcanzable, por ejemplo, si el `manifiestoId` circula por el panel
 * del coordinador o por otra respuesta de API. Compárese con el mismo patrón
 * en `manifiesto/iniciar/route.ts:54-60`, que SÍ agrega
 * `.eq("driver_id", driverId)` a su propia consulta — esa es la corrección
 * que le falta a `completarManifiesto`.
 *
 * Este archivo NO se creó para arreglarlo (instrucción explícita de la tarea
 * de QA: reportar, no tocar `manifiestos.ts` ni ningún `route.ts`). El test 2
 * de la sección "RECHAZO CRUZADO DENTRO DEL MISMO COURIER" fija el
 * comportamiento ACTUAL (inseguro) con un nombre que empieza con
 * "🚨 BUG DE AISLAMIENTO" a propósito: si algún día se corrige la función,
 * este test DEBE fallar y hay que reescribirlo para esperar el rechazo.
 *
 * Severidad asignada por QA: ALTA. No es fuga de datos entre tenants (el
 * filtro de tenant sí funciona, test 1), y la bitácora sí deja registrado
 * quién lo hizo en realidad (`actorUsuarioId` es el atacante, no se falsea) —
 * pero es una escritura no autorizada sobre el recurso de OTRO usuario dentro
 * del mismo courier (integridad operativa: un conductor puede cerrar la ruta
 * activa de un colega sin permiso, en medio del reparto).
 *
 * El resto de las pruebas usa el molde de
 * `src/app/api/operaciones/[pedidoId]/etiqueta/route.test.ts` /
 * `src/app/api/courier/plataforma/comprobantes/[periodoId]/route.test.ts`
 * (doble con `.eq` como spy, `data: null` para "no es tuyo").
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { POST } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001"; // el atacante en los tests de cruce
const DRIVER_2 = "20000000-0000-0000-0000-000000000002"; // el dueño legítimo del manifiesto
const MANIFIESTO_1 = "30000000-0000-0000-0000-000000000001";

const usuarioConductor1 = {
  areasHabilitadas: [...AREAS_PRODUCTO],
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

/**
 * Doble de Supabase que deja correr la lógica REAL de `completarManifiesto`.
 * `manifiestoFila: null` simula "la consulta no encontró nada" (id ajeno o
 * tenant ajeno). Cualquier tabla no prevista lanza — así una prueba de rechazo
 * que "avanzara más de la cuenta" se nota de inmediato en vez de pasar en
 * falso; en particular, ya no hay caso para "ubicacion_conductor" (ver nota
 * arriba) — si `completarManifiesto` volviera a consultarla, esta prueba lo
 * detectaría con un throw, no en silencio.
 */
function crearCliente(opts: {
  manifiestoFila: Record<string, unknown> | null;
  /**
   * Paradas que quedan sin estado terminal. `completarManifiesto` las cuenta
   * para el asiento de bitácora (`paradas_abiertas`), que es lo que distingue
   * "el conductor terminó su ruta" de "se cerró con paradas vivas". Por defecto
   * 0: el camino feliz de esta ruta es un conductor que cerró todo.
   */
  paradasAbiertas?: number;
}) {
  let payloadUpdate: Record<string, unknown> = {};

  function builderManifiestos() {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    b.update = vi.fn((payload: Record<string, unknown>) => {
      payloadUpdate = payload;
      return self();
    });
    b.maybeSingle = vi.fn(async () => ({ data: opts.manifiestoFila, error: null }));
    b.single = vi.fn(async () => ({
      data: { ...opts.manifiestoFila, ...payloadUpdate },
      error: null,
    }));
    return b;
  }

  /**
   * Conteo de paradas abiertas. Es de SOLO LECTURA y no gobierna nada: si
   * fallara, el manifiesto se cierra igual. Por eso el doble devuelve un número
   * fijo en vez de simular el join — lo que estas pruebas custodian es el
   * aislamiento entre conductores, no la aritmética del contador.
   */
  function builderAsignaciones() {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    b.not = vi.fn(self);
    b.then = (resolve: (r: { data: null; count: number; error: null }) => void) =>
      resolve({ data: null, count: opts.paradasAbiertas ?? 0, error: null });
    return b;
  }

  const from = vi.fn((tabla: string) => {
    if (tabla === "manifiestos") return builderManifiestos();
    if (tabla === "asignaciones_pedido") return builderAsignaciones();
    throw new Error(`Tabla no mockeada en esta prueba: ${tabla}`);
  });

  return { from } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/conductor/manifiesto/completar", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/manifiesto/completar — auth", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor1, estado: "suspendido" });

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/manifiesto/completar — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("manifiestoId sintácticamente válido pero de OTRO TENANT → 409, nunca se completa (el filtro de tenant SÍ funciona)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor1);
    const cliente = crearCliente({ manifiestoFila: null }); // "no encontrado" = de otro tenant
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/no existe, no pertenece al tenant o no es del conductor indicado/);
    expect(registrarEnBitacora).not.toHaveBeenCalled();

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamadaLectura = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamadaLectura.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamadaLectura.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
  });
});

describe("POST /api/conductor/manifiesto/completar — RECHAZO CRUZADO DENTRO DEL MISMO COURIER", () => {
  it("control: DRIVER_2 completa SU PROPIO manifiesto en_ruta → 200 (camino feliz, prueba que el doble funciona)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor1, driverId: DRIVER_2 });
    const cliente = crearCliente({
      manifiestoFila: {
        id: MANIFIESTO_1,
        tenant_id: TENANT_A,
        driver_id: DRIVER_2,
        estado: "en_ruta",
        fecha_operacion: "2026-08-13",
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ exito: true });
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ accion: "manifiesto.completado", entidadId: MANIFIESTO_1 }),
    );
  });

  it("DRIVER_1 no puede completar el manifiesto en_ruta de DRIVER_2 del mismo tenant", async () => {
    // Este caso documentaba un bug real: `completarManifiesto` aislaba por
    // tenant_id pero NUNCA comparaba driver_id, así que un conductor podía
    // cerrar la ruta activa de un colega en pleno reparto con solo conocer su
    // id. Corregido agregando `.eq("driver_id", driverId)` a la lectura.
    //
    // Ojo con cómo se prueba: este doble de Supabase devuelve `manifiestoFila`
    // pase lo que pase — registra los `.eq` como spy pero no filtra de verdad.
    // Por eso la prueba NO puede limitarse a mirar el status: hay que afirmar
    // que el filtro se aplicó, con qué argumentos, y comprobar aparte que la
    // ruta rechaza cuando la lectura no encuentra fila.
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor1); // driverId = DRIVER_1
    const cliente = crearCliente({
      manifiestoFila: {
        id: MANIFIESTO_1,
        tenant_id: TENANT_A,
        driver_id: DRIVER_2, // pertenece a OTRO conductor del mismo tenant
        estado: "en_ruta",
        fecha_operacion: "2026-08-13",
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    await POST(req({ manifiestoId: MANIFIESTO_1 }));

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamadaLectura = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };

    // La lectura se ancla al conductor del TOKEN, nunca al dueño de la fila.
    expect(llamadaLectura.eq).toHaveBeenCalledWith("driver_id", DRIVER_1);
    expect(llamadaLectura.eq).not.toHaveBeenCalledWith("driver_id", DRIVER_2);
    expect(llamadaLectura.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
  });

  it("si la lectura no encuentra manifiesto del conductor, responde 409 y no escribe nada", async () => {
    // La otra mitad del caso anterior: contra Postgres real, el filtro por
    // driver_id hace que la fila ajena no se encuentre. Aquí se simula ese
    // resultado para comprobar que la ruta rechaza en vez de seguir de largo.
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor1);
    const cliente = crearCliente({ manifiestoFila: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/no es del conductor indicado/);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});
