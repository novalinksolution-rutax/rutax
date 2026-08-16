/**
 * Job C8 · dinero/generarLineaRetiro — el segundo hecho generador (etapa 8)
 * =============================================================================
 * Trigger: `dinero/retiro.visita-cerrada`, publicado por
 * `operacion/retiro/sesiones.ts` cuando un conductor cierra una visita a bodega.
 *
 * Responsabilidad: escribir la línea de liquidación que le paga esa visita al
 * conductor. Se paga POR VISITA, no por bulto ni por pedido — decisión de
 * cierre del alcance (2026-08-12). Consecuencias que este job hereda gratis:
 * un traspaso de pedidos a otro conductor no puede tocar esta línea, y una
 * cancelación tampoco. La visita ocurrió.
 *
 * NO genera línea de cobro al seller: el retiro se le paga al conductor pero
 * todavía NO se le cobra al seller. `dinero.lineas_cobro` ni se mira.
 *
 * =============================================================================
 * LA REGLA QUE GOBIERNA ESTE JOB: SIN MONTO NO SE ESCRIBE UNA LÍNEA DE $0
 * =============================================================================
 * El 2026-08-15 se descubrió que `identidad.tarifas.monto_conductor_clp` había
 * nacido con `default 0`, que ningún formulario la escribía, y que TODA
 * liquidación de producción se había generado en $0 durante meses sin que nada
 * fallara. El síntoma apareció lejísimos del origen y nadie lo vio.
 *
 * Este job no repite ese error. Si el courier no configuró cuánto vale una
 * visita, NO escribe una línea de cero: levanta una excepción de conciliación
 * BLOQUEANTE de pago y deja la visita sin línea. El conductor no cobra $0 por
 * su viaje — el coordinador ve una alerta y arregla la configuración, y el job
 * la genera bien en el reintento.
 *
 * =============================================================================
 * IDEMPOTENCIA — TRES CAPAS, Y NINGUNA SOBRA
 * =============================================================================
 * 1. `id` determinístico del evento (`linea-retiro-${sesionId}`): Inngest
 *    deduplica el disparo.
 * 2. SELECT previo por `sesion_retiro_id`: el camino normal de un reintento.
 * 3. El índice `lineas_liq_sesion_retiro_uk` en la base: la red de la carrera
 *    entre dos runs simultáneos, que las dos anteriores no cubren. El 23505
 *    resultante se atrapa y se trata como éxito, igual que hace el job C1.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { existeEventoConciliacion, insertarEventoConciliacion } from '../conciliacion-insercion';

interface DatosVisitaCerrada {
  sesionRetiroId: string;
  tenantId: string;
  conductorId: string;
  bodegaId: string;
  sellerId: string;
  fechaOperacion: string;
  bultosTotal: number;
}

/**
 * Cuánto se le paga a esta visita, y de dónde salió el número.
 * `montoClp === null` significa "sin configurar" — nunca "cero".
 */
export interface MontoResuelto {
  montoClp: number | null;
  origen: 'bodega' | 'tenant' | 'sin_configurar';
}

/**
 * La DECISIÓN de cuánto vale una visita, separada de la lectura de la base.
 *
 * Se exporta para poder probarla de verdad. El patrón habitual de los jobs de
 * este repo es reflejar la lógica dentro del propio test, y eso prueba la
 * copia, no el código: si mañana alguien cambia la precedencia acá, el test
 * seguiría verde sobre su duplicado. Con la función exportada, no.
 *
 * Precedencia: bodega → tenant → sin configurar. El override de la bodega gana
 * incluso si el tenant tiene monto: una bodega lejana vale lo que dice su
 * propia fila.
 */
export function resolverMontoVisita(
  overrideBodegaClp: number | string | null | undefined,
  porDefectoTenantClp: number | string | null | undefined,
): MontoResuelto {
  // `!= null` y no un booleano: un 0 sería falsy y caería al siguiente nivel
  // como si no estuviera configurado. Los CHECK de la base prohíben el 0 en
  // ambas columnas, así que hoy no puede llegar — pero la precedencia no debe
  // depender de una garantía que vive en otra capa.
  if (overrideBodegaClp != null) {
    return { montoClp: Math.round(Number(overrideBodegaClp)), origen: 'bodega' };
  }
  if (porDefectoTenantClp != null) {
    return { montoClp: Math.round(Number(porDefectoTenantClp)), origen: 'tenant' };
  }
  return { montoClp: null, origen: 'sin_configurar' };
}

export const jobGenerarLineaRetiro = inngest.createFunction(
  {
    id: 'dinero/generarLineaRetiro',
    name: 'C8 · Línea de liquidación por visita a bodega',
    triggers: [{ event: 'dinero/retiro.visita-cerrada' }],
    retries: 3,
  },
  async ({ event, step, logger, runId }) => {
    const datos = event.data as DatosVisitaCerrada;
    const { sesionRetiroId, tenantId, conductorId, bodegaId, sellerId } = datos;

    // -------------------------------------------------------------------------
    // Paso 1 · ¿Ya existe la línea de esta visita?
    // -------------------------------------------------------------------------
    const yaGenerada = await step.run('buscar-linea-existente', async () => {
      const supabase = crearClienteServiceRole();
      const { data, error } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('sesion_retiro_id', sesionRetiroId)
        .maybeSingle();

      if (error) {
        throw new Error(`Error al buscar la línea de la visita ${sesionRetiroId}: ${error.message}`);
      }
      return (data?.id as string | undefined) ?? null;
    });

    if (yaGenerada) {
      return { estado: 'ya_generada', lineaId: yaGenerada };
    }

    // -------------------------------------------------------------------------
    // Paso 2 · Resolver el monto: override de la bodega → default del tenant.
    //
    // El override es NULLABLE y su NULL significa "hereda", nunca "gratis" — el
    // CHECK de la columna prohíbe el 0 justamente para que "gratis" no se pueda
    // expresar por accidente.
    // -------------------------------------------------------------------------
    const monto = await step.run('resolver-monto', async (): Promise<MontoResuelto> => {
      const supabase = crearClienteServiceRole();

      const [{ data: bodega, error: errorBodega }, { data: config, error: errorConfig }] =
        await Promise.all([
          supabase
            .schema('identidad')
            .from('seller_bodegas')
            .select('monto_visita_clp')
            .eq('tenant_id', tenantId)
            .eq('id', bodegaId)
            .maybeSingle(),
          supabase
            .schema('identidad')
            .from('courier_config_retiro')
            .select('monto_visita_bodega_clp')
            .eq('tenant_id', tenantId)
            .maybeSingle(),
        ]);

      // Un fallo de LECTURA no es "sin configurar": es un error transitorio, y
      // confundirlos escribiría una excepción bloqueante falsa. Se lanza para
      // que Inngest reintente.
      if (errorBodega) {
        throw new Error(`Error al leer la bodega ${bodegaId}: ${errorBodega.message}`);
      }
      if (errorConfig) {
        throw new Error(`Error al leer la configuración de retiro: ${errorConfig.message}`);
      }

      return resolverMontoVisita(
        bodega?.monto_visita_clp as number | string | null | undefined,
        config?.monto_visita_bodega_clp as number | string | null | undefined,
      );
    });

    // -------------------------------------------------------------------------
    // Paso 3 · Sin monto configurado → excepción bloqueante, NUNCA una línea $0.
    // -------------------------------------------------------------------------
    if (monto.montoClp === null) {
      await step.run('levantar-excepcion-sin-monto', async () => {
        const supabase = crearClienteServiceRole();

        const descripcion =
          `El conductor ${conductorId} cerró una visita a la bodega ${bodegaId} y no se pudo ` +
          `generar su pago: el courier no tiene configurado cuánto vale una visita a bodega. ` +
          `Configúralo en Configuración → Retiro (o en la bodega, si esta tiene tarifa propia) ` +
          `y la línea se generará sola. La visita quedó registrada; lo que falta es el pago.`;

        // Idempotente igual que el resto de los detectores: un reintento no
        // apila la misma alerta. Filtra por driverId + sesionRetiroId (la
        // visita es única de por sí; ambos juntos siguen el mismo criterio
        // de idempotencia que usa el resto de `conciliacion-insercion.ts`).
        const yaExiste = await existeEventoConciliacion(supabase, tenantId, 'retiro_sin_monto_configurado', {
          driverId: conductorId,
          sesionRetiroId,
        });
        if (yaExiste) return { duplicado: true };

        await insertarEventoConciliacion(supabase, {
          tenant_id: tenantId,
          seller_id: sellerId,
          driver_id: conductorId,
          sesion_retiro_id: sesionRetiroId,
          tipo_diferencia: 'retiro_sin_monto_configurado',
          descripcion,
          // Bloquea el PAGO, no la facturación: esto es dinero saliente hacia
          // el conductor y no toca nada del lado del seller.
          bloquea_pago: true,
          bloquea_facturacion: false,
          motivo_bloqueo: descripcion,
          estado: 'pendiente',
          job_run_id: runId,
        });
        return { duplicado: false };
      });

      logger.warn(
        `Visita ${sesionRetiroId} sin monto de retiro configurado — excepción bloqueante levantada.`,
      );
      return { estado: 'sin_monto_configurado', sesionRetiroId };
    }

    // -------------------------------------------------------------------------
    // Paso 4 · Escribir la línea. Bitácora ANTES del efecto (CLAUDE.md).
    // -------------------------------------------------------------------------
    const resultado = await step.run('insertar-linea', async () => {
      const supabase = crearClienteServiceRole();

      const concepto = `Retiro en bodega · ${datos.bultosTotal} bulto${datos.bultosTotal === 1 ? '' : 's'}`;

      await registrarEnBitacora(supabase, {
        tenantId,
        // Sin actor humano: lo genera el motor a partir de un hecho operativo.
        // El "quién" del hecho es el conductor, y está en el detalle.
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'dinero.linea_retiro_generada',
        entidadTipo: 'sesion_retiro',
        entidadId: sesionRetiroId,
        detalle: {
          driver_id: conductorId,
          bodega_id: bodegaId,
          seller_id: sellerId,
          monto_clp: monto.montoClp,
          origen_monto: monto.origen,
          bultos_total: datos.bultosTotal,
        },
      });

      const { data: insertada, error } = await supabase
        .schema('dinero')
        .from('lineas_liquidacion')
        .insert({
          tenant_id: tenantId,
          driver_id: conductorId,
          // El CHECK `lineas_liq_hecho_coherente` exige que sea exactamente
          // así: retiro ⇒ sin pedido, con visita.
          pedido_id: null,
          sesion_retiro_id: sesionRetiroId,
          tipo_hecho: 'retiro_bodega',
          monto_base_clp: monto.montoClp,
          ajuste_incidencia_clp: 0,
          concepto,
          // Columna heredada del nombre viejo: guarda la fecha del HECHO, que
          // acá es la de la visita. Se renombra a `fecha_hecho` en migración
          // aparte.
          fecha_entrega: datos.fechaOperacion,
          incidencia_id: null,
          origen_generacion: 'motor_automatico',
          snapshot_regla: {
            version: 1,
            tipo_hecho: 'retiro_bodega',
            regla: 'pago_por_visita_a_bodega',
            monto_clp: monto.montoClp,
            origen_monto: monto.origen,
            bodega_id: bodegaId,
            seller_id: sellerId,
            bultos_total: datos.bultosTotal,
            generado_en: new Date().toISOString(),
          },
        })
        .select('id')
        .maybeSingle();

      // Tercera capa de idempotencia: dos runs simultáneos. El texto 'duplicate'
      // es el mismo que produce un índice PARCIAL, verificado contra Postgres.
      if (error && !error.message.includes('duplicate')) {
        throw new Error(`Error al insertar la línea de retiro: ${error.message}`);
      }

      return { lineaId: (insertada?.id as string | undefined) ?? null };
    });

    return {
      estado: 'generada',
      lineaId: resultado.lineaId,
      montoClp: monto.montoClp,
      origenMonto: monto.origen,
    };
  },
);
