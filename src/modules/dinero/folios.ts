/**
 * Reserva de folios CAF — helper compartido por tipo de documento.
 * =============================================================================
 *
 * Extraído del step `reservar-folio` del job C3 (`jobs/emitir-dte-periodo.ts`)
 * para ser compartido con el job de notas de crédito (C-NC), CON UN FIX:
 *
 * FIX (bug confirmado por arquitecto): la versión original filtraba solo por
 * `tenant_id` + `estado='vigente'` SIN discriminar `tipo_documento` — un
 * courier que cargara un CAF tipo 61 podía ver al job de facturas consumir
 * folios 61 para emitir documentos 33. `identidad.folios_caf` SIEMPRE tuvo la
 * columna `tipo_documento` (migración 0003); solo faltaba usarla.
 *
 * Concurrencia: misma guarda optimista del original — el UPDATE exige que
 * `folio_actual` no haya cambiado desde la lectura; si otro job ganó la
 * carrera, el UPDATE no afecta filas y se lanza error (Inngest reintenta el
 * step y toma el folio siguiente).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ErrorFolioAgotado } from '@/modules/integraciones/dte';

export interface FolioReservado {
  folio: number;
  cafId: string;
}

/**
 * Reserva (consume) el siguiente folio vigente del tenant PARA EL TIPO de
 * documento indicado (33 = factura, 61 = nota de crédito).
 *
 * @throws ErrorFolioAgotado si no hay CAF vigente de ese tipo o se agotó el
 *   rango — NO reintentable: requiere timbrar un CAF nuevo en el SII.
 */
export async function reservarFolio(
  tenantId: string,
  tipoDocumento: 33 | 61,
): Promise<FolioReservado> {
  const supabase = crearClienteServiceRole();

  const { data: caf, error: cafError } = await supabase
    .schema('identidad')
    .from('folios_caf')
    .select('id, folio_actual, folio_hasta')
    .eq('tenant_id', tenantId)
    .eq('tipo_documento', tipoDocumento)
    .eq('estado', 'vigente')
    .order('folio_actual', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (cafError) throw new Error(`Error al leer CAF: ${cafError.message}`);

  if (!caf) {
    throw new ErrorFolioAgotado(tenantId, tipoDocumento);
  }

  const folioActual = caf.folio_actual as number;
  const folioHasta = caf.folio_hasta as number;

  if (folioActual > folioHasta) {
    throw new ErrorFolioAgotado(tenantId, tipoDocumento);
  }

  // Incrementar folio_actual (UPDATE con guarda optimista).
  const { error: updateError } = await supabase
    .schema('identidad')
    .from('folios_caf')
    .update({ folio_actual: folioActual + 1, actualizado_en: new Date().toISOString() })
    .eq('id', caf.id as string)
    .eq('folio_actual', folioActual); // guarda optimista: si otro job lo cambió, falla

  if (updateError) {
    throw new Error(`Error al reservar folio: ${updateError.message}`);
  }

  return { folio: folioActual, cafId: caf.id as string };
}
