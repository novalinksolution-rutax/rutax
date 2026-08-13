/**
 * La lista de claves prohibidas vive en DOS mitades, y esta prueba las ata.
 * =====================================================================
 * `identidad.bitacora_auditoria` tiene un CHECK que rechaza un `detalle` con
 * claves sensibles al nivel superior, y `sanearDetalle` (en este módulo) las
 * elimina recursivamente antes de insertar. Son barreras distintas y ninguna
 * sustituye a la otra: el CHECK solo mira el nivel superior, y `sanearDetalle`
 * es lo único que llega a lo anidado.
 *
 * Pero solo funcionan bien juntas EN UN SENTIDO: **todo lo que el CHECK
 * rechaza, `sanearDetalle` tiene que quitarlo antes**. Si el CHECK conoce una
 * clave que el saneo no, el INSERT falla con 23514 en vez de sanearse — y como
 * la bitácora va ANTES del efecto por invariante del proyecto, eso no tumba un
 * asiento: tumba la acción financiera completa que venía detrás.
 *
 * Pasó al construir la etapa 3 del retiro: la migración agregó `hash_code`,
 * `qr_payload`, `qr`, `security_digit` y `codigo_crudo` al CHECK, y la lista de
 * TypeScript se quedó sin ellas.
 *
 * La relación NO es de igualdad: `CLAVES_PROHIBIDAS` tiene además variantes en
 * español (`contrasena`, `secreto`, `credenciales`) que el CHECK no necesita
 * porque ningún escritor las usa. Eso es defensa extra y está bien. Lo que no
 * puede pasar es lo contrario. Por eso se comprueba **superconjunto**, no
 * igualdad.
 *
 * Se prueba a través de `registrarEnBitacora` y no leyendo la constante: así se
 * verifica el comportamiento real (incluido el saneo anidado) sin ampliar la
 * superficie pública del módulo solo para poder testearlo.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { registrarEnBitacora } from "./auditoria";

const DIRECTORIO_MIGRACIONES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

/** Cada llave del CHECK aparece como `not (detalle ? 'clave')`. */
const PATRON_LLAVE_DEL_CHECK = /not\s*\(\s*detalle\s*\?\s*'([a-z0-9_]+)'\s*\)/gi;

const PATRON_BLOQUE_CHECK =
  /add\s+constraint\s+bitacora_auditoria_detalle_sin_secretos\s+check\s*\(([\s\S]*?)\n\s*\);/gi;

/**
 * Las llaves del CHECK vigente. El nombre de una migración empieza por su
 * timestamp, así que el orden lexicográfico es el cronológico y la última
 * declaración es la que queda aplicada.
 */
function llavesDelCheckVigente(): { archivo: string; llaves: string[] } | null {
  let ultima: { archivo: string; llaves: string[] } | null = null;

  for (const archivo of readdirSync(DIRECTORIO_MIGRACIONES).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(DIRECTORIO_MIGRACIONES, archivo), "utf8");
    for (const bloque of sql.matchAll(PATRON_BLOQUE_CHECK)) {
      const llaves = [...bloque[1].matchAll(PATRON_LLAVE_DEL_CHECK)].map((m) => m[1].toLowerCase());
      if (llaves.length > 0) ultima = { archivo, llaves };
    }
  }

  return ultima;
}

/** Doble de `service_role` que captura el `detalle` ya saneado. */
function clienteQueCaptura(capturados: Record<string, unknown>[]) {
  return {
    from: () => ({
      insert: (fila: Record<string, unknown>) => {
        capturados.push(fila);
        return Promise.resolve({ error: null });
      },
    }),
  };
}

describe("claves prohibidas de la bitácora: SQL y TypeScript no pueden divergir", () => {
  /**
   * Guardia del patrón: si el CHECK cambia de forma (a `?|` con arreglo, a una
   * función, a otro nombre), sin esta aserción la comparación de abajo pasaría
   * por vacuidad y creeríamos tener una red que ya no existe.
   */
  it("encuentra las llaves del CHECK en las migraciones", () => {
    const vigente = llavesDelCheckVigente();

    expect(
      vigente?.llaves.length ?? 0,
      "No se encontró el CHECK bitacora_auditoria_detalle_sin_secretos con la forma " +
        "`not (detalle ? 'clave')`. O cambió de nombre, o de forma. Actualiza los patrones de " +
        "esta prueba — no la borres: es lo único que ata la lista de la base con la del saneo.",
    ).toBeGreaterThan(0);
  });

  it("sanearDetalle elimina TODAS las claves que el CHECK rechaza", async () => {
    const vigente = llavesDelCheckVigente()!;
    const noSaneadas: string[] = [];

    for (const llave of vigente.llaves) {
      const capturados: Record<string, unknown>[] = [];
      await registrarEnBitacora(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clienteQueCaptura(capturados) as any,
        {
          tenantId: "11111111-1111-1111-1111-111111111111",
          actorUsuarioId: null,
          actorTipo: "sistema",
          accion: "prueba.claves_prohibidas",
          entidadTipo: "pedido",
          entidadId: null,
          detalle: { [llave]: "valor-que-no-debe-sobrevivir" },
        },
      );

      const detalle = capturados[0]?.detalle as Record<string, unknown> | undefined;
      if (detalle && llave in detalle) noSaneadas.push(llave);
    }

    expect(
      noSaneadas,
      `El CHECK de la migración ${vigente.archivo} rechaza estas claves, pero sanearDetalle no ` +
        `las quita: ${noSaneadas.join(", ")}.\n` +
        "Consecuencia: el INSERT falla con 23514 en vez de sanearse, y como la bitácora va ANTES " +
        "del efecto, se cae la acción financiera completa. Agrégalas a CLAVES_PROHIBIDAS en " +
        "auditoria.ts.",
    ).toEqual([]);
  });

  it("el saneo también alcanza las claves anidadas, que el CHECK no ve", async () => {
    // Esta es la mitad que el CHECK no puede cubrir: `detalle ? 'clave'` solo
    // inspecciona el nivel superior del jsonb.
    const capturados: Record<string, unknown>[] = [];
    await registrarEnBitacora(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clienteQueCaptura(capturados) as any,
      {
        tenantId: "11111111-1111-1111-1111-111111111111",
        actorUsuarioId: null,
        actorTipo: "sistema",
        accion: "prueba.claves_prohibidas",
        entidadTipo: "pedido",
        entidadId: null,
        detalle: { bulto: { escaneo: { hash_code: "fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=" } } },
      },
    );

    expect(JSON.stringify(capturados[0].detalle)).not.toContain("hash_code");
    expect(JSON.stringify(capturados[0].detalle)).not.toContain("fwH77GO2");
  });
});
