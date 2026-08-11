/**
 * Job C1 · dinero/generarLineas
 * =====================================================================
 * Trigger: evento `dinero/pedido.estado_financiero_relevante`
 * (publicado por `operacion/pedidos.ts` post-commit de actualizarEstadoPedido)
 *
 * Responsabilidad: generar las líneas de cobro y de liquidación para un pedido
 * en estado financieramente relevante. Asignarlas al período/liquidación abiertos.
 * Actualizar los flags en `operacion.pedidos`.
 *
 * Flujo `fallido → devuelto` / `→ cancelado` (anulación pre-cierre):
 * Cuando llega `estadoNuevo ∈ {'devuelto', 'cancelado'}` y YA EXISTE una línea
 * para ese pedido, el job anula la línea (soft-delete: `anulada = true`) SOLO
 * si el período / la liquidación todavía están en estado mutable:
 *   - cobro   : período `abierto`  → anular. cerrado/facturado → NO se anula.
 *   - liquidac: liquidación `borrador` → anular. emitida/pagada → NO se anula.
 * El `monto_final_clp` es GENERATED — no se puede setear. Para neutralizar el efecto
 * en los totales todos los cálculos de período / liquidación filtran `anulada = false`.
 *
 * Punto ciego H2 tapado (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
 * §2.3/§2.4 D-A2): cuando NO se puede anular porque el contenedor ya cerró, el
 * job YA NO solo loguea — levanta una excepción BLOQUEANTE en
 * `dinero.eventos_conciliacion` (`levantarExcepcionLineaNoAnulable`), porque
 * C6 (`conciliar-periodo`) ya no vuelve a correr sobre un período facturado:
 *   - cobro   : `linea_cobro_sin_pedido_entregado`       + `bloquea_facturacion=true`.
 *   - liquidac: `linea_liquidacion_sin_pedido_entregado` + `bloquea_pago=true`.
 *
 * Idempotencia:
 * - EventId = `dinero-lineas-${pedidoId}-${estadoNuevo}` — Inngest no deduplica
 *   eventos de estados distintos del mismo pedido (fix del bug original donde el
 *   EventId fijo hacía que el segundo evento financiero se deduplicase).
 * - INSERT ON CONFLICT (pedido_id) DO NOTHING — la BD absorbe el segundo intento.
 * - UPDATE con WHERE periodo_cobro_id IS NULL / liquidacion_id IS NULL — idempotente.
 * - Anular dos veces = no-op (la línea ya tiene `anulada = true`).
 * - Excepción de conciliación: `select … maybeSingle()` por
 *   `(tenant_id, pedido_id, tipo_diferencia)` en estado no terminal antes del
 *   insert — no siembra duplicados en reintentos.
 *
 * SEGURIDAD:
 * - Nunca se loguean tokens, certificados ni credenciales.
 * - Solo se escriben cobro_generado, monto_cobro_clp, liquidacion_generada,
 *   monto_liquidacion_clp en operacion.pedidos (columnas de Fase C).
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { evaluarElegibilidad, evaluarMotivoElegibilidad, construirSnapshotRegla } from '../motor';
import type { TarifaSnapshotInput, IncidenciaSnapshotInput } from '../motor';
import { obtenerOCrearPeriodoCobroAbierto, obtenerOCrearLiquidacionAbierta } from '../periodos';
import {
  camposClasificacionParaInsert,
  ESTADOS_NO_TERMINALES_CONCILIACION,
} from '../conciliacion-clasificacion';
import type { TipoDiferenciaConciliacion } from '../tipos';
import type { EstadoPedido } from '@/modules/operacion/tipos';

const TZ = 'America/Santiago';

/**
 * Extrae la fecha local en Santiago en formato 'YYYY-MM-DD' desde un string ISO.
 */
function fechaLocalSantiago(isoStr: string): string {
  const d = new Date(isoStr);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Fidelidad de la anulación (H1, docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
 * §2.4 D-A4): el paso 'anular-lineas-si-devolucion' se dispara tanto para
 * `estadoNuevo='devuelto'` como para `estadoNuevo='cancelado'` (ambos hacen
 * `!generaCobro && !generaLiquidacion`), pero antes de este fix el motivo y la
 * acción de bitácora quedaban hardcodeados a 'devolucion' sin importar cuál
 * de los dos fue. Se derivan de `estadoNuevo`, que ya viaja en el payload del
 * evento (sin cambio de contrato, ver `src/lib/inngest/eventos.ts`).
 *
 * Cualquier otro estado que llegue a esta rama (hoy no debería, es defensivo)
 * se trata como 'devolucion' — es el comportamiento previo, no una regresión.
 */
export function derivarMotivoAnulacion(estadoNuevo: string): 'cancelacion' | 'devolucion' {
  return estadoNuevo === 'cancelado' ? 'cancelacion' : 'devolucion';
}

/** Acción de bitácora correspondiente al motivo derivado — ver `derivarMotivoAnulacion`. */
export function derivarAccionBitacoraAnulacion(
  estadoNuevo: string,
): 'dinero.lineas_anuladas_por_cancelacion' | 'dinero.lineas_anuladas_por_devolucion' {
  return estadoNuevo === 'cancelado'
    ? 'dinero.lineas_anuladas_por_cancelacion'
    : 'dinero.lineas_anuladas_por_devolucion';
}

/**
 * Tapa el punto ciego H2 (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
 * §2.3/§2.4 D-A2): cuando el pedido pasó a `cancelado`/`devuelto` pero su línea
 * de cobro o de liquidación NO se pudo anular porque el contenedor (período /
 * liquidación) ya está cerrado, levanta una excepción BLOQUEANTE en
 * `dinero.eventos_conciliacion` en vez de solo loguear. C6 (`conciliar-periodo`)
 * ya no vuelve a correr sobre un período facturado, así que este es el único
 * punto de detección posible — sin esto, una línea viva queda dentro de un DTE
 * emitido o un conductor cobra una entrega que no ocurrió, y nadie se entera.
 *
 * Idempotencia: `select … maybeSingle()` previo al insert por
 * `(tenant_id, pedido_id, tipo_diferencia)` en estado NO terminal — mismo
 * patrón que los cuatro checks de `conciliar-periodo.ts`. Si ya existe un
 * hallazgo vigente para esta combinación, no se duplica (C1 se reintenta).
 * Si el hallazgo previo llegó a un estado terminal (alguien lo resolvió/
 * ignoró) y la línea sigue viva en un reintento posterior, se levanta uno
 * nuevo — el hecho persiste y merece una excepción fresca.
 *
 * Bitácora ANTES del INSERT del evento (invariante CLAUDE.md): el `id` del
 * evento se genera acá mismo (client-side, `crypto.randomUUID()`) y se pasa
 * explícito en el INSERT, igual que el patrón ya establecido en
 * `operacion/conductores.ts` (`crearConductor`) — así el detalle de bitácora
 * puede llevar `evento_conciliacion_id` sin invertir el orden bitácora→efecto.
 *
 * Devuelve el id del evento creado, o `null` si ya existía uno vigente.
 */
export async function levantarExcepcionLineaNoAnulable(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  input: {
    tenantId: string;
    pedidoId: string;
    sellerId: string;
    tipoLinea: 'cobro' | 'liquidacion';
    lineaId: string;
    tipoDiferencia: TipoDiferenciaConciliacion;
    estadoNuevo: string;
    /** Estado del período (lado cobro) o de la liquidación (lado liquidación). */
    estadoContenedor: string | null;
    periodoCobroId?: string | null;
    driverId?: string | null;
    liquidacionId?: string | null;
    bloqueaFacturacion: boolean;
    bloqueaPago: boolean;
    jobRunId: string;
  },
): Promise<string | null> {
  const { data: existente } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('pedido_id', input.pedidoId)
    .eq('tipo_diferencia', input.tipoDiferencia)
    .in('estado', ESTADOS_NO_TERMINALES_CONCILIACION)
    .maybeSingle();

  if (existente) return null; // ya hay un hallazgo vigente — idempotente, no duplicar.

  const eventoConciliacionId = crypto.randomUUID();
  const motivoBloqueo =
    input.tipoLinea === 'cobro'
      ? `Pedido ${input.pedidoId} pasó a '${input.estadoNuevo}' con línea de cobro ` +
        `(${input.lineaId}) viva dentro de un período en estado '${input.estadoContenedor}'. ` +
        `No se anuló automáticamente: requiere nota de crédito o ajuste manual antes de facturar.`
      : `Pedido ${input.pedidoId} pasó a '${input.estadoNuevo}' con línea de liquidación ` +
        `(${input.lineaId}) viva dentro de una liquidación en estado '${input.estadoContenedor}'. ` +
        `El pago al conductor ya salió o está por salir: requiere ajuste/descuento manual.`;

  // Bitácora ANTES del INSERT del evento de conciliación.
  await registrarEnBitacora(supabase, {
    tenantId: input.tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: 'dinero.linea_no_anulable_por_cancelacion',
    entidadTipo: 'pedido',
    entidadId: input.pedidoId,
    detalle: {
      tipo_linea: input.tipoLinea,
      linea_id: input.lineaId,
      ...(input.tipoLinea === 'cobro'
        ? { estado_periodo: input.estadoContenedor }
        : { estado_liquidacion: input.estadoContenedor }),
      evento_conciliacion_id: eventoConciliacionId,
      job_run_id: input.jobRunId,
    },
  });

  const clasificacion = camposClasificacionParaInsert(input.tipoDiferencia, new Date().toISOString());

  const { error } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .insert({
      id: eventoConciliacionId,
      tenant_id: input.tenantId,
      seller_id: input.sellerId,
      periodo_cobro_id: input.periodoCobroId ?? null,
      pedido_id: input.pedidoId,
      driver_id: input.driverId ?? null,
      liquidacion_id: input.liquidacionId ?? null,
      tipo_diferencia: input.tipoDiferencia,
      descripcion: motivoBloqueo,
      estado: 'pendiente',
      bloquea_facturacion: input.bloqueaFacturacion,
      bloquea_pago: input.bloqueaPago,
      motivo_bloqueo: motivoBloqueo,
      job_run_id: input.jobRunId,
      ...clasificacion,
    });

  if (error) {
    throw new Error(
      `Error al insertar excepción de conciliación [${input.tipoDiferencia}]: ${error.message}`,
    );
  }

  return eventoConciliacionId;
}

export const jobGenerarLineas = inngest.createFunction(
  {
    id: 'dinero/generarLineas',
    name: 'Dinero · Generar líneas de cobro y liquidación',
    triggers: [{ event: 'dinero/pedido.estado_financiero_relevante' }],
    retries: 4,
  },
  async ({ event, step, logger, runId }) => {
    const {
      pedidoId,
      tenantId,
      sellerId,
      driverIdAsignado,
      estadoNuevo,
      estadoAnterior,
      fechaTransicion,
      tipoPedido,
      tarifaAplicableId,
    } = event.data as {
      pedidoId: string;
      tenantId: string;
      sellerId: string;
      driverIdAsignado: string | null;
      estadoNuevo: string;
      estadoAnterior: string;
      fechaTransicion: string;
      tipoPedido: 'flex' | 'same_day';
      tarifaAplicableId: string | null;
    };

    // Paso 1: Evaluar elegibilidad.
    // Además de los flags de elegibilidad, este paso trae TODO lo que alimenta
    // el snapshot inmutable de la regla económica (hallazgo P0 de auditoría —
    // ver `snapshot_regla` en dinero.lineas_cobro/lineas_liquidacion, migración
    // 20260707000001): la tarifa completa (no solo los montos), el tipo de la
    // incidencia y la comuna del destinatario como contexto geográfico.
    const { elegibilidad, motivos, tarifa, incidencia, esGastoPropio, comunaDestinatario } = await step.run(
      'evaluar-elegibilidad',
      async () => {
        const supabase = crearClienteServiceRole();

        // Leer tarifa completa: montos (cobro/conductor) + todo lo que explica
        // el valor pactado (tipo de entrega, modo de cálculo, zona, vigencia,
        // mínimos y recargo de reprogramación) para el snapshot.
        let montoCobroBase = 0;
        let montoConductorBase = 0;
        let tipoEntrega: string | null = null;
        let modoCalculo: string | null = null;
        let zona: string | null = null;
        let zonaId: string | null = null;
        let vigenteDesde: string | null = null;
        let vigenteHasta: string | null = null;
        let estadoTarifa: string | null = null;
        let minimoRetiroClp: number | null = null;
        let minimoFacturacionClp: number | null = null;
        let recargoReprogramacionClp: number | null = null;

        if (tarifaAplicableId) {
          const { data: tarifaData } = await supabase
            .schema('identidad')
            .from('tarifas')
            .select(
              'monto_clp, monto_conductor_clp, tipo_entrega, modo_calculo, zona, zona_id, vigente_desde, vigente_hasta, estado, minimo_retiro_clp, minimo_facturacion_clp, recargo_reprogramacion_clp',
            )
            .eq('id', tarifaAplicableId)
            .eq('tenant_id', tenantId)
            .maybeSingle();

          montoCobroBase = tarifaData ? Math.round(Number(tarifaData.monto_clp)) : 0;
          montoConductorBase = tarifaData ? Math.round(Number(tarifaData.monto_conductor_clp ?? 0)) : 0;
          tipoEntrega = (tarifaData?.tipo_entrega as string | null) ?? null;
          modoCalculo = (tarifaData?.modo_calculo as string | null) ?? null;
          zona = (tarifaData?.zona as string | null) ?? null;
          zonaId = (tarifaData?.zona_id as string | null) ?? null;
          vigenteDesde = (tarifaData?.vigente_desde as string | null) ?? null;
          vigenteHasta = (tarifaData?.vigente_hasta as string | null) ?? null;
          estadoTarifa = (tarifaData?.estado as string | null) ?? null;
          minimoRetiroClp =
            tarifaData?.minimo_retiro_clp != null ? Number(tarifaData.minimo_retiro_clp) : null;
          minimoFacturacionClp =
            tarifaData?.minimo_facturacion_clp != null ? Number(tarifaData.minimo_facturacion_clp) : null;
          recargoReprogramacionClp =
            tarifaData?.recargo_reprogramacion_clp != null
              ? Number(tarifaData.recargo_reprogramacion_clp)
              : null;
        }

        // Leer incidencia abierta del pedido (afecta_cobro / afecta_liquidacion / tipo).
        const { data: incidenciaData } = await supabase
          .schema('operacion')
          .from('incidencias')
          .select('id, tipo, afecta_cobro, afecta_liquidacion')
          .eq('pedido_id', pedidoId)
          .eq('tenant_id', tenantId)
          .order('creado_en', { ascending: false })
          .limit(1)
          .maybeSingle();

        const afectaCobro = incidenciaData?.afecta_cobro ?? null;
        const afectaLiquidacion = incidenciaData?.afecta_liquidacion ?? null;

        // Leer seller_id_gasto_propio del tenant para detectar same_day gasto propio.
        const { data: tenantData } = await supabase
          .schema('identidad')
          .from('tenants')
          .select('seller_id_gasto_propio')
          .eq('id', tenantId)
          .maybeSingle();

        const gastoPropio = tipoPedido === 'same_day' &&
          tenantData?.seller_id_gasto_propio != null &&
          tenantData.seller_id_gasto_propio === sellerId;

        // Leer comuna del destinatario — contexto geográfico del pedido para el
        // snapshot (NO es lo que determina el precio; eso lo determina la zona
        // de la tarifa). No viene en el evento, así que se lee puntualmente.
        const { data: pedidoData } = await supabase
          .schema('operacion')
          .from('pedidos')
          .select('destinatario_comuna')
          .eq('id', pedidoId)
          .eq('tenant_id', tenantId)
          .maybeSingle();

        const entradaMotor = {
          estadoPedido: estadoNuevo as EstadoPedido,
          afectaCobro: afectaCobro as boolean | null,
          afectaLiquidacion: afectaLiquidacion as boolean | null,
          esGastoPropio: gastoPropio,
          tieneDriverAsignado: driverIdAsignado !== null,
        };

        const resultado = evaluarElegibilidad(entradaMotor);
        const motivosResultado = evaluarMotivoElegibilidad(entradaMotor);

        return {
          elegibilidad: resultado,
          motivos: motivosResultado,
          tarifa: {
            montoCobroBase,
            montoConductorBase,
            tipoEntrega,
            modoCalculo,
            zona,
            zonaId,
            vigenteDesde,
            vigenteHasta,
            estado: estadoTarifa,
            minimoRetiroClp,
            minimoFacturacionClp,
            recargoReprogramacionClp,
          },
          incidencia: incidenciaData
            ? {
                id: incidenciaData.id as string,
                tipo: (incidenciaData.tipo as string | null) ?? null,
                afectaCobro: afectaCobro as boolean | null,
                afectaLiquidacion: afectaLiquidacion as boolean | null,
              }
            : null,
          esGastoPropio: gastoPropio,
          comunaDestinatario: (pedidoData?.destinatario_comuna as string | null) ?? null,
        };
      },
    );

    const fechaEntrega = fechaLocalSantiago(fechaTransicion);

    // Paso 1b: Anulación pre-cierre (flujo fallido → devuelto).
    //
    // Si el estado nuevo NO genera cobro/liquidación Y ya existe una línea para
    // este pedido, hay que anularla — pero SOLO si el período / liquidación
    // todavía están en estado mutable (abierto / borrador). Si ya están cerrados /
    // facturados / emitidos / pagados, la compuerta humana manda: no tocar nada y
    // dejar que C6 (conciliación) detecte la discrepancia.
    //
    // Bitácora ANTES del efecto: se registra con la acción derivada de estadoNuevo
    // ('dinero.lineas_anuladas_por_cancelacion' | '..._por_devolucion', ver
    // `derivarAccionBitacoraAnulacion`) ANTES de hacer cualquier UPDATE (invariante CLAUDE.md).
    const anulacionRealizada = await step.run('anular-lineas-si-devolucion', async () => {
      // Solo aplica cuando el estado nuevo no genera cobro NI liquidación
      // (devuelto, cancelado, y el caso defensivo de estado no reconocido).
      if (elegibilidad.generaCobro || elegibilidad.generaLiquidacion) {
        return {
          anuloCobro: false,
          anuloLiquidacion: false,
          eventoConciliacionCobroId: null,
          eventoConciliacionLiquidacionId: null,
        };
      }

      const supabase = crearClienteServiceRole();
      let anuloCobro = false;
      let anuloLiquidacion = false;
      let eventoConciliacionCobroId: string | null = null;
      let eventoConciliacionLiquidacionId: string | null = null;

      // --- Línea de cobro ---
      const { data: lineaCobro } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id, anulada, periodo_cobro_id')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (lineaCobro && !lineaCobro.anulada) {
        // Verificar estado del período antes de anular.
        let puedeAnularCobro = false;
        let estadoPeriodo: string | null = null;

        if (lineaCobro.periodo_cobro_id) {
          const { data: periodo } = await supabase
            .schema('dinero')
            .from('periodos_cobro')
            .select('estado')
            .eq('id', lineaCobro.periodo_cobro_id as string)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          estadoPeriodo = periodo?.estado ?? null;
          puedeAnularCobro = estadoPeriodo === 'abierto';
        } else {
          // Línea sin período asignado aún — se puede anular libremente.
          puedeAnularCobro = true;
        }

        if (puedeAnularCobro) {
          const motivoAnulacion = derivarMotivoAnulacion(estadoNuevo);
          const accionBitacora = derivarAccionBitacoraAnulacion(estadoNuevo);

          // Bitácora ANTES del UPDATE (invariante financiero CLAUDE.md).
          await registrarEnBitacora(supabase, {
            tenantId,
            actorUsuarioId: null,
            actorTipo: 'sistema',
            accion: accionBitacora,
            entidadTipo: 'pedido',
            entidadId: pedidoId,
            detalle: {
              tipo_linea: 'cobro',
              linea_id: lineaCobro.id,
              estado_pedido: estadoNuevo,
              periodo_cobro_id: lineaCobro.periodo_cobro_id ?? null,
              estado_periodo: estadoPeriodo,
              motivo: motivoAnulacion,
              job_run_id: runId,
            },
          });

          await supabase
            .schema('dinero')
            .from('lineas_cobro')
            .update({
              anulada: true,
              anulada_en: new Date().toISOString(),
              motivo_anulacion: motivoAnulacion,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', lineaCobro.id as string)
            .eq('tenant_id', tenantId)
            .eq('anulada', false); // idempotente: no re-anular si ya está anulada

          anuloCobro = true;

          // Resetear flag del pedido para reflejar que ya no tiene cobro activo.
          await supabase
            .schema('operacion')
            .from('pedidos')
            .update({
              cobro_generado: false,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', pedidoId)
            .eq('tenant_id', tenantId);
        } else {
          // Período ya cerrado/facturado — no se puede anular. C6 ya no vuelve a
          // correr sobre un período facturado, así que en vez de solo loguear se
          // levanta una excepción BLOQUEANTE de conciliación (H2, D-A2).
          logger.warn(
            `Pedido ${pedidoId}: línea de cobro no anulada — período en estado '${estadoPeriodo}' ` +
            `(solo se anulan en período 'abierto'). Se levanta excepción de conciliación bloqueante.`,
          );

          eventoConciliacionCobroId = await levantarExcepcionLineaNoAnulable(supabase, {
            tenantId,
            pedidoId,
            sellerId,
            tipoLinea: 'cobro',
            lineaId: lineaCobro.id as string,
            tipoDiferencia: 'linea_cobro_sin_pedido_entregado',
            estadoNuevo,
            estadoContenedor: estadoPeriodo,
            periodoCobroId: lineaCobro.periodo_cobro_id ?? null,
            bloqueaFacturacion: true,
            bloqueaPago: false,
            jobRunId: runId,
          });
        }
      }

      // --- Línea de liquidación ---
      // `driver_id` se lee de la línea (no de `driverIdAsignado` del evento):
      // es el conductor que efectivamente quedó atado a la liquidación, y
      // puede diferir del conductor asignado AHORA si el pedido se reasignó
      // después de generar la línea.
      const { data: lineaLiq } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('id, anulada, liquidacion_id, driver_id')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (lineaLiq && !lineaLiq.anulada) {
        let puedeAnularLiq = false;
        let estadoLiquidacion: string | null = null;

        if (lineaLiq.liquidacion_id) {
          const { data: liq } = await supabase
            .schema('dinero')
            .from('liquidaciones')
            .select('estado')
            .eq('id', lineaLiq.liquidacion_id as string)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          estadoLiquidacion = liq?.estado ?? null;
          // Solo anular en borrador. 'emitida' y 'pagada' son inmutables.
          puedeAnularLiq = estadoLiquidacion === 'borrador';
        } else {
          // Línea sin liquidación asignada aún — se puede anular libremente.
          puedeAnularLiq = true;
        }

        if (puedeAnularLiq) {
          const motivoAnulacion = derivarMotivoAnulacion(estadoNuevo);
          const accionBitacora = derivarAccionBitacoraAnulacion(estadoNuevo);

          // Bitácora ANTES del UPDATE.
          await registrarEnBitacora(supabase, {
            tenantId,
            actorUsuarioId: null,
            actorTipo: 'sistema',
            accion: accionBitacora,
            entidadTipo: 'pedido',
            entidadId: pedidoId,
            detalle: {
              tipo_linea: 'liquidacion',
              linea_id: lineaLiq.id,
              estado_pedido: estadoNuevo,
              liquidacion_id: lineaLiq.liquidacion_id ?? null,
              estado_liquidacion: estadoLiquidacion,
              motivo: motivoAnulacion,
              job_run_id: runId,
            },
          });

          await supabase
            .schema('dinero')
            .from('lineas_liquidacion')
            .update({
              anulada: true,
              anulada_en: new Date().toISOString(),
              motivo_anulacion: motivoAnulacion,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', lineaLiq.id as string)
            .eq('tenant_id', tenantId)
            .eq('anulada', false); // idempotente

          anuloLiquidacion = true;

          // Resetear flag del pedido.
          await supabase
            .schema('operacion')
            .from('pedidos')
            .update({
              liquidacion_generada: false,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', pedidoId)
            .eq('tenant_id', tenantId);
        } else {
          // Liquidación ya emitida/pagada — no se puede anular. El conductor ya
          // cobró (o va a cobrar) una entrega cancelada/devuelta: se levanta una
          // excepción BLOQUEANTE de conciliación (H2, D-A2) en vez de solo loguear.
          logger.warn(
            `Pedido ${pedidoId}: línea de liquidación no anulada — liquidación en estado ` +
            `'${estadoLiquidacion}' (solo se anulan en 'borrador'). Se levanta excepción de conciliación bloqueante.`,
          );

          eventoConciliacionLiquidacionId = await levantarExcepcionLineaNoAnulable(supabase, {
            tenantId,
            pedidoId,
            sellerId,
            tipoLinea: 'liquidacion',
            lineaId: lineaLiq.id as string,
            tipoDiferencia: 'linea_liquidacion_sin_pedido_entregado',
            estadoNuevo,
            estadoContenedor: estadoLiquidacion,
            driverId: (lineaLiq.driver_id as string | null) ?? driverIdAsignado,
            liquidacionId: lineaLiq.liquidacion_id ?? null,
            bloqueaFacturacion: false,
            bloqueaPago: true,
            jobRunId: runId,
          });
        }
      }

      return {
        anuloCobro,
        anuloLiquidacion,
        eventoConciliacionCobroId,
        eventoConciliacionLiquidacionId,
      };
    });

    // Si ya anulamos líneas y el estado no genera nada nuevo, terminamos aquí.
    // No hace falta continuar con los pasos 2–6 (no hay líneas que insertar).
    if (!elegibilidad.generaCobro && !elegibilidad.generaLiquidacion) {
      logger.info(
        `Pedido ${pedidoId}: estado=${estadoNuevo} — no genera líneas nuevas. ` +
        `anuloCobro=${anulacionRealizada.anuloCobro}, anuloLiquidacion=${anulacionRealizada.anuloLiquidacion}.`,
      );
      return {
        pedidoId,
        generaCobro: false,
        lineaCobroId: null,
        generaLiquidacion: false,
        lineaLiquidacionId: null,
        anuloCobro: anulacionRealizada.anuloCobro,
        anuloLiquidacion: anulacionRealizada.anuloLiquidacion,
        eventoConciliacionCobroId: anulacionRealizada.eventoConciliacionCobroId,
        eventoConciliacionLiquidacionId: anulacionRealizada.eventoConciliacionLiquidacionId,
      };
    }

    // Paso 2: Generar línea de cobro (idempotente con ON CONFLICT DO NOTHING).
    const lineaCobroId = await step.run('generar-linea-cobro', async () => {
      if (!elegibilidad.generaCobro) {
        logger.info(`Pedido ${pedidoId}: no genera cobro (estado=${estadoNuevo}).`);
        return null;
      }

      const supabase = crearClienteServiceRole();
      const montoBase = tarifa.montoCobroBase;
      const ajuste = elegibilidad.ajusteCobroCLP;
      const concepto = `Servicio de entrega ${tipoPedido} — pedido ${pedidoId}`;

      // Snapshot inmutable de la regla económica (hallazgo P0 de auditoría):
      // se arma UNA vez y se escribe en el MISMO INSERT/UPDATE que determina
      // monto_base_clp/ajuste_incidencia_clp — atomicidad, no una escritura
      // separada. `genera` es siempre true aquí: este bloque solo se alcanza
      // cuando elegibilidad.generaCobro === true.
      const tarifaSnapshot: TarifaSnapshotInput | null = tarifaAplicableId
        ? {
            tarifaId: tarifaAplicableId,
            tipoEntrega: tarifa.tipoEntrega,
            modoCalculo: tarifa.modoCalculo,
            zona: tarifa.zona,
            zonaId: tarifa.zonaId,
            vigenteDesde: tarifa.vigenteDesde,
            vigenteHasta: tarifa.vigenteHasta,
            estado: tarifa.estado,
            minimoRetiroClp: tarifa.minimoRetiroClp,
            minimoFacturacionClp: tarifa.minimoFacturacionClp,
            recargoReprogramacionClp: tarifa.recargoReprogramacionClp,
          }
        : null;
      const incidenciaSnapshot: IncidenciaSnapshotInput | null = incidencia
        ? {
            id: incidencia.id,
            tipo: incidencia.tipo,
            afectaCobro: incidencia.afectaCobro,
            afectaLiquidacion: incidencia.afectaLiquidacion,
          }
        : null;
      const snapshotCobro = construirSnapshotRegla({
        lado: 'cobro',
        jobRunId: runId,
        generadoEn: new Date().toISOString(),
        tarifa: tarifaSnapshot,
        valorBaseClp: montoBase,
        ajusteIncidenciaClp: ajuste,
        comunaDestinatario,
        fechaTransicion,
        fechaEntregaLocal: fechaEntrega,
        estadoNuevo,
        estadoAnterior,
        tipoPedido,
        esGastoPropio,
        incidencia: incidenciaSnapshot,
        motivo: motivos.cobro,
        genera: true,
      });

      // INSERT con ON CONFLICT (pedido_id) DO NOTHING para idempotencia.
      const { data: insertada, error } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .insert({
          tenant_id: tenantId,
          seller_id: sellerId,
          pedido_id: pedidoId,
          tarifa_id: tarifaAplicableId!,
          monto_base_clp: montoBase,
          ajuste_incidencia_clp: ajuste,
          concepto,
          tipo_pedido: tipoPedido,
          fecha_entrega: fechaEntrega,
          incidencia_id: incidencia?.id ?? null,
          origen_generacion: 'motor_automatico',
          snapshot_regla: snapshotCobro,
        })
        .select('id')
        .maybeSingle();

      if (error && !error.message.includes('duplicate')) {
        throw new Error(`Error al insertar línea de cobro: ${error.message}`);
      }

      if (insertada) return insertada.id as string;

      // Conflicto: existe una línea con este pedido_id.
      // Si está anulada (reclasificación B1), reactivarla con los nuevos montos.
      const { data: existente } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id, anulada')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!existente) return null;

      if (existente.anulada) {
        await supabase
          .schema('dinero')
          .from('lineas_cobro')
          .update({
            anulada: false,
            anulada_en: null,
            motivo_anulacion: null,
            monto_base_clp: montoBase,
            ajuste_incidencia_clp: ajuste,
            concepto,
            fecha_entrega: fechaEntrega,
            incidencia_id: incidencia?.id ?? null,
            origen_generacion: 'motor_automatico',
            snapshot_regla: snapshotCobro,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', existente.id as string)
          .eq('tenant_id', tenantId)
          .eq('anulada', true); // idempotente
      }

      return existente.id as string;
    });

    // Paso 3: Asignar línea de cobro a su período.
    await step.run('asignar-periodo-cobro', async () => {
      if (!lineaCobroId) return;

      const supabase = crearClienteServiceRole();
      const periodoId = await obtenerOCrearPeriodoCobroAbierto(supabase, {
        tenantId,
        sellerId,
        fechaEntrega: new Date(fechaTransicion),
      });

      // UPDATE solo si la línea aún no tiene período asignado (idempotente).
      await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .update({ periodo_cobro_id: periodoId, actualizado_en: new Date().toISOString() })
        .eq('id', lineaCobroId)
        .eq('tenant_id', tenantId)
        .is('periodo_cobro_id', null);
    });

    // Paso 4: Generar línea de liquidación (idempotente con ON CONFLICT DO NOTHING).
    const lineaLiquidacionId = await step.run('generar-linea-liquidacion', async () => {
      if (!elegibilidad.generaLiquidacion || !driverIdAsignado) {
        logger.info(`Pedido ${pedidoId}: no genera liquidación (estado=${estadoNuevo}, driver=${driverIdAsignado}).`);
        return null;
      }

      const supabase = crearClienteServiceRole();
      const montoBase = tarifa.montoConductorBase;
      const ajuste = elegibilidad.ajusteLiquidacionCLP;
      const concepto = `Liquidación entrega ${tipoPedido} — pedido ${pedidoId}`;

      // Snapshot inmutable de la regla económica (hallazgo P0 de auditoría) —
      // ver comentario análogo en 'generar-linea-cobro'. El lado 'liquidacion'
      // NO lleva mínimos ni recargo de reprogramación (economía de cobro).
      const tarifaSnapshot: TarifaSnapshotInput | null = tarifaAplicableId
        ? {
            tarifaId: tarifaAplicableId,
            tipoEntrega: tarifa.tipoEntrega,
            modoCalculo: tarifa.modoCalculo,
            zona: tarifa.zona,
            zonaId: tarifa.zonaId,
            vigenteDesde: tarifa.vigenteDesde,
            vigenteHasta: tarifa.vigenteHasta,
            estado: tarifa.estado,
            minimoRetiroClp: tarifa.minimoRetiroClp,
            minimoFacturacionClp: tarifa.minimoFacturacionClp,
            recargoReprogramacionClp: tarifa.recargoReprogramacionClp,
          }
        : null;
      const incidenciaSnapshot: IncidenciaSnapshotInput | null = incidencia
        ? {
            id: incidencia.id,
            tipo: incidencia.tipo,
            afectaCobro: incidencia.afectaCobro,
            afectaLiquidacion: incidencia.afectaLiquidacion,
          }
        : null;
      const snapshotLiquidacion = construirSnapshotRegla({
        lado: 'liquidacion',
        jobRunId: runId,
        generadoEn: new Date().toISOString(),
        tarifa: tarifaSnapshot,
        valorBaseClp: montoBase,
        ajusteIncidenciaClp: ajuste,
        comunaDestinatario,
        fechaTransicion,
        fechaEntregaLocal: fechaEntrega,
        estadoNuevo,
        estadoAnterior,
        tipoPedido,
        esGastoPropio,
        incidencia: incidenciaSnapshot,
        motivo: motivos.liquidacion,
        genera: true,
      });

      const { data: insertada, error } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .insert({
          tenant_id: tenantId,
          driver_id: driverIdAsignado,
          pedido_id: pedidoId,
          monto_base_clp: montoBase,
          ajuste_incidencia_clp: ajuste,
          concepto,
          fecha_entrega: fechaEntrega,
          incidencia_id: incidencia?.id ?? null,
          origen_generacion: 'motor_automatico',
          snapshot_regla: snapshotLiquidacion,
        })
        .select('id')
        .maybeSingle();

      if (error && !error.message.includes('duplicate')) {
        throw new Error(`Error al insertar línea de liquidación: ${error.message}`);
      }

      if (insertada) return insertada.id as string;

      // Conflicto: si la línea existente está anulada (reclasificación B1), reactivarla.
      const { data: existente } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('id, anulada')
        .eq('pedido_id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!existente) return null;

      if (existente.anulada) {
        await supabase
          .schema('dinero')
          .from('lineas_liquidacion')
          .update({
            anulada: false,
            anulada_en: null,
            motivo_anulacion: null,
            monto_base_clp: montoBase,
            ajuste_incidencia_clp: ajuste,
            concepto,
            fecha_entrega: fechaEntrega,
            incidencia_id: incidencia?.id ?? null,
            origen_generacion: 'motor_automatico',
            snapshot_regla: snapshotLiquidacion,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', existente.id as string)
          .eq('tenant_id', tenantId)
          .eq('anulada', true); // idempotente
      }

      return existente.id as string;
    });

    // Paso 5: Asignar línea de liquidación a su liquidación abierta.
    await step.run('asignar-liquidacion', async () => {
      if (!lineaLiquidacionId || !driverIdAsignado) return;

      const supabase = crearClienteServiceRole();
      const liquidacionId = await obtenerOCrearLiquidacionAbierta(supabase, {
        tenantId,
        driverId: driverIdAsignado,
        fechaEntrega: new Date(fechaTransicion),
      });

      await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .update({ liquidacion_id: liquidacionId, actualizado_en: new Date().toISOString() })
        .eq('id', lineaLiquidacionId)
        .eq('tenant_id', tenantId)
        .is('liquidacion_id', null);
    });

    // Paso 6: Actualizar flags en operacion.pedidos.
    await step.run('actualizar-flags-pedido', async () => {
      const supabase = crearClienteServiceRole();

      // BUG FIX: la condición WHERE cobro_generado = false / liquidacion_generada = false
      // evita sobrescribir si el flag ya fue activado en un reintento previo.
      // Sin esta guarda, un segundo intento re-escribe el monto y el flag aunque
      // el INSERT haya sido absorbido por ON CONFLICT — comportamiento correcto
      // pero que puede sobreescribir un ajuste manual posterior.
      if (elegibilidad.generaCobro) {
        await supabase
          .schema('operacion')
          .from('pedidos')
          .update({
            cobro_generado: true,
            monto_cobro_clp: tarifa.montoCobroBase + elegibilidad.ajusteCobroCLP,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', pedidoId)
          .eq('tenant_id', tenantId)
          .eq('cobro_generado', false); // guarda idempotente
      }
      if (elegibilidad.generaLiquidacion) {
        await supabase
          .schema('operacion')
          .from('pedidos')
          .update({
            liquidacion_generada: true,
            monto_liquidacion_clp: tarifa.montoConductorBase + elegibilidad.ajusteLiquidacionCLP,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', pedidoId)
          .eq('tenant_id', tenantId)
          .eq('liquidacion_generada', false); // guarda idempotente
      }
    });

    // Paso 7: Bitácora de auditoría.
    await step.run('registrar-bitacora', async () => {
      const supabase = crearClienteServiceRole();
      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'dinero.lineas_generadas',
        entidadTipo: 'pedido',
        entidadId: pedidoId,
        detalle: {
          estado_pedido: estadoNuevo,
          genera_cobro: elegibilidad.generaCobro,
          genera_liquidacion: elegibilidad.generaLiquidacion,
          monto_cobro: tarifa.montoCobroBase,
          monto_liquidacion: tarifa.montoConductorBase,
          es_gasto_propio: esGastoPropio,
          job_run_id: runId,
        },
      });
    });

    logger.info(
      `Pedido ${pedidoId}: líneas generadas. cobro=${elegibilidad.generaCobro}, ` +
      `liquidacion=${elegibilidad.generaLiquidacion}.`,
    );

    return {
      pedidoId,
      generaCobro: elegibilidad.generaCobro,
      lineaCobroId,
      generaLiquidacion: elegibilidad.generaLiquidacion,
      lineaLiquidacionId,
    };
  },
);
