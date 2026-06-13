/**
 * Job C-NC · dinero/emitirNotaCredito — anulación total con NC (RF-038)
 * =====================================================================
 * Trigger: evento `dinero/nc.emision-solicitada`
 * (publicado SOLO por la acción humana `emitirNotaCreditoPeriodo`, gate
 *  `puedeEmitirFacturas`, motivo obligatorio — misma compuerta que C3).
 *
 * Responsabilidad (decisiones B1-B5 del arquitecto):
 * - Reservar un folio CAF tipo 61 (helper `../folios`, discrimina por tipo).
 * - Emitir el 61 vía el puerto DTE, referenciando el 33 (CodRef=1, RazonRef).
 * - Persistir el 61 con `dte_referencia_id` apuntando al 33.
 * - Período → `anulado` (terminal) con motivo/actor/timestamp y reset de
 *   cobranza (estado_cobro='no_aplica', monto_pagado=0).
 * - DESIMPUTAR pagos del período → `estado_match='sobrante'` (conservando
 *   seller_id): la plata real no desaparece — vuelve a la bandeja de revisión
 *   para reimputarse cuando se facture el período corregido.
 * - LIBERAR las líneas de cobro y reimputarlas al período ABIERTO vigente del
 *   seller (la corrección viaja en el período en curso; el rango histórico ya
 *   tuvo su período, ahora anulado con su 33 y su 61 como rastro completo).
 * - NO tocar liquidaciones de conductores (la NC es del cobro courier→seller).
 *
 * Idempotencia:
 * - Step 1: si ya existe un 61 referenciando ese 33 → terminar (`ya_emitida`).
 * - UNIQUE (tenant,tipo,folio) + índice único parcial (un 61 por 33) absorben
 *   duplicados en la persistencia.
 * - Transiciones condicionadas por estado (`WHERE estado='facturado'`, etc.).
 *
 * Los montos del 61 vienen COPIADOS del evento (que los copió de la fila del
 * 33) — NUNCA recalculados desde las líneas, que pueden haber cambiado.
 * Montos positivos: la semántica de crédito la da el tipo 61, no el signo.
 *
 * SEGURIDAD: credenciales DTE jamás en logs; bitácora antes/durante efectos.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { obtenerPuertoDte } from '@/modules/integraciones/dte';
import { reservarFolio } from '../folios';
import { obtenerOCrearPeriodoCobroAbierto } from '../periodos';

const TZ = 'America/Santiago';

function fechaLocalSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface DatosNcSolicitada {
  periodoCobroidId: string;
  tenantId: string;
  sellerId: string;
  documentoDteId: string;
  folioReferencia: number;
  tipoDocumentoReferencia: 33;
  montoNetoClp: number;
  montoIvaClp: number;
  montoTotalClp: number;
  motivo: string;
  solicitadoPorUsuarioId: string;
  modo: 'sandbox' | 'real';
}

export const jobEmitirNotaCredito = inngest.createFunction(
  {
    id: 'dinero/emitirNotaCredito',
    name: 'Dinero · Emitir nota de crédito (anulación total)',
    triggers: [{ event: 'dinero/nc.emision-solicitada' }],
    retries: 3,
  },
  async ({ event, step, logger, runId }) => {
    const datos = event.data as DatosNcSolicitada;
    const {
      periodoCobroidId,
      tenantId,
      sellerId,
      documentoDteId,
      folioReferencia,
      motivo,
      solicitadoPorUsuarioId,
    } = datos;

    // Step 1: ¿ya existe la NC para este 33? (idempotencia completa).
    const ncExistente = await step.run('verificar-nc-existente', async () => {
      const supabase = crearClienteServiceRole();
      const { data, error } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .select('id, folio')
        .eq('tenant_id', tenantId)
        .eq('tipo_documento', 61)
        .eq('dte_referencia_id', documentoDteId)
        .maybeSingle();
      if (error) throw new Error(`Error al verificar NC existente: ${error.message}`);
      return data ?? null;
    });

    if (ncExistente) {
      logger.info(
        `Período ${periodoCobroidId}: NC ya emitida (folio=${ncExistente.folio}). ` +
          'Terminando sin re-emitir (idempotencia).',
      );
      return { resultado: 'ya_emitida', ncId: ncExistente.id };
    }

    // Step 2: datos de emisor/receptor (mismos del 33: tenant emite, seller recibe).
    const datosSeller = await step.run('leer-datos-seller', async () => {
      const supabase = crearClienteServiceRole();
      const { data: sellerData, error: sellerError } = await supabase
        .schema('identidad')
        .from('sellers')
        .select('rut, razon_social, email_contacto')
        .eq('id', sellerId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (sellerError || !sellerData) {
        throw new Error(`Seller ${sellerId} no encontrado: ${sellerError?.message}`);
      }
      const { data: tenantData, error: tenantError } = await supabase
        .schema('identidad')
        .from('tenants')
        .select('rut, razon_social')
        .eq('id', tenantId)
        .maybeSingle();
      if (tenantError || !tenantData) {
        throw new Error(`Tenant ${tenantId} no encontrado: ${tenantError?.message}`);
      }
      return {
        rutEmisor: tenantData.rut as string,
        razonSocialEmisor: tenantData.razon_social as string,
        rutReceptor: sellerData.rut as string,
        razonSocialReceptor: sellerData.razon_social as string,
        emailReceptor: sellerData.email_contacto as string,
      };
    });

    // Step 3: reservar folio CAF tipo 61 (no reintentable si está agotado).
    const folioReservado = await step.run('reservar-folio-61', async () => {
      return reservarFolio(tenantId, 61);
    });

    // Step 4: emitir el 61 vía el puerto DTE, con referencia al 33.
    const resultadoNc = await step.run('llamar-proveedor-dte', async () => {
      const puerto = await obtenerPuertoDte(tenantId);

      const resultado = await puerto.emitirFactura(tenantId, {
        rutEmisor: datosSeller.rutEmisor,
        razonSocialEmisor: datosSeller.razonSocialEmisor,
        rutReceptor: datosSeller.rutReceptor,
        razonSocialReceptor: datosSeller.razonSocialReceptor,
        emailReceptor: datosSeller.emailReceptor,
        fechaEmision: fechaLocalSantiago(),
        folio: folioReservado.folio,
        // Línea espejo: montos copiados del 33 (positivos — el tipo 61 da la
        // semántica de crédito).
        lineas: [
          {
            nombre: `Anula factura electrónica N° ${folioReferencia}`,
            cantidad: 1,
            precioUnitarioNetoCLP: datos.montoNetoClp,
          },
        ],
        // Referencia SII: anulación total del documento referenciado.
        folioDocumentoReferencia: folioReferencia,
        tipoDocumentoReferencia: 33,
        codigoReferencia: 1,
        razonReferencia: motivo, // el adaptador trunca a 90 (límite RazonRef SII)
      });

      return {
        idExterno: resultado.idExternoProveedor,
        folio: resultado.folio,
        tipoDocumento: resultado.tipoDocumento,
        xmlUrl: resultado.xmlUrl,
        pdfUrl: resultado.pdfUrl,
        estadoSii: resultado.estadoSii,
      };
    });

    // Step 5: persistir el 61 (idempotente vía UNIQUEs).
    const ncId = await step.run('persistir-nc', async () => {
      const supabase = crearClienteServiceRole();

      const { data: insertado, error: insertError } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .insert({
          tenant_id: tenantId,
          seller_id: sellerId,
          periodo_cobro_id: periodoCobroidId,
          tipo_documento: 61,
          folio: folioReservado.folio,
          fecha_emision: fechaLocalSantiago(),
          monto_neto_clp: datos.montoNetoClp,
          monto_iva_clp: datos.montoIvaClp,
          monto_total_clp: datos.montoTotalClp,
          xml_dte_ref: resultadoNc.xmlUrl,
          pdf_ref: resultadoNc.pdfUrl,
          proveedor_dte_id_externo: resultadoNc.idExterno,
          estado_sii: resultadoNc.estadoSii,
          estado_proveedor: 'enviado',
          dte_referencia_id: documentoDteId,
        })
        .select('id')
        .maybeSingle();

      // Choque con UNIQUE (tenant,tipo,folio) o el índice parcial (un 61 por
      // 33) → releer la NC ganadora y continuar (idempotencia).
      if (insertError && !insertError.message.includes('duplicate')) {
        throw new Error(`Error al persistir NC: ${insertError.message}`);
      }

      if (insertado) return insertado.id as string;

      const { data: existente } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('tipo_documento', 61)
        .eq('dte_referencia_id', documentoDteId)
        .maybeSingle();
      if (!existente) throw new Error('NC no persistida ni encontrada tras el conflicto.');
      return existente.id as string;
    });

    // Step 6a: período → anulado (terminal), con motivo/actor y reset de cobranza.
    await step.run('anular-periodo', async () => {
      const supabase = crearClienteServiceRole();
      const { error } = await supabase
        .schema('dinero')
        .from('periodos_cobro')
        .update({
          estado: 'anulado',
          motivo_anulacion: motivo,
          anulado_en: new Date().toISOString(),
          anulado_por_usuario_id: solicitadoPorUsuarioId,
          estado_cobro: 'no_aplica',
          monto_pagado_clp: 0,
          pagado_en: null,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', periodoCobroidId)
        .eq('tenant_id', tenantId)
        .eq('estado', 'facturado'); // condicionada: re-ejecución no re-anula
      if (error) throw new Error(`Error al anular período: ${error.message}`);
    });

    // Step 6b: desimputar pagos del período → 'sobrante' (conservar seller_id).
    // La plata real no desaparece: vuelve a la bandeja para reimputarse.
    await step.run('desimputar-pagos', async () => {
      const supabase = crearClienteServiceRole();

      const { data: pagos, error: errPagos } = await supabase
        .schema('dinero')
        .from('pagos_recibidos')
        .select('id, monto_clp')
        .eq('tenant_id', tenantId)
        .eq('periodo_cobro_id', periodoCobroidId);
      if (errPagos) throw new Error(`Error al leer pagos del período: ${errPagos.message}`);

      for (const pago of pagos ?? []) {
        const { error: errUpd } = await supabase
          .schema('dinero')
          .from('pagos_recibidos')
          .update({
            estado_match: 'sobrante',
            periodo_cobro_id: null,
            // seller_id se CONSERVA: la atribución al seller sigue siendo cierta.
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', pago.id as string)
          .eq('tenant_id', tenantId);
        if (errUpd) throw new Error(`Error al desimputar pago: ${errUpd.message}`);

        await registrarEnBitacora(supabase, {
          tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'dinero.pago_desimputado_por_nc',
          entidadTipo: 'pago_recibido',
          entidadId: pago.id as string,
          detalle: {
            periodo_cobro_origen: periodoCobroidId,
            monto_clp: Math.round(Number(pago.monto_clp)),
            nc_id: ncId,
            job_run_id: runId,
          },
        });
      }

      return (pagos ?? []).length;
    });

    // Step 6c: liberar las líneas y reimputarlas al período ABIERTO vigente.
    await step.run('reimputar-lineas', async () => {
      const supabase = crearClienteServiceRole();

      // Período abierto vigente del seller (mismo mecanismo que C1; la fecha de
      // hoy decide el período en curso según la config del tenant/seller).
      const periodoDestinoId = await obtenerOCrearPeriodoCobroAbierto(supabase, {
        tenantId,
        sellerId,
        fechaEntrega: new Date(),
      });

      const { error } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .update({ periodo_cobro_id: periodoDestinoId, actualizado_en: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('periodo_cobro_id', periodoCobroidId);
      if (error) throw new Error(`Error al reimputar líneas: ${error.message}`);

      return periodoDestinoId;
    });

    // Step 7: bitácora final de la NC emitida.
    await step.run('bitacora-nc-emitida', async () => {
      const supabase = crearClienteServiceRole();
      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'dinero.nc_emitida',
        entidadTipo: 'documento_dte',
        entidadId: ncId,
        detalle: {
          periodo_cobro_id: periodoCobroidId,
          folio_nc: folioReservado.folio,
          folio_original: folioReferencia,
          monto_total_clp: datos.montoTotalClp,
          estado_sii: resultadoNc.estadoSii,
          job_run_id: runId,
        },
      });
    });

    logger.info(
      `Período ${periodoCobroidId}: NC emitida. folio=${folioReservado.folio}, ncId=${ncId}.`,
    );

    return { resultado: 'emitida', periodoCobroidId, ncId, folio: folioReservado.folio };
  },
);
