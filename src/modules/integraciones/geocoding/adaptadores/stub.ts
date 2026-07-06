/**
 * Adaptador STUB de geocoding — determinista, sin red.
 * =====================================================================
 *
 * Es el adaptador por defecto en dev/test/CI (`GEOCODING_PROVIDER=stub`).
 * Cero costo, cero llamadas externas, resultado reproducible:
 *
 *   - Comuna en el catálogo `COMUNAS_RM` → devuelve el centroide de la comuna
 *     (`CENTROIDES_RM`) con `confianza: 0.5`, `estado: 'resuelto'`,
 *     `comunaResuelta` = comuna canónica.
 *   - Comuna fuera del catálogo → `estado: 'no_resuelto'` (lat/long/confianza
 *     `null`), igual que respondería un proveedor real ante una comuna que no
 *     reconoce dentro de la RM.
 *
 * NO depende de `direccion`: a nivel comuna basta para dev. La misma entrada
 * siempre produce la misma salida (determinismo verificado en tests).
 *
 * REGLAS DE DEPENDENCIAS: este adaptador solo importa de `../tipos`, del helper
 * de normalización y del catálogo/centroides RM. NO importa de módulos de
 * negocio (`dinero`, `operacion`) — es una hoja del grafo.
 */

import type { PuertoGeocoding } from '../puerto';
import type { ParametrosGeocoding, ResultadoGeocoding } from '../tipos';
import { resolverComunaCanonica } from '../normalizacion';
import { CENTROIDES_RM } from '../centroides-rm';
import type { ComunaRM } from '@/lib/ui/comunas-rm';

export class StubGeocodingAdapter implements PuertoGeocoding {
  // eslint-disable-next-line @typescript-eslint/require-await
  async geocodificar(args: ParametrosGeocoding): Promise<ResultadoGeocoding> {
    const comunaCanonica = resolverComunaCanonica(args.comuna);

    if (comunaCanonica === null) {
      // Comuna fuera del catálogo RM: el stub no la conoce → no_resuelto.
      return {
        resuelto: false,
        lat: null,
        long: null,
        confianza: null,
        estado: 'no_resuelto',
        comunaResuelta: null,
        proveedor: 'stub',
      };
    }

    const centroide = CENTROIDES_RM[comunaCanonica as ComunaRM];

    return {
      resuelto: true,
      lat: centroide.lat,
      long: centroide.long,
      confianza: 0.5,
      estado: 'resuelto',
      comunaResuelta: comunaCanonica,
      proveedor: 'stub',
    };
  }
}
