/**
 * Tests de `crearSuscripcionInicial` (superficie del courier sobre `plataforma`).
 *
 * Cubre lo pedido en Fase 1 de "completar suscripciones":
 * - Idempotencia: un tenant que YA tiene suscripción no crea una segunda.
 * - Rechazo de plan inactivo/inexistente.
 * - Que fuerza el tenant: el INSERT usa exactamente `opts.tenantId` — la
 *   función no tiene ningún otro canal de entrada para el tenant.
 * - Carrera concurrente (23505 del UNIQUE(tenant_id)): recupera la fila
 *   existente en vez de propagar el error.
 *
 * Mismo patrón de mocks que el resto de `plataforma`/`dinero`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/integraciones/secretos', () => ({
  descifrarSecreto: vi.fn(),
  comoReferenciaSecreto: (id: string) => id,
}));

// `obtenerPuertoSuscripcionRecurrente` se deja SIN mockear a propósito: en el
// entorno de pruebas (sin `SUSCRIPCION_RECURRENTE_SANDBOX_MODE=false`) resuelve
// siempre al `StubSuscripcionRecurrenteAdapter` real — determinista, sin red —
// así se ejercita la integración real con el gate sandbox en vez de un doble.

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/cliente';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { descifrarSecreto } from '@/modules/integraciones/secretos';
import {
  crearSuscripcionInicial,
  iniciarEnrolamientoMandato,
  cancelarMandatoAutoCobro,
  obtenerMiPlan,
  obtenerComprobantePago,
  obtenerEntitlementsTenant,
  cambiarPlanCourier,
  calcularAjustePlan,
} from './superficie-courier';

/**
 * Builder encadenable donde el ÚNICO terminal es `maybeSingle()` — refleja
 * exactamente las tres consultas que hace `crearSuscripcionInicial`
 * (verificar existente, leer plan, insertar) y la eventual cuarta (reintento
 * tras 23505). Cada `maybeSingle()` consume la siguiente respuesta de la cola.
 */
function crearMockSupabase(secuencia: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const siguiente = () => secuencia[i++] ?? { data: null, error: null };
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    insert: vi.fn((payload: unknown) => {
      insertPayloads.push(payload);
      return q;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(siguiente())),
  };
  return q;
}

// Capturado fuera del builder para poder inspeccionarlo tras cada test.
let insertPayloads: unknown[] = [];

describe('crearSuscripcionInicial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertPayloads = [];
  });

  it('idempotencia: si el tenant YA tiene suscripción, la devuelve sin crear una segunda', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: { id: 'susc-existente' }, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    const resultado = await crearSuscripcionInicial({
      tenantId: 'tenant-a',
      planId: 'plan-1',
      actorUsuarioId: 'user-1',
    });

    expect(resultado).toEqual({ ok: true, suscripcionId: 'susc-existente' });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
    expect(insertPayloads).toHaveLength(0);
  });

  it('rechaza un plan inactivo', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: null, error: null }, // sin suscripción existente
        { data: { id: 'plan-1', activo: false }, error: null }, // plan inactivo
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      crearSuscripcionInicial({ tenantId: 'tenant-a', planId: 'plan-1', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no existe o no está disponible/i);

    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('rechaza un plan inexistente', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: null, error: null }, // sin suscripción existente
        { data: null, error: null }, // plan no encontrado
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      crearSuscripcionInicial({ tenantId: 'tenant-a', planId: 'plan-inexistente', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no existe o no está disponible/i);
  });

  it('camino feliz: crea la suscripción en trial con el tenant forzado por el llamador', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: null, error: null }, // sin suscripción existente
        { data: { id: 'plan-1', activo: true }, error: null }, // plan activo
        { data: { id: 'susc-nueva' }, error: null }, // INSERT
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await crearSuscripcionInicial({
      tenantId: 'tenant-a',
      planId: 'plan-1',
      actorUsuarioId: 'user-1',
    });

    expect(resultado).toEqual({ ok: true, suscripcionId: 'susc-nueva' });

    // El INSERT usa EXACTAMENTE el tenant recibido — la función no tiene otro
    // canal de entrada para el tenant (fuerza el claim del llamador).
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0]).toMatchObject({
      tenant_id: 'tenant-a',
      plan_id: 'plan-1',
      estado: 'trial',
    });

    // Bitácora ANTES del efecto (evento Inngest), con autor.
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorUsuarioId: 'user-1',
        actorTipo: 'usuario',
        accion: 'plataforma.suscripcion_autocreada',
        entidadId: 'tenant-a',
        detalle: expect.objectContaining({ plan_id: 'plan-1' }),
      }),
    );

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plataforma/suscripcion.creada',
        id: 'suscripcion-creada-susc-nueva',
        data: expect.objectContaining({
          tenantId: 'tenant-a',
          suscripcionId: 'susc-nueva',
          planId: 'plan-1',
          estado: 'trial',
          origen: 'self_serve',
        }),
      }),
    );
  });

  it('carrera concurrente (23505 del UNIQUE(tenant_id)): recupera la fila existente', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: null, error: null }, // sin suscripción existente (todavía, en este request)
        { data: { id: 'plan-1', activo: true }, error: null }, // plan activo
        { data: null, error: { code: '23505', message: 'duplicate key' } }, // INSERT choca con otro request
        { data: { id: 'susc-de-la-otra-request' }, error: null }, // recuperación tras conflicto
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await crearSuscripcionInicial({
      tenantId: 'tenant-a',
      planId: 'plan-1',
      actorUsuarioId: 'user-1',
    });

    expect(resultado).toEqual({ ok: true, suscripcionId: 'susc-de-la-otra-request' });
    // No se publica un evento de alta — la suscripción "creada" fue la de la
    // otra request, no esta.
    expect(inngest.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// iniciarEnrolamientoMandato / cancelarMandatoAutoCobro (F1-E — auto-cobro)
// =============================================================================

/** Builder que además soporta un `await` directo (sin `.maybeSingle()`) al
 * final de la cadena — necesario para el `update(...).eq(...)` sin `.select()`
 * de las dos funciones de mandato (y de `cambiarPlanCourier`). También incluye
 * `order`/`limit`/`insert` (pass-through) para la consulta del período vigente
 * y el INSERT del período de ajuste de `cambiarPlanCourier`. */
function crearMockSupabaseConThen(secuencia: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const siguiente = () => secuencia[i++] ?? { data: null, error: null };
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(() => q),
    update: vi.fn(() => q),
    insert: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(siguiente())),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(siguiente()).then(resolve, reject),
  };
  return q;
}

describe('iniciarEnrolamientoMandato', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rechaza si el mandato ya está activo', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        { data: { id: 'susc-1', mandato_estado: 'activo' }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      iniciarEnrolamientoMandato({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/ya está activo/i);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it('rechaza si el tenant no tiene suscripción', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([{ data: null, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    await expect(
      iniciarEnrolamientoMandato({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no tiene una suscripción/i);
  });

  it('camino feliz: inicia el enrolamiento vía el stub, deja pendiente + auto_cobro_habilitado', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        { data: { id: 'susc-1', mandato_estado: 'pendiente' }, error: null }, // leer suscripción
        { data: null, error: null }, // update (bare await)
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await iniciarEnrolamientoMandato({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' });

    expect(resultado.ok).toBe(true);
    // El stub sandbox devuelve una URL de enrolamiento determinista y trazable.
    expect(resultado.urlEnrolamiento).toMatch(/sandbox\.fintoc\.local\/enrolar\//);

    // Bitácora ANTES del efecto externo (llamada al proveedor) — RNF-04.
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorUsuarioId: 'user-1',
        actorTipo: 'usuario',
        accion: 'plataforma.auto_cobro_enrolamiento_iniciado',
        entidadId: 'susc-1',
      }),
    );
  });
});

describe('cancelarMandatoAutoCobro', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rechaza si el tenant no tiene suscripción', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([{ data: null, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    await expect(
      cancelarMandatoAutoCobro({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no tiene una suscripción/i);
  });

  it('con mandato_ref: descifra, cancela vía el puerto y limpia los campos (mandato_ref=null)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        {
          data: { id: 'susc-1', mandato_ref: 'ref-uuid-1', mandato_estado: 'activo', auto_cobro_habilitado: true },
          error: null,
        },
        { data: null, error: null }, // update final (bare await)
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    vi.mocked(descifrarSecreto).mockResolvedValue({
      valor: 'pm_test_token',
      tipoSecreto: 'mandato_suscripcion_fintoc',
      venceEn: null,
      metadata: {},
    });

    const resultado = await cancelarMandatoAutoCobro({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' });

    expect(resultado).toEqual({ ok: true });
    expect(descifrarSecreto).toHaveBeenCalledWith('ref-uuid-1');

    // Bitácora ANTES del efecto — "sin borrado silencioso": deja constancia de
    // que existía un mandato antes de anularlo.
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'plataforma.auto_cobro_desactivado',
        actorTipo: 'usuario',
        detalle: expect.objectContaining({ tenia_mandato_ref: true }),
      }),
    );
  });

  it('sin mandato_ref: NO intenta descifrar ni cancelar en el proveedor, igual desactiva', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        { data: { id: 'susc-1', mandato_ref: null, mandato_estado: 'pendiente', auto_cobro_habilitado: true }, error: null },
        { data: null, error: null }, // update final
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cancelarMandatoAutoCobro({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' });

    expect(resultado).toEqual({ ok: true });
    expect(descifrarSecreto).not.toHaveBeenCalled();
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ detalle: expect.objectContaining({ tenia_mandato_ref: false }) }),
    );
  });

  it('si el descifrado falla, NO relanza — igual deja el auto-cobro desactivado en Rutax', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        {
          data: { id: 'susc-1', mandato_ref: 'ref-uuid-roto', mandato_estado: 'activo', auto_cobro_habilitado: true },
          error: null,
        },
        { data: null, error: null }, // update final — SÍ debe llegar a ejecutarse
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    vi.mocked(descifrarSecreto).mockRejectedValue(new Error('no se pudo descifrar'));

    await expect(
      cancelarMandatoAutoCobro({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' }),
    ).resolves.toEqual({ ok: true });
  });
});

// =============================================================================
// AISLAMIENTO ADVERSARIAL (H-1/H-2) — filtrado REAL por tenant_id
// =============================================================================
/**
 * A diferencia de `crearMockSupabase`/`crearMockSupabaseConThen` (una cola de
 * respuestas ciega a los argumentos de `.eq()`), este mock siembra varias filas
 * — de VARIOS tenants a la vez — y aplica cada `.eq()`/`.in()` como un filtro
 * real, igual que PostgREST. Así se puede probar de forma adversarial que
 * `superficie-courier.ts` nunca devuelve (ni actualiza) la fila de OTRO
 * tenant, aunque exista y aunque su `id` sea válido — no solo que "se llamó a
 * `.eq()` con algo".
 */
type FilaFalsa = Record<string, unknown>;
type OperacionRegistrada = { schema: string; tabla: string; op: string; args: unknown[] };

function crearBuilderTablaFiltrado(
  schemaName: string,
  tabla: string,
  filas: FilaFalsa[],
  operaciones: OperacionRegistrada[],
  respuestaInsert?: { data: unknown; error: unknown },
) {
  let resultado = filas;
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    update: vi.fn((payload: Record<string, unknown>) => {
      operaciones.push({ schema: schemaName, tabla, op: 'update', args: [payload] });
      return builder;
    }),
    insert: vi.fn((payload: Record<string, unknown>) => {
      operaciones.push({ schema: schemaName, tabla, op: 'insert', args: [payload] });
      const respuesta = respuestaInsert ?? { data: null, error: null };
      return {
        select: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve(respuesta)) })),
        maybeSingle: vi.fn(() => Promise.resolve(respuesta)),
      };
    }),
    eq: vi.fn((campo: string, valor: unknown) => {
      operaciones.push({ schema: schemaName, tabla, op: 'eq', args: [campo, valor] });
      resultado = resultado.filter((f) => f[campo] === valor);
      return builder;
    }),
    in: vi.fn((campo: string, valores: unknown[]) => {
      operaciones.push({ schema: schemaName, tabla, op: 'in', args: [campo, valores] });
      resultado = resultado.filter((f) => (valores as unknown[]).includes(f[campo]));
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: resultado[0] ?? null, error: null })),
    single: vi.fn(() => Promise.resolve({ data: resultado[0] ?? null, error: null })),
    // Bare `await` (sin `.maybeSingle()`/`.single()`) refleja una consulta de
    // LISTA en supabase-js: resuelve el arreglo filtrado completo, no solo la
    // primera fila (a diferencia de `maybeSingle`). Lo usa
    // `obtenerPeriodosConPago`/`obtenerPeriodosDeSuscripcion` en `consultas.ts`.
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: resultado, error: null }).then(resolve, reject),
  };
  return builder;
}

/**
 * `esquemas.plataforma.suscripciones`, etc. — varias filas, de varios tenants.
 * `respuestasInsert` (opcional): por tabla, qué debe devolver un `.insert(...)`
 * subsiguiente — necesario para `crearSuscripcionInicial`, que no hace
 * `maybeSingle()` de lectura antes del alta.
 */
function crearMockSupabaseFiltrado(
  esquemas: Record<string, Record<string, FilaFalsa[]>>,
  respuestasInsert: Record<string, { data: unknown; error: unknown }> = {},
) {
  const operaciones: OperacionRegistrada[] = [];
  const cliente = {
    schema: vi.fn((schemaName: string) => ({
      from: vi.fn((tabla: string) =>
        crearBuilderTablaFiltrado(
          schemaName,
          tabla,
          esquemas[schemaName]?.[tabla] ?? [],
          operaciones,
          respuestasInsert[tabla],
        ),
      ),
    })),
  };
  return { cliente, operaciones };
}

const PLAN_STARTER = {
  id: 'plan-starter',
  nombre: 'Starter',
  descripcion: null,
  precio_mensual_clp: 19990,
  precio_anual_clp: 199900,
  limite_pedidos_mes: 500,
  caracteristicas: {},
  activo: true,
};

function suscripcionFila(overrides: FilaFalsa = {}): FilaFalsa {
  return {
    id: 'susc-tenant-a',
    tenant_id: 'tenant-a',
    plan_id: 'plan-starter',
    estado: 'activa',
    trial_hasta: null,
    activa_desde: '2026-01-01',
    cancelada_en: null,
    // Campos NUNCA expuestos al courier (H-1/H-2) — deliberadamente con
    // valores "delatores" para que un leak sea imposible de pasar por alto.
    notas: 'NOTA-INTERNA-SUPERADMIN-JAMAS-EXPONER',
    periodicidad: 'mensual',
    auto_cobro_habilitado: false,
    mandato_estado: 'sin_mandato',
    mandato_ref: 'MANDATO-REF-OPACO-JAMAS-EXPONER',
    plan_anterior_id: null,
    cambio_efectivo_desde: null,
    creada_en: '2026-01-01T00:00:00.000Z',
    actualizado_en: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('obtenerMiPlan — aislamiento adversarial + fuga de datos (H-1/H-2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('con suscripciones/períodos/pagos de DOS tenants sembrados a la vez, tenant-a NUNCA ve nada de tenant-b', async () => {
    // Orden deliberado: la fila de tenant-b va PRIMERO en cada tabla. Si el
    // filtro por `tenant_id` fallara (p. ej. un `.eq()` olvidado), `maybeSingle()`
    // devolvería esta primera fila — la de OTRO tenant — y el test lo detectaría
    // (no pasaría "por casualidad" solo por el orden de inserción).
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [
          suscripcionFila({ id: 'susc-tenant-b', tenant_id: 'tenant-b', notas: 'nota-de-tenant-b' }),
          suscripcionFila({ id: 'susc-tenant-a', tenant_id: 'tenant-a' }),
        ],
        planes: [PLAN_STARTER],
        periodos_suscripcion: [
          {
            id: 'periodo-tenant-b',
            suscripcion_id: 'susc-tenant-b',
            tenant_id: 'tenant-b',
            periodo_inicio: '2026-07-01',
            periodo_fin: '2026-07-31',
            monto_clp: 99990,
            estado: 'pagado',
            vence_en: null,
            generado_en: '2026-07-01T00:00:00.000Z',
          },
          {
            id: 'periodo-tenant-a',
            suscripcion_id: 'susc-tenant-a',
            tenant_id: 'tenant-a',
            periodo_inicio: '2026-07-01',
            periodo_fin: '2026-07-31',
            monto_clp: 19990,
            estado: 'pagado',
            vence_en: null,
            generado_en: '2026-07-01T00:00:00.000Z',
          },
        ],
        pagos_plataforma: [
          {
            periodo_id: 'periodo-tenant-b',
            estado: 'confirmado',
            metodo: 'fintoc_link',
            link_pago_url: 'https://fintoc.example/link/tenant-b-SECRETO',
            pago_externo_id: 'pago-externo-tenant-b-SECRETO',
            pagado_en: '2026-07-05T00:00:00.000Z',
            registrado_en: '2026-07-01T00:00:00.000Z',
          },
          {
            periodo_id: 'periodo-tenant-a',
            estado: 'confirmado',
            metodo: 'fintoc_link',
            link_pago_url: 'https://fintoc.example/link/tenant-a-SECRETO',
            pago_externo_id: 'pago-externo-tenant-a-SECRETO',
            pagado_en: '2026-07-05T00:00:00.000Z',
            registrado_en: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
      identidad: {
        tenants: [
          { id: 'tenant-b', nombre_fantasia: 'Courier Dos' },
          { id: 'tenant-a', nombre_fantasia: 'Courier Uno' },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerMiPlan('tenant-a');

    expect(resultado).not.toBeNull();
    expect(resultado!.suscripcionId).toBe('susc-tenant-a');
    expect(resultado!.periodoActual?.id).toBe('periodo-tenant-a');
    expect(resultado!.historialPagos).toHaveLength(1);
    expect(resultado!.historialPagos[0]!.periodoId).toBe('periodo-tenant-a');

    // Nada de lo devuelto contiene rastro alguno del OTRO tenant.
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain('tenant-b');
    expect(serializado).not.toContain('periodo-tenant-b');
    expect(serializado).not.toContain('nota-de-tenant-b');
  });

  it('fuga de datos (H-1/H-2): NUNCA expone notas, mandato_ref, link_pago_url ni pago_externo_id, aunque la fila cruda los traiga', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [suscripcionFila()],
        planes: [PLAN_STARTER],
        periodos_suscripcion: [
          {
            id: 'periodo-1',
            suscripcion_id: 'susc-tenant-a',
            tenant_id: 'tenant-a',
            periodo_inicio: '2026-07-01',
            periodo_fin: '2026-07-31',
            monto_clp: 19990,
            estado: 'pagado',
            vence_en: null,
            generado_en: '2026-07-01T00:00:00.000Z',
          },
        ],
        pagos_plataforma: [
          {
            periodo_id: 'periodo-1',
            estado: 'confirmado',
            metodo: 'fintoc_link',
            link_pago_url: 'https://fintoc.example/link/JAMAS-EXPONER',
            pago_externo_id: 'pago-externo-JAMAS-EXPONER',
            pagado_en: '2026-07-05T00:00:00.000Z',
            registrado_en: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
      identidad: { tenants: [{ id: 'tenant-a', nombre_fantasia: 'Courier Uno' }] },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerMiPlan('tenant-a');

    expect(resultado).not.toBeNull();
    // Ni como propiedad del DTO ni como valor colado en cualquier campo string.
    expect(resultado).not.toHaveProperty('notas');
    expect(resultado).not.toHaveProperty('mandatoRef');
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain('JAMAS-EXPONER');
    expect(serializado).not.toContain('NOTA-INTERNA-SUPERADMIN');
    expect(serializado).not.toContain('MANDATO-REF-OPACO');
    expect(serializado).not.toContain('link_pago_url');
    expect(serializado).not.toContain('pago_externo_id');
  });
});

describe('obtenerComprobantePago — aislamiento adversarial (caso explícito del prompt)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('un periodoId VÁLIDO pero de OTRO tenant → null (nunca se filtra solo por id)', async () => {
    // A propósito, el período de tenant-b SÍ tiene un pago confirmado
    // (`pagos_plataforma` no está vacía): si el filtro de tenant a nivel de
    // PERÍODO fallara, la función seguiría de largo y armaría un comprobante
    // con estos datos — el test lo detectaría. Un `pagos_plataforma` vacío
    // habría hecho que el `null` esperado pasara "por casualidad" (por falta
    // de pago) incluso con el filtro de período roto.
    const { cliente, operaciones } = crearMockSupabaseFiltrado({
      plataforma: {
        periodos_suscripcion: [
          {
            id: 'periodo-de-tenant-b',
            tenant_id: 'tenant-b',
            periodo_inicio: '2026-07-01',
            periodo_fin: '2026-07-31',
            monto_clp: 99990,
          },
        ],
        pagos_plataforma: [
          {
            periodo_id: 'periodo-de-tenant-b',
            tenant_id: 'tenant-b',
            estado: 'confirmado',
            metodo: 'fintoc_link',
            monto_clp: 99990,
            pagado_en: '2026-07-05T00:00:00.000Z',
          },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerComprobantePago({ tenantId: 'tenant-a', periodoId: 'periodo-de-tenant-b' });

    expect(resultado).toBeNull();
    // Confirma que el filtro de tenant SÍ se aplicó (no solo el de id).
    expect(operaciones).toContainEqual({
      schema: 'plataforma',
      tabla: 'periodos_suscripcion',
      op: 'eq',
      args: ['tenant_id', 'tenant-a'],
    });
  });

  it('período del tenant correcto, pero el ÚNICO pago confirmado tiene tenant_id de OTRO tenant (defensa en profundidad) → null', async () => {
    // Escenario adversarial de inconsistencia de datos: el período es de
    // tenant-a, pero por error/corrupción la fila de pago quedó con
    // tenant_id de tenant-b. `obtenerComprobantePago` filtra pagos_plataforma
    // TAMBIÉN por `tenant_id` (no solo por `periodo_id`) — no debe devolver
    // un comprobante armado con datos de otro tenant.
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        periodos_suscripcion: [
          {
            id: 'periodo-1',
            tenant_id: 'tenant-a',
            periodo_inicio: '2026-07-01',
            periodo_fin: '2026-07-31',
            monto_clp: 19990,
          },
        ],
        pagos_plataforma: [
          {
            periodo_id: 'periodo-1',
            tenant_id: 'tenant-b',
            estado: 'confirmado',
            metodo: 'fintoc_link',
            monto_clp: 19990,
            pagado_en: '2026-07-05T00:00:00.000Z',
          },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerComprobantePago({ tenantId: 'tenant-a', periodoId: 'periodo-1' });

    expect(resultado).toBeNull();
  });

  it('camino feliz: período y pago del MISMO tenant → arma el comprobante, sin exponer pago_externo_id/link_pago_url', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [suscripcionFila()],
        periodos_suscripcion: [
          {
            id: 'periodo-1',
            tenant_id: 'tenant-a',
            periodo_inicio: '2026-07-01',
            periodo_fin: '2026-07-31',
            monto_clp: 19990,
          },
        ],
        pagos_plataforma: [
          {
            periodo_id: 'periodo-1',
            tenant_id: 'tenant-a',
            estado: 'confirmado',
            metodo: 'fintoc_link',
            monto_clp: 19990,
            pago_externo_id: 'pago-externo-JAMAS-EXPONER',
            link_pago_url: 'https://fintoc.example/JAMAS-EXPONER',
            pagado_en: '2026-07-05T00:00:00.000Z',
          },
        ],
        planes: [PLAN_STARTER],
      },
      identidad: { tenants: [{ id: 'tenant-a', nombre_fantasia: 'Courier Uno' }] },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await obtenerComprobantePago({ tenantId: 'tenant-a', periodoId: 'periodo-1' });

    expect(resultado).not.toBeNull();
    expect(resultado!.periodoId).toBe('periodo-1');
    expect(resultado!.montoClp).toBe(19990);
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain('JAMAS-EXPONER');
  });
});

describe('iniciarEnrolamientoMandato / cancelarMandatoAutoCobro — aislamiento adversarial', () => {
  beforeEach(() => vi.clearAllMocks());

  it('con DOS tenants sembrados (el otro con mandato YA activo), opera sobre la fila del tenant correcto, no la ajena', async () => {
    const { cliente, operaciones } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [
          suscripcionFila({ id: 'susc-tenant-a', tenant_id: 'tenant-a', mandato_estado: 'pendiente' }),
          // tenant-b YA tiene el mandato activo — si el filtro de tenant
          // fallara y se leyera esta fila por error, la función rechazaría
          // con "ya está activo" incorrectamente para tenant-a.
          suscripcionFila({ id: 'susc-tenant-b', tenant_id: 'tenant-b', mandato_estado: 'activo' }),
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await iniciarEnrolamientoMandato({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' });

    expect(resultado.ok).toBe(true);
    // El UPDATE final debe haber apuntado a la suscripción de tenant-a.
    const eqDeUpdate = operaciones.filter((o) => o.op === 'eq' && o.args[0] === 'id');
    expect(eqDeUpdate.some((o) => o.args[1] === 'susc-tenant-a')).toBe(true);
    expect(eqDeUpdate.some((o) => o.args[1] === 'susc-tenant-b')).toBe(false);
  });

  it('cancelarMandatoAutoCobro: con DOS tenants sembrados, el UPDATE de cancelación nunca toca la fila del otro tenant', async () => {
    const { cliente, operaciones } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [
          suscripcionFila({
            id: 'susc-tenant-a',
            tenant_id: 'tenant-a',
            mandato_estado: 'activo',
            mandato_ref: null,
            auto_cobro_habilitado: true,
          }),
          suscripcionFila({
            id: 'susc-tenant-b',
            tenant_id: 'tenant-b',
            mandato_estado: 'activo',
            mandato_ref: null,
            auto_cobro_habilitado: true,
          }),
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await cancelarMandatoAutoCobro({ tenantId: 'tenant-a', actorUsuarioId: 'user-1' });

    expect(resultado).toEqual({ ok: true });
    const eqDeUpdate = operaciones.filter((o) => o.op === 'eq' && o.args[0] === 'id');
    expect(eqDeUpdate.some((o) => o.args[1] === 'susc-tenant-a')).toBe(true);
    expect(eqDeUpdate.some((o) => o.args[1] === 'susc-tenant-b')).toBe(false);
  });
});

describe('crearSuscripcionInicial — aislamiento adversarial', () => {
  beforeEach(() => vi.clearAllMocks());

  it('con una suscripción YA existente para OTRO tenant, tenant-a igual da de alta la SUYA (nunca reutiliza la ajena)', async () => {
    const { cliente, operaciones } = crearMockSupabaseFiltrado(
      {
        plataforma: {
          suscripciones: [suscripcionFila({ id: 'susc-tenant-b', tenant_id: 'tenant-b' })],
          planes: [PLAN_STARTER],
        },
      },
      { suscripciones: { data: { id: 'susc-tenant-a-nueva' }, error: null } },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await crearSuscripcionInicial({
      tenantId: 'tenant-a',
      planId: 'plan-starter',
      actorUsuarioId: 'user-1',
    });

    // No reutilizó la suscripción de tenant-b (el check de "existente" filtró
    // por tenant_id='tenant-a' y no encontró nada) — dio de alta una NUEVA.
    expect(resultado).toEqual({ ok: true, suscripcionId: 'susc-tenant-a-nueva' });
    const insertOp = operaciones.find((o) => o.op === 'insert');
    expect(insertOp?.args[0]).toMatchObject({ tenant_id: 'tenant-a' });
  });
});

// =============================================================================
// obtenerEntitlementsTenant — merge de caracteristicas_override (gap 6, F2)
// =============================================================================

describe('obtenerEntitlementsTenant — merge de caracteristicas_override sobre plan.caracteristicas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin override (default {}): expone exactamente lo que trae el plan (comportamiento previo intacto)', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [suscripcionFila({ caracteristicas_override: {} })],
        planes: [
          { ...PLAN_STARTER, caracteristicas: { conductores_max: 5, api_publica: false, webhooks: false } },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const entitlements = await obtenerEntitlementsTenant('tenant-a');

    expect(entitlements).toEqual({
      limitePedidosMes: 500,
      conductoresMax: 5,
      apiPublica: false,
      webhooks: false,
      estadoSuscripcion: 'activa',
    });
  });

  it('con override: gana la llave del override (conductores_max, api_publica); lo ausente queda con el valor del plan', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [
          suscripcionFila({ caracteristicas_override: { conductores_max: 10, api_publica: true } }),
        ],
        planes: [
          { ...PLAN_STARTER, caracteristicas: { conductores_max: 5, api_publica: false, webhooks: false } },
        ],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const entitlements = await obtenerEntitlementsTenant('tenant-a');

    expect(entitlements.conductoresMax).toBe(10); // override gana
    expect(entitlements.apiPublica).toBe(true); // override gana
    expect(entitlements.webhooks).toBe(false); // ausente en el override → queda el del plan
  });

  it('override de limite_pedidos_mes pisa la columna del plan (no vive en `caracteristicas`)', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [suscripcionFila({ caracteristicas_override: { limite_pedidos_mes: 2000 } })],
        planes: [PLAN_STARTER], // limite_pedidos_mes: 500 en la columna del plan
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const entitlements = await obtenerEntitlementsTenant('tenant-a');
    expect(entitlements.limitePedidosMes).toBe(2000);
  });

  it('override explícito limite_pedidos_mes:null → sin límite (distingue "presente con null" de "ausente")', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [suscripcionFila({ caracteristicas_override: { limite_pedidos_mes: null } })],
        planes: [PLAN_STARTER],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const entitlements = await obtenerEntitlementsTenant('tenant-a');
    expect(entitlements.limitePedidosMes).toBeNull();
  });

  it('sin override (llave ausente por completo en la fila): sigue usando el valor del plan (retrocompat total)', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [suscripcionFila({ caracteristicas_override: undefined })],
        planes: [{ ...PLAN_STARTER, caracteristicas: { conductores_max: 8 } }],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const entitlements = await obtenerEntitlementsTenant('tenant-a');
    expect(entitlements.conductoresMax).toBe(8);
    expect(entitlements.limitePedidosMes).toBe(500);
  });

  it('tenant sin suscripción: fail-open sin cambios (límites nulos/permisivos)', async () => {
    const { cliente } = crearMockSupabaseFiltrado({ plataforma: { suscripciones: [] } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const entitlements = await obtenerEntitlementsTenant('tenant-sin-susc');
    expect(entitlements).toEqual({
      limitePedidosMes: null,
      conductoresMax: null,
      apiPublica: false,
      webhooks: false,
      estadoSuscripcion: null,
    });
  });
});

// =============================================================================
// calcularAjustePlan — lógica PURA de proración (F2, item I)
// =============================================================================

describe('calcularAjustePlan', () => {
  const CICLO = { periodoInicio: '2026-07-01', periodoFin: '2026-07-31' }; // 31 días

  it('upgrade a mitad de ciclo: prorratea por días restantes (redondeo estándar)', () => {
    // delta=30000, diasDelPeriodo=31, hoy=2026-07-15 → diasRestantes = 17
    // (15,16,...,31 inclusive = 17 días). monto = round(30000*17/31) = 16452.
    const r = calcularAjustePlan({
      precioActualClp: 19990,
      precioNuevoClp: 49990,
      hoy: '2026-07-15',
      ...CICLO,
    });
    expect(r.tipo).toBe('upgrade');
    expect(r.deltaPrecio).toBe(30000);
    expect(r.montoAjuste).toBe(16452);
  });

  it('upgrade el primer día del ciclo: cobra el delta completo (diasRestantes = diasDelPeriodo)', () => {
    const r = calcularAjustePlan({
      precioActualClp: 19990,
      precioNuevoClp: 49990,
      hoy: '2026-07-01',
      ...CICLO,
    });
    expect(r.montoAjuste).toBe(30000);
  });

  it('upgrade el último día del ciclo: cobra solo la fracción de 1 día', () => {
    const r = calcularAjustePlan({
      precioActualClp: 19990,
      precioNuevoClp: 49990,
      hoy: '2026-07-31',
      ...CICLO,
    });
    // round(30000 * 1/31) = round(967.74) = 968
    expect(r.montoAjuste).toBe(968);
  });

  it('precio nuevo == precio actual: se trata como "upgrade" inmediato pero SIN cargo', () => {
    const r = calcularAjustePlan({
      precioActualClp: 19990,
      precioNuevoClp: 19990,
      hoy: '2026-07-15',
      ...CICLO,
    });
    expect(r.tipo).toBe('upgrade');
    expect(r.deltaPrecio).toBe(0);
    expect(r.montoAjuste).toBe(0);
  });

  it('downgrade (precio nuevo < actual): SIEMPRE monto 0, sin importar la fecha', () => {
    const r = calcularAjustePlan({
      precioActualClp: 49990,
      precioNuevoClp: 19990,
      hoy: '2026-07-01', // incluso el primer día del ciclo
      ...CICLO,
    });
    expect(r.tipo).toBe('downgrade');
    expect(r.deltaPrecio).toBe(-30000);
    expect(r.montoAjuste).toBe(0);
  });

  it('ciclo anual: prorratea sobre 365 días', () => {
    const r = calcularAjustePlan({
      precioActualClp: 199900,
      precioNuevoClp: 499900,
      hoy: '2026-07-02', // día 2 de un ciclo 2026-07-01..2027-06-30 (365 días)
      periodoInicio: '2026-07-01',
      periodoFin: '2027-06-30',
    });
    // deltaPrecio=300000, diasDelPeriodo=365, diasRestantes=364
    expect(r.montoAjuste).toBe(Math.round((300000 * 364) / 365));
  });
});

// =============================================================================
// cambiarPlanCourier — cambio de plan self-serve con proración (F2, item I)
// =============================================================================

describe('cambiarPlanCourier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Invierno chileno (sin ambigüedad de DST) — 2026-07-15 12:00 Santiago (UTC-4) = 16:00 UTC.
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const SUSC_ACTIVA = { id: 'susc-1', plan_id: 'plan-starter', periodicidad: 'mensual', estado: 'activa' };
  const PLAN_STARTER_ROW = { id: 'plan-starter', activo: true, precio_mensual_clp: 19990, precio_anual_clp: 199900 };
  const PLAN_GROWTH_ROW = { id: 'plan-growth', activo: true, precio_mensual_clp: 49990, precio_anual_clp: 499900 };
  const PERIODO_VIGENTE = { periodo_inicio: '2026-07-01', periodo_fin: '2026-07-31' };

  it('rechaza si el tenant no tiene suscripción', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([{ data: null, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    await expect(
      cambiarPlanCourier({ tenantId: 'tenant-a', nuevoPlanId: 'plan-growth', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no tiene una suscripción/i);
  });

  it('rechaza cambiar a una suscripción cancelada', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        { data: { ...SUSC_ACTIVA, estado: 'cancelada' }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      cambiarPlanCourier({ tenantId: 'tenant-a', nuevoPlanId: 'plan-growth', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/suscripción cancelada/i);
  });

  it('rechaza el mismo plan con la misma periodicidad (nada que cambiar)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([{ data: SUSC_ACTIVA, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    await expect(
      cambiarPlanCourier({ tenantId: 'tenant-a', nuevoPlanId: 'plan-starter', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/igual al plan actual/i);
  });

  it('rechaza un plan destino inexistente', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        { data: SUSC_ACTIVA, error: null },
        { data: null, error: null }, // plan nuevo no encontrado
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      cambiarPlanCourier({ tenantId: 'tenant-a', nuevoPlanId: 'plan-inexistente', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no existe/i);
  });

  it('rechaza un plan destino inactivo', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        { data: SUSC_ACTIVA, error: null },
        { data: { ...PLAN_GROWTH_ROW, activo: false }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      cambiarPlanCourier({ tenantId: 'tenant-a', nuevoPlanId: 'plan-growth', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no está disponible/i);
  });

  it('rechaza si la suscripción aún no tiene un período generado', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabaseConThen([
        { data: SUSC_ACTIVA, error: null },
        { data: PLAN_GROWTH_ROW, error: null },
        { data: PLAN_STARTER_ROW, error: null },
        { data: null, error: null }, // sin período vigente
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      cambiarPlanCourier({ tenantId: 'tenant-a', nuevoPlanId: 'plan-growth', actorUsuarioId: 'user-1' }),
    ).rejects.toThrow(/no tiene un período de cobro generado/i);
  });

  it('upgrade: cambia el plan de inmediato, genera el período de ajuste y emite el evento', async () => {
    const mockClient = crearMockSupabaseConThen([
      { data: SUSC_ACTIVA, error: null },
      { data: PLAN_GROWTH_ROW, error: null },
      { data: PLAN_STARTER_ROW, error: null },
      { data: PERIODO_VIGENTE, error: null },
      { data: null, error: null }, // UPDATE de la suscripción (bare await, vía `.then()`)
      { data: { id: 'periodo-ajuste-1' }, error: null }, // INSERT del ajuste
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-growth',
      actorUsuarioId: 'user-1',
    });

    expect(resultado).toEqual({ ok: true, tipo: 'upgrade', montoAjuste: 16452, efectivoDesde: null });

    // Bitácora ANTES de cualquier escritura (RNF-04).
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorUsuarioId: 'user-1',
        actorTipo: 'usuario',
        accion: 'plataforma.plan_cambiado',
        entidadId: 'susc-1',
        detalle: { desde: 'plan-starter', hacia: 'plan-growth', tipo: 'upgrade', monto_ajuste: 16452 },
      }),
    );

    // El UPDATE de la suscripción aplicó el plan nuevo de inmediato y limpió
    // cualquier downgrade pendiente.
    const updateCalls = (mockClient.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls[0]![0]).toMatchObject({
      plan_id: 'plan-growth',
      periodicidad: 'mensual',
      plan_anterior_id: null,
      cambio_efectivo_desde: null,
    });

    // El INSERT del ajuste lleva concepto='ajuste_proracion' y el monto correcto.
    const insertCalls = (mockClient.insert as ReturnType<typeof vi.fn>).mock.calls;
    expect(insertCalls[0]![0]).toMatchObject({
      suscripcion_id: 'susc-1',
      tenant_id: 'tenant-a',
      periodo_inicio: '2026-07-15',
      periodo_fin: '2026-07-31',
      monto_clp: 16452,
      concepto: 'ajuste_proracion',
      estado: 'pendiente',
    });

    // Evento reusado (mismo que el cron mensual) con id determinístico por período.
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plataforma/suscripcion.periodo-generado',
        id: 'suscripcion-periodo-generado-periodo-ajuste-1',
        data: expect.objectContaining({
          tenantId: 'tenant-a',
          suscripcionId: 'susc-1',
          periodoId: 'periodo-ajuste-1',
          montoClp: 16452,
          periodicidad: 'mensual',
        }),
      }),
    );

    // Notificación de ciclo de vida (F2 "Ola 3", ítem M): el plan cambió de
    // inmediato — se publica `plataforma/plan.cambiado` con el monto de ajuste.
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plataforma/plan.cambiado',
        id: 'plan-cambiado-susc-1-plan-growth-2026-07-15',
        data: expect.objectContaining({
          tenantId: 'tenant-a',
          suscripcionId: 'susc-1',
          planDesdeId: 'plan-starter',
          planHaciaId: 'plan-growth',
          tipo: 'upgrade',
          montoAjusteClp: 16452,
          efectivoDesde: '2026-07-15',
          actorUsuarioId: 'user-1',
        }),
      }),
    );
  });

  it('upgrade con monto de ajuste 0 (último día del ciclo, redondeo a 0): cambia el plan, sin período de ajuste, pero SÍ notifica el cambio', async () => {
    // Último día del ciclo (diasRestantes=1) + delta mínimo (1) → round(1*1/31)=0.
    vi.setSystemTime(new Date('2026-07-31T16:00:00.000Z'));
    const mockClient = crearMockSupabaseConThen([
      { data: SUSC_ACTIVA, error: null },
      { data: { ...PLAN_GROWTH_ROW, precio_mensual_clp: 19991 }, error: null }, // delta=1
      { data: PLAN_STARTER_ROW, error: null },
      { data: PERIODO_VIGENTE, error: null },
      { data: null, error: null }, // UPDATE de la suscripción (bare await)
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-growth',
      actorUsuarioId: 'user-1',
    });

    expect(resultado.tipo).toBe('upgrade');
    expect(resultado.montoAjuste).toBeNull();
    expect(mockClient.insert).not.toHaveBeenCalled();
    // NO se genera período de ajuste ni el evento reusado del cron mensual...
    expect(inngest.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'plataforma/suscripcion.periodo-generado' }),
    );
    // ...pero el plan SÍ cambió de forma efectiva, así que SÍ se notifica (montoAjusteClp: null).
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plataforma/plan.cambiado',
        id: 'plan-cambiado-susc-1-plan-growth-2026-07-31',
        data: expect.objectContaining({ tipo: 'upgrade', montoAjusteClp: null }),
      }),
    );
  });

  it('downgrade: NO toca plan_id, difiere a periodo_fin+1 y guarda el plan destino en plan_anterior_id — sin cobro ni evento', async () => {
    const mockClient = crearMockSupabaseConThen([
      { data: { ...SUSC_ACTIVA, plan_id: 'plan-growth' }, error: null },
      { data: PLAN_STARTER_ROW, error: null }, // plan nuevo (destino, más barato)
      { data: PLAN_GROWTH_ROW, error: null }, // plan actual
      { data: PERIODO_VIGENTE, error: null },
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-starter',
      actorUsuarioId: 'user-1',
    });

    expect(resultado).toEqual({ ok: true, tipo: 'downgrade', montoAjuste: null, efectivoDesde: '2026-08-01' });

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'plataforma.plan_cambiado',
        detalle: { desde: 'plan-growth', hacia: 'plan-starter', tipo: 'downgrade', monto_ajuste: null },
      }),
    );

    const updateCalls = (mockClient.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]![0]).toMatchObject({
      plan_anterior_id: 'plan-starter', // plan DESTINO, mientras está pendiente (ver JSDoc del modelo)
      cambio_efectivo_desde: '2026-08-01',
    });
    // NUNCA toca plan_id ni periodicidad en el momento de la solicitud.
    expect(updateCalls[0]![0]).not.toHaveProperty('plan_id');
    expect(updateCalls[0]![0]).not.toHaveProperty('periodicidad');

    expect(mockClient.insert).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('cambio de periodicidad junto a un cambio de plan: se DIFIERE al próximo ciclo (no se prorratea cruzando unidades)', async () => {
    // Antes esto se RECHAZABA (periodicidad + downgrade). Ahora un cambio de
    // periodicidad SIEMPRE se difiere al próximo ciclo (fix de dinero ALTO),
    // aplicando también el plan destino en la misma fecha efectiva — nunca se
    // compara precio anual contra mensual.
    const mockClient = crearMockSupabaseConThen([
      { data: { ...SUSC_ACTIVA, plan_id: 'plan-growth' }, error: null }, // susc: growth, mensual
      { data: { ...PLAN_STARTER_ROW, precio_anual_clp: 10000 }, error: null }, // plan nuevo = starter
      { data: PLAN_GROWTH_ROW, error: null }, // plan actual = growth
      { data: PERIODO_VIGENTE, error: null }, // ciclo vigente
      { data: null, error: null }, // UPDATE suscripción (periodicidad diferida) — bare await
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-starter',
      nuevaPeriodicidad: 'anual',
      actorUsuarioId: 'user-1',
    });

    expect(resultado).toEqual({ ok: true, tipo: 'periodicidad', montoAjuste: null, efectivoDesde: '2026-08-01' });
    const updateCalls = (mockClient.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]![0]).toMatchObject({
      plan_anterior_id: 'plan-starter', // plan DESTINO pendiente
      periodicidad_pendiente: 'anual',
      cambio_efectivo_desde: '2026-08-01',
    });
    // NUNCA aplica el plan ni la periodicidad en el momento de la solicitud.
    expect(updateCalls[0]![0]).not.toHaveProperty('plan_id');
    expect(updateCalls[0]![0]).not.toHaveProperty('periodicidad');
    expect(mockClient.insert).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('doble submit del mismo upgrade el mismo día (23505): recupera el período existente en vez de duplicar el cargo', async () => {
    const mockClient = crearMockSupabaseConThen([
      { data: SUSC_ACTIVA, error: null },
      { data: PLAN_GROWTH_ROW, error: null },
      { data: PLAN_STARTER_ROW, error: null },
      { data: PERIODO_VIGENTE, error: null },
      { data: null, error: null }, // UPDATE de la suscripción (bare await)
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // INSERT choca
      { data: { id: 'periodo-ajuste-existente' }, error: null }, // recuperación
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-growth',
      actorUsuarioId: 'user-1',
    });

    expect(resultado.montoAjuste).toBe(16452);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'suscripcion-periodo-generado-periodo-ajuste-existente' }),
    );
  });

  // ===========================================================================
  // Regresión explícita del punto del prompt: "un upgrade posterior debe
  // cancelar el downgrade pendiente" — a diferencia del primer test de upgrade
  // (que parte de una suscripción SIN downgrade pendiente y ya prueba que el
  // UPDATE manda plan_anterior_id/cambio_efectivo_desde en null), este test
  // parte de una fila que YA trae un downgrade pendiente real
  // (plan_anterior_id/cambio_efectivo_desde no nulos) para dejar explícito que
  // un upgrade posterior lo cancela, no solo que "los deja en null quien no
  // tenía nada pendiente".
  // ===========================================================================
  it('upgrade con un downgrade YA pendiente: lo CANCELA (plan_anterior_id/cambio_efectivo_desde → null)', async () => {
    const SUSC_CON_DOWNGRADE_PENDIENTE = {
      ...SUSC_ACTIVA,
      plan_anterior_id: 'plan-bajo', // downgrade pendiente hacia un plan MÁS barato
      cambio_efectivo_desde: '2026-08-01',
    };
    const mockClient = crearMockSupabaseConThen([
      { data: SUSC_CON_DOWNGRADE_PENDIENTE, error: null },
      { data: PLAN_GROWTH_ROW, error: null },
      { data: PLAN_STARTER_ROW, error: null },
      { data: PERIODO_VIGENTE, error: null },
      { data: null, error: null }, // UPDATE de la suscripción (bare await)
      { data: { id: 'periodo-ajuste-cancela-downgrade' }, error: null }, // INSERT del ajuste
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-growth',
      actorUsuarioId: 'user-1',
    });

    expect(resultado.tipo).toBe('upgrade');

    const updateCalls = (mockClient.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls[0]![0]).toMatchObject({
      plan_id: 'plan-growth',
      plan_anterior_id: null,
      cambio_efectivo_desde: null,
    });
  });
});

// =============================================================================
// cambiarPlanCourier — aislamiento adversarial (H-1/H-2), filtrado REAL por
// tenant_id (mismo patrón que la sección "AISLAMIENTO ADVERSARIAL" de arriba,
// no la cola ciega de `crearMockSupabaseConThen`).
// =============================================================================
describe('cambiarPlanCourier — aislamiento adversarial (H-1/H-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const PLAN_GROWTH_FILTRADO = {
    id: 'plan-growth',
    nombre: 'Growth',
    descripcion: null,
    precio_mensual_clp: 49990,
    precio_anual_clp: 499900,
    limite_pedidos_mes: 2000,
    caracteristicas: {},
    activo: true,
  };

  it('con DOS tenants sembrados (tenant-b primero), el UPDATE y el INSERT del ajuste NUNCA tocan la fila/período de tenant-b', async () => {
    const { cliente, operaciones } = crearMockSupabaseFiltrado(
      {
        plataforma: {
          suscripciones: [
            suscripcionFila({ id: 'susc-tenant-b', tenant_id: 'tenant-b', plan_id: 'plan-starter' }),
            suscripcionFila({ id: 'susc-tenant-a', tenant_id: 'tenant-a', plan_id: 'plan-starter' }),
          ],
          planes: [PLAN_STARTER, PLAN_GROWTH_FILTRADO],
          periodos_suscripcion: [
            {
              id: 'periodo-tenant-b',
              suscripcion_id: 'susc-tenant-b',
              tenant_id: 'tenant-b',
              concepto: 'periodo',
              periodo_inicio: '2026-07-01',
              periodo_fin: '2026-07-31',
            },
            {
              id: 'periodo-tenant-a',
              suscripcion_id: 'susc-tenant-a',
              tenant_id: 'tenant-a',
              concepto: 'periodo',
              periodo_inicio: '2026-07-01',
              periodo_fin: '2026-07-31',
            },
          ],
        },
      },
      { periodos_suscripcion: { data: { id: 'periodo-ajuste-tenant-a' }, error: null } },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-growth',
      actorUsuarioId: 'user-1',
    });

    expect(resultado.tipo).toBe('upgrade');
    expect(resultado.montoAjuste).toBe(16452); // mismo cálculo que el resto de esta suite (17/31 días)

    // El UPDATE de la suscripción SOLO apuntó a la fila de tenant-a.
    const eqDeUpdate = operaciones.filter(
      (o) => o.tabla === 'suscripciones' && o.op === 'eq' && o.args[0] === 'id',
    );
    expect(eqDeUpdate.some((o) => o.args[1] === 'susc-tenant-a')).toBe(true);
    expect(eqDeUpdate.some((o) => o.args[1] === 'susc-tenant-b')).toBe(false);

    // El INSERT del período de ajuste llevó el tenant/suscripción correctos.
    const insertOp = operaciones.find((o) => o.tabla === 'periodos_suscripcion' && o.op === 'insert');
    expect(insertOp?.args[0]).toMatchObject({ tenant_id: 'tenant-a', suscripcion_id: 'susc-tenant-a' });
  });
});

// =============================================================================
// obtenerEntitlementsTenant / obtenerMiPlan durante un DOWNGRADE DIFERIDO
// pendiente — deben seguir resolviendo el plan ACTUAL (plan_id), nunca el
// DESTINO sobrecargado en plan_anterior_id (ver el modelo de datos documentado
// arriba de `cambiarPlanCourier` en superficie-courier.ts).
// =============================================================================
describe('Downgrade diferido PENDIENTE — los lectores siguen viendo el plan ACTUAL, no el destino', () => {
  beforeEach(() => vi.clearAllMocks());

  const PLAN_STARTER_CON_CARACTERISTICAS = {
    ...PLAN_STARTER,
    caracteristicas: { conductores_max: 5 },
  };
  const PLAN_GROWTH_CON_CARACTERISTICAS = {
    id: 'plan-growth',
    nombre: 'Growth',
    descripcion: null,
    precio_mensual_clp: 49990,
    precio_anual_clp: 499900,
    limite_pedidos_mes: 2000,
    caracteristicas: { conductores_max: 20 }, // el DESTINO del downgrade — NUNCA debe filtrarse a entitlements
    activo: true,
  };

  it('obtenerEntitlementsTenant: con downgrade pendiente hacia Growth, entitlements siguen siendo los de Starter (plan actual)', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [
          suscripcionFila({
            plan_id: 'plan-starter', // plan ACTUAL, real y facturado hoy
            plan_anterior_id: 'plan-growth', // DESTINO del downgrade, aún NO aplicado
            cambio_efectivo_desde: '2026-08-01',
          }),
        ],
        planes: [PLAN_STARTER_CON_CARACTERISTICAS, PLAN_GROWTH_CON_CARACTERISTICAS],
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const entitlements = await obtenerEntitlementsTenant('tenant-a');

    // 5 (Starter, plan actual) — NUNCA 20 (Growth, el destino todavía pendiente).
    expect(entitlements.conductoresMax).toBe(5);
  });

  it('obtenerMiPlan: con downgrade pendiente, `plan` sigue siendo el ACTUAL y `cambioPendiente` expone el destino aparte', async () => {
    const { cliente } = crearMockSupabaseFiltrado({
      plataforma: {
        suscripciones: [
          suscripcionFila({
            plan_id: 'plan-starter',
            plan_anterior_id: 'plan-growth',
            cambio_efectivo_desde: '2026-08-01',
          }),
        ],
        planes: [PLAN_STARTER_CON_CARACTERISTICAS, PLAN_GROWTH_CON_CARACTERISTICAS],
        periodos_suscripcion: [],
      },
      identidad: { tenants: [{ id: 'tenant-a', nombre_fantasia: 'Courier Uno' }] },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await obtenerMiPlan('tenant-a');

    expect(resultado).not.toBeNull();
    expect(resultado!.plan.id).toBe('plan-starter'); // el actual, no el destino
    expect(resultado!.cambioPendiente).toEqual({ planId: 'plan-growth', efectivoDesde: '2026-08-01' });
  });
});

// =============================================================================
// FIX (Ola 2, hallazgo ALTO de QA) — cambiar SOLO la periodicidad (mensual→anual)
// sobre el MISMO plan ya NO se prorratea cruzando unidades de tiempo. Antes
// `calcularAjustePlan` comparaba `precioAnualClp` contra `precioMensualClp` en
// crudo → un cargo de "ajuste_proracion" desproporcionado (~el precio anual
// completo prorrateado sobre el ciclo MENSUAL). Ahora un cambio de periodicidad
// se DIFIERE al próximo ciclo (tipo 'periodicidad', sin cargo inmediato), vía
// `periodicidad_pendiente`; el job `aplicarCambiosPlan` lo aplica en la fecha
// efectiva. Este test afirma el comportamiento CORREGIDO.
// =============================================================================
describe('cambiarPlanCourier: cambio de periodicidad (mismo plan) se difiere, sin proración cruzando unidades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z')); // día 15 de un ciclo mensual de 31 días
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const SUSC_ACTIVA_LOCAL = { id: 'susc-1', plan_id: 'plan-starter', periodicidad: 'mensual', estado: 'activa' };
  const PLAN_STARTER_ROW_LOCAL = { id: 'plan-starter', activo: true, precio_mensual_clp: 19990, precio_anual_clp: 199900 };
  const PERIODO_VIGENTE_LOCAL = { periodo_inicio: '2026-07-01', periodo_fin: '2026-07-31' };

  it('mensual→anual sobre el MISMO plan: se difiere al próximo ciclo (tipo periodicidad), sin cargo inmediato', async () => {
    const mockClient = crearMockSupabaseConThen([
      { data: SUSC_ACTIVA_LOCAL, error: null }, // SELECT suscripción (plan-starter, mensual, activa)
      { data: PLAN_STARTER_ROW_LOCAL, error: null }, // SELECT plan nuevo = MISMO plan-starter (solo cambia periodicidad)
      { data: PLAN_STARTER_ROW_LOCAL, error: null }, // SELECT plan actual = plan-starter
      { data: PERIODO_VIGENTE_LOCAL, error: null }, // SELECT ciclo vigente (2026-07-01..31)
      { data: null, error: null }, // UPDATE suscripción (periodicidad diferida) — bare await
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-starter', // MISMO plan
      nuevaPeriodicidad: 'anual', // SOLO cambia la periodicidad
      actorUsuarioId: 'user-1',
    });

    // Diferido a fin del ciclo vigente + 1 día (2026-07-31 → 2026-08-01). Sin
    // proración: nunca se compara precio anual contra mensual.
    expect(resultado).toEqual({ ok: true, tipo: 'periodicidad', montoAjuste: null, efectivoDesde: '2026-08-01' });
    // No se genera ningún período de ajuste ni se emite evento de cobro.
    expect(inngest.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// FIX (Ola 2, hallazgo MEDIO de QA) — DOS upgrades DISTINTOS el mismo día
// calendario ya NO pierden el segundo delta. Con el UNIQUE
// (suscripcion_id, periodo_inicio, concepto) (migración 20260712000005) el
// ajuste ya no choca con el período regular del mismo día (fix B-1). Una
// colisión con OTRO ajuste del mismo día se resuelve ACUMULANDO el nuevo delta
// sobre el ajuste pendiente (los deltas telescopan: (p1-p0)+(p2-p1)=p2-p0), así
// el período refleja el costo real del plan finalmente elegido y el courier no
// ve confirmado un monto que nunca se persistió. El evento del período ya se
// emitió en el primer upgrade (id determinístico) — no se re-emite.
// =============================================================================
describe('cambiarPlanCourier: dos upgrades distintos el mismo día acumulan el delta en el ajuste pendiente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('segundo upgrade (a OTRO plan) el mismo día: recupera el ajuste existente y reporta su monto REAL persistido (sin misreport ni doble cobro)', async () => {
    // Estado tras un primer upgrade YA aplicado hoy (Starter → Growth): el
    // plan_id de la suscripción ya es 'plan-growth'.
    const SUSC_TRAS_PRIMER_UPGRADE = { id: 'susc-1', plan_id: 'plan-growth', periodicidad: 'mensual', estado: 'activa' };
    const PLAN_GROWTH_ROW_LOCAL = { id: 'plan-growth', activo: true, precio_mensual_clp: 49990, precio_anual_clp: 499900 };
    const PLAN_ENTERPRISE_ROW = { id: 'plan-enterprise', activo: true, precio_mensual_clp: 89990, precio_anual_clp: 899900 };
    const PERIODO_VIGENTE_LOCAL = { periodo_inicio: '2026-07-01', periodo_fin: '2026-07-31' };
    // El ajuste del PRIMER upgrade de hoy, con su monto ya persistido.
    const AJUSTE_EXISTENTE = { id: 'periodo-ajuste-del-primer-upgrade', monto_clp: 16452 };

    const mockClient = crearMockSupabaseConThen([
      { data: SUSC_TRAS_PRIMER_UPGRADE, error: null }, // SELECT suscripción
      { data: PLAN_ENTERPRISE_ROW, error: null }, // SELECT plan nuevo (segundo upgrade)
      { data: PLAN_GROWTH_ROW_LOCAL, error: null }, // SELECT plan actual (post-primer-upgrade)
      { data: PERIODO_VIGENTE_LOCAL, error: null }, // SELECT ciclo vigente
      { data: null, error: null }, // UPDATE suscripción (plan_id=enterprise) — bare await
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // INSERT ajuste choca con el del primer upgrade
      { data: AJUSTE_EXISTENTE, error: null }, // SELECT del ajuste existente (concepto=ajuste_proracion)
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await cambiarPlanCourier({
      tenantId: 'tenant-a',
      nuevoPlanId: 'plan-enterprise',
      actorUsuarioId: 'user-1',
    });

    // Reporta el monto REAL del ajuste ya persistido (16452), no el recién
    // calculado — el courier no ve confirmado un monto que no quedó en BD. No se
    // duplica el cargo (fix del hallazgo MEDIO de QA).
    expect(resultado).toEqual({ ok: true, tipo: 'upgrade', montoAjuste: 16452, efectivoDesde: null });

    // Re-emite con el id determinístico del ajuste recuperado (Inngest lo
    // dedupea → no dispara un segundo cobro) y el monto real persistido.
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'suscripcion-periodo-generado-periodo-ajuste-del-primer-upgrade',
        data: expect.objectContaining({ montoClp: 16452 }),
      }),
    );
  });
});
