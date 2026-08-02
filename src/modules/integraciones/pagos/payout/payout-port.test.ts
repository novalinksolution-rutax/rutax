/**
 * Tests del puerto de PAYOUTS SALIENTES (F19).
 *
 * Cubre los contratos del puerto sin red, sin BD, sin credenciales reales:
 * 1. StubPayoutAdapter — comportamiento sandbox por defecto.
 * 2. StubPayoutAdapter — idempotencia determinística de payoutExternoId.
 * 3. FintocPayoutAdapter — secretKey nula → lanza ErrorPayoutConfig.
 * 4. FintocPayoutAdapter — accountIdOrigen nulo → lanza ErrorPayoutConfig.
 * 5. FintocPayoutAdapter — validarFirmaWebhook (HMAC-SHA256, tolerancia, replay).
 * 6. Fábrica obtenerPuertoPayout — sandbox activo → devuelve StubPayoutAdapter.
 * 7. Fábrica obtenerPuertoPayout — gate real requiere AMBOS flags.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createHmac,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';

import { StubPayoutAdapter } from './adaptadores/stub';
import { FintocPayoutAdapter } from './adaptadores/fintoc';
import { ErrorPayoutConfig } from './errores';
import { obtenerPuertoPayout, payoutSandboxActivo } from './fabrica-payout';
import type { CrearPayoutArgs } from './puerto-payout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Par RSA 2048 efímero para los tests de firma JWS (clave pública para verificar).
const { privateKey: clavePrivadaFirmaTest, publicKey: clavePublicaFirmaTest } =
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

/** Decodifica un segmento base64url a Buffer (inverso del helper del adaptador). */
function desdeBase64url(seg: string): Buffer {
  return Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

const destinatarioBase = {
  rut: '12345678-9',
  nombreCuenta: 'Conductor Demo',
  banco: 'banco_estado',
  tipoCuenta: 'vista',
  numeroCuenta: '1234567890',
};

function argsCrearPayout(idempotencyKey: string, monto = 50000): CrearPayoutArgs {
  return {
    idempotencyKey,
    montoLiquidoClp: monto,
    destinatario: destinatarioBase,
    referencia: `Liquidacion test-${idempotencyKey}`,
  };
}

/**
 * Genera un header de firma HMAC-SHA256 en el formato que usa Fintoc/el adaptador:
 * `t=<timestamp>,v1=<hex>` donde el mensaje firmado es `<timestamp>.<cuerpo>`.
 */
function generarFirmaValida(cuerpo: string, secreto: string, timestampSeg?: number): string {
  const ts = timestampSeg ?? Math.floor(Date.now() / 1000);
  const mensaje = `${ts}.${cuerpo}`;
  const hex = createHmac('sha256', secreto).update(mensaje, 'utf8').digest('hex');
  return `t=${ts},v1=${hex}`;
}

// ---------------------------------------------------------------------------
// 1. StubPayoutAdapter — sandbox gate activo por defecto
// ---------------------------------------------------------------------------

describe('StubPayoutAdapter — sandbox gate activo por defecto', () => {
  const stub = new StubPayoutAdapter();

  it('crearPayout devuelve estado=enviado con payoutExternoId determinístico', async () => {
    const resultado = await stub.crearPayout(argsCrearPayout('payout-liq-123'));

    expect(resultado.estado).toBe('enviado');
    expect(resultado.payoutExternoId).toBe('SANDBOX-PAYOUT-payout-liq-123');
  });

  it('misma llamada con misma key produce el mismo payoutExternoId (idempotente)', async () => {
    const args = argsCrearPayout('payout-liq-abc');

    const r1 = await stub.crearPayout(args);
    const r2 = await stub.crearPayout(args);

    expect(r1.payoutExternoId).toBe(r2.payoutExternoId);
    expect(r1.payoutExternoId).toBe('SANDBOX-PAYOUT-payout-liq-abc');
  });

  it('consultarPayout devuelve estado=confirmado (sandbox — instantáneo)', async () => {
    const resultado = await stub.consultarPayout({ payoutExternoId: 'SANDBOX-PAYOUT-payout-liq-123' });

    expect(resultado.estado).toBe('confirmado');
    expect(resultado.payoutExternoId).toBe('SANDBOX-PAYOUT-payout-liq-123');
  });

  it('validarFirmaWebhook siempre devuelve false (stub no procesa webhooks)', () => {
    const valido = stub.validarFirmaWebhook({
      cuerpo: '{"event":"transfer.succeeded"}',
      firma: 't=1700000000,v1=abc123',
      secreto: 'secreto-test',
    });

    expect(valido).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. StubPayoutAdapter — idempotencia de payoutExternoId
// ---------------------------------------------------------------------------

describe('StubPayoutAdapter — idempotencia determinística', () => {
  const stub = new StubPayoutAdapter();

  it('misma idempotencyKey → mismo payoutExternoId en reintentos', async () => {
    const clave = 'payout-liq-reintento-001';
    const resultados = await Promise.all([
      stub.crearPayout(argsCrearPayout(clave)),
      stub.crearPayout(argsCrearPayout(clave)),
      stub.crearPayout(argsCrearPayout(clave)),
    ]);

    const ids = resultados.map((r) => r.payoutExternoId);
    expect(new Set(ids).size).toBe(1); // todos iguales
    expect(ids[0]).toBe(`SANDBOX-PAYOUT-${clave}`);
  });

  it('distintas idempotencyKeys → distintos payoutExternoIds', async () => {
    const r1 = await stub.crearPayout(argsCrearPayout('payout-liq-A'));
    const r2 = await stub.crearPayout(argsCrearPayout('payout-liq-B'));

    expect(r1.payoutExternoId).not.toBe(r2.payoutExternoId);
    expect(r1.payoutExternoId).toBe('SANDBOX-PAYOUT-payout-liq-A');
    expect(r2.payoutExternoId).toBe('SANDBOX-PAYOUT-payout-liq-B');
  });
});

// ---------------------------------------------------------------------------
// 3. FintocPayoutAdapter — secretKey nula → ErrorPayoutConfig
// ---------------------------------------------------------------------------

describe('FintocPayoutAdapter — secretKey nula lanza ErrorPayoutConfig', () => {
  it('crearPayout lanza ErrorPayoutConfig cuando secretKeyOrg es null', async () => {
    const adaptador = new FintocPayoutAdapter({
      secretKeyOrg: null,
      accountIdOrigen: 'acc-origen-1',
      clavePrivadaFirmaPem: clavePrivadaFirmaTest,
    });

    await expect(adaptador.crearPayout(argsCrearPayout('payout-test'))).rejects.toBeInstanceOf(
      ErrorPayoutConfig,
    );
  });

  it('el mensaje del error NO contiene la API key (que es null)', async () => {
    const adaptador = new FintocPayoutAdapter({
      secretKeyOrg: null,
      accountIdOrigen: 'acc-origen-1',
      clavePrivadaFirmaPem: clavePrivadaFirmaTest,
    });

    try {
      await adaptador.crearPayout(argsCrearPayout('payout-test'));
      expect.fail('Debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorPayoutConfig);
      // El mensaje no debe contener literales de clave
      expect((err as Error).message).not.toContain('null');
      expect((err as Error).message).not.toContain('sk_');
      expect((err as Error).message).not.toContain('undefined');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. FintocPayoutAdapter — accountIdOrigen nulo → ErrorPayoutConfig
// ---------------------------------------------------------------------------

describe('FintocPayoutAdapter — accountIdOrigen nulo lanza ErrorPayoutConfig', () => {
  it('crearPayout lanza ErrorPayoutConfig cuando accountIdOrigen es null', async () => {
    const adaptador = new FintocPayoutAdapter({
      secretKeyOrg: 'sk_test_valida',
      accountIdOrigen: null,
      clavePrivadaFirmaPem: clavePrivadaFirmaTest,
    });

    await expect(adaptador.crearPayout(argsCrearPayout('payout-test'))).rejects.toBeInstanceOf(
      ErrorPayoutConfig,
    );
  });

  it('el error de account_id faltante es ErrorPayoutConfig (no ErrorPayoutOperativo)', async () => {
    const adaptador = new FintocPayoutAdapter({
      secretKeyOrg: 'sk_test_valida',
      accountIdOrigen: null,
      clavePrivadaFirmaPem: clavePrivadaFirmaTest,
    });

    try {
      await adaptador.crearPayout(argsCrearPayout('payout-test'));
      expect.fail('Debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorPayoutConfig);
      // ErrorPayoutConfig tiene reintentable=false (no reintentable)
      expect((err as ErrorPayoutConfig).reintentable).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4b. FintocPayoutAdapter — falta clave de firma JWS → ErrorPayoutConfig
// ---------------------------------------------------------------------------

describe('FintocPayoutAdapter — clave de firma nula lanza ErrorPayoutConfig', () => {
  it('crearPayout lanza ErrorPayoutConfig (no reintentable) cuando clavePrivadaFirmaPem es null', async () => {
    const adaptador = new FintocPayoutAdapter({
      secretKeyOrg: 'sk_test_valida',
      accountIdOrigen: 'acc-origen-1',
      clavePrivadaFirmaPem: null,
    });

    try {
      await adaptador.crearPayout(argsCrearPayout('payout-sin-firma'));
      expect.fail('Debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorPayoutConfig);
      expect((err as ErrorPayoutConfig).reintentable).toBe(false);
      // El mensaje describe qué falta, sin exponer ninguna clave.
      expect((err as Error).message).toContain('payout_clave_firma_privada');
      expect((err as Error).message).not.toContain('PRIVATE KEY');
    }
  });
});

// ---------------------------------------------------------------------------
// 4c. FintocPayoutAdapter — firma JWS de transferencias salientes (detached RS256)
// ---------------------------------------------------------------------------

describe('FintocPayoutAdapter — firma Fintoc-JWS-Signature en crearPayout', () => {
  const adaptador = new FintocPayoutAdapter(
    {
      secretKeyOrg: 'sk_test_valida',
      accountIdOrigen: 'acc-origen-1',
      clavePrivadaFirmaPem: clavePrivadaFirmaTest,
    },
    'https://api.test.local/v2',
  );

  const fetchOriginal = globalThis.fetch;
  let solicitudCapturada: { headers: Record<string, string>; body: string } | null = null;

  beforeEach(() => {
    solicitudCapturada = null;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      solicitudCapturada = { headers, body: init.body as string };
      return new Response(JSON.stringify({ id: 'tf_test_1', status: 'pending' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it('envía el header Fintoc-JWS-Signature con forma detached `protected.firma`', async () => {
    await adaptador.crearPayout(argsCrearPayout('payout-firma-ok'));

    expect(solicitudCapturada).not.toBeNull();
    const jws = solicitudCapturada!.headers['Fintoc-JWS-Signature'];
    expect(typeof jws).toBe('string');
    // Detached: exactamente dos segmentos (protected.firma) — el payload se omite.
    expect(jws.split('.')).toHaveLength(2);
  });

  it('el header protegido es RS256 con nonce, ts y crit=[ts,nonce]', async () => {
    await adaptador.crearPayout(argsCrearPayout('payout-firma-header'));

    const [protectedB64] = solicitudCapturada!.headers['Fintoc-JWS-Signature'].split('.');
    const header = JSON.parse(desdeBase64url(protectedB64).toString('utf8'));

    expect(header.alg).toBe('RS256');
    expect(typeof header.nonce).toBe('string');
    expect(header.nonce.length).toBeGreaterThan(0);
    expect(typeof header.ts).toBe('number');
    expect(header.crit).toEqual(['ts', 'nonce']);
  });

  it('la firma detached VERIFICA contra la clave pública sobre `protected.payload(body)`', async () => {
    await adaptador.crearPayout(argsCrearPayout('payout-firma-verifica'));

    const { headers, body } = solicitudCapturada!;
    const [protectedB64, firmaB64] = headers['Fintoc-JWS-Signature'].split('.');

    // Reconstruir la entrada de firma desde el body REAL enviado (detached).
    const payloadB64 = Buffer.from(body, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const entradaFirma = `${protectedB64}.${payloadB64}`;

    const verificado = createVerify('RSA-SHA256')
      .update(entradaFirma, 'utf8')
      .verify(clavePublicaFirmaTest, desdeBase64url(firmaB64));

    expect(verificado).toBe(true);
  });

  it('si el body se altera, la firma capturada NO verifica (integridad)', async () => {
    await adaptador.crearPayout(argsCrearPayout('payout-firma-tamper'));

    const { headers } = solicitudCapturada!;
    const [protectedB64, firmaB64] = headers['Fintoc-JWS-Signature'].split('.');

    const bodyAlterado = JSON.stringify({ amount: 999999999 });
    const payloadB64 = Buffer.from(bodyAlterado, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const entradaFirma = `${protectedB64}.${payloadB64}`;

    const verificado = createVerify('RSA-SHA256')
      .update(entradaFirma, 'utf8')
      .verify(clavePublicaFirmaTest, desdeBase64url(firmaB64));

    expect(verificado).toBe(false);
  });

  it('dos transferencias generan nonces distintos (anti-replay)', async () => {
    await adaptador.crearPayout(argsCrearPayout('payout-nonce-1'));
    const [p1] = solicitudCapturada!.headers['Fintoc-JWS-Signature'].split('.');
    const nonce1 = JSON.parse(desdeBase64url(p1).toString('utf8')).nonce;

    await adaptador.crearPayout(argsCrearPayout('payout-nonce-2'));
    const [p2] = solicitudCapturada!.headers['Fintoc-JWS-Signature'].split('.');
    const nonce2 = JSON.parse(desdeBase64url(p2).toString('utf8')).nonce;

    expect(nonce1).not.toBe(nonce2);
  });

  it('el body firmado es EXACTAMENTE el body enviado (misma serialización)', async () => {
    await adaptador.crearPayout(argsCrearPayout('payout-body-igual'));

    // El body es JSON parseable y contiene los campos del contrato Fintoc.
    const enviado = JSON.parse(solicitudCapturada!.body);
    expect(enviado.currency).toBe('CLP');
    expect(enviado.account_id).toBe('acc-origen-1');
    // La firma verificada en el test anterior ya prueba que firma == body.
  });
});

// ---------------------------------------------------------------------------
// 5. FintocPayoutAdapter — validarFirmaWebhook
// ---------------------------------------------------------------------------

describe('FintocPayoutAdapter — validarFirmaWebhook', () => {
  // El adaptador solo necesita la config para instanciarse; la validación de
  // firma no usa la secretKeyOrg ni accountIdOrigen — solo el secreto del webhook.
  const adaptador = new FintocPayoutAdapter({
    secretKeyOrg: 'sk_test_valida',
    accountIdOrigen: 'acc-1',
    clavePrivadaFirmaPem: clavePrivadaFirmaTest,
  });

  const secretoWebhook = 'secreto-webhook-test-muy-largo-y-seguro';
  const cuerpo = JSON.stringify({ event: 'transfer.succeeded', id: 'tf_123' });

  it('firma válida dentro de los 300 segundos → devuelve true', () => {
    const firma = generarFirmaValida(cuerpo, secretoWebhook);

    const valido = adaptador.validarFirmaWebhook({ cuerpo, firma, secreto: secretoWebhook });

    expect(valido).toBe(true);
  });

  it('firma válida pero timestamp > 300s en el pasado → devuelve false (anti-replay)', () => {
    const tsAntiguo = Math.floor(Date.now() / 1000) - 301;
    const firma = generarFirmaValida(cuerpo, secretoWebhook, tsAntiguo);

    const valido = adaptador.validarFirmaWebhook({ cuerpo, firma, secreto: secretoWebhook });

    expect(valido).toBe(false);
  });

  it('firma válida pero timestamp > 300s en el futuro → devuelve false (anti-replay)', () => {
    const tsFuturo = Math.floor(Date.now() / 1000) + 301;
    const firma = generarFirmaValida(cuerpo, secretoWebhook, tsFuturo);

    const valido = adaptador.validarFirmaWebhook({ cuerpo, firma, secreto: secretoWebhook });

    expect(valido).toBe(false);
  });

  it('cuerpo alterado (body tampering) → devuelve false', () => {
    const firma = generarFirmaValida(cuerpo, secretoWebhook);
    const cuerpoCambiado = JSON.stringify({ event: 'transfer.succeeded', id: 'tf_ALTERADO' });

    const valido = adaptador.validarFirmaWebhook({
      cuerpo: cuerpoCambiado,
      firma,
      secreto: secretoWebhook,
    });

    expect(valido).toBe(false);
  });

  it('header de firma con garbage → devuelve false', () => {
    const valido = adaptador.validarFirmaWebhook({
      cuerpo,
      firma: 'esto-no-es-un-header-valido',
      secreto: secretoWebhook,
    });

    expect(valido).toBe(false);
  });

  it('header vacío → devuelve false', () => {
    const valido = adaptador.validarFirmaWebhook({ cuerpo, firma: '', secreto: secretoWebhook });

    expect(valido).toBe(false);
  });

  it('secreto incorrecto → devuelve false (firma no cuadra)', () => {
    const firma = generarFirmaValida(cuerpo, secretoWebhook);

    const valido = adaptador.validarFirmaWebhook({
      cuerpo,
      firma,
      secreto: 'secreto-equivocado',
    });

    expect(valido).toBe(false);
  });

  it('firma con v1 truncada (longitud distinta) → devuelve false sin excepción', () => {
    const ts = Math.floor(Date.now() / 1000);
    const firmaCorta = `t=${ts},v1=abc`;

    // No debe lanzar — solo devolver false
    expect(() =>
      adaptador.validarFirmaWebhook({ cuerpo, firma: firmaCorta, secreto: secretoWebhook }),
    ).not.toThrow();

    const valido = adaptador.validarFirmaWebhook({
      cuerpo,
      firma: firmaCorta,
      secreto: secretoWebhook,
    });
    expect(valido).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Fábrica — sandbox activo (env var NOT 'false') → StubPayoutAdapter
// ---------------------------------------------------------------------------

describe('obtenerPuertoPayout — sandbox activo → StubPayoutAdapter', () => {
  const configFintocHabilitado = {
    tenant_id: 'tenant-x',
    payout_real_habilitado: true,
    metodo_default: 'fintoc' as const,
    porcentaje_retencion: 0,
  };

  it('PAYOUT_SANDBOX_MODE no definido → payoutSandboxActivo() devuelve true', () => {
    const prev = process.env.PAYOUT_SANDBOX_MODE;
    delete process.env.PAYOUT_SANDBOX_MODE;
    expect(payoutSandboxActivo()).toBe(true);
    if (prev !== undefined) process.env.PAYOUT_SANDBOX_MODE = prev;
  });

  it('sandbox activo (default) → obtenerPuertoPayout devuelve adaptador que produce SANDBOX-PAYOUT', async () => {
    const prev = process.env.PAYOUT_SANDBOX_MODE;
    delete process.env.PAYOUT_SANDBOX_MODE;

    try {
      const puerto = await obtenerPuertoPayout('tenant-x', {
        config: configFintocHabilitado,
        accountIdOrigen: 'acc-1',
      });

      const resultado = await puerto.crearPayout(argsCrearPayout('payout-liq-sandbox'));
      expect(resultado.payoutExternoId).toMatch(/^SANDBOX-PAYOUT/);
      expect(resultado.estado).toBe('enviado');
    } finally {
      if (prev !== undefined) process.env.PAYOUT_SANDBOX_MODE = prev;
      else delete process.env.PAYOUT_SANDBOX_MODE;
    }
  });

  it('PAYOUT_SANDBOX_MODE=true (string) → sandbox sigue activo (solo "false" lo desactiva)', async () => {
    const prev = process.env.PAYOUT_SANDBOX_MODE;
    process.env.PAYOUT_SANDBOX_MODE = 'true';

    try {
      const puerto = await obtenerPuertoPayout('tenant-x', {
        config: configFintocHabilitado,
        accountIdOrigen: 'acc-1',
      });

      const resultado = await puerto.crearPayout(argsCrearPayout('payout-liq-true-string'));
      expect(resultado.payoutExternoId).toMatch(/^SANDBOX-PAYOUT/);
    } finally {
      if (prev !== undefined) process.env.PAYOUT_SANDBOX_MODE = prev;
      else delete process.env.PAYOUT_SANDBOX_MODE;
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Fábrica — gate real requiere AMBOS flags
// ---------------------------------------------------------------------------

describe('obtenerPuertoPayout — gate real requiere AMBOS flags', () => {
  const configConOptIn = {
    tenant_id: 'tenant-y',
    payout_real_habilitado: true,
    metodo_default: 'fintoc' as const,
    porcentaje_retencion: 0,
  };
  const configSinOptIn = {
    tenant_id: 'tenant-y',
    payout_real_habilitado: false,
    metodo_default: 'fintoc' as const,
    porcentaje_retencion: 0,
  };

  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.PAYOUT_SANDBOX_MODE;
  });

  afterEach(() => {
    if (prevEnv !== undefined) process.env.PAYOUT_SANDBOX_MODE = prevEnv;
    else delete process.env.PAYOUT_SANDBOX_MODE;
  });

  it('PAYOUT_SANDBOX_MODE=false + payout_real_habilitado=false → StubPayoutAdapter (sandbox)', async () => {
    process.env.PAYOUT_SANDBOX_MODE = 'false';

    const puerto = await obtenerPuertoPayout('tenant-y', {
      config: configSinOptIn,
      accountIdOrigen: 'acc-1',
    });

    // Stub → id empieza con SANDBOX-PAYOUT
    const resultado = await puerto.crearPayout(argsCrearPayout('payout-liq-gate-a'));
    expect(resultado.payoutExternoId).toMatch(/^SANDBOX-PAYOUT/);
  });

  it('PAYOUT_SANDBOX_MODE no definido + payout_real_habilitado=true → StubPayoutAdapter (sandbox)', async () => {
    delete process.env.PAYOUT_SANDBOX_MODE;

    const puerto = await obtenerPuertoPayout('tenant-y', {
      config: configConOptIn,
      accountIdOrigen: 'acc-1',
    });

    const resultado = await puerto.crearPayout(argsCrearPayout('payout-liq-gate-b'));
    expect(resultado.payoutExternoId).toMatch(/^SANDBOX-PAYOUT/);
  });

  it('método manual siempre usa ManualPayoutAdapter (independiente del gate sandbox)', async () => {
    process.env.PAYOUT_SANDBOX_MODE = 'false'; // incluso con sandbox=false

    const configManual = {
      tenant_id: 'tenant-y',
      payout_real_habilitado: true,
      metodo_default: 'manual' as const,
      porcentaje_retencion: 0,
    };

    const puerto = await obtenerPuertoPayout('tenant-y', {
      config: configManual,
      accountIdOrigen: 'acc-1',
    });

    const resultado = await puerto.crearPayout(argsCrearPayout('payout-liq-manual'));
    // ManualPayoutAdapter usa prefijo MANUAL-PAYOUT
    expect(resultado.payoutExternoId).toMatch(/^MANUAL-PAYOUT/);
    expect(resultado.estado).toBe('enviado');
  });
});
