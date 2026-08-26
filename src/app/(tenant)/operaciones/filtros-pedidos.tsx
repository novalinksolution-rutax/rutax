"use client";

/**
 * Filtros de refinamiento de la lista de pedidos — Client Component.
 * Se envían como searchParams en la URL (GET navigation).
 *
 * ⚠️ **El estado NO se filtra aquí.** Lo hace la barra de grupos de la página,
 * que además muestra la cifra de cada cajón. Mientras existieron los dos, la
 * pantalla tenía dos controles para lo mismo y podían contradecirse. Aquí queda
 * solo el refinamiento, ordenado por frecuencia de uso: la fecha va primero
 * porque es el único que SIEMPRE está puesto (cae a hoy por defecto).
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { FUENTES_PEDIDO } from "@/modules/operacion/tipos";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { etiquetaSellerConEstado } from "@/lib/ui/traduccion-estados";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import type { FuentePedido } from "@/modules/operacion/tipos";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipsFiltro, type ChipFiltro } from "@/components/filtros/chips-filtro";
import { Checkbox } from "@/components/ui/checkbox";
import { HojaInferior } from "@/components/ui/hoja-inferior";
import { FiltroFecha } from "@/components/filtros/filtro-fecha";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinela para "sin filtro": Radix Select no admite items con value="". */
const TODOS = "__todos__";

/**
 * ⚠️ **Con el dedo, los filtros se van a una hoja.**
 *
 * Son seis controles en fila. En un teléfono ocupan media pantalla **antes** de
 * que se vea el primer pedido, y son refinamiento ocasional: el coordinador los
 * toca una vez y después trabaja media hora sobre la lista. Dejarlos ahí es
 * cobrarle esa media pantalla todo el rato por algo que usó una vez.
 *
 * En la hoja van completos, con el mismo formulario —no una versión recortada— y
 * el botón de arriba lleva **el contador de cuántos hay puestos**, que es lo que
 * evita el peor caso: buscar un pedido que sí existe, no encontrarlo, y no
 * entender que hay un filtro escondido tapándolo.
 */
interface Props {
  sellers: { id: string; nombre: string; estado: string }[];
  conductores: { id: string; nombre: string }[];
  filtroSeller: string;
  /**
   * Grupo o estado vigente. NO se edita aquí —la barra de la página es su
   * control— pero se recibe para PRESERVARLO al tocar cualquier otro filtro.
   */
  filtroEstado: string;
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  /** Día exacto de fecha comprometida ("" si hay rango). */
  filtroFecha: string;
  /** Rango de fecha comprometida ("" si hay día exacto). */
  filtroFechaDesde: string;
  filtroFechaHasta: string;
  filtroComuna: string;
  filtroConductor: string;
  filtroFuente: string;
  /** Solo los pedidos que ya están en un manifiesto. Binario: puesto o no. */
  filtroEnManifiesto: boolean;
  hayFiltroActivo: boolean;
}

/** Cuántos filtros hay puestos. La fecha no cuenta: siempre está. */
function contarFiltros(p: Props): number {
  return [p.filtroSeller, p.filtroComuna, p.filtroConductor, p.filtroFuente, p.filtroEnManifiesto]
    .filter(Boolean).length;
}

/**
 * Los filtros, en fila con el puntero y en hoja con el dedo.
 *
 * El formulario es **el mismo objeto** en los dos casos: una versión recortada
 * para móvil sería un segundo formulario que mantener, y el que se queda atrás
 * siempre es el que se usa menos.
 */
export function FiltrosPedidos(props: Props) {
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const puestos = contarFiltros(props);

  return (
    <>
      {/* Con puntero: la fila de siempre. */}
      <div className="pointer-coarse:hidden">
        <FiltrosPedidosForm {...props} />
      </div>

      {/* Con dedo: un botón con su contador, y la hoja. */}
      <div className="hidden pointer-coarse:block">
        <Button
          type="button"
          variant="outline"
          onClick={() => setHojaAbierta(true)}
          className="w-full justify-between"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filtros
          </span>
          {puestos > 0 ? (
            <span className="rx-num border border-brand bg-accent-deep px-1.5 py-px font-mono text-[11px]">
              {puestos}
            </span>
          ) : null}
        </Button>
      </div>

      <HojaInferior
        abierta={hojaAbierta}
        onOpenChange={setHojaAbierta}
        titulo="Filtros"
        descripcion={
          puestos === 0
            ? "Ninguno puesto: se ven todos los pedidos de la fecha."
            : `${puestos} ${puestos === 1 ? "puesto" : "puestos"}`
        }
        pie={
          <Button type="button" className="w-full" onClick={() => setHojaAbierta(false)}>
            Ver los pedidos
          </Button>
        }
      >
        {/* En vertical, no en fila: en 390 px una fila de seis controles deja
            cada uno en 60 px. */}
        <div className="[&>div]:flex-col [&>div]:items-stretch">
          <FiltrosPedidosForm {...props} />
        </div>
      </HojaInferior>
    </>
  );
}


/**
 * Un `Select` de filtro con su rótulo, para vivir dentro de un chip.
 *
 * ⚠️ Vive **fuera** del componente que lo usa. Definido adentro, su identidad
 * cambia en cada render y React lo desmonta y lo vuelve a montar entero: el
 * desplegable se cerraría solo al escribir en él.
 */
function ControlSelect({
  id,
  rotulo,
  campo,
  valor,
  placeholder,
  opciones,
  onCambiar,
}: {
  id: string;
  rotulo: string;
  campo: string;
  valor: string;
  placeholder: string;
  opciones: { valor: string; etiqueta: string }[];
  onCambiar: (campo: string, valor: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      <Select value={valor || TODOS} onValueChange={(v) => onCambiar(campo, v === TODOS ? "" : v)}>
        <SelectTrigger id={id} size="default" className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>{placeholder}</SelectItem>
          {opciones.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.etiqueta}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FiltrosPedidosForm({
  sellers,
  conductores,
  filtroSeller,
  filtroEstado,
  hoy,
  filtroFecha,
  filtroFechaDesde,
  filtroFechaHasta,
  filtroComuna,
  filtroConductor,
  filtroFuente,
  filtroEnManifiesto,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "seller" && filtroSeller) params.set("seller", filtroSeller);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      // El filtro de fecha se cambia por su propio control (FiltroFecha, que
      // clona la URL); aquí solo se PRESERVA la selección vigente —día exacto o
      // rango— para que tocar otro filtro no la borre.
      if (filtroFecha) {
        params.set("fecha", filtroFecha);
      } else {
        if (filtroFechaDesde) params.set("fecha_desde", filtroFechaDesde);
        if (filtroFechaHasta) params.set("fecha_hasta", filtroFechaHasta);
      }
      // Comuna y conductor sobreviven al cambio de cualquier otro filtro: se
      // llega desde la Torre con uno puesto y afinar por estado no puede
      // devolver al usuario a la ciudad entera.
      if (campo !== "comuna" && filtroComuna) params.set("comuna", filtroComuna);
      if (campo !== "conductor" && filtroConductor) params.set("conductor", filtroConductor);
      // Fuente sobrevive igual que comuna/conductor: es un corte del mismo
      // universo (con tres fuentes conviviendo en la bandeja, filtrar por
      // estado no puede devolver a "todas las fuentes").
      if (campo !== "fuente" && filtroFuente) params.set("fuente", filtroFuente);
      if (campo !== "en_manifiesto" && filtroEnManifiesto) params.set("en_manifiesto", "1");
      if (valor) params.set(campo, valor);
      // Resetear a página 1 al cambiar filtros
      router.push(`${pathname}?${params.toString()}`);
    },
    [
      router,
      pathname,
      filtroSeller,
      filtroEstado,
      filtroFecha,
      filtroFechaDesde,
      filtroFechaHasta,
      filtroComuna,
      filtroConductor,
      filtroFuente,
      filtroEnManifiesto,
    ],
  );

  const nombreSeller = sellers.find((x) => x.id === filtroSeller)?.nombre ?? null;
  const nombreConductor = conductores.find((c) => c.id === filtroConductor)?.nombre ?? null;

  /**
   * La fecha **siempre está puesta** —cae a hoy cuando la URL no trae nada— así
   * que su chip va sin ×: no hay «sin fecha» al que volver. Se muestra «Hoy»
   * cuando coincide, porque es lo que el coordinador tiene en la cabeza.
   */
  const etiquetaFecha =
    filtroFecha === hoy
      ? "Hoy"
      : filtroFecha
        ? formatearFechaCivilCorta(filtroFecha)
        : filtroFechaDesde || filtroFechaHasta
          ? `${filtroFechaDesde ? formatearFechaCivilCorta(filtroFechaDesde) : "…"} a ${filtroFechaHasta ? formatearFechaCivilCorta(filtroFechaHasta) : "…"}`
          : "Hoy";

  const chips: ChipFiltro[] = [
    {
      clave: "fecha",
      etiqueta: "Fecha",
      valor: etiquetaFecha,
      control: (
        <FiltroFecha
          id="filtro-fecha"
          label="Fecha comprometida"
          hoy={hoy}
          exacto={filtroFecha}
          desde={filtroFechaDesde}
          hasta={filtroFechaHasta}
        />
      ),
    },
    {
      clave: "seller",
      etiqueta: "Seller",
      valor: nombreSeller,
      onQuitar: () => actualizar("seller", ""),
      control: (
        <ControlSelect
          id="filtro-seller"
          rotulo="Seller"
          campo="seller"
          valor={filtroSeller}
          placeholder="Todos los sellers"
          opciones={sellers.map((x) => ({ valor: x.id, etiqueta: etiquetaSellerConEstado(x.nombre, x.estado) }))}
          onCambiar={actualizar}
        />
      ),
    },
    {
      clave: "comuna",
      etiqueta: "Comuna",
      valor: filtroComuna || null,
      onQuitar: () => actualizar("comuna", ""),
      control: (
        <ControlSelect
          id="filtro-comuna"
          rotulo="Comuna"
          campo="comuna"
          valor={filtroComuna}
          placeholder="Todas las comunas"
          opciones={COMUNAS_RM.map((c) => ({ valor: c, etiqueta: c }))}
          onCambiar={actualizar}
        />
      ),
    },
    {
      clave: "conductor",
      etiqueta: "Conductor",
      valor: nombreConductor,
      onQuitar: () => actualizar("conductor", ""),
      control: (
        <ControlSelect
          id="filtro-conductor"
          rotulo="Conductor"
          campo="conductor"
          valor={filtroConductor}
          placeholder="Todos los conductores"
          opciones={conductores.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
          onCambiar={actualizar}
        />
      ),
    },
    {
      clave: "fuente",
      // «Procedencia» y no «Fuente»: es la palabra del tablero, y la que
      // entiende alguien que no vive en el modelo de datos.
      etiqueta: "Procedencia",
      valor: filtroFuente ? etiquetaFuentePedido(filtroFuente as FuentePedido) : null,
      onQuitar: () => actualizar("fuente", ""),
      control: (
        <ControlSelect
          id="filtro-fuente"
          rotulo="Procedencia"
          campo="fuente"
          valor={filtroFuente}
          placeholder="Todas las fuentes"
          opciones={FUENTES_PEDIDO.map((f) => ({
            valor: f,
            etiqueta: etiquetaFuentePedido(f as FuentePedido),
          }))}
          onCambiar={actualizar}
        />
      ),
    },
    {
      clave: "en_manifiesto",
      etiqueta: "En manifiesto",
      // Binario: o está puesto, o el chip está disponible. No hay un «no» que
      // valga la pena mostrar —«los que NO están en un manifiesto» es otra
      // pregunta— así que el valor solo existe cuando el filtro está activo.
      valor: filtroEnManifiesto ? "Sí" : null,
      onQuitar: () => actualizar("en_manifiesto", ""),
      control: (
        <label
          htmlFor="filtro-en-manifiesto"
          className="flex cursor-pointer items-start gap-2.5"
        >
          <Checkbox
            id="filtro-en-manifiesto"
            checked={filtroEnManifiesto}
            onCheckedChange={(marcado) => actualizar("en_manifiesto", marcado ? "1" : "")}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Solo los que están en un manifiesto</span>
            {/* Sin esta línea el filtro se lee como «los asignados», y no es lo
                mismo: lo que responde es si el pedido ya entró al flujo de
                entrega de Rutax, con conductor y ruta. */}
            <span className="mt-0.5 block text-xs leading-snug text-fg-muted">
              Los que ya entraron al flujo de entrega: tienen conductor y ruta
              asignados. Deja fuera los que todavía están sin asignar.
            </span>
          </span>
        </label>
      ),
    },
  ];

  return (
    <ChipsFiltro
      chips={chips}
      onLimpiarTodo={hayFiltroActivo ? () => router.push(pathname) : undefined}
    />
  );
}
