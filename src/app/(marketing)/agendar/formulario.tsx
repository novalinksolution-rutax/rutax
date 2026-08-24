"use client";

/**
 * El formulario de agendamiento, con sus tres estados.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LOS TRES ESTADOS QUE SE PIERDEN SI NO SE DISEÑAN
 * -----------------------------------------------------------------------------
 * · **Error de validación** — pegado al campo, y **nunca se pierde lo escrito**.
 *   Un formulario que se vacía al fallar es un formulario que no se vuelve a
 *   llenar.
 * · **Falla de envío — la pantalla más cara del sitio.** «No es culpa tuya y no
 *   se perdió nada.» El **teléfono directo aparece solo acá**: ponerlo siempre
 *   lo convierte en la salida fácil y nadie completaría el formulario; ponerlo
 *   nunca deja a alguien que ya decidió contactarnos sin forma de hacerlo.
 * · **Si vuelve** — reconoce que ya escribió, en vez del formulario en blanco
 *   que le hace pensar que su solicitud no llegó y lo manda a escribirla otra
 *   vez.
 *
 * -----------------------------------------------------------------------------
 * AL ENVIAR, LA CONFIRMACIÓN DEVUELVE LO QUE ESCRIBIÓ
 * -----------------------------------------------------------------------------
 * No «gracias, te contactaremos». **Su nombre, su courier y su WhatsApp, de
 * vuelta.** Es la única forma de que sepa que llegó bien lo que quiso decir — y
 * de que detecte un dígito mal escrito mientras todavía puede avisar.
 */

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { accionAgendar, type DatosAgendar, type ResultadoAgendar } from "./acciones";

const FUENTES = ["Mercado Libre Flex", "Shopify", "Same-day propio", "Otra"];
const CLAVE_ENVIADO = "rutax:agendar_enviado_v1";

const VACIO: DatosAgendar = {
  nombre: "",
  courier: "",
  whatsapp: "",
  correo: "",
  conductores: "",
  fuentes: [],
};

export function FormularioAgendar({ telefonoDirecto }: { telefonoDirecto: string | null }) {
  const [datos, setDatos] = useState<DatosAgendar>(VACIO);
  const [error, setError] = useState<ResultadoAgendar | null>(null);
  const [enviado, setEnviado] = useState<DatosAgendar | null>(null);
  const [pendiente, iniciar] = useTransition();

  /**
   * «Si vuelve»: se recuerda en el navegador, no en el servidor. No hay cuenta
   * que consultar, y guardar prospectos en una tabla que nadie mira sería
   * construir un cementerio.
   *
   * ⚠️ Va por `useSyncExternalStore` y **no** por un efecto que llame a
   * `setState`. `localStorage` no existe en el servidor, así que el estado
   * inicial no puede leerlo; y un efecto que lo lea después produce un render
   * de más y un parpadeo del aviso. `useSyncExternalStore` existe justo para
   * esto: da una instantánea distinta para el servidor sin romper la
   * hidratación.
   */
  const yaVino = useSyncExternalStore(
    // Nada externo cambia mientras la página está abierta: no hay a qué
    // suscribirse, así que la baja es un no-op.
    useCallback(() => () => {}, []),
    () => {
      try {
        return window.localStorage.getItem(CLAVE_ENVIADO);
      } catch {
        // Modo privado: se comporta como una primera visita.
        return null;
      }
    },
    // En el servidor nunca ha venido: es lo único que se puede afirmar ahí.
    () => null,
  );

  const set = <K extends keyof DatosAgendar>(k: K, v: DatosAgendar[K]) =>
    setDatos((d) => ({ ...d, [k]: v }));

  function enviar() {
    setError(null);
    iniciar(async () => {
      const r = await accionAgendar(datos);
      if (!r.ok) {
        setError(r);
        return;
      }
      try {
        window.localStorage.setItem(CLAVE_ENVIADO, datos.courier);
      } catch {
        /* da igual: la confirmación se muestra de todos modos */
      }
      setEnviado(datos);
    });
  }

  // ── Confirmación: le devolvemos lo que escribió ────────────────────────
  if (enviado) {
    return (
      <div className="border border-balanced-line bg-balanced-bg p-6">
        <h2 className="font-heading text-xl font-semibold text-balanced-fg">Llegó.</h2>
        <p className="mt-2 text-sm leading-relaxed text-balanced-fg">
          Te escribimos por WhatsApp al{" "}
          <strong className="font-medium">{enviado.whatsapp}</strong>, {enviado.nombre}. Si el
          número está mal, vuelve a mandarlo y lo corregimos.
        </p>
        <dl className="mt-4 grid gap-2 text-sm text-balanced-fg sm:grid-cols-2">
          <Devuelto rotulo="Courier" valor={enviado.courier} />
          <Devuelto rotulo="Conductores" valor={enviado.conductores} />
          <Devuelto rotulo="Correo" valor={enviado.correo} />
          <Devuelto
            rotulo="Tus pedidos llegan de"
            valor={enviado.fuentes.join(" · ") || "no lo dijiste"}
          />
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-balanced-fg">
          Contesta quien construye el producto, no un vendedor. Normalmente el mismo día.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* «Si vuelve»: reconoce que ya escribió. Un formulario en blanco le hace
          pensar que su solicitud no llegó. */}
      {yaVino ? (
        <div className="border border-progress-line bg-progress-bg px-4 py-3">
          <p className="text-sm leading-relaxed text-progress-fg">
            Ya nos escribiste por <strong className="font-medium">{yaVino}</strong>. Si necesitas
            corregir algo o no te hemos contestado, mándalo de nuevo — no molesta.
          </p>
        </div>
      ) : null}

      {/* Falla de envío: la pantalla más cara del sitio. */}
      {error && !error.ok && !error.campo ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error.mensaje}
            {telefonoDirecto ? (
              <>
                {" "}
                <a href={`https://wa.me/${telefonoDirecto.replace(/\D/g, "")}`} className="font-medium underline underline-offset-4">
                  Escríbenos por WhatsApp
                </a>
                .
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          id="nombre"
          etiqueta="Tu nombre"
          valor={datos.nombre}
          onChange={(v) => set("nombre", v)}
          error={error && !error.ok && error.campo === "nombre" ? error.mensaje : null}
        />
        <Campo
          id="courier"
          etiqueta="Tu courier"
          valor={datos.courier}
          onChange={(v) => set("courier", v)}
          error={error && !error.ok && error.campo === "courier" ? error.mensaje : null}
        />
        <Campo
          id="whatsapp"
          etiqueta="WhatsApp"
          tipo="tel"
          ayuda="Es como coordinamos. Pedir solo correo alarga esto tres días."
          valor={datos.whatsapp}
          onChange={(v) => set("whatsapp", v)}
          error={error && !error.ok && error.campo === "whatsapp" ? error.mensaje : null}
        />
        <Campo
          id="correo"
          etiqueta="Correo"
          tipo="email"
          valor={datos.correo}
          onChange={(v) => set("correo", v)}
          error={error && !error.ok && error.campo === "correo" ? error.mensaje : null}
        />
      </div>

      <Campo
        id="conductores"
        etiqueta="¿Cuántos conductores?"
        ayuda="Aunque sea aproximado."
        valor={datos.conductores}
        onChange={(v) => set("conductores", v)}
        error={error && !error.ok && error.campo === "conductores" ? error.mensaje : null}
      />

      <fieldset>
        <legend className="text-sm font-medium">¿De dónde te llegan los pedidos?</legend>
        <p className="mt-1 text-sm text-fg-muted">
          Define qué te mostramos en la demostración. Puedes marcar varias.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {FUENTES.map((f) => {
            const marcada = datos.fuentes.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={marcada}
                onClick={() =>
                  set(
                    "fuentes",
                    marcada ? datos.fuentes.filter((x) => x !== f) : [...datos.fuentes, f],
                  )
                }
                className={`border px-3 py-2 text-sm transition-colors ${
                  marcada
                    ? "border-accent-line bg-accent-deep text-fg"
                    : "border-line bg-bg-raised text-fg-muted hover:bg-bg-inset"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button size="lg" disabled={pendiente} onClick={enviar}>
          {pendiente ? "Enviando…" : "Agendar la demostración"}
        </Button>
        {/* Lo que NO se pide, dicho: quita la sospecha de que después viene un
            calendario o una tarjeta. */}
        <span className="text-sm text-fg-muted">
          Sin fecha y hora ahora, sin tarjeta y sin compromiso.
        </span>
      </div>
    </div>
  );
}

function Campo({
  id,
  etiqueta,
  valor,
  onChange,
  error,
  ayuda,
  tipo = "text",
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  error: string | null;
  ayuda?: string;
  tipo?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : ayuda ? `${id}-ayuda` : undefined}
        className={error ? "border-fault-line" : undefined}
      />
      {/* El error va PEGADO al campo, no en un resumen arriba: un resumen
          obliga a buscar cuál de los seis era. */}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-fault-fg">
          {error}
        </p>
      ) : ayuda ? (
        <p id={`${id}-ayuda`} className="text-sm text-fg-muted">
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}

function Devuelto({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-[0.12em] uppercase opacity-70">{rotulo}</dt>
      <dd className="mt-0.5 font-medium">{valor}</dd>
    </div>
  );
}
