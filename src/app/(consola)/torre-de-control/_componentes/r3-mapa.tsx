"use client";

import dynamic from "next/dynamic";
import type {
  CapaMapa,
  CeldaClima,
  ConductorEnMapa,
  EstadoCapa,
  EstadoPantalla,
  MarcaOperativa,
  PedidoEnMapa,
  NivelZoom,
  Zona,
} from "../_fixture/estado-torre";
import { ListaZonas } from "./lista-zonas";
import { LeyendaRiesgo } from "./leyenda-riesgo";
import { ContadorSinUbicar } from "./contador-sin-ubicar";
import { ControlCapas } from "./mapa/control-capas";
import { ControlZoom } from "./mapa/control-zoom";
import { AtribucionMapa } from "./mapa/atribucion-mapa";

/**
 * MapLibre pesa, toca `window` al importarse y no aporta nada en el servidor:
 * se carga solo en el cliente y solo cuando R3 está en modo mapa. Mientras
 * llega, el hueco muestra el mismo esqueleto de trama diagonal que el resto de
 * las regiones y NOMBRA lo que falta, como pide el handoff (§6, «Estados de
 * carga»): nombrar la región que carga es parte del diseño.
 */
const MapaZonas = dynamic(() => import("./mapa/mapa-zonas").then((m) => m.MapaZonas), {
  ssr: false,
  loading: () => (
    <div className="tc-cargando flex flex-1 items-center justify-center">
      <span className="border-2 border-tc-tinta bg-tc-papel px-3 py-1.5 text-[9px] font-extrabold tracking-[0.14em] text-tc-tinta uppercase">
        R3 · mapa — cargando
      </span>
    </div>
  ),
});

interface Props {
  estadoPantalla: EstadoPantalla;
  zonas: Zona[];
  zonaSeleccionada: string | null;
  capas: EstadoCapa[];
  capasActivas: CapaMapa[];
  zoom: NivelZoom;
  pedidosSinGeocodificar: number;
  celdasClima: CeldaClima[];
  conductores: ConductorEnMapa[];
  marcasOperativas: MarcaOperativa[];
  pedidos: PedidoEnMapa[];
  marcando: boolean;
  marcaProvisional: { long: number; lat: number } | null;
  /** `true` = el usuario pidió el equivalente sin mapa (tecla `L`). */
  mostrarLista: boolean;
  onSeleccionarZona: (zonaId: string) => void;
  onAlternarCapa: (capa: CapaMapa) => void;
  onCambiarZoom: (zoom: NivelZoom) => void;
  onAlternarLista: () => void;
  onColocarMarca: (long: number, lat: number) => void;
}

/**
 * La capa de pedidos ya NO está bloqueada por diseño.
 *
 * Estuvo apagada mientras el geocoding corría con el proveedor de respaldo: ahí
 * todos los pedidos caían en el centroide de su comuna y el plano habría sido
 * cinco pilas alineadas, ninguna real. Eso cambió: la ingesta de Mercado Libre
 * ahora guarda la coordenada que viene en `receiver_address`, y el composer solo
 * emite los pedidos con `geo_estado = 'resuelto'`.
 *
 * Lo que queda del principio antiguo: **no se inventa ningún punto**. Un pedido
 * sin coordenada creíble no se dibuja, y el contador de «sin ubicar» dice
 * cuántos son (regla 5 del handoff). Por eso el único motivo de bloqueo que
 * queda es el trivial: que todavía no haya ni uno ubicado.
 */
const MOTIVO_PEDIDOS_VACIO =
  "Ningún pedido del horizonte tiene ubicación resuelta todavía.";

/**
 * R3 · el mapa, con sus cuatro controles flotantes, y su equivalente sin mapa.
 *
 * La lista NO es un respaldo del mapa ni desaparece cuando el mapa carga: es la
 * regla de producto 7 (mismo dato, recorrible con tabulador) y es la vista
 * móvil. La tecla `L` conmuta entre las dos.
 */
export function R3Mapa({
  estadoPantalla,
  zonas,
  zonaSeleccionada,
  capas,
  capasActivas,
  zoom,
  pedidosSinGeocodificar,
  celdasClima,
  conductores,
  marcasOperativas,
  pedidos,
  marcando,
  marcaProvisional,
  mostrarLista,
  onSeleccionarZona,
  onAlternarCapa,
  onCambiarZoom,
  onAlternarLista,
  onColocarMarca,
}: Props) {
  // Las capas que dependen de un dato inexistente se declaran no disponibles
  // aquí y no en la fixture, porque el motivo es de entorno (qué proveedor de
  // geocoding corre), no del dataset.
  const capasResueltas: EstadoCapa[] = capas.map((capa) =>
    capa.id === "pedidos"
      ? {
          ...capa,
          disponible: pedidos.length > 0,
          motivoNoDisponible: pedidos.length > 0 ? null : MOTIVO_PEDIDOS_VACIO,
        }
      : capa,
  );

  return (
    <section
      id="r3-mapa"
      className="flex flex-1 flex-col overflow-hidden bg-tc-papel"
      aria-label="Mapa de zonas"
    >
      {mostrarLista ? (
        <ListaZonas
          zonas={zonas}
          zonaSeleccionada={zonaSeleccionada}
          pedidosSinGeocodificar={pedidosSinGeocodificar}
          onSeleccionarZona={onSeleccionarZona}
        />
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {/* `key` sobre el estado de pantalla: `sin_zonas` cambia el ESTILO del
              mapa (relleno plano, trazo discontinuo) y un estilo se fija al
              crear el mapa. Remontar es más barato y más seguro que reconstruir
              el estilo en caliente y volver a colgarle imágenes y datos. */}
          <MapaZonas
            key={estadoPantalla === "sin_zonas" ? "sin-zonas" : "zonas"}
            zonas={zonas}
            zonaSeleccionada={zonaSeleccionada}
            capasActivas={capasActivas}
            zoom={zoom}
            celdasClima={celdasClima}
            conductores={conductores}
            marcasOperativas={marcasOperativas}
            pedidos={pedidos}
            marcando={marcando}
            marcaProvisional={marcaProvisional}
            onSeleccionarZona={onSeleccionarZona}
            onColocarMarca={onColocarMarca}
          />

          {/* Controles flotantes, a 14 px del borde (README §4). */}
          <div className="pointer-events-none absolute inset-0 p-3.5">
            <div className="pointer-events-auto absolute top-3.5 left-3.5">
              <ControlCapas capas={capasResueltas} activas={capasActivas} onAlternar={onAlternarCapa} />
            </div>
            <div className="pointer-events-auto absolute top-3.5 right-3.5">
              <ControlZoom
                zoom={zoom}
                motivoPedidos={pedidos.length > 0 ? null : MOTIVO_PEDIDOS_VACIO}
                onCambiarZoom={onCambiarZoom}
                onAlternarLista={onAlternarLista}
              />
            </div>
            <div className="pointer-events-auto absolute bottom-3.5 left-3.5">
              <LeyendaRiesgo />
            </div>
            <div className="pointer-events-auto absolute right-3.5 bottom-3.5 max-w-[280px]">
              <ContadorSinUbicar cantidad={pedidosSinGeocodificar} />
            </div>
          </div>
        </div>
      )}

      <AtribucionMapa />
    </section>
  );
}
