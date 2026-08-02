/**
 * Tests de las transiciones de mandato disparadas por webhook (F1-E):
 * `activarMandatoRecurrente` / `marcarMandatoFallido`.
 *
 * Mismo patrón de mocks que `cobro.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/integraciones/secretos', () => ({
  cifrarSecreto: vi.fn().mockResolvedValue({ referenciaExternaId: 'ref-uuid-cifrado' }),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { cifrarSecreto } from '@/modules/integraciones/secretos';
import { activarMandatoRecurrente, marcarMandatoFallido } from './mandato';

function crearMockSupabase(secuencia: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const siguiente = () => secuencia[i++] ?? { data: null, error: null };
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    update: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(siguiente())),
  };
  return q;
}

const SUSC_BASE = { id: 'susc-1', tenant_id: 'tenant-a', mandato_estado: 'pendiente' };

describe('activarMandatoRecurrente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin suscripcionId correlacionable → sin_suscripcion, no cifra nada', async () => {
    const resultado = await activarMandatoRecurrente({
      mandatoExternoId: 'sub_abc',
      suscripcionId: null,
    });
    expect(resultado).toBe('sin_suscripcion');
    expect(cifrarSecreto).not.toHaveBeenCalled();
  });

  it('suscripción inexistente → sin_suscripcion', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await activarMandatoRecurrente({ mandatoExternoId: 'sub_abc', suscripcionId: 'susc-1' });
    expect(resultado).toBe('sin_suscripcion');
  });

  it('mandato ya activo → ya_aplicado, idempotente (NO re-cifra ni re-escribe)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: { ...SUSC_BASE, mandato_estado: 'activo' }, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );
    const resultado = await activarMandatoRecurrente({ mandatoExternoId: 'sub_abc', suscripcionId: 'susc-1' });
    expect(resultado).toBe('ya_aplicado');
    expect(cifrarSecreto).not.toHaveBeenCalled();
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it('mandato pendiente → activado: cifra el id definitivo y actualiza mandato_estado/mandato_ref', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: SUSC_BASE, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await activarMandatoRecurrente({ mandatoExternoId: 'sub_definitivo_123', suscripcionId: 'susc-1' });
    expect(resultado).toBe('activado');

    // Bitácora ANTES del cifrado/update — actor sistema (RNF-04).
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorTipo: 'sistema',
        actorUsuarioId: null,
        accion: 'plataforma.mandato_activado',
        tenantId: 'tenant-a',
        entidadId: 'susc-1',
      }),
    );

    expect(cifrarSecreto).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        tipoSecreto: 'mandato_suscripcion_fintoc',
        valor: 'sub_definitivo_123',
      }),
    );
  });
});

describe('marcarMandatoFallido', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin suscripcionId correlacionable → sin_suscripcion', async () => {
    const resultado = await marcarMandatoFallido({ suscripcionId: null });
    expect(resultado).toBe('sin_suscripcion');
  });

  it('suscripción inexistente → sin_suscripcion', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await marcarMandatoFallido({ suscripcionId: 'susc-1' });
    expect(resultado).toBe('sin_suscripcion');
  });

  it('mandato ya fallido → ya_aplicado, idempotente', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: { ...SUSC_BASE, mandato_estado: 'fallido' }, error: null },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await marcarMandatoFallido({ suscripcionId: 'susc-1' });
    expect(resultado).toBe('ya_aplicado');
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("mandato activo → fallido_registrado (p. ej. subscription.canceled)", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: { ...SUSC_BASE, mandato_estado: 'activo' }, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );
    const resultado = await marcarMandatoFallido({ suscripcionId: 'susc-1' });
    expect(resultado).toBe('fallido_registrado');
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accion: 'plataforma.mandato_fallido', actorTipo: 'sistema' }),
    );
  });
});
