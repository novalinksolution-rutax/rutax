/**
 * Puerto de CALENDARIO / RESTRICCIÓN.
 * =====================================================================
 *
 * El puerto tiene UNA sola operación de red —traer feriados—, porque la otra
 * mitad de su responsabilidad (la restricción vehicular permanente) no es una
 * consulta: es una función pura (`restriccion-gec.ts`). Mezclarlas en la
 * interfaz obligaría a stubear un cálculo determinístico, que es justo lo que no
 * hay que hacer.
 *
 *   - CONTEXTO_CALENDARIO_PROVIDER=stub  (default en dev/test/CI)
 *   - CONTEXTO_CALENDARIO_PROVIDER=boostr → api.boostr.cl (sin key)
 *
 * Opcional: `BOOSTR_BASE_URL` para apuntar a un mock en pruebas de integración.
 * NINGUNA de estas fuentes usa credenciales.
 *
 * -----------------------------------------------------------------------------
 * LO QUE ESTE PUERTO **NO** TRAE: la restricción EXTRAORDINARIA
 * -----------------------------------------------------------------------------
 * La restricción por episodio (preemergencia / emergencia) no se implementó, y
 * es una omisión razonada, no un olvido. Tres hechos verificados el 2026-07-26:
 *
 * 1. El feed `https://airerm.mma.gob.cl/feed/` EXISTE y responde: es un RSS 2.0
 *    de WordPress, con `<item>` y `pubDate`. Confirmado en vivo — el primer ítem
 *    era "Nueva Alerta Ambiental preventiva regirá este domingo 26 de julio en
 *    la RM".
 * 2. Pero es el feed general del sitio, con titulares en prosa. La fecha y el
 *    nivel del episodio están redactados en lenguaje natural ("regirá este lunes
 *    13 de julio"), no en campos. Extraerlos con una regex es exactamente el
 *    tipo de parser que funciona en la demo y falla en agosto.
 * 3. Y sobre todo: según el Plan Operacional GEC 2026 (Cuadros 18 y 20), los
 *    dígitos adicionales del episodio son *"dígitos aleatorios"* que fija la
 *    autoridad al decretarlo. No están en el titular, no se derivan, y no
 *    existen hasta que la Delegación Presidencial los publica.
 *
 * Conclusión: la restricción extraordinaria pertenece al pipeline de señales de
 * §13 (ingesta → deduplicación → clasificación con LLM → geolocalización), no a
 * un adaptador de calendario. Inventar aquí un parser que produzca dígitos
 * equivocados sería peor que no tener el dato: el coordinador dejaría fuera de
 * ruta a conductores que sí podían circular.
 */

import { ErrorContextoConfig } from '../errores';
import type { ResultadoContexto } from '../resultado';
import { BoostrCalendarioAdapter } from './adaptadores/boostr';
import { StubCalendarioAdapter } from './adaptadores/stub';
import type { CalendarioFeriados, ParametrosCalendario } from './tipos';

export interface PuertoCalendario {
  /**
   * Feriados y fechas cívicas de Chile para los años pedidos. No lanza ante
   * fallos del proveedor: devuelve `{ ok: false, motivo }`.
   */
  obtenerFeriados(
    args?: ParametrosCalendario,
  ): Promise<ResultadoContexto<CalendarioFeriados>>;
}

export function obtenerPuertoCalendario(): PuertoCalendario {
  const proveedor = (process.env.CONTEXTO_CALENDARIO_PROVIDER ?? 'stub')
    .trim()
    .toLowerCase();

  switch (proveedor) {
    case '':
    case 'stub':
      return new StubCalendarioAdapter();

    case 'boostr': {
      const baseUrl = process.env.BOOSTR_BASE_URL?.trim() || undefined;
      return new BoostrCalendarioAdapter({ baseUrl });
    }

    default:
      throw new ErrorContextoConfig(
        `CONTEXTO_CALENDARIO_PROVIDER='${proveedor}' no es reconocido (usa 'stub' o 'boostr')`,
      );
  }
}
