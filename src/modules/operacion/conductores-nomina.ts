/**
 * La nómina de conductores: lo que el listado del tablero B1c necesita y
 * `conductores.ts` no daba.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * DOS EJES QUE SE PARECEN Y NO SON EL MISMO
 * -----------------------------------------------------------------------------
 *   · `estado` — **la nómina**: `activo` | `inactivo`. Si alguien trabaja o no
 *     para este courier. Cambia pocas veces en la vida de un conductor.
 *   · `disponible` — **el día de hoy**. Un conductor de la nómina puede estar no
 *     disponible por día libre o licencia sin darse de baja.
 *
 * Confundirlos es el bug que este módulo existe para evitar: hasta el 23-08-2026
 * la pantalla dibujaba los dos como dos distintivos pegados en la misma línea, y
 * **`inactivo` no tenía transición** — se pintaba un estado al que nadie podía
 * llegar ni del que nadie podía salir. Es la brecha que el tablero marcaba.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ UN MÓDULO APARTE, Y NO MÁS COLUMNAS EN `Conductor`
 * -----------------------------------------------------------------------------
 * `Conductor` vive en `operacion/tipos.ts`, que tiene trabajo en curso ajeno a
 * esto y no se toca. `ConductorEnNomina` lo extiende acá con lo que el listado
 * necesita —RUT, relación laboral y zonas preferentes—, todo dato que **ya
 * estaba en base** (`identidad.conductores.rut`, `.tipo_relacion`,
 * `identidad.conductor_zonas`) y que la proyección simplemente no traía.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { puedeGestionarLiquidacionesConductores } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorValidacion } from "@/modules/identidad/errores";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { cerradasPorElConductor } from "./listado-manifiestos";
import type { Conductor } from "./tipos";

/**
 * Los estados terminales del pedido, para el lado OFICIAL de la cuenta.
 *
 * Es la mitad que llega desde la fuente (Mercado Libre en Flex). La otra mitad
 * —lo que el conductor declaró en su app— la trae `cerradasPorElConductor`, y
 * una parada cuenta si cualquiera de las dos la da por cerrada.
 */
const ESTADOS_TERMINALES_PEDIDO_NOMINA = new Set([
  "entregado",
  "entregado_manual",
  "fallido",
  "fallido_manual",
  "devuelto",
  "cancelado",
]);

const COLUMNAS_NOMINA =
  "id, tenant_id, estado, disponible, capacidad_paradas, vehiculo, nombre_completo, rut, tipo_relacion, banco, tipo_cuenta, numero_cuenta, telefono";

export type TipoRelacionConductor = "dependiente" | "independiente";

export interface ConductorEnNomina extends Conductor {
  /** `12345678-9`. Es el identificador con el que el courier lo distingue. */
  rut: string;
  /** Ley 21.431: se registra, no se infiere. */
  tipoRelacion: TipoRelacionConductor;
  /** Ids de zona preferente, ya resueltos — el listado los muestra en la fila. */
  zonaIds: string[];
  /**
   * E.164 sin `+`, o `null`. Dato personal (Ley 21.431): solo el vigente, sin
   * histórico. Va en la nómina y no solo en la ficha porque quien llama al
   * conductor es el coordinador, y la ficha está tras el gate financiero.
   */
  telefono: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaANomina(fila: Record<string, any>, zonaIds: string[]): ConductorEnNomina {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    estado: fila.estado as "activo" | "inactivo",
    disponible: Boolean(fila.disponible),
    capacidadParadas: Number(fila.capacidad_paradas),
    vehiculo: (fila.vehiculo as "moto" | "auto" | null) ?? null,
    nombre: fila.nombre_completo ?? "",
    banco: fila.banco ?? null,
    tipoCuenta: (fila.tipo_cuenta as "corriente" | "vista" | "ahorro" | null) ?? null,
    numeroCuenta: fila.numero_cuenta ?? null,
    telefono: fila.telefono ?? null,
    rut: fila.rut ?? "",
    tipoRelacion: (fila.tipo_relacion as TipoRelacionConductor) ?? "dependiente",
    zonaIds,
  };
}

/**
 * La nómina completa —activos e inactivos—, con sus zonas ya resueltas.
 *
 * Las zonas se traen en UNA consulta para todos y no una por conductor: en la
 * pantalla vieja cada tarjeta las pedía al desplegarse, así que las zonas no se
 * podían mostrar en la fila. Con nueve conductores da igual; con cincuenta, una
 * consulta por fila es lo que convierte una tabla en una espera.
 */
export async function listarNomina(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<ConductorEnNomina[]> {
  const [filas, zonas] = await Promise.all([
    leerTodasLasFilas<Record<string, unknown>>("nómina de conductores", (desde, hasta) =>
      cliente
        .schema("identidad")
        .from("conductores")
        .select(COLUMNAS_NOMINA)
        .eq("tenant_id", tenantId)
        .order("nombre_completo")
        .range(desde, hasta),
    ),
    leerTodasLasFilas<{ conductor_id: string; zona_id: string }>(
      "zonas preferentes",
      (desde, hasta) =>
        cliente
          .schema("identidad")
          .from("conductor_zonas")
          .select("conductor_id, zona_id")
          .eq("tenant_id", tenantId)
          .range(desde, hasta),
    ),
  ]);

  const porConductor = new Map<string, string[]>();
  for (const z of zonas) {
    const lista = porConductor.get(z.conductor_id) ?? [];
    lista.push(z.zona_id);
    porConductor.set(z.conductor_id, lista);
  }

  return filas.map((f) =>
    filaANomina(f, porConductor.get(f.id as string) ?? []),
  );
}

// =============================================================================
// El bloque HOY del cajón
// =============================================================================

export interface HoyDelConductor {
  /** Manifiesto del día, si tiene. */
  manifiestoId: string | null;
  paradasTotales: number;
  paradasCerradas: number;
  /** Visitas de retiro cerradas hoy y bultos escaneados en ellas. */
  visitasRetiro: number;
  bultosRetirados: number;
}

/**
 * Lo que cada conductor lleva hecho hoy, para todos de una vez.
 *
 * ⚠️ **No incluye la última posición del conductor**, que el tablero sí dibuja.
 * `operacion.ubicacion_conductor` **dejó de escribirse el 2026-08-14** por
 * decisión del usuario tras una revisión de privacidad: la última posición del
 * día sobrevivía indefinidamente y muchas veces era el domicilio del conductor
 * (Ley 21.431). Hay un candado de regresión —
 * `ubicacion-conductor-retirado.test.ts`— que hace fallar la suite si alguien
 * vuelve a consultar esa tabla. El tablero se dibujó sin esa decisión a la
 * vista; volver a mostrarla es una decisión nueva, no un hueco por llenar.
 */
export async function obtenerHoyDeConductores(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: string,
): Promise<Map<string, HoyDelConductor>> {
  const manifiestos = await leerTodasLasFilas<{ id: string; driver_id: string }>(
    "manifiestos del día",
    (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("manifiestos")
        .select("id, driver_id")
        .eq("tenant_id", tenantId)
        .eq("fecha_operacion", fecha)
        .in("estado", ["confirmado", "en_ruta", "completado"])
        .range(desde, hasta),
  );

  const porConductor = new Map<string, HoyDelConductor>();
  for (const m of manifiestos) {
    porConductor.set(m.driver_id, {
      manifiestoId: m.id,
      paradasTotales: 0,
      paradasCerradas: 0,
      visitasRetiro: 0,
      bultosRetirados: 0,
    });
  }

  const [asignaciones, sesiones] = await Promise.all([
    manifiestos.length === 0
      ? Promise.resolve([])
      : // PostgREST tipa toda relacion embebida como ARREGLO, aunque sea a-uno.
          // Se declara asi y se normaliza abajo; forzar el tipo a objeto es
          // pelearse con el cliente para nada.
          leerTodasLasFilas<{
            manifiesto_id: string;
            pedido_id: string;
            pedidos: { estado: string }[];
          }>(
          "paradas del día",
          (desde, hasta) =>
            cliente
              .schema("operacion")
              .from("asignaciones_pedido")
              .select("manifiesto_id, pedido_id, pedidos!inner(estado)")
              .eq("tenant_id", tenantId)
              .in(
                "manifiesto_id",
                manifiestos.map((m) => m.id),
              )
              // Solo la asignacion VIGENTE: la tabla guarda tambien las
              // historicas de cada reasignacion, y sin este filtro un pedido
              // que cambio de conductor contaria como dos paradas.
              .eq("activa", true)
              .range(desde, hasta),
        ),
    leerTodasLasFilas<{ conductor_id: string; bultos_resueltos: number | null }>(
      "retiros del día",
      (desde, hasta) =>
        cliente
          .schema("operacion")
          .from("sesiones_retiro")
          // `bultos_resueltos`, no `bultos_total`: son los que el escaneo logro
          // casar con un pedido, que es lo que de verdad se cargo en la van.
          .select("conductor_id, bultos_resueltos")
          .eq("tenant_id", tenantId)
          .eq("fecha_operacion", fecha)
          .range(desde, hasta),
    ),
  ]);

  const conductorDeManifiesto = new Map(manifiestos.map((m) => [m.id, m.driver_id]));

  /**
   * 🔴 **Una parada cuenta como cerrada si el conductor lo declaró en la app, o
   * si el estado oficial del pedido ya es terminal.**
   *
   * Acá había una copia propia de la lista de estados terminales, midiendo solo
   * contra `pedidos.estado`. En Flex ese estado lo escribe Mercado Libre y llega
   * con la sincronización, así que esta columna decía **«0 de 3»** de una ruta
   * que el conductor había cerrado entera y que Manifiestos ya daba por
   * completa: dos pantallas contradiciéndose sobre el mismo conductor.
   *
   * Ahora las dos usan `cerradasPorElConductor`, que es la misma unión que
   * cuenta la Torre de control. Una sola regla, un solo sitio donde cambiarla.
   */
  const declaradas = await cerradasPorElConductor(
    cliente,
    tenantId,
    asignaciones.map((a) => a.pedido_id),
  );

  for (const a of asignaciones) {
    const driverId = conductorDeManifiesto.get(a.manifiesto_id);
    if (!driverId) continue;
    const hoy = porConductor.get(driverId);
    if (!hoy) continue;
    hoy.paradasTotales += 1;
    const estado = Array.isArray(a.pedidos) ? a.pedidos[0]?.estado : undefined;
    const oficialCerrado = Boolean(estado && ESTADOS_TERMINALES_PEDIDO_NOMINA.has(estado));
    if (oficialCerrado || declaradas.has(a.pedido_id)) hoy.paradasCerradas += 1;
  }

  for (const s of sesiones) {
    const hoy = porConductor.get(s.conductor_id) ?? {
      manifiestoId: null,
      paradasTotales: 0,
      paradasCerradas: 0,
      visitasRetiro: 0,
      bultosRetirados: 0,
    };
    hoy.visitasRetiro += 1;
    hoy.bultosRetirados += Number(s.bultos_resueltos ?? 0);
    porConductor.set(s.conductor_id, hoy);
  }

  return porConductor;
}

// =============================================================================
// Sacar de la nómina · reincorporar
// =============================================================================

export interface ImpedimentoBaja {
  /** Qué lo impide, en una línea, ya redactada para la pantalla. */
  motivo: string;
}

/**
 * Comprueba si un conductor se puede sacar de la nómina, ANTES de ofrecerlo.
 *
 * Devuelve la lista de impedimentos —vacía si se puede—. La pantalla muestra el
 * botón deshabilitado **con su motivo**, nunca escondido: una acción que
 * desaparece no enseña nada, y la decisión de producto es que un acto bloqueado
 * se ve y dice por qué.
 *
 * Los dos impedimentos, y por qué cada uno:
 *
 *   1. **Manifiesto de hoy sin cerrar.** Los bultos están físicamente en su van.
 *      Sacarlo de la nómina dejaría una ruta viva sin dueño.
 *   2. **Liquidaciones sin pagar.** Se le debe plata. La baja no borra la deuda
 *      —el listado de liquidaciones la sigue mostrando—, pero sacar de la nómina
 *      a alguien a quien todavía no le pagas es exactamente el descuido que
 *      hace que esa deuda se pierda de vista.
 */
export async function verificarBajasNomina(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: string,
  conductorIds?: string[],
): Promise<Map<string, ImpedimentoBaja[]>> {
  const acotado = conductorIds && conductorIds.length > 0 ? conductorIds : null;

  const [manifiestos, liquidaciones] = await Promise.all([
    leerTodasLasFilas<{ driver_id: string }>("rutas de hoy sin cerrar", (desde, hasta) => {
      const q = cliente
        .schema("operacion")
        .from("manifiestos")
        .select("driver_id")
        .eq("tenant_id", tenantId)
        .eq("fecha_operacion", fecha)
        .in("estado", ["confirmado", "en_ruta"]);
      return (acotado ? q.in("driver_id", acotado) : q).range(desde, hasta);
    }),
    leerTodasLasFilas<{ driver_id: string }>("liquidaciones sin pagar", (desde, hasta) => {
      const q = cliente
        .schema("dinero")
        .from("liquidaciones")
        .select("driver_id")
        .eq("tenant_id", tenantId)
        .in("estado", ["borrador", "emitida"]);
      return (acotado ? q.in("driver_id", acotado) : q).range(desde, hasta);
    }),
  ]);

  const impedimentos = new Map<string, ImpedimentoBaja[]>();
  const agregar = (id: string, motivo: string) => {
    const lista = impedimentos.get(id) ?? [];
    lista.push({ motivo });
    impedimentos.set(id, lista);
  };

  for (const id of new Set(manifiestos.map((m) => m.driver_id))) {
    agregar(
      id,
      "Tiene una ruta de hoy sin cerrar. Redistribuye sus pedidos antes de sacarlo de la nómina.",
    );
  }

  const conteoLiq = new Map<string, number>();
  for (const l of liquidaciones) {
    conteoLiq.set(l.driver_id, (conteoLiq.get(l.driver_id) ?? 0) + 1);
  }
  for (const [id, n] of conteoLiq) {
    agregar(
      id,
      `Le debes ${n} ${n === 1 ? "liquidación" : "liquidaciones"} sin pagar. Págalas antes de darlo de baja.`,
    );
  }

  return impedimentos;
}

/**
 * Saca a un conductor de la nómina.
 *
 * ⚠️ **No es lo mismo que quitarle el acceso a la app.** El acceso lo gobierna
 * `identidad.perfiles` —otro eje, con su propia suspensión— y esta acción no lo
 * toca. La pantalla lo dice: prometer que se cierra la puerta cuando no se
 * cierra sería justamente lo que la regla 35 prohíbe.
 *
 * Requiere `gestionar_liquidaciones_conductores` (dueño y administración).
 * Decisión del usuario, 23-08-2026: la baja tiene consecuencia de dinero, no es
 * una decisión de terreno. El coordinador conserva «no disponible hoy» y la
 * redistribución, que es lo que necesita en la bodega.
 */
export async function desactivarConductor(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  motivo: string,
  fecha: string,
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<ConductorEnNomina> {
  if (!puedeGestionarLiquidacionesConductores(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para sacar conductores de la nómina",
    );
  }

  const motivoLimpio = motivo.trim();
  if (motivoLimpio.length < 3) {
    throw new ErrorValidacion("Escribe el motivo de la baja");
  }

  // Se vuelve a verificar en el servidor, no solo al pintar el botón: la
  // pantalla pudo quedar abierta mientras el conductor salía a ruta.
  const impedimentos =
    (await verificarBajasNomina(cliente, tenantId, fecha, [conductorId])).get(conductorId) ?? [];
  if (impedimentos.length > 0) {
    throw new ErrorValidacion(impedimentos.map((i) => i.motivo).join(" "));
  }

  // Bitácora ANTES del efecto (invariante de CLAUDE.md), con su autor y su
  // motivo: es una acción con consecuencia de dinero.
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conductor.baja_nomina",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: { conductor_id: conductorId, motivo: motivoLimpio },
  });

  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    // `disponible` baja junto con el estado: alguien fuera de la nómina no
    // puede estar disponible hoy, y dejar el flag arriba lo haría reaparecer
    // en la auto-asignación si algún día vuelve a la nómina.
    .update({ estado: "inactivo", disponible: false })
    .eq("id", conductorId)
    .eq("tenant_id", tenantId)
    .select(COLUMNAS_NOMINA)
    .maybeSingle();

  if (error) throw new Error(`Error al sacar de la nómina: ${error.message}`);
  if (!data) throw new ErrorValidacion(`Conductor ${conductorId} no encontrado en el tenant`);

  return filaANomina(data, []);
}

/**
 * Devuelve a un conductor a la nómina.
 *
 * Vuelve `activo` y **no disponible**: reincorporar no es ponerlo a trabajar
 * hoy. Que aparezca disponible de golpe lo metería en la auto-asignación del
 * día sin que nadie lo haya decidido.
 */
export async function reactivarConductor(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<ConductorEnNomina> {
  if (!puedeGestionarLiquidacionesConductores(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para reincorporar conductores a la nómina",
    );
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conductor.reincorporado_nomina",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: { conductor_id: conductorId },
  });

  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    .update({ estado: "activo", disponible: false })
    .eq("id", conductorId)
    .eq("tenant_id", tenantId)
    .select(COLUMNAS_NOMINA)
    .maybeSingle();

  if (error) throw new Error(`Error al reincorporar a la nómina: ${error.message}`);
  if (!data) throw new ErrorValidacion(`Conductor ${conductorId} no encontrado en el tenant`);

  return filaANomina(data, []);
}
