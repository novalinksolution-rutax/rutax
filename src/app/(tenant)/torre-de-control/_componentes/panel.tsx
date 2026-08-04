'use client';

/**
 * El panel lateral de la Torre — tres pestañas, 340 px fijos.
 * =============================================================================
 *
 * **El nivel elige qué pestaña abre; la elección del usuario manda.** El nivel 1
 * sugiere incidencias, el 2 conductores y el 3 comunas, pero eso es un valor por
 * defecto y no el único contenido disponible: las tres están siempre a un clic, y
 * una vez que el usuario elige una, cambiar de nivel **no** se la pisa. La
 * pantalla sugiere dónde mirar; no decide por él.
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
import type {
  ComunaEnTorre,
  ConductorEnTorre,
  IncidenciaEnTorre,
} from '@/modules/contexto/contrato-torre';

export type PestanaPanel = 'incidencias' | 'conductores' | 'comunas';

/**
 * Cuánto hace, en palabras cortas.
 *
 * `ahoraIso` viene del SERVIDOR y no de `Date.now()`: calcularlo en el cliente
 * daría un texto distinto al del HTML servido y React marcaría desajuste de
 * hidratación en cada carga.
 */
function hace(desdeIso: string, ahoraIso: string): string {
  const minutos = Math.max(0, Math.floor((Date.parse(ahoraIso) - Date.parse(desdeIso)) / 60_000));
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 24 ? `hace ${horas} h` : `hace ${Math.floor(horas / 24)} d`;
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

export function PanelTorre({
  pestana,
  onPestana,
  incidencias,
  conductores,
  comunas,
  ahora,
  diaCerrado,
  comunaActiva,
  onComuna,
}: {
  pestana: PestanaPanel;
  onPestana: (p: PestanaPanel) => void;
  incidencias: readonly IncidenciaEnTorre[];
  conductores: readonly ConductorEnTorre[];
  comunas: readonly ComunaEnTorre[];
  ahora: string;
  diaCerrado: boolean;
  comunaActiva: string | null;
  onComuna: (nombre: string) => void;
}) {
  return (
    <Tabs
      value={pestana}
      onValueChange={(v) => onPestana(v as PestanaPanel)}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <TabsList className="m-3 grid grid-cols-3">
        <TabsTrigger value="incidencias">
          Incidencias
          {incidencias.length > 0 ? (
            // El rojo de la pestaña es el mismo rojo reservado: acá cuenta lo
            // único accionable de la pantalla.
            <span className="ml-1.5 tabular-nums text-destructive">{incidencias.length}</span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="conductores">Conductores</TabsTrigger>
        <TabsTrigger value="comunas">Comunas</TabsTrigger>
      </TabsList>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TabsContent value="incidencias" className="mt-0">
          {incidencias.length === 0 ? (
            <Vacio>Sin incidencias abiertas. El día va bien.</Vacio>
          ) : (
            <ul className="divide-y divide-border">
              {incidencias.map((incidencia) => (
                <li key={incidencia.id}>
                  {/* Al detalle del PEDIDO: ahí vive el cajón de incidencia
                      donde se reclasifica y se resuelve. La lista general de
                      incidencias no filtra por pedido, así que mandar ahí
                      obligaría a buscarlo de nuevo — justo lo que F11 evita. */}
                  <Link
                    href={`/operaciones/${incidencia.pedidoId}`}
                    className="group flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden"
                  >
                    <span className="flex items-center gap-2">
                      {/* El punto rojo y la etiqueta: el color nunca es el único
                          canal (regla 2), así que el tipo va escrito al lado. */}
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-destructive"
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium">{incidencia.etiqueta}</span>
                      <ArrowUpRight
                        className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono">{incidencia.codigoEnvio ?? 'sin código'}</span>
                      {incidencia.comuna ? ` · ${incidencia.comuna}` : ''}
                      {incidencia.conductorNombre ? ` · ${incidencia.conductorNombre}` : ''}
                      {' · '}
                      {hace(incidencia.abiertaEn, ahora)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="conductores" className="mt-0">
          {conductores.length === 0 ? (
            <Vacio>Nadie tiene paradas asignadas hoy.</Vacio>
          ) : (
            <ul className="divide-y divide-border">
              {conductores.map((conductor) => {
                const avance =
                  conductor.asignados > 0
                    ? Math.round((conductor.completados / conductor.asignados) * 100)
                    : 0;
                return (
                  <li key={conductor.id}>
                    <Link
                      href={`/operaciones?conductor=${encodeURIComponent(conductor.id)}`}
                      className="group flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium">{conductor.nombre}</span>
                        <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">
                          {/* Antes del cierre: avance, sin juzgar. Después:
                              cuántos PAQUETES quedaron — no «conductor
                              rezagado», que era el sujeto equivocado, porque un
                              paquete de hoy lo puede entregar mañana otro. */}
                          {diaCerrado && conductor.rezagados !== null
                            ? `${conductor.rezagados} sin entregar`
                            : `${conductor.completados} de ${conductor.asignados}`}
                        </span>
                      </span>
                      <span
                        className="h-1 w-full overflow-hidden rounded-full bg-muted"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${avance}%` }}
                        />
                      </span>
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
    </Tabs>
  );
}
