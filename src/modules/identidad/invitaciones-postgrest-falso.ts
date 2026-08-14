/**
 * Doble de prueba de `invitaciones`, FIEL a la diferencia real entre
 * `public.invitaciones` (vista) e `identidad.invitaciones` (tabla base).
 * =============================================================================
 *
 * EL AGUJERO QUE ESTO CIERRA (no el bug — el agujero que dejó pasar el bug):
 * el 2026-08-07 la migración `20260807000001_identidad_invitaciones_token_privilegios`
 * quitó `token` de `public.invitaciones` a propósito — era una fuga real
 * (cualquier interno del courier podía leer el token de una invitación
 * pendiente por PostgREST y activar la cuenta de otro, incluida una de
 * `rol = 'dueno'`). El arreglo en la base fue correcto. Pero CUATRO — en
 * realidad OCHO, contando los que aparecieron al auditar el repo entero —
 * sitios de la aplicación seguían haciendo `.from("invitaciones")` SIN
 * `.schema("identidad")`, así que quedaron resolviendo contra la vista
 * recortada e intentando leer/escribir `token`, columna que ahí no existe.
 * Resultado: crear y canjear invitaciones estuvieron rotos del 07-ago al
 * 13-ago, en producción, sin que ningún test lo detectara.
 *
 * POR QUÉ NINGÚN TEST LO DETECTÓ: todos los dobles de prueba existentes
 * mockean `.from(tabla)` ignorando qué `.schema(...)` se llamó antes (o si se
 * llamó). Para ese doble, `cliente.from("invitaciones")` y
 * `cliente.schema("identidad").from("invitaciones")` son EXACTAMENTE la misma
 * llamada — la diferencia que rompió producción es invisible para el mock.
 *
 * QUÉ HACE ESTE DOBLE DISTINTO: modela las DOS relaciones con columnas
 * DISTINTAS, igual que Postgres:
 *   - Sin `.schema("identidad")` antes de `.from("invitaciones")` → se
 *     comporta como `public.invitaciones`: 14 columnas, SIN `token` (lista
 *     exacta de las migraciones 20260807000001 y 20260807000002).
 *   - Con `.schema("identidad").from("invitaciones")` → se comporta como la
 *     tabla base: las mismas 14 columnas MÁS `token`.
 * Pedir una columna fuera de la proyección vigente devuelve `{ data: null,
 * error }` — NUNCA lanza de forma síncrona: el contrato es el mismo que el
 * cliente real, así que ejercita el mismo camino de manejo de errores que
 * corre en producción. El error replica el código Y el mensaje exactos,
 * verificados contra la base local real (2026-08-13, reproduciendo el bug con
 * `curl` directo a PostgREST — ver `errorColumnaEnConsulta`/
 * `errorColumnaEnPayload` más abajo): PostgREST distingue dos casos —
 *   - una columna en el PAYLOAD de un INSERT/UPDATE (algo que se quiere
 *     ESCRIBIR, p. ej. el `token` en `crearInvitacion`) → `PGRST204`,
 *     `Could not find the '<columna>' column of 'invitaciones' in the schema
 *     cache` — rechazada por PostgREST contra su propia caché, antes de tocar
 *     Postgres;
 *   - una columna en un `.select(...)` o un filtro `.eq(...)` (algo que se
 *     quiere LEER, p. ej. `.eq("token", …)` en `aceptarInvitacion`) →
 *     `42703`, `column invitaciones.<columna> does not exist` — la rechaza
 *     Postgres mismo, al planificar la consulta.
 *
 * Si alguien vuelve a quitar un `.schema("identidad")` de un sitio que use
 * este doble, la prueba correspondiente falla con ESE error — no hace falta
 * acordarse de "no mockear tanto": el doble ya no lo permite.
 */

import type { PostgrestError } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Contrato de columnas — espejo EXACTO de las migraciones vigentes. Si estas
// migraciones cambian la lista, esta constante debe actualizarse A MANO (no
// derivarla del CHECK de otra parte): el punto de este doble es notar el
// descalce, no perpetuarlo.
// -----------------------------------------------------------------------------

/** Columnas de `public.invitaciones` HOY — migraciones 20260807000001 (§C) y 20260807000002 (§3). Sin `token`, a propósito. */
const COLUMNAS_VISTA_PUBLIC_INVITACIONES = [
  "id",
  "tenant_id",
  "email",
  "tipo_usuario",
  "rol",
  "seller_id",
  "driver_id",
  "estado",
  "expira_en",
  "creado_en",
  "email_proveedor_id",
  "email_estado",
  "email_estado_en",
  "email_motivo",
] as const;

/** `identidad.invitaciones` (tabla base): las mismas columnas + `token`. */
const COLUMNAS_TABLA_BASE_INVITACIONES = [...COLUMNAS_VISTA_PUBLIC_INVITACIONES, "token"] as const;

export interface FilaInvitacionFalsa {
  id: string;
  tenant_id: string;
  email: string;
  tipo_usuario: string;
  rol: string;
  seller_id: string | null;
  driver_id: string | null;
  estado: string;
  expira_en: string;
  creado_en?: string;
  email_proveedor_id?: string | null;
  email_estado?: string | null;
  email_estado_en?: string | null;
  email_motivo?: string | null;
  /** Solo alcanzable vía `identidad.invitaciones` — ver cabecera del archivo. */
  token: string;
}

/**
 * Construye el objeto `PostgrestError` con la forma exacta que devuelve la
 * base real (`toJSON()` incluido — `PostgrestError` real es una clase que
 * extiende `Error`; se replica la forma sin instanciarla, para no acoplar
 * este doble a detalles internos del SDK que podrían cambiar de versión).
 */
function construirError(codigo: string, mensaje: string): PostgrestError {
  const forma = { name: "PostgrestError", message: mensaje, details: "", hint: "", code: codigo };
  return { ...forma, toJSON: () => forma } as PostgrestError;
}

/**
 * Columna referenciada en una cláusula que SÍ llega a Postgres (proyección
 * `select`, filtro `.eq()/.gt()`, o el `select=` de RETURNING tras un
 * INSERT/UPDATE con payload válido): Postgres la rechaza en la planificación,
 * ANTES de mirar datos, con `42703`.
 *
 * VERIFICADO contra la base local real (2026-08-13), reproduciendo el bug
 * exacto: `GET .../invitaciones?token=eq.x` sin `.schema("identidad")` →
 * `{"code":"42703","message":"column invitaciones.token does not exist"}`.
 */
function errorColumnaEnConsulta(columna: string): PostgrestError {
  return construirError("42703", `column invitaciones.${columna} does not exist`);
}

/**
 * Columna referenciada en el PAYLOAD de un INSERT/UPDATE (una clave que se
 * quiere escribir): PostgREST la rechaza contra su caché de esquema, ANTES de
 * construir SQL, con `PGRST204` — nunca llega a tocar Postgres.
 *
 * VERIFICADO contra la base local real (2026-08-13), reproduciendo el bug
 * exacto: `POST .../invitaciones` con `{"token": "..."}` en el body, sin
 * `.schema("identidad")` → `{"code":"PGRST204","message":"Could not find the
 * 'token' column of 'invitaciones' in the schema cache"}` — el mensaje que
 * cita el reporte del bug, palabra por palabra.
 */
function errorColumnaEnPayload(columna: string): PostgrestError {
  return construirError(
    "PGRST204",
    `Could not find the '${columna}' column of 'invitaciones' in the schema cache`,
  );
}

function parseSelect(seleccion: string): string[] {
  return seleccion
    .split(",")
    .map((columna) => columna.trim())
    .filter(Boolean);
}

function validarColumnas(
  columnas: Iterable<string>,
  columnasVisibles: ReadonlySet<string>,
  construirErrorColumna: (columna: string) => PostgrestError,
): PostgrestError | null {
  for (const columna of columnas) {
    if (columna === "*") continue;
    if (!columnasVisibles.has(columna)) return construirErrorColumna(columna);
  }
  return null;
}

function proyectar(fila: FilaInvitacionFalsa, columnas: string[]): Record<string, unknown> {
  if (columnas.length === 1 && columnas[0] === "*") return { ...fila };
  const proyectada: Record<string, unknown> = {};
  for (const columna of columnas) proyectada[columna] = (fila as unknown as Record<string, unknown>)[columna];
  return proyectada;
}

interface EstadoTablaInvitaciones {
  invitaciones: FilaInvitacionFalsa[];
}

/**
 * Builder de `invitaciones`, parametrizado por si expone la superficie
 * COMPLETA (tabla base, `identidad.invitaciones`) o la RECORTADA (vista
 * `public.invitaciones`, sin `token`). Es la misma tabla en memoria en ambos
 * casos — como en Postgres real, la vista es una proyección de la misma fila,
 * no una copia.
 */
function crearBuilderInvitaciones(estado: EstadoTablaInvitaciones, exponerTablaBase: boolean) {
  const columnasVisibles = new Set<string>(
    exponerTablaBase ? COLUMNAS_TABLA_BASE_INVITACIONES : COLUMNAS_VISTA_PUBLIC_INVITACIONES,
  );

  function select(seleccion: string) {
    const columnasPedidas = parseSelect(seleccion);
    const errorSelect = validarColumnas(columnasPedidas, columnasVisibles, errorColumnaEnConsulta);
    const filtros: Array<[string, unknown]> = [];
    let orden: { campo: string; ascendente: boolean } | null = null;
    let tope: number | null = null;

    function filasResueltas(): FilaInvitacionFalsa[] {
      let filas = estado.invitaciones.filter((fila) =>
        filtros.every(([campo, valor]) => (fila as unknown as Record<string, unknown>)[campo] === valor),
      );
      if (orden) {
        const { campo, ascendente } = orden;
        filas = [...filas].sort((a, b) => {
          const va = String((a as unknown as Record<string, unknown>)[campo] ?? "");
          const vb = String((b as unknown as Record<string, unknown>)[campo] ?? "");
          return ascendente ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }
      if (tope != null) filas = filas.slice(0, tope);
      return filas;
    }

    function errorVigente(): PostgrestError | null {
      // El error de SELECT manda; si no hay, se revisan los filtros — `.eq()`
      // sobre una columna inexistente falla igual que Postgres real (la
      // resolución de nombres ocurre al planificar, antes de mirar datos).
      return (
        errorSelect ?? validarColumnas(filtros.map(([campo]) => campo), columnasVisibles, errorColumnaEnConsulta)
      );
    }

    const builder = {
      eq(campo: string, valor: unknown) {
        filtros.push([campo, valor]);
        return builder;
      },
      gt(campo: string, valor: unknown) {
        // Simplificado a propósito (solo lo usa `sellers/page.tsx` para
        // `expira_en`, sin token de por medio): filtra como si fuera `>` real.
        filtros.push([`__gt__${campo}`, valor]);
        return builder;
      },
      order(campo: string, opciones?: { ascending?: boolean }) {
        orden = { campo, ascendente: opciones?.ascending ?? true };
        return builder;
      },
      limit(n: number) {
        tope = n;
        return builder;
      },
      async maybeSingle() {
        const error = errorVigente();
        if (error) return { data: null, error };
        const filas = filasResueltas();
        if (filas.length === 0) return { data: null, error: null };
        return { data: proyectar(filas[0], columnasPedidas), error: null };
      },
      // Builder "thenable": soporta `await cliente.from(...).select(...).eq(...)`
      // sin `.maybeSingle()` (usado por `sellers/page.tsx`, que espera una lista).
      then(
        resolve: (v: { data: Record<string, unknown>[] | null; error: PostgrestError | null }) => void,
      ) {
        const error = errorVigente();
        if (error) {
          resolve({ data: null, error });
          return;
        }
        resolve({ data: filasResueltas().map((fila) => proyectar(fila, columnasPedidas)), error: null });
      },
    };
    return builder;
  }

  function insert(fila: Record<string, unknown>) {
    // Clave del payload (lo que se quiere ESCRIBIR) → PGRST204, la validación
    // de PostgREST contra su caché de esquema, antes de tocar Postgres.
    const errorInsert = validarColumnas(Object.keys(fila), columnasVisibles, errorColumnaEnPayload);
    return {
      select(seleccion: string) {
        const columnasPedidas = parseSelect(seleccion);
        // El `select=` de un INSERT es el RETURNING → SÍ llega a Postgres
        // (verificado: con payload válido y `select=token` inválido, el error
        // sigue siendo 42703, no PGRST204). En la práctica es inalcanzable
        // para los sitios reales de este bug (su payload siempre incluye
        // `token`, así que `errorInsert` ya lo atrapa antes), pero se modela
        // bien igual por si algún día otro caller inserta sin tocar `token`.
        const errorSelect = validarColumnas(columnasPedidas, columnasVisibles, errorColumnaEnConsulta);
        return {
          async single() {
            const error = errorInsert ?? errorSelect;
            if (error) return { data: null, error };
            const nueva: FilaInvitacionFalsa = {
              id: `inv-${estado.invitaciones.length + 1}`,
              creado_en: new Date().toISOString(),
              ...fila,
            } as FilaInvitacionFalsa;
            estado.invitaciones.push(nueva);
            return { data: proyectar(nueva, columnasPedidas), error: null };
          },
        };
      },
    };
  }

  function update(cambios: Record<string, unknown>) {
    // Clave del payload (el `SET`) → PGRST204, igual que en `insert`.
    const errorUpdate = validarColumnas(Object.keys(cambios), columnasVisibles, errorColumnaEnPayload);
    function builder(filtros: Array<[string, unknown]>) {
      return {
        eq(campo: string, valor: unknown) {
          return builder([...filtros, [campo, valor]]);
        },
        then(resolve: (v: { data: null; error: PostgrestError | null }) => void) {
          // El filtro `.eq()` (el `WHERE`) SÍ llega a Postgres → 42703.
          // Verificado: `PATCH .../invitaciones?token=eq.x` sin
          // `.schema("identidad")` devuelve 42703, no PGRST204.
          const error =
            errorUpdate ?? validarColumnas(filtros.map(([campo]) => campo), columnasVisibles, errorColumnaEnConsulta);
          if (error) {
            resolve({ data: null, error });
            return;
          }
          const idx = estado.invitaciones.findIndex((fila) =>
            filtros.every(([campo, valor]) => (fila as unknown as Record<string, unknown>)[campo] === valor),
          );
          if (idx >= 0) {
            estado.invitaciones[idx] = { ...estado.invitaciones[idx], ...cambios } as FilaInvitacionFalsa;
          }
          resolve({ data: null, error: null });
        },
      };
    }
    return builder([]);
  }

  return { select, insert, update };
}

export interface ClienteInvitacionesFalsoOpciones {
  invitaciones?: FilaInvitacionFalsa[];
  /**
   * Handler para cualquier tabla que NO sea `invitaciones` (`tenants`,
   * `usuarios_perfil`, `bitacora_auditoria`, `conductores`, …). Se invoca
   * igual desde `.from(tabla)` y desde `.schema("identidad").from(tabla)`:
   * en producción esas tablas se acceden hoy sin `.schema(...)` (ver
   * `auditoria.ts` — la vista `public.*` no es barrera para ellas, a
   * diferencia de `invitaciones`), pero este doble no debe romperse si algún
   * día se agrega uno con `.schema("identidad")`.
   */
  otrasTablas?: (tabla: string) => unknown;
}

/**
 * Cliente Supabase falso, schema-aware, para pruebas que ejercitan `token`.
 * Devuelve `{ cliente, estado }` — `estado.invitaciones` es el array mutable
 * en memoria, para setear semillas y para aserciones (mismo patrón que los
 * dobles previos de `invitaciones.test.ts` y `conductores/[id]/actions.test.ts`).
 */
export function crearClienteInvitacionesFalso(opciones: ClienteInvitacionesFalsoOpciones = {}) {
  const estado: EstadoTablaInvitaciones = {
    invitaciones: opciones.invitaciones ? [...opciones.invitaciones] : [],
  };

  function fallbackOtrasTablas(tabla: string): unknown {
    if (opciones.otrasTablas) return opciones.otrasTablas(tabla);
    throw new Error(`Tabla no soportada en crearClienteInvitacionesFalso: ${tabla}`);
  }

  function from(tabla: string) {
    if (tabla === "invitaciones") return crearBuilderInvitaciones(estado, false); // public.invitaciones — SIN token
    return fallbackOtrasTablas(tabla);
  }

  function schema(nombre: string) {
    if (nombre !== "identidad") {
      // Ningún sitio de este módulo pide otro esquema hoy; fallar fuerte avisa
      // pronto si algo nuevo lo hiciera sin que este doble lo sepa modelar.
      throw new Error(
        `crearClienteInvitacionesFalso solo modela el esquema 'identidad' (se pidió '${nombre}').`,
      );
    }
    return {
      from(tabla: string) {
        if (tabla === "invitaciones") return crearBuilderInvitaciones(estado, true); // identidad.invitaciones — CON token
        return fallbackOtrasTablas(tabla);
      },
    };
  }

  return { cliente: { auth: {}, from, schema } as never, estado };
}
