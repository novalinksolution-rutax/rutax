"use client";

/**
 * Alta y edición de una zona — con sus 52 comunas dentro.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 ERAN DOS PANTALLAS PARA UNA SOLA COSA
 * -----------------------------------------------------------------------------
 * Crear la zona vivía en un formulario de un campo arriba; asignarle comunas, en
 * un acordeón aparte más abajo con **su propio selector de zona**. O sea: creabas
 * «Norte», bajabas, volvías a elegir «Norte» en un desplegable, y recién ahí
 * marcabas comunas.
 *
 * Una zona sin comunas no hace nada —no agrupa, no cambia ninguna tarifa— así
 * que las dos mitades son la misma tarea partida en dos. B3b las junta: «alta
 * con las 52 comunas».
 *
 * -----------------------------------------------------------------------------
 * SE GUARDA EN UNA SOLA LLAMADA, Y ESO ES DEL SERVIDOR
 * -----------------------------------------------------------------------------
 * `actionGuardarZona` hace las tres escrituras —crear o renombrar, borrar las
 * comunas anteriores, insertar las nuevas— dentro de una transacción de
 * Postgres. Antes eran dos acciones sueltas desde acá y un fallo en la segunda
 * dejaba la zona creada y vacía; al reintentar se creaba una segunda con el
 * mismo nombre. El detalle está en `identidad.guardar_zona_con_comunas`.
 *
 * Para esta pantalla eso significa una cosa concreta: **el error que llega es
 * siempre sobre un guardado que NO ocurrió**, así que no hay que explicar
 * estados a medias.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelAccion } from "@/components/ui/panel-accion";
import type { Zona } from "@/modules/operacion/tipos";
import {
  actionGuardarZona,
  actionObtenerCoberturaComunas,
  actionObtenerComunasDeZona,
} from "./actions";
import {
  contarCobertura,
  estadoDeComunas,
  textoCobertura,
  type AsignacionComuna,
} from "./cobertura-comunas";

export function PanelZona({
  zona,
  zonas,
  abierto,
  onOpenChange,
  onGuardada,
}: {
  /** `undefined` = alta. */
  zona?: Zona;
  /** Todas, para poder decir de quién es cada comuna ocupada. */
  zonas: Zona[];
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  onGuardada: () => void;
}) {
  const esEdicion = !!zona;
  const [nombre, setNombre] = useState(zona?.nombre ?? "");
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [cobertura, setCobertura] = useState<AsignacionComuna[]>([]);
  const [busqueda, setBusqueda] = useState("");
  /**
   * ⚠️ **`cargado` en vez de `cargando`, y no es un cambio de nombre.**
   * Poner `setCargando(true)` en el cuerpo del efecto dispara un render en
   * cascada —la regla `react-hooks/set-state-in-effect` lo señala con razón—.
   * Con un `cargado` que arranca en `false` y solo se enciende en la respuesta,
   * el efecto no toca estado de forma síncrona y «cargando» se deriva.
   */
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Se lee al abrir. No es un efecto sobre `zona` sino sobre `abierto`: el panel
  // vive montado en la fila y sin esto releería en cada render del listado.
  useEffect(() => {
    if (!abierto || cargado) return;
    let vigente = true;
    Promise.all([
      esEdicion ? actionObtenerComunasDeZona(zona!.id) : Promise.resolve(null),
      actionObtenerCoberturaComunas(),
    ]).then(([mias, todas]) => {
      if (!vigente) return;
      setCargado(true);
      setNombre(zona?.nombre ?? "");
      setError(null);
      setSeleccionadas(mias && mias.ok ? mias.datos.map((c) => c.comuna) : []);
      // Si la cobertura falla se sigue: el peor caso es no poder advertir de
      // las comunas ajenas, y eso es mejor que no poder crear la zona.
      if (todas.ok) setCobertura(todas.datos);
    });
    return () => {
      vigente = false;
    };
  }, [abierto, cargado, esEdicion, zona]);

  const cargando = abierto && !cargado;

  const nombrePorZona = new Map(zonas.map((z) => [z.id, z.nombre]));
  const estados = estadoDeComunas(cobertura, nombrePorZona, zona?.id ?? "", seleccionadas);
  const conteo = contarCobertura(estados);
  const texto = textoCobertura(conteo);
  const visibles = estados.filter((e) =>
    e.comuna.toLowerCase().includes(busqueda.toLowerCase()),
  );

  function alternar(comuna: string) {
    setError(null);
    setSeleccionadas((prev) =>
      prev.includes(comuna) ? prev.filter((c) => c !== comuna) : [...prev, comuna],
    );
  }

  async function guardar() {
    const limpio = nombre.trim();
    if (!limpio) {
      setError("Ponle un nombre a la zona.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await actionGuardarZona({
        zonaId: zona?.id ?? null,
        nombre: limpio,
        comunas: seleccionadas,
      });
      if (!r.ok) {
        // Una sola llamada, un solo error, y nada quedó a medias: no hay que
        // explicar una zona creada sin comunas porque ya no puede pasar.
        setError(r.mensaje);
        return;
      }
      onGuardada();
      onOpenChange(false);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={(a) => {
        // Al cerrar se olvida lo leído: la próxima apertura vuelve a consultar,
        // porque otra zona pudo tomarse una comuna mientras tanto.
        if (!a) setCargado(false);
        onOpenChange(a);
      }}
      titulo={esEdicion ? (zona!.nombre ?? "Editar zona") : "Nueva zona"}
      subtitulo="Agrupa comunas para cobrar distinto según dónde entregas."
      pie={
        <div className="flex items-center gap-2">
          <Button onClick={guardar} disabled={guardando || cargando}>
            {guardando ? "Guardando…" : esEdicion ? "Guardar" : "Crear la zona"}
          </Button>
          <Button variant="outline" disabled={guardando} onClick={() => onOpenChange(false)}>
            Volver
          </Button>
        </div>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="zona-nombre-panel">Nombre</Label>
        <Input
          id="zona-nombre-panel"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setError(null);
          }}
          placeholder="Ej: Norte"
          disabled={guardando}
        />
      </div>

      <div className="space-y-2">
        {/* 🔴 El contador dice lo que FALTA, no lo que hay: una comuna sin zona
            cae en la tarifa por defecto y se cobra igual, en silencio. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label htmlFor="zona-buscar-comuna">Comunas</Label>
          <span className="rx-num font-mono text-xs tabular-nums">
            <span className="text-fg-muted">{texto.principal}</span>
            {texto.alerta && (
              <>
                <span className="text-fg-subtle"> · </span>
                <span className="font-semibold text-attention-fg">{texto.alerta}</span>
              </>
            )}
          </span>
        </div>
        <Input
          id="zona-buscar-comuna"
          placeholder="Buscar una comuna…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          disabled={guardando}
        />
      </div>

      {cargando ? (
        <p className="text-sm text-fg-muted">Cargando comunas…</p>
      ) : (
        <div
          className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto border border-line p-2 sm:grid-cols-2"
          role="group"
          aria-label="Comunas de la Región Metropolitana"
        >
          {visibles.map((e) =>
            /* La que ya tiene dueño NO se oculta y NO se puede marcar: se ve con
               trama y con el nombre de su zona. Quien la busca necesita saber
               dónde está. */
            e.esDeOtraZona ? (
              <span
                key={e.comuna}
                data-tono="inert"
                data-trama=""
                className="flex cursor-not-allowed items-baseline gap-1.5 border border-line-subtle px-2 py-1.5 text-sm text-fg-subtle"
                title={`Ya está en la zona ${e.nombreZonaDuena}.`}
              >
                <span className="truncate">{e.comuna}</span>
                <span className="truncate text-xs">· {e.nombreZonaDuena}</span>
              </span>
            ) : (
              <label
                key={e.comuna}
                className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm transition-colors ${
                  e.esDeEstaZona ? "bg-accent-deep text-accent-text" : "text-fg hover:bg-bg-sunken"
                }`}
              >
                <input
                  type="checkbox"
                  checked={e.esDeEstaZona}
                  onChange={() => alternar(e.comuna)}
                  disabled={guardando}
                  className="size-3.5 accent-[var(--rx-accent)]"
                />
                {e.comuna}
              </label>
            ),
          )}
        </div>
      )}

      <p className="text-xs text-fg-subtle">
        Una comuna solo puede estar en una zona. Las que ya tienen dueño se ven con su zona y no se
        pueden marcar desde acá.
      </p>

      {error && (
        <p
          role="alert"
          className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
        >
          {error}
        </p>
      )}
    </PanelAccion>
  );
}
