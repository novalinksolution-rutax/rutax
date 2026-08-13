/**
 * Pruebas de POST /api/conductor/manifiesto/completar.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * Esta ruta delega TODO el trabajo (lectura + escritura + purga de GPS) en
 * `completarManifiesto` (`src/modules/operacion/manifiestos.ts:395-475`), sin
 * ninguna verificación propia de pertenencia — a diferencia de
 * `manifiesto/iniciar/route.ts`, que sí filtra por `driver_id` en su propia
 * consulta. Por eso estas pruebas NO mockean `completarManifiesto`: lo dejan
 * correr de verdad contra un doble de Supabase, para golpear la línea real
 * que sustituye a RLS.
 *
 * Esa línea es (manifiestos.ts:403-408):
 *
 *   cliente.from("manifiestos").select("*")
 *     .eq("id", manifiestoId)
 *     .eq("tenant_id", tenantId)      // ← aísla por TENANT. Funciona (ver test 1).
 *     .maybeSingle();                 // ← OJO: NO hay .eq("driver_id", driverId) aquí.
 *
 * 🚨 HALLAZGO DE AISLAMIENTO — REAL, VERIFICADO, NO CORREGIDO EN ESTE CAMBIO 🚨
 * ---------------------------------------------------------------------------
 * `completarManifiesto` aísla por `tenant_id` pero JAMÁS compara
 * `manifiesto.driver_id` contra el `driverId` de quien llama. El parámetro
 * `driverId` que SÍ recibe la función (`manifiestos.ts:399`) solo se usa
 * después, para el detalle de bitácora y para `borrarUbicacionAlCerrarRuta`
 * (borra la ubicación del ATACANTE, no la de la víctima — no hay fuga de GPS
 * ajeno por esta vía). Consecuencia: CUALQUIER conductor autenticado y activo
 * del mismo tenant puede terminar ("completado") el manifiesto `en_ruta` de
 * OTRO conductor con solo conocer/adivinar su `manifiestoId` (UUID) — algo
 * que hoy puede ser alcanzable, por ejemplo, si el `manifiestoId` circula por
 * el panel del coordinador o por otra respuesta de API. Compárese con el
 * mismo patrón en `manifiesto/iniciar/route.ts:54-60`, que SÍ agrega
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
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

/**
 * Doble de Supabase que deja correr la lógica REAL de `completarManifiesto`
 * y `borrarUbicacionAlCerrarRuta`. `manifiestoFila: null` simula "la consulta
 * no encontró nada" (id ajeno o tenant ajeno). Cualquier tabla no prevista
 * lanza — así una prueba de rechazo que "avanzara más de la cuenta" se nota
 * de inmediato en vez de pasar en falso.
 */
function crearCliente(opts: { manifiestoFila: Record<string, unknown> | null }) {
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

  function builderUbicacion() {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.delete = vi.fn(self);
    b.eq = vi.fn(self);
    (b as unknown as { then: (resolve: (r: { error: null }) => void) => void }).then = (resolve) => {
      resolve({ error: null });
    };
    return b;
  }

  const from = vi.fn((tabla: string) => {
    if (tabla === "manifiestos") return builderManifiestos();
    if (tabla === "ubicacion_conductor") return builderUbicacion();
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
