"use client";

/**
 * El listado de zonas — con la misma anatomía que Tarifas.
 *
 * Las dos son secciones del MISMO módulo, una al lado de la otra en pestañas.
 * Si una es una tabla con su barra de cajones y la otra una lista de nombres,
 * pasar de una a otra se siente como cambiar de producto.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { BarraCajones } from "@/components/ui/barra-cajones";
import { Button } from "@/components/ui/button";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { actionToggleZona } from "./actions";
import type { EstadoZonas, ZonaEnriquecida } from "./actions";
import { PanelZona } from "./panel-zona";

interface Props {
  estadoInicial: EstadoZonas;
}

export function PanelZonas({ estadoInicial }: Props) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      {/* ⚠️ **Se recarga del servidor en vez de reconciliar en memoria.**
          Crear una zona toca DOS cosas —la zona y sus comunas—, así que
          mantener una copia local exigiría reconstruir también la cobertura de
          todas las demás, que es de donde sale el «6 sin zona». Un
          `router.refresh()` deja los dos datos ciertos con una consulta. */}
      <SeccionZonas
        zonas={estadoInicial.zonas}
        comunasSinZona={estadoInicial.comunasSinZona}
        onCambio={() => router.refresh()}
      />

      {/* 🔴 Acá vivía la ventana de corte, y se fue a la ficha del seller.
          B3b: «la ventana de corte no es un destino de configuración: es un
          campo del seller, porque cada seller tiene el plazo que su courier le
          prometió». Estaba detrás de un acordeón y un selector de seller, o sea
          que para cambiarle la hora a Vega Norte había que entrar a una
          pantalla llamada «Zonas» y volver a elegir el seller que uno ya estaba
          mirando. Ver `sellers/[sellerId]/ventanas-corte-seller.tsx`. */}
    </div>
  );
}

// =============================================================================
// El listado
// =============================================================================

/**
 * -----------------------------------------------------------------------------
 * 🔴 LAS DOS COLUMNAS QUE ANTES NO ESTABAN
 * -----------------------------------------------------------------------------
 * El listado era el nombre y un botón de desactivar. Las dos preguntas que uno
 * se hace ahí obligaban a abrir cada zona una por una:
 *
 * · **Comunas** responde «¿qué agrupa?» de un vistazo, y delata la zona vacía:
 *   una zona sin comunas no hace nada, y hasta ahora se veía igual que una
 *   llena.
 * · **Tarifas que la usan** responde «¿desactivarla rompe algo?». Desactivar
 *   una zona que usan tres tarifas es una decisión de dinero, y la pantalla la
 *   ofrecía como un clic sin consecuencia visible.
 *
 * -----------------------------------------------------------------------------
 * EL CAJÓN VIVE EN ESTADO LOCAL, AL REVÉS QUE EN TARIFAS
 * -----------------------------------------------------------------------------
 * ⚠️ Y es a propósito. El módulo ya usa `?seccion=` para la pestaña y `?cajon=`
 * para el cajón de Tarifas: un segundo cajón en la URL **compartiría ese
 * parámetro**, así que elegir «Inactivas» acá y volver a Tarifas dejaría puesto
 * un filtro que nadie pidió. Con tres zonas típicas, un filtro compartible no
 * vale ese riesgo.
 */
function SeccionZonas({
  zonas,
  comunasSinZona,
  onCambio,
}: {
  zonas: ZonaEnriquecida[];
  comunasSinZona: number;
  onCambio: () => void;
}) {
  /**
   * 🔴 Una sola pantalla, no dos.
   *
   * Crear la zona era un formulario de un campo arriba, y asignarle comunas un
   * acordeón aparte con SU PROPIO selector de zona: creabas «Norte», bajabas, y
   * volvías a elegir «Norte» en un desplegable. Una zona sin comunas no hace
   * nada, así que las dos mitades eran la misma tarea partida en dos.
   */
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [editando, setEditando] = useState<ZonaEnriquecida | null>(null);
  const [cajon, setCajon] = useState<"activa" | "inactiva" | null>(null);

  const conteo = useMemo(
    () => ({
      activa: zonas.filter((z) => z.activa).length,
      inactiva: zonas.filter((z) => !z.activa).length,
    }),
    [zonas],
  );

  const visibles = cajon
    ? zonas.filter((z) => (cajon === "activa" ? z.activa : !z.activa))
    : zonas;

  return (
    <div className="space-y-4">
      {zonas.length === 0 ? (
        <p className="border border-line bg-bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
          Todavía no tienes zonas. Sin ellas, todas las comunas usan la misma tarifa.
        </p>
      ) : (
        <>
          {/* La barra y la acción en la misma fila, como en Tarifas: el botón de
              crear pertenece al listado, no a la cabecera del módulo — que la
              comparten las tres secciones. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BarraCajones
              cajones={[
                { clave: "activa", etiqueta: "Activas", conteo: conteo.activa },
                { clave: "inactiva", etiqueta: "Inactivas", conteo: conteo.inactiva },
              ]}
              activo={cajon}
              total={zonas.length}
              onSeleccionar={(c) => setCajon(c as "activa" | "inactiva" | null)}
            />
            <Button size="sm" className="shrink-0" onClick={() => setNuevaAbierta(true)}>
              Nueva zona
            </Button>
          </div>

          {/* 🔴 Una comuna sin zona NO falla: cae en la tarifa por defecto y se
              cobra igual, en silencio. Por eso se dice acá — es lo único que
              avisa de que se está cobrando sin distinguir dónde. */}
          {comunasSinZona > 0 ? (
            <p className="border border-attention-line bg-attention-bg px-4 py-2.5 text-sm leading-relaxed text-attention-fg">
              {comunasSinZona} {comunasSinZona === 1 ? "comuna" : "comunas"} de la RM sin zona: esas
              entregas se cobran con la tarifa por defecto, sin distinguir dónde van.
            </p>
          ) : null}

          {visibles.length === 0 ? (
            <p className="border border-line bg-bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
              No tienes zonas en «{cajon === "activa" ? "activas" : "inactivas"}».
            </p>
          ) : (
            <div className="overflow-x-auto border border-line bg-bg-raised">
              <Table densidad="comfortable" aria-label="Zonas de cobertura">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="px-4">Zona</TableHead>
                    <TableHead className="px-4">Comunas</TableHead>
                    <TableHead className="px-4 text-right">Tarifas que la usan</TableHead>
                    <TableHead className="px-4">Estado</TableHead>
                    <TableHead className="px-4 text-right">
                      <span className="sr-only">Acciones</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((zona) => (
                    <FilaZona
                      key={zona.id}
                      zona={zona}
                      onEditar={() => setEditando(zona)}
                      onCambio={onCambio}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <PanelZona
        zonas={zonas}
        abierto={nuevaAbierta}
        onOpenChange={setNuevaAbierta}
        onGuardada={onCambio}
      />
      {/* `key` por zona: sin esto, abrir la segunda mostraría los campos de la
          primera — el panel conserva su estado entre aperturas. */}
      {editando && (
        <PanelZona
          key={editando.id}
          zona={editando}
          zonas={zonas}
          abierto
          onOpenChange={(a: boolean) => {
            if (!a) setEditando(null);
          }}
          onGuardada={onCambio}
        />
      )}
    </div>
  );
}

function FilaZona({
  zona,
  onEditar,
  onCambio,
}: {
  zona: ZonaEnriquecida;
  onEditar: () => void;
  onCambio: () => void;
}) {
  const [pendiente, iniciarTransicion] = useTransition();

  return (
    <TableRow onClick={onEditar} className={cn("cursor-pointer", !zona.activa && "rx-inert-row")}>
      <TableCell className="px-4 font-medium text-fg">{zona.nombre}</TableCell>

      <TableCell className="px-4">
        {zona.comunas.length === 0 ? (
          // 🔴 Una zona sin comunas no agrupa nada: existe y no hace nada.
          <span className="text-sm text-attention-fg">Sin comunas todavía</span>
        ) : (
          <>
            <span className="rx-num block text-sm text-fg">
              {zona.comunas.length} {zona.comunas.length === 1 ? "comuna" : "comunas"}
            </span>
            {/* Las primeras, para reconocerla sin abrirla. La lista completa
                está en el panel. */}
            <span className="block max-w-64 truncate text-xs text-fg-muted">
              {zona.comunas.slice(0, 3).join(", ")}
              {zona.comunas.length > 3 ? ` y ${zona.comunas.length - 3} más` : ""}
            </span>
          </>
        )}
      </TableCell>

      <TableCell className="rx-num px-4 text-right text-sm">
        {zona.tarifasQueLaUsan > 0 ? (
          zona.tarifasQueLaUsan
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>

      <TableCell className="px-4">
        <DistintivoEstado
          tono={zona.activa ? "balanced" : "inert"}
          etiqueta={zona.activa ? "Activa" : "Inactiva"}
        />
      </TableCell>

      {/* Para la propagación: el botón no debe abrir además el panel. */}
      <TableCell className="px-4 text-right" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          disabled={pendiente}
          onClick={() =>
            iniciarTransicion(async () => {
              const r = await actionToggleZona(zona.id, !zona.activa);
              if (r.ok) onCambio();
            })
          }
        >
          {pendiente ? "…" : zona.activa ? "Desactivar" : "Reactivar"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
