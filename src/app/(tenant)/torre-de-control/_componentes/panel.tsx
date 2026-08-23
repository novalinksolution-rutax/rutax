'use client';

/**
 * El panel lateral de la Torre — dos pestañas, 340 px fijos.
 * =============================================================================
 *
 * **Eran tres.** `Incidencias` salió del panel el 23-08-2026: su cifra ya vive
 * arriba, con su segunda línea («3 · 1 sin gestionar»), y la bandeja donde se
 * gestionan es una pantalla propia. Tenerla acá repetía la cifra y ofrecía media
 * gestión en una pantalla que declara ser de solo lectura.
 *
 * **El nivel elige qué pestaña abre; la elección del usuario manda.** El nivel 2
 * sugiere conductores y el 3 comunas, pero eso es un valor por defecto: las dos
 * están siempre a un clic, y una vez que el usuario elige una, cambiar de nivel
 * **no** se la pisa. La pantalla sugiere dónde mirar; no decide por él.
 *
 * Todo lo de acá **enlaza y no ejecuta** (regla 6). Cada fila lleva a la
 * pantalla donde se resuelve, con el filtro ya aplicado — que es la contrapartida
 * de que la Torre sea de solo lectura: si obligara a buscar de nuevo del otro
 * lado, no serviría.
 */

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ComunaEnTorre, ConductorEnTorre } from '@/modules/contexto/contrato-torre';

export type PestanaPanel = 'conductores' | 'comunas';

/** `Ricardo Muñoz Soto` → `RM`. Ancla visual estable cuando la lista se reordena. */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '··';
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase();
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

export function PanelTorre({
  pestana,
  onPestana,
  conductores,
  comunas,
  diaCerrado,
  comunaActiva,
  onComuna,
  comunaPorConductor,
  conductoresPorComuna,
  fichaComuna,
}: {
  pestana: PestanaPanel;
  onPestana: (p: PestanaPanel) => void;
  conductores: readonly ConductorEnTorre[];
  comunas: readonly ComunaEnTorre[];
  diaCerrado: boolean;
  comunaActiva: string | null;
  onComuna: (nombre: string) => void;
  /** Dónde le queda carga a cada conductor. Derivado de los puntos del mapa. */
  comunaPorConductor: Record<string, string>;
  /** Cuántos conductores tienen carga en cada comuna. Para la ficha. */
  conductoresPorComuna: Record<string, number>;
  /** La comuna marcada, si hay alguna. `null` = sin ficha al pie. */
  fichaComuna: ComunaEnTorre | null;
}) {
  return (
    <Tabs
      value={pestana}
      onValueChange={(v) => onPestana(v as PestanaPanel)}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <TabsList className="m-3 grid grid-cols-2">
        {/* La cuenta va EN el rótulo, no en un punto al lado: la pestaña que no
            está abierta tiene que poder decir cuánto hay del otro lado. */}
        <TabsTrigger value="conductores">
          Conductores
          <span className="ml-1.5 tabular-nums text-muted-foreground">
            {conductores.filter((c) => c.conRuta).length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="comunas">
          Comunas
          <span className="ml-1.5 tabular-nums text-muted-foreground">{comunas.length}</span>
        </TabsTrigger>
      </TabsList>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TabsContent value="conductores" className="mt-0">
          {conductores.length === 0 ? (
            <div className="px-4 py-6">
              <p className="text-sm text-muted-foreground">
                Nadie tiene paradas asignadas hoy.
              </p>
              {/* El vacío con su salida: la Torre no ejecuta, pero sí lleva a
                  donde se resuelve. Un vacío mudo obliga a saber de memoria
                  dónde se asigna. */}
              <Link
                href="/preparacion/asignar"
                className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Ir a asignar
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {conductores.map((conductor) => {
                const avance =
                  conductor.asignados > 0
                    ? Math.round((conductor.completados / conductor.asignados) * 100)
                    : 0;
                const comuna = comunaPorConductor[conductor.id];
                return (
                  <li key={conductor.id}>
                    <Link
                      href={`/operaciones?conductor=${encodeURIComponent(conductor.id)}`}
                      className={cn(
                        'group flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden',
                        // Apagado, no escondido: el conductor sin ruta es a
                        // quien todavía se le puede asignar.
                        !conductor.conRuta && 'opacity-60',
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        {/* Las iniciales dan un ancla visual estable cuando la
                            lista se reordena sola por avance. */}
                        <span
                          className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                          aria-hidden="true"
                        >
                          {iniciales(conductor.nombre)}
                        </span>
                        <span className="truncate text-sm font-medium">{conductor.nombre}</span>
                        <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">
                          {/* Antes del cierre: avance, sin juzgar. Después:
                              cuántos PAQUETES quedaron — no «conductor
                              rezagado», que era el sujeto equivocado, porque un
                              paquete de hoy lo puede entregar mañana otro. */}
                          {!conductor.conRuta
                            ? 'sin ruta'
                            : diaCerrado && conductor.rezagados !== null
                              ? `${conductor.rezagados} sin entregar`
                              : `${conductor.completados} de ${conductor.asignados}`}
                        </span>
                      </span>

                      {conductor.conRuta ? (
                        <>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                              aria-hidden="true"
                            >
                              <span
                                className="block h-full rounded-full bg-primary transition-[width]"
                                style={{ width: `${avance}%` }}
                              />
                            </span>
                            {/* El porcentaje escrito: la barra sola no se puede
                                comparar entre dos conductores de un vistazo. */}
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {avance}%
                            </span>
                          </span>
                          {comuna ? (
                            <span className="truncate text-xs text-muted-foreground">
                              Le queda carga en {comuna}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Disponible hoy y sin paradas asignadas.
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="comunas" className="mt-0">
          {comunas.length === 0 ? (
            <Vacio>No hay pedidos con compromiso para hoy.</Vacio>
          ) : (
            <ul className="divide-y divide-border">
              {comunas.map((comuna) => (
                <li key={comuna.nombre}>
                  <button
                    type="button"
                    onClick={() => onComuna(comuna.nombre)}
                    className={cn(
                      'flex w-full items-baseline gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden',
                      comuna.nombre === comunaActiva && 'bg-muted',
                    )}
                  >
                    <span className="truncate text-sm">{comuna.nombre}</span>
                    {comuna.incidenciasAbiertas > 0 ? (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-destructive"
                        aria-label={`${comuna.incidenciasAbiertas} con incidencia`}
                      />
                    ) : null}
                    <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">
                      faltan {comuna.pendientes}
                      <span className="text-xs"> de {comuna.total}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </div>

      {/* --- Ficha del seleccionado ------------------------------------------
          Al pie y no flotando: es el detalle de lo que está marcado en el mapa,
          y tiene que poder leerse sin tapar el mapa que lo produjo. */}
      {fichaComuna ? (
        <FichaComuna
          comuna={fichaComuna}
          conductores={conductoresPorComuna[fichaComuna.nombre] ?? 0}
        />
      ) : null}

      {/* --- La discrepancia, dicha ------------------------------------------
          Hasta hoy esto solo vivía en comentarios de código. Es una consecuencia
          ASUMIDA del diseño —la Torre cuenta lo que el conductor cerró en la
          app, y en Flex el estado oficial llega después por Mercado Envíos—,
          pero quien nota el descuadre sin esta línea lo lee como que una de las
          dos pantallas miente. */}
      <p className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
        Esta pantalla cuenta lo que el conductor cerró en la app. En los pedidos
        de Flex el estado oficial lo confirma Mercado Envíos y llega después, así
        que la Torre puede ir por delante de lo que muestra Pedidos.
      </p>
    </Tabs>
  );
}

/**
 * El detalle de la comuna marcada.
 *
 * Las cuatro cifras que el coordinador necesita para decidir si esa comuna es un
 * problema, y **una salida**: el listado de pedidos ya filtrado. Sin la salida,
 * la ficha obligaría a buscar la comuna otra vez del otro lado — que es
 * exactamente lo que la Torre existe para evitar.
 */
function FichaComuna({
  comuna,
  conductores,
}: {
  comuna: ComunaEnTorre;
  conductores: number;
}) {
  return (
    <div className="border-t border-border bg-muted/30 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Ficha · {comuna.nombre}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Dato rotulo="Por entregar">
          {comuna.pendientes}
          <span className="text-xs text-muted-foreground"> de {comuna.total}</span>
        </Dato>
        <Dato rotulo="Entregados">{comuna.entregados}</Dato>
        <Dato rotulo="Conductores acá">{conductores}</Dato>
        <Dato rotulo="Incidencias">
          <span className={comuna.incidenciasAbiertas > 0 ? 'text-destructive' : undefined}>
            {comuna.incidenciasAbiertas}
          </span>
        </Dato>
      </dl>
      <Link
        href={`/operaciones?comuna=${encodeURIComponent(comuna.nombre)}`}
        className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        {comuna.pendientes === 1
          ? 'Ver el pendiente en Pedidos'
          : `Ver los ${comuna.pendientes} en Pedidos`}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
