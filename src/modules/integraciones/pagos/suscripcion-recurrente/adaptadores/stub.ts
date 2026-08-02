/**
 * Adaptador STUB de auto-cobro recurrente (sandbox) — NO cobra, NO llama a Fintoc.
 * =============================================================================
 * Lo devuelve la fábrica cuando el gate real NO está completo
 * (`SUSCRIPCION_RECURRENTE_SANDBOX_MODE` != "false", o el tenant sin opt-in). Deja
 * probar el flujo backstage de punta a punta sin mover dinero real — igual que
 * `StubCheckoutAdapter` / `StubPayoutAdapter`.
 *
 * Determinista: `cobrarPeriodo` deriva el `cobroExternoId` de la `idempotencyKey`
 * determinística, así un reintento con la misma llave produce el MISMO id
 * simulado (refleja la deduplicación del proveedor real, sin proveedor).
 *
 * Centinela de prueba (opcional): un `montoClp <= 0` se simula como `rechazado`,
 * para poder ejercer la rama de rechazo en pruebas sin proveedor.
 *
 * REGLA DE DEPENDENCIAS (adaptador = hoja): solo importa del puerto.
 */

import { randomBytes } from 'node:crypto';
import type {
  CobrarPeriodoArgs,
  PuertoSuscripcionRecurrente,
  ResultadoCancelarMandato,
  ResultadoCobrarPeriodo,
  ResultadoRegistrarMandato,
} from '../puerto-suscripcion-recurrente';

/** Prefijo trazable — distingue a simple vista que NO es un cobro real. */
const PREFIJO_STUB = 'stub';

export class StubSuscripcionRecurrenteAdapter implements PuertoSuscripcionRecurrente {
  // Los args se ignoran (no enrola nada real): implementar con menos parámetros
  // es válido para la interfaz y evita el warning de variable sin usar.
  async registrarMandato(): Promise<ResultadoRegistrarMandato> {
    const id = `${PREFIJO_STUB}_mandato_test_${randomBytes(8).toString('hex')}`;
    return {
      mandatoExternoId: id,
      // URL claramente de sandbox: nunca lleva a una pasarela real de enrolamiento.
      urlEnrolamiento: `https://sandbox.fintoc.local/enrolar/${id}`,
      modo: 'test',
    };
  }

  async cobrarPeriodo(args: CobrarPeriodoArgs): Promise<ResultadoCobrarPeriodo> {
    // Centinela: monto no positivo → simular rechazo de negocio.
    if (!Number.isFinite(args.montoClp) || args.montoClp <= 0) {
      return {
        estado: 'rechazado',
        errorDescripcion: 'cobro simulado rechazado (sandbox) — monto centinela no positivo',
      };
    }
    return {
      estado: 'enviado',
      // Determinista por idempotencyKey: reintentar con la misma llave da el mismo id.
      cobroExternoId: `${PREFIJO_STUB}_cobro_${args.idempotencyKey}`,
    };
  }

  async cancelarMandato(): Promise<ResultadoCancelarMandato> {
    return { ok: true };
  }
}
