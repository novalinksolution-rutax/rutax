/**
 * Adaptador STUB de FERIADOS — determinista, sin red.
 * =====================================================================
 *
 * Por defecto en dev/test/CI (`CONTEXTO_CALENDARIO_PROVIDER=stub`).
 *
 * Devuelve solo los feriados chilenos de FECHA FIJA, que son los que se pueden
 * calcular sin consultar nada. Los MÓVILES quedan fuera a propósito:
 *   · Viernes/Sábado Santo dependen de la Pascua (cómputo de Gauss),
 *   · San Pedro y San Pablo, Día de la Virgen del Carmen y otros se trasladan al
 *     lunes según la Ley 19.973 cuando caen martes/miércoles,
 *   · las elecciones y feriados excepcionales se declaran por ley cada vez.
 * Implementar ese traslado "a ojo" en un stub sería peor que no tenerlo: daría
 * una falsa sensación de completitud en dev. El stub es para que la pantalla
 * tenga datos, no para reemplazar la fuente.
 *
 * `irrenunciable` sí es fiel: los tres irrenunciables de fecha fija (1 de enero,
 * 1 de mayo, 18 de septiembre) más el 19 de septiembre y el 25 de diciembre son
 * los que importan para decidir si se reparte, y son estables.
 */

import {
  exito,
  type ResultadoContexto,
} from '../../resultado';
import { anioActualEnSantiago } from '../anio';
import type { PuertoCalendario } from '../puerto';
import type {
  CalendarioFeriados,
  Feriado,
  ParametrosCalendario,
} from '../tipos';

/**
 * Feriados chilenos de fecha fija. `[mes, día, nombre, tipo, irrenunciable]`.
 * Contrastados con la respuesta real de api.boostr.cl para 2026.
 */
const FIJOS: ReadonlyArray<[number, number, string, string, boolean]> = [
  [1, 1, 'Año Nuevo', 'Civil', true],
  [5, 1, 'Día Nacional del Trabajo', 'Civil', true],
  [5, 21, 'Día de las Glorias Navales', 'Civil', false],
  [6, 21, 'Día Nacional de los Pueblos Indígenas', 'Civil', false],
  [8, 15, 'Asunción de la Virgen', 'Religioso', false],
  [9, 18, 'Independencia Nacional', 'Civil', true],
  [9, 19, 'Día de las Glorias del Ejército', 'Civil', true],
  [11, 1, 'Día de Todos los Santos', 'Religioso', false],
  [12, 8, 'Inmaculada Concepción', 'Religioso', false],
  [12, 25, 'Navidad', 'Religioso', true],
];

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

export class StubCalendarioAdapter implements PuertoCalendario {
  // `async` sin `await`: cumple la interfaz asíncrona del puerto sin tocar la red.
  async obtenerFeriados(
    args: ParametrosCalendario = {},
  ): Promise<ResultadoContexto<CalendarioFeriados>> {
    const anios = [...(args.anios ?? [anioActualEnSantiago()])];

    const feriados: Feriado[] = [];
    for (const anio of anios) {
      for (const [mes, dia, nombre, tipo, irrenunciable] of FIJOS) {
        feriados.push({
          fecha: `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`,
          nombre,
          tipo,
          irrenunciable,
        });
      }
    }

    return exito({ proveedor: 'stub', feriados, aniosResueltos: anios });
  }
}
