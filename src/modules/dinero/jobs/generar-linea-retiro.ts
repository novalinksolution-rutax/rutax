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
import { fechaLocalEnSantiago } from '@/lib/fecha-santiago';
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
  origen: 'bodega' | 'tenant' | 'tarifa_entrega' | 'sin_configurar';
}

/**
 * La DECISIÓN de cuánto vale una visita, separada de la lectura de la base.
 *
 * Se exporta para poder probarla de verdad. El patrón habitual de los jobs de
 * este repo es reflejar la lógica dentro del propio test, y eso prueba la
 * copia, no el código: si mañana alguien cambia la precedencia acá, el test
 * seguiría verde sobre su duplicado. Con la función exportada, no.
 *
 * Precedencia: bodega → tenant → **lo que se le paga por una ENTREGA** → sin
 * configurar. El override de la bodega gana incluso si el tenant tiene monto:
 * una bodega lejana vale lo que dice su propia fila.
 *
 * =============================================================================
 * EL TERCER NIVEL: LA TARIFA DE ENTREGA COMO SEMILLA (decisión del usuario)
 * =============================================================================
 * Un courier que recién empieza a usar el retiro no tiene por qué quedarse sin
 * pagarle a sus conductores mientras descubre que hay una pantalla nueva que
 * llenar. Si no configuró cuánto vale una visita, se usa lo que YA declaró que
 * le paga al conductor por una entrega (`identidad.tarifas.monto_conductor_clp`).
 *
 * ⚠️ Es una SEMILLA, no una equivalencia: visitar una bodega y entregar un
 * paquete no son el mismo trabajo. La pantalla de configuración lo dice con
 * todas sus letras para que la decisión de dejarlo así sea consciente.
 *
 * ⚠️⚠️ Y LA GUARDA QUE HACE QUE ESTO NO SEA EL BUG DE AYER OTRA VEZ: el valor de
 * la tarifa solo se usa si es **mayor que cero**. `monto_conductor_clp` nació con
 * `default 0` y ningún formulario la escribía, así que las tarifas que ya
 * existen en producción siguen en 0 hasta que alguien las edite. Caer a ese cero
 * sería exactamente el fallo que este job existe para impedir: pagar $0 en
 * silencio. Un 0 en la tarifa NO es una tarifa — es una tarifa sin configurar, y
 * cae al mismo `sin_configurar` que la ausencia total.
 */
export function resolverMontoVisita(
  overrideBodegaClp: number | string | null | undefined,
  porDefectoTenantClp: number | string | null | undefined,
  montoEntregaTarifaClp: number | string | null | undefined,
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

  // `> 0` y no `!= null`: ver la guarda de la cabecera. Un cero acá es una
  // tarifa sin configurar, no una tarifa de cero.
  const desdeTarifa = Math.round(Number(montoEntregaTarifaClp ?? 0));
  if (Number.isFinite(desdeTarifa) && desdeTarifa > 0) {
    return { montoClp: desdeTarifa, origen: 'tarifa_entrega' };
  }

  return { montoClp: null, origen: 'sin_configurar' };
}

/**
 * Cuánto le paga este courier al conductor por una ENTREGA de este seller.
 *
 * Misma precedencia que `crearPedidoSameDay` (pedidos.ts): tarifa específica del
 * seller antes que la del tenant, y entre varias la de vigencia más reciente. NO
 * se filtra por `tipo_entrega`: una visita a bodega no es ni flex ni same-day, y
 * lo que se busca es una referencia de "cuánto vale una unidad de trabajo para
 * este courier", no la tarifa exacta de un pedido.
 *
 * Un fallo de lectura devuelve `null` y NO lanza: este es el nivel de respaldo,
 * y hacerlo obligatorio convertiría un problema de la tarifa en un bloqueo del
 * pago del retiro. Si devuelve null, el job levanta su excepción como siempre.
 */
async function leerMontoConductorDeTarifa(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  sellerId: string,
): Promise<number | null> {
  const hoy = fechaLocalEnSantiago(new Date());
  const { data } = await supabase
    .schema('identidad')
    .from('tarifas')
    .select('monto_conductor_clp')
    .eq('tenant_id', tenantId)
    .eq('estado', 'activa')
    .lte('vigente_desde', hoy)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
    .or(`seller_id.eq.${sellerId},seller_id.is.null`)
    .order('seller_id', { ascending: false, nullsFirst: false })
    .order('vigente_desde', { ascending: false })
    .limit(1);

  const fila = data?.[0];
  return fila?.monto_conductor_clp != null ? Number(fila.monto_conductor_clp) : null;
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
    // Paso 2 · Resolver el monto: bodega → tenant → tarifa de entrega del seller.
    //
    // El override de bodega es NULLABLE y su NULL significa "hereda", nunca
    // "gratis" — el CHECK de la columna prohíbe el 0 justamente para que
    // "gratis" no se pueda expresar por accidente.
    //
    // La tarifa entra como TERCER nivel (ver `resolverMontoVisita`): se busca la
    // del seller de esta bodega con la MISMA precedencia que usa
    // `crearPedidoSameDay` —tarifa específica del seller antes que la del
    // tenant, y la de vigencia más reciente— para no inventar una tercera regla
    // de resolución de tarifas en el repo.
    // -------------------------------------------------------------------------
    const monto = await step.run('resolver-monto', async (): Promise<MontoResuelto> => {
      const supabase = crearClienteServiceRole();

      const [{ data: bodega, error: errorBodega }, { data: config, error: errorConfig }, tarifaClp] =
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
          leerMontoConductorDeTarifa(supabase, tenantId, sellerId),
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
        tarifaClp,
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
          fecha_hecho: datos.fechaOperacion,
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
