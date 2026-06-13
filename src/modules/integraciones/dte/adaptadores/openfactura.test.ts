/**
 * Tests del adaptador Openfactura — construcción del payload de emisión,
 * en particular la referencia completa de notas de crédito (decisión B5b).
 *
 * Estrategia: se mockea `fetch` global (el adaptador es una hoja del grafo y
 * estos tests NUNCA tocan la red). Cada test emite vía `emitirFactura` y
 * captura el body del POST a `/v2/dte/document` para asertar sobre el
 * `dte.Referencia` construido.
 *
 * Detalles SII verificados contra el "Formato Documentos Tributarios
 * Electrónicos" v2.5 (2026-02, sii.cl):
 * - `CodRef`: 1 = anula documento, 2 = corrige texto, 3 = corrige montos.
 * - `RazonRef`: máximo 90 caracteres (subió de 30 a 90) — se trunca antes
 *   de enviar porque el SII rechaza glosas más largas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenfacturaAdapter, RAZON_REF_MAX_CARACTERES } from './openfactura';
import type { EmitirFacturaEntrada } from '../tipos';

const TENANT_ID = 'tenant-test-uuid';
const BASE_URL_TEST = 'https://openfactura.test';

/** Entrada base válida (factura tipo 33, sin referencia). */
function entradaBase(folio: number): EmitirFacturaEntrada {
  return {
    rutEmisor: '76.123.456-7',
    razonSocialEmisor: 'Courier Test SpA',
    rutReceptor: '12.345.678-9',
    razonSocialReceptor: 'Seller Test Ltda.',
    emailReceptor: 'seller@test.cl',
    fechaEmision: '2026-06-12',
    folio,
    lineas: [
      { nombre: 'Entrega Flex', cantidad: 10, precioUnitarioNetoCLP: 3_500 },
    ],
  };
}

/** Shape mínimo del body capturado que nos interesa asertar. */
interface BodyCapturado {
  dte: {
    Encabezado: { IdDoc: { TipoDTE: number; Folio: number } };
    Referencia?: Array<{
      NroLinRef: number;
      TpoDocRef: string;
      FolioRef: number;
      CodRef?: number;
      RazonRef?: string;
    }>;
  };
}

describe('OpenfacturaAdapter — payload de emisión (referencia NC, B5b)', () => {
  /** Bodies capturados por el mock de fetch, en orden de llamada. */
  let bodies: BodyCapturado[];
  /** Headers capturados (para verificar Idempotency-Key sin exponer secretos). */
  let headersCapturados: Array<Record<string, string>>;

  beforeEach(() => {
    bodies = [];
    headersCapturados = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as BodyCapturado);
        headersCapturados.push({ ...(init?.headers as Record<string, string>) });
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ TOKEN: 'tok-abc123', FOLIO: 1 }),
        } as unknown as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function adaptador(): OpenfacturaAdapter {
    return new OpenfacturaAdapter('apikey-de-prueba', BASE_URL_TEST);
  }

  it('(a) tipo 61 con codigoReferencia y razonReferencia → CodRef/RazonRef correctos', async () => {
    const entrada: EmitirFacturaEntrada = {
      ...entradaBase(500),
      folioDocumentoReferencia: 321,
      tipoDocumentoReferencia: 33,
      codigoReferencia: 3,
      razonReferencia: 'Corrige monto por entregas anuladas',
    };

    const resultado = await adaptador().emitirFactura(TENANT_ID, entrada);

    expect(resultado.tipoDocumento).toBe(61);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].dte.Encabezado.IdDoc.TipoDTE).toBe(61);
    expect(bodies[0].dte.Referencia).toEqual([
      {
        NroLinRef: 1,
        TpoDocRef: '33',
        FolioRef: 321,
        CodRef: 3,
        RazonRef: 'Corrige monto por entregas anuladas',
      },
    ]);
  });

  it('(b) razonReferencia > 90 caracteres → RazonRef truncada a exactamente 90', async () => {
    const glosaLarga = 'X'.repeat(120);
    const entrada: EmitirFacturaEntrada = {
      ...entradaBase(501),
      folioDocumentoReferencia: 321,
      tipoDocumentoReferencia: 33,
      codigoReferencia: 1,
      razonReferencia: glosaLarga,
    };

    await adaptador().emitirFactura(TENANT_ID, entrada);

    const razonEnviada = bodies[0].dte.Referencia?.[0].RazonRef;
    expect(razonEnviada).toHaveLength(RAZON_REF_MAX_CARACTERES);
    expect(razonEnviada).toHaveLength(90);
    expect(razonEnviada).toBe(glosaLarga.slice(0, 90));
  });

  it('(b bis) razonReferencia de exactamente 90 caracteres pasa intacta', async () => {
    const glosaJusta = 'R'.repeat(90);
    const entrada: EmitirFacturaEntrada = {
      ...entradaBase(502),
      folioDocumentoReferencia: 321,
      tipoDocumentoReferencia: 33,
      razonReferencia: glosaJusta,
    };

    await adaptador().emitirFactura(TENANT_ID, entrada);

    expect(bodies[0].dte.Referencia?.[0].RazonRef).toBe(glosaJusta);
  });

  it('(c) referencia sin codigoReferencia → CodRef = 1 (anula documento, default MVP)', async () => {
    const entrada: EmitirFacturaEntrada = {
      ...entradaBase(503),
      folioDocumentoReferencia: 777,
      tipoDocumentoReferencia: 33,
      // sin codigoReferencia ni razonReferencia
    };

    await adaptador().emitirFactura(TENANT_ID, entrada);

    const referencia = bodies[0].dte.Referencia?.[0];
    expect(referencia?.CodRef).toBe(1);
    // Sin glosa no se envía RazonRef (campo ausente, no string vacío).
    expect(referencia).not.toHaveProperty('RazonRef');
    expect(referencia?.FolioRef).toBe(777);
    expect(referencia?.TpoDocRef).toBe('33');
  });

  it('factura tipo 33 (sin referencia) → el payload NO lleva Referencia', async () => {
    await adaptador().emitirFactura(TENANT_ID, entradaBase(504));

    expect(bodies[0].dte.Encabezado.IdDoc.TipoDTE).toBe(33);
    expect(bodies[0].dte.Referencia).toBeUndefined();
  });

  it('la Idempotency-Key de una NC usa el tipo 61 (reintentos no duplican)', async () => {
    const entrada: EmitirFacturaEntrada = {
      ...entradaBase(505),
      folioDocumentoReferencia: 321,
      tipoDocumentoReferencia: 33,
      codigoReferencia: 1,
    };

    await adaptador().emitirFactura(TENANT_ID, entrada);

    expect(headersCapturados[0]['Idempotency-Key']).toBe('76.123.456-7-61-505');
  });
});
