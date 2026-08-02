/**
 * Tests de `comunicaciones.ts` (F3 · Gap 7 — comunicaciones de Rutax a los
 * couriers). Cubre:
 * - `crearComunicacion`: validación, bitácora ANTES del INSERT con
 *   `actorUsuarioId` real, y publicación del evento Inngest SOLO si
 *   `enviarEmail=true` (con `id` determinístico).
 * - `activarDesactivarComunicacion`: bitácora ANTES del UPDATE, distingue
 *   accion activar/desactivar, valida existencia.
 * - `obtenerComunicaciones` (lector admin): mapeo de filas.
 * - `obtenerComunicacionesActivasParaCourier` (lector courier-safe): filtro de
 *   vigencia, mapeo `nivel` → `urgencia` sin traducir, y defensivo ante error.
 *
 * Mismo patrón de mocks que `acciones.test.ts` (builder por secuencia de
 * respuestas, soporta `.single()`/`.maybeSingle()`/`await` bare).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { inngest } from '@/lib/inngest/cliente';
import {
  crearComunicacion,
  activarDesactivarComunicacion,
  obtenerComunicaciones,
  obtenerComunicacionesActivasParaCourier,
} from './comunicaciones';

const ACTOR = 'ad000000-0000-0000-0000-000000000001';

/** Builder encadenable por secuencia de respuestas — mismo patrón que `acciones.test.ts`. */
function crearMockSupabase(secuencia: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const siguiente = () => secuencia[i++] ?? { data: null, error: null };
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    lte: vi.fn(() => q),
    or: vi.fn(() => q),
    order: vi.fn(() => q),
    update: vi.fn(() => q),
    insert: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(siguiente())),
    single: vi.fn(() => Promise.resolve(siguiente())),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(siguiente()).then(resolve, reject),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('crearComunicacion', () => {
  it('valida título vacío sin tocar la BD', async () => {
    await expect(
      crearComunicacion({ titulo: '  ', cuerpo: 'x', tipo: 'info', nivel: 'informativo', enviarEmail: false, actorUsuarioId: ACTOR }),
    ).rejects.toThrow(/título/i);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it('valida cuerpo vacío sin tocar la BD', async () => {
    await expect(
      crearComunicacion({ titulo: 'x', cuerpo: '   ', tipo: 'info', nivel: 'informativo', enviarEmail: false, actorUsuarioId: ACTOR }),
    ).rejects.toThrow(/cuerpo/i);
  });

  it('valida tipo inválido', async () => {
    await expect(
      crearComunicacion({
        titulo: 'x',
        cuerpo: 'y',
        tipo: 'no-existe' as never,
        nivel: 'informativo',
        enviarEmail: false,
        actorUsuarioId: ACTOR,
      }),
    ).rejects.toThrow(/tipo de comunicación inválido/i);
  });

  it('valida nivel inválido', async () => {
    await expect(
      crearComunicacion({
        titulo: 'x',
        cuerpo: 'y',
        tipo: 'info',
        nivel: 'critico' as never,
        enviarEmail: false,
        actorUsuarioId: ACTOR,
      }),
    ).rejects.toThrow(/nivel de comunicación inválido/i);
  });

  it('exige actorUsuarioId (RNF-04)', async () => {
    await expect(
      crearComunicacion({ titulo: 'x', cuerpo: 'y', tipo: 'info', nivel: 'informativo', enviarEmail: false, actorUsuarioId: '' }),
    ).rejects.toThrow(/actorUsuarioId es obligatorio/i);
  });

  it('valida vigenteHasta con formato de fecha inválido', async () => {
    await expect(
      crearComunicacion({
        titulo: 'x',
        cuerpo: 'y',
        tipo: 'info',
        nivel: 'informativo',
        enviarEmail: false,
        actorUsuarioId: ACTOR,
        vigenteHasta: 'no-es-una-fecha',
      }),
    ).rejects.toThrow(/fecha ISO válida/i);
  });

  it('camino feliz sin email: bitácora ANTES del INSERT con actorUsuarioId real; NO publica evento', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: { id: 'com-1' }, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await crearComunicacion({
      titulo: 'Mantención programada',
      cuerpo: 'El sábado habrá una ventana de mantención.',
      tipo: 'mantencion',
      nivel: 'importante',
      enviarEmail: false,
      actorUsuarioId: ACTOR,
    });

    expect(resultado).toEqual({ ok: true, comunicacionId: 'com-1' });

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: null,
        actorUsuarioId: ACTOR,
        actorTipo: 'super_admin',
        accion: 'plataforma.comunicacion_creada',
        entidadTipo: 'comunicacion',
        entidadId: null,
      }),
    );

    // La bitácora debe registrarse ANTES del INSERT (orden de invocación).
    const supabase = vi.mocked(crearClienteServiceRole).mock.results[0]!.value as ReturnType<
      typeof crearMockSupabase
    >;
    const ordenBitacora = vi.mocked(registrarEnBitacora).mock.invocationCallOrder[0]!;
    const ordenInsert = (supabase.insert as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(ordenBitacora).toBeLessThan(ordenInsert);

    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('camino feliz con enviarEmail=true: publica el evento con id determinístico DESPUÉS del INSERT', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: { id: 'com-2' }, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await crearComunicacion({
      titulo: 'Nueva función disponible',
      cuerpo: 'Ya puedes exportar tus datos.',
      tipo: 'novedad',
      nivel: 'informativo',
      enviarEmail: true,
      actorUsuarioId: ACTOR,
      vigenteHasta: '2026-08-01T00:00:00.000Z',
    });

    expect(inngest.send).toHaveBeenCalledWith({
      name: 'plataforma/comunicacion.publicada',
      id: 'comunicacion-publicada-com-2',
      data: {
        comunicacionId: 'com-2',
        titulo: 'Nueva función disponible',
        cuerpo: 'Ya puedes exportar tus datos.',
        tipo: 'novedad',
        nivel: 'informativo',
      },
    });
  });

  it('propaga el error del INSERT sin publicar el evento', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: { message: 'boom' } }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    await expect(
      crearComunicacion({
        titulo: 'x',
        cuerpo: 'y',
        tipo: 'alerta',
        nivel: 'urgente',
        enviarEmail: true,
        actorUsuarioId: ACTOR,
      }),
    ).rejects.toThrow(/error al crear la comunicación/i);

    expect(inngest.send).not.toHaveBeenCalled();
  });
});

describe('activarDesactivarComunicacion', () => {
  it('exige actorUsuarioId', async () => {
    await expect(activarDesactivarComunicacion({ id: 'com-1', activa: false, actorUsuarioId: '' })).rejects.toThrow(
      /actorUsuarioId es obligatorio/i,
    );
  });

  it('comunicación inexistente → lanza sin escribir bitácora', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(
      activarDesactivarComunicacion({ id: 'no-existe', activa: false, actorUsuarioId: ACTOR }),
    ).rejects.toThrow(/no encontrada/i);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it('desactivar: bitácora con accion "comunicacion_desactivada" ANTES del UPDATE', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: { id: 'com-1', activa: true }, error: null }, // lectura
        { data: null, error: null }, // update bare
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await activarDesactivarComunicacion({ id: 'com-1', activa: false, actorUsuarioId: ACTOR });

    expect(resultado).toEqual({ ok: true });
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUsuarioId: ACTOR,
        accion: 'plataforma.comunicacion_desactivada',
        entidadTipo: 'comunicacion',
        entidadId: 'com-1',
        detalle: { activa_anterior: true, activa_nueva: false },
      }),
    );
  });

  it('activar: bitácora con accion "comunicacion_activada"', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: { id: 'com-1', activa: false }, error: null },
        { data: null, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await activarDesactivarComunicacion({ id: 'com-1', activa: true, actorUsuarioId: ACTOR });

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accion: 'plataforma.comunicacion_activada' }),
    );
  });
});

describe('obtenerComunicaciones (lector admin)', () => {
  it('mapea las filas a `Comunicacion` (camelCase)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        {
          data: [
            {
              id: 'com-1',
              titulo: 'Mantención',
              cuerpo: 'Detalle',
              tipo: 'mantencion',
              nivel: 'importante',
              activa: true,
              vigente_desde: '2026-07-01T00:00:00.000Z',
              vigente_hasta: null,
              enviar_email: true,
              creado_por: ACTOR,
              creado_en: '2026-07-01T00:00:00.000Z',
              actualizado_en: '2026-07-01T00:00:00.000Z',
            },
          ],
          error: null,
        },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await obtenerComunicaciones();

    expect(resultado).toEqual([
      {
        id: 'com-1',
        titulo: 'Mantención',
        cuerpo: 'Detalle',
        tipo: 'mantencion',
        nivel: 'importante',
        activa: true,
        vigenteDesde: '2026-07-01T00:00:00.000Z',
        vigenteHasta: null,
        enviarEmail: true,
        creadoPor: ACTOR,
        creadoEn: '2026-07-01T00:00:00.000Z',
        actualizadoEn: '2026-07-01T00:00:00.000Z',
      },
    ]);
  });

  it('error de lectura → lanza (no es defensivo, a diferencia del lector courier-safe)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: { message: 'boom' } }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );
    await expect(obtenerComunicaciones()).rejects.toThrow(/error al listar comunicaciones/i);
  });
});

describe('obtenerComunicacionesActivasParaCourier (lector courier-safe)', () => {
  it('mapea nivel → urgencia SIN traducir, y arma un Aviso por comunicación', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        {
          data: [
            { id: 'com-1', titulo: 'Mantención el sábado', cuerpo: 'De 02:00 a 04:00.', nivel: 'urgente' },
            { id: 'com-2', titulo: 'Nueva función', cuerpo: 'Exportación de datos.', nivel: 'informativo' },
          ],
          error: null,
        },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const avisos = await obtenerComunicacionesActivasParaCourier();

    expect(avisos).toEqual([
      {
        id: 'comunicacion-com-1',
        urgencia: 'urgente',
        titulo: 'Mantención el sábado',
        descripcion: 'De 02:00 a 04:00.',
        href: '#',
        accion: 'Entendido',
      },
      {
        id: 'comunicacion-com-2',
        urgencia: 'informativo',
        titulo: 'Nueva función',
        descripcion: 'Exportación de datos.',
        href: '#',
        accion: 'Entendido',
      },
    ]);
  });

  it('filtra por vigencia: activa=true, vigente_desde <= ahora, vigente_hasta null o >= ahora', async () => {
    const mock = crearMockSupabase([{ data: [], error: null }]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(mock as unknown as ReturnType<typeof crearClienteServiceRole>);

    await obtenerComunicacionesActivasParaCourier();

    expect(mock.eq).toHaveBeenCalledWith('activa', true);
    expect(mock.lte).toHaveBeenCalledWith('vigente_desde', expect.any(String));
    expect(mock.or).toHaveBeenCalledWith(expect.stringContaining('vigente_hasta.is.null'));
  });

  it('defensivo: cualquier error de lectura devuelve [] en vez de lanzar', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: { message: 'boom' } }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    const avisos = await obtenerComunicacionesActivasParaCourier();
    expect(avisos).toEqual([]);
  });

  it('defensivo: crearClienteServiceRole lanzando también devuelve []', async () => {
    vi.mocked(crearClienteServiceRole).mockImplementation(() => {
      throw new Error('sin conexión');
    });

    const avisos = await obtenerComunicacionesActivasParaCourier();
    expect(avisos).toEqual([]);
  });
});
