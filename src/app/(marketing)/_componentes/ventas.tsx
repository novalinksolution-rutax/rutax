"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { accionAgendar, type EntradaAgendar } from "../agendar/acciones";

/**
 * El modal de ventas de la portada.
 * =============================================================================
 *
 * «Comenzar», «Agendar demo» y «Hablar con ventas» abren el MISMO formulario:
 * hoy el alta de un courier la hace un asesor desde el backstage, así que no hay
 * autoregistro al que mandar a nadie (decisión del usuario, 2026-09-27). Lo único
 * que cambia es el título y el `motivo`, que viaja al asunto del correo.
 *
 * Cuatro campos: el contacto es por WhatsApp, y el correo lo pide `/agendar`,
 * que sigue vivo para quien llega por enlace directo.
 */

type Motivo = NonNullable<EntradaAgendar["motivo"]>;

const TITULO: Record<Motivo, string> = {
  comenzar: "Comenzar",
  demo: "Agendar demo",
  ventas: "Hablar con ventas",
};

const Contexto = createContext<(motivo: Motivo) => void>(() => {});

export function VentasProvider({
  whatsapp,
  children,
}: {
  /** En formato internacional, solo dígitos: `56935775531`. */
  whatsapp: string;
  children: ReactNode;
}) {
  const [motivo, setMotivo] = useState<Motivo | null>(null);

  return (
    <Contexto.Provider value={setMotivo}>
      {children}
      <Dialog open={motivo !== null} onOpenChange={(abierto) => !abierto && setMotivo(null)}>
        {motivo ? (
          <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto border-t-2 border-t-brand sm:max-w-[460px]">
            {/* `key` reinicia el formulario cada vez que se abre. */}
            <FormularioVentas key={motivo} motivo={motivo} whatsapp={whatsapp} />
          </DialogContent>
        ) : null}
      </Dialog>
    </Contexto.Provider>
  );
}

export function BotonVentas({
  motivo,
  variante = "primario",
  tamano = "normal",
  className,
  children,
}: {
  motivo: Motivo;
  variante?: "primario" | "secundario";
  tamano?: "normal" | "chico";
  className?: string;
  children: ReactNode;
}) {
  const abrir = useContext(Contexto);
  return (
    <button
      type="button"
      onClick={() => abrir(motivo)}
      className={cn(claseBoton(variante, tamano), className)}
    >
      {children}
    </button>
  );
}

/**
 * Botón de marketing: 48 px de alto (el `Button` del producto llega a 36, que es
 * alto de tabla, no de portada). Los colores van por `--rx-*` y no por
 * `bg-primary`: `--primary` se resuelve en `<html>` y no sigue al cierre, que
 * fuerza el tema oscuro con `data-rx-theme`.
 */
export function claseBoton(
  variante: "primario" | "secundario",
  tamano: "normal" | "chico" = "normal"
) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-ctrl border font-semibold whitespace-nowrap",
    "transition-colors duration-150 outline-none cursor-pointer",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text",
    tamano === "normal" ? "min-h-12 px-5 text-[15.5px]" : "min-h-9 px-3.5 text-sm",
    variante === "primario"
      ? "border-transparent bg-[var(--rx-accent)] text-[var(--rx-fg-on-accent)] hover:bg-[color-mix(in_srgb,var(--rx-accent)_86%,var(--rx-fg))]"
      : "border-line bg-transparent text-fg hover:border-fg"
  );
}

const CONDUCTORES = ["1 a 5", "6 a 15", "16 a 40", "Más de 40"];

function FormularioVentas({ motivo, whatsapp }: { motivo: Motivo; whatsapp: string }) {
  const [pendiente, iniciar] = useTransition();
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<{ campo?: string; mensaje: string } | null>(null);

  const enlaceWhatsapp = `https://wa.me/${whatsapp}`;

  if (enviado) {
    return (
      <div className="grid justify-items-start gap-3 py-2">
        <DistintivoEstado tono="balanced" etiqueta="Recibido" />
        <DialogTitle className="text-lg">Te escribimos por WhatsApp.</DialogTitle>
      </div>
    );
  }

  // `onSubmit` y no `action`: React 19 vacía el formulario al terminar un
  // `action`, y ante un error la persona perdería lo que escribió.
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    setError(null);
    iniciar(async () => {
      const r = await accionAgendar({
        nombre: String(formulario.get("nombre") ?? ""),
        courier: String(formulario.get("empresa") ?? ""),
        whatsapp: String(formulario.get("whatsapp") ?? ""),
        conductores: String(formulario.get("conductores") ?? ""),
        motivo,
      });
      if (r.ok) setEnviado(true);
      else setError({ campo: r.campo, mensaje: r.mensaje });
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">{TITULO[motivo]}</DialogTitle>
        <DialogDescription className="sr-only">
          Déjanos tus datos y te escribimos por WhatsApp.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={enviar} className="grid gap-4">
        <Campo id="v-nombre" nombre="nombre" etiqueta="Nombre" autoComplete="name" error={error} />
        <Campo
          id="v-empresa"
          nombre="empresa"
          campoError="courier"
          etiqueta="Empresa"
          autoComplete="organization"
          error={error}
        />
        <Campo
          id="v-whatsapp"
          nombre="whatsapp"
          etiqueta="WhatsApp"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+56 9"
          error={error}
        />
        <div className="grid gap-1.5">
          <label htmlFor="v-conductores" className="text-sm font-semibold">
            Conductores
          </label>
          <select
            id="v-conductores"
            name="conductores"
            defaultValue="6 a 15"
            className="min-h-12 rounded-ctrl border border-line bg-bg px-3 text-[15px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent-text"
          >
            {CONDUCTORES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>

        {error && !error.campo ? (
          <p role="alert" className="text-sm text-fault-fg">
            {error.mensaje}{" "}
            <a href={enlaceWhatsapp} className="font-medium underline underline-offset-3">
              WhatsApp
            </a>
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <a
            href={enlaceWhatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fg-muted underline underline-offset-3 hover:text-fg"
          >
            O escríbenos por WhatsApp
          </a>
          <button type="submit" disabled={pendiente} className={claseBoton("primario")}>
            {pendiente ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </>
  );
}

function Campo({
  id,
  nombre,
  campoError,
  etiqueta,
  error,
  ...resto
}: {
  id: string;
  nombre: string;
  /** Nombre del campo en `EntradaAgendar`, si difiere del `name` del input. */
  campoError?: string;
  etiqueta: string;
  error: { campo?: string; mensaje: string } | null;
} & InputHTMLAttributes<HTMLInputElement>) {
  const conError = error?.campo === (campoError ?? nombre);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {etiqueta}
      </label>
      <input
        id={id}
        name={nombre}
        required
        aria-invalid={conError || undefined}
        aria-describedby={conError ? `${id}-error` : undefined}
        className={cn(
          "min-h-12 rounded-ctrl border bg-bg px-3 text-[15px] text-fg outline-none placeholder:text-fg-subtle",
          "focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent-text",
          conError ? "border-fault-line" : "border-line"
        )}
        {...resto}
      />
      {conError ? (
        <p id={`${id}-error`} className="text-sm text-fault-fg">
          {error.mensaje}
        </p>
      ) : null}
    </div>
  );
}
