/**
 * Encender y apagar áreas de producto por courier — lado backstage.
 * =============================================================================
 *
 * La mitad de LECTURA para el courier vive en `superficie-courier.ts`
 * (`obtenerAreasHabilitadas`, courier-safe). Esto es la mitad de ESCRITURA, que
 * solo ejerce Rutax.
 *
 * -----------------------------------------------------------------------------
 * ESCRIBIR PIDE AAL2; LEER NO
 * -----------------------------------------------------------------------------
 * Encender un área le abre a un courier una parte del producto que Rutax declaró
 * no productiva; apagarla se la quita a todos sus usuarios de golpe. Es una
 * decisión de escritura con consecuencia inmediata sobre un cliente que está
 * operando, así que `fijarAreaDelCourier` pide `admin_total` + AAL2 — el mismo
 * listón que el resto de las escrituras del backstage. `soporte_lectura` no la
 * ejerce.
 *
 * Las dos lecturas (`listarAreasDelCourier`, `areasApagadasPorTenant`) piden
 * solo `exigirSuperAdmin`. Ponerles el gate de escritura —como estaba— dejaba a
 * `soporte_lectura` sin poder ver qué tenía apagado el courier que llama
 * preguntando justamente por eso.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ APAGAR ES BORRAR LA FILA, Y ESO PIERDE LA NOTA
 * -----------------------------------------------------------------------------
 * El modelo es «la fila significa encendida». Apagar borra la fila, así que la
 * nota y la fecha de cuando se encendió se van con ella. Se asume: el registro
 * que importa —quién apagó qué y cuándo— queda en la BITÁCORA, que es donde se
 * audita, y no en una tabla de configuración que se lee en cada request.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { AREAS_PRODUCTO, esAreaProducto, type AreaProducto } from '@/modules/identidad/areas-producto';
import { exigirSuperAdmin, exigirSuperAdminEscritura } from './autorizacion-admin';

export interface AreaDelCourier {
  area: AreaProducto;
  habilitada: boolean;
  habilitadaEn: string | null;
  nota: string | null;
}

/**
 * El estado de las cinco áreas para un courier, para pintarlo en el backstage.
 *
 * Devuelve SIEMPRE las cinco: las que no tienen fila salen como `habilitada:
 * false`. Una lista que solo trajera las encendidas obligaría a la pantalla a
 * reconstruir el resto, y ahí es donde se pierde un área nueva.
 */
export async function listarAreasDelCourier(tenantId: string): Promise<AreaDelCourier[]> {
  // ⚠️ LEER exige `exigirSuperAdmin`, no `…Escritura`. Estaba al revés: pedía
  // permiso de escritura (rol `admin_total` + AAL2) para una consulta, y el
  // efecto era que `soporte_lectura` —el rol que atiende al courier que llama
  // preguntando por qué no le aparece un botón— no podía ni ver qué áreas tenía
  // apagadas. El gate de escritura sigue donde corresponde: en
  // `fijarAreaDelCourier`.
  await exigirSuperAdmin();

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('plataforma')
    .from('areas_habilitadas')
    .select('area, habilitada_en, nota')
    .eq('tenant_id', tenantId);

  if (error) throw new Error(`No se pudieron leer las áreas del courier: ${error.message}`);

  const porArea = new Map(
    (data ?? [])
      .filter((f) => esAreaProducto(f.area))
      .map((f) => [
        f.area as AreaProducto,
        {
          habilitadaEn: (f.habilitada_en as string | null) ?? null,
          nota: (f.nota as string | null) ?? null,
        },
      ]),
  );

  return AREAS_PRODUCTO.map((area) => {
    const fila = porArea.get(area);
    return {
      area,
      habilitada: fila !== undefined,
      habilitadaEn: fila?.habilitadaEn ?? null,
      nota: fila?.nota ?? null,
    };
  });
}

/**
 * Enciende o apaga un área para un courier.
 *
 * Bitácora DESPUÉS de la escritura y antes de devolver: no hay evento Inngest ni
 * integración externa que proteger, y anotar antes dejaría un asiento de un
 * cambio que no ocurrió si la escritura fallara.
 *
 * ⚠️ El asiento va con `tenantId` del COURIER, no del admin: la pregunta que se
 * responde luego es «¿qué le apagaron a este courier y cuándo?», y buscarla por
 * el tenant del courier es como se busca.
 */
export async function fijarAreaDelCourier(params: {
  tenantId: string;
  area: AreaProducto;
  habilitar: boolean;
  nota?: string | null;
}): Promise<void> {
  const actor = await exigirSuperAdminEscritura();
  const { tenantId, area, habilitar } = params;
  const nota = params.nota?.trim() || null;

  const supabase = crearClienteServiceRole();

  if (habilitar) {
    const { error } = await supabase
      .schema('plataforma')
      .from('areas_habilitadas')
      .upsert(
        { tenant_id: tenantId, area, habilitada_por: actor.usuarioId, nota },
        { onConflict: 'tenant_id,area' },
      );
    if (error) throw new Error(`No se pudo encender el área: ${error.message}`);
  } else {
    const { error } = await supabase
      .schema('plataforma')
      .from('areas_habilitadas')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('area', area);
    if (error) throw new Error(`No se pudo apagar el área: ${error.message}`);
  }

  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: actor.usuarioId,
    actorTipo: 'super_admin',
    accion: habilitar ? 'plataforma.area_encendida' : 'plataforma.area_apagada',
    entidadTipo: 'area_producto',
    entidadId: tenantId,
    detalle: { area, nota },
  });
}

/**
 * Qué áreas tiene APAGADAS cada courier, en una sola consulta.
 *
 * 🔴 Existe porque el interruptor sin panorama no sirve. Con `listarAreasDelCourier`
 * se puede ver el estado de UN courier entrando a su ficha; la pregunta que se
 * hace de verdad —«¿a quién le tengo algo apagado?»— exigía abrir uno por uno.
 * Con veinte couriers eso no se hace, y un área que quedó apagada «hasta que
 * esté listo» se queda apagada para siempre sin que nadie se entere.
 *
 * Devuelve las APAGADAS y no las encendidas a propósito: lo normal es tenerlas
 * todas, así que la lista vacía es el caso sano y la pantalla solo tiene que
 * pintar la excepción.
 *
 * ⚠️ NO reusa `listarAreasDelCourier` en un bucle: serían N consultas para
 * pintar una lista. Es una sola con `in`, y por eso también hereda el corte de
 * PostgREST en 1000 filas — con cinco áreas por courier eso son 200 couriers,
 * muy por encima de la escala de Rutax, pero cuando deje de serlo esta consulta
 * empieza a mentir en silencio. Anotado acá para que se encuentre.
 */
export async function areasApagadasPorTenant(
  tenantIds: readonly string[],
): Promise<Map<string, AreaProducto[]>> {
  const apagadas = new Map<string, AreaProducto[]>();
  if (tenantIds.length === 0) return apagadas;

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('plataforma')
    .from('areas_habilitadas')
    .select('tenant_id, area')
    .in('tenant_id', [...tenantIds]);

  if (error) throw new Error(`No se pudieron leer las áreas de los couriers: ${error.message}`);

  // Fila = encendida, ausencia = apagada. Se invierte acá y no en la consulta
  // porque «no hay fila» no se puede pedir con un `where`.
  const encendidasPorTenant = new Map<string, Set<string>>();
  for (const fila of data ?? []) {
    const tid = fila.tenant_id as string;
    const set = encendidasPorTenant.get(tid) ?? new Set<string>();
    set.add(fila.area as string);
    encendidasPorTenant.set(tid, set);
  }

  for (const tenantId of tenantIds) {
    const encendidas = encendidasPorTenant.get(tenantId) ?? new Set<string>();
    const faltantes = AREAS_PRODUCTO.filter((a) => !encendidas.has(a));
    if (faltantes.length > 0) apagadas.set(tenantId, faltantes);
  }

  return apagadas;
}
