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
