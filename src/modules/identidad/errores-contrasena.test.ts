import { describe, it, expect } from 'vitest';
import { mensajeErrorContrasenaAccionable } from './errores-contrasena';

describe('mensajeErrorContrasenaAccionable', () => {
  it('same_password → le dice que elija otra, NO que espere', () => {
    const mensaje = mensajeErrorContrasenaAccionable({ code: 'same_password' });

    expect(mensaje).toBeTruthy();
    // El bug real: el mensaje anterior pedía "intenta de nuevo en unos
    // minutos", y reintentar con la misma clave falla siempre igual.
    expect(mensaje).not.toMatch(/minuto|espera|más tarde/i);
    expect(mensaje).toMatch(/distinta/i);
  });

  it('weak_password → habla de la contraseña, no del sistema', () => {
    const mensaje = mensajeErrorContrasenaAccionable({ code: 'weak_password' });

    expect(mensaje).toBeTruthy();
    expect(mensaje).not.toMatch(/nuestro sistema/i);
  });

  it('un código desconocido NO se traduce — el llamador usa su mensaje de sistema', () => {
    expect(mensajeErrorContrasenaAccionable({ code: 'unexpected_failure' })).toBeNull();
    expect(mensajeErrorContrasenaAccionable({ code: 'over_request_rate_limit' })).toBeNull();
  });

  it('tolera errores sin code, nulos o de otra forma sin lanzar', () => {
    expect(mensajeErrorContrasenaAccionable(null)).toBeNull();
    expect(mensajeErrorContrasenaAccionable(undefined)).toBeNull();
    expect(mensajeErrorContrasenaAccionable('same_password')).toBeNull();
    expect(mensajeErrorContrasenaAccionable({ message: 'New password should be different' })).toBeNull();
    expect(mensajeErrorContrasenaAccionable({ code: 42 })).toBeNull();
  });

  it('NO clasifica por el texto del error: `message` viene en inglés y cambia entre versiones', () => {
    // Mismo mensaje que emite GoTrue, pero sin `code`: no se traduce.
    expect(
      mensajeErrorContrasenaAccionable({
        message: 'New password should be different from the old password.',
        status: 422,
      }),
    ).toBeNull();
  });
});
