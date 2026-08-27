"use client";

/**
 * La nómina de conductores — tabla + cajón lateral (tablero B1c).
 *
 * -----------------------------------------------------------------------------
 * QUÉ REEMPLAZA
 * -----------------------------------------------------------------------------
 * Una pila de tarjetas-acordeón, una por conductor, donde para ver el cupo de
 * alguien había que desplegarlo y para comparar dos había que desplegar los dos.
 * El tablero lo resuelve como el resto del producto: **listado con filtros a la
 * izquierda, panel de detalle al costado**.
 *
 * -----------------------------------------------------------------------------
 * QUÉ MIRA ESTA TABLA (reestructurada el 26-08-2026, decisión del usuario)
 * -----------------------------------------------------------------------------
 * Decía quién es cada conductor y casi nada de qué está haciendo. Ahora las
 * cinco columnas son: **quién · su ruta de hoy · sus retiros de hoy · su cupo ·
 * sus zonas**, o sea la nómina y el día en la misma fila.
 *
 * · La **disponibilidad baja bajo el nombre** y la columna «Hoy» desaparece: era
 *   un distintivo solo, gastando una columna entera.
 * · **Ruta y Retiros suben desde el cajón.** Estaban ahí adentro, en un bloque
 *   «Hoy», donde solo se veían de a un conductor — que es justo lo contrario de
 *   lo que se viene a hacer acá: comparar a los quince.
 * · **«Relación» deja de ser columna** y se va al cajón, donde ya estaba en su
 *   cabecera. Solo importa cuando se le paga, y Liquidaciones ya la muestra ahí.
 *
 * ⚠️ **Siguen siendo CINCO columnas.** El usuario ya había descartado abrir una
 * más (23-08-2026): en la tablet de la bodega el ancho está ajustado, y con seis
 * a 375 px la primera colapsa y el nombre deja de leerse. Esto entra sin gastar
 * ancho nuevo porque retira dos y agrega dos.
 *
 * -----------------------------------------------------------------------------
 * DOS EJES, Y UNA TRAMA
 * -----------------------------------------------------------------------------
 * `estado` (la nómina) y `disponible` (hoy) son ejes distintos, y la regla nº 4
 * del bloque prohíbe combinarlos en un distintivo — que es exactamente lo que
 * hacía la pantalla vieja con dos `Badge` pegados.
 *
 * El distintivo muestra **un solo valor de tres** y estar fuera de la nómina se
 * lee además por la **trama diagonal de toda la fila**: codificación secundaria
 * de verdad, que sobrevive al monocromo y a la ceguera de color (regla 5).
 *
 * -----------------------------------------------------------------------------
 * LA ZONA DE CONSECUENCIA
 * -----------------------------------------------------------------------------
 * Las dos acciones que cambian algo de verdad —redistribuir la ruta y sacar de
 * la nómina— viven juntas, enmarcadas, al fondo del cajón. No mezcladas entre
 * los editores de cupo y zonas, que son inocuos y se usan todo el día.
 *
 * «Sacar de la nómina» es el peldaño 2 de la escalera de fricción: dice la
 * consecuencia **y** pide el motivo. Y cuando está bloqueada se muestra
 * deshabilitada **con su motivo escrito**, nunca escondida.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, Minus, Plus, Users } from "lucide-react";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { BarraCajones } from "@/components/ui/barra-cajones";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  estadoDelDiaConductor,
  TEXTO_RELACION_CONDUCTOR,
  TEXTO_VEHICULO_CONDUCTOR,
} from "@/lib/ui/traduccion-estados";
import { formatearTelefonoLegible } from "@/lib/telefono-cl";
import { EditorTelefonoConductor } from "./editor-telefono";
import type { Conductor, Zona } from "@/modules/operacion/tipos";
import {
  esVehiculoConductor,
  type VehiculoConductor,
} from "@/modules/operacion/conductores";
import type {
  ConductorEnNomina,
  HoyDelConductor,
} from "@/modules/operacion/conductores-nomina";
import {
  actionActualizarCapacidadConductor,
  actionActualizarVehiculoConductor,
  actionSacarDeNomina,
  actionReincorporarANomina,
} from "./actions";
import {
  DialogNuevoConductor,
  EditorZonasConductor,
  EditorDatosBancarios,
  SeccionRedistribucion,
} from "./panel-conductores";

export interface EstadoNomina {
  conductores: ConductorEnNomina[];
  zonas: Zona[];
  /** Lo que cada conductor lleva hecho hoy, por id. */
  hoy: Record<string, HoyDelConductor>;
  /** Por qué NO se puede sacar de la nómina a cada uno, por id. */
  impedimentos: Record<string, string[]>;
}

interface Props {
  estadoInicial: EstadoNomina;
  fechaHoy: string;
  puedeEditarBanco: boolean;
  /** `gestionar_liquidaciones_conductores` — dueño y administración. */
  puedeGestionarNomina: boolean;
}

/**
 * El ancho del cajón que fija el tablero.
 *
 * Lleva `!` porque `SheetContent` trae su propio `data-[side=right]:sm:max-w-sm`
 * (384 px) y ese selector gana por especificidad: sin forzarlo, el cajón sale
 * 32 px más ancho que el tablero y nadie se entera mirando el código.
 */
const ANCHO_CAJON = "w-full sm:max-w-[352px]!";

/**
 * Las cinco columnas de datos, en su proporción — la sexta, el chevrón, va
 * fuera de la grilla porque es del botón, no de los datos.
 *
 * En angosto la tabla NO se encoge: se rehace en `ficha de fila 390`. Con seis
 * columnas a 375 px la primera colapsa a 24 px —el nombre deja de leerse— y el
 * documento desborda a lo ancho. El tablero no dibuja esta pantalla en teléfono,
 * así que se aplica lo que P1 fija para todo el producto: «el teléfono no es una
 * reducción», y lo que cae reaparece bajo el nombre, en mono.
 */
// La cuarta columna pasa de .65 a .8: ahora lleva el vehículo Y el cupo, y con
// .65 «Sin declarar» se cortaba.
//
// El ancho se midió, no se estimó: «Sin declarar» ocupa 83 px y «30 paradas» 66,
// así que a .8 la celda tiene ~110 px de los ~95 que necesita. Lo que sobraba se
// le devolvió a «Zonas preferentes» —que es `truncate` y con dos zonas reales ya
// se cortaba—, y el reparto total no cambia: los mismos 5,55fr.
const COLUMNAS_ANCHO = "grid-cols-[1.7fr_1.05fr_1fr_.8fr_1fr]";

export function PanelNomina({
  estadoInicial,
  fechaHoy,
  puedeEditarBanco,
  puedeGestionarNomina,
}: Props) {
  const [conductores, setConductores] = useState(estadoInicial.conductores);
  const [cajon, setCajon] = useState<string | null>(null);
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const zonas = estadoInicial.zonas;

  const enNomina = conductores.filter((c) => c.estado === "activo");
  const fuera = conductores.filter((c) => c.estado === "inactivo");
  const disponiblesHoy = enNomina.filter((c) => c.disponible).length;

  const visibles = cajon === "inactivos" ? fuera : enNomina;
  const seleccionado = conductores.find((c) => c.id === seleccionadoId) ?? null;

  /**
   * Funde la fila devuelta por el servidor con la que ya está en pantalla.
   *
   * Acepta un `Conductor` a secas —que es lo que devuelven los editores
   * heredados— y no un `ConductorEnNomina`: fundir en vez de reemplazar es lo
   * que conserva el RUT, la relación y las zonas, que esas acciones no traen de
   * vuelta y que reemplazando se borrarían de la tabla.
   */
  function alActualizar(c: Conductor) {
    setConductores((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...c } : x)));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Conductores</h1>
          <p className="rx-num mt-1 text-xs text-fg-muted">
            {enNomina.length} en nómina · {disponiblesHoy} disponibles hoy
          </p>
        </div>
        <DialogNuevoConductor
          onCreado={(c) =>
            setConductores((prev) =>
              [
                ...prev,
                // El alta devuelve un `Conductor` base. El RUT, la relación y
                // el teléfono los acaba de escribir el propio formulario, así
                // que la fila se completa al recargar; mientras tanto no se
                // inventa nada.
                { ...c, rut: "", tipoRelacion: "dependiente" as const, zonaIds: [], telefono: null },
              ].sort(
                (a, b) => a.nombre.localeCompare(b.nombre, "es-CL"),
              ),
            )
          }
        />
      </div>

      {/* La barra solo aparece si hay a quién filtrar: con la nómina entera
          activa, un solo cajón no separa nada y es decoración.

          `inactivos` va como cajón EXCLUIDO —tras el separador, en tono inerte—
          porque no pertenece al conjunto operativo y no debe sumar con «en
          nómina». Es exactamente el caso para el que la barra tiene esa figura. */}
      {fuera.length > 0 ? (
        <BarraCajones
          cajones={[{ clave: "nomina", etiqueta: "En nómina", conteo: enNomina.length }]}
          excluido={{
            clave: "inactivos",
            etiqueta: "Fuera de nómina",
            conteo: fuera.length,
          }}
          activo={cajon}
          onSeleccionar={(c) => {
            setCajon(c);
            setSeleccionadoId(null);
          }}
          total={conductores.length}
        />
      ) : null}

      {visibles.length === 0 ? (
        <EmptyState
          icon={Users}
          titulo={
            cajon === "inactivos"
              ? "Nadie fuera de la nómina"
              : "Todavía no tienes conductores"
          }
          descripcion={
            cajon === "inactivos"
              ? "Acá aparecen los conductores que diste de baja, para poder reincorporarlos."
              : "Crea el primero con «Crear conductor» para empezar a armar el pool del día."
          }
        />
      ) : (
        <div className="border border-line">
          {/* La cabecera solo existe donde hay columnas: en la ficha de 390 cada
              dato ya viene rotulado por su posición y su tipografía. */}
          <div
            className={`hidden px-3 sm:flex sm:items-center sm:gap-2 border-b border-line bg-bg-sunken text-[10px] font-medium tracking-[0.08em] text-fg-muted uppercase`}
            role="row"
          >
            <span className={`flex-1 grid ${COLUMNAS_ANCHO}`}>
              <span className="py-2 pr-3">Conductor</span>
              <span className="py-2 pr-3">Ruta de hoy</span>
              <span className="py-2 pr-3">Retiros de hoy</span>
              <span className="py-2 pr-3">Vehículo y cupo</span>
              <span className="py-2 pr-3">Zonas preferentes</span>
            </span>
            <span className="w-4 shrink-0" />
          </div>
          {visibles.map((c) => (
            <FilaConductor
              key={c.id}
              conductor={c}
              hoy={estadoInicial.hoy[c.id]}
              zonas={zonas}
              seleccionado={c.id === seleccionadoId}
              onSeleccionar={() => setSeleccionadoId(c.id)}
            />
          ))}
        </div>
      )}

      <CajonConductor
        conductor={seleccionado}
        impedimentos={seleccionado ? (estadoInicial.impedimentos[seleccionado.id] ?? []) : []}
        zonas={zonas}
        fechaHoy={fechaHoy}
        puedeEditarBanco={puedeEditarBanco}
        puedeGestionarNomina={puedeGestionarNomina}
        onCerrar={() => setSeleccionadoId(null)}
        onActualizado={alActualizar}
      />
    </div>
  );
}

/**
 * Lo que el conductor lleva hecho hoy, en dos celdas.
 * =============================================================================
 *
 * Subieron desde el bloque «Hoy» del cajón, donde solo se veían de a uno. La
 * pregunta de esta pantalla a las 18:00 es «¿quién va colgado?», y eso es una
 * comparación entre filas: dentro de un cajón no se puede hacer.
 *
 * 🔴 **Sin ruta se dibuja «—», nunca «0 de 0».** Un cero afirma que tiene una
 * ruta y no ha cerrado nada, que es la lectura opuesta a la verdadera —todavía
 * no le asignaron ninguna— y a las 15:50 esa confusión manda a llamar al
 * conductor equivocado.
 */
function CeldaRutaDeHoy({ hoy }: { hoy: HoyDelConductor | undefined }) {
  if (!hoy?.manifiestoId || hoy.paradasTotales === 0) {
    return <span className="text-sm text-fg-subtle">—</span>;
  }
  const porcentaje = Math.round((hoy.paradasCerradas / hoy.paradasTotales) * 100);
  return (
    <span className="flex flex-col gap-1">
      <span className="rx-num text-sm text-fg">
        {hoy.paradasCerradas} de {hoy.paradasTotales}
        <span className="ms-1 text-xs text-fg-muted">paradas</span>
      </span>
      {/* La barra es secundaria y por eso va debajo y fina: la cifra es la que
          se compara entre filas, el trazo solo la hace ojeable. */}
      <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${porcentaje}%` }}
        />
      </span>
    </span>
  );
}

function CeldaRetirosDeHoy({ hoy }: { hoy: HoyDelConductor | undefined }) {
  if (!hoy || hoy.visitasRetiro === 0) {
    return <span className="text-sm text-fg-subtle">—</span>;
  }
  return (
    <span className="flex flex-col">
      <span className="rx-num text-sm text-fg">
        {hoy.visitasRetiro}
        <span className="ms-1 text-xs text-fg-muted">
          {hoy.visitasRetiro === 1 ? "visita" : "visitas"}
        </span>
      </span>
      <span className="rx-num text-xs text-fg-muted">{hoy.bultosRetirados} bultos</span>
    </span>
  );
}

// =============================================================================
// La fila
// =============================================================================

function FilaConductor({
  conductor,
  hoy: hoyDelDia,
  zonas,
  seleccionado,
  onSeleccionar,
}: {
  conductor: ConductorEnNomina;
  hoy: HoyDelConductor | undefined;
  zonas: Zona[];
  seleccionado: boolean;
  onSeleccionar: () => void;
}) {
  const hoy = estadoDelDiaConductor(conductor.estado, conductor.disponible);
  const fueraDeNomina = conductor.estado === "inactivo";
  const nombresZona = conductor.zonaIds
    .map((id) => zonas.find((z) => z.id === id)?.nombre)
    .filter((n): n is string => Boolean(n));
  const relacion = TEXTO_RELACION_CONDUCTOR[conductor.tipoRelacion] ?? conductor.tipoRelacion;
  const textoZonas = nombresZona.length > 0 ? nombresZona.join(", ") : "Sin zonas";
  /**
   * El día, condensado para la ficha de 390 — donde no hay columnas.
   *
   * Se prefiere la ruta al cupo: el cupo es una constante del conductor y la
   * ruta es lo que está pasando. Si no tiene ruta todavía, entonces sí manda el
   * cupo, que es lo que dice cuánto se le puede dar.
   */
  /**
   * En 390 el vehículo entra en la línea de detalle, no en una fila propia. Y va
   * PEGADO al cupo, formando un solo segmento —«Auto · 30 paradas»— igual que en
   * la tabla, donde comparten celda.
   *
   * ⚠️ Cuando el vehículo está, el cupo pierde las palabras «de cupo». No es
   * capricho: esta línea es `truncate`, o sea UNA sola con puntos suspensivos, y
   * a 375 px ya se cortaba antes de esto —«30 paradas de cupo · Si…»—. El
   * vehículo delante aporta el contexto que esas dos palabras cargaban, así que
   * salen y el añadido no le quita ancho a las zonas.
   *
   * Se omite cuando no está declarado: en el teléfono el espacio es el recurso
   * escaso, y «Sin declarar» ahí gasta ancho para decir que falta un dato que se
   * completa desde el escritorio. En la tabla sí se dice, que es donde el
   * courier revisa su nómina.
   */
  const vehiculoCorto = conductor.vehiculo
    ? TEXTO_VEHICULO_CONDUCTOR[conductor.vehiculo]
    : null;
  const resumenDelDia =
    hoyDelDia?.manifiestoId && hoyDelDia.paradasTotales > 0
      ? `${hoyDelDia.paradasCerradas} de ${hoyDelDia.paradasTotales} paradas`
      : vehiculoCorto
        ? `${conductor.capacidadParadas} paradas`
        : `${conductor.capacidadParadas} paradas de cupo`;
  const distintivo = <DistintivoEstado tono={hoy.tono} etiqueta={hoy.etiqueta} />;

  return (
    <button
      type="button"
      onClick={onSeleccionar}
      className={[
        "flex w-full items-center gap-2 border-b border-line-subtle px-3 text-left last:border-b-0",
        "hover:bg-bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-text",
        // La trama es del tono `inert` y va en toda la fila: es el segundo
        // portador del estado «fuera de nómina», el que sobrevive en monocromo.
        fueraDeNomina ? "rx-inert-row text-fg-muted" : null,
        seleccionado ? "bg-bg-sunken shadow-[inset_2px_0_0_var(--rx-accent-text)]" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={seleccionado ? "true" : undefined}
    >
      {/* En 390 la ficha; de `sm` hacia arriba, la grilla de columnas. Es el
          MISMO botón: cambia la disposición del contenido, no el objeto
          tocable. */}
      <FichaFila390
        className="flex-1 py-2 sm:hidden"
        estado={distintivo}
        clasificacion={relacion}
        titulo={conductor.nombre}
        detalle={
          fueraDeNomina
            ? conductor.rut
            : [conductor.rut, vehiculoCorto, resumenDelDia, textoZonas]
                .filter(Boolean)
                .join(" · ")
        }
      />

      <span className={`hidden flex-1 sm:grid ${COLUMNAS_ANCHO} sm:items-center`}>
        <span className="min-w-0 py-2.5 pr-3">
          <span className="block truncate text-sm font-medium text-fg">{conductor.nombre}</span>
          {/* La disponibilidad baja acá desde su antigua columna: es una
              propiedad de la persona, no una quinta magnitud del día, y en
              columna propia gastaba un ancho que ahora usa la ruta. */}
          <span className="mt-1 flex min-w-0 items-center gap-1.5">
            {distintivo}
            <span className="rx-num min-w-0 truncate text-xs text-fg-muted">
              {/* Sin enlace `tel:` acá: la fila entera ya es pulsable y abre el
                  cajón, y un enlace dentro de un control pulsable se roba el
                  toque. El número marcable está en el cajón. */}
              {conductor.telefono ? formatearTelefonoLegible(conductor.telefono) : conductor.rut}
            </span>
          </span>
        </span>
        <span className="py-2.5 pr-3">
          {fueraDeNomina ? (
            <span className="text-sm text-fg-subtle">—</span>
          ) : (
            <CeldaRutaDeHoy hoy={hoyDelDia} />
          )}
        </span>
        <span className="py-2.5 pr-3">
          {fueraDeNomina ? (
            <span className="text-sm text-fg-subtle">—</span>
          ) : (
            <CeldaRetirosDeHoy hoy={hoyDelDia} />
          )}
        </span>
        {/* 🔴 El vehículo va JUNTO al cupo, y no en columna propia.
            Son el mismo hecho contado dos veces: el cupo dice cuánto lleva y el
            vehículo dice por qué. Separados, el coordinador tiene que cruzarlos
            con la vista; juntos se leen de un tirón cuando reparte contra el
            reloj de las 16:00.

            Y «Sin declarar» se DICE, en vez de dejar el hueco en blanco: es la
            única forma de que el courier vea a quién le falta el dato. Un
            vehículo por omisión se vería idéntico a uno declarado de verdad. */}
        <span className="min-w-0 py-2.5 pr-3 text-sm">
          {fueraDeNomina ? (
            "—"
          ) : (
            <>
              {/* `block truncate` en las dos: sin él, un ancho apretado parte
                  «Sin declarar» en dos líneas y la fila entera crece de alto,
                  descuadrando la tabla. Cortar es preferible a empujar. */}
              <span
                className={`block truncate ${conductor.vehiculo ? "text-fg" : "text-fg-subtle"}`}
              >
                {conductor.vehiculo
                  ? TEXTO_VEHICULO_CONDUCTOR[conductor.vehiculo]
                  : "Sin declarar"}
              </span>
              <span className="rx-num block truncate text-xs text-fg-muted">
                {conductor.capacidadParadas} paradas
              </span>
            </>
          )}
        </span>
        <span className="min-w-0 truncate py-2.5 pr-3 text-sm text-fg-muted">
          {fueraDeNomina ? "—" : textoZonas}
        </span>
      </span>

      <span className="shrink-0 text-fg-subtle">
        <ChevronRight className="size-4" aria-hidden="true" />
      </span>
    </button>
  );
}

// =============================================================================
// El cajón
// =============================================================================

function CajonConductor({
  conductor,
  impedimentos,
  zonas,
  fechaHoy,
  puedeEditarBanco,
  puedeGestionarNomina,
  onCerrar,
  onActualizado,
}: {
  conductor: ConductorEnNomina | null;
  impedimentos: string[];
  zonas: Zona[];
  fechaHoy: string;
  puedeEditarBanco: boolean;
  puedeGestionarNomina: boolean;
  onCerrar: () => void;
  onActualizado: (c: Conductor) => void;
}) {
  if (!conductor) return null;
  const fueraDeNomina = conductor.estado === "inactivo";

  return (
    <Sheet open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <SheetContent side="right" className={`${ANCHO_CAJON} gap-0 overflow-y-auto p-0`}>
        <SheetHeader className="border-b border-line px-4 py-3">
          <SheetTitle className="text-base">{conductor.nombre}</SheetTitle>
          <p className="rx-num text-xs text-fg-muted">
            {conductor.rut} ·{" "}
            {TEXTO_RELACION_CONDUCTOR[conductor.tipoRelacion] ?? conductor.tipoRelacion}
          </p>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 py-4">
          {fueraDeNomina ? (
            <BloqueReincorporar
              conductor={conductor}
              puede={puedeGestionarNomina}
              onActualizado={onActualizado}
            />
          ) : (
            <>
              <DisponibilidadDelDia conductor={conductor} />
              {/* Va inmediatamente después de la disponibilidad porque ese
                  bloque termina diciendo «si no aparece, hay que llamarlo», y
                  hasta ahora no había con qué. */}
              <BloqueTelefono conductor={conductor} onActualizado={onActualizado} />
              {/* El vehículo va pegado al cupo, y ANTES: es el que lo explica
                  —«anda en moto, por eso lleva 20»—. En la tabla se muestran en
                  la misma celda por lo mismo. */}
              <SelectorVehiculo conductor={conductor} onActualizado={onActualizado} />
              <Estampador conductor={conductor} onActualizado={onActualizado} />
              <EditorZonasConductor conductor={conductor} zonasTenant={zonas} />
              {/* El bloque no se renderiza si no se puede tocar: el tablero pide
                  que para el coordinador NO EXISTA, no que se vea en gris. */}
              {puedeEditarBanco ? (
                <EditorDatosBancarios
                  conductor={conductor}
                  puedeEditar={puedeEditarBanco}
                  onActualizado={onActualizado}
                />
              ) : null}
              <ZonaDeConsecuencia
                conductor={conductor}
                fechaHoy={fechaHoy}
                impedimentos={impedimentos}
                puedeGestionarNomina={puedeGestionarNomina}
                onActualizado={onActualizado}
              />
            </>
          )}

          {/* ⚠️ **El rótulo nombra las TRES cosas que hay detrás, no una.**
              Decía «Historial de entregas y pagos», y detrás vive además el
              bloque «Acceso a la app» — que es el ÚNICO sitio desde donde se
              invita a un conductor a usar el teléfono.
              Con el rótulo viejo, quien buscaba invitar recorría el cajón
              entero, no encontraba nada y concluía que la función no existía;
              pasó de verdad el 2026-08-27. Una puerta rotulada con una sola de
              las cosas que hay detrás esconde las otras dos. */}
          <Link
            href={`/conductores/${conductor.id}`}
            className="flex items-center justify-between gap-2 border-t border-line pt-3 text-sm text-accent-text hover:underline"
          >
            <span className="min-w-0">Historial, pagos y acceso a la app</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * La disponibilidad del día — **de solo lectura desde acá**.
 * =============================================================================
 *
 * Acá había un interruptor. Se retiró por decisión del usuario (24-08-2026):
 * `disponible` pasa a ser **solo del conductor**, que se marca desde su app al
 * empezar el turno.
 *
 * El motivo es que el campo describía la creencia del coordinador y no un
 * hecho: la asistencia se definía por WhatsApp y alguien la transcribía acá.
 *
 * ⚠️ **La contrapartida está dicha en la pantalla, y no escondida en un
 * comentario**: si el conductor no se marca, el coordinador ya no puede meterlo
 * en la auto-asignación. Quitar un control sin explicar qué lo reemplazó es cómo
 * se generan las llamadas que este cambio viene a evitar — así que el hueco que
 * dejó el interruptor lo ocupa la explicación, no un espacio en blanco.
 */
/**
 * El teléfono, dentro del cajón.
 *
 * No lleva prop de permiso: **esta pantalla entera ya exige
 * `asignar_y_reasignar_pedidos`** (ver el guard de `page.tsx`), que es
 * exactamente el gate de la acción que escribe el teléfono. Pasar un booleano
 * calculado con la misma capacidad sería una segunda fuente de verdad para la
 * misma pregunta, y de esas se desincroniza una tarde o temprano.
 *
 * Es la diferencia con `EditorDatosBancarios`, que sí lo lleva: ese responde a
 * un gate DISTINTO del de la pantalla (el financiero), así que ahí el booleano
 * dice algo que el guard no dice.
 */
function BloqueTelefono({
  conductor,
  onActualizado,
}: {
  conductor: ConductorEnNomina;
  /** Recibe el conductor YA actualizado — la lista vive en estado del cliente. */
  onActualizado: (c: ConductorEnNomina) => void;
}) {
  return (
    <div>
      <span className="text-sm font-medium">Teléfono</span>
      <div className="mt-1">
        <EditorTelefonoConductor
          conductorId={conductor.id}
          telefono={conductor.telefono}
          puedeEditar
          idCampo={`telefono-nomina-${conductor.id}`}
          onGuardado={(telefonoNuevo) => onActualizado({ ...conductor, telefono: telefonoNuevo })}
        />
      </div>
    </div>
  );
}

function DisponibilidadDelDia({ conductor }: { conductor: ConductorEnNomina }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Disponible hoy</span>
        <DistintivoEstado
          tono={conductor.disponible ? "balanced" : "neutral"}
          etiqueta={conductor.disponible ? "Se marcó" : "No se ha marcado"}
        />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">
        {conductor.disponible
          ? "Lo marcó él desde su app. Se apaga solo a medianoche."
          : "Lo marca él desde su app, al empezar su turno. Mientras no lo haga no entra en la asignación automática, y desde acá no se puede marcar por él: si no aparece, hay que llamarlo."}
      </p>
    </div>
  );
}

/**
 * En qué anda: moto o auto.
 *
 * Encargo del usuario (26-08-2026). Es **informativo**: no entra en la
 * auto-asignación ni en los tiempos estimados; el coordinador reparte con el
 * dato a la vista y decide él. Ver la migración `20260826000005`.
 *
 * ⚠️ **«Sin declarar» es una opción de verdad, no un placeholder.** Se puede
 * volver a ella, y hace falta: si alguien marca «auto» por error, dejarlo
 * corregible solo a otro valor equivocado sería peor que el hueco. Un vehículo
 * inventado se ve idéntico a uno declarado de verdad, y por eso el estado «no lo
 * sabemos» tiene que ser alcanzable.
 *
 * Guarda al elegir, sin botón «Guardar», igual que el cupo de al lado: es un
 * campo de un solo gesto y confirmar aparte sobra.
 */
const SIN_DECLARAR = "__sin__";

function SelectorVehiculo({
  conductor,
  onActualizado,
}: {
  conductor: Conductor;
  onActualizado: (c: Conductor) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function elegir(valor: string) {
    const vehiculo: VehiculoConductor | null = esVehiculoConductor(valor) ? valor : null;
    if (vehiculo === conductor.vehiculo) return;
    // Optimista con vuelta atrás: si el servidor rechaza, la fila recupera lo
    // que tenía. Dejar el valor nuevo puesto mostraría un dato que no se guardó.
    onActualizado({ ...conductor, vehiculo });
    iniciar(async () => {
      setError(null);
      const r = await actionActualizarVehiculoConductor(conductor.id, vehiculo ?? "");
      if (!r.ok) {
        onActualizado({ ...conductor, vehiculo: conductor.vehiculo });
        setError(r.mensaje);
      }
    });
  }

  return (
    <div>
      <Label htmlFor={`vehiculo-${conductor.id}`} className="text-sm font-medium">
        Vehículo
      </Label>
      <Select
        value={conductor.vehiculo ?? SIN_DECLARAR}
        onValueChange={elegir}
        disabled={pendiente}
      >
        <SelectTrigger id={`vehiculo-${conductor.id}`} className="mt-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SIN_DECLARAR}>Sin declarar</SelectItem>
          <SelectItem value="moto">{TEXTO_VEHICULO_CONDUCTOR.moto}</SelectItem>
          <SelectItem value="auto">{TEXTO_VEHICULO_CONDUCTOR.auto}</SelectItem>
        </SelectContent>
      </Select>
      {error ? <p className="mt-1 text-xs text-fault-fg">{error}</p> : null}
    </div>
  );
}

/**
 * El cupo del turno, con `− N +`.
 *
 * Reemplaza un campo de texto con botón «Guardar». El cupo se ajusta de a uno
 * —«hoy este anda con la moto chica, bájale dos»— y escribir un número y
 * confirmar para mover de 30 a 28 es más trabajo del que el gesto merece.
 */
function Estampador({
  conductor,
  onActualizado,
}: {
  conductor: ConductorEnNomina;
  onActualizado: (c: Conductor) => void;
}) {
  const [valor, setValor] = useState(conductor.capacidadParadas);
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function ajustar(delta: number) {
    const nuevo = Math.max(1, valor + delta);
    if (nuevo === valor) return;
    setValor(nuevo);
    iniciar(async () => {
      setError(null);
      const r = await actionActualizarCapacidadConductor(conductor.id, nuevo);
      if (r.ok) onActualizado({ ...conductor, capacidadParadas: nuevo });
      else {
        setValor(conductor.capacidadParadas);
        setError(r.mensaje);
      }
    });
  }

  return (
    <div>
      <p className="text-sm font-medium">Capacidad del turno</p>
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={pendiente || valor <= 1}
          onClick={() => ajustar(-1)}
          aria-label="Bajar el cupo en una parada"
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <span className="rx-num min-w-12 text-center text-lg font-semibold">{valor}</span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={pendiente}
          onClick={() => ajustar(1)}
          aria-label="Subir el cupo en una parada"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        <span className="text-xs text-fg-muted">paradas</span>
      </div>
      {error ? <p className="mt-1 text-xs text-fault-fg">{error}</p> : null}
    </div>
  );
}

/*
 * ⚠️ ACÁ VIVÍA `BloqueHoy` — ruta y retiros del día — Y SE RETIRÓ (26-08-2026).
 *
 * No se perdió: subió a la tabla, como dos columnas propias. El cajón muestra a
 * UN conductor, y la pregunta de las 18:00 —«¿quién va colgado?»— es una
 * comparación entre los quince. Dentro de un cajón esa comparación exige abrir y
 * cerrar quince veces.
 *
 * Y de paso descarga el cajón, que era la otra mitad del encargo: acá quedan las
 * cosas que se TOCAN —teléfono, cupo, zonas, banco— y las de consecuencia. El
 * día se mira afuera. Ver `CeldaRutaDeHoy` y `CeldaRetirosDeHoy`.
 */

// =============================================================================
// La zona de consecuencia
// =============================================================================

function ZonaDeConsecuencia({
  conductor,
  fechaHoy,
  impedimentos,
  puedeGestionarNomina,
  onActualizado,
}: {
  conductor: ConductorEnNomina;
  fechaHoy: string;
  impedimentos: string[];
  puedeGestionarNomina: boolean;
  onActualizado: (c: Conductor) => void;
}) {
  const [dialogo, setDialogo] = useState(false);
  const bloqueada = impedimentos.length > 0;

  return (
    <div className="border border-fault-line p-3">
      <p className="text-[10px] font-medium tracking-[0.12em] text-fault-fg uppercase">
        Zona de consecuencia
      </p>

      <div className="mt-2 border-b border-line-subtle pb-3">
        <SeccionRedistribucion
          conductor={conductor}
          fechaHoy={fechaHoy}
          onActualizado={onActualizado}
        />
      </div>

      <div className="mt-3">
        <p className="text-sm font-medium">Sacar de la nómina</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
          Deja de aparecer para asignar y no vuelve solo. Sus entregas y
          liquidaciones se conservan.{" "}
          <strong className="font-medium text-fg">No le quita el acceso a la app</strong>: eso
          se maneja en Equipo.
        </p>
        {!puedeGestionarNomina ? (
          <p className="mt-2 text-xs text-fg-muted">
            Solo el dueño o administración pueden darlo de baja.
          </p>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 border-fault-line text-fault-fg hover:bg-fault-bg"
              disabled={bloqueada}
              onClick={() => setDialogo(true)}
            >
              Sacar de la nómina
            </Button>
            {/* Deshabilitado CON su motivo, nunca escondido: una acción que
                desaparece no enseña por qué no se puede. */}
            {bloqueada ? (
              <ul className="mt-2 space-y-1 text-xs text-attention-fg">
                {impedimentos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <DialogSacarDeNomina
        conductor={conductor}
        abierto={dialogo}
        onCerrar={() => setDialogo(false)}
        onActualizado={onActualizado}
      />
    </div>
  );
}

/** Peldaño 2 de la escalera: la consecuencia dicha, y el motivo escrito. */
function DialogSacarDeNomina({
  conductor,
  abierto,
  onCerrar,
  onActualizado,
}: {
  conductor: ConductorEnNomina;
  abierto: boolean;
  onCerrar: () => void;
  onActualizado: (c: Conductor) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      setError(null);
      const r = await actionSacarDeNomina(conductor.id, motivo);
      if (r.ok) {
        onActualizado(r.datos);
        setMotivo("");
        onCerrar();
      } else {
        setError(r.mensaje);
      }
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sacar a {conductor.nombre} de la nómina</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-fg-muted">
          Deja de aparecer para asignar rutas y queda marcado fuera de la nómina. Puedes
          reincorporarlo después desde el cajón «Fuera de nómina».
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="motivo-baja">Motivo</Label>
          <Textarea
            id="motivo-baja"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Renunció el 20-08, se va a otra empresa."
            rows={3}
          />
          <p className="text-xs text-fg-muted">
            Queda en la bitácora con tu nombre. Lo va a leer quien revise esta baja dentro de
            seis meses.
          </p>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar} disabled={pendiente}>
            Volver
          </Button>
          <Button
            variant="destructive"
            onClick={confirmar}
            disabled={pendiente || motivo.trim().length < 3}
          >
            {pendiente ? "Sacando…" : "Sacar de la nómina"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BloqueReincorporar({
  conductor,
  puede,
  onActualizado,
}: {
  conductor: ConductorEnNomina;
  puede: boolean;
  onActualizado: (c: Conductor) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="border border-line p-3">
      <p className="text-sm font-medium">Fuera de la nómina</p>
      <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
        No aparece para asignar rutas. Al reincorporarlo vuelve{" "}
        <strong className="font-medium text-fg">no disponible</strong>: volver a la nómina no
        es salir a repartir hoy.
      </p>
      {puede ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              setError(null);
              const r = await actionReincorporarANomina(conductor.id);
              if (r.ok) onActualizado(r.datos);
              else setError(r.mensaje);
            })
          }
        >
          {pendiente ? "Reincorporando…" : "Reincorporar a la nómina"}
        </Button>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">
          Solo el dueño o administración pueden reincorporarlo.
        </p>
      )}
      {error ? <p className="mt-1 text-xs text-fault-fg">{error}</p> : null}
    </div>
  );
}
