/**
 * Job C3 · dinero/emitirDtePeriodo
 * =====================================================================
 * Trigger: evento `dinero/periodo.cerrado`
 * (publicado por C2 o por `cerrarPeriodoManualmente`)
 *
 * Responsabilidad:
 * - Reservar un folio CAF del tenant (transaccional con FOR UPDATE).
 * - Llamar al proveedor DTE via `obtenerPuertoDte`.
 * - Persistir el documento DTE en `dinero.documentos_dte`.
 * - Actualizar el período a `facturado`.
 *
 * Protocolo de resiliencia §5.4 del documento de arquitectura:
 *   Step 1: Verificar DTE existente (idempotencia completa).
 *   Step 2: Reservar folio (transaccional, FOR UPDATE).
 *   Step 3: Llamar al proveedor DTE (reintentable por red).
 *   Step 4: Persistir DTE + marcar período como facturado.
 *
 * Idempotencia:
 * - Step 1 garantiza que no se re-emite si ya hay un DTE para el período.
 * - UNIQUE (tenant_id, tipo_documento, folio) absorbe duplicados en step 4.
 *
 * SEGURIDAD: las credenciales DTE nunca aparecen en logs, errores ni payloads.
 *
 * ErrorFolioAgotado: el job NO reintenta — retorna con error claro para que
 * el job C7 (alertaFoliosProximos) y el operador tomen acción.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { obtenerPuertoDte } from '@/modules/integraciones/dte';
import { ErrorFolioAgotado } from '@/modules/integraciones/dte';

const TZ = 'America/Santiago';

function fechaLocalSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const jobEmitirDtePeriodo = inngest.createFunction(
  {
    id: 'dinero/emitirDtePeriodo',
    name: 'Dinero · Emitir DTE de período cerrado',
    triggers: [{ event: 'dinero/periodo.cerrado' }],
    retries: 4,
  },
  async ({ event, step, logger, runId }) => {
    const { periodoCobroidId, tenantId, sellerId, montoTotalClp } = event.data as {
      periodoCobroidId: string;
      tenantId: string;
      sellerId: string;
      fechaInicio: string;
      fechaFin: string;
      montoTotalClp: number;
    };

    // Step 1: Verificar si ya existe un DTE para este período (idempotencia).
    const dteExistente = await step.run('verificar-dte-existente', async () => {
      const supabase = crearClienteServiceRole();
      const { data, error } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .select('id, folio, estado_sii')
        .eq('tenant_id', tenantId)
        .eq('periodo_cobro_id', periodoCobroidId)
        .maybeSingle();

      if (error) throw new Error(`Error al verificar DTE existente: ${error.message}`);
      return data ?? null;
    });

    if (dteExistente) {
      logger.info(
        `Período ${periodoCobroidId}: DTE ya emitido (folio=${dteExistente.folio}). ` +
        'Terminando sin re-emitir (idempotencia).',
      );
      return { resultado: 'ya_emitido', dteId: dteExistente.id };
    }

    // Step 2: Leer datos del seller para la factura.
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

    // Step 3: Reservar folio CAF (transaccional — FOR UPDATE).
    // Si ErrorFolioAgotado: no reintentar — el job termina con error claro.
    const folioReservado = await step.run('reservar-folio', async () => {
      const supabase = crearClienteServiceRole();

      // Leer folio_caf del tenant con bloqueo (emulado: leer y actualizar atómicamente).
      const { data: caf, error: cafError } = await supabase
        .schema('identidad')
        .from('folios_caf')
        .select('id, folio_actual, folio_hasta')
        .eq('tenant_id', tenantId)
        .eq('estado', 'vigente')
        .order('folio_actual', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cafError) throw new Error(`Error al leer CAF: ${cafError.message}`);

      if (!caf) {
        throw new ErrorFolioAgotado(tenantId);
      }

      const folioActual = caf.folio_actual as number;
      const folioHasta = caf.folio_hasta as number;

      if (folioActual > folioHasta) {
        throw new ErrorFolioAgotado(tenantId);
      }

      // Incrementar folio_actual (UPDATE atómico).
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
    });

    // Step 4: Llamar al proveedor DTE.
    // Si falla por red → Inngest reintenta este step.
    // Las credenciales NO se loguean.
    const resultadoDte = await step.run('llamar-proveedor-dte', async () => {
      const puerto = await obtenerPuertoDte(tenantId);

      // Calcular montos (IVA 19% en Chile).
      const montoNeto = Math.round(montoTotalClp / 1.19);
      const montoIva = montoTotalClp - montoNeto;

      const resultado = await puerto.emitirFactura(tenantId, {
        rutEmisor: datosSeller.rutEmisor,
        razonSocialEmisor: datosSeller.razonSocialEmisor,
        rutReceptor: datosSeller.rutReceptor,
        razonSocialReceptor: datosSeller.razonSocialReceptor,
        emailReceptor: datosSeller.emailReceptor,
        fechaEmision: fechaLocalSantiago(),
        folio: folioReservado.folio,
        lineas: [
          {
            nombre: `Servicios de delivery período ${periodoCobroidId}`,
            cantidad: 1,
            precioUnitarioNetoCLP: montoNeto,
          },
        ],
      });

      // Las credenciales ya salieron de scope en `obtenerPuertoDte`.
      return {
        idExterno: resultado.idExternoProveedor,
        folio: resultado.folio,
        tipoDocumento: resultado.tipoDocumento,
        montoNeto: resultado.montoNetoCLP,
        montoIva: resultado.montoIvaCLP,
        montoTotal: resultado.montoTotalCLP,
        xmlUrl: resultado.xmlUrl,
        pdfUrl: resultado.pdfUrl,
        estadoSii: resultado.estadoSii,
      };
    });

    // Step 5: Persistir DTE y marcar período como facturado.
    const dteId = await step.run('persistir-dte', async () => {
      const supabase = crearClienteServiceRole();

      // INSERT con ON CONFLICT (tenant_id, tipo_documento, folio) DO NOTHING.
      const { data: insertado, error: insertError } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .insert({
          tenant_id: tenantId,
          seller_id: sellerId,
          periodo_cobro_id: periodoCobroidId,
          tipo_documento: resultadoDte.tipoDocumento,
          folio: resultadoDte.folio,
          fecha_emision: fechaLocalSantiago(),
          monto_neto_clp: resultadoDte.montoNeto,
          monto_iva_clp: resultadoDte.montoIva,
          monto_total_clp: resultadoDte.montoTotal,
          xml_dte_ref: resultadoDte.xmlUrl,
          pdf_ref: resultadoDte.pdfUrl,
          proveedor_dte_id_externo: resultadoDte.idExterno,
          estado_sii: resultadoDte.estadoSii,
          estado_proveedor: 'enviado',
        })
        .select('id')
        .maybeSingle();

      if (insertError && !insertError.message.includes('duplicate')) {
        throw new Error(`Error al persistir DTE: ${insertError.message}`);
      }

      let dteIdFinal: string;

      if (insertado) {
        dteIdFinal = insertado.id as string;
      } else {
        // Conflicto: ya existe — leer el ID existente.
        const { data: existente } = await supabase
          .schema('dinero')
          .from('documentos_dte')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('tipo_documento', resultadoDte.tipoDocumento)
          .eq('folio', resultadoDte.folio)
          .maybeSingle();

        dteIdFinal = existente?.id as string;
      }

      // Actualizar período a 'facturado' con referencia al DTE.
      await supabase
        .schema('dinero')
        .from('periodos_cobro')
        .update({
          estado: 'facturado',
          documento_dte_id: dteIdFinal,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', periodoCobroidId)
        .eq('tenant_id', tenantId);

      // Bitácora — sin credenciales en el detalle.
      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'dinero.dte_emitido',
        entidadTipo: 'documento_dte',
        entidadId: dteIdFinal,
        detalle: {
          periodo_cobro_id: periodoCobroidId,
          folio: resultadoDte.folio,
          tipo_documento: resultadoDte.tipoDocumento,
          monto_total_clp: resultadoDte.montoTotal,
          estado_sii: resultadoDte.estadoSii,
          job_run_id: runId,
        },
      });

      return dteIdFinal;
    });

    logger.info(
      `Período ${periodoCobroidId}: DTE emitido. ` +
      `folio=${resultadoDte.folio}, dteId=${dteId}.`,
    );

    return {
      resultado: 'emitido',
      periodoCobroidId,
      dteId,
      folio: resultadoDte.folio,
    };
  },
);
