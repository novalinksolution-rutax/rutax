/**
 * Errores de dominio de `identidad` — para que los llamadores (Server Actions,
 * Route Handlers de otros módulos) puedan distinguir fallas esperables
 * (validación, conflicto) de fallas inesperadas (infraestructura) sin parsear
 * mensajes de Postgres/PostgREST.
 */
export class ErrorIdentidad extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorIdentidad";
    this.codigo = codigo;
  }
}

/** Destino que resuelve un bloqueo (p. ej. la sección de configuración que falta). */
export interface EnlaceError {
  href: string;
  etiqueta: string;
}

export class ErrorValidacion extends ErrorIdentidad {
  /** Opcional: adónde ir a resolver lo que bloquea. La UI lo muestra junto al mensaje. */
  readonly enlace?: EnlaceError;

  constructor(mensaje: string, enlace?: EnlaceError) {
    super("validacion", mensaje);
    this.name = "ErrorValidacion";
    this.enlace = enlace;
  }
}

export class ErrorConflicto extends ErrorIdentidad {
  constructor(mensaje: string) {
    super("conflicto", mensaje);
    this.name = "ErrorConflicto";
  }
}

export class ErrorNoEncontrado extends ErrorIdentidad {
  constructor(mensaje: string) {
    super("no_encontrado", mensaje);
    this.name = "ErrorNoEncontrado";
  }
}
