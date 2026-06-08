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

export class ErrorValidacion extends ErrorIdentidad {
  constructor(mensaje: string) {
    super("validacion", mensaje);
    this.name = "ErrorValidacion";
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
