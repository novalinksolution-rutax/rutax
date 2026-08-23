/**
 * Tests de `plataforma/notificaciones.ts` (F2 "Ola 3", ítem M).
 *
 * Cubre: resolución del destinatario (filtrado por tenant, prioriza rol
 * 'dueno'), deduplicación vía bitácora (con/sin ventana de día), el helper de
 * envío (sin destinatario no intenta enviar), y los constructores de contenido
 * (montos CLP, fechas cortas, textos condicionales).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/integraciones/notificaciones/email', () => ({
  obtenerPuertoEmail: vi.fn(),
}));

import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { obtenerPuertoEmail } from '@/modules/integraciones/notificaciones/email';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailPagoConfirmado,
  construirEmailCobroFallido,
  construirEmailTrialPorVencer,
  construirEmailSuscripcionCreada,
  construirEmailPlanCambiado,
  construirEmailPeriodoVencido,
  construirEmailComunicacion,
} from './notificaciones';

// -----------------------------------------------------------------------------
// Mock de Supabase — builder encadenable "thenable" (soporta tanto
// `.maybeSingle()` explícito como el `await` directo de la cadena).
// -----------------------------------------------------------------------------
function crearQueryBuilder(respuesta: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    limit: vi.fn(() => q),
    gte: vi.fn(() => q),
    lt: vi.fn(() => q),
    order: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(respuesta)),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(respuesta).then(resolve, reject),
  };
  return q;
}

interface MockSupabaseOpts {
  tenant?: { data: unknown; error: unknown };
  internos?: { data: unknown; error: unknown };
  bitacora?: { data: unknown; error: unknown };
  authUser?: { data: { user: { email: string } | null } };
}

function crearMockSupabase(opts: MockSupabaseOpts = {}) {
  const client = {
    schema: vi.fn(() => client),
    from: vi.fn((tabla: string) => {
      if (tabla === 'tenants') return crearQueryBuilder(opts.tenant ?? { data: null, error: null });
      if (tabla === 'usuarios_perfil') return crearQueryBuilder(opts.internos ?? { data: [], error: null });
      return crearQueryBuilder(opts.bitacora ?? { data: null, error: null });
    }),
    auth: { admin: { getUserById: vi.fn().mockResolvedValue(opts.authUser ?? { data: { user: null } }) } },
  };
  return client;
}

describe('resolverDestinatarioCourier', () => {
  it('prioriza el usuario con rol=dueno entre varios internos activos', async () => {
    const client = crearMockSupabase({
      tenant: { data: { nombre_fantasia: 'Courier Uno' }, error: null },
      internos: {
        data: [
          { id: 'user-supervisor', rol: 'supervisor' },
          { id: 'user-dueno', rol: 'dueno' },
        ],
        error: null,
      },
      authUser: { data: { user: { email: 'dueno@courier.cl' } } },
    });

    const resultado = await resolverDestinatarioCourier(client as never, 'tenant-a');

    expect(resultado).toEqual({ email: 'dueno@courier.cl', nombreTenant: 'Courier Uno' });
    expect(client.auth.admin.getUserById).toHaveBeenCalledWith('user-dueno');
  });

  it('sin dueño entre los internos → cae al primero disponible', async () => {
    const client = crearMockSupabase({
      tenant: { data: { nombre_fantasia: 'Courier Dos' }, error: null },
      internos: { data: [{ id: 'user-supervisor', rol: 'supervisor' }], error: null },
      authUser: { data: { user: { email: 'supervisor@courier.cl' } } },
    });

    const resultado = await resolverDestinatarioCourier(client as never, 'tenant-b');

    expect(resultado.email).toBe('supervisor@courier.cl');
  });

  it('sin ningún usuario interno resoluble → email null (no lanza)', async () => {
    const client = crearMockSupabase({
      tenant: { data: { nombre_fantasia: 'Courier Tres' }, error: null },
      internos: { data: [], error: null },
    });

    const resultado = await resolverDestinatarioCourier(client as never, 'tenant-c');

    expect(resultado).toEqual({ email: null, nombreTenant: 'Courier Tres' });
  });
});

describe('yaSeNotifico', () => {
  it('sin fila previa → false', async () => {
    const client = crearMockSupabase({ bitacora: { data: null, error: null } });
    const resultado = await yaSeNotifico(client as never, {
      tenantId: 'tenant-a',
      accion: 'plataforma.notificacion_pago_confirmado',
      entidadId: 'periodo-1',
    });
    expect(resultado).toBe(false);
  });

  it('con fila previa (dedup "siempre") → true', async () => {
    const client = crearMockSupabase({ bitacora: { data: { id: 'bit-1' }, error: null } });
    const resultado = await yaSeNotifico(client as never, {
      tenantId: 'tenant-a',
      accion: 'plataforma.notificacion_pago_confirmado',
      entidadId: 'periodo-1',
    });
    expect(resultado).toBe(true);
  });

  it('error de lectura → false (nunca bloquea la notificación por un error de bitácora)', async () => {
    const client = crearMockSupabase({ bitacora: { data: null, error: { message: 'boom' } } });
    const resultado = await yaSeNotifico(client as never, {
      tenantId: 'tenant-a',
      accion: 'x',
      entidadId: 'y',
      soloHoy: true,
    });
    expect(resultado).toBe(false);
  });
});

describe('registrarNotificacionEnviada', () => {
  it('delega en registrarEnBitacora con actor sistema', async () => {
    const client = crearMockSupabase();
    await registrarNotificacionEnviada(client as never, {
      tenantId: 'tenant-a',
      accion: 'plataforma.notificacion_pago_confirmado',
      entidadTipo: 'periodo_suscripcion',
      entidadId: 'periodo-1',
      detalle: { monto_clp: 49000 },
    });

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'plataforma.notificacion_pago_confirmado',
        entidadTipo: 'periodo_suscripcion',
        entidadId: 'periodo-1',
      }),
    );
  });
});

describe('enviarNotificacionEmail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin destinatario (email null) → NO intenta enviar, modo=sin_destinatario', async () => {
    const resultado = await enviarNotificacionEmail({ para: null, asunto: 'x', html: '<p>x</p>' });
    expect(resultado).toEqual({ intentado: false, enviado: false, modo: 'sin_destinatario' });
    expect(obtenerPuertoEmail).not.toHaveBeenCalled();
  });

  it('con destinatario → delega en el puerto de email', async () => {
    const enviarEmail = vi.fn().mockResolvedValue({ enviado: true, modo: 'real', proveedorId: 'msg-1' });
    vi.mocked(obtenerPuertoEmail).mockReturnValue({ enviarEmail });

    const resultado = await enviarNotificacionEmail({
      para: 'dueno@courier.cl',
      asunto: 'Pago recibido',
      html: '<p>ok</p>',
      texto: 'ok',
    });

    expect(enviarEmail).toHaveBeenCalledWith({
      para: 'dueno@courier.cl',
      asunto: 'Pago recibido',
      html: '<p>ok</p>',
      texto: 'ok',
    });
    expect(resultado).toEqual({ intentado: true, enviado: true, modo: 'real', errorDescripcion: undefined });
  });
});

describe('constructores de contenido — placeholders funcionales', () => {
  it('construirEmailPagoConfirmado incluye el monto CLP y el período formateados', () => {
    const c = construirEmailPagoConfirmado({
      nombreTenant: 'Courier Uno',
      montoClp: 49000,
      periodoInicio: '2026-07-01',
      periodoFin: '2026-07-31',
    });
    // El asunto YA NO lleva el nombre del producto: lo dice el remitente, y
    // esos seis caracteres se comen el hecho en la bandeja del teléfono
    // (sistema de mensajes §9.1, regla de asunto). Los de dinero llevan el
    // monto, que es lo que decide si se abre ahora o después.
    expect(c.asunto).toContain('$49.000');
    expect(c.asunto).not.toContain('Rutax');
    expect(c.html).toContain('$49.000');
    expect(c.html).toContain('01-07-2026');
    expect(c.html).toContain('31-07-2026');
    expect(c.texto).toContain('$49.000');
  });

  it('construirEmailCobroFallido: reintentable=true menciona el reintento automático', () => {
    const c = construirEmailCobroFallido({
      nombreTenant: 'Courier Uno',
      montoClp: 49000,
      periodoInicio: '2026-07-01',
      periodoFin: '2026-07-31',
      reintentable: true,
    });
    expect(c.html).toContain('Reintentaremos');
  });

  it('construirEmailCobroFallido: reintentable=false pide revisar el mandato', () => {
    const c = construirEmailCobroFallido({
      nombreTenant: 'Courier Uno',
      montoClp: 49000,
      periodoInicio: '2026-07-01',
      periodoFin: '2026-07-31',
      reintentable: false,
    });
    expect(c.html).toContain('método de pago');
  });

  it('construirEmailTrialPorVencer incluye los días restantes en el asunto', () => {
    const c = construirEmailTrialPorVencer({ nombreTenant: 'Courier Uno', trialHasta: '2026-07-20', diasRestantes: 3 });
    expect(c.asunto).toContain('3 días');
    expect(c.html).toContain('20-07-2026');
  });

  it('construirEmailSuscripcionCreada sin trial omite el bloque de trial', () => {
    const c = construirEmailSuscripcionCreada({ nombreTenant: 'Courier Uno', trialHasta: null });
    expect(c.html).not.toContain('período de prueba dura');
  });

  it('construirEmailSuscripcionCreada con trial lo menciona', () => {
    const c = construirEmailSuscripcionCreada({ nombreTenant: 'Courier Uno', trialHasta: '2026-08-01' });
    expect(c.html).toContain('01-08-2026');
  });

  it('construirEmailPlanCambiado con ajuste > 0 lo incluye; sin ajuste lo omite', () => {
    const conAjuste = construirEmailPlanCambiado({
      nombreTenant: 'Courier Uno',
      tipo: 'upgrade',
      montoAjusteClp: 16452,
      efectivoDesde: '2026-07-15',
    });
    expect(conAjuste.html).toContain('$16.452');

    const sinAjuste = construirEmailPlanCambiado({
      nombreTenant: 'Courier Uno',
      tipo: 'downgrade',
      montoAjusteClp: null,
      efectivoDesde: '2026-08-01',
    });
    expect(sinAjuste.html).not.toContain('cargo prorrateado');
  });

  it('construirEmailPeriodoVencido incluye monto y período', () => {
    const c = construirEmailPeriodoVencido({
      nombreTenant: 'Courier Uno',
      montoClp: 49000,
      periodoInicio: '2026-06-01',
      periodoFin: '2026-06-30',
    });
    expect(c.html).toContain('$49.000');
    expect(c.html).toContain('vencido');
  });

  it('construirEmailComunicacion arma el asunto con el título y el cuerpo en el HTML/texto', () => {
    const c = construirEmailComunicacion({
      nombreTenant: 'Courier Uno',
      titulo: 'Mantención programada',
      cuerpo: 'El sábado 20-07 habrá una ventana de mantención de 02:00 a 04:00.',
    });
    // Sin «— Rutax» por lo mismo: el remitente ya lo dice.
    expect(c.asunto).toBe('Mantención programada');
    // El «Hola X» se fue con los placeholders: el titular dice el hecho, y
    // saludar por nombre en un correo de sistema no aporta nada.
    expect(c.html).toContain('Mantención programada');
    expect(c.html).toContain('El sábado 20-07 habrá una ventana de mantención de 02:00 a 04:00.');
    expect(c.texto).toContain('Mantención programada');
    expect(c.texto).toContain('El sábado 20-07 habrá una ventana de mantención de 02:00 a 04:00.');
  });

  it('construirEmailComunicacion parte el cuerpo multilínea en párrafos HTML', () => {
    const c = construirEmailComunicacion({
      nombreTenant: 'Courier Uno',
      titulo: 'Novedad',
      cuerpo: 'Primera línea.\nSegunda línea.',
    });
    // Cada línea sigue siendo su propio párrafo; lo que cambió es que ahora
    // lleva margen en línea (el correo no puede depender de una hoja de
    // estilos) y que el texto se ESCAPA: este cuerpo lo escribe un super-admin
    // en el backstage, así que es el único que no está en el código.
    expect(c.html).toContain('>Primera línea.</p>');
    expect(c.html).toContain('>Segunda línea.</p>');
  });
});
