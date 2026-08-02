import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { obtenerPuertoEmail, emailSandboxActivo } from './fabrica-email';
import { StubEmailAdapter } from './adaptadores/stub';
import { ResendEmailAdapter } from './adaptadores/resend';

const ENV_ORIGINAL = { ...process.env };

describe('fabrica-email — gate sandbox/real', () => {
  beforeEach(() => {
    delete process.env.EMAIL_SANDBOX_MODE;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
  });

  it('sin EMAIL_SANDBOX_MODE (ausente) → sandbox activo, devuelve el stub', () => {
    expect(emailSandboxActivo()).toBe(true);
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);
  });

  it('EMAIL_SANDBOX_MODE=false pero SIN RESEND_API_KEY → sigue en stub (gate incompleto)', () => {
    process.env.EMAIL_SANDBOX_MODE = 'false';
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);
  });

  it('RESEND_API_KEY presente pero EMAIL_SANDBOX_MODE ausente/true → sigue en stub', () => {
    process.env.RESEND_API_KEY = 're_test_123';
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);

    process.env.EMAIL_SANDBOX_MODE = 'true';
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);
  });

  it('gate completo (EMAIL_SANDBOX_MODE=false + RESEND_API_KEY) → adaptador real', () => {
    process.env.EMAIL_SANDBOX_MODE = 'false';
    process.env.RESEND_API_KEY = 're_test_123';
    expect(emailSandboxActivo()).toBe(false);
    expect(obtenerPuertoEmail()).toBeInstanceOf(ResendEmailAdapter);
  });
});
