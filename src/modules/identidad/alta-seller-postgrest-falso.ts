/**
 * Doble de prueba, en memoria, para el alta de seller por autoservicio
 * (RF-010 rediseño) — compartido entre `barrera-auto-registro-seller.test.ts`
 * y `alta-seller-autoservicio.test.ts`.
 * =============================================================================
 * Modela lo mínimo que esas dos piezas tocan: `usuarios_perfil`,
 * `identidad.seller_identidades`, `sellers`, `identidad.seller_bodegas`,
 * `integraciones.whatsapp_contactos`, `identidad.seller_fuentes_declaradas`,
 * `identidad.seller_membresias` y `bitacora_auditoria`.
 *
 * A diferencia de `invitaciones-postgrest-falso.ts` (que modela la fuga real
 * de columnas entre vista y tabla base), acá el punto no es esa clase de
 * bug — es tener un doble reutilizable y genérico (select/insert/upsert/
 * update/delete con filtros `.eq()`) para no repetir la plomería de cada
 * tabla en los dos archivos de prueba.
 */

export type FilaFalsa = Record<string, unknown>;

interface OpcionesTablaFalsa<T extends FilaFalsa> {
  /** Muta la fila ANTES de insertarla (p. ej. asignar un id autogenerado). */
  prepararInsert?: (fila: T) => T;
  /** Devuelve un error de conflicto si la fila viola una regla de unicidad simulada. */
  validarInsert?: (fila: T) => { code?: string; message?: string } | null;
}

function coincide(fila: FilaFalsa, filtros: Array<[string, unknown]>): boolean {
  return filtros.every(([col, val]) => fila[col] === val);
}

/**
 * Tabla en memoria con la superficie mínima de PostgREST que este alta usa:
 * `.select().eq()...maybeSingle()`, `.insert(fila|filas).select().single()`
 * (o awaited directo), `.upsert(fila, {onConflict})`, `.update(cambios).eq()`
 * y `.delete().eq()`. Todo builder es "thenable" (implementa `.then()`) para
 * soportar tanto `await tabla.insert(x)` como `await tabla.insert(x).select().single()`.
 */
export function crearTablaFalsa<T extends FilaFalsa>(filas: T[], opciones: OpcionesTablaFalsa<T> = {}) {
  function construirLecturaConFiltros() {
    const filtros: Array<[string, unknown]> = [];
    const builder = {
      eq(col: string, val: unknown) {
        filtros.push([col, val]);
        return builder;
      },
      async maybeSingle() {
        const fila = filas.find((f) => coincide(f, filtros));
        return { data: fila ?? null, error: null };
      },
      async single() {
        const fila = filas.find((f) => coincide(f, filtros));
        return fila ? { data: fila, error: null } : { data: null, error: { message: "no encontrado" } };
      },
      then(resolve: (v: { data: T[]; error: null }) => void) {
        resolve({ data: filas.filter((f) => coincide(f, filtros)), error: null });
      },
    };
    return builder;
  }

  return {
    filas,
    select(_cols?: string) {
      void _cols;
      return construirLecturaConFiltros();
    },
    insert(payload: T | Partial<T> | Array<T | Partial<T>>) {
      const entrantes = (Array.isArray(payload) ? payload : [payload]) as T[];
      const nuevas = entrantes.map((f) =>
        opciones.prepararInsert ? opciones.prepararInsert({ ...f } as T) : ({ ...f } as T),
      );

      let error: { code?: string; message?: string } | null = null;
      for (const fila of nuevas) {
        error = opciones.validarInsert?.(fila) ?? null;
        if (error) break;
      }
      if (!error) filas.push(...nuevas);

      const resultado = error ? { data: null, error } : { data: nuevas, error: null };

      return {
        select(_c?: string) {
          void _c;
          return {
            async single() {
              if (error) return { data: null, error };
              return { data: nuevas[nuevas.length - 1], error: null };
            },
          };
        },
        then(resolve: (v: typeof resultado) => void) {
          resolve(resultado);
        },
      };
    },
    upsert(payload: T, opcionesUpsert?: { onConflict?: string }) {
      const clave = opcionesUpsert?.onConflict ?? "id";
      const idx = filas.findIndex((f) => f[clave] === (payload as T)[clave]);
      if (idx >= 0) filas[idx] = { ...filas[idx], ...payload };
      else filas.push({ ...payload } as T);
      const resultado = { data: null, error: null };
      return {
        then(resolve: (v: typeof resultado) => void) {
          resolve(resultado);
        },
      };
    },
    update(payload: Partial<T>) {
      const filtros: Array<[string, unknown]> = [];
      const builder = {
        eq(col: string, val: unknown) {
          filtros.push([col, val]);
          return builder;
        },
        select(_cols?: string) {
          void _cols;
          const afectadas = filas.filter((f) => coincide(f, filtros));
          afectadas.forEach((f) => Object.assign(f, payload));
          const resultado = { data: afectadas, error: null };
          return {
            then(resolve: (v: typeof resultado) => void) {
              resolve(resultado);
            },
          };
        },
        then(resolve: (v: { data: null; error: null }) => void) {
          filas.filter((f) => coincide(f, filtros)).forEach((f) => Object.assign(f, payload));
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
    delete() {
      const builder = {
        eq(col: string, val: unknown) {
          const restantes = filas.filter((f) => f[col] !== val);
          filas.length = 0;
          filas.push(...restantes);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

export interface EstadoAltaSellerFalso {
  perfiles: FilaFalsa[];
  sellerIdentidades: FilaFalsa[];
  sellers: FilaFalsa[];
  sellerBodegas: FilaFalsa[];
  whatsappContactos: FilaFalsa[];
  sellerFuentes: FilaFalsa[];
  sellerMembresias: FilaFalsa[];
  bitacora: FilaFalsa[];
}

export interface SemillaClienteAltaSellerFalso {
  perfiles?: FilaFalsa[];
  sellers?: FilaFalsa[];
  sellerMembresias?: FilaFalsa[];
  /** Fuerza que CUALQUIER insert en `integraciones.whatsapp_contactos` falle — para probar la compensación. */
  forzarErrorEnWhatsapp?: boolean;
}

export function crearClienteAltaSellerFalso(seed: SemillaClienteAltaSellerFalso = {}) {
  let contador = 0;
  const nuevoId = (prefijo: string) => `${prefijo}-${++contador}`;

  const estado: EstadoAltaSellerFalso = {
    perfiles: seed.perfiles ? [...seed.perfiles] : [],
    sellerIdentidades: [],
    sellers: seed.sellers ? [...seed.sellers] : [],
    sellerBodegas: [],
    whatsappContactos: [],
    sellerFuentes: [],
    sellerMembresias: seed.sellerMembresias ? [...seed.sellerMembresias] : [],
    bitacora: [],
  };

  const tablaPerfiles = crearTablaFalsa(estado.perfiles);
  const tablaSellerIdentidades = crearTablaFalsa(estado.sellerIdentidades);
  const tablaSellers = crearTablaFalsa(estado.sellers, {
    prepararInsert: (fila) => ({ id: nuevoId("seller"), ...fila }),
    validarInsert: (fila) => {
      const choca = estado.sellers.some((s) => s.tenant_id === fila.tenant_id && s.rut === fila.rut);
      return choca ? { code: "23505", message: 'duplicate key value violates unique constraint "sellers_tenant_rut_uk"' } : null;
    },
  });
  const tablaSellerBodegas = crearTablaFalsa(estado.sellerBodegas, {
    prepararInsert: (fila) => ({ id: nuevoId("bodega"), ...fila }),
  });
  const tablaWhatsapp = crearTablaFalsa(estado.whatsappContactos, {
    prepararInsert: (fila) => ({ id: nuevoId("wa"), ...fila }),
    validarInsert: () => (seed.forzarErrorEnWhatsapp ? { message: "fallo simulado en whatsapp_contactos" } : null),
  });
  const tablaFuentes = crearTablaFalsa(estado.sellerFuentes, {
    prepararInsert: (fila) => ({ id: nuevoId("fuente"), ...fila }),
  });
  const tablaMembresias = crearTablaFalsa(estado.sellerMembresias, {
    prepararInsert: (fila) => ({ id: nuevoId("membresia"), ...fila }),
    validarInsert: (fila) => {
      const choca = estado.sellerMembresias.some(
        (m) => m.auth_user_id === fila.auth_user_id && m.tenant_id === fila.tenant_id,
      );
      return choca ? { code: "23505", message: "seller_membresias_auth_tenant_uk" } : null;
    },
  });
  const tablaBitacora = crearTablaFalsa(estado.bitacora);

  const cliente = {
    from(tabla: string) {
      if (tabla === "sellers") return tablaSellers;
      if (tabla === "usuarios_perfil") return tablaPerfiles;
      if (tabla === "bitacora_auditoria") return tablaBitacora;
      throw new Error(`crearClienteAltaSellerFalso: tabla pública no modelada: ${tabla}`);
    },
    schema(nombre: string) {
      if (nombre === "identidad") {
        return {
          from(tabla: string) {
            if (tabla === "seller_identidades") return tablaSellerIdentidades;
            if (tabla === "seller_bodegas") return tablaSellerBodegas;
            if (tabla === "seller_fuentes_declaradas") return tablaFuentes;
            if (tabla === "seller_membresias") return tablaMembresias;
            throw new Error(`crearClienteAltaSellerFalso: tabla 'identidad' no modelada: ${tabla}`);
          },
        };
      }
      if (nombre === "integraciones") {
        return {
          from(tabla: string) {
            if (tabla === "whatsapp_contactos") return tablaWhatsapp;
            throw new Error(`crearClienteAltaSellerFalso: tabla 'integraciones' no modelada: ${tabla}`);
          },
        };
      }
      throw new Error(`crearClienteAltaSellerFalso: esquema no modelado: ${nombre}`);
    },
  };

  return { cliente: cliente as never, estado };
}
