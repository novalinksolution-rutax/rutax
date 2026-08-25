/**
 * Pruebas de la política de retención del QR de retiro (etapa 10).
 *
 * Lo que custodian es la decisión, no la fontanería: CUÁNDO un QR pasa a ser
 * borrable. Es la mitad que faltaba de verdad — nada escribía `vence_en`, así
 * que la columna vivía siempre en NULL y ningún purgador habría tenido jamás
 * una fila que borrar.
 *
 * La lógica se extrae como función pura (`debeMarcarVencimiento`) en vez de
 * reflejarla acá dentro: un test que reimplementa lo que dice probar sigue verde
 * cuando el código de producción cambia, y este repo ya se quemó con eso.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from 'vitest';
import { debeMarcarVencimiento, HORAS_GRACIA_QR } from './purgar-qr-retiro';

const AHORA = new Date('2026-08-16T12:00:00Z').getTime();
const HORA_MS = 60 * 60 * 1000;

describe('debeMarcarVencimiento — cuándo un QR pasa a ser borrable', () => {
  it('pedido ENTREGADO → se marca: el bulto llegó, el QR ya no sirve para nada', () => {
    expect(
      debeMarcarVencimiento(
        { pedidoId: 'ped-1', estadoPedido: 'entregado', escaneadoEnMs: AHORA - HORA_MS },
        AHORA,
      ),
    ).toBe(true);
  });

  it.each(['cancelado', 'devuelto', 'fallido', 'entregado_manual'] as const)(
    'pedido %s → también se marca: son estados terminales',
    (estado) => {
      expect(
        debeMarcarVencimiento(
          { pedidoId: 'ped-1', estadoPedido: estado, escaneadoEnMs: AHORA - HORA_MS },
          AHORA,
        ),
      ).toBe(true);
    },
  );

  it.each(['pendiente_asignacion', 'asignado', 'en_ruta'] as const)(
    'pedido %s → NO se marca: el bulto sigue vivo y su QR puede hacer falta',
    (estado) => {
      expect(
        debeMarcarVencimiento(
          { pedidoId: 'ped-1', estadoPedido: estado, escaneadoEnMs: AHORA - HORA_MS * 500 },
          AHORA,
        ),
      ).toBe(false);
      // Ni siquiera después de días: lo que manda es el estado, no la edad.
    },
  );

  it('bulto SIN pedido y recién escaneado → NO se marca todavía', () => {
    // Un `no_procesado` puede resolverse después: el pedido podría no estar
    // ingestado aún. Borrarle el QR de inmediato lo dejaría irrecuperable, y ML
    // no reimprime la etiqueta una vez retirado el bulto.
    expect(
      debeMarcarVencimiento(
        { pedidoId: null, estadoPedido: null, escaneadoEnMs: AHORA - HORA_MS },
        AHORA,
      ),
    ).toBe(false);
  });

  it('bulto SIN pedido y viejo → SÍ se marca: no va a resolver nunca', () => {
    // Guardar para siempre el QR de un paquete que ni siquiera es nuestro sería
    // lo contrario de minimizar.
    expect(
      debeMarcarVencimiento(
        {
          pedidoId: null,
          estadoPedido: null,
          escaneadoEnMs: AHORA - (HORAS_GRACIA_QR + 1) * HORA_MS,
        },
        AHORA,
      ),
    ).toBe(true);
  });

  it('justo EN el borde de la gracia todavía no se marca', () => {
    // El borde se prueba explícito porque un `>=` en vez de `>` acorta la
    // retención en un día entero para todos los bultos sin pedido.
    expect(
      debeMarcarVencimiento(
        { pedidoId: null, estadoPedido: null, escaneadoEnMs: AHORA - HORAS_GRACIA_QR * HORA_MS },
        AHORA,
      ),
    ).toBe(false);
  });

  it('una fecha de escaneo corrupta NO borra el QR', () => {
    // Ante un dato ilegible, la decisión segura es conservar: un QR de más se
    // purga mañana; uno borrado por error no vuelve.
    expect(
      debeMarcarVencimiento({ pedidoId: null, estadoPedido: null, escaneadoEnMs: NaN }, AHORA),
    ).toBe(false);
  });

  it('la gracia son 48 h, el extremo ALTO del rango decidido (24-48)', () => {
    // Se afirma el valor porque bajarlo es una decisión de política, no un
    // ajuste: el margen de menos cuesta un QR irrecuperable.
    expect(HORAS_GRACIA_QR).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// Candados sobre el archivo del job
// ---------------------------------------------------------------------------
//
// 🔴 Los tests de arriba prueban `debeMarcarVencimiento`, que es la política, y
// pasaban en verde mientras el job **no corría nunca en producción**: fallaba en
// la primera consulta por pedir `bultos_retiro_qr` sin esquema. Una política
// correcta que nadie ejecuta no sirve de nada, así que estos candados miran el
// archivo.

describe("candado: el job pide las tablas donde de verdad están", () => {
  const fuente = readFileSync("src/modules/operacion/jobs/purgar-qr-retiro.ts", "utf8");
  // Solo el código: la cabecera cita el bug y nombraría los mismos patrones.
  const codigo = fuente.slice(fuente.indexOf("import { inngest }"));

  it("🔴 toda consulta a `bultos_retiro_qr` va calificada con `.schema('operacion')`", () => {
    // `public.bultos_retiro_qr` NO EXISTE —a diferencia de `bultos_retiro`, que
    // sí tiene vista espejo— así que sin el esquema PostgREST responde PGRST205
    // y el job muere entero. Fue exactamente el bug: «último éxito: nunca».
    const usos = [...codigo.matchAll(/\.from\(\s*['"]bultos_retiro_qr['"]\s*\)/g)];
    expect(usos.length).toBeGreaterThan(0);

    for (const uso of usos) {
      // Mira las líneas inmediatamente anteriores, que es donde va el `.schema()`
      // en una cadena del cliente de Supabase.
      const antes = codigo.slice(Math.max(0, uso.index - 200), uso.index);
      expect(antes).toMatch(/\.schema\(\s*['"]operacion['"]\s*\)\s*$/);
    }
  });

  it("`bultos_retiro` también va calificada, aunque hoy tenga vista en public", () => {
    // Funciona sin esquema por la vista espejo, y por eso es más peligrosa: el
    // día que esa vista se retire, este job vuelve a caerse en silencio.
    const usos = [...codigo.matchAll(/\.from\(\s*['"]bultos_retiro['"]\s*\)/g)];
    for (const uso of usos) {
      const antes = codigo.slice(Math.max(0, uso.index - 200), uso.index);
      expect(antes).toMatch(/\.schema\(\s*['"]operacion['"]\s*\)\s*$/);
    }
  });
});

describe("candado: el lote no choca con los dos topes", () => {
  const fuente = readFileSync("src/modules/operacion/jobs/purgar-qr-retiro.ts", "utf8");
  const config = readFileSync("supabase/config.toml", "utf8");

  it("🔴 el tamaño de lote NO supera el `max_rows` de PostgREST", () => {
    // PostgREST trunca en silencio: pedir más de `max_rows` no falla, devuelve
    // menos. Un job de retención que cree haber barrido todo y barrió 1.000 es
    // indistinguible de uno que terminó.
    const maxRows = Number(config.match(/max_rows\s*=\s*(\d+)/)?.[1]);
    expect(Number.isFinite(maxRows)).toBe(true);

    const tamano = Number(fuente.match(/const TAMANO_LOTE = (\d+);/)?.[1]);
    expect(Number.isFinite(tamano)).toBe(true);
    expect(tamano).toBeLessThanOrEqual(maxRows);
  });

  it("el lote se mantiene chico para que el `.in()` no reviente la URL", () => {
    // `URI too long` con un `.in()` de muchos UUID ya mordió en este repo. Cada
    // id son 38 caracteres en la query string.
    const tamano = Number(fuente.match(/const TAMANO_LOTE = (\d+);/)?.[1]);
    expect(tamano * 38).toBeLessThan(8000);
  });

  it("se avanza por cursor, no por desplazamiento", () => {
    // Marcar una fila la saca del filtro `vence_en is null`: una ventana por
    // offset se saltaría tantas filas como haya marcado en la página anterior.
    expect(fuente).toMatch(/\.gt\(\s*['"]bulto_id['"]/);
    expect(fuente).not.toMatch(/\.range\(/);
  });
});
