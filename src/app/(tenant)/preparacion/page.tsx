import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, Boxes } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeAsignarYReasignarPedidos, puedeVerPreparacionDia } from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  listarVisitasDelDia,
  obtenerCargaPorComuna,
  type CargaComunaRetiro,
  type VisitaRetiroResumenCourier,
} from "@/modules/operacion/retiro/preparacion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";
import {
  agruparVisitas,
  calcularMagnitudes,
  calcularSubtituloCabecera,
  clasificarEstadoCabecera,
  TEXTO_SUBTITULO_ERROR_CABECERA,
} from "./_lib/estado-preparacion";
import { FranjaMagnitudes } from "./_componentes/franja-magnitudes";
import { ListaVisitas } from "./_componentes/lista-visitas";
import { CargaPorComuna } from "./_componentes/carga-por-comuna";
import { BloqueAsignacion } from "./_componentes/bloque-asignacion";

export const metadata: Metadata = {
  title: "Preparación del día",
};

/**
 * Preparación del día — el retiro en bodega, en vivo (Etapa 5 del alcance
 * "retiro en bodega + ruteo").
 *
 * Reemplaza la coordinación por WhatsApp ("jefe, retiré 20 al seller X"): el
 * coordinador y el dueño ven qué conductor está en qué bodega, cuánto lleva
 * escaneado, y cómo se acumula la carga por comuna — sin llamar a nadie. Es
 * de SOLO LECTURA: la Etapa 5 no escribe nada; el hueco de "Asignación" es un
 * enlace de salida hacia Manifiestos (§12).
 *
 * Fuente de verdad de esta pantalla: docs/ux/etapa-5-preparacion-del-dia.md.
 *
 * RBAC: `ver_preparacion_dia` — dueño, supervisor y coordinador. NO
 * administración (rol financiero "sin reasignación operativa"). Mismo patrón
 * de gate que la Torre de control (`torre-de-control/page.tsx`): bloque
 * `ShieldAlert` en la propia página, no un `redirect`.
 */
export default async function PaginaPreparacionDelDia() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeVerPreparacionDia(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">No tienes permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            Preparación del día es para el dueño, el supervisor y el coordinador de tráfico.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const fecha = fechaLocalEnSantiago(new Date());
  const cliente = crearClienteServiceRole();
  // El bloque "Asignación" solo tiene sentido para quien de verdad puede
  // asignar (etapa-6-asignacion-en-bloque.md §15: "condicionando el botón
  // del bloque"). Hoy coincide con `ver_preparacion_dia` (dueño, supervisor,
  // coordinador — nunca administración), pero se pasa explícito para no
  // depender de que las dos matrices sigan coincidiendo por casualidad.
  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);

  // Dos consultas INDEPENDIENTES (§5.3, §16): si "carga por comuna" se cae,
  // las visitas tienen que seguir viéndose, y al revés. Un solo `try`
  // alrededor de ambas es justo el error a evitar acá.
  const [resVisitas, resCarga] = await Promise.all([
    listarVisitasDelDia(cliente, { tenantId, fecha }).then(
      (datos) => ({ ok: true as const, datos }),
      () => ({ ok: false as const, datos: [] as VisitaRetiroResumenCourier[] }),
    ),
    obtenerCargaPorComuna(cliente, { tenantId, fecha }).then(
      (datos) => ({ ok: true as const, datos }),
      () => ({ ok: false as const, datos: [] as CargaComunaRetiro[] }),
    ),
  ]);

  const errorVisitas = !resVisitas.ok;
  const errorCarga = !resCarga.ok;
  const visitas = resVisitas.datos;
  const cargaPorComuna = resCarga.datos;

  // `new Date().getTime()` y no `Date.now()`: mismo valor, pero `Date.now`
  // está en la lista de funciones impuras que `react-hooks/purity` (nueva
  // regla de `eslint-config-next`) rechaza llamar directo en el cuerpo de un
  // componente — mismo patrón ya usado sin aviso en `operaciones/page.tsx`
  // (`fechaLocalEnSantiago(new Date())`).
  const ahoraMs = new Date().getTime();

  // Sin datos de visitas no hay nada que clasificar: la cabecera cae al texto
  // de error de §13 y el resto de bloques que dependen de `visitas` (franja,
  // lista) muestran su propio vacío/guion — "Carga por comuna" sigue su
  // propio camino, independiente.
  const magnitudes = errorVisitas ? null : calcularMagnitudes(visitas, ahoraMs);
  const estadoCabecera = !errorVisitas && magnitudes ? clasificarEstadoCabecera(visitas, magnitudes) : null;
  const subtitulo =
    estadoCabecera && magnitudes
      ? calcularSubtituloCabecera(estadoCabecera, magnitudes)
      : TEXTO_SUBTITULO_ERROR_CABECERA;

  // Reemplazo COMPLETO del contenido bajo la cabecera (§5.4): solo cuando se
  // SABE que no hay visitas, nunca cuando la consulta falló (eso es
  // `error_carga`, un estado distinto — no se sabe si está vacío o no).
  const esArranqueVacio = estadoCabecera === "arranque_vacio";

  const { abiertas, cerradas } = errorVisitas ? { abiertas: [], cerradas: [] } : agruparVisitas(visitas);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Preparación del día</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitulo}</p>
        </div>
        <IndicadorEnVivo
          tenantId={tenantId}
          tablas={[
            { schema: "operacion", tabla: "sesiones_retiro" },
            { schema: "operacion", tabla: "bultos_retiro" },
            { schema: "operacion", tabla: "pedidos" },
          ]}
        />
      </div>

      {esArranqueVacio ? (
        <EmptyState
          icon={Boxes}
          tono="arranque"
          titulo="Todavía no hay retiros hoy"
          descripcion="Cuando un conductor abra una visita en la app, la vas a ver aquí, en vivo."
        />
      ) : (
        <>
          <FranjaMagnitudes magnitudes={magnitudes} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ListaVisitas errorVisitas={errorVisitas} abiertas={abiertas} cerradas={cerradas} />

            <div className="space-y-6">
              <CargaPorComuna errorCarga={errorCarga} filas={cargaPorComuna} />
              {puedeAsignar && <BloqueAsignacion tenantId={tenantId} fecha={fecha} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
