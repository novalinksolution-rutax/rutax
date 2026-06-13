/**
 * Tests del adaptador SimpleFactura — función `calcularMontos` y stub
 * de `SimplefacturaAdapter.emitirFactura`.
 *
 * Todos los tests son unitarios puros: no golpean la red, no usan Supabase,
 * no requieren variables de entorno. La función `calcularMontos` es pura
 * (sin side effects), lo que hace estos tests deterministas.
 */

import { describe, it, expect } from 'vitest';
import { calcularMontos, SimplefacturaAdapter } from './simplefactura';
import { ErrorFolioAgotado } from '../errores';
import type { LineaDetalleDte, EmitirFacturaEntrada } from '../tipos';

// ---------------------------------------------------------------------------
// calcularMontos — función pura
// ---------------------------------------------------------------------------

describe('calcularMontos', () => {
  it('lista vacía → neto 0, iva 0, total 0', () => {
    const resultado = calcularMontos([]);
    expect(resultado).toEqual({ neto: 0, iva: 0, total: 0 });
  });

  it('una línea de $10.000 → neto 10.000, iva 1.900, total 11.900', () => {
    const lineas: LineaDetalleDte[] = [
      { nombre: 'Entrega Flex', cantidad: 1, precioUnitarioNetoCLP: 10_000 },
    ];
    const resultado = calcularMontos(lineas);
    expect(resultado.neto).toBe(10_000);
    expect(resultado.iva).toBe(1_900);
    expect(resultado.total).toBe(11_900);
  });

  it('dos líneas sumando $20.000 → neto 20.000, iva 3.800, total 23.800', () => {
    const lineas: LineaDetalleDte[] = [
      { nombre: 'Entrega Flex', cantidad: 1, precioUnitarioNetoCLP: 10_000 },
      { nombre: 'Entrega Same-Day', cantidad: 2, precioUnitarioNetoCLP: 5_000 },
    ];
    const resultado = calcularMontos(lineas);
    expect(resultado.neto).toBe(20_000);
    expect(resultado.iva).toBe(3_800);
    expect(resultado.total).toBe(23_800);
  });

  it('con descuento: línea $10.000 con descuento $1.000 → neto 9.000', () => {
    const lineas: LineaDetalleDte[] = [
      {
        nombre: 'Entrega Flex con ajuste',
        cantidad: 1,
        precioUnitarioNetoCLP: 10_000,
        descuentoCLP: 1_000,
      },
    ];
    const resultado = calcularMontos(lineas);
    expect(resultado.neto).toBe(9_000);
    expect(resultado.iva).toBe(Math.round(9_000 * 0.19));
    expect(resultado.total).toBe(resultado.neto + resultado.iva);
  });

  it('IVA redondeado a entero — sin decimales (NUMERIC(12,0))', () => {
    // $100 → IVA exacto: 100 * 0.19 = 19 (sin decimales problemáticos)
    const lineas1: LineaDetalleDte[] = [
      { nombre: 'Servicio', cantidad: 1, precioUnitarioNetoCLP: 100 },
    ];
    const r1 = calcularMontos(lineas1);
    expect(Number.isInteger(r1.iva)).toBe(true);

    // $1 → IVA: Math.round(0.19) = 0
    const lineas2: LineaDetalleDte[] = [
      { nombre: 'Servicio mínimo', cantidad: 1, precioUnitarioNetoCLP: 1 },
    ];
    const r2 = calcularMontos(lineas2);
    expect(Number.isInteger(r2.iva)).toBe(true);
    expect(r2.iva).toBe(0);

    // $1.000 → IVA: 190 (exacto)
    const lineas3: LineaDetalleDte[] = [
      { nombre: 'Servicio', cantidad: 1, precioUnitarioNetoCLP: 1_000 },
    ];
    const r3 = calcularMontos(lineas3);
    expect(Number.isInteger(r3.iva)).toBe(true);
    expect(r3.iva).toBe(190);

    // $537 → IVA: Math.round(537 * 0.19) = Math.round(102.03) = 102
    const lineas4: LineaDetalleDte[] = [
      { nombre: 'Servicio fracción', cantidad: 1, precioUnitarioNetoCLP: 537 },
    ];
    const r4 = calcularMontos(lineas4);
    expect(Number.isInteger(r4.iva)).toBe(true);
    expect(r4.iva).toBe(Math.round(537 * 0.19));
  });

  it('cantidad > 1 multiplica correctamente', () => {
    const lineas: LineaDetalleDte[] = [
      { nombre: 'Entrega', cantidad: 3, precioUnitarioNetoCLP: 5_000 },
    ];
    const resultado = calcularMontos(lineas);
    expect(resultado.neto).toBe(15_000);
    expect(resultado.iva).toBe(Math.round(15_000 * 0.19));
    expect(resultado.total).toBe(resultado.neto + resultado.iva);
  });
});

// ---------------------------------------------------------------------------
// SimplefacturaAdapter.emitirFactura — stub
// ---------------------------------------------------------------------------

/**
 * Entrada válida de prueba para reutilizar en tests del stub.
 */
function entradaValida(folio: number): EmitirFacturaEntrada {
  return {
    rutEmisor: '76.123.456-7',
    razonSocialEmisor: 'Courier Test SpA',
    rutReceptor: '12.345.678-9',
    razonSocialReceptor: 'Seller Test Ltda.',
    emailReceptor: 'seller@test.cl',
    fechaEmision: '2026-06-09',
    folio,
    lineas: [
      { nombre: 'Entrega Flex', cantidad: 10, precioUnitarioNetoCLP: 3_500 },
    ],
  };
}

describe('SimplefacturaAdapter.emitirFactura (stub)', () => {
  const adapter = new SimplefacturaAdapter(null);
  const TENANT_ID = 'tenant-test-uuid';

  it('folio = 0 → lanza ErrorFolioAgotado', async () => {
    await expect(
      adapter.emitirFactura(TENANT_ID, entradaValida(0)),
    ).rejects.toBeInstanceOf(ErrorFolioAgotado);
  });

  it('folio negativo → lanza ErrorFolioAgotado', async () => {
    await expect(
      adapter.emitirFactura(TENANT_ID, entradaValida(-1)),
    ).rejects.toBeInstanceOf(ErrorFolioAgotado);
  });

  it('folio > 0 → devuelve resultado con idExternoProveedor = STUB-{folio}', async () => {
    const resultado = await adapter.emitirFactura(TENANT_ID, entradaValida(42));
    expect(resultado.idExternoProveedor).toBe('STUB-42');
    expect(resultado.folio).toBe(42);
  });

  it('folio > 0 → estadoSii = pendiente y URLs nulas', async () => {
    const resultado = await adapter.emitirFactura(TENANT_ID, entradaValida(1));
    expect(resultado.estadoSii).toBe('pendiente');
    expect(resultado.xmlUrl).toBeNull();
    expect(resultado.pdfUrl).toBeNull();
  });

  it('montoTotalCLP = monto_neto + monto_iva (aritmética)', async () => {
    const resultado = await adapter.emitirFactura(TENANT_ID, entradaValida(7));
    // 10 entregas * $3.500 = $35.000 neto
    // IVA = Math.round(35.000 * 0.19) = 6.650
    // Total = 35.000 + 6.650 = 41.650
    expect(resultado.montoNetoCLP).toBe(35_000);
    expect(resultado.montoIvaCLP).toBe(6_650);
    expect(resultado.montoTotalCLP).toBe(resultado.montoNetoCLP + resultado.montoIvaCLP);
    expect(resultado.montoTotalCLP).toBe(41_650);
  });

  it('sin referencia → tipoDocumento 33 (factura electrónica)', async () => {
    const resultado = await adapter.emitirFactura(TENANT_ID, entradaValida(99));
    expect(resultado.tipoDocumento).toBe(33);
  });

  // ---------------------------------------------------------------------------
  // Notas de crédito (tipo 61) — referencia completa (decisión B5b)
  // ---------------------------------------------------------------------------

  it('con referencia a otro documento → tipoDocumento 61 (nota de crédito), sin regresión', async () => {
    const entrada: EmitirFacturaEntrada = {
      ...entradaValida(100),
      folioDocumentoReferencia: 42,
      tipoDocumentoReferencia: 33,
    };
    const resultado = await adapter.emitirFactura(TENANT_ID, entrada);
    expect(resultado.tipoDocumento).toBe(61);
    expect(resultado.idExternoProveedor).toBe('STUB-100');
    expect(resultado.estadoSii).toBe('pendiente');
    // El monto del stub sigue saliendo de calcularMontos, igual que antes.
    expect(resultado.montoTotalCLP).toBe(resultado.montoNetoCLP + resultado.montoIvaCLP);
  });

  it('los campos nuevos codigoReferencia/razonReferencia no causan error en el stub', async () => {
    const entrada: EmitirFacturaEntrada = {
      ...entradaValida(101),
      folioDocumentoReferencia: 42,
      tipoDocumentoReferencia: 33,
      codigoReferencia: 1,
      razonReferencia: 'Anula factura por entregas no realizadas en el período',
    };
    const resultado = await adapter.emitirFactura(TENANT_ID, entrada);
    expect(resultado.tipoDocumento).toBe(61);
    expect(resultado.folio).toBe(101);
  });
});
