'use client';

/**
 * La Torre de control — orquestador de la pantalla.
 * =============================================================================
 *
 * Acá vive el estado de NAVEGACIÓN (nivel, comuna activa, punto abierto,
 * pestaña, pantalla completa) y nada más. El dato llega ya armado del composer y
 * este componente no lo toca: **la Torre no ejecuta, solo muestra y enlaza**.
 *
 * Orden vertical, y el porqué del orden: cabecera → banda de ola → cifras →
 * mapa + panel. La ola va **arriba** de las cifras porque es lo único que mira
 * hacia adelante; abajo competiría con lo de hoy.
 *
 * PANTALLA COMPLETA. Es estado local sobre el contenedor, no una ruta nueva ni
 * un layout nuevo. Va sobre la región que contiene **mapa y panel**, no solo el
 * mapa: el panel es el único lugar donde se listan las incidencias, y un modo
 * «mirar en serio» que esconde lo único accionable de la pantalla sería peor que
 * no tenerlo. El `map.resize()` al entrar y salir lo cubre el `ResizeObserver`
 * del propio mapa, que además atrapa el colapso del sidebar y el arrastre de la
 * ventana — los tres producen el mismo lienzo desalineado.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { useTheme } from 'next-themes';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { IndicadorEnVivo } from '@/components/tiempo-real/indicador-en-vivo';
import { cn } from '@/lib/utils';
import type { EstadoTorre } from '@/modules/contexto/contrato-torre';
import { cargarGeometriaComunal, limitesDe, type MapaGeometrias } from '../_lib/geometria';
import { limitesDeLaCarga } from '../_lib/derivar';
import { claveComuna } from '../_lib/comunas';
import { ENCUADRE_RM, ZOOM_DESTINO, type NivelZoom, type TemaMapa } from '../_lib/mapa/paleta';
import { ATRIBUCIONES, urlBasemap } from '../_lib/mapa/config';
import { MapaTorre, type ControlesMapa } from './mapa';
import { PlacasComuna } from './placas';
import { CapaFichas } from './ficha';
import { PanelTorre, type PestanaPanel } from './panel';
import { CifrasTorre } from './cifras';
import { BandaOlas } from './banda-olas';
import { ListaComunas } from './lista-comunas';

/** Qué pestaña sugiere cada nivel. Es un valor por defecto, no una imposición. */
const PESTANA_POR_NIVEL: Record<NivelZoom, PestanaPanel> = {
  comuna: 'incidencias',
  agrupacion: 'conductores',
  punto: 'comunas',
};

export function Torre({ estado, tenantId }: { estado: EstadoTorre; tenantId: string }) {
  const { resolvedTheme } = useTheme();
  const tema: TemaMapa = resolvedTheme === 'dark' ? 'oscuro' : 'claro';

  const [geometrias, setGeometrias] = useState<MapaGeometrias | null>(null);
  const [fallaGeometria, setFallaGeometria] = useState(false);
  const [nivel, setNivel] = useState<NivelZoom>('comuna');
  const [comunaActiva, setComunaActiva] = useState<string | null>(null);
  const [puntoAbierto, setPuntoAbierto] = useState<string | null>(null);
  // Celda de la agrupación que el usuario abrió. Mientras exista, los puntos de
  // las otras se atenúan: es lo que hace legible que una burbuja de 4 pueda ser
  // 2 puntos (un edificio de 3 más un suelto). Ver `atenuar()` en `estilo.ts`.
  const [celdaAbierta, setCeldaAbierta] = useState<string | null>(null);
  const [mapa, setMapa] = useState<maplibregl.Map | null>(null);
  // Los vuelos van SIEMPRE por acá y nunca por `mapa.flyTo()` a pelo: los
  // controles ponen la bandera que impide que el zoom del camino recalcule el
  // nivel y borre la comuna recién elegida. Ver `ControlesMapa`.
  const [controles, setControles] = useState<ControlesMapa | null>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const region = useRef<HTMLDivElement>(null);

  // La pestaña la sugiere el nivel, pero **una vez que el usuario elige, manda
  // su elección**: cambiar de nivel no se la pisa. La pantalla sugiere dónde
  // mirar, no decide por él.
  const [pestanaElegida, setPestanaElegida] = useState<PestanaPanel | null>(null);
  const pestana = pestanaElegida ?? PESTANA_POR_NIVEL[nivel];

  // --- Geometría comunal, independiente del conteo ---------------------------
  useEffect(() => {
    const control = new AbortController();
    cargarGeometriaComunal(control.signal)
      .then(setGeometrias)
      .catch((error: unknown) => {
        if (control.signal.aborted) return;
        // Sin geometría no hay mapa, y eso es un estado declarado: manda la
        // lista de comunas, que dice exactamente lo mismo sin depender del
        // render cartográfico.
        console.error('Torre: no se pudo cargar la geometría comunal', error);
        setFallaGeometria(true);
      });
    return () => control.abort();
  }, []);

  // --- Encuadre de entrada: lo que el courier reparte, no una constante ------
  // Se hace UNA sola vez por montaje. Si se repitiera con cada refresco de
  // realtime, la cámara daría un tirón mientras el usuario está navegando —y el
  // realtime entra cada pocos segundos en una operación activa.
  const encuadrarLaCarga = useCallback(
    (duracion: number) => {
      if (!controles) return;
      const limites = geometrias ? limitesDeLaCarga(geometrias, estado.comunas) : null;
      if (limites) controles.encuadrarRegion(limites, duracion);
      // Día sin carga, o geometría aún sin cargar: el encuadre por defecto de la
      // RM. Es el único caso en que la constante sigue mandando.
      else controles.volarA(ENCUADRE_RM.centro, ZOOM_DESTINO.region, duracion);
    },
    [controles, geometrias, estado.comunas],
  );

  const yaEncuadrado = useRef(false);
  useEffect(() => {
    if (yaEncuadrado.current || !geometrias || !controles) return;
    if (!limitesDeLaCarga(geometrias, estado.comunas)) return;
    yaEncuadrado.current = true;
    encuadrarLaCarga(0);
  }, [geometrias, controles, estado.comunas, encuadrarLaCarga]);

  // --- Pantalla completa -----------------------------------------------------
  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(document.fullscreenElement === region.current);
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
  }, []);

  const alternarPantallaCompleta = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void region.current?.requestFullscreen();
  }, []);

  // --- Navegación ------------------------------------------------------------
  const entrarEnComuna = useCallback(
    (nombre: string) => {
      setComunaActiva(nombre);
      setPuntoAbierto(null);
      setCeldaAbierta(null);
      setNivel('agrupacion');

      // Se ENCUADRA la comuna, no se vuela a un zoom fijo: las de la RM van de
      // 7 km² a casi 200, y con un zoom único de la grande solo se ve un pedazo
      // —sin un borde a la vista no hay forma de saber en cuál estás— y la
      // chica queda diminuta entre sus vecinas. Ver `ControlesMapa.encuadrarEn`.
      const geometria = geometrias?.get(claveComuna(nombre));
      if (geometria && controles) {
        controles.encuadrarEn(limitesDe(geometria));
        return;
      }

      // Respaldo cuando la geometría todavía no cargó: el centroide y el zoom
      // de siempre. Peor encuadre, pero la navegación no se queda muerta.
      const destino = estado.comunas.find((c) => c.nombre === nombre);
      if (destino) {
        controles?.volarA([destino.centro.long, destino.centro.lat], ZOOM_DESTINO.comuna);
      }
    },
    [estado.comunas, controles, geometrias],
  );

  const volverALaRegion = useCallback(() => {
    setComunaActiva(null);
    setPuntoAbierto(null);
    setCeldaAbierta(null);
    setNivel('comuna');
    // Al MISMO encuadre con que se entró, no a la constante de la RM: si la
    // vuelta usara `ENCUADRE_RM`, una comuna periférica como Colina aparecería
    // al abrir la pantalla y desaparecería al volver de ella.
    encuadrarLaCarga(700);
  }, [encuadrarLaCarga]);

  // La ficha es del nivel 3 y solo del nivel 3: fuera de ahí quedaría señalando
  // un punto que dejó de dibujarse.
  //
  // Se DERIVA en vez de limpiarse con un efecto. Un efecto que hace `setState`
  // encadena un render extra, y en el intermedio la ficha alcanza a pintarse
  // sobre el nivel equivocado — un parpadeo por cada salida. Derivar no tiene
  // estado intermedio que pueda verse.
  const puntoVisible = nivel === 'punto' ? puntoAbierto : null;
  // La agrupación abierta es del nivel 3 y de la comuna en que se abrió: fuera
  // de ahí, atenuar puntos «ajenos» no significaría nada. Se deriva por el mismo
  // motivo que `puntoVisible` — un efecto con `setState` encadena un render y
  // deja ver un frame con la atenuación puesta en el nivel equivocado.
  const celdaVisible = nivel === 'punto' ? celdaAbierta : null;

  const etiquetasIncidencia = new Map(
    estado.incidencias.map((i) => [i.pedidoId, i.etiqueta] as const),
  );

  const hayMapa = geometrias !== null && !fallaGeometria;
  const sinPedidos = estado.estado === 'sin_pedidos';

  return (
    <div className="space-y-5">
      {/* Cabecera: `h1` + una línea de resumen, igual que toda pantalla de
          `(tenant)`. La Torre es un módulo, no una consola. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Torre de control</h1>
          <p className="text-sm text-muted-foreground">
            {sinPedidos
              ? 'No hay pedidos con compromiso para hoy.'
              : `${estado.courier.nombre} · faltan ${estado.resumen.pendientes} de ${estado.resumen.total} por entregar`}
          </p>
        </div>
        {/* F5: Realtime como SEÑAL → `router.refresh()`. El dato lo sigue
            leyendo el servidor, así que el aislamiento por RLS no se toca. */}
        <IndicadorEnVivo
          tenantId={tenantId}
          tablas={[
            { schema: 'operacion', tabla: 'pedidos' },
            { schema: 'operacion', tabla: 'incidencias' },
          ]}
        />
      </div>

      <BandaOlas olas={estado.olas} />

      <CifrasTorre resumen={estado.resumen} frescura={estado.frescura} />

      {/* La región cartográfica. `< lg` el mapa se retira entero y manda la
          lista: con el panel de 340 px fijos el mapa caía a 124 px a 768, que no
          es un mapa. El móvil se resuelve en la app nativa, fuera de este repo. */}
      <div
        ref={region}
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-card',
          // En pantalla completa el contenedor ocupa el viewport; sin esto,
          // conserva su alto calculado y deja el resto en negro.
          pantallaCompleta && 'h-screen rounded-none border-0',
        )}
      >
        <div
          className="flex min-h-0 flex-col lg:flex-row"
          style={{
            height: pantallaCompleta ? '100vh' : 'max(420px, min(68vh, 720px))',
          }}
        >
          {/* --- Mapa --- */}
          <div className="relative hidden min-w-0 flex-1 lg:block">
            {hayMapa ? (
              <>
                <MapaTorre
                  tema={tema}
                  geometrias={geometrias}
                  comunas={estado.comunas}
                  puntos={estado.puntos}
                  comunaActiva={comunaActiva}
                  nivel={nivel}
                  onNivel={setNivel}
                  onComuna={setComunaActiva}
                  onPunto={setPuntoAbierto}
                  celdaAbierta={celdaVisible}
                  onCelda={setCeldaAbierta}
                  onMapaListo={setMapa}
                  onControles={setControles}
                />
                <PlacasComuna
                  mapa={mapa}
                  comunas={estado.comunas}
                  visible={nivel === 'comuna'}
                  onComuna={entrarEnComuna}
                />
                {nivel === 'punto' ? (
                  <CapaFichas
                    mapa={mapa}
                    puntos={estado.puntos.filter(
                      (p) =>
                        comunaActiva === null ||
                        (p.comuna !== null && p.comuna === comunaActiva),
                    )}
                    activo={puntoVisible}
                    etiquetasIncidencia={etiquetasIncidencia}
                    celdaAbierta={celdaVisible}
                    onCerrar={() => setPuntoAbierto(null)}
                    onAbrir={setPuntoAbierto}
                  />
                ) : null}

                {/* Migas de pan: siempre visibles arriba a la izquierda. El
                    nombre de la comuna lo produce la SELECCIÓN, no el zoom — con
                    la rueda se baja de nivel sin elegir comuna, y ahí la miga se
                    queda en «Región Metropolitana». */}
                <nav
                  aria-label="Nivel del mapa"
                  // Por encima de las fichas: son la navegación de la pantalla y
                  // no pueden quedar tapadas por una previsualización que asoma.
                  // `data-reserva-placas` le dice al des-solape de las placas que
                  // este rectángulo ya está ocupado.
                  data-reserva-placas
                  className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1 text-xs"
                >
                  <button
                    type="button"
                    onClick={volverALaRegion}
                    className="pointer-events-auto rounded-md border border-border bg-card/90 px-2 py-1 font-medium backdrop-blur-[2px] transition-colors hover:bg-card"
                  >
                    Región Metropolitana
                  </button>
                  {comunaActiva ? (
                    <>
                      <span className="text-muted-foreground">/</span>
                      <span className="rounded-md border border-border bg-card/90 px-2 py-1 font-medium backdrop-blur-[2px]">
                        {comunaActiva}
                      </span>
                    </>
                  ) : null}
                  {nivel === 'punto' ? (
                    <>
                      <span className="text-muted-foreground">/</span>
                      <span className="rounded-md border border-border bg-card/90 px-2 py-1 text-muted-foreground backdrop-blur-[2px]">
                        Puntos de entrega
                      </span>
                    </>
                  ) : null}
                </nav>

                <button
                  type="button"
                  onClick={alternarPantallaCompleta}
                  data-reserva-placas
                  className="absolute top-3 right-3 z-10 rounded-md border border-border bg-card/90 p-1.5 backdrop-blur-[2px] transition-colors hover:bg-card focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
                >
                  {pantallaCompleta ? (
                    <Minimize2 className="size-4" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="size-4" aria-hidden="true" />
                  )}
                </button>

                {sinPedidos ? (
                  // La ciudad no desaparece porque sea domingo: las comunas
                  // siguen dibujadas y encima va una sola frase.
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70">
                    <p className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-xs">
                      No hay pedidos con compromiso para hoy
                    </p>
                  </div>
                ) : null}

                {/* Atribución: condición de licencia, no cortesía. No puede
                    esconderse tras un botón de «i». */}
                <p
                  data-reserva-placas
                  className="pointer-events-none absolute right-2 bottom-1 text-[10px] text-muted-foreground"
                >
                  {ATRIBUCIONES.map((a) => a.etiqueta).join(' · ')}
                  {urlBasemap() === null ? ' · sin plano urbano' : ''}
                </p>
              </>
            ) : fallaGeometria ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No se pudo cargar la geometría comunal. La lista de al lado tiene la misma
                  información.
                </p>
              </div>
            ) : (
              // Esqueleto con la forma final, nunca un spinner de página.
              <Skeleton className="h-full w-full rounded-none" />
            )}
          </div>

          {/* --- Lista de comunas: la superficie principal bajo `lg` --- */}
          <div className="min-h-0 flex-1 overflow-y-auto lg:hidden">
            <ListaComunas
              comunas={estado.comunas}
              comunaActiva={comunaActiva}
              onComuna={setComunaActiva}
            />
          </div>

          {/* --- Panel --- */}
          <div className="hidden min-h-0 w-[340px] shrink-0 border-l border-border lg:flex lg:flex-col">
            <PanelTorre
              pestana={pestana}
              onPestana={setPestanaElegida}
              incidencias={estado.incidencias}
              conductores={estado.conductores}
              comunas={estado.comunas}
              ahora={estado.ahora}
              diaCerrado={estado.corte.diaCerrado}
              comunaActiva={comunaActiva}
              onComuna={entrarEnComuna}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
