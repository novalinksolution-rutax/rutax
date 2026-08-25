/**
 * Purga del string del QR de retiro (etapa 10 · retención).
 * =============================================================================
 * `operacion.bultos_retiro_qr` guarda CIFRADO el payload literal del QR de la
 * etiqueta Flex. No trae datos personales —ni nombre ni dirección— pero es
 * CREDENCIAL-SÍMIL: incluye el `hash_code`, una firma de Mercado Libre que no se
 * puede calcular y que ML no reimprime una vez retirado el bulto.
 *
 * La política está decidida (2026-08-13): **el QR muere al llegar el pedido a
 * estado terminal, con 24-48 h de gracia**. La migración que creó la tabla
 * declaró `vence_en` y su índice, y dijo con todas sus letras que la purga era
 * de la etapa 10.
 *
 * =============================================================================
 * FALTABAN LAS DOS MITADES, NO UNA
 * =============================================================================
 * Al construir esto se verificó que NADA escribía `vence_en` — ni un trigger ni
 * una línea de código. O sea: la columna estaba siempre en NULL, así que aunque
 * hubiera existido un purgador, no habría tenido jamás una sola fila que borrar.
 * El dato se acumulaba indefinidamente y el índice parcial `where vence_en is
 * not null` no indexaba nada.
 *
 * Por eso este job hace DOS pasos, y el primero es el que faltaba de verdad:
 *   1. **Marcar**: QR de bultos cuyo pedido ya está en estado terminal y que
 *      todavía no tienen fecha de vencimiento → `vence_en = ahora + gracia`.
 *   2. **Purgar**: los que ya vencieron → DELETE.
 *
 * =============================================================================
 * POR QUÉ UN BARRIDO Y NO UN TRIGGER EN LA TRANSICIÓN DE ESTADO
 * =============================================================================
 * Un trigger sería inmediato, pero la gracia es de 24-48 h: la inmediatez no
 * compra nada. A cambio, acoplaría cada transición de estado de un pedido —un
 * camino calientísimo, con seis puntos de escritura— a una tabla de secretos.
 * El barrido es idempotente, se puede correr dos veces sin daño, y si un día
 * falla no bloquea una entrega.
 *
 * =============================================================================
 * SE BORRA LA FILA ENTERA, NO SE VACÍA EL PAYLOAD
 * =============================================================================
 * Dejar la fila con el payload en NULL conservaría la evidencia de que ese
 * bulto tuvo un QR, sin ningún valor operativo, y sería una fila más que
 * cualquier consulta futura tendría que aprender a ignorar. El acta de retiro
 * —que es lo que respalda un pago— vive en `bultos_retiro`, en OTRA tabla, y no
 * se toca: ese fue justamente el motivo de separarlas.
 * =============================================================================
 * 🔴 Y ASÍ Y TODO NO CORRIÓ NUNCA: LE FALTABA EL ESQUEMA
 * =============================================================================
 * Descubierto el 25-08-2026 en el tablero de salud de producción: «último éxito:
 * NUNCA». Las tres consultas pedían `bultos_retiro_qr` sin `.schema('operacion')`,
 * o sea contra `public`, donde esa tabla **no existe** —a diferencia de
 * `bultos_retiro`, que sí tiene vista espejo—. PostgREST respondía `PGRST205` en
 * la primera línea del primer paso, el job moría, y con dos reintentos tardaba
 * 1,2 minutos en darse por vencido.
 *
 * Lo que lo hizo invisible: **el escritor sí lleva el esquema**
 * (`retiro/qr-credencial.ts`), así que los QR se guardaban bien y solo fallaba
 * el que los borra. Una retención que no se cumple no rompe ninguna pantalla.
 *
 * ⚠️ Barrido hecho: es el ÚNICO sitio del repo que pide una tabla sin vista en
 * `public` sin calificar el esquema.
 *
 * =============================================================================
 * DOS TRAMPAS MÁS QUE ESTABAN ESPERANDO DETRÁS
 * =============================================================================
 * Ninguna se había manifestado porque el job jamás pasó de la primera consulta:
 *
 * · **`.limit(5000)` era mentira.** `config.toml` fija `max_rows = 1000` y
 *   PostgREST trunca EN SILENCIO. El job habría procesado 1.000 por corrida
 *   creyendo que barría todo.
 * · **`.in()` con miles de UUID revienta la URL.** Ya mordió en este repo con
 *   `URI too long`. Por eso ahora se avanza por lotes acotados.
 *
 * Se recorre con cursor sobre `bulto_id` (no con `offset`): las filas marcadas
 * salen del conjunto filtrado y una ventana por desplazamiento se saltaría
 * justo las que vienen detrás.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ESTADOS_TERMINALES_PEDIDO } from '../metricas';

/**
 * Gracia entre que el pedido llega a estado terminal y que su QR se puede
 * borrar. La política dice 24-48 h; se toma el extremo ALTO a propósito — el
 * margen de más cuesta unas horas de retención y el de menos cuesta un QR
 * irrecuperable si alguien necesita re-mirarlo por una disputa el día después.
 */
export const HORAS_GRACIA_QR = 48;

/**
 * Cuántos QR se revisan por lote. Acotado por los DOS extremos: `max_rows = 1000`
 * de PostgREST trunca en silencio por arriba, y un `.in()` con demasiados UUID
 * revienta la URL con `URI too long` — que ya pasó en este repo.
 */
const TAMANO_LOTE = 200;

/**
 * Tope de lotes por corrida (40.000 QR). Es un cortafuegos contra un bucle que
 * no avance, no una política de retención: si se alcanza, el job lo reporta y
 * el resto se barre mañana.
 */
const MAX_LOTES_POR_CORRIDA = 200;

/** Lo mínimo que hace falta saber de un bulto para decidir si su QR ya vence. */
export interface BultoParaVencimiento {
  /** `null` en un escaneo que nunca casó con un pedido (`no_procesado`). */
  pedidoId: string | null;
  /** Estado del pedido asociado; `null` si no hay pedido. */
  estadoPedido: string | null;
  escaneadoEnMs: number;
}

/**
 * ¿Ya se le puede poner fecha de defunción al QR de este bulto?
 *
 * Se exporta para probarla de verdad: es LA decisión de política de este job, y
 * equivocarse tiene dos costos asimétricos. Marcar de más borra un QR que ML no
 * reimprime —irrecuperable—; marcar de menos solo retiene un dato unas horas
 * más. Ante la duda, NO se marca.
 *
 * Dos caminos, y el segundo es el que no es obvio:
 * · Con pedido → manda su ESTADO. Terminal ⇒ el bulto ya no está en juego.
 *   La edad no cuenta: un pedido `en_ruta` de hace una semana sigue vivo.
 * · Sin pedido → manda la EDAD desde el escaneo. Es un `no_procesado`, que
 *   puede resolverse más tarde (el pedido podría no estar ingestado todavía),
 *   así que se le da la misma gracia antes de darlo por perdido.
 */
export function debeMarcarVencimiento(bulto: BultoParaVencimiento, ahoraMs: number): boolean {
  if (bulto.pedidoId && bulto.estadoPedido) {
    return ESTADOS_TERMINALES_PEDIDO.includes(bulto.estadoPedido as never);
  }

  // `Number.isFinite` primero: una fecha ilegible daría NaN, y `NaN > x` es
  // false — o sea que ya conservaría. Se comprueba explícito igual, porque
  // depender de cómo se comporta NaN en una comparación es la clase de cosa que
  // alguien "simplifica" sin darse cuenta.
  if (!Number.isFinite(bulto.escaneadoEnMs)) return false;

  return ahoraMs - bulto.escaneadoEnMs > HORAS_GRACIA_QR * 60 * 60 * 1000;
}

export const jobPurgarQrRetiro = inngest.createFunction(
  {
    id: 'operacion/purgarQrRetiro',
    name: 'Operación · Purgar QR de retiro vencidos (retención)',
    // 03:40 de Santiago, justo detrás de `purgarEvidencias` (03:30) para no
    // solapar dos purgas sobre la misma base, y muy después del corte operativo
    // (21-22 h): a esa hora no hay un conductor esperando nada.
    triggers: [{ cron: 'TZ=America/Santiago 40 3 * * *' }],
    retries: 2,
  },
  async ({ step, logger }) => {
    // -------------------------------------------------------------------------
    // Paso 1 · Marcar los que ya pueden empezar a contar su gracia.
    // -------------------------------------------------------------------------
    const marcados = await step.run('marcar-vencimiento', async () => {
      const supabase = crearClienteServiceRole();

      const ahora = Date.now();
      const venceEn = new Date(ahora + HORAS_GRACIA_QR * 60 * 60 * 1000).toISOString();

      let cursor = '';
      let revisados = 0;
      let marcados = 0;
      let lotes = 0;

      while (lotes < MAX_LOTES_POR_CORRIDA) {
        lotes += 1;

        // ⚠️ `.schema('operacion')` — sin esto es `public.bultos_retiro_qr`, que
        // NO existe, y el job entero muere acá con PGRST205. Fue el bug.
        //
        // El cursor va sobre `bulto_id` y no sobre un desplazamiento: marcar una
        // fila la saca del filtro `vence_en is null`, así que una ventana por
        // offset se saltaría tantas filas como haya marcado.
        let consulta = supabase
          .schema('operacion')
          .from('bultos_retiro_qr')
          .select('bulto_id')
          .is('vence_en', null)
          .order('bulto_id', { ascending: true })
          .limit(TAMANO_LOTE);
        if (cursor) consulta = consulta.gt('bulto_id', cursor);

        const { data: pendientes, error: errorPendientes } = await consulta;

        if (errorPendientes) {
          throw new Error(`Error al leer QR sin vencimiento: ${errorPendientes.message}`);
        }
        if (!pendientes || pendientes.length === 0) break;

        const ids = pendientes.map((f) => f.bulto_id as string);
        cursor = ids[ids.length - 1];
        revisados += ids.length;

        const { data: bultos, error: errorBultos } = await supabase
          .schema('operacion')
          .from('bultos_retiro')
          .select('id, pedido_id, escaneado_en, pedidos(estado)')
          .in('id', ids);

        if (errorBultos) {
          throw new Error(`Error al leer los bultos de los QR: ${errorBultos.message}`);
        }

        const aMarcar: string[] = [];
        for (const bulto of bultos ?? []) {
          const fila = bulto as Record<string, unknown>;
          const pedido = fila.pedidos as { estado?: string } | null;

          const marcar = debeMarcarVencimiento(
            {
              pedidoId: (fila.pedido_id as string | null) ?? null,
              estadoPedido: pedido?.estado ?? null,
              escaneadoEnMs: new Date(fila.escaneado_en as string).getTime(),
            },
            ahora,
          );
          if (marcar) aMarcar.push(fila.id as string);
        }

        if (aMarcar.length > 0) {
          const { error: errorMarcar } = await supabase
            .schema('operacion')
            .from('bultos_retiro_qr')
            .update({ vence_en: venceEn })
            // `.is('vence_en', null)` es compare-and-set: si otra corrida lo
            // marcó entre la lectura y esta escritura, NO se le empuja la fecha
            // hacia adelante. Sin esto, dos corridas seguidas podrían posponer
            // la purga indefinidamente.
            .is('vence_en', null)
            .in('bulto_id', aMarcar);

          if (errorMarcar) {
            throw new Error(`Error al marcar el vencimiento de los QR: ${errorMarcar.message}`);
          }
          marcados += aMarcar.length;
        }

        // Página incompleta = se acabaron.
        if (ids.length < TAMANO_LOTE) break;
      }

      // Sin cortes mudos: si el tope se agotó, queda cola para mañana y hay que
      // poder verlo. Un job de retención que "termina bien" dejando trabajo sin
      // hacer es indistinguible de uno que terminó de verdad.
      const truncado = lotes >= MAX_LOTES_POR_CORRIDA;
      return { revisados, marcados, truncado };
    });

    // -------------------------------------------------------------------------
    // Paso 2 · Borrar los que ya vencieron.
    // -------------------------------------------------------------------------
    const purgados = await step.run('purgar-vencidos', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('operacion')
        .from('bultos_retiro_qr')
        .delete()
        .lt('vence_en', new Date().toISOString())
        .select('bulto_id');

      if (error) {
        throw new Error(`Error al purgar los QR vencidos: ${error.message}`);
      }
      return data?.length ?? 0;
    });

    // Solo cifras. NUNCA un payload, ni un `bulto_id`: el objetivo del job es
    // que ese dato deje de existir, y loguear sus identificadores lo movería de
    // una tabla con `revoke all` a los registros de la aplicación.
    logger.info(
      `Purga de QR de retiro: ${marcados.marcados} marcados (de ${marcados.revisados} sin vencimiento), ` +
        `${purgados} purgados${marcados.truncado ? ' · TOPE DE LOTES ALCANZADO, queda cola' : ''}.`,
    );

    return {
      revisadosSinVencimiento: marcados.revisados,
      marcados: marcados.marcados,
      purgados,
      truncado: marcados.truncado,
    };
  },
);
