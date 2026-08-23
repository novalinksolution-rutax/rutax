/**
 * Reapertura de período. Las guardas, una por una.
 *
 * La que importa de verdad es la **ventana de carrera**: `emitirFacturaPeriodo`
 * no cambia el estado —publica el evento y el período sigue `cerrado` hasta que
 * el job C3 lo marca `facturado`—, así que mirar solo el estado dejaría reabrir
 * un período cuya factura ya va camino al SII. El folio se consumiría igual,
 * contra un período otra vez abierto.
 *
 * Mocks mínimos, al estilo de `acciones.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { reabrirPeriodo } from './acciones';

const MOTIVO_VALIDO = 'El seller reclamó dos entregas que no eran suyas';

function usuarioConRol(rol: UsuarioActual['rol']): UsuarioActual {
  return {
    tenantId: 'tenant-a',
    tipoUsuario: 'interno',
    sellerId: null,
    driverId: null,
    rol,
    estado: 'activo',
  };
}

/**
 * `maybeSingle` responde en orden: primero el período, después la consulta a la
 * bitácora por emisiones en curso.
 */
function crearMock({
  periodo,
  emisionEnCurso = null,
}: {
  periodo: Record<string, unknown> | null;
  emisionEnCurso?: { id: string } | null;
}) {
  const respuestas = [
    { data: periodo, error: null },
    { data: emisionEnCurso, error: null },
  ];
  const update = vi.fn().mockReturnThis();
  const mock = {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update,
    maybeSingle: vi.fn(() => Promise.resolve(respuestas.shift() ?? { data: null, error: null })),
  };
  return mock;
}

const PERIODO_CERRADO = {
  id: 'periodo-001',
  tenant_id: 'tenant-a',
  seller_id: 'seller-a',
  estado: 'cerrado',
  documento_dte_id: null,
};

function montar(mock: ReturnType<typeof crearMock>) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    mock as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
}

describe('reabrirPeriodo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el supervisor no puede: reabrir es capacidad de facturación', async () => {
    montar(crearMock({ periodo: PERIODO_CERRADO }));
    await expect(
      reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('supervisor'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('sin motivo suficiente no se reabre, aunque el rol alcance', async () => {
    montar(crearMock({ periodo: PERIODO_CERRADO }));
    await expect(
      reabrirPeriodo('tenant-a', 'periodo-001', 'corto', usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un período ya facturado explica que haría falta una nota de crédito', async () => {
    montar(crearMock({ periodo: { ...PERIODO_CERRADO, estado: 'facturado' } }));
    await expect(
      reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toThrow(/nota de crédito/i);
  });

  it('un período abierto no se reabre dos veces', async () => {
    montar(crearMock({ periodo: { ...PERIODO_CERRADO, estado: 'abierto' } }));
    await expect(
      reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toThrow(/cerrado/i);
  });

  it('con un DTE ya asociado tampoco, aunque el estado siga en cerrado', async () => {
    montar(crearMock({ periodo: { ...PERIODO_CERRADO, documento_dte_id: 'dte-9' } }));
    await expect(
      reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // LA GUARDA QUE JUSTIFICA EL RESTO
  it('con una emisión en curso NO se reabre: el estado todavía dice `cerrado`', async () => {
    const mock = crearMock({ periodo: PERIODO_CERRADO, emisionEnCurso: { id: 'bit-1' } });
    montar(mock);
    await expect(
      reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toThrow(/todavía no hay respuesta/i);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('la consulta de emisiones va ACOTADA en el tiempo, o el período queda trabado para siempre', async () => {
    // Sin ventana, una solicitud de emisión cuyo job murió deja el período
    // `cerrado` y la bitácora diciendo «espera al SII» el resto de su vida: la
    // bitácora no se borra. Acá se verifica que la consulta filtra por fecha.
    const mock = crearMock({ periodo: PERIODO_CERRADO });
    montar(mock);
    await reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('dueno'), 'actor-1');

    expect(mock.gte).toHaveBeenCalledWith('creado_en', expect.any(String));
    const desde = new Date(mock.gte.mock.calls[0][1] as string).getTime();
    const minutos = (Date.now() - desde) / 60_000;
    expect(minutos).toBeGreaterThan(1); // no es «ahora mismo»
    expect(minutos).toBeLessThan(24 * 60); // ni un día entero
  });

  it('el dueño reabre, y la bitácora queda ANTES de escribir el estado', async () => {
    const mock = crearMock({ periodo: PERIODO_CERRADO });
    montar(mock);
    const orden: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      orden.push('bitacora');
    });
    mock.update.mockImplementation(() => {
      orden.push('update');
      return mock;
    });

    await reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('dueno'), 'actor-1');

    expect(orden).toEqual(['bitacora', 'update']);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'dinero.periodo_reabierto',
        entidadId: 'periodo-001',
        actorUsuarioId: 'actor-1',
        detalle: expect.objectContaining({ motivo: MOTIVO_VALIDO }),
      }),
    );
  });

  it('administración también puede', async () => {
    montar(crearMock({ periodo: PERIODO_CERRADO }));
    await expect(
      reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('administracion'), 'actor-1'),
    ).resolves.toBeUndefined();
  });

  it('el estado vuelve a `abierto` y los totales se limpian', async () => {
    const mock = crearMock({ periodo: PERIODO_CERRADO });
    montar(mock);
    await reabrirPeriodo('tenant-a', 'periodo-001', MOTIVO_VALIDO, usuarioConRol('dueno'), 'actor-1');
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: 'abierto',
        monto_total_clp: null,
        cerrado_en: null,
        cerrado_por_usuario_id: null,
      }),
    );
    // La guarda de carrera también va en la BD: el UPDATE exige `cerrado`.
    expect(mock.eq).toHaveBeenCalledWith('estado', 'cerrado');
  });
});
