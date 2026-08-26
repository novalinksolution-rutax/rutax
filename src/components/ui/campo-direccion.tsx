"use client";

/**
 * Campo de dirección con sugerencias mientras se escribe — solo Chile.
 *
 * -----------------------------------------------------------------------------
 * QUÉ PROBLEMA RESUELVE, QUE NO ES EL DE ESCRIBIR MENOS
 * -----------------------------------------------------------------------------
 * Una dirección tecleada a mano se geocodifica *después*, en un job, y cuando
 * no se puede ubicar el pedido queda «por revisar» — pero eso se descubre con
 * el courier ya en otra cosa. Eligiendo de la lista, la dirección viene
 * normalizada por el proveedor **y con su coordenada y su comuna**: queda
 * validada en el momento de elegirla, que era el punto.
 *
 * Decisión del usuario, 23-08-2026, en reemplazo del «Ubicando la dirección…»
 * con espera de 15 s que proponía el tablero: mejor no hacer esperar a nadie que
 * hacerlo esperar con un buen mensaje.
 *
 * -----------------------------------------------------------------------------
 * TRES COSAS QUE NO SON DE ESTILO
 * -----------------------------------------------------------------------------
 * 1. **El texto libre se conserva.** Elegir de la lista es el camino bueno, no
 *    el único: hay direcciones que ningún proveedor conoce —una parcela, una
 *    bodega sin número— y bloquear el envío por eso dejaría al courier sin poder
 *    crear el pedido. Si no se elige, el pedido se crea igual y se geocodifica
 *    como siempre.
 * 2. **La sesión de tecleo es una sola.** Google cobra por sesión: todas las
 *    pulsaciones hasta elegir se cobran como una si comparten token. El token
 *    nace con la primera letra y muere al elegir. Sin esto, cada tecla es una
 *    consulta facturada.
 * 3. **Se espera a que deje de escribir.** 250 ms sin teclas antes de preguntar.
 *    No es para ahorrar red: es que la lista saltando en cada letra es
 *    imposible de apuntar con el pulgar en una bodega.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SugerenciaVisible {
  id: string;
  principal: string;
  secundaria: string;
}

export interface DireccionElegida {
  /** La dirección completa del proveedor. Respaldo, no lo que se muestra. */
  direccion: string;
  /**
   * Solo calle y número. Es lo que queda en el campo cuando viene; ver el
   * bloque de `elegir`. `null` si el proveedor no la pudo componer.
   */
  direccionCorta?: string | null;
  comuna: string | null;
  lat: number | null;
  long: number | null;
}

/**
 * 🔴 **Tres cosas que antes se veían iguales: una lista vacía.**
 *
 * «No hay ninguna dirección así», «no tienes permiso» y «el proveedor falló»
 * devolvían todas `[]`, así que la pantalla afirmaba que la dirección no existe
 * cuando en realidad nadie la había buscado. Con un resultado etiquetado, el
 * campo puede decir lo que de verdad pasó — y lo que hay que hacer, que es
 * distinto en cada caso.
 */
export type ResultadoBusqueda =
  | { ok: true; sugerencias: SugerenciaVisible[] }
  | { ok: false; motivo: "sin_permiso" | "proveedor" };

/** Milisegundos sin teclear antes de preguntar. */
const ESPERA_MS = 250;

export function CampoDireccion({
  id,
  name,
  valor,
  onCambio,
  onElegir,
  buscar,
  resolver,
  elegida,
  ayuda,
  placeholder,
  required,
}: {
  id?: string;
  name?: string;
  valor: string;
  onCambio: (v: string) => void;
  /** Se dispara solo al elegir de la lista, con la dirección ya resuelta. */
  onElegir: (d: DireccionElegida) => void;
  buscar: (consulta: string, sesion: string) => Promise<ResultadoBusqueda>;
  resolver: (id: string, sesion: string) => Promise<DireccionElegida | null>;
  /** `true` cuando el valor actual vino de la lista, no de escribir. */
  elegida: boolean;
  ayuda?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
}) {
  const idAuto = useId();
  const idCampo = id ?? idAuto;
  const idLista = `${idCampo}-sugerencias`;

  const [sugerencias, setSugerencias] = useState<SugerenciaVisible[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [activa, setActiva] = useState(-1);
  /** `null` mientras la búsqueda funcione. Ver `ResultadoBusqueda`. */
  const [fallo, setFallo] = useState<"sin_permiso" | "proveedor" | null>(null);

  const sesion = useRef<string | null>(null);
  // Guarda lo último que se pidió para descartar respuestas que llegan tarde:
  // sin esto, teclear rápido puede dejar en pantalla la lista de «Av. Pro»
  // encima de la de «Av. Providencia».
  const ultimaConsulta = useRef("");

  function nuevaSesion(): string {
    if (!sesion.current) {
      sesion.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now());
    }
    return sesion.current;
  }

  useEffect(() => {
    const consulta = valor;
    // Todo el trabajo va DENTRO del temporizador, incluido el caso de vaciar la
    // lista. Fuera de él sería un `setState` síncrono dentro del efecto, que
    // dispara un render en cascada — y el lint del repo lo prohíbe con razón.
    const reloj = setTimeout(async () => {
      if (elegida || consulta.trim().length < 3) {
        setSugerencias([]);
        setAbierta(false);
        return;
      }
      ultimaConsulta.current = consulta;
      setBuscando(true);
      const r = await buscar(consulta, nuevaSesion());
      setBuscando(false);
      // Llegó tarde: ya se está escribiendo otra cosa.
      if (ultimaConsulta.current !== consulta) return;
      if (!r.ok) {
        setFallo(r.motivo);
        setSugerencias([]);
        setAbierta(false);
        return;
      }
      setFallo(null);
      setSugerencias(r.sugerencias);
      setAbierta(r.sugerencias.length > 0);
      setActiva(-1);
    }, ESPERA_MS);
    return () => clearTimeout(reloj);
  }, [valor, elegida, buscar]);

  async function elegir(s: SugerenciaVisible) {
    setAbierta(false);
    setBuscando(true);
    const detalle = await resolver(s.id, nuevaSesion());
    setBuscando(false);
    // La sesión termina al elegir: la siguiente búsqueda abre una nueva.
    sesion.current = null;
    if (detalle) {
      /**
       * 🔴 **En el campo queda calle y número, nada más** (encargo del usuario,
       * 26-08-2026). Google devuelve «Los Militares 5001, 7560955 Las Condes,
       * Región Metropolitana, Chile» y eso, en un campo de una línea, empuja la
       * calle fuera de la vista: para confirmar que la dirección es la correcta
       * hay que leer justo lo que se dejó de ver.
       *
       * ⚠️ La comuna NO se pierde al sacarla del texto: viaja aparte y llena su
       * propio campo unas líneas más abajo, en el formulario. Guardarla en los
       * dos sitios sería duplicarla, y dos copias de un dato se contradicen el
       * día que alguien edite una.
       *
       * El respaldo es `s.principal` —la línea principal de la sugerencia, que
       * Google ya entrega como calle y número— para el caso en que el detalle no
       * traiga calle: un lugar con nombre propio, «Mall Parque Arauco». Ahí lo
       * que la persona vio en la lista es mejor que la dirección larga.
       */
      onElegir({ ...detalle, direccion: detalle.direccionCorta || s.principal });
    } else {
      // El proveedor ya no la reconoce. Se conserva lo que la lista mostraba en
      // vez de dejar el campo como estaba: es lo que la persona quiso elegir.
      onElegir({
        direccion: `${s.principal}${s.secundaria ? `, ${s.secundaria}` : ""}`,
        comuna: null,
        lat: null,
        long: null,
      });
    }
  }

  function alTeclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierta || sugerencias.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiva((i) => (i + 1) % sugerencias.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiva((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
    } else if (e.key === "Enter" && activa >= 0) {
      e.preventDefault();
      void elegir(sugerencias[activa]);
    } else if (e.key === "Escape") {
      setAbierta(false);
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Input
          id={idCampo}
          name={name}
          value={valor}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={abierta}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={activa >= 0 ? `${idLista}-${activa}` : undefined}
          className="h-[52px] pe-9"
          onChange={(e) => {
            onCambio(e.target.value);
          }}
          onKeyDown={alTeclado}
          onBlur={() => {
            // Se cierra con retraso: un clic en la lista dispara `blur` antes
            // que el `click`, y cerrarla al instante se come la elección.
            setTimeout(() => setAbierta(false), 150);
          }}
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2">
          {buscando ? (
            <Loader2 className="size-4 animate-spin text-fg-subtle" aria-hidden="true" />
          ) : elegida ? (
            <Check className="size-4 text-balanced-fg" aria-hidden="true" />
          ) : null}
        </span>
      </div>

      {ayuda ? <p className="mt-1 text-xs leading-relaxed text-fg-muted">{ayuda}</p> : null}

      {/* 🔴 Que la búsqueda no esté disponible SE DICE.
          Callarlo deja la lista vacía, que es indistinguible de «esa dirección
          no existe» — y entonces la persona reescribe la dirección una y otra
          vez creyendo que se equivocó ella. Se dice qué pasó y que puede seguir:
          el texto libre nunca dejó de funcionar, solo se ubica después. */}
      {fallo && !elegida ? (
        <p className="mt-1 text-xs leading-relaxed text-attention-fg">
          {fallo === "proveedor"
            ? "No pudimos buscar direcciones en este momento."
            : "La búsqueda de direcciones no está disponible para tu cuenta."}{" "}
          Escríbela completa y la ubicamos nosotros después; el pedido se crea igual.
        </p>
      ) : null}

      {/* El estado «ubicada» se dice con texto, no solo con el visto: el color y
          el ícono no pueden ser los únicos portadores (regla 5). */}
      {elegida ? (
        <p className="mt-1 text-xs text-balanced-fg">
          Dirección ubicada. El conductor la va a encontrar.
        </p>
      ) : null}

      {abierta && sugerencias.length > 0 ? (
        <ul
          id={idLista}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto border border-line bg-popover shadow-lg"
        >
          {sugerencias.map((s, i) => (
            <li key={s.id} id={`${idLista}-${i}`} role="option" aria-selected={i === activa}>
              <button
                type="button"
                // `onMouseDown` y no `onClick`: el `blur` del campo llega
                // primero y cerraría la lista antes de que el clic ocurra.
                onMouseDown={(e) => {
                  e.preventDefault();
                  void elegir(s);
                }}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left",
                  i === activa ? "bg-bg-sunken" : "hover:bg-bg-sunken",
                )}
              >
                <span className="text-sm font-medium text-fg">{s.principal}</span>
                <span className="text-xs text-fg-muted">{s.secundaria}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
