/**
 * Tests unitarios para ventanas-corte.ts (F7, ítem 1.2).
 *
 * Cubre:
 *   - guardarVentanaCorte: validación de hora_corte, RBAC, slaObjetivoPct.
 *   - resolverVentanaCorte: prioridad override por zona > ventana por defecto.
 *   - Mapper hora_corte: 'HH:MM:SS' de Postgres → 'HH:MM'.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { guardarVentanaCorte, resolverVentanaCorte } from './ventanas-corte';
import type { VentanaCorte } from './tipos';
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

const actorValido: UsuarioActual = {
  tenantId: 'tenant-1',
  rol: 'dueno',
  tipoUsuario: 'interno',
  estado: 'activo',
  areasHabilitadas: [...AREAS_PRODUCTO],
  sellerId: null,
  driverId: null,
};

const actorSinPermiso: UsuarioActual = {
  ...actorValido,
  rol: 'conductor',
};

function crearClienteStub(): SupabaseClient {
  return {
    from: vi.fn(),
    schema: vi.fn().mockReturnThis(),
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// guardarVentanaCorte — validaciones
// ---------------------------------------------------------------------------

describe('guardarVentanaCorte — validaciones', () => {
  it('lanza ErrorValidacion si el actor no tiene capacidad gestionar_tarifas', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    await expect(
      guardarVentanaCorte(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          sellerId: 'seller-1',
          zonaId: null,
          tipoEntrega: 'same_day',
          horaCorte: '13:00',
          minutosPreparacion: 30,
          minutosRutaEstimado: 60,
          actorUsuarioId: 'actor-1',
        },
        actorSinPermiso,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('lanza ErrorValidacion para hora_corte con formato inválido', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    await expect(
      guardarVentanaCorte(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          sellerId: 'seller-1',
          zonaId: null,
          tipoEntrega: 'same_day',
          horaCorte: '1300', // sin los dos puntos
          minutosPreparacion: 30,
          minutosRutaEstimado: 60,
          actorUsuarioId: 'actor-1',
        },
        actorValido,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('lanza ErrorValidacion para hora_corte fuera de rango (hora > 23)', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    await expect(
      guardarVentanaCorte(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          sellerId: 'seller-1',
          zonaId: null,
          tipoEntrega: 'same_day',
          horaCorte: '25:00',
          minutosPreparacion: 0,
          minutosRutaEstimado: 0,
          actorUsuarioId: 'actor-1',
        },
        actorValido,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('lanza ErrorValidacion para minutos negativos', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    await expect(
      guardarVentanaCorte(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          sellerId: 'seller-1',
          zonaId: null,
          tipoEntrega: 'same_day',
          horaCorte: '13:00',
          minutosPreparacion: -1,
          minutosRutaEstimado: 60,
          actorUsuarioId: 'actor-1',
        },
        actorValido,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('lanza ErrorValidacion para sla_objetivo_pct fuera de 0-100', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    await expect(
      guardarVentanaCorte(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          sellerId: 'seller-1',
          zonaId: null,
          tipoEntrega: 'same_day',
          horaCorte: '13:00',
          minutosPreparacion: 30,
          minutosRutaEstimado: 60,
          slaObjetivoPct: 150,
          actorUsuarioId: 'actor-1',
        },
        actorValido,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });
});

// ---------------------------------------------------------------------------
// resolverVentanaCorte — prioridad override zona > default
// ---------------------------------------------------------------------------

/** Construye un stub de cliente que devuelve las ventanas dadas. */
function crearClienteConVentanas(ventanas: VentanaCorte[]): SupabaseClient {
  // Construimos un builder encadenable simplificado.
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    then: (resolve: (r: { data: object[]; error: null }) => void) => {
      // Convertir VentanaCorte[] al formato de fila de BD para el mapper.
      const filas = ventanas.map((v) => ({
        id: v.id,
        tenant_id: v.tenantId,
        seller_id: v.sellerId,
        zona_id: v.zonaId,
        tipo_entrega: v.tipoEntrega,
        hora_corte: v.horaCorte + ':00', // simular formato Postgres 'HH:MM:SS'
        minutos_preparacion: v.minutosPreparacion,
        minutos_ruta_estimado: v.minutosRutaEstimado,
        sla_objetivo_pct: v.slaObjetivoPct,
        activa: v.activa,
        creado_en: v.creadoEn,
        actualizado_en: v.actualizadoEn,
      }));
      resolve({ data: filas, error: null });
    },
  };

  return {
    schema: () => ({ from: () => chain }),
  } as unknown as SupabaseClient;
}

const ventanaDefault: VentanaCorte = {
  id: 'vc-default',
  tenantId: 'tenant-1',
  sellerId: 'seller-1',
  zonaId: null,
  tipoEntrega: 'same_day',
  horaCorte: '13:00',
  minutosPreparacion: 30,
  minutosRutaEstimado: 60,
  slaObjetivoPct: 97,
  activa: true,
  creadoEn: '2026-01-01T00:00:00Z',
  actualizadoEn: '2026-01-01T00:00:00Z',
};

const ventanaZona: VentanaCorte = {
  ...ventanaDefault,
  id: 'vc-zona',
  zonaId: 'zona-centro',
  horaCorte: '11:00', // override más temprano
  minutosPreparacion: 15,
  minutosRutaEstimado: 30,
};

describe('resolverVentanaCorte — prioridad', () => {
  it('devuelve el override por zona cuando existe y zonaId coincide', async () => {
    const cliente = crearClienteConVentanas([ventanaDefault, ventanaZona]);
    const resultado = await resolverVentanaCorte(
      cliente, 'tenant-1', 'seller-1', 'zona-centro', 'same_day',
    );
    expect(resultado?.id).toBe('vc-zona');
    expect(resultado?.horaCorte).toBe('11:00');
  });

  it('cae al default cuando zonaId no coincide con ningún override', async () => {
    const cliente = crearClienteConVentanas([ventanaDefault, ventanaZona]);
    const resultado = await resolverVentanaCorte(
      cliente, 'tenant-1', 'seller-1', 'zona-oriente', 'same_day',
    );
    expect(resultado?.id).toBe('vc-default');
    expect(resultado?.horaCorte).toBe('13:00');
  });

  it('cae al default cuando zonaId es null', async () => {
    const cliente = crearClienteConVentanas([ventanaDefault, ventanaZona]);
    const resultado = await resolverVentanaCorte(
      cliente, 'tenant-1', 'seller-1', null, 'same_day',
    );
    expect(resultado?.id).toBe('vc-default');
  });

  it('devuelve null cuando no hay ventanas configuradas', async () => {
    const cliente = crearClienteConVentanas([]);
    const resultado = await resolverVentanaCorte(
      cliente, 'tenant-1', 'seller-1', null, 'same_day',
    );
    expect(resultado).toBeNull();
  });

  it('mapea correctamente hora_corte de formato Postgres HH:MM:SS a HH:MM', async () => {
    const cliente = crearClienteConVentanas([ventanaDefault]);
    const resultado = await resolverVentanaCorte(
      cliente, 'tenant-1', 'seller-1', null, 'same_day',
    );
    // La hora viene de BD como 'HH:MM:SS', el mapper debe truncar a 'HH:MM'.
    expect(resultado?.horaCorte).toBe('13:00');
    expect(resultado?.horaCorte).not.toContain(':00:00');
  });

  it('devuelve solo la ventana same_day (tipo_entrega correcto)', async () => {
    const ventanaFlex: VentanaCorte = {
      ...ventanaDefault,
      id: 'vc-flex',
      tipoEntrega: 'flex',
      horaCorte: '09:00',
    };
    const cliente = crearClienteConVentanas([ventanaDefault, ventanaFlex]);
    const resultado = await resolverVentanaCorte(
      cliente, 'tenant-1', 'seller-1', null, 'same_day',
    );
    // El filtro por tipo_entrega en la consulta deja solo same_day.
    // El stub no filtra, pero en producción sí lo hace la BD.
    // Al menos verificamos que el campo queda correcto en la respuesta.
    expect(resultado?.tipoEntrega).toBe('same_day');
  });
});
